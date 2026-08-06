// Shared helpers: auth guard, role lookup, Firestore read/write, daily snapshots.
import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged, signInWithEmailAndPassword, signInAnonymously, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, onSnapshot, collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function pad(n){ return String(n).padStart(2,"0"); }
export function todayStr(){ const d=new Date(); return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }

// ---- AUTH ----
// Roles live in Firestore: /users/{uid} = { email, role: "editor" | "viewer" | "engineer" }
export function requireAuth(onReady){
  onAuthStateChanged(auth, async (user)=>{
    if(!user){ window.location.href = "login.html"; return; }
    // Anonymous users are always guests (read-only), no role lookup needed.
    if(user.isAnonymous){ onReady(user, "guest"); return; }
    let role = "viewer";
    try{
      const snap = await getDoc(doc(db,"users",user.uid));
      if(snap.exists() && snap.data().role) role = snap.data().role;
    }catch(e){ console.warn("role lookup failed, defaulting to viewer", e); }
    onReady(user, role);
  });
}
// Guard for pages that guests must NOT see (e.g. Reports). Redirects guests away.
export function requireNonGuest(onReady){
  requireAuth((user, role)=>{
    if(role === "guest"){ window.location.href = "index.html"; return; }
    onReady(user, role);
  });
}
export function doLogin(email, password){ return signInWithEmailAndPassword(auth, email, password); }
export function doGuestLogin(){ return signInAnonymously(auth); }
export function doLogout(){ return signOut(auth).then(()=> window.location.href="login.html"); }

// Roles allowed to edit / delete (single source of truth).
// Roles: editor (full) | engineer (edit not delete) | supervisor (scribble only) | viewer (read-only) | guest (anon read-only)
export function canEdit(role){ return role === "editor" || role === "engineer"; }
export function canDelete(role){ return role === "editor"; }
export function isReadOnly(role){ return role === "guest" || role === "viewer"; }
export function isSupervisor(role){ return role === "supervisor"; }
// Who can see the scribble pad: supervisors (to write) and editors (to review). Nobody else.
export function canSeeScribbles(role){ return role === "supervisor" || role === "editor" || role === "engineer"; }

// ---- LIVE STATE (single shared doc, updated in real time) ----
// /board/live = { positions, crewLog, statusOverrides, customPins, scheduleEdits, updatedAt, updatedBy }
const LIVE_REF = ()=> doc(db,"board","live");

export async function loadLive(){
  const snap = await getDoc(LIVE_REF());
  return snap.exists() ? snap.data() : {};
}
export function watchLive(cb){
  return onSnapshot(LIVE_REF(), (snap)=>{ cb(snap.exists()?snap.data():{}); });
}
export async function saveLive(patch, user){
  const cur = await loadLive();
  const merged = { ...cur, ...patch, updatedAt: Date.now(), updatedBy: user?user.email:"" };
  await setDoc(LIVE_REF(), merged);
}

// ---- DEMO BOARD (separate document so demolition data is independent) ----
// /demoBoard/live = same shape as board/live
const DEMO_REF = ()=> doc(db,"demoBoard","live");
export async function loadDemoLive(){
  const snap = await getDoc(DEMO_REF());
  return snap.exists() ? snap.data() : {};
}
export function watchDemoLive(cb){
  return onSnapshot(DEMO_REF(), (snap)=>{ cb(snap.exists()?snap.data():{}); });
}
export async function saveDemoLive(patch, user){
  const cur = await loadDemoLive();
  const merged = { ...cur, ...patch, updatedAt: Date.now(), updatedBy: user?user.email:"" };
  await setDoc(DEMO_REF(), merged);
}

