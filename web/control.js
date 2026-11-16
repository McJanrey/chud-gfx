// The control panel: shared bits (the engine's state, talking to it, tabs)
// and the Control page (Preview / Program, the take bar, the rundown and the
// selected graphic's fields). Composer is in composer.js, the other pages in pages.js.
"use strict";

// --- helpers ---------------------------------------------------------------
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k in e && typeof v !== "string") e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid instanceof Node ? kid : String(kid));
  return e;
}
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let toastTimer;
// action: {label, run} adds a button to the message (Undo) and keeps it up longer.
function toast(msg, error, action) {
  const t = $("#toast");
  t.textContent = msg;
  if (action) t.append(" ", h("button", { class: "small", onclick: () => { t.hidden = true; action.run(); } }, action.label));
  t.className = "toast" + (error ? " error" : "");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), action ? 10000 : error ? 6000 : 2200);
}
// Renaming a graphic, from Composer or the Control rundown.
async function renameGraphic(id) {
  const c = App.comp(id);
  if (!c) return;
  const name = prompt("Rename the graphic", c.name);
  if (name && name.trim() && name.trim() !== c.name) await api("/api/comp/rename", { id, name: name.trim() });
}
async function restoreGraphic(id) {
  const r = await api("/api/comp/restore", id ? { id } : {});
  toast(`Brought back "${r.comp.name}"`);
  // (once the engine's update with it is here, so opening it doesn't fall back to another graphic)
  for (let i = 0; i < 40 && !App.comp(r.comp.id); i++) await new Promise(res => setTimeout(res, 100));
  return r.comp;
}
async function api(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) { toast(data.error || `${path} failed (${r.status})`, true); throw new Error(data.error || r.status); }
  return data;
}
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
// Plain-words names for the {{...}} codes, so nobody has to read or remember them.
function codeLabel(code) {
  const c = code.slice(2, -2).trim(), low = c.toLowerCase();
  const fixed = { time: "Time (12-hour)", time24: "Time (24-hour)", date: "Date", clock: "Clock (Global)", timer: "Timer (Global)",
    "match.teama": "Team A", "match.teamb": "Team B", "map.n": "Map number", "match.bestof": "Best of" };
  if (fixed[low]) return fixed[low];
  let m = c.match(/^countdown:\s*(\d{1,2}):(\d{2})$/i);
  if (m) { const hh = +m[1]; return `Countdown to ${(hh % 12) || 12}:${m[2]} ${hh < 12 ? "AM" : "PM"}`; }
  m = c.match(/^([^!]+)!(.+)$/);
  if (!m) return c;
  const [, src, ref] = m;
  const cell = ref.match(/^([A-Z]{1,3})(\d+)$/), col = ref.match(/^(.+)#\s*(\d+)$/);
  return `${src} › ` + (cell ? `cell ${ref}` : col ? `${col[1]}, row ${col[2]}` : ref);
}
// Text with codes written as [labels], for previews and placeholders.
function friendly(text) { return String(text ?? "").replace(/\{\{[^{}]+\}\}/g, c => `[${codeLabel(c)}]`); }
// A text box that shows codes as chips but reads and writes plain text with codes (.value, like a textarea).
function chipBox(opts) {
  const chip = code => h("span", { class: "code-chip", contenteditable: "false", "data-code": code, title: code }, codeLabel(code));
  const el = h("div", { class: "chip-box", contenteditable: "true", spellcheck: "false", role: "textbox", "aria-multiline": "true",
    "data-ph": opts.placeholder || "", "data-field": opts.field || null });
  const fill = text => el.replaceChildren(...String(text ?? "").split(/(\{\{[^{}]+\}\})/).filter(Boolean)
    .map(p => /^\{\{[^{}]+\}\}$/.test(p) ? chip(p) : document.createTextNode(p)));
  const read = node => [...node.childNodes].map(n => n.nodeType === 3 ? n.nodeValue : n.dataset && n.dataset.code ? n.dataset.code
    : n.nodeName === "BR" ? "\n" : (n.nodeName === "DIV" || n.nodeName === "P" ? "\n" : "") + read(n)).join("");
  Object.defineProperty(el, "value", { get: () => read(el).replace(/^\n/, ""), set: v => fill(v) });
  el.addEventListener("input", () => opts.oninput && opts.oninput({ target: el }));
  el.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); document.execCommand("insertLineBreak"); } });
  el.addEventListener("paste", e => {
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData("text");
    document.execCommand("insertText", false, t);
    if (/\{\{[^{}]+\}\}/.test(t)) { fill(el.value); el.dispatchEvent(new Event("input")); }
  });
  fill(opts.value);
  return el;
}
function copy(text, what) {
  const done = () => toast(`Copied ${what || text}`);
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallback());
  else fallback();
  function fallback() {
    const t = h("textarea", { style: { position: "fixed", opacity: 0 } }, text);
    document.body.appendChild(t); t.select();
    try { document.execCommand("copy"); done(); } catch (e) { toast("Couldn't copy", true); }
    t.remove();
  }
}
const fmtBytes = n => n > 1e9 ? (n / 1e9).toFixed(1) + " GB" : n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB";

// A small, still picture of a graphic (cached until it or its values change).
const thumbCache = new Map();
function thumb(comp, values, width) {
  const key = comp.id + ":" + width;
  const sig = JSON.stringify([comp.layers, values]);
  let entry = thumbCache.get(key);
  if (!entry || entry.sig !== sig) {
    const box = h("div", { class: "thumb", style: { width: width + "px", height: Math.round(width * 9 / 16) + "px" } });
    const stage = h("div", { class: "gfx-stage", style: { transform: `scale(${width / GFX.W})` } });
    stage.appendChild(GFX.buildComp(comp, values || {}, { still: true, muted: true }));
    box.appendChild(stage);
    if (entry) GFX.destroy(entry.box);
    entry = { sig, box };
    thumbCache.set(key, entry);
  }
  return entry.box;
}

// --- the engine's state ----------------------------------------------------
const App = {
  state: null,
  assets: [],
  assetsRev: null,
  listeners: [],
  tab: null,
  on(fn) { this.listeners.push(fn); },
  comps() { return this.state ? this.state.project.compositions : []; },
  comp(id) { return this.comps().find(c => c.id === id); },
  fields(comp) {
    // The graphic's fields, once each, in layer order (top first).
    const seen = new Map();
    for (const l of [...(comp.layers || [])].reverse()) if (l.field && !seen.has(l.field)) seen.set(l.field, l);
    return [...seen.values()];
  },
  async loadAssets() {
    const r = await fetch("/api/assets").then(r => r.json());
    this.assets = r.assets;
    this.assetsRev = r.rev;
    this.emit("assets");
  },
  emit(what) { for (const fn of this.listeners) { try { fn(this.state, what); } catch (e) { console.error(e); } } },
  apply(msg) {
    // (each message has only what changed: the rest is as it was)
    const state = this.state = Object.assign({}, this.state, msg);
    if (msg.fonts) GFX.loadFonts(state.fonts);
    if (msg.data) {
      GFX.setClock(state.data.now);
      GFX.setData(state.data.tables);
    }
    if (state.assets_rev !== this.assetsRev) this.loadAssets();
    this.emit("state");
  },
};
window.App = App;

