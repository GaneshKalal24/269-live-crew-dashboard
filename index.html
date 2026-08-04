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
export function canEdit(role){ return role === "editor" || role === "engineer"; }
export function canDelete(role){ return role === "editor"; }
export function isReadOnly(role){ return role === "guest" || role === "viewer"; }

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
