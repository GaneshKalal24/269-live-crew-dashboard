// Reads MS Project exports: PDF prints, MSP XML (File > Save As > XML) and Excel/CSV.

const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/";
const XLSX_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

const DATE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/g;
const PCT_RE = /(\d{1,3}(?:\.\d+)?)%/g;
const DUR_RE = /^\s*([\d.]+)\s*(?:days?|d)\b/;
const pad = n => String(n).padStart(2, "0");
function dmyToISO(d, m, y) { y = +y; if (y < 100) y += 2000; return `${y}-${pad(m)}-${pad(d)}`; }

// ---------- generic helpers ----------
export function assignParents(list) {
  const sorted = list.slice().sort((a, b) => a.id - b.id);
  const stack = [];
  for (const t of sorted) {
    while (stack.length && stack[stack.length - 1].level >= t.level) stack.pop();
    t.parent = stack.length ? stack[stack.length - 1].id : null;
    stack.push(t);
  }
  return sorted;
}

export function mergeLists(lists) {
  const m = new Map();
  for (const list of lists) for (const t of list) {
    const old = m.get(t.id);
    if (!old || (t.name || "").length > (old.name || "").length) m.set(t.id, t);
  }
  return [...m.values()];
}

// ---------- PDF ----------
// pages: [{ items: [{ str, x, y, w, size }] }] with y measured from the top of the page (baseline)
export function parsePdfPages(pages) {
  const rows = []; let statusDate = "";
  for (const page of pages) {
    const items = page.items.filter(i => i.str && i.str.trim());
    const footer = items.map(i => i.str).join(" ").match(/Date:\s*\w*\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (footer && !statusDate) statusDate = dmyToISO(footer[1], footer[2], footer[3]);
    const head = items.filter(i => i.y < 60);
    const find = word => {
      for (const i of head) {
        if (i.str.trim() === word) return i.x;
        const k = i.str.indexOf(word);
        if (k >= 0) return i.x + i.w * (k / i.str.length);
      }
      return null;
    };
    const xr = find("Remaining"), xa = find("Actual"), xn = find("Name");
    if (xr == null || xn == null) continue;
    const lvl0 = xn - 10.6, limit = (xa ?? xr + 200) + 40;
    const footTop = Math.min(...items.filter(i => /^Project:/.test(i.str.trim())).map(i => i.y), page.height ? page.height - 40 : 1e9);
    const body = items.filter(i => i.y > 58 && i.y < footTop - 4 && i.x < limit);
    const ids = body.filter(i => i.x < lvl0 - 3 && /^\d+$/.test(i.str.trim()) && i.size < 6.6).sort((a, b) => a.y - b.y);
    ids.forEach((idi, k) => {
      const top = idi.y - 4, bot = k + 1 < ids.length ? ids[k + 1].y - 4 : idi.y + 14;
      const rw = body.filter(i => i !== idi && i.y >= top && i.y < bot && i.x >= lvl0 - 3);
      const byLine = (a, b) => (Math.round(a.y) - Math.round(b.y)) || (a.x - b.x);
      const nameItems = rw.filter(i => i.x < xr - 1).sort(byLine);
      const right = rw.filter(i => i.x >= xr - 1).sort(byLine);
      if (!nameItems.length) return;
      const firstY = nameItems[0].y;
      const x = Math.min(...nameItems.filter(i => Math.abs(i.y - firstY) < 2).map(i => i.x)) - lvl0;
      rows.push({ id: +idi.str.trim(), x, name: nameItems.map(i => i.str.trim()).join(" "), rs: right.map(i => i.str.trim()).join(" ") });
    });
  }
  const tasks = rows.map(r => {
    let name = r.name.replace(/\s+/g, " ").trim(), rs = r.rs;
    const merged = name.match(/^(.*\d,)\s?(\d+(?:\.\d+)?)\s(.*)$/);
    if (merged && !DUR_RE.test(rs)) { name = merged[1] + " " + merged[3]; rs = merged[2] + " " + rs; }
    const dates = [...rs.matchAll(/(\d{1,2})\/(\d{2})\/(\d{2})/g)];
    const pcts = [...rs.matchAll(/(\d{1,3}\.\d{2})%/g)].map(m => +m[1]);
    const dur = rs.match(DUR_RE);
    // MSP prints "Complete" in place of the % columns once a task is finished
    const complete = /(^|\s)Complete(\s|$)/.test(rs);
    if (complete && !pcts.length) pcts.push(100, 100);
    const summary = pcts.length === 0;
    return {
      id: r.id, name, level: Math.max(0, Math.round(r.x / 7)), summary,
      start: dates[0] ? dmyToISO(dates[0][1], dates[0][2], dates[0][3]) : null,
      finish: dates[1] ? dmyToISO(dates[1][1], dates[1][2], dates[1][3]) : null,
      remDur: dur ? +dur[1] : null,
      planned: summary ? null : (pcts[0] ?? null),
      actual: summary ? null : (pcts[1] ?? null)
    };
  });
  return { tasks: mergeLists([tasks]), statusDate };
}

let pdfjsLib = null;
async function getPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import(PDFJS + "pdf.min.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.mjs";
  return pdfjsLib;
}
export async function readPdf(file) {
  const lib = await getPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    pages.push({
      height: vp.height,
      items: tc.items.map(it => ({ str: it.str, x: it.transform[4], y: vp.height - it.transform[5], w: it.width, size: Math.hypot(it.transform[0], it.transform[1]) }))
    });
  }
  return parsePdfPages(pages);
}

