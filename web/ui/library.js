// Assets (the workspace's files), Data (sources -> tables) and Appearance (this PC's look).
import { $, el, api, upload, App, pages, assets, toast, ask, typingIn } from "./lib.js";

const busy = id => typingIn($(id));
const kb = n => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;
const copyText = (t, what) => navigator.clipboard.writeText(t).then(() => toast(`Copied ${what || t}`), () => toast(t));

// --- Assets ----------------------------------------------------------------------
let kindTab = "all", list = [], fps = 30;
const KINDS = [["all", "All"], ["image", "Pictures"], ["video", "Video"], ["data", "Data"], ["font", "Fonts"]];
async function addFiles(files) {
  for (const f of files) {
    const r = await upload(f, kindTab === "font" ? "fonts" : "", `&fps=${fps}`);
    if (r && r.comp) toast(`Made the graphic "${r.comp.name}" from ${f.name}`);
    if (r && r.job) toast(`Making ${f.name} web-ready…`);
    if (r && r.comps) toast(`Added ${r.comps.map(c => c.name).join(", ")}`);
  }
  list = await assets(true);
  renderAssets();
}
function missingFonts() {
  const have = new Set([...(App.state.fonts || []).map(f => f.name.toLowerCase()), "inter", "montserrat", "barlow condensed", "bebas neue", "anton", "permanent marker", "vazirmatn"]);
  const used = new Set();
  for (const c of App.state.project.compositions || []) for (const l of c.layers || []) if (l.font) used.add(l.font);
  return [...used].filter(f => !have.has(f.toLowerCase())).sort();
}
function renderAssets() {
  if (App.page !== "assets") return;
  const count = k => k === "all" ? list.length : list.filter(a => a.kind === k).length;
  const shown = list.filter(a => kindTab === "all" || a.kind === kindTab);
  const missing = missingFonts();
  const input = el("input", { type: "file", multiple: true, hidden: true, onchange: e => addFiles([...e.target.files]) });
  const drop = el("div", { class: "drop", ondragover: e => { e.preventDefault(); drop.classList.add("over"); }, ondragleave: () => drop.classList.remove("over"),
    ondrop: e => { e.preventDefault(); drop.classList.remove("over"); addFiles([...e.dataTransfer.files]); } },
    "Drop files here: Photoshop (.psd) becomes a graphic; video (.mov with alpha from After Effects, .avi, .mkv, PNG sequences in a .zip) is made web-ready; .mp4 / .webm, pictures, fonts (.ttf, .otf) and data (.csv, .xlsx, .json) are used as they are.");
  let folder = null;
  const cards = [];
  for (const a of shown) {
    const dir = a.path.split("/").slice(1, -1).join("/") || "assets";
    if (dir !== folder) { folder = dir; cards.push(el("div", { class: "asset-group" }, dir)); }
    const name = a.path.split("/").pop(), url = a.path.split("/").map(encodeURIComponent).join("/");
    const thumb = a.kind === "image" ? el("img", { src: url, alt: "", loading: "lazy", onload: e => { size.textContent = `${e.target.naturalWidth}×${e.target.naturalHeight} · ${kb(a.size)}`; } })
      : a.kind === "video" ? el("video", { src: url, muted: true, preload: "metadata" }) : el("span", { class: "small" }, name.split(".").pop().toUpperCase());
    const size = el("span", { class: "muted small" }, kb(a.size));
    cards.push(el("div", { class: "asset" }, el("div", { class: "thumb" }, thumb), el("span", { class: "name", title: a.path }, name), size,
      el("div", { class: "row" },
        el("button", { class: "small ghost", onclick: () => copyText(a.path) }, "Copy"),
        a.kind === "image" ? el("button", { class: "small ghost", onclick: () => makeGraphic(a, name) }, "Graphic") : null,
        el("span", { class: "spacer" }),
        el("button", { class: "small ghost", "aria-label": `Remove ${name}`, onclick: async () => { if (await ask(`Remove ${name}? It's moved to the workspace's .trash folder.`)) api("/api/asset/remove", { path: a.path }).then(async () => { list = await assets(true); renderAssets(); }); } }, "✕"))));
  }
  $("#assets-body").replaceChildren(
    el("div", { class: "row" }, el("div", { class: "seg" }, ...KINDS.map(([k, t]) => el("button", { class: "small" + (kindTab === k ? " on" : ""), onclick: () => { kindTab = k; renderAssets(); } }, `${t} ${count(k)}`))),
      el("span", { class: "spacer" }), el("label", { class: "row small muted" }, "PNG sequence fps", el("input", { type: "number", min: 1, max: 120, value: fps, style: "width:64px", onchange: e => { fps = +e.target.value || 30; } })),
      input, el("button", { class: "small primary", onclick: () => input.click() }, "Add files…")),
    jobsEl(),
    missing.length ? el("p", { class: "muted small" }, `The graphics use fonts that aren't added yet (similar ones stand in): ${missing.join(", ")}. Drop their .ttf / .otf files here.`) : "",
    drop, el("div", { class: "assets" }, ...cards));
}
function jobsEl() {
  const jobs = App.state.jobs || [];
  if (!jobs.length) return "";
  return el("div", { class: "stack" }, ...jobs.map(j => el("div", { class: "row small" }, el("b", {}, j.name),
    j.state === "working" ? el("progress", { max: 100, value: j.progress }) : null,
    el("span", { class: j.state === "error" ? "err" : "muted" }, j.state === "working" ? `${j.progress}%` : j.state === "done" ? `ready: ${j.result}` : j.detail))));
}
async function makeGraphic(a, name) {
  const img = new Image();
  img.src = a.path.split("/").map(encodeURIComponent).join("/");
  await img.decode().catch(() => {});
  const w = img.naturalWidth || 1920, h = img.naturalHeight || 1080;
  const r = await api("/api/comp", { comp: { name: name.replace(/\.[^.]+$/, ""), kind: "overlay", layers: [{ id: "l" + Math.random().toString(36).slice(2, 10), name, type: "image", src: a.path, fit: "contain", x: Math.round((1920 - w) / 2), y: Math.round((1080 - h) / 2), w, h }] } });
  toast(`Made the graphic "${r.comp.name}"`);
}
pages.assets = { async shown() { list = await assets(true); renderAssets(); } };

