// Shared UI helpers: theme toggle, clock, nav, and look-ahead schedule logic. 
import { pad } from "./app-common.js"; 

// ---- THEME (day/night), persisted in localStorage ---- 
export function initTheme(){ 
  const saved = localStorage.getItem('ard-theme') || 'dark'; 
  document.documentElement.setAttribute('data-theme', saved); 
  updateThemeBtn(saved); 
} 

function updateThemeBtn(t){ 
  const b = document.getElementById('themeBtn'); 
  if(b) b.textContent = t === 'light' ? '☾' : '☀'; 
} 

export function toggleTheme(){ 
  const cur = document.documentElement.getAttribute('data-theme') || 'dark'; 
  const next = cur === 'light' ? 'dark' : 'light'; 
  document.documentElement.setAttribute('data-theme', next); 
  localStorage.setItem('ard-theme', next); 
  updateThemeBtn(next); 
} 

// ---- CLOCK ---- 
export function startClock(tEl, dEl){ 
  const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']; 
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; 
  
  function tick(){ 
    const d=new Date(); 
    if(tEl) tEl.textContent = pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds()); 
    if(dEl) dEl.textContent = days[d.getDay()]+' '+d.getDate()+' '+months[d.getMonth()]+' '+d.getFullYear(); 
  } 
  
  tick(); 
  setInterval(tick,1000); 
} 

// ---- DATE HELPERS ---- 
export function todayISO(){ 
  const d=new Date(); 
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); 
} 

export function addDaysISO(iso, n){ 
  const [y,m,d]=iso.split('-').map(Number); 
  const dt=new Date(Date.UTC(y,m-1,d)); 
  dt.setUTCDate(dt.getUTCDate()+n); 
  return dt.toISOString().slice(0,10); 
} 

export function fmtDMY(iso){ 
  if(!iso)return'—'; 
  const [y,m,d]=iso.split('-'); 
  return d+'/'+m+'/'+y.slice(2); 
} 

export function fmtDayDMY(iso){ 
  if(!iso)return'—'; 
  const [y,m,d]=iso.split('-').map(Number); 
  const dt=new Date(Date.UTC(y,m-1,d)); 
  const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; 
  return days[dt.getUTCDay()]+' '+String(d).padStart(2,'0')+'/'+String(m).padStart(2,'0'); 
} 

export function daysBetween(a,b){ 
  const pa=a.split('-').map(Number), pb=b.split('-').map(Number); 
  return Math.round((Date.UTC(pb[0],pb[1]-1,pb[2])-Date.UTC(pa[0],pa[1]-1,pa[2]))/86400000); 
} 

// ---- ACTIVITY CLASSIFICATION ---- 
export const SCAFFOLD_ACTS = new Set(['Erect Scaffold','Shrink Wrap','Dismantle Scaffold']); 
export const ASBESTOS_ACTS = new Set(['Flooring Encapsulation','Smoke Test','Remove Asbestos', 'Clearance + Remove Encapsulation','Clearance','Remove Construction Joints - Asbestos']); 

// Build a flat activity list from schedule.json, tagged by discipline, within [from,to]. 
// Returns {scaffolding:[...], asbestos:[...]} each item {structure, activity, s, f, p, status} 
export function buildLookahead(schedule, fromISO, toISO){ 
  const today = todayISO(); 
  const out = {scaffolding:[], asbestos:[]}; 
  
  for(const [structure, acts] of Object.entries(schedule)){ 
    for(const a of acts){ 
      if(!a.s || !a.f) continue; 
      
      // overlap test: activity intersects the window 
      if(a.f < fromISO || a.s > toISO) continue; 
      
      let status = 'upcoming';
      if(a.p >= 100 || a.f < today) {
          status = 'completed';
      } else if(a.s <= today && a.p > 0) {
          status = 'live';
      }
      
      const item={structure, activity:a.a, s:a.s, f:a.f, p:a.p||0, status}; 
      
      if(SCAFFOLD_ACTS.has(a.a)) out.scaffolding.push(item); 
      else if(ASBESTOS_ACTS.has(a.a)) out.asbestos.push(item); 
    } 
  } 
  
  out.scaffolding.sort((x,y)=> x.s.localeCompare(y.s) || x.structure.localeCompare(y.structure)); 
  out.asbestos.sort((x,y)=> x.s.localeCompare(y.s) || x.structure.localeCompare(y.structure)); 
  
  return out; 
}