function connect() {
  const es = new EventSource("/api/stream");
  es.onmessage = e => App.apply(JSON.parse(e.data));
}
fetch("/api/state").then(r => r.json()).then(s => App.apply(s)).finally(connect);

// --- tabs and header -------------------------------------------------------
// The side panel: full, or folded to icons (each icon says its name on hover).
(function sidePanel() {
  const btn = $("#side-toggle"), root = document.documentElement;
  for (const b of document.querySelectorAll("#tabs button[data-tab]")) if (!b.title) b.title = b.textContent.trim();
  function set(mini) {
    root.classList.toggle("side-mini", mini);
    btn.title = mini ? "Show the side panel" : "Hide the side panel (icons only)";
    btn.setAttribute("aria-label", btn.title);
    btn.setAttribute("aria-expanded", String(!mini));
    try { localStorage.setItem("gfx-side-mini", mini ? "1" : ""); } catch (e) { /* */ }
  }
  let mini = false;
  try { mini = localStorage.getItem("gfx-side-mini") === "1"; } catch (e) { /* */ }
  set(mini);
  btn.addEventListener("click", () => set(!root.classList.contains("side-mini")));
})();
// Set by "Update now" just before the restart (read once, here, before anything clears it).
const UPDATED_FROM = (() => { try { return localStorage.getItem("gfx-updated-from"); } catch (e) { return null; } })();
const pages = {};
function showTab(name) {
  if (!pages[name] && name !== "control") name = "control";
  App.tab = name;
  for (const b of document.querySelectorAll("#tabs button[data-tab]")) b.classList.toggle("on", b.dataset.tab === name);
  // (Assets, Data, Transitions and Outputs are under Extras: it shows which one is open)
  const extra = document.querySelector(`#extras-menu button[data-tab="${name}"]`);
  $("#extras-btn").classList.toggle("on", !!extra);
  $("#extras-btn").firstChild.textContent = extra ? extra.textContent + " " : "Extras ";
  extrasMenu(false);
  for (const p of document.querySelectorAll(".page")) p.hidden = p.id !== "page-" + name;
  // The bar over the page: workspace / page, with the page's icon.
  const tabBtn = document.querySelector(`#tabs button[data-tab="${name}"]`);
  const label = tabBtn ? tabBtn.textContent.trim() : "";
  $("#crumb-page").textContent = $("#ws-sub").textContent = label;
  $("#crumb-ic").dataset.tab = name;
  try { localStorage.setItem("gfx-tab", name); } catch (e) { /* private window */ }
  if (pages[name] && pages[name].shown) pages[name].shown();
  if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
}
document.querySelectorAll("#tabs button[data-tab]").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
pages.appearance = { shown() { if (window.Appearance) Appearance.render($("#appearance-box")); } };
function extrasMenu(open) {
  $("#extras-menu").hidden = !open;
  $("#extras-btn").setAttribute("aria-expanded", String(open));
}
$("#extras-btn").addEventListener("click", e => { e.stopPropagation(); extrasMenu($("#extras-menu").hidden); });
document.addEventListener("click", e => { if (!e.target.closest("#extras")) extrasMenu(false); });
document.addEventListener("keydown", e => { if (e.key === "Escape") extrasMenu(false); });
addEventListener("load", () => {
  let start = location.hash.slice(1);
  // (back from an update: the page that was open, not the app's usual Home)
  if (UPDATED_FROM) start = "";
  if (!start) { try { start = localStorage.getItem("gfx-tab") || "control"; } catch (e) { start = "control"; } }
  showTab(start);
});

// Show check: everything that could go wrong on air, worst first.
(function preflight() {
  const dlg = $("#preflight"), list = $("#pf-list");
  async function run() {
    list.replaceChildren(h("li", { class: "muted" }, "Checking…"));
    try {
      const { checks } = await (await fetch("/api/preflight")).json();
      list.replaceChildren(...checks.map(c => h("li", { class: "pf " + c.level },
        h("span", { class: "pf-dot", "aria-hidden": "true" }),
        h("div", {}, h("b", {}, c.label), c.detail ? h("small", {}, c.detail) : null))));
      const bad = checks.filter(c => c.level === "bad").length, warn = checks.filter(c => c.level === "warn").length;
      const btn = $("#preflight-btn");
      btn.textContent = bad ? `Show check: ${bad} to fix` : warn ? `Show check: ${warn} to look at` : "Show check: ready";
      btn.dataset.level = bad ? "bad" : warn ? "warn" : "ok";
    } catch (e) { list.replaceChildren(h("li", { class: "pf bad" }, "Couldn't run the check: " + e.message)); }
  }
  $("#preflight-btn").addEventListener("click", () => { dlg.showModal(); run(); });
  $("#pf-again").addEventListener("click", run);
  $("#pf-close").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
})();

// Backups of the open workspace.
(function backups() {
  const dlg = $("#backups"), list = $("#bk-list");
  const when = t => new Date(t * 1000).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  async function load() {
    list.replaceChildren(h("li", { class: "muted" }, "Loading…"));
    const { backups } = await (await fetch("/api/backups")).json();
    if (!backups.length) { list.replaceChildren(h("li", { class: "muted small" }, "None yet: the first is saved after the next change.")); return; }
    list.replaceChildren(...backups.map(b => h("li", { class: "pf ok" },
      h("div", { style: { flex: "1" } }, h("b", {}, when(b.at) + (/before-restore/.test(b.name) ? " · before a restore" : "")),
        h("small", {}, `${b.graphics} graphic${b.graphics === 1 ? "" : "s"}`)),
      h("button", { class: "small", onclick: async () => {
        if (!confirm(`Put the workspace back to how it was on ${when(b.at)}? What's there now is backed up first.`)) return;
        await api("/api/backups/restore", { name: b.name });
        toast("Workspace restored");
        load();
      } }, "Restore"))));
  }
  $("#backups-btn").addEventListener("click", () => { dlg.showModal(); load(); });
  $("#bk-close").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
})();

const projectName = $("#project-name");
projectName.addEventListener("change", () => api("/api/project", { name: projectName.value }));
App.on(s => {
  if (document.activeElement !== projectName) projectName.value = s.project.name;
  $("#crumb-ws").textContent = s.project.name;
  const live = (s.live.program.on || []).length, st = $("#crumb-status");
  st.textContent = live ? `${live} on air` : "Nothing on air";
  st.classList.toggle("live", !!live);
  // Is Program really being shown somewhere (OBS, vMix)? Warn before the show, not during it.
  const outs = s.outputs || {}, pg = outs.program || 0, total = Object.values(outs).reduce((a, b) => a + b, 0), oc = $("#crumb-outs");
  oc.textContent = pg ? `Program out ×${pg}` : "Program not connected";
  oc.classList.toggle("ok", !!pg); oc.classList.toggle("warn", !pg);
  oc.title = total ? "Connected now:\n" + Object.entries(outs).map(([k, n]) => `${k.replace(/^comp:(.*)$/, (m, id) => (s.project.compositions.find(c => c.id === id) || {}).name || id)} ×${n}`).join("\n")
    : "No output is connected: add the Program link (Outputs page) to OBS as a browser source";
  document.title = `${s.project.name} · Chud GFX Baby`;
  const net = $("#net");
  const addr = s.app.addresses[0];
  net.className = "pill" + (s.app.network ? " on" : "");
  net.textContent = s.app.network ? `${addr || "localhost"}:${s.app.port}` : "This PC only";
  $("#version").textContent = s.app.version === "dev" ? "dev" : s.app.version;
  const up = s.update, btn = $("#update");
  btn.hidden = !(up.available && up.can_install) && up.status !== "downloading" && up.status !== "installing";
  btn.disabled = up.status === "downloading" || up.status === "installing";
  btn.textContent = up.status === "downloading" ? `Downloading ${up.progress}%` : up.status === "installing" ? "Installing…" : `Update to ${up.latest}`;
});
$("#update").addEventListener("click", () => updatePop(true));