// --- Data ---------------------------------------------------------------------------
let pickSrc = null;
function renderData() {
  if (App.page !== "data" || busy("#page-data")) return;
  const all = JSON.parse(JSON.stringify(App.state.project.sources || [])), tables = (App.state.data || {}).tables || {}, status = App.state.source_status || {};
  const save = () => api("/api/sources", { sources: all });
  if (!all.some(s => s.id === pickSrc)) pickSrc = (all[0] || {}).id || null;
  const cur = all.find(s => s.id === pickSrc);
  const rowsOf = s => (tables[s.name] || []).length;
  const left = el("div", { class: "panel" }, el("div", { class: "panel-head" }, el("h3", {}, "Data sources"),
      el("button", { class: "small primary", onclick: () => { const s = { id: "s" + Math.random().toString(16).slice(2, 10), name: "Data " + (all.length + 1), type: "file", path: "", refresh: 10 }; all.push(s); pickSrc = s.id; save(); } }, "+ Add")),
    el("div", { class: "list" }, ...all.map(s => { const st = status[s.id] || status[s.name] || {};
      return el("div", { class: "gfx" + (s.id === pickSrc ? " sel" : ""), onclick: () => { pickSrc = s.id; renderData(); } }, el("span", { class: "bar-ind" }),
        el("div", {}, el("div", { class: "name" }, s.name), el("div", { class: "sub" + (st.error ? " err" : "") }, st.error || `${({ file: "File", url: "Web address", sheet: "Google Sheet" })[s.type || "file"]} · ${rowsOf(s)} rows · every ${s.refresh || 10}s`)), ""); }),
      el("div", { class: "muted small" }, el("p", {}, "In the Composer, a text layer shows a value with {{Name!Field}} (the row whose first cell is Field) or {{Name!B2}} (a cell)."),
        el("p", {}, "Click a cell on the right to copy its reference."))));
  let right = el("div", { class: "panel" }, el("p", { class: "muted empty" }, "Add a data source: a file, a web address (CSV or JSON) or a Google Sheet."));
  if (cur) {
    const set = (k, v) => { cur[k] = v; save(); };
    const t = cur.type || "file";
    const fileInput = el("input", { type: "file", hidden: true, accept: ".csv,.tsv,.txt,.json,.xlsx", onchange: async e => { const f = e.target.files[0]; if (f) set("path", await upload(f, "data")); } });
    const rows = tables[cur.name] || [], cols = Math.max(0, ...rows.map(r => r.length));
    const colName = i => { let s = "", n = i + 1; while (n) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); } return s; };
    const st = status[cur.id] || status[cur.name] || {};
    right = el("div", { class: "panel" }, el("div", { class: "panel-head" }, el("h3", {}, cur.name)),
      el("div", { class: "list form" },
        el("div", { class: "three" },
          el("label", { class: "f" }, el("span", {}, "Name (used in {{Name!B2}})"), el("input", { value: cur.name, onchange: e => set("name", e.target.value) })),
          el("label", { class: "f" }, el("span", {}, "Kind"), el("select", { onchange: e => set("type", e.target.value) }, ...[["sheet", "Google Sheet"], ["file", "File (CSV, Excel, text, JSON)"], ["url", "Web address (CSV / JSON)"]].map(([v, n]) => el("option", { value: v, selected: t === v }, n)))),
          el("label", { class: "f" }, el("span", {}, "Read every (seconds)"), el("input", { type: "number", min: 2, value: cur.refresh || 10, onchange: e => set("refresh", +e.target.value || 10) }))),
        t === "file" ? el("div", { class: "row" }, el("label", { class: "f", style: "flex:1" }, el("span", {}, "A file added to this workspace, or the full path of a file on this PC (read again when it changes)"),
            el("input", { value: cur.path || "", placeholder: "assets/data/match.csv", onchange: e => set("path", e.target.value) })), fileInput, el("button", { class: "small", onclick: () => fileInput.click() }, "Add file…"))
          : el("div", { class: "two" }, el("label", { class: "f" }, el("span", {}, t === "sheet" ? "The sheet's address (shared: anyone with the link can view)" : "Address"), el("input", { value: cur.url || "", placeholder: "https://…", onchange: e => set("url", e.target.value) })),
            el("label", { class: "f" }, el("span", {}, "Sheet / tab (optional)"), el("input", { value: cur.tab || "", onchange: e => set("tab", e.target.value) }))),
        el("div", { class: "row" },
          el("button", { class: "small", onclick: () => api("/api/source/read", { id: cur.id }).then(() => toast("Read")) }, "Read now"),
          el("button", { class: "small ghost", onclick: async () => { if (await ask(`Remove the data source "${cur.name}"? Graphics using it go blank.`)) { all.splice(all.indexOf(cur), 1); save(); } } }, "Remove"),
          el("span", { class: "spacer" }), el("span", { class: "small" + (st.error ? " err" : " muted") }, st.error || (st.at ? `Read at ${new Date(st.at * 1000).toLocaleTimeString()}` : ""))),
        rows.length ? el("div", { class: "cells" }, el("table", {},
          el("tr", {}, el("th", {}, ""), ...Array.from({ length: cols }, (_, i) => el("th", {}, colName(i)))),
          ...rows.map((r, ri) => el("tr", {}, el("th", {}, String(ri + 1)), ...Array.from({ length: cols }, (_, ci) => el("td", {
            title: `{{${cur.name}!${colName(ci)}${ri + 1}}}`, onclick: e => copyText(e.shiftKey && r[0] && ci === 1 ? `{{${cur.name}!${r[0]}}}` : `{{${cur.name}!${colName(ci)}${ri + 1}}}`) }, r[ci] ?? "")))))) : el("p", { class: "muted" }, "Nothing read yet.")));
  }
  $("#data-body").replaceChildren(left, right);
}
pages.data = { shown: renderData };

