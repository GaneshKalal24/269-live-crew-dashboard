// Schedule model: hierarchy, tagging, status roll up and attention flags.
import { APP, TAGS, RESOURCES } from "./config.js";

// ---------- resources ----------
let RES = [...RESOURCES];
export function setResourceTypes(custom) { RES = [...RESOURCES, ...(custom || []).filter(c => c && c.key && !RESOURCES.some(r => r.key === c.key))]; }
export const resTypes = () => RES;
export function resText(res) { return RES.filter(r => res?.[r.key] > 0).map(r => `${r.label} ${res[r.key]}`).join(", "); }
export function resSum(res, kind) { return RES.reduce((a, r) => a + (r.kind === kind ? (res?.[r.key] || 0) : 0), 0); }
// add up the resources of the tasks given (only tasks that count, so packages and sub tasks are never doubled)
export function resTotals(tasks) { const out = {}; for (const t of tasks) if (t.resCounts) for (const k in t.res) out[k] = (out[k] || 0) + t.res[k]; return out; }

export const STATUSES = [
  { key: "",       label: "Not set",  short: "Not set" },
  { key: "on",     label: "On track", short: "On track" },
  { key: "risk",   label: "At risk",  short: "At risk" },
  { key: "behind", label: "Behind",   short: "Behind" },
  { key: "done",   label: "Complete", short: "Complete" }
];
const SEVERITY = { "": 0, done: 0, on: 1, risk: 2, behind: 3 };

