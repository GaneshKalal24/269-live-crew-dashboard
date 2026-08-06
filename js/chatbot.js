// ============================================================
//  ARD ASSISTANT  — rule-based project chatbot (free, no API)
//  Answers from live schedule + board data:
//    · "When is B-1203 coming down?"      -> schedule dates
//    · "What's live right now?"           -> live/hold/scheduled fronts
//    · "How many crew on site?"           -> crew totals
//  Anything else -> polite "I can't answer that, here's what I can do".
//
//  Usage (any page):
//    import { mountChatbot } from "./js/chatbot.js";
//    mountChatbot({ getData: ()=>({ pins, schedule, demoSchedule, crewLog, statusOverrides, daily }) });
//  getData() is called fresh on every question so answers are always current.
// ============================================================

function fmtDMY(iso){ if(!iso) return '—'; const [y,m,d]=iso.split('-'); return d+'/'+m+'/'+y.slice(2); }
function todayISO(){ const d=new Date(); const p=n=>String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// crew trade labels
const TRADES=[['demolition','Demolition'],['asbestos','Asbestos'],['scaffolding','Scaffolding'],['subcontractor','Subcontractor']];

// ---- helpers over the data ----
function activitiesFor(schedKey, D){
  // returns merged activity list for a structure key across asbestos + demo schedules
  return (D.schedule&&D.schedule[schedKey]) || (D.demoSchedule&&D.demoSchedule[schedKey]) || [];
}
function findPinByText(q, D){
  // Pull candidate structure tokens out of the question, then match each to a pin.
  const norm=s=>String(s).toUpperCase().replace(/[^A-Z0-9]/g,'');
  // First: check learned aliases (nicknames the editor taught the bot).
  const dict=(D.dict&&D.dict.botAliases)||{};
  const lowQ=q.toLowerCase();
  for(const [alias,pinId] of Object.entries(dict)){
    if(lowQ.includes(alias.toLowerCase())){
      const p=(D.pins||[]).find(x=>x.id===pinId);
      if(p) return p;
    }
  }
  // candidate tokens: B-1203, B1203, 1203, 63-FCC, TCC, USGP, D-3802, DA4504...
  const tokens = (q.toUpperCase().match(/\b([A-Z]{1,3}-?\d{2,4}(?:\/\d+)*|\d{2,4}-?[A-Z]{2,6}|TCC|\d{3,4})\b/g) || []);
  // also try longer words (e.g. "blending", "alky") as fallback tokens
  const words = (q.toUpperCase().match(/\b[A-Z]{3,}\b/g) || []).filter(w=>!['WHEN','WHAT','WHERE','CREW','LIVE','HOLD','SITE','COMING','DOWN','SCHEDULED','SCHEDULE','MANY','THE','ARE','HOW','DUE','FOR','AND'].includes(w));
  const cands=[...tokens, ...words];
  if(!cands.length) return null;
  let best=null, bestScore=0;
  (D.pins||[]).forEach(p=>{
    const idn=norm(p.id), lbn=norm(p.label), scn=norm(p.sched||'');
    cands.forEach(tok=>{
      const tn=norm(tok); if(tn.length<2) return;
      let score=0;
      if(idn===tn||lbn===tn) score=100;
      else if(idn.includes(tn)||scn.includes(tn)) score=70+tn.length;
      else if(lbn.includes(tn)) score=60+tn.length;
      if(score>bestScore){ bestScore=score; best=p; }
    });
  });
  return bestScore>=62?best:null;  // require a reasonably specific match
}
function statusOf(pin, D){
  const today=todayISO();
  const ov=(D.statusOverrides&&D.statusOverrides[pin.id])||'auto';
  if(ov==='hold') return {state:'hold', label:'ON HOLD'};
  if(ov==='live') return {state:'live', label:'LIVE'};
  if(ov==='notlive') return {state:'done', label:'not live'};
  const acts=activitiesFor(pin.sched||pin.label, D);
  let live=false, upcoming=false, done=true;
  acts.forEach(a=>{
    if(!a.s||!a.f) return;
    if(a.s<=today && today<=a.f) live=true;
    if(a.s>today) { upcoming=true; done=false; }
    if(a.f>=today) done=false;
  });
  if(live) return {state:'live', label:'LIVE'};
  if(done && acts.length) return {state:'done', label:'finished'};
  if(upcoming) return {state:'upcoming', label:'scheduled'};
  return {state:'none', label:'no schedule'};
}
function crewTotalFor(id, D){
  const log=(D.crewLog&&D.crewLog[id])||null;
  if(!log||!log.crew) return 0;
  return TRADES.reduce((s,[k])=>s+(Number(log.crew[k])||0),0);
}

// ---- date helpers for week-window questions ----
function addDays(iso, n){ const d=new Date(iso+'T00:00:00'); d.setDate(d.getDate()+n); const p=x=>String(x).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
function endOfWeek(iso){ // Sunday end (AU week Mon-Sun)
  const d=new Date(iso+'T00:00:00'); const day=(d.getDay()+6)%7; // 0=Mon
  return addDays(iso, 6-day);
}

// Structures with an activity FINISHING within [from,to]
function answerFinishing(D, from, to, label){
  const hits=[];
  (D.pins||[]).forEach(p=>{
    const acts=activitiesFor(p.sched||p.label, D);
    acts.forEach(a=>{ if(a.f && a.f>=from && a.f<=to){ hits.push({label:p.label, act:a.a, f:a.f, p:a.p||0}); } });
  });
  if(!hits.length) return `Nothing is scheduled to finish ${label}.`;
  hits.sort((a,b)=>a.f.localeCompare(b.f));
  return `<b>${hits.length} ${hits.length>1?'activities':'activity'} finishing ${label}:</b><br>`+
    hits.slice(0,15).map(h=>`· ${esc(h.label)} — ${esc(h.act)} (${fmtDMY(h.f)}${h.p?`, ${h.p}%`:''})`).join('<br>');
}

// Behind schedule: an activity whose finish date has passed but %<100 (or start passed and still 0%)
function answerBehind(D){
  const today=todayISO(); const hits=[];
  (D.pins||[]).forEach(p=>{
    const acts=activitiesFor(p.sched||p.label, D);
    acts.forEach(a=>{
      const pc=Number(a.p)||0;
      if(a.f && a.f<today && pc<100){ hits.push({label:p.label, act:a.a, f:a.f, p:pc, over:true}); }
    });
  });
  if(!hits.length) return `Good news — nothing looks behind schedule based on finish dates. 👍`;
  hits.sort((a,b)=>a.f.localeCompare(b.f));
  return `<b>${hits.length} ${hits.length>1?'activities':'activity'} running behind</b> (past finish date, under 100%):<br>`+
    hits.slice(0,15).map(h=>`· ${esc(h.label)} — ${esc(h.act)} (due ${fmtDMY(h.f)}, ${h.p}%)`).join('<br>');
}
// Ahead / on track: activities at 100% before their finish date, or live and on pace
function answerAhead(D){
  const today=todayISO(); const done=[];
  (D.pins||[]).forEach(p=>{
    const acts=activitiesFor(p.sched||p.label, D);
    acts.forEach(a=>{ const pc=Number(a.p)||0; if(pc>=100 && a.f && a.f>=today){ done.push({label:p.label, act:a.a, f:a.f}); } });
  });
  if(!done.length) return `Nothing is notably ahead right now — most fronts are tracking to their dates.`;
  return `<b>${done.length} ${done.length>1?'activities':'activity'} already complete ahead of the finish date:</b><br>`+
    done.slice(0,15).map(h=>`· ${esc(h.label)} — ${esc(h.act)} (was due ${fmtDMY(h.f)})`).join('<br>');
}
// Fronts with NO crew logged
function answerNoCrew(D){
  const live=[], idle=[];
  (D.pins||[]).forEach(p=>{
    const t=crewTotalFor(p.id,D); const st=statusOf(p,D);
    if(t===0){ if(st.state==='live') live.push(p.label); else idle.push(p.label); }
  });
  if(!live.length && !idle.length) return `Every front has crew logged. 👍`;
  let out='';
  if(live.length){ out+=`<b>⚠️ ${live.length} LIVE front${live.length>1?'s':''} with no crew logged:</b><br>`+live.slice(0,12).map(l=>'· '+esc(l)).join('<br>'); }
  if(idle.length){ if(out)out+='<br><br>'; out+=`<b>${idle.length} other front${idle.length>1?'s':''} with no crew</b> (not currently live):<br>`+idle.slice(0,8).map(l=>'· '+esc(l)).join('<br>'); }
  return out;
}
// Whole-project progress
function answerProgress(D){
  let all=[];
  Object.values(D.schedule||{}).forEach(acts=>all=all.concat(acts));
  Object.values(D.demoSchedule||{}).forEach(acts=>all=all.concat(acts));
  if(!all.length) return `I don't have schedule data loaded to work out overall progress.`;
  const avg=Math.round(all.reduce((s,a)=>s+(Number(a.p)||0),0)/all.length);
  const done=all.filter(a=>(Number(a.p)||0)>=100).length;
  const live=all.filter(a=>{const p=Number(a.p)||0;return p>0&&p<100;}).length;
  return `<b>Overall project progress: ${avg}%</b><br>${done} activities complete · ${live} in progress · ${all.length} total`;
}

// ============================================================
//  ARDY'S PERSONALITY  — friendly Aussie site-mate
// ============================================================
const BOT_NAME = "Ardy";
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

// time-aware greeting
function timeGreeting(){
  const h=new Date().getHours();
  if(h<12) return pick(["Mornin'","G'day","Morning, mate"]);
  if(h<17) return pick(["G'day","Arvo","Hey there"]);
  return pick(["Evenin'","G'day","Hey mate"]);
}

// natural lead-ins to sprinkle before answers (used sparingly)
const LEADS_OK=["No worries — ","Righto, ","Too easy — ","Sure thing — ",""];
const LEADS_GOOD=["Good news — ","She's looking alright — ","Not bad — "];

// Small-talk / chit-chat handling. Returns a reply string, or null if not small talk.
// Small-talk / chit-chat. Takes (low, raw, mem) — mem carries the known name.
// Returns {text, learnName?} or null if not small talk.
function smallTalk(low, raw, mem){
  raw = raw || low;
  mem = mem || {};
  const name = mem.name || '';
  const heyName = name ? `, ${name}` : '';

  // ---- NAME CAPTURE: "I'm Ganesh", "my name is Dave", "this is Johnno", "it's Macca" ----
  const nameMatch = raw.match(/\b(?:i'?m|i am|my name'?s?|my name is|name is|this is|it'?s|call me)\s+([A-Z][a-z]+|[a-z]{2,})\b/i);
  if(nameMatch){
    let n = nameMatch[1];
    // ignore if it's actually a state word ("i'm live", "i'm good", "i'm here")
    const notNames = ['good','fine','ok','okay','here','live','busy','tired','back','done','ready','right','sure','keen','off','on','out','well','great','alright','knackered','buggered','stuffed','sweet','set'];
    if(!notNames.includes(n.toLowerCase())){
      n = n.charAt(0).toUpperCase()+n.slice(1).toLowerCase();
      return { text: pick([
        `G'day ${n}! Good to meet ya 👋 I'm ${BOT_NAME}, your site offsider. What can I sort out for ya?`,
        `${n}! Righto, I'll remember that. I'm ${BOT_NAME} — ask us what's live, who's on site, or when something's coming down.`,
        `Nice one, ${n}. I'm ${BOT_NAME}. What're ya chasing — schedule, crew, or what's finishing this week?`
      ]), learnName:n };
    }
  }
  // "what's my name?" / "do you know me?"
  if(/\b(what'?s my name|who am i|do you know me|remember me|my name)\b/.test(low)){
    return { text: name ? `Course I do — you're ${name}! 😄 What can I do for ya?` : `Don't think ya told me yet, mate. Say “I'm [your name]” and I'll remember it.` };
  }

  // ---- GREETINGS ----
  if(/^(hi+|hey+|hello+|yo+|gday|g'day|howdy|hiya|heya|oi|sup|wassup|whats up|what's up|morning|mornin|arvo|evening|evenin)\b/.test(low) || /^good (morning|mornin|arvo|afternoon|evening|evenin|day)/.test(low)){
    return { text: `${timeGreeting()}${heyName}! I'm ${BOT_NAME}, your site offsider. Ask us what's live, who's on site, when something's coming down, or what's finishing this week. What're ya after?` };
  }
  // ---- HOW ARE YOU ----
  if(/how('?s| is| are|zit| ya)?\s*(you|going|it going|things|ya|is it going|we going|everything)|how ya going|you good|hows things|how's tricks|you right/.test(low)){
    return { text: pick([
      `Yeah good${heyName} — no dramas. Boards are humming along. What can I do for ya?`,
      `Can't complain! Keeping an eye on the schedule for ya. What do you need?`,
      `All good here${heyName}. Ready when you are — what're we looking at?`,
      `Flat out like a lizard drinkin', but always got time for you. What's up?`
    ]) };
  }
  // ---- HOW'S THE USER / feelings ----
  if(/\b(i'?m (good|great|fine|alright|ok|okay|well|sweet|keen))\b/.test(low)){
    return { text: pick([`Good to hear${heyName}! What can I help with?`,`Ripper. What're ya after?`,`Beauty. Let's get into it — what do ya need?`]) };
  }
  if(/\b(i'?m (tired|knackered|buggered|stuffed|exhausted|over it|done|busy|flat out|slammed))\b/.test(low)){
    return { text: pick([`Ha, long day on the tools eh? I'll keep it quick${heyName}. What do ya need?`,`Fair enough — I'll make it easy. What're ya after?`,`Big day by the sounds. Give us a question and I'll sort it fast.`]) };
  }
  // ---- THANKS ----
  if(/\b(thanks|thank you|thankyou|cheers|ta|nice one|good on ya|legend|champion|appreciate|thx|ty|much appreciated)\b/.test(low)){
    return { text: pick([`No worries at all${heyName} 👍`,`Too easy, mate.`,`Anytime! Give us a yell if you need owt else.`,`She's right — happy to help.`,`No dramas${heyName}. What else?`]) };
  }
  // ---- WHO/WHAT ARE YOU ----
  if(/\b(who are you|what are you|your name|who r u|who's this|whats your name|what's your name|introduce yourself)\b/.test(low)){
    return { text: `I'm ${BOT_NAME} — your assistant for the 269-ARD job 👷 I read straight off the live schedule and crew boards. Ask me things like:<br>· <i>“What's live right now?”</i><br>· <i>“When's B-1203 coming down?”</i><br>· <i>“What's finishing this week?”</i><br>· <i>“Which fronts have no crew?”</i><br>Just ask like you'd ask a mate.` };
  }
  // ---- WHAT CAN YOU DO / HELP ----
  if(/\b(what can you do|what do you do|help me|need help|how do you work|how does this work|what should i ask|options|commands)\b/.test(low)){
    return { text: `Plenty${heyName}! I can tell ya:<br>· <b>What's live / on hold / scheduled</b><br>· <b>When a structure's coming down</b> (e.g. “when's B-1501 due?”)<br>· <b>What's finishing this week or next</b><br>· <b>What's behind schedule</b><br>· <b>Which fronts have no crew</b><br>· <b>How many on site today</b><br>· <b>Overall project progress</b><br>Give any of 'em a burl.` };
  }
  // ---- JOKES ----
  if(/\b(joke|funny|make me laugh|cheer me up|tell me something|got any jokes)\b/.test(low)){
    return { text: pick([
      `Why don't scaffolders ever get lost? They always know the right levels to be on. 😄`,
      `What did the excavator say to the dump truck? “You've got a lotta baggage, mate.” 🚛`,
      `Why'd the asbestos removalist bring a ladder? Heard the job had a high ceiling. 😂`,
      `How does a demo crew say sorry? They bring the house down… then knock it down. 🏗️`,
      `I'd tell ya a concrete joke but it's still setting. Give us a bit. 😏`,
      `Why don't cranes ever panic? They keep everything on the level. 🏗️`
    ]) };
  }
  // ---- WEATHER (deflect, no data) ----
  if(/\b(weather|rain|raining|hot|cold|windy|forecast|temperature|sunny|storm)\b/.test(low) && !/\b(front|structure|b-?\d)\b/.test(low)){
    return { text: `Ha, I'm no weatherman${heyName} — best check ya phone for that. But I can tell ya what's happening on the boards. What're ya after?` };
  }
  // ---- TIME / DATE ----
  if(/\b(what time|what's the time|the time|what day|what'?s the date|today'?s date|what date)\b/.test(low)){
    const now=new Date();
    const ds=now.toLocaleDateString('en-AU',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
    const ts=now.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'});
    return { text: `It's ${ts} on ${ds}${heyName}. Now, what can I find ya on the job?` };
  }
  // ---- BYE ----
  if(/^(bye|see ya|cya|later|catch ya|catchya|gotta go|goodbye|seeya|hooroo|off i go|knock off|heading off)\b/.test(low)){
    return { text: pick([`Catch ya${heyName}! 👋`,`See ya round. Stay safe out there.`,`Righto — give us a yell anytime.`,`Hooroo${heyName}! Have a good one.`]) };
  }
  // ---- COMPLIMENTS / BANTER ----
  if(/\b(good bot|nice bot|smart|clever|love it|awesome|deadset|ripper|beauty|you'?re good|you'?re great|good work|well done|top stuff|bloody good)\b/.test(low)){
    return { text: pick([`Ha, cheers${heyName} 😄 Just doing me job.`,`Deadset appreciate it. What's next?`,`Too kind — now what can I find ya?`,`🙏 Ya legend. What else can I dig up?`]) };
  }
  // ---- INSULTS / FRUSTRATION (stay friendly) ----
  if(/\b(useless|stupid|dumb|wtf|crap|rubbish|not working|broken|hopeless|garbage|shit|suck|terrible|worst)\b/.test(low)){
    return { text: `Fair enough${heyName} — sorry if I missed it. I'm best with schedule and crew questions. Try “what's live?” or “when's B-1501 coming down?” and I'll sort ya out.` };
  }
  // ---- ARE YOU AI ----
  if(/\b(are you (a )?(robot|bot|ai|human|real|person)|is this ai|are you real|you a bot)\b/.test(low)){
    return { text: `Bit of both${heyName} — I'm a helper that reads your project data. Not a real bloke, but I'll do me best to sound like one 😄 What do you need?` };
  }
  // ---- LOVE / MARRY / silly ----
  if(/\b(i love you|marry me|will you be my|do you love me)\b/.test(low)){
    return { text: `Steady on${heyName} 😄 I'm flattered, but I'm married to the schedule. Speaking of which — what do ya need?` };
  }
  // ---- YES/NO/OK on their own (acknowledge) ----
  if(/^(yes|yeah|yep|yup|nah|no|nope|ok|okay|righto|cool|sweet|sure|k)\.?$/.test(low)){
    return { text: pick([`Righto${heyName} — fire away whenever.`,`👍 What's next?`,`Sweet. Ask us anything about the job.`]) };
  }
  // ---- SORRY ----
  if(/^(sorry|my bad|oops|whoops)\b/.test(low)){
    return { text: pick([`All good${heyName}, no need to be sorry! What can I do?`,`No dramas at all. What're ya after?`]) };
  }
  // ---- SWEARING HELLO (aussie) ----
  if(/^(oi mate|oi ardy|yo ardy|ardy)\b/.test(low)){
    return { text: `${timeGreeting()}${heyName}! Right here. What do ya need?` };
  }
  return null;
}

// Wrap a data answer with a light natural lead-in sometimes (not every time).
function warmify(text, kind){
  if(Math.random()<0.55){
    const lead = kind==='good' ? pick(LEADS_GOOD) : pick(LEADS_OK);
    return lead+text;
  }
  return text;
}

// ---- intent handlers ----
function answerWhen(pin, D){
  const acts=activitiesFor(pin.sched||pin.label, D);
  if(!acts.length) return `I don't have scheduled dates for <b>${esc(pin.label)}</b> yet.`;
  const sorted=[...acts].filter(a=>a.s&&a.f).sort((a,b)=>a.s.localeCompare(b.s));
  if(!sorted.length) return `I don't have dates for <b>${esc(pin.label)}</b> yet.`;
  const first=sorted[0], last=sorted[sorted.length-1];
  const st=statusOf(pin,D);
  // find a "demolish"/"remove asbestos" type activity if present
  const key=sorted.find(a=>/demol|remove asbestos|induced|high reach/i.test(a.a));
  let lines=`<b>${esc(pin.label)}</b> — ${st.label}<br>`;
  lines+=`Overall window: <b>${fmtDMY(first.s)}</b> → <b>${fmtDMY(last.f)}</b><br>`;
  if(key) lines+=`${esc(key.a)}: ${fmtDMY(key.s)} → ${fmtDMY(key.f)}${key.p?` (${key.p}%)`:''}<br>`;
  // show the current/next activity
  const today=todayISO();
  const current=sorted.find(a=>a.s<=today&&today<=a.f);
  const next=sorted.find(a=>a.s>today);
  if(current) lines+=`<span style="color:var(--live,#34D399)">Right now: ${esc(current.a)} (${current.p||0}%)</span>`;
  else if(next) lines+=`Next up: ${esc(next.a)} on ${fmtDMY(next.s)}`;
  return lines;
}
function answerStatus(which, D){
  const today=todayISO();
  const buckets={live:[],hold:[],upcoming:[],done:[]};
  (D.pins||[]).forEach(p=>{ const s=statusOf(p,D); if(buckets[s.state]) buckets[s.state].push(p.label); });
  const map={live:'live right now',hold:'on hold',upcoming:'scheduled (not started)',done:'finished'};
  if(which && buckets[which]){
    const list=buckets[which];
    if(!list.length) return `Nothing is ${map[which]} at the moment.`;
    return `<b>${list.length} ${which==='live'?'front'+(list.length>1?'s':''):'item'+(list.length>1?'s':'')} ${map[which]}:</b><br>`+list.map(l=>'· '+esc(l)).join('<br>');
  }
  // overview of all
  let out='<b>Board status right now:</b><br>';
  out+=`🟢 Live: ${buckets.live.length} &nbsp; 🟡 On hold: ${buckets.hold.length} &nbsp; 🔵 Scheduled: ${buckets.upcoming.length} &nbsp; ⚪ Finished: ${buckets.done.length}<br>`;
  if(buckets.live.length) out+='<br><b>Live fronts:</b><br>'+buckets.live.slice(0,10).map(l=>'· '+esc(l)).join('<br>');
  return out;
}
function answerCrew(D){
  let total=0; const perFront=[]; const perTrade={demolition:0,asbestos:0,scaffolding:0,subcontractor:0};
  (D.pins||[]).forEach(p=>{
    const t=crewTotalFor(p.id,D);
    if(t>0){ total+=t; perFront.push([p.label,t]);
      const log=D.crewLog[p.id]; TRADES.forEach(([k])=>perTrade[k]+=(Number(log.crew[k])||0)); }
  });
  // daily activities people
  let dailyPeople=0;
  if(D.daily&&D.daily.entries) dailyPeople=D.daily.entries.reduce((s,e)=>s+(Number(e.count)||0),0);
  const grand=total+dailyPeople;
  if(grand===0) return `No crew logged on the board yet today. Log crew on a front or add them in Daily Activities.`;
  let out=`<b>${grand} people on site today</b>`;
  if(dailyPeople) out+=` <span style="color:var(--muted,#888)">(${total} on fronts + ${dailyPeople} general/plant)</span>`;
  out+='<br>';
  const parts=TRADES.filter(([k])=>perTrade[k]>0).map(([k,l])=>`${perTrade[k]} ${l}`);
  if(parts.length) out+=parts.join(' · ')+'<br>';
  if(perFront.length){ out+='<br><b>By front:</b><br>'+perFront.sort((a,b)=>b[1]-a[1]).slice(0,10).map(([l,t])=>`· ${esc(l)}: ${t}`).join('<br>'); }
  return out;
}

// ---- main router ----
// ctx = { lastPin, lastIntent, mem } carried between turns; mem persists learned facts (name etc.)
export function askBot(qRaw, D, ctx){
  ctx = ctx || {};
  const mem = ctx.mem || {};
  const q=(qRaw||'').trim();
  if(!q) return {text:"What're ya after, mate? Try “what's live?” or “when's B-1203 coming down?”"};
  const low=q.toLowerCase();
  const today=todayISO();

  // 0) small talk / chit-chat first (handles greetings, name capture, jokes, etc.)
  const stalk=smallTalk(low, q, mem);
  if(stalk){
    const out={text:stalk.text, smalltalk:true};
    if(stalk.learnName) out.learnName=stalk.learnName;
    return out;
  }

  // 1) context follow-ups: "what about next week?", "and this week?", "how many on it?"
  if(/^(what about|how about|and)\b/.test(low) || /^(next week|this week)\??$/.test(low)){
    if(/next week/.test(low)){ const from=addDays(endOfWeek(today),1),to=addDays(endOfWeek(today),7);
      return {text:warmify(answerFinishing(D,from,to,'next week')), intent:'finishing'}; }
    if(/this week/.test(low)) return {text:warmify(answerFinishing(D,today,endOfWeek(today),'this week')), intent:'finishing'};
    if(/behind|late|overdue/.test(low)) return {text:warmify(answerBehind(D)), intent:'behind'};
  }
  // "how many on it / on that / crew there" -> crew on the last-mentioned structure
  if(ctx.lastPin && /\b(how many|crew|people|on it|on that|on there|blokes|men)\b/.test(low)){
    const p=(D.pins||[]).find(x=>x.id===ctx.lastPin);
    if(p){ const t=crewTotalFor(p.id,D);
      return {text: t>0 ? `<b>${esc(p.label)}</b> has <b>${t}</b> logged on it right now.` : `Nobody's logged on <b>${esc(p.label)}</b> just yet.`, lastPin:p.id, intent:'crew'}; }
  }

  // 2) whole-project progress
  if(/\b(overall|whole project|project|total|the job|everything)\b/.test(low) && /\b(progress|percent|percentage|%|complete|how far|how's it going|hows it going|going)\b/.test(low)){
    return {text:warmify(answerProgress(D),'good'), intent:'progress'};
  }
  // behind schedule
  if(/\b(behind|late|overdue|slipping|delayed|running behind|slippage)\b/.test(low)){
    return {text:warmify(answerBehind(D)), intent:'behind'};
  }
  // ahead / on track
  if(/\b(ahead|on track|early|ahead of schedule|tracking well)\b/.test(low)){
    return {text:warmify(answerAhead(D),'good'), intent:'ahead'};
  }
  // finishing this/next week
  if(/\b(finish|finishing|done|complete|completing|wrapping|wrap up|ending|coming off|knock over)\b/.test(low) && /\b(week|7 days|this week|next week)\b/.test(low)){
    if(/next week/.test(low)){ const from=addDays(endOfWeek(today),1),to=addDays(endOfWeek(today),7);
      return {text:warmify(answerFinishing(D,from,to,'next week')), intent:'finishing'}; }
    return {text:warmify(answerFinishing(D,today,endOfWeek(today),'this week')), intent:'finishing'};
  }
  // fronts with no crew
  if(/\b(no crew|without crew|no one|nobody|empty|unmanned|need crew|needs crew|missing crew|short|shorthanded)\b/.test(low) ||
     (/\bcrew\b/.test(low) && /\b(no|without|missing|need)\b/.test(low))){
    return {text:warmify(answerNoCrew(D)), intent:'nocrew'};
  }
  // crew intent (general)
  if(/\b(crew|people|men|workers|how many|on site|manpower|labour|labor|blokes|lads|bodies)\b/.test(low) && !/when|date|schedul/.test(low)){
    return {text:warmify(answerCrew(D)), intent:'crew'};
  }
  // A specific structure named?
  const pin=findPinByText(q,D);
  if(pin){
    return {text:warmify(answerWhen(pin,D)), lastPin:pin.id, intent:'when'};
  }
  // status intent (no specific structure)
  if(/\b(live|on hold|onhold|hold|scheduled|status|whats on|what's on|going on|active|right now|today|upcoming|finished|done|happening)\b/.test(low)){
    let which=null;
    if(/\blive\b|active|right now|going on|happening/.test(low)) which='live';
    else if(/hold/.test(low)) which='hold';
    else if(/schedul|upcoming|not started/.test(low)) which='upcoming';
    else if(/finish|done|complete/.test(low)) which='done';
    return {text:warmify(answerStatus(which,D)), intent:'status'};
  }
  // friendly fallback
  return {text:pick([
      `Hmm, not quite sure I follow that one, mate. `,
      `Yeah, ya got me there — not sure on that one. `,
      `Sorry mate, didn't quite catch that. `
    ])+`I'm best with schedule and crew stuff. Give one of these a burl:<br>· <i>“What's live right now?”</i><br>· <i>“When's B-1203 coming down?”</i><br>· <i>“What's finishing this week?”</i><br>· <i>“Which fronts have no crew?”</i>`, fallback:true, unmatched:q};
}

// ---- UI ----
export function mountChatbot(opts){
  const getData = opts.getData || (()=>({}));
  const suggestions = opts.suggestions || ["What's finishing this week?", "What's behind schedule?", "Which fronts have no crew?", "How many crew on site?"];

  const wrap=document.createElement('div'); wrap.id='ardbot';
  wrap.innerHTML=`
    <button class="ardbot-fab" id="ardbotFab" title="Ask Ardy">
      <span class="ardbot-orb" id="ardbotOrb">
        <span class="orb-blob b1"></span>
        <span class="orb-blob b2"></span>
        <span class="orb-blob b3"></span>
        <span class="orb-core"></span>
      </span>
    </button>
    <div class="ardbot-panel" id="ardbotPanel">
      <div class="ardbot-head">
        <div class="ardbot-title"><span class="ardbot-miniorb" id="ardbotMiniOrb"><span class="mo-blob m1"></span><span class="mo-blob m2"></span><span class="mo-core"></span></span> Ardy · site offsider</div>
        <button class="ardbot-close" id="ardbotClose">×</button>
      </div>
      <div class="ardbot-body" id="ardbotBody"></div>
      <div class="ardbot-suggest" id="ardbotSuggest"></div>
      <div class="ardbot-input">
        <input type="text" id="ardbotInput" placeholder="Ask us anything about the job…" autocomplete="off">
        <button id="ardbotSend">➤</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const style=document.createElement('style');
  style.textContent=`
  #ardbot{--b-acc:#7C5CFF;--b-acc2:#22D3EE;}
  .ardbot-fab{position:fixed;bottom:22px;right:22px;width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;z-index:9998;
    background:linear-gradient(135deg,#7C5CFF,#22D3EE);box-shadow:0 8px 30px rgba(124,92,255,.5);color:#fff;font-size:26px;
    display:flex;align-items:center;justify-content:center;transition:transform .25s, box-shadow .25s;}
  .ardbot-fab:hover{transform:translateY(-3px) scale(1.05);box-shadow:0 12px 40px rgba(124,92,255,.65);}
  .ardbot-fab::after{content:'';position:absolute;inset:0;border-radius:50%;background:linear-gradient(135deg,#7C5CFF,#22D3EE);animation:ardbotpulse 2.4s infinite;z-index:-1;}
  @keyframes ardbotpulse{0%{opacity:.5;transform:scale(1);}100%{opacity:0;transform:scale(1.7);}}
  .ardbot-fab.open .ardbot-fab-icon{transform:rotate(90deg) scale(.9);}
  .ardbot-fab-icon{transition:transform .3s;}

  /* ===== SIRI-STYLE AURORA ORB ===== */
  .ardbot-orb{position:relative;width:38px;height:38px;border-radius:50%;overflow:hidden;display:block;
    box-shadow:inset 0 0 10px rgba(255,255,255,.25);}
  .orb-blob{position:absolute;border-radius:50%;filter:blur(6px);mix-blend-mode:screen;opacity:.95;}
  .orb-blob.b1{width:30px;height:30px;background:radial-gradient(circle,#7C5CFF,transparent 70%);top:2px;left:0px;animation:orbFloat1 3.2s ease-in-out infinite;}
  .orb-blob.b2{width:26px;height:26px;background:radial-gradient(circle,#22D3EE,transparent 70%);top:6px;left:12px;animation:orbFloat2 2.8s ease-in-out infinite;}
  .orb-blob.b3{width:22px;height:22px;background:radial-gradient(circle,#F472B6,transparent 70%);top:12px;left:4px;animation:orbFloat3 3.6s ease-in-out infinite;}
  .orb-core{position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle at 50% 45%,rgba(255,255,255,.35),transparent 55%);}
  @keyframes orbFloat1{0%,100%{transform:translate(0,0) scale(1);}33%{transform:translate(6px,4px) scale(1.15);}66%{transform:translate(-4px,6px) scale(.9);}}
  @keyframes orbFloat2{0%,100%{transform:translate(0,0) scale(1);}33%{transform:translate(-6px,4px) scale(.9);}66%{transform:translate(4px,-4px) scale(1.2);}}
  @keyframes orbFloat3{0%,100%{transform:translate(0,0) scale(1);}50%{transform:translate(6px,-6px) scale(1.15);}}
  /* thinking state — waves speed up + brighten */
  .ardbot-fab.thinking .orb-blob.b1{animation-duration:1s;}
  .ardbot-fab.thinking .orb-blob.b2{animation-duration:.85s;}
  .ardbot-fab.thinking .orb-blob.b3{animation-duration:1.15s;}
  .ardbot-fab.thinking .ardbot-orb{box-shadow:inset 0 0 12px rgba(255,255,255,.5),0 0 18px rgba(124,92,255,.6);}

  /* mini orb in header */
  .ardbot-miniorb{position:relative;width:16px;height:16px;border-radius:50%;overflow:hidden;display:inline-block;vertical-align:middle;}
  .mo-blob{position:absolute;border-radius:50%;filter:blur(3px);mix-blend-mode:screen;}
  .mo-blob.m1{width:14px;height:14px;background:radial-gradient(circle,#7C5CFF,transparent 70%);top:0;left:0;animation:orbFloat1 3s ease-in-out infinite;}
  .mo-blob.m2{width:12px;height:12px;background:radial-gradient(circle,#22D3EE,transparent 70%);top:3px;left:5px;animation:orbFloat2 2.6s ease-in-out infinite;}
  .mo-core{position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle at 50% 45%,rgba(255,255,255,.4),transparent 55%);}
  .ardbot-miniorb.thinking .mo-blob.m1{animation-duration:.9s;} .ardbot-miniorb.thinking .mo-blob.m2{animation-duration:.75s;}
  .ardbot-panel{position:fixed;bottom:94px;right:22px;width:370px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 130px);
    background:rgba(16,18,26,.92);backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,.12);border-radius:20px;z-index:9998;
    display:flex;flex-direction:column;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.55);
    opacity:0;transform:translateY(20px) scale(.96);pointer-events:none;transition:opacity .28s cubic-bezier(.2,.9,.25,1),transform .28s cubic-bezier(.2,.9,.25,1);transform-origin:bottom right;}
  :root[data-theme="light"] .ardbot-panel{background:rgba(255,255,255,.95);border-color:rgba(20,30,60,.12);color:#161A22;}
  .ardbot-panel.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;}
  .ardbot-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08);
    background:linear-gradient(135deg,rgba(124,92,255,.18),rgba(34,211,238,.12));}
  .ardbot-title{font-family:'Sora',sans-serif;font-weight:600;font-size:14px;color:#EEF1F6;display:flex;align-items:center;gap:8px;}
  :root[data-theme="light"] .ardbot-title{color:#161A22;}
  .ardbot-dot{width:8px;height:8px;border-radius:50%;background:#34D399;box-shadow:0 0 8px #34D399;animation:ardbotdot 1.5s infinite;}
  @keyframes ardbotdot{50%{opacity:.4;}}
  .ardbot-close{background:none;border:none;color:#8B93A7;font-size:22px;cursor:pointer;line-height:1;}
  .ardbot-close:hover{color:#EEF1F6;}
  :root[data-theme="light"] .ardbot-close:hover{color:#161A22;}
  .ardbot-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;}
  .ardbot-msg{max-width:88%;padding:10px 13px;border-radius:14px;font-size:13.5px;line-height:1.55;font-family:'Inter',sans-serif;}
  .ardbot-msg.bot{align-self:flex-start;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);color:#EEF1F6;border-bottom-left-radius:4px;}
  :root[data-theme="light"] .ardbot-msg.bot{background:rgba(20,30,60,.05);border-color:rgba(20,30,60,.1);color:#161A22;}
  .ardbot-msg.user{align-self:flex-end;background:linear-gradient(135deg,#7C5CFF,#22D3EE);color:#fff;border-bottom-right-radius:4px;}
  .ardbot-msg b{font-weight:600;}
  .ardbot-suggest{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px;}
  .ardbot-chip{font-size:11.5px;padding:6px 11px;border-radius:16px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#8B93A7;cursor:pointer;transition:.18s;font-family:'Inter',sans-serif;}
  .ardbot-chip:hover{color:#EEF1F6;border-color:#22D3EE;}
  :root[data-theme="light"] .ardbot-chip{color:#5A6478;border-color:rgba(20,30,60,.14);}
  .ardbot-input{display:flex;gap:8px;padding:12px 14px;border-top:1px solid rgba(255,255,255,.08);}
  .ardbot-input input{flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px 13px;color:#EEF1F6;font-size:13.5px;font-family:'Inter',sans-serif;}
  :root[data-theme="light"] .ardbot-input input{background:rgba(20,30,60,.04);border-color:rgba(20,30,60,.14);color:#161A22;}
  .ardbot-input input:focus{outline:none;border-color:#22D3EE;}
  .ardbot-input button{background:linear-gradient(135deg,#7C5CFF,#22D3EE);border:none;color:#fff;width:42px;border-radius:12px;cursor:pointer;font-size:15px;}
  .ardbot-typing{align-self:flex-start;display:flex;align-items:center;gap:3px;padding:14px 16px;height:20px;}
  .ardbot-typing span{width:3px;border-radius:3px;background:linear-gradient(180deg,#7C5CFF,#22D3EE);animation:ardbotwave 1s ease-in-out infinite;}
  .ardbot-typing span:nth-child(1){height:8px;animation-delay:0s;}
  .ardbot-typing span:nth-child(2){height:16px;animation-delay:.15s;}
  .ardbot-typing span:nth-child(3){height:22px;animation-delay:.3s;}
  .ardbot-typing span:nth-child(4){height:16px;animation-delay:.45s;}
  .ardbot-typing span:nth-child(5){height:10px;animation-delay:.6s;}
  .ardbot-typing span:nth-child(6){height:18px;animation-delay:.3s;}
  .ardbot-typing span:nth-child(7){height:8px;animation-delay:.15s;}
  @keyframes ardbotwave{0%,100%{transform:scaleY(.4);opacity:.5;}50%{transform:scaleY(1);opacity:1;}}
  @keyframes ardbottype{0%,60%,100%{transform:translateY(0);opacity:.4;}30%{transform:translateY(-5px);opacity:1;}}
  @media(max-width:480px){.ardbot-panel{width:calc(100vw - 24px);right:12px;bottom:88px;height:65vh;}.ardbot-fab{right:16px;bottom:16px;}}
  `;
  document.head.appendChild(style);

  const fab=document.getElementById('ardbotFab');
  const panel=document.getElementById('ardbotPanel');
  const body=document.getElementById('ardbotBody');
  const input=document.getElementById('ardbotInput');
  const sugWrap=document.getElementById('ardbotSuggest');
  let opened=false;

  function addMsg(html, who){
    const m=document.createElement('div'); m.className='ardbot-msg '+who; m.innerHTML=html; body.appendChild(m);
    body.scrollTop=body.scrollHeight; return m;
  }
  const miniOrb=document.getElementById('ardbotMiniOrb');
  function setThinking(on){
    fab.classList.toggle('thinking',on);
    if(miniOrb) miniOrb.classList.toggle('thinking',on);
  }
  function typing(){ const t=document.createElement('div'); t.className='ardbot-typing'; t.innerHTML='<span></span><span></span><span></span><span></span><span></span><span></span><span></span>'; body.appendChild(t); body.scrollTop=body.scrollHeight; setThinking(true); return t; }
  function stopTyping(t){ if(t) t.remove(); setThinking(false); }

  function renderSuggestions(){
    sugWrap.innerHTML='';
    suggestions.forEach(s=>{ const c=document.createElement('button'); c.className='ardbot-chip'; c.textContent=s; c.onclick=()=>submit(s); sugWrap.appendChild(c); });
  }

  let pendingTeach=null; // {alias} awaiting the user to pick which structure
  let ctx={ mem: (opts.profile && opts.profile.mem) ? opts.profile.mem : {} };  // conversation memory + learned facts (name)

  function submit(text){
    text=(text||input.value).trim(); if(!text) return;
    addMsg(esc(text),'user'); input.value='';

    // If we're mid-teaching (user was asked "which structure did you mean?")
    if(pendingTeach){
      const D=getData();
      const pin=findPinByText(text, D) || (D.pins||[]).find(p=>p.label.toLowerCase().includes(text.toLowerCase()));
      if(pin){
        const alias=pendingTeach.alias;
        pendingTeach=null;
        if(opts.onLearn){ opts.onLearn(alias, pin.id); }
        const t=typing();
        setTimeout(()=>{ stopTyping(t); addMsg(`Got it 👍 I'll remember that <b>“${esc(alias)}”</b> means <b>${esc(pin.label)}</b> from now on.`,'bot'); }, 400);
      } else {
        addMsg(`I still can't find that one. Try the exact tag like <b>B-1203</b>, or type “cancel”.`,'bot');
        if(/cancel|nevermind|never mind/i.test(text)) pendingTeach=null;
      }
      return;
    }

    const t=typing();
    setTimeout(()=>{
      stopTyping(t);
      let ans; try{ ans=askBot(text, getData(), ctx); }catch(e){ ans={text:"Sorry mate, something went sideways reading the data. Give it another go?"}; console.error(e); }
      // remember context for follow-up questions
      if(ans.lastPin) ctx.lastPin=ans.lastPin;
      if(ans.intent) ctx.intent=ans.intent;
      // learning: remember the person's name + log the question for pattern-learning
      if(ans.learnName){ ctx.mem.name=ans.learnName; }
      if(ans.intent && ans.intent!=='smalltalk'){ ctx.mem.asks = ctx.mem.asks||{}; ctx.mem.asks[ans.intent]=(ctx.mem.asks[ans.intent]||0)+1; }
      if(opts.onProfile){ try{ opts.onProfile({ mem: ctx.mem }); }catch(e){} }
      addMsg(ans.text,'bot');
      // If it couldn't match and the user CAN teach, offer to learn a nickname.
      if(ans.fallback && ans.unmatched && opts.canTeach){
        // extract a likely nickname (the noun-ish words)
        const guess=ans.unmatched.replace(/\b(when|is|the|what|whats|what's|coming|down|scheduled|schedule|on|at|for|how|many|crew|due|of|a|an)\b/gi,'').trim();
        if(guess.length>=2){
          pendingTeach={alias:guess};
          setTimeout(()=>addMsg(`Is <b>“${esc(guess)}”</b> a nickname for one of the fronts? If so, type the real name or tag (e.g. <b>B-1203</b>) and I'll remember it. Or type “cancel”.`,'bot'), 500);
        }
      }
    }, 400+Math.random()*300);
  }

  fab.onclick=()=>{ opened=!opened; panel.classList.toggle('open',opened); fab.classList.toggle('open',opened);
    if(opened && !body.dataset.greeted){ body.dataset.greeted='1';
      addMsg(`${timeGreeting()}! I'm Ardy, your site offsider 👷 Ask us what's live, who's on site, or when something's coming down. Tap one below to get started.`,'bot');
      renderSuggestions();
    }
    if(opened) setTimeout(()=>input.focus(),200);
  };
  document.getElementById('ardbotClose').onclick=()=>{ opened=false; panel.classList.remove('open'); fab.classList.remove('open'); };
  document.getElementById('ardbotSend').onclick=()=>submit();
  input.addEventListener('keydown',e=>{ if(e.key==='Enter') submit(); });
  // orb gently reacts while the user is typing (like Siri listening)
  let _typeGlow=null;
  input.addEventListener('input',()=>{
    if(miniOrb) miniOrb.classList.add('thinking');
    clearTimeout(_typeGlow);
    _typeGlow=setTimeout(()=>{ if(miniOrb && !fab.classList.contains('thinking')) miniOrb.classList.remove('thinking'); }, 700);
  });
}
