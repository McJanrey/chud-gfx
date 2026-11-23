// Shared by every page: elements, the engine's API, the live state, toasts, pages.
// (the look picked on Appearance, saved on this PC)
try {
  const t = localStorage.getItem("sg-theme"), a = localStorage.getItem("sg-accent");
  if (t) document.documentElement.dataset.theme = t;
  if (a) document.documentElement.style.setProperty("--accent", a);
} catch (e) { /* private window */ }
export const $ = s => document.querySelector(s);
export const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith("on") && typeof v === "function") {   // (through e._on, so morph() can hand a redrawn element's handlers to the old one)
      const t = k.slice(2);
      if (!(e._on ||= {})[t]) e.addEventListener(t, ev => e._on[t] && e._on[t].call(e, ev));
      e._on[t] = v;
    }
    else if (k === "class") e.className = v;
    else if (k === "value") e.value = v;
    else if (k === "checked") e.checked = !!v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
};

export async function api(path, body = {}) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error || "That didn't work"); throw new Error(j.error); }
  later();
  return j;
}
export async function upload(file, folder = "", extra = "") {
  const r = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}&folder=${encodeURIComponent(folder)}${extra}`, { method: "POST", body: file });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error || "Couldn't add that file"); throw new Error(j.error); }
  return j.path || j;   // (a Photoshop file comes back as {comp}, a video to convert as {job})
}

let toastTimer;
export function toast(msg, action) {
  const t = $("#toast");
  t.replaceChildren(msg, action ? el("button", { class: "small", onclick: () => { t.hidden = true; action.run(); } }, action.label) : "");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), action ? 8000 : 2500);
}

// The live state from the engine, and who wants to hear about it.

// Errors on this page go to the engine's Error log (Show check > Error log), so we know what broke.
{
  let sent = 0;
  const report = (msg, src, line, stack) => {
    if (++sent > 30) return;   // (a loop of the same error mustn't flood the log)
    fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: "control " + location.pathname, msg: String(msg || "error"), src, line, stack }) }).catch(() => {});
  };
  addEventListener("error", e => { if (e.message) report(e.message, e.filename, e.lineno, e.error && e.error.stack); }, true);
  addEventListener("unhandledrejection", e => { const r = e.reason || {}; report(r.message || String(r), "", "", r.stack); });
}

export const App = { state: null, listeners: [], page: "control", on(fn) { this.listeners.push(fn); if (this.state) fn(this.state); } };
// The monitors (iframes of /output?monitor=1) get each change from here.
function feed(msg) {
  for (const f of document.querySelectorAll("iframe")) if (f.contentWindow) f.contentWindow.postMessage({ sgState: msg }, location.origin);
}
addEventListener("message", e => {   // (a monitor that just loaded asks for the whole state)
  if (e.origin === location.origin && e.data && e.data.sgReady && App.state) e.source.postMessage({ sgState: App.state }, location.origin);
});
function apply(msg) {
  feed(msg);
  App.state = Object.assign({}, App.state, msg);
  if (App.state.project && App.state.live) for (const fn of App.listeners) fn(App.state, msg);
}
fetch("/api/state").then(r => r.json()).then(apply).finally(() => {
  const es = new EventSource("/api/stream");
  es.onmessage = e => apply(JSON.parse(e.data));
});

// Pages: the sidebar's buttons show one <main class="page"> at a time (remembered per PC).
export const pages = {};
export function show(name) {
  if (!document.getElementById("page-" + name)) name = "control";
  App.page = name;
  for (const p of document.querySelectorAll("main.page")) p.hidden = p.id !== "page-" + name;
  for (const b of document.querySelectorAll("#nav button")) b.classList.toggle("on", b.dataset.page === name);
  const label = (document.querySelector(`#nav button[data-page="${name}"]`) || {}).textContent || "";
  $("#crumb-page").textContent = $("#ws-page").textContent = label;
  try { localStorage.setItem("sg-page", name); } catch (e) { /* private window */ }
  if (pages[name] && pages[name].shown) pages[name].shown();
}
document.addEventListener("click", e => { const b = e.target.closest("#nav button[data-page]"); if (b && !b.disabled) show(b.dataset.page); });
addEventListener("load", () => { let p = "control"; try { p = localStorage.getItem("sg-page") || p; } catch (e) { /* */ } show(p); });