// --- Appearance ------------------------------------------------------------------------
const THEMES = [["", "Control Room", "Zinc greys and a lime tally light. StandBy GFX's own look.", ["#0a0a0b", "#151517", "#c8f03c"]],
  ["night", "Night", "Pure black, orange on key buttons. Calmest in a dark room.", ["#000", "#0b0b0b", "#ff8a1f"]],
  ["graphite", "Graphite", "Pro-app greys and blue.", ["#1e1f22", "#2a2b30", "#0a84ff"]],
  ["daylight", "Daylight", "Light, with white cards. Best in a bright room.", ["#f2f2f4", "#fff", "#4f7a00"]],
  ["glass", "Glass", "Frosted glass over warm brown and orange.", ["#3a2414", "#30221a", "#ff9a3c"]]];
const store = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) { /* */ } };
const read = k => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
function renderLook() {
  const cur = read("sg-theme"), accent = read("sg-accent");
  const apply = (t, a) => {
    store("sg-theme", t); store("sg-accent", a);
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    if (a) document.documentElement.style.setProperty("--accent", a); else document.documentElement.style.removeProperty("--accent");
    renderLook();
  };
  $("#look-body").replaceChildren(
    el("h3", {}, "Look"),
    el("div", { class: "theme-grid" }, ...THEMES.map(([k, n, d, sw]) => el("button", { class: "theme" + (cur === k ? " on" : ""), onclick: () => apply(k, accent) },
      el("span", { class: "sw" }, ...sw.map(c => el("i", { style: `background:${c}` }))), el("b", {}, n), el("span", { class: "muted small" }, d)))),
    el("h3", {}, "Highlight colour"),
    el("div", { class: "row" }, el("input", { type: "color", value: accent || "#c8f03c", style: "width:48px", onchange: e => apply(cur, e.target.value) }),
      el("button", { class: "small ghost", onclick: () => apply(cur, "") }, "Use the look's colour")),
    el("p", { class: "muted small" }, "Used for key buttons, selected items and icons. Preview, Program and the team colours don't change. Saved on this PC; graphics on air don't change."));
}
pages.appearance = { shown: renderLook };

App.on((st, msg) => {
  if (!msg || msg.project || msg.data || msg.source_status) renderData();
  if (msg && msg.fonts && App.page === "assets") renderAssets();
  if (msg && msg.jobs && App.page === "assets") { const done = msg.jobs.some(j => j.state === "done"); (done ? assets(true).then(l => { list = l; renderAssets(); }) : Promise.resolve(renderAssets())); }
});