// ---- DAILY ACTIVITIES (general resources not tied to a structure) ----
// /dailyActivities/{YYYY-MM-DD} = { entries:[{cat,name,count,hours,note}], updatedAt, updatedBy }
const DAILY_REF = (dateStr)=> doc(db,"dailyActivities",dateStr);
export async function loadDaily(dateStr){
  const snap = await getDoc(DAILY_REF(dateStr));
  return snap.exists() ? snap.data() : { entries:[] };
}
export function watchDaily(dateStr, cb){
  return onSnapshot(DAILY_REF(dateStr), (snap)=>{ cb(snap.exists()?snap.data():{entries:[]}); });
}
export async function saveDaily(dateStr, entries, user){
  await setDoc(DAILY_REF(dateStr), { entries, updatedAt:Date.now(), updatedBy:user?user.email:"" });
}

// ---- SCRIBBLES (supervisor free-text notes) ----
// /scribbles/{YYYY-MM-DD__uid} = { date, uid, author, text, status, parsed, updatedAt }
//   status: "draft" (supervisor writing) | "submitted" (ready for editor) | "approved" (editor committed)
function scribbleId(dateStr, uid){ return dateStr + "__" + uid; }
export async function saveScribble(dateStr, uid, data){
  await setDoc(doc(db,"scribbles",scribbleId(dateStr,uid)), { ...data, date:dateStr, uid, updatedAt:Date.now() }, {merge:true});
}
export async function loadScribble(dateStr, uid){
  const snap = await getDoc(doc(db,"scribbles",scribbleId(dateStr,uid)));
  return snap.exists() ? snap.data() : null;
}
export function watchScribble(dateStr, uid, cb){
  return onSnapshot(doc(db,"scribbles",scribbleId(dateStr,uid)), (snap)=>cb(snap.exists()?snap.data():null));
}
// All scribbles for a given day (editor review view)
export async function listScribbles(dateStr){
  const qs = await getDocs(collection(db,"scribbles"));
  const out=[];
  qs.forEach(d=>{ const v=d.data(); if(v.date===dateStr) out.push({id:d.id, ...v}); });
  return out;
}
export function watchScribblesForDay(dateStr, cb){
  return onSnapshot(collection(db,"scribbles"), (qs)=>{
    const out=[]; qs.forEach(d=>{ const v=d.data(); if(v.date===dateStr) out.push({id:d.id, ...v}); });
    cb(out);
  });
}

// ---- LEARNING DICTIONARY (grows from editor corrections) ----
// /parserMemory/dictionary = { people:{...}, plant:{...}, structures:{...}, corrections:[...] }
const DICT_REF = ()=> doc(db,"parserMemory","dictionary");
export async function loadDictionary(){
  const snap = await getDoc(DICT_REF());
  return snap.exists() ? snap.data() : { people:{}, plant:{}, structures:{}, aliases:{} };
}
export async function saveDictionary(dict){
  await setDoc(DICT_REF(), { ...dict, updatedAt:Date.now() });
}

// ---- ARDY LEARNING PROFILE (private per user, background) ----
// /chatHistory/{uid} = { mem:{name, asks:{}}, updatedAt }
const CHAT_REF = (uid)=> doc(db,"chatHistory",uid);
export async function loadBotProfile(uid){
  if(!uid) return { mem:{} };
  try{
    const snap = await getDoc(CHAT_REF(uid));
    return snap.exists() ? snap.data() : { mem:{} };
  }catch(e){ console.error('loadBotProfile', e); return { mem:{} }; }
}
export async function saveBotProfile(uid, mem){
  if(!uid) return;
  try{ await setDoc(CHAT_REF(uid), { mem:mem||{}, updatedAt:Date.now() }); }
  catch(e){ console.error('saveBotProfile', e); }
}

// ---- DAILY SNAPSHOTS (history for the calendar) ----
// /reports/{YYYY-MM-DD} = { date, locked, rows:[...], savedAt, savedBy }
export async function saveSnapshot(dateStr, payload){
  await setDoc(doc(db,"reports",dateStr), payload);
}
export async function loadSnapshot(dateStr){
  const snap = await getDoc(doc(db,"reports",dateStr));
  return snap.exists() ? snap.data() : null;
}
export async function listSnapshotDates(){
  const out = [];
  const qs = await getDocs(collection(db,"reports"));
  qs.forEach(d=> out.push({ date:d.id, locked:!!d.data().locked }));
  return out;
}
