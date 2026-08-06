// ============================================================
//  SCRIBBLE PARSER  (Option C: rule-based now, AI-ready later)
//  Turns free text like:
//    "Johnno + 2 lads on B-1501 asbestos 6hrs, Davo drove telehandler all day"
//  into structured draft entries:
//    - crew assigned to structures  { structure, trade, count, hours, note, people }
//    - daily activities (plant/general) { cat, name, count, hours, note }
//  Uses a learning dictionary (grown from editor corrections) to improve.
// ============================================================

// Known plant/equipment keywords (seed list; dictionary extends this)
const SEED_PLANT = ['telehandler','moxy','water cart','watercart','service truck','excavator',
  'crane','ewp','scissor lift','boom lift','loader','dozer','forklift','truck','float','skid steer'];
const TRADE_WORDS = {
  asbestos:['asbestos','asb','strip','stripping','encapsulation','removal','wrap','shrink'],
  demolition:['demo','demolition','demolish','high reach','induced','downsize','crunch','processing'],
  scaffolding:['scaffold','scaff','erect','dismantle'],
};
const SITEWIDE_WORDS = ['blending','tank farm','site wide','sitewide','general','yard','laydown','office','gate','traffic','spotter'];

function esc(s){ return String(s==null?'':s); }

// Try to find a structure tag like B-1501, D-3802, DA-4504, 27-USGP, TCC
function findStructures(text, dict){
  const hits=[];
  // pattern: optional prefix letters + digits with optional dashes  (B-1501, B1501, D-3802, 34-BRU)
  const re=/\b([A-Z]{1,3}-?\d{2,4}(?:\/\d+)*|TCC|\d{2}-[A-Z]{2,5})\b/gi;
  let m;
  while((m=re.exec(text))!==null){ hits.push(m[1].toUpperCase().replace(/\s+/g,'')); }
  // dictionary aliases (e.g. "top n tail 1" -> a structure)
  if(dict && dict.aliases){
    for(const [alias,target] of Object.entries(dict.aliases)){
      if(text.toLowerCase().includes(alias.toLowerCase())) hits.push(target);
    }
  }
  return [...new Set(hits)];
}

// Match a scribbled structure token to a real pin/schedule key
function matchStructureKey(token, allKeys){
  const t=token.toUpperCase().replace(/[^A-Z0-9]/g,'');
  // direct contains match
  let best=null;
  for(const k of allKeys){
    const kn=k.toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(kn.includes(t) || t.includes(kn.slice(-Math.min(6,kn.length)))){
      if(!best || k.length<best.length) best=k;
    }
  }
  return best; // may be null -> editor resolves
}

function findHours(seg){
  // "6hrs", "6 hr", "6h", "all day"(=8), "half day"(=4)
  if(/all day/i.test(seg)) return 8;
  if(/half day/i.test(seg)) return 4;
  const m=seg.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours)\b/i);
  return m?Number(m[1]):'';
}
function findCount(seg, dict){
  // "+2", "2 lads", "3 blokes", "x3", "3 men", a leading number
  let count=0; let people=[];
  // explicit "+N"
  const plus=seg.match(/\+\s*(\d+)/); if(plus) count+=Number(plus[1]);
  // "N lads/blokes/men/guys/workers/on"
  const n=seg.match(/\b(\d+)\s*(?:lads?|blokes?|men|guys?|workers?|people|persons?|x)\b/i);
  if(n) count+=Number(n[1]);
  // "x3"
  const x=seg.match(/\bx\s*(\d+)\b/i); if(x) count+=Number(x[1]);
  // named people: capitalised words that aren't structures/trades/plant
  const names=seg.match(/\b[A-Z][a-z]{2,}\b/g)||[];
  const known=dict&&dict.people?Object.keys(dict.people).map(s=>s.toLowerCase()):[];
  names.forEach(nm=>{
    const low=nm.toLowerCase();
    if(TRADE_WORDS.asbestos.includes(low)||TRADE_WORDS.demolition.includes(low)||TRADE_WORDS.scaffolding.includes(low)) return;
    if(SEED_PLANT.some(p=>p.includes(low))) return;
    if(['All','Day','Half','The','And','On','At','Hrs','Site'].includes(nm)) return;
    people.push(nm);
  });
  // if we found names but no explicit count, count the names (+ the person implied by the name)
  if(people.length && count===0) count=people.length;
  // "+2" plus a name = name + 2
  if(people.length && plus) count=people.length+Number(plus[1]);
  return {count:count||('') , people};
}
function findTrade(seg, dict){
  const low=seg.toLowerCase();
  for(const [trade,words] of Object.entries(TRADE_WORDS)){
    if(words.some(w=>low.includes(w))) return trade;
  }
  return null;
}
function findPlant(seg, dict){
  const low=seg.toLowerCase();
  const plantList=[...SEED_PLANT, ...(dict&&dict.plant?Object.keys(dict.plant):[])];
  for(const p of plantList){ if(low.includes(p.toLowerCase())) return p; }
  return null;
}
function findSitewide(seg){
  const low=seg.toLowerCase();
  return SITEWIDE_WORDS.find(w=>low.includes(w))||null;
}

// MAIN: parse full scribble text -> {crew:[...], daily:[...], unresolved:[...]}
export function parseScribble(text, dict, allStructureKeys){
  dict=dict||{people:{},plant:{},structures:{},aliases:{}};
  allStructureKeys=allStructureKeys||[];
  const out={crew:[], daily:[], unresolved:[]};
  if(!text||!text.trim()) return out;

  // split into segments on commas, newlines, semicolons, " and "
  const segments=text.split(/[\n,;]+|(?:\band\b)/i).map(s=>s.trim()).filter(Boolean);

  segments.forEach(seg=>{
    const structures=findStructures(seg, dict);
    const plant=findPlant(seg, dict);
    const sitewide=findSitewide(seg);
    const {count,people}=findCount(seg, dict);
    const hours=findHours(seg);
    const trade=findTrade(seg, dict);

    if(structures.length){
      // crew on a structure
      structures.forEach(tok=>{
        const key=matchStructureKey(tok, allStructureKeys);
        out.crew.push({
          rawToken:tok, structure:key||'', matched:!!key,
          trade:trade||'', count:count||1, hours:hours||'',
          people:people, note:seg
        });
        if(!key) out.unresolved.push({type:'structure', token:tok, seg});
      });
    } else if(plant){
      // plant / equipment -> daily site-wide
      out.daily.push({cat:'sitewide', name:cap(plant), count:count||1, hours:hours||'', note:seg, people});
    } else if(sitewide){
      out.daily.push({cat: trade||'sitewide', name:cap(sitewide), count:count||1, hours:hours||'', note:seg, people});
    } else if(count||people.length){
      // people mentioned but no location -> unresolved (editor assigns)
      out.daily.push({cat: trade||'sitewide', name: people.join(', ')||'Crew', count:count||people.length||1, hours:hours||'', note:seg, people});
      out.unresolved.push({type:'location', seg});
    }
    // segments with nothing parseable are ignored (editor sees raw text anyway)
  });
  return out;
}
function cap(s){ return String(s).replace(/\b\w/g,c=>c.toUpperCase()); }

// Learn from an editor correction: remember a mapping so next time it's right.
// kind: 'people' | 'plant' | 'structures' | 'aliases'
export function learnCorrection(dict, kind, key, value){
  dict=dict||{people:{},plant:{},structures:{},aliases:{}};
  if(!dict[kind]) dict[kind]={};
  dict[kind][key.toLowerCase()]=value;
  return dict;
}