// --- the update pop-up ---------------------------------------------------------
// Shown when a new version is out (Not now: until GFX Baby is opened again, the
// top-right button still updates). Update now saves what's being worked on first
// and the page opens where it was after the restart.
let updAsked = null, updGoing = false;
try { updAsked = sessionStorage.getItem("gfx-upd-later"); } catch (e) { /* */ }
function updatePop(force) {
  const s = App.state, up = s && s.update;
  if (!up || !(up.available && up.can_install)) return;
  if (!force && (updAsked === up.latest || updGoing)) return;
  $("#upd-ver").textContent = up.latest;
  $("#upd-cur").textContent = up.current;
  const notes = (up.notes || "").trim();
  $("#upd-notes").hidden = !notes;
  $("#upd-notes").textContent = notes;
  const onAir = (s.live.program.on || []).length;
  $("#upd-air").hidden = !onAir;
  $("#upd-air").textContent = onAir ? `${onAir} graphic${onAir === 1 ? " is" : "s are"} on air: the outputs go blank for about a minute while it restarts, then come back as they were.` : "";
  $("#upd-pop").hidden = false;
  $("#upd-now").focus();
}
$("#upd-later").addEventListener("click", () => {
  updAsked = App.state.update.latest;
  try { sessionStorage.setItem("gfx-upd-later", updAsked); } catch (e) { /* */ }
  $("#upd-pop").hidden = true;
});
$("#upd-pop").addEventListener("keydown", e => { if (e.key === "Escape" && !updGoing) $("#upd-later").click(); });
$("#upd-now").addEventListener("click", async () => {
  updGoing = true;
  $("#upd-now").disabled = $("#upd-later").disabled = true;
  $("#upd-progress").hidden = false;
  $("#upd-step").textContent = "Saving your work…";
  try {
    if (window.saveForUpdate) await window.saveForUpdate();
    localStorage.setItem("gfx-updated-from", App.state.app.version);
  } catch (e) { /* (the engine has everything up to the last change anyway) */ }
  try { await api("/api/update/install"); }
  catch (e) { updGoing = false; $("#upd-now").disabled = $("#upd-later").disabled = false; $("#upd-step").textContent = "Couldn't start the update. Try again."; }
});
App.on(s => {
  const up = s.update;
  if (updGoing) {
    $("#upd-bar").style.width = (up.status === "installing" ? 100 : up.progress || 0) + "%";
    $("#upd-step").textContent = up.status === "downloading" ? `Downloading ${up.progress || 0}%` : up.status === "installing" ? "Installing: GFX Baby restarts in a moment…"
      : up.status === "error" ? `Update failed: ${up.error}` : $("#upd-step").textContent;
    if (up.status === "error") { updGoing = false; $("#upd-now").disabled = $("#upd-later").disabled = false; }
    return;
  }
  updatePop(false);
  // Just updated: say so (once).
  const from = UPDATED_FROM;
  if (from && from !== s.app.version && !updatePop.told) {
    updatePop.told = true;
    try { localStorage.removeItem("gfx-updated-from"); } catch (e) { /* */ }
    toast(`Updated to ${s.app.version}. Picked up where you left off.`);
  }
});