// A picture picker: the workspace's images, plus "Add a file…".
let assetCache = null, assetFolder;
export async function assets(force) {
  if (assetCache && !force) return assetCache;
  const f = assetFolder, list = (await fetch("/api/assets").then(r => r.json())).assets;
  if (f === assetFolder) assetCache = list;   // (a workspace opened mid-fetch: don't cache the old one's files)
  return list;
}
App.on(st => {   // (another workspace open: its own assets folder, so the list is fetched again)
  const w = (st.workspaces || []).find(w => w.open), f = w && w.folder;
  if (f !== assetFolder) { assetFolder = f; assetCache = null; }
});
export function picker(kind, value, onPick, folder = "") {
  const sel = el("select", { "aria-label": "File" });
  const fill = list => sel.replaceChildren(el("option", { value: "" }, "(none)"),
    ...list.filter(a => a.kind === kind).map(a => el("option", { value: a.path, selected: a.path === value }, a.path.replace(/^assets\//, ""))),
    el("option", { value: "__add" }, "Add a file…"));
  if (value && !value.startsWith("assets/")) sel.append(el("option", { value, selected: true }, value));
  assets().then(fill);
  sel.addEventListener("change", async () => {
    if (sel.value !== "__add") return onPick(sel.value);
    const f = el("input", { type: "file", accept: kind === "image" ? "image/*" : kind === "video" ? "video/*" : "" });
    f.addEventListener("change", async () => { if (!f.files[0]) return; const p = await upload(f.files[0], folder); await assets(true).then(fill); sel.value = p; onPick(p); });
    f.click();
  });
  return sel;
}

// Fonts for the Composer canvas (the same faces the outputs load).
const BUILTIN = [["Inter", "Inter.ttf", "100 900"], ["Anton", "Anton-Regular.ttf"], ["Bebas Neue", "BebasNeue.ttf"], ["Permanent Marker", "PermanentMarker-Regular.ttf"],
  ["Montserrat", "Montserrat-400.woff2", "400"], ["Montserrat", "Montserrat-500.woff2", "500"], ["Montserrat", "Montserrat-700.woff2", "700"], ["Montserrat", "Montserrat-800.woff2", "800"], ["Montserrat", "Montserrat-900.woff2", "900"],
  ["Barlow Condensed", "BarlowCondensed-500.woff2", "500"], ["Barlow Condensed", "BarlowCondensed-600.woff2", "600"], ["Barlow Condensed", "BarlowCondensed-700.woff2", "700"],
  ["Vazirmatn", "Vazirmatn-700.woff2", "700"], ["Vazirmatn", "Vazirmatn-900.woff2", "900"]];
const fontCss = document.createElement("style");
document.head.appendChild(fontCss);
let fontSig = "";
App.on(st => {
  const sig = JSON.stringify(st.fonts || []);
  if (sig === fontSig) return;
  fontSig = sig;
  const face = (n, u, w) => `@font-face{font-family:"${n.replace(/"/g, "")}";src:url("${encodeURI(u)}");${w ? `font-weight:${w};` : ""}font-display:block}`;
  fontCss.textContent = [...BUILTIN.map(([n, f, w]) => face(n, "fonts/" + f, w)), ...(st.fonts || []).map(f => face(f.name, f.url))].join(String.fromCharCode(10));
});

// Our own dialogs instead of the browser's confirm / prompt boxes: ask() -> true / false, askText() -> text or null.
// The red button says what happens ("Remove", "Delete", "Install"), from the question's first word unless given.
function dialog(title, body, { ok, danger, input } = {}) {
  return new Promise(done => {
    const field = input ? el("input", { value: input.value || "", placeholder: input.placeholder || "", "aria-label": title }) : null;
    const word = ok || (/^(Remove|Delete|Install|Go back|Restore)/.exec(title) || [])[1] || (input ? "Save" : "OK");
    const d = el("dialog", { class: "dlg ask" },
      el("h3", {}, title), body ? el("p", { class: "muted" }, body) : "", field || "",
      el("div", { class: "row end" },
        el("button", { class: "small ghost", onclick: () => close(null) }, "Cancel"),
        el("button", { class: "small " + (danger ?? /^(Remove|Delete)/.test(title) ? "danger" : "primary"), onclick: () => close(field ? field.value.trim() : true) }, word)));
    const close = v => { d.close(); d.remove(); done(field ? (v || null) : !!v); };
    d.addEventListener("cancel", e => { e.preventDefault(); close(null); });
    if (field) field.addEventListener("keydown", e => { if (e.key === "Enter") close(field.value.trim()); });
    document.body.appendChild(d);
    d.showModal();
    (field || d.querySelector("button:last-child")).focus();
    if (field) field.select();
  });
}
export const ask = (title, body, opts) => {
  const i = body ? -1 : title.indexOf("? ");   // ("Remove X? It can't be undone." -> the question, then the explanation)
  return i > 0 ? dialog(title.slice(0, i + 1), title.slice(i + 2), opts) : dialog(title, body, opts);
};
export const askText = (title, value = "", opts = {}) => dialog(title, opts.body, { ...opts, input: { value, placeholder: opts.placeholder } });

// Is the person in the middle of typing in this part of the page? Then a redraw waits, and only then:
// any box, dropdown or slider with the cursor in it (redrawing would throw the cursor out or close the list).
// Clicking away, Tab or a save (change) catches up at once.
const FIELD = "input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=color]), textarea, select, [contenteditable=true]";
let unsaved = null, touched = 0, again = 0;
function later() { setTimeout(catchUp, 700); }   // (once more when the engine's answer to a save has surely arrived)
function catchUp() {
  clearTimeout(again);
  again = setTimeout(() => {   // (as if everything changed but the clock: "now" is old here and would set the clocks wrong)
    if (!App.state) return;
    const msg = Object.fromEntries(Object.entries(App.state).filter(([k]) => k !== "now"));
    for (const fn of App.listeners) fn(App.state, msg);
  }, 60);
}
addEventListener("focusin", () => { touched = Date.now(); }, true);
const TYPED = "input:not([type]), input[type=text], input[type=search], input[type=url], input[type=email], input[type=password], textarea, [contenteditable=true]";
addEventListener("input", e => { if (e.target.matches && e.target.matches(TYPED)) unsaved = e.target; touched = Date.now(); }, true);   // (only typed words hold a redraw, never a dropdown or a slider)
addEventListener("change", e => { if (unsaved === e.target) unsaved = null; touched = 0; catchUp(); later(); }, true);
addEventListener("focusout", e => { if (unsaved === e.target) unsaved = null; catchUp(); }, true);
// A button held down: a redraw before it's let go would swallow its click (catch up once it's let go).
let pressed = null, pressAt = 0;
addEventListener("pointerdown", e => { pressed = e.target; pressAt = Date.now(); }, true);
const release = () => { if (pressed) { pressed = null; catchUp(); } };
addEventListener("pointerup", release, true);
addEventListener("pointercancel", release, true);
export const typingIn = box => {
  const held = 1500 - (Date.now() - pressAt);   // (capped: a release outside the window never arrives)
  if (box && pressed && box.contains(pressed) && held > 0) { clearTimeout(again); again = setTimeout(catchUp, held); return true; }
  const a = document.activeElement;
  if (!box || !a || !box.contains(a) || !a.matches(FIELD)) return false;
  return true;   // (a box or dropdown with the cursor in it, typing or not, stays put; clicking away catches up)
};

// Update a part of the page in place to look like a freshly built copy: text, attributes, handlers and values
// change, nodes are added or removed, but the field with the cursor (and an open dropdown) is left exactly as it
// is, so live info keeps coming in while someone types. Same-place matching: fine for cards and lists.
const FORM = "input, select, textarea";
// (a list picked from lets go of the focus once the pick is made, so the next redraw shows what's really chosen,
// e.g. Global's "From the team list" after the team's name changes; an open list is still left alone)
if (typeof document !== "undefined") document.addEventListener("change", e => { if (e.target && e.target.matches && e.target.matches("select")) e.target.blur(); }, true);

export function morph(a, b) {
  if (a === b) return;
  if (a._whole || b._whole) { a.replaceWith(b); return; }   // (a node kept alive on purpose, e.g. a running iframe: swap it in or out whole, never morph it)
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName || (a.nodeType === 1 && a.type !== b.type)) { a.replaceWith(b); return; }
  if (a.nodeType === 3 || a.nodeType === 8) { if (a.data !== b.data) a.data = b.data; return; }
  if (a.nodeType !== 1) return;
  const busy = a === document.activeElement && a.matches(FIELD);
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
  for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  if (b._on) a._on = b._on;
  if (busy) return;   // (its typed words, its open list: untouched)
  morphKids(a, [...b.childNodes]);
  if (a.matches(FORM) && !a.hasAttribute("data-keep")) {   // (data-keep: a draft the person is filling in, saved by a button)
    if (a.type === "checkbox" || a.type === "radio") a.checked = b.checked;
    else if (a.value !== b.value) a.value = b.value;
  }
}
export function morphKids(parent, kids) {
  const ak = [...parent.childNodes];
  kids = kids.flat().filter(k => k != null && k !== false).map(k => typeof k === "string" ? document.createTextNode(k) : k);
  kids.forEach((k, i) => i < ak.length ? morph(ak[i], k) : parent.append(k));
  for (let i = kids.length; i < ak.length; i++) ak[i].remove();
}

// Chip boxes: text with live-data codes, the codes shown as labelled chips ("{{Global!Left name}}" reads
// "Left name"), as GFX Baby had. The saved value is still the plain text with its codes; a code typed in
// by hand becomes a chip once the box is left. Enter saves a one-line box.
export function chipLabel(code) {
  const c = code.replace(/^\{\{\s*|\s*\}\}$/g, "");
  const named = { time: "Clock", clock: "Clock", time24: "Clock (24 h)", date: "Date", timer: "Timer", sponsors: "Sponsor", "sponsors all": "All sponsors" }[c.toLowerCase()];
  if (named) return named;
  const cd = /^countdown\s*:\s*(.+)$/i.exec(c);
  if (cd) return `Countdown to ${cd[1]}`;
  const i = c.indexOf("!");
  if (i < 0) return c;
  const table = c.slice(0, i), field = c.slice(i + 1);
  return table === "Global" ? field : /^[A-Z]{1,3}\d+$/.test(field) ? `${table} ${field}` : `${table}: ${field.replace("#", " row ")}`;
}
export function chipBox(value, onSave, { multiline = false, placeholder = "", label = "" } = {}) {
  const box = el("div", { class: "chipbox" + (multiline ? " multi" : ""), contenteditable: "true", role: "textbox", "aria-multiline": String(multiline),
    "aria-label": label || placeholder, "data-placeholder": placeholder, spellcheck: "false" });
  const draw = v => box.replaceChildren(...String(v ?? "").split(/(\{\{[^{}]+\}\})/).filter(Boolean).map(p => /^\{\{[^{}]+\}\}$/.test(p)
    ? el("span", { class: "chip", contenteditable: "false", "data-code": p, title: p }, chipLabel(p)) : document.createTextNode(p)));
  const read = node => [...node.childNodes].map(n => n.nodeType === 3 ? n.nodeValue : n.dataset && n.dataset.code ? n.dataset.code
    : n.nodeName === "BR" ? "\n" : (n.nodeName === "DIV" || n.nodeName === "P" ? "\n" : "") + read(n)).join("");
  let last = String(value ?? "");
  draw(last);
  box.value = last;
  box.addEventListener("keydown", e => { if (e.key === "Enter" && !multiline) { e.preventDefault(); box.blur(); } });
  box.addEventListener("paste", e => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); });
  box.addEventListener("blur", () => {
    const v = read(box).replace(/\u00a0/g, " ");
    box.value = v;
    if (v !== last) { last = v; onSave(v); }
    draw(v);
  });
  box.set = v => { last = String(v ?? ""); box.value = last; draw(last); };   // (a value put in from outside, e.g. a live-data pick)
  return box;
}

// Live typing: on the setup pages a box saves as you type (a short pause counts as done), so the outputs follow
// in real time, not only when you leave the box. The page's own "change" handler does the saving, as on leaving.
// Not in the Composer / HUD Builder (they draw as you type already) nor connection settings (a half-typed address).
const LIVE_SKIP = ["page-composer", "page-hudbuilder", "page-outputs", "page-stream", "page-cams", "page-data"];
const liveTimers = new WeakMap();
addEventListener("input", e => {
  const t = e.target;
  if (!e.isTrusted || !t.matches || !t.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]), textarea')) return;
  const page = t.closest("main.page");
  if (!page || LIVE_SKIP.includes(page.id) || t.dataset.live === "off") return;
  clearTimeout(liveTimers.get(t));
  liveTimers.set(t, setTimeout(() => { if (t.isConnected) t.dispatchEvent(new Event("change", { bubbles: true })); }, t.type === "color" ? 120 : 350));
}, true);