// ---------- dates ----------
export const DAY = 86400000;
export function parseISO(s) { if (!s) return null; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
export function toISO(d) { if (!d) return ""; const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
export function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
export function daysBetween(a, b) { return Math.round((b - a) / DAY); }
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function fmtDate(s, withDay = false) {
  const d = typeof s === "string" ? parseISO(s) : s; if (!d) return "";
  return `${withDay ? WD[d.getDay()] + " " : ""}${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}
export function fmtShort(s) { const d = typeof s === "string" ? parseISO(s) : s; return d ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : ""; }
export function relDays(n) {
  if (n === 0) return "today"; if (n === 1) return "tomorrow"; if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
export function fmtMoney(v) { if (v === "" || v == null || isNaN(+v)) return ""; return "$" + Math.round(+v).toLocaleString("en-AU"); }

// ---------- tagging ----------
const has = (re, s) => re.test(s || "");
export function autoTags(task, chain) {
  // chain: ancestors from the top down, not including the task
  const names = chain.map(t => t.name);
  const all = [...names, task.name];
  const inAnc = re => names.some(n => re.test(n)) || re.test(task.name);
  const tags = new Set();
  if (all.some(n => /-\s?B-\d/i.test(n))) tags.add("burners");
  if (all.some(n => /-\s?D-\d/i.test(n))) tags.add("heaters");
  if (names.some(n => /^asbestos removal$/i.test(n.trim())) || has(/asbestos|\basb\b|encapsulation|smoke test|clearance|glove\s?bagg/i, task.name)) tags.add("asbestos");
  if (has(/shrink\s?wrap|scaffold/i, task.name)) tags.add("scaffold");
  if (names.some(n => /^demolition$/i.test(n.trim())) || has(/demolish|demolition|hand cutting|downsize|remove platforms/i, task.name)) tags.add("demo");
  if (has(/pipework|piperack|pipe supports/i, task.name)) tags.add("pipe");
  if (inAnc(/purple items/i)) tags.add("purple");
  if (inAnc(/^70\s*\/?\s*blending/i)) tags.add("blending");
  if (inAnc(/bitumen/i)) tags.add("bitumen");
  if (inAnc(/boiler house/i)) tags.add("boiler");
  if (inAnc(/scrap processing/i)) tags.add("scrap");
  if (inAnc(/kororoit|bridge|offsite/i)) tags.add("offsite");
  return tags;
}

// ---------- tracking defaults ----------
export function blankTracking() {
  return {
    status: "",
    tagsAdd: [], tagsRemove: [],
    workplan: { has: "", ref: "", title: "", status: "", rev: "", submitted: "", clientComments: "", commentsClosed: "" },
    drawings: { has: "", type: "", number: "", rev: "", approved: "" },
    scope: { type: "", nod: "", nodDate: "", vn: "", vnRef: "", vnDate: "", costingDone: "", costingSubmitted: "", costingDate: "", value: "", response: "", approvedValue: "" },
    extras: { permit: "", po: "", poNumber: "", hire: "", clearance: "" },
    next: { action: "", owner: "", due: "" },
    resources: {},
    comments: []
  };
}
export function mergeTracking(t) {
  const b = blankTracking(); if (!t) return b;
  const out = { ...b, ...t };
  for (const k of ["workplan", "drawings", "scope", "extras", "next"]) out[k] = { ...b[k], ...(t[k] || {}) };
  out.resources = { ...(t.resources || {}) };
  out.tagsAdd = t.tagsAdd || []; out.tagsRemove = t.tagsRemove || []; out.comments = t.comments || [];
  return out;
}

// ---------- build ----------
export function buildModel(rawTasks, trackingMap) {
  const tasks = rawTasks.map(t => ({ ...t })).sort((a, b) => a.id - b.id);
  const byId = new Map(tasks.map(t => [t.id, t]));
  for (const t of tasks) { t.children = []; t.tr = mergeTracking(trackingMap[t.id]); }
  for (const t of tasks) { const p = byId.get(t.parent); if (p) p.children.push(t); }
  const now = today();
  for (const t of tasks) {
    const chain = []; let p = byId.get(t.parent);
    while (p) { chain.unshift(p); p = byId.get(p.parent); }
    t.chain = chain;
    t.path = chain.filter(c => c.level >= 2).map(c => c.name);
    const tags = autoTags(t, chain);
    t.autoTags = [...tags];
    for (const k of t.tr.tagsRemove) tags.delete(k);
    for (const k of t.tr.tagsAdd) tags.add(k);
    if (!tags.size) tags.add("untagged");
    t.tags = TAGS.map(x => x.key).filter(k => tags.has(k));
    t.s = parseISO(t.start); t.f = parseISO(t.finish);
    t.startsIn = t.s ? daysBetween(now, t.s) : null;
    // where progress should be by today if work runs evenly between start and finish
    t.expected = (t.s && t.f && t.actual != null) ? Math.max(0, Math.min(100, Math.round(((now - t.s) / DAY + 1) / ((t.f - t.s) / DAY + 1) * 100))) : null;
    if (t.expected != null && t.startsIn > 0) t.expected = 0;
    t.gap = (t.expected != null && t.actual != null) ? Math.round(t.expected - t.actual) : null;
    t.finishesIn = t.f ? daysBetween(now, t.f) : null;
    // a workplan answered on a main task covers every sub task under it, unless the sub task has its own answer
    let src = t;
    if (!t.tr.workplan.has) for (let i = chain.length - 1; i >= 0; i--) if (chain[i].level >= 3 && chain[i].tr.workplan.has) { src = chain[i]; break; }
    t.wpFrom = src === t ? null : src; t.wp = src.tr.workplan;
    t.wpi = wpInfo(t, now);
    t.isLeaf = !t.children.length;
    t.res = {}; for (const k in t.tr.resources) { const n = Math.round(+t.tr.resources[k]); if (n > 0) t.res[k] = n; }
    t.resOwn = Object.keys(t.res).length > 0;
  }
  // a package's resources only count when none of its sub tasks have their own
  const below = t => { let any = false; for (const c of t.children) { const b = below(c); any = any || b || c.resOwn; } t.resCounts = t.resOwn && !any; return any; };
  tasks.filter(t => !byId.get(t.parent)).forEach(below);
  // roll up status, bottom up
  const roll = t => {
    let worst = t.tr.status || (t.isLeaf && t.actual === 100 ? "done" : ""); // 100% in MSP counts as complete unless you set a status
    let allDone = t.children.length > 0;
    for (const c of t.children) {
      const r = roll(c);
      if (SEVERITY[r] > SEVERITY[worst]) worst = r;
      if (r !== "done") allDone = false;
    }
    if (!t.tr.status && allDone) worst = "done";
    t.eff = worst; return worst;
  };
  tasks.filter(t => !byId.get(t.parent)).forEach(roll);
  for (const t of tasks) t.flags = flagsFor(t, now);
  // roll flags up as a count
  const countUp = t => { let n = t.flags.length; for (const c of t.children) n += countUp(c); t.flagCount = n; return n; };
  tasks.filter(t => !byId.get(t.parent)).forEach(countUp);
  return { tasks, byId };
}

// when a task's workplan has to be submitted and approved, and what the next step is
export function wpInfo(t, now = today()) {
  const wp = t.wp || t.tr.workplan, done = t.tr.status === "done" || t.actual === 100;
  if (!t.s) return { state: "none" };
  const back = n => new Date(t.s.getFullYear(), t.s.getMonth(), t.s.getDate() - n);
  const base = { submitBy: back(APP.wpSubmitDays), approveBy: back(APP.wpApproveDays) };
  if (wp.has === "na") return { ...base, state: "na" };
  if (wp.has === "yes" && wp.status === "approved") return { ...base, state: "approved" };
  if (done) return { ...base, state: "closed" };
  const sent = wp.has === "yes" && (wp.status === "submitted" || wp.status === "clientreview");
  const step = sent ? "approve" : !wp.has ? "answer" : wp.has === "no" ? "start" : "submit";
  if (t.s <= now) return { ...base, step, state: "started" }; // work is already under way, so the dates no longer help
  const due = sent ? base.approveBy : base.submitBy, left = daysBetween(now, due);
  return { ...base, due, left, step, state: left < 0 ? "overdue" : left <= 7 ? "soon" : left <= 21 ? "next" : "later" };
}

export function flagsFor(t, now) {
  const f = [], tr = t.tr, done = tr.status === "done" || t.actual === 100;
  if (t.level <= 2) return f; // project-level groupings stay quiet
  if (done) return f;
  if (tr.status === "behind") f.push({ sev: 3, kind: "status", text: "Marked behind" });
  else if (tr.status === "risk") f.push({ sev: 2, kind: "status", text: "Marked at risk" });
  const soon = t.startsIn != null && t.startsIn <= APP.workplanWarnDays && (t.finishesIn == null || t.finishesIn >= 0);
  const own = !t.wpFrom; // sub tasks covered by a main task's workplan are flagged once, on the main task
  if (own && tr.workplan.has === "no" && t.startsIn != null && t.startsIn <= APP.lookaheadDays && t.finishesIn >= 0)
    f.push({ sev: soon ? 3 : 2, kind: "workplan", text: "No workplan yet" });
  else if (own && tr.workplan.has === "yes" && tr.workplan.status !== "approved" && soon)
    f.push({ sev: 3, kind: "workplan", text: t.startsIn > 0 ? `Workplan not approved, starts ${relDays(t.startsIn)}` : "Work started without an approved workplan" });
  if (tr.workplan.has === "yes" && t.wpi?.step === "submit" && t.wpi.state !== "started" && t.wpi.left <= 7 && !soon)
    f.push({ sev: t.wpi.left < 0 ? 3 : 2, kind: "workplan", text: t.wpi.left < 0 ? `Workplan should have been submitted ${relDays(t.wpi.left)}` : `Workplan to submit by ${fmtShort(t.wpi.submitBy)}` });
  if (tr.workplan.has === "yes" && tr.workplan.status === "rejected") f.push({ sev: 3, kind: "workplan", text: "Workplan rejected" });
  if (tr.drawings.has === "no" && t.startsIn != null && t.startsIn <= APP.drawingWarnDays && t.finishesIn >= 0)
    f.push({ sev: 2, kind: "drawings", text: "Drawings missing" });
  if (tr.drawings.has === "yes" && tr.drawings.approved === "no" && soon) f.push({ sev: 2, kind: "drawings", text: "Drawings not approved" });
  if (tr.scope.type === "variation") {
    const s = tr.scope;
    if (s.vn !== "yes") f.push({ sev: 2, kind: "variation", text: "Variation notice not sent" });
    else if (s.costingSubmitted !== "yes") f.push({ sev: 2, kind: "variation", text: "Variation costing not submitted" });
    else if (!s.response || s.response === "pending") f.push({ sev: 1, kind: "variation", text: "Awaiting client response on variation" });
    if (s.response === "rejected") f.push({ sev: 3, kind: "variation", text: "Variation rejected" });
  }
  const overdue = t.isLeaf && t.finishesIn != null && t.finishesIn < 0 && (t.actual ?? 0) < 100;
  if (overdue) f.push({ sev: 3, kind: "overdue", text: `Finish date passed ${relDays(t.finishesIn)}, ${t.actual ?? 0}% done` });
  else if (t.isLeaf && t.gap != null && t.startsIn <= 0 && t.gap >= APP.lagWarnPct)
    f.push({ sev: t.gap >= 50 ? 3 : 2, kind: "lag", text: `${t.actual}% done, should be about ${t.expected}% by today` });
  if (tr.next.due && tr.next.action) {
    const n = daysBetween(now, parseISO(tr.next.due));
    if (n < 0) f.push({ sev: 2, kind: "action", text: `Action overdue: ${tr.next.action}` });
  }
  return f;
}

export function isActiveWindow(t, back = 7, ahead = APP.lookaheadDays) {
  if (!t.s || !t.f) return false;
  return t.startsIn <= ahead && t.finishesIn >= -back;
}

export function hasMissing(t) {
  const tr = t.tr;
  return !(t.wp || tr.workplan).has || !tr.drawings.has || !tr.scope.type;
}

export function tagMeta(key) { return TAGS.find(t => t.key === key) || { key, label: key, hue: 220 }; }
export function statusMeta(key) { return STATUSES.find(s => s.key === (key || "")) || STATUSES[0]; }

// Package = summary row that is a piece of work (level 3+) or any leaf
export function isPackage(t) { return !t.isLeaf && t.level >= 3; }