// --- CONTROL ----------------------------------------------------------------
(function control() {
  const pvw = $("#mon-pvw"), pgm = $("#mon-pgm");
  pvw.src = "/output?bus=preview&monitor=1&bg=checker";
  pgm.src = "/output?bus=program&monitor=1&bg=checker";
  $("#pgm-open").href = "/output?bg=checker";
  let selected = null;
  try { selected = localStorage.getItem("gfx-sel"); } catch (e) { /* */ }
  let transition = null;
  try { transition = localStorage.getItem("gfx-tr"); } catch (e) { /* */ }

  function chosen(s) {
    const enabled = s.project.transitions.filter(t => t.enabled !== false);
    const t = enabled.find(t => t.id === transition) || enabled.find(t => t.id === s.project.default_transition) || enabled[0];
    return t ? t.id : "cut";
  }

  // The take bar.
  function renderChips(s) {
    const box = $("#tr-chips");
    const enabled = s.project.transitions.filter(t => t.enabled !== false);
    const cur = chosen(s);
    const sig = JSON.stringify([enabled.map(t => [t.id, t.name]), cur]);
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.replaceChildren(...enabled.map((t, i) => h("button", {
      class: t.id === cur ? "on" : "", title: t.name,
      onclick: () => { transition = t.id; try { localStorage.setItem("gfx-tr", t.id); } catch (e) { /* */ } renderChips(App.state); },
    }, t.name)));
  }
  async function take(tid) {
    const btn = $("#take");
    btn.classList.add("busy");
    try { await api("/api/take", { transition: tid || chosen(App.state) }); } finally { setTimeout(() => btn.classList.remove("busy"), 400); }
  }
  // How long after a stinger TAKE the graphics play their animations.
  const delay = $("#stinger-delay");
  delay.addEventListener("change", () => {
    const ms = Math.max(0, Math.round(+delay.value || 0));
    delay.value = ms || "";
    api("/api/project", { stinger_anim_delay: ms });
  });
  App.on(s => {
    $("#stinger-delay-row").hidden = !s.project.transitions.some(t => t.type === "stinger" && t.enabled !== false);
    if (document.activeElement !== delay) delay.value = s.project.stinger_anim_delay || "";
  });
  $("#take").addEventListener("click", () => take());
  $("#cut").addEventListener("click", () => take("cut"));
  // Clearing Program is one click (no "are you sure" mid-show): Undo puts it all back.
  const undoTake = () => api("/api/undo-take", {});
  $("#take-undo").addEventListener("click", undoTake);
  $("#pgm-clear").addEventListener("click", async () => {
    const had = App.state.live.program.on.length;
    await api("/api/clear", { bus: "program", transition: chosen(App.state) });
    if (had) toast("Program cleared", false, { label: "Undo", run: undoTake });
  });
  // Time on air since the last TAKE (the engine's clock, so every PC shows the same).
  // (when the TAKE reached this page; opened mid-show, from the engine's clock at load)
  let takeSeq = null, takeAt = 0;
  App.on(s => {
    const t = s.live.take || {};
    if (t.seq === takeSeq) return;
    takeAt = takeSeq === null && t.at && s.data && s.data.now ? Date.now() - (s.data.now - t.at) * 1000 : Date.now();
    takeSeq = t.seq;
  });
  setInterval(() => {
    const s = App.state, el = $("#pgm-clock");
    if (!s || App.tab !== "control") return;
    if (!s.live.program.on.length) { el.textContent = ""; return; }
    const secs = Math.max(0, Math.floor((Date.now() - takeAt) / 1000));
    el.textContent = (secs >= 3600 ? Math.floor(secs / 3600) + ":" : "") + String(Math.floor(secs / 60) % 60).padStart(2, "0") + ":" + String(secs % 60).padStart(2, "0");
  }, 500);
  $("#pvw-clear").addEventListener("click", () => api("/api/clear", { bus: "preview" }));
  // No keyboard shortcuts for TAKE, CUT or transitions (MJ): only the buttons (or a Stream Deck) put things on air.

  // The rundown.
  const KIND_TITLES = [["board", "Full-page boards"], ["lower third", "Lower thirds"], ["overlay", "Overlays"]];
  const filter = $("#rundown-filter");
  filter.addEventListener("input", () => renderRundown(App.state, true));
  let dragId = null;
  function renderRundown(s, force) {
    const list = $("#rundown");
    const q = filter.value.trim().toLowerCase();
    const comps = s.project.compositions.filter(c => !q || c.name.toLowerCase().includes(q));
    const pv = s.live.preview, pg = s.live.program;
    if (!selected || !App.comp(selected)) selected = comps[0] && comps[0].id;
    const sig = JSON.stringify([comps.map(c => [c.id, c.name, c.kind, c.layers]), pv.on, pg.on, pv.values, selected]);
    if (!force && list.dataset.sig === sig) return;
    list.dataset.sig = sig;
    // Where the operator is now: read before building, because the cached thumbnails move
    // into the new rows and the old list shrinks under the scroll (it jumped up on every PVW / TAKE).
    const top = list.scrollTop;
    if (!comps.length) {
      list.replaceChildren(h("div", { class: "empty" }, q ? "Nothing matches." : "No graphics yet. Make one in Composer, or add a Photoshop file in Assets."));
      return;
    }
    // Full-page boards, lower thirds, overlays: one board and one lower third on air at a time.
    const rows = [];
    for (const [kind, title] of KIND_TITLES) {
      const these = comps.filter(c => (c.kind || "overlay") === kind && !c.hud);
      if (!these.length) continue;
      rows.push(h("div", { class: "rd-group" }, title), ...these.map(row));
    }
    // A connected game HUD's own pages (VALORANT's agent select...), live from the HUD.
    const huds = comps.filter(c => c.hud);
    if (huds.length) rows.push(h("div", { class: "rd-group" }, "Game HUD"), ...huds.map(row));
    list.replaceChildren(...rows);
    list.scrollTop = top;
  }
  // Rebuild a list and keep it scrolled where it was (or back to the top when keep is false).
  function keepScroll(el, fn, keep = true) {
    const top = keep ? el.scrollTop : 0;
    fn();
    el.scrollTop = top;
  }
  function row(c) {
    const pv = App.state.live.preview, pg = App.state.live.program;
    const onPvw = pv.on.includes(c.id), onPgm = pg.on.includes(c.id);
    const nFields = App.fields(c).length;
    return h("div", {
      class: `rd${onPvw ? " on-pvw" : ""}${onPgm ? " on-pgm" : ""}${c.id === selected ? " sel" : ""}`, draggable: true,
      onclick: () => select(c.id),
      ondblclick: () => api("/api/cue", { id: c.id, on: !onPvw }),
      oncontextmenu: e => { e.preventDefault(); renameGraphic(c.id); },
      title: "Double-click: on / off Preview. Right-click: rename",
      ondragstart: e => { dragId = c.id; e.dataTransfer.effectAllowed = "move"; },
      ondragover: e => { e.preventDefault(); },
      ondrop: e => {
        e.preventDefault();
        if (!dragId || dragId === c.id) return;
        const ids = App.comps().map(x => x.id).filter(x => x !== dragId);
        ids.splice(ids.indexOf(c.id), 0, dragId);
        api("/api/comp/order", { ids });
      },
    },
      h("div", { class: "bar" }),
      thumb(c, pv.values[c.id], 112),
      h("div", { style: { minWidth: 0 } }, h("div", { class: "name" }, c.name),
        h("div", { class: "sub" }, `${nFields} field${nFields === 1 ? "" : "s"}`, onPgm ? " · ON AIR" : onPvw ? " · on preview" : "")),
      h("div", { class: "btns" },
        h("button", { class: "pvw-btn" + (onPvw ? " on" : ""), title: "On / off Preview (double-click the row)",
          onclick: e => { e.stopPropagation(); api("/api/cue", { id: c.id, on: !onPvw }); } }, "PVW"),
        h("button", { class: "in-btn" + (onPgm ? " on" : ""), title: onPgm ? "Take it off air (its Out animation)" : "Straight on air (its In animation): a board or lower third replaces the one on air, the rest stays",
          onclick: e => { e.stopPropagation(); api("/api/program", { id: c.id, on: !onPgm }); } }, onPgm ? "OUT" : "IN")));
  }
  function select(id) {
    selected = id;
    try { localStorage.setItem("gfx-sel", id); } catch (e) { /* */ }
    renderRundown(App.state, true);
    renderFields(App.state, true);
  }
  window.selectGraphic = select;

  // The selected graphic's fields (they change Preview as you type).
  const sendValues = {};
  function push(id, field, value) {
    (sendValues[id] = sendValues[id] || {})[field] = value;
    pushSoon();
  }
  const pushSoon = debounce(() => {
    for (const [id, values] of Object.entries(sendValues)) { api("/api/values", { id, values, bus: "preview" }); delete sendValues[id]; }
  }, 150);
  $("#fields-send").addEventListener("click", () => { if (selected) api("/api/send", { id: selected }); });

  const GLOBAL_PICTURES = [["{{Global!Left logo}}", "Left team's logo"], ["{{Global!Right logo}}", "Right team's logo"],
    ["{{Global!Tournament logo}}", "Tournament logo"], ["{{Sponsors}}", "Sponsors (in turn)"]];
  function assetOptions(kind, current) {
    const kinds = kind === "image" ? ["image"] : kind === "video" ? ["video", "image"] : kind === "lottie" ? ["lottie"] : [kind];
    const opts = App.assets.filter(a => kinds.includes(a.kind));
    const out = [h("option", { value: "" }, "(as designed)")];
    if (kind === "image") {
      out.push(h("optgroup", { label: "Global configuration" },
        ...GLOBAL_PICTURES.map(([t, label]) => h("option", { value: t, selected: t === current }, label))));
    }
    out.push(...opts.map(a => h("option", { value: a.path, selected: a.path === current }, a.path.replace(/^(assets|library)\//, ""))));
    return out;
  }

  function renderFields(s, force) {
    const box = $("#fields");
    const comp = App.comp(selected);
    $("#fields-title").textContent = comp ? comp.name : "Fields";
    if (!comp) { box.replaceChildren(h("div", { class: "empty" }, "Pick a graphic.")); return; }
    const fields = App.fields(comp);
    const pvVals = s.live.preview.values[comp.id] || {};
    const pgVals = s.live.program.values[comp.id] || {};
    const onAir = s.live.program.on.includes(comp.id);
    const differs = onAir && fields.some(l => (pvVals[l.field] ?? "") !== (pgVals[l.field] ?? ""));
    $("#fields-send").classList.toggle("differs", differs);
    $("#fields-send").disabled = !fields.length;
    const bracket = comp.layers.some(l => l.type === "bracket");
    const sched = comp.layers.some(l => /\{\{\s*Schedule!/i.test(l.show || ""));
    const standing = comp.layers.some(l => /\{\{\s*Standings!/i.test(l.show || ""));
    const clock = comp.layers.some(l => /\{\{\s*clock\s*\}\}/i.test(l.text || ""));
    const timer = comp.layers.some(l => /\{\{\s*timer\s*\}\}/i.test(l.text || ""));
    const roster = comp.layers.some(l => /\{\{\s*Roster!/i.test((l.text || "") + (l.src || "")));
    const mvp = comp.layers.some(l => /\{\{\s*Stats!MVP/i.test((l.text || "") + (l.src || "")));
    const caster = comp.layers.some(l => /Global!Caster/i.test(l.move || ""));
    const pics = comp.layers.some(l => /\{\{\s*Stats!.*(headshot|champion)\}\}/i.test(l.src || ""));
    // (Player stats has its own setting: its picture is the MVP's)
    const picsPage = comp.layers.some(l => /\{\{\s*Stats!MVP (headshot|champion)\}\}/i.test(l.src || "")) ? "player" : "team";
    const extras = () => [comp.hud ? hudField(s, comp) : null, caster ? casterField(s) : null, roster ? rosterField(s) : null, mvp ? mvpField(s) : null, pics ? picturesField(s, picsPage) : null, clock ? clockField(s) : null, timer ? timerField(s) : null, bracket ? sizeField(s) : null, sched ? countField(s) : null, standing ? standingsField(s) : null].filter(Boolean);
    const sig = JSON.stringify([comp.id, fields.map(f => [f.field, f.type]), App.assetsRev, bracket, sched, standing, clock, timer, roster, mvp, caster, pics, picsPage,
      Object.keys(s.data.feeds || {}), (s.data.tables.Global || []).map(r => r[0]),
      comp.hud ? JSON.stringify(s.data.feeds[comp.hud.split("/")[0]] && s.data.feeds[comp.hud.split("/")[0]].unreachable) : ""]);
    if (!force && box.dataset.sig === sig) {
      markSize(box, s);
      // Same fields: only bring in values changed elsewhere (not the one being typed in).
      for (const l of fields) {
        const input = box.querySelector(`[data-field="${CSS.escape(l.field)}"]`);
        const v = pvVals[l.field] ?? "";
        if (input && document.activeElement !== input && input.value !== String(v) && !(l.field in (sendValues[comp.id] || {}))) {
          if (input.type === "color") input.value = v || l.fill || "#000000"; else input.value = v;
        }
        const res = box.querySelector(`[data-resolved="${CSS.escape(l.field)}"]`);
        if (res) updateResolved(res, l, input ? input.value : "");
        const liveTag = box.querySelector(`[data-live="${CSS.escape(l.field)}"]`);
        if (liveTag) liveTag.textContent = onAir && (pvVals[l.field] ?? "") !== (pgVals[l.field] ?? "") ? "≠ ON AIR" : "";
      }
      return;
    }
    box.dataset.sig = sig;
    // Same graphic rebuilt (a take, a new asset...): stay where you were. Another graphic starts at the top.
    const same = box.dataset.comp === comp.id;
    box.dataset.comp = comp.id;
    if (!fields.length) {
      keepScroll(box, () => box.replaceChildren(...(bracket || sched || clock || timer || roster || mvp || caster || pics || comp.hud ? extras() : [h("div", { class: "empty" }, "This graphic has no fields. In Composer, pick a layer and give it a field name to change it from here.")])), same);
      return;
    }
    keepScroll(box, () => { box.replaceChildren(...fields.map(l => {
      const v = pvVals[l.field];
      let input;
      if (l.type === "text") {
        input = chipBox({ field: l.field, placeholder: friendly(l.text), value: v ?? "",
          oninput: e => { push(comp.id, l.field, e.target.value); updateResolved(res, l, e.target.value); } });
      } else if (l.type === "rect") {
        input = h("input", { type: "color", "data-field": l.field, value: v || l.fill || "#000000",
          oninput: e => push(comp.id, l.field, e.target.value) });
      } else {
        input = h("select", { "data-field": l.field, onchange: e => push(comp.id, l.field, e.target.value || null) }, assetOptions(l.type, v));
      }
      const res = h("div", { class: "resolved", "data-resolved": l.field });
      updateResolved(res, l, v ?? "");
      // Text or a colour can follow the global configuration (or a game HUD's data).
      const link = l.type === "image" ? null : h("select", { class: "small link", title: "Use the global configuration (or a connected game HUD)",
        onchange: e => {
          if (!e.target.value) return;
          input.value = e.target.value; push(comp.id, l.field, e.target.value); updateResolved(res, l, e.target.value);
          e.target.value = "";
        } }, linkOptions(s, l.type));
      return h("div", { class: "field" },
        h("label", {}, l.field, h("span", { class: "kind" }, l.type), h("span", { class: "live", "data-live": l.field },
          onAir && (pvVals[l.field] ?? "") !== (pgVals[l.field] ?? "") ? "≠ ON AIR" : "")),
        h("div", { class: "row-gap" }, input, link,
          h("button", { class: "ghost small", title: "Back to the design's own", onclick: () => { input.value = ""; push(comp.id, l.field, null); updateResolved(res, l, ""); } }, "↺")),
        res);
    })); box.prepend(...extras()); }, same);
  }
  // A knockout bracket: how many teams (the tournament's, in Global; changes it on air too).
  function sizeField(s) {
    const set = (k, v) => {
      const t = JSON.parse(JSON.stringify(App.state.global.tournament));
      t.top[k] = v;
      api("/api/global", { global: { tournament: t } });
    };
    const el = h("div", { class: "field bracket-size" },
      h("label", {}, "Teams in the bracket", h("span", { class: "kind" }, "tournament")),
      h("select", { "data-k": "size", onchange: e => set("size", +e.target.value) }, ...[8, 16].map(n => h("option", { value: n }, `${n} teams`))),
      h("label", {}, "Format"),
      h("select", { "data-k": "format", onchange: e => set("format", e.target.value) },
        h("option", { value: "single" }, "Single elimination"), h("option", { value: "double" }, "Double elimination")),
      h("div", { class: "resolved" }, "The teams and scores are in the Tournament tab. This changes the bracket on air too."));
    markSize(el, s);
    return el;
  }
  // The Schedule: how many upcoming matches it lists (changes it on air too).
  function countField(s) {
    const set = count => {
      const sc = JSON.parse(JSON.stringify(App.state.global.schedule));
      sc.count = count;
      api("/api/global", { global: { schedule: sc } });
    };
    const el = h("div", { class: "field bracket-size" },
      h("label", {}, "Matches shown", h("span", { class: "kind" }, "schedule")),
      h("select", { "data-k": "count", onchange: e => set(+e.target.value) }, ...[1, 2, 3].map(n => h("option", { value: n }, n === 1 ? "1 match" : `${n} matches`))),
      h("div", { class: "resolved" }, "The matches are in the Upcoming Schedule tab. This changes the graphic on air too."));
    markSize(el, s);
    return el;
  }
  // The Standings: what its boxes show (changes it on air too).
  const STAT_NAMES = { record: "Record (W-L)", wins: "Wins", losses: "Losses", points: "Points", winpct: "Win %", diff: "Map difference (+/-)" };
  function standingsField(s) {
    const set = (k, v) => {
      const st = JSON.parse(JSON.stringify(App.state.global.standings));
      st[k] = v;
      if (st.stat2 === st.stat) st.stat2 = "";
      api("/api/global", { global: { standings: st } });
    };
    const opts = none => [...(none ? [h("option", { value: "" }, "Nothing")] : []), ...Object.entries(STAT_NAMES).map(([k, n]) => h("option", { value: k }, n))];
    const el = h("div", { class: "field bracket-size" },
      h("label", {}, "The box shows", h("span", { class: "kind" }, "standings")),
      h("select", { "data-k": "st-stat", onchange: e => set("stat", e.target.value) }, ...opts(false)),
      h("label", {}, "A second box shows"),
      h("select", { "data-k": "st-stat2", onchange: e => set("stat2", e.target.value) }, ...opts(true)),
      h("div", { class: "resolved" }, "The teams and their results are in the Tournament tab. This changes the graphic on air too."));
    markSize(el, s);
    return el;
  }
  // The player graphics: whose players (the left or right team's roster, from the Teams tab).
  function rosterField(s) {
    const el = h("div", { class: "field roster-field" },
      h("label", {}, "Players from", h("span", { class: "kind" }, "teams")),
      h("select", { "data-k": "roster", onchange: e => api("/api/global", { global: { roster: e.target.value } }) },
        h("option", { value: "left" }), h("option", { value: "right" })),
      h("div", { class: "resolved", "data-k": "roster-note" }));
    markSize(el, s);
    return el;
  }
  // The caster lower third: how many boxes, and its colours (Global's, so
  // they change on air too).
  function casterField(s) {
    const set = change => api("/api/global", { global: { caster: change } });
    const el = h("div", { class: "field caster-field" },
      h("label", {}, "Caster boxes", h("span", { class: "kind" }, "global")),
      h("div", { class: "row-gap" },
        h("select", { "data-k": "caster-count", onchange: e => set({ count: +e.target.value }) },
          ...[1, 2, 3, 4].map(n => h("option", { value: n }, n === 1 ? "1 box" : `${n} boxes`))),
        h("label", { class: "swatch" }, "Primary colour",
          h("input", { type: "color", "data-k": "caster-primary", title: "The box", onchange: e => set({ primary: e.target.value }) })),
        h("label", { class: "swatch" }, "Secondary colour",
          h("input", { type: "color", "data-k": "caster-secondary", title: "The box's edge and its shadow", onchange: e => set({ secondary: e.target.value }) })),
        h("label", { class: "swatch" }, "Font colour",
          h("input", { type: "color", "data-k": "caster-text", title: "The name and handle", onchange: e => set({ text: e.target.value }) }))),
      h("div", { class: "resolved" }, "Primary is the box; secondary is the box's edge and its shadow; font is the name and handle. Each box's name and handle are below."));
    markSize(el, s);
    return el;
  }
  // A game HUD's own page (VALORANT's agent select...), shown live from the HUD.
  function hudField(s, comp) {
    const hud = comp.hud.split("/")[0], feed = (s.data.feeds || {})[hud];
    const note = !feed ? `Shows when the ${hud} is connected (its GFX Baby page).`
      : feed.unreachable ? `The ${hud} is on another PC: tick "Let other PCs on the network read the HUD" in it, so this can show here.`
      : `Live from the ${hud} (${feed.from}). Take it like any other graphic.`;
    return h("div", { class: "field" }, h("label", {}, "Game HUD", h("span", { class: "kind" }, hud)),
      h("div", { class: "resolved" }, note));
  }
  // The stats pages: each team's players shown with their headshot or their
  // champion / agent. Team stats and Player stats each have their own (in
  // Global, so it changes on air too).
  function picturesField(s, page) {
    const set = (side, v) => api("/api/global", { global: { pictures: { [page]: { [side]: v } } } });
    const pick = side => h("label", { class: "swatch" }, side === "left" ? "Left team" : "Right team",
      h("select", { "data-k": "pic-" + side, onchange: e => set(side, e.target.value) },
        h("option", { value: "headshot" }, "Headshots"), h("option", { value: "champion" }, "Champions / agents / heroes")));
    const el = h("div", { class: "field caster-field", "data-page": page },
      h("label", {}, "Player pictures", h("span", { class: "kind" }, page === "player" ? "player stats" : "team stats")),
      h("div", { class: "row-gap" }, pick("left"), pick("right")),
      h("div", { class: "resolved" }, "Headshots come from the Teams tab; champions (League), agents (VALORANT) and heroes (Overwatch) from the game. Only " + (page === "player" ? "Player stats" : "Team stats") + " follows this."));
    markSize(el, s);
    return el;
  }
  // The Player stats page: the top player in the game (most of stat 1), or one picked.
  function mvpField(s) {
    const el = h("div", { class: "field mvp-field" },
      h("label", {}, "Player", h("span", { class: "kind" }, "game")),
      h("select", { "data-k": "mvp", onchange: e => api("/api/global", { global: { player_stats: e.target.value } }) }),
      h("div", { class: "resolved", "data-k": "mvp-note" }));
    markSize(el, s);
    return el;
  }
  // The clock: the time of day, or a countdown for Starting Soon or Be Right Back
  // (Global's, so every clock changes, on air too).
  function clockField(s) {
    const set = change => api("/api/global", { global: { clock: Object.assign({}, App.state.global.clock, change) } });
    const el = h("div", { class: "field clock-field" },
      h("label", {}, "Clock", h("span", { class: "kind" }, "global")),
      h("div", { class: "row-gap" },
        h("select", { "data-k": "clock-mode", onchange: e => set({ mode: e.target.value }) },
          h("option", { value: "time" }, "Current time"), h("option", { value: "soon" }, "Starting Soon"), h("option", { value: "brb" }, "Be Right Back")),
        h("input", { type: "time", "data-k": "clock-until", title: "Counts down to this time", onchange: e => set({ until: e.target.value }) })),
      h("div", { class: "resolved", "data-k": "clock-note" }));
    markSize(el, s);
    return el;
  }
  // The timer ({{timer}}): Global's, so it runs on Preview and Program alike.
  function timerField(s) {
    const act = body => api("/api/timer", body);
    const el = h("div", { class: "field timer-field" },
      h("label", {}, "Timer", h("span", { class: "kind" }, "global")),
      h("div", { class: "row-gap" },
        h("span", { class: "timer-now", "data-k": "timer-now" }, GFX.timerText()),
        h("button", { "data-k": "timer-go", onclick: () => act({ action: "toggle" }) }, "Start"),
        h("button", { class: "ghost", onclick: () => act({ action: "reset" }) }, "Reset")),
      h("div", { class: "row-gap" },
        h("input", { type: "text", "data-k": "timer-from", placeholder: "0:00", title: "Starts from this time (m:ss)",
          onchange: e => act({ action: "set", secs: e.target.value }) }),
        h("select", { "data-k": "timer-down", onchange: e => act({ action: "set", down: e.target.value === "down" }) },
          h("option", { value: "up" }, "Counts up"), h("option", { value: "down" }, "Counts down"))),
      h("div", { class: "resolved" }, "Type the time it starts from (m:ss). Reset goes back to it. It runs on air too."));
    markSize(el, s);
    return el;
  }
  const mss = secs => { const t = Math.round(secs); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
  setInterval(() => document.querySelectorAll(".timer-field").forEach(el => {
    const tm = App.state.global.timer || {};
    // (a countdown that reached 0 has stopped)
    const running = !!tm.started && !(tm.down && GFX.timerSecs() <= 0);
    const go = el.querySelector("[data-k=timer-go]");
    el.querySelector("[data-k=timer-now]").textContent = GFX.timerText();
    go.textContent = running ? "Pause" : "Start";
    go.classList.toggle("on", running);
  }), 250);
  function markSize(el, s) {
    const ro = el.querySelector("[data-k=roster]");
    if (ro) {
      const label = side => { const t = s.global[side]; return `${side === "left" ? "Left" : "Right"} team: ${t.name || "(none)"}${t.game ? ` (${t.game})` : ""}`; };
      ro.options[0].textContent = label("left"); ro.options[1].textContent = label("right");
      if (document.activeElement !== ro) ro.value = s.global.roster || "left";
      const rows = Object.fromEntries((s.data.tables.Roster || []).slice(1));
      el.querySelector("[data-k=roster-note]").textContent = rows.Team
        ? `${rows.Players} player${rows.Players === "1" ? "" : "s"} on ${rows.Team}'s roster in the Teams tab.`
        : "That team isn't in the Teams tab, so the names come from the game's stats.";
    }
    const cs = s.global.caster || { count: 1, primary: "#c2bdff", secondary: "#001a1a" };
    for (const [k, v] of [["caster-count", String(cs.count)], ["caster-primary", cs.primary], ["caster-secondary", cs.secondary],
                          ["caster-text", cs.text || cs.secondary]]) {
      const inp = el.querySelector(`[data-k=${k}]`);
      if (inp && document.activeElement !== inp) inp.value = v;
    }
    for (const side of ["left", "right"]) {
      const sel = el.querySelector(`[data-k=pic-${side}]`);
      const page = (el.querySelector("[data-page]") || el).dataset.page || "team";
      if (sel && document.activeElement !== sel) sel.value = (((s.global.pictures || {})[page] || {})[side]) || "headshot";
    }
    const mv = el.querySelector("[data-k=mvp]");
    if (mv) {
      const st = Object.fromEntries((s.data.tables.Stats || []).slice(1));
      const t1 = st["Stat 1 title"] || "KILLS", title = t1.length <= 3 || t1.includes("/") ? t1 : t1.toLowerCase();   // (ACS, K/D/A stay as they are)
      const opts = [["auto", `Top player (most ${title})`]];
      for (const side of ["Left", "Right"]) {
        for (let n = 1; n <= 10 && (`${side} player ${n}` in st); n++) {
          const name = st[`${side} player ${n}`];
          if (name) opts.push([`${side.toLowerCase()} ${n}`, `${name} (${st[`${side} name`] || side}): ${st[`${side} player ${n} stat 1`] || 0} ${title}`]);
        }
      }
      const pick = s.global.player_stats || "auto";
      if (!opts.some(o => o[0] === pick)) opts.push([pick, "(the player picked, not in this game)"]);
      const sig = JSON.stringify(opts);
      if (mv.dataset.sig !== sig) { mv.dataset.sig = sig; mv.replaceChildren(...opts.map(([v, t]) => h("option", { value: v }, t))); }
      if (document.activeElement !== mv) mv.value = pick;
      el.querySelector("[data-k=mvp-note]").textContent = !st.Status
        ? "No game's stats yet: connect a game HUD. The top player is picked automatically, or pick one here."
        : `Showing ${st["MVP name"] || st.MVP || "nobody"}${st["MVP headshot"] ? "" : " (no headshot in the Teams tab)"}. Their name, flag and headshot come from their team's roster in the Teams tab.`;
    }
    const c = s.global.clock || { mode: "time", until: "" };
    const mode = el.querySelector("[data-k=clock-mode]"), until = el.querySelector("[data-k=clock-until]");
    if (mode && document.activeElement !== mode) mode.value = c.mode;
    if (until) {
      until.hidden = c.mode === "time";
      if (document.activeElement !== until) until.value = c.until || "";
      el.querySelector("[data-k=clock-note]").textContent = c.mode === "time" ? `Shows the time of day, with LOCAL TIME under it.`
        : `Counts down to ${c.until || "(pick a time)"}, with ${c.mode === "soon" ? "STARTING SOON" : "BE RIGHT BACK"} under it.`;
    }
    const tm = s.global.timer || { secs: 0, from: 0, down: false, started: 0 };
    if (el.querySelector("[data-k=timer-go]")) {
      const from = el.querySelector("[data-k=timer-from]"), dn = el.querySelector("[data-k=timer-down]");
      if (document.activeElement !== from) from.value = mss(tm.from);
      if (document.activeElement !== dn) dn.value = tm.down ? "down" : "up";
    }
    const size = ((s.global.tournament || {}).top || {}).size || 8;
    const sel = el.querySelector("[data-k=size]");
    if (sel && document.activeElement !== sel) sel.value = String(size);
    const fsel = el.querySelector("[data-k=format]");
    if (fsel && document.activeElement !== fsel) fsel.value = ((s.global.tournament || {}).top || {}).format === "double" ? "double" : "single";
    const st = s.global.standings || {};
    for (const k of ["stat", "stat2"]) {
      const sel = el.querySelector(`[data-k=st-${k}]`);
      if (sel && document.activeElement !== sel) sel.value = st[k] || "";
    }
    const cnt = el.querySelector("[data-k=count]");
    if (cnt && document.activeElement !== cnt) cnt.value = String((s.global.schedule || {}).count || 3);
  }
  function linkOptions(s, type) {
    const out = [h("option", { value: "" }, "⛓")];
    const tables = s.data.tables || {};
    const names = ["Global", ...Object.keys(s.data.feeds || {})];
    for (const n of names) {
      let rows = (tables[n] || []).slice(1);
      if (type === "rect") rows = rows.filter(r => /colou?r/i.test(r[0]));
      if (!rows.length) continue;
      out.push(h("optgroup", { label: n === "Global" ? "Global configuration" : n },
        ...rows.map(r => h("option", { value: `{{${n}!${r[0]}}}` }, `${r[0]}${r[1] ? " — " + String(r[1]).slice(0, 30) : ""}`))));
    }
    return out;
  }
  function updateResolved(el, layer, value) {
    if (layer.type !== "text") { el.textContent = /\{\{/.test(value || "") ? `${friendly(value)} → ${GFX.resolve(value)}` : ""; return; }
    const raw = value || layer.text;
    el.textContent = /\{\{/.test(raw) ? "→ " + GFX.resolve(raw) : value ? "" : "Shows: " + friendly(layer.text);
  }
  setInterval(() => { if (App.state && App.tab === "control") renderFields(App.state); }, 1000);

  App.on((s, what) => {
    renderChips(s);
    renderRundown(s, what === "assets");
    renderFields(s, what === "assets");
    const names = ids => ids.map(id => (App.comp(id) || {}).name).filter(Boolean).join(", ") || "—";
    $("#pvw-list").textContent = names(s.live.preview.on);
    $("#pgm-list").textContent = names(s.live.program.on);
    $("#take-undo").disabled = !(s.live.take || {}).undo;
  });
  pages.control = { shown() { if (App.state) { renderRundown(App.state, true); renderFields(App.state, true); } if (typeof Ros !== "undefined") Ros.show("panel", true); } };
})();

// Run of show: its own page (the builder), and the panel on Control.
pages.ros = { shown() { if (typeof Ros !== "undefined") Ros.show("builder", true); } };

// Workspace picker, top right: switch the open workspace without leaving the page.
async function fillWorkspacePicker() {
  const sel = $("#ws-pick");
  if (!sel) return;
  const info = await fetch("/api/workspaces").then(r => r.json()).catch(() => null);
  if (!info) return;
  const list = info.workspaces || info.list || [];
  const cur = (App.state && App.state.workspace && App.state.workspace.id) || info.current;
  sel.replaceChildren(...list.map(w => h("option", { value: w.id, selected: w.id === cur }, w.name || w.id)));
}
$("#ws-pick").addEventListener("change", async e => {
  try { await api("/api/workspaces/open", { id: e.target.value }); toast("Workspace opened"); } catch (err) { fillWorkspacePicker(); }
});
$("#ws-pick").addEventListener("focus", fillWorkspacePicker);
setTimeout(fillWorkspacePicker, 800);


// --- OBS Studio: status, Control strip, Outputs settings -------------------------------
(function obsPanel() {
  const o = () => (App.state && App.state.obs) || {};
  const post = (path, body) => api(path, body).catch(() => {});
  function pill() {
    const s = o(), el = $("#obs-pill");
    el.hidden = !s.enabled;
    el.textContent = !s.connected ? "OBS: not connected" : `OBS: ${s.program || "?"}` + (s.streaming ? "  ● LIVE" : "") + (s.recording ? "  ● REC" : "");
    el.classList.toggle("live", !!s.streaming);
    el.title = s.connected ? "OBS Studio" : (s.error || "OBS isn't connected");
  }
  function strip() {
    const s = o(), box = $("#obs-strip");
    box.hidden = !s.connected;
    if (!s.connected) return;
    const sig = JSON.stringify([s.scenes, s.program, s.preview, s.studio, s.streaming, s.recording]);
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.replaceChildren(
      h("span", { class: "obs-label" }, "OBS"),
      h("div", { class: "obs-scenes" }, (s.scenes || []).map(n => h("button", {
        class: "small" + (n === s.program ? " pgm" : "") + (s.studio && n === s.preview ? " pvw" : ""),
        title: s.studio ? "Put on OBS Preview (Studio Mode)" : "Switch OBS to this scene",
        onclick: () => post("/api/obs/scene", { name: n, preview: !!s.studio }) }, n))),
      s.studio ? h("button", { class: "small", onclick: () => post("/api/obs/transition", {}) }, "Transition") : null,
      h("button", { class: "small" + (s.streaming ? " danger" : ""), onclick: () => { if (!s.streaming || confirm("Stop the stream in OBS?")) post("/api/obs/toggle", { what: "stream" }); } }, s.streaming ? "Stop stream" : "Start stream"),
      h("button", { class: "small" + (s.recording ? " danger" : ""), onclick: () => post("/api/obs/toggle", { what: "record" }) }, s.recording ? "Stop recording" : "Record"));
  }
  let filled = false;
  function settings() {
    const s = o();
    $("#obs-status").textContent = !s.enabled ? "Off" : s.connected ? `Connected · ${s.program}` : (s.error || "Connecting…");
    if (!filled && App.state) {
      filled = true;
      $("#obs-on").checked = !!s.enabled;
      $("#obs-host").value = s.host || "127.0.0.1";
      $("#obs-port").value = s.port || 4455;
      $("#obs-pass").placeholder = s.hasPassword ? "Saved (type to change)" : "From OBS's Show Connect Info";
      follow();
    }
  }
  function rules() { return o().follow || []; }
  function follow() {
    const list = window._obsFollow = (window._obsFollow || rules()).map(r => ({ ...r }));
    const comps = App.state.project.compositions || [], scenes = o().scenes || [];
    const save = () => post("/api/obs/settings", { follow: window._obsFollow });
    $("#obs-follow").replaceChildren(...list.map((r, i) => h("div", { class: "row-gap", style: { marginBottom: "6px" } },
      h("select", { onchange: e => { r.scene = e.target.value; save(); } }, h("option", { value: "" }, "OBS scene…"),
        [...new Set([...scenes, r.scene].filter(Boolean))].map(n => h("option", { value: n, selected: r.scene === n }, n))),
      h("select", { onchange: e => { r.action = e.target.value; save(); } }, [["in", "takes in"], ["out", "takes out"]].map(([v, t]) => h("option", { value: v, selected: (r.action || "in") === v }, t))),
      h("select", { onchange: e => { r.comp = e.target.value; save(); } }, h("option", { value: "" }, "graphic…"),
        comps.map(c => h("option", { value: c.id, selected: r.comp === c.id }, c.name))),
      h("button", { class: "small danger", onclick: () => { list.splice(i, 1); save(); follow(); } }, "×"))));
  }
  $("#obs-follow-add").addEventListener("click", () => { window._obsFollow = [...(window._obsFollow || []), { scene: "", action: "in", comp: "" }]; follow(); });
  $("#obs-save").addEventListener("click", async () => {
    await api("/api/obs/settings", { enabled: $("#obs-on").checked, host: $("#obs-host").value.trim() || "127.0.0.1",
      port: +$("#obs-port").value || 4455, password: $("#obs-pass").value });
    $("#obs-pass").value = "";
    toast("OBS settings saved");
  });
  $("#obs-add").addEventListener("click", async () => {
    if (!o().connected) return toast("Connect to OBS first", true);
    try { await api("/api/obs/add-source", {}); toast(`Added to OBS scene "${o().program}"`); } catch (e) { /* toast shown */ }
  });
  App.on(() => { pill(); strip(); settings(); });
})();


// --- Stream: Multistream on / off, its own page below -------------------------------
pages.stream = { shown() { streamPage(); } };
function streamPage() {
  const s = (App.state && App.state.stream) || {};
  $("#stream-on").checked = !!s.enabled;
  $("#stream-status").textContent = s.running ? "Running" : s.error ? s.error : s.enabled ? "Starting…" : "Off";
  const f = $("#stream-frame"), want = s.running ? `http://${location.hostname}:${s.port}/` : "";
  f.hidden = !s.running;
  if (want && f.dataset.src !== want) { f.dataset.src = want; f.src = want; }
}
$("#stream-on").addEventListener("change", async e => {
  try { await api("/api/stream", { on: e.target.checked }); } catch (err) { e.target.checked = !e.target.checked; }
});
App.on(() => { if (App.tab === "stream") streamPage(); });


// --- HUD Builder: on / off, its own page below -----------------------------------------
pages.builder = { shown() { builderPage(); } };
function builderPage() {
  const s = (App.state && App.state.builder) || {};
  $("#builder-on").checked = !!s.enabled;
  $("#builder-status").textContent = s.running ? "Running" : s.error ? s.error : s.enabled ? "Starting…" : "Off";
  const f = $("#builder-frame"), want = s.running ? `http://${location.hostname}:${s.port}/` : "";
  f.hidden = !s.running;
  if (want && f.dataset.src !== want) { f.dataset.src = want; f.src = want; }
}
$("#builder-on").addEventListener("change", async e => {
  try { await api("/api/builder", { on: e.target.checked }); } catch (err) { e.target.checked = !e.target.checked; }
});
App.on(() => { if (App.tab === "builder") builderPage(); });