// ---------- MSP XML ----------
export function parseMspXml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const get = (el, tag) => el.getElementsByTagName(tag)[0]?.textContent ?? "";
  const statusDate = (get(doc.documentElement, "StatusDate") || "").slice(0, 10);
  const hours = s => { const m = /PT(\d+)H(\d+)M/.exec(s || ""); return m ? (+m[1] + +m[2] / 60) : null; };
  const out = [];
  for (const el of doc.getElementsByTagName("Task")) {
    const id = +get(el, "ID"); if (!id && id !== 0) continue;
    if (id === 0) continue;
    const name = get(el, "Name"); if (!name) continue;
    const summary = get(el, "Summary") === "1";
    const rem = hours(get(el, "RemainingDuration"));
    out.push({
      id, name: name.trim(), level: +get(el, "OutlineLevel") || 1, summary,
      start: get(el, "Start").slice(0, 10) || null, finish: get(el, "Finish").slice(0, 10) || null,
      remDur: rem == null ? null : +(rem / 8).toFixed(2),
      planned: summary ? null : null,
      actual: summary ? null : +(get(el, "PercentComplete") || 0)
    });
  }
  const min = Math.min(...out.map(t => t.level));
  out.forEach(t => t.level -= min);
  return { tasks: out, statusDate };
}

// ---------- Excel / CSV ----------
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
export async function getXLSX() { if (!window.XLSX) await loadScript(XLSX_URL); return window.XLSX; }

function cellDate(v) {
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === "string") { const m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(v); if (m) return dmyToISO(m[1], m[2], m[3]); const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(v); if (iso) return iso[0]; }
  return null;
}
const num = v => { if (v === "" || v == null) return null; const n = parseFloat(String(v).replace(/[^\d.\-]/g, "")); return isNaN(n) ? null : (typeof v === "number" && v <= 1 && String(v).includes(".") ? n * 100 : n); };

export async function readSheet(file) {
  const XLSX = await getXLSX();
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  const hIdx = rows.findIndex(r => r.some(c => /^id$/i.test(String(c).trim())) && r.some(c => /name/i.test(String(c))));
  if (hIdx < 0) throw new Error("Could not find a header row with ID and Name columns.");
  const h = rows[hIdx].map(c => String(c).trim().toLowerCase());
  const col = re => h.findIndex(c => re.test(c));
  const c = {
    id: col(/^id$/), name: col(/name/), start: col(/^start/), finish: col(/^finish/), level: col(/outline/),
    planned: col(/planned/), actual: col(/actual|% ?complete/), rem: col(/remaining/), summary: col(/^summary$/)
  };
  const out = [];
  for (const r of rows.slice(hIdx + 1)) {
    const id = parseInt(r[c.id]); if (!id) continue;
    const raw = String(r[c.name] ?? "");
    const lead = raw.match(/^\s*/)[0].length;
    const planned = c.planned >= 0 ? num(r[c.planned]) : null, actual = c.actual >= 0 ? num(r[c.actual]) : null;
    const summary = c.summary >= 0 ? /^(yes|true|1)$/i.test(String(r[c.summary])) : (planned == null && actual == null);
    out.push({
      id, name: raw.trim(), level: c.level >= 0 ? (+r[c.level] || 1) : Math.round(lead / 3) + 1, summary,
      start: cellDate(r[c.start]), finish: cellDate(r[c.finish]),
      remDur: c.rem >= 0 ? num(r[c.rem]) : null,
      planned: summary ? null : planned, actual: summary ? null : actual
    });
  }
  const min = Math.min(...out.map(t => t.level)); out.forEach(t => t.level -= min);
  return { tasks: out, statusDate: "" };
}

export async function readAny(file) {
  const n = file.name.toLowerCase();
  if (n.endsWith(".pdf")) return readPdf(file);
  if (n.endsWith(".xml")) return parseMspXml(await file.text());
  if (/\.(xlsx|xls|csv)$/.test(n)) return readSheet(file);
  if (n.endsWith(".mpp")) throw new Error(".mpp files can't be read in a browser. In MS Project use File, Save As, and pick XML or Excel Workbook.");
  throw new Error(`Unsupported file type: ${file.name}`);
}
