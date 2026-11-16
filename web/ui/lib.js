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
    if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
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
let assetCache = null;
export async function assets(force) {
  if (!assetCache || force) assetCache = (await fetch("/api/assets").then(r => r.json())).assets;
  return assetCache;
}
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
// a box with typed words not yet saved, or a field touched in the last moment (just clicked into, a dropdown
// or slider being moved). Once the words are saved (Enter, Tab, clicking off) the page catches up at once,
// even though the cursor is still in the box.
const FIELD = "input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=color]), textarea, select";
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
const TYPED = "input:not([type]), input[type=text], input[type=search], input[type=url], input[type=email], input[type=password], textarea";
addEventListener("input", e => { if (e.target.matches && e.target.matches(TYPED)) unsaved = e.target; touched = Date.now(); }, true);   // (only typed words hold a redraw, never a dropdown or a slider)
addEventListener("change", e => { if (unsaved === e.target) unsaved = null; touched = 0; catchUp(); later(); }, true);
addEventListener("focusout", e => { if (unsaved === e.target) unsaved = null; catchUp(); }, true);
export const typingIn = box => {
  const a = document.activeElement;
  if (!box || !a || !box.contains(a) || !a.matches(FIELD)) return false;
  if (a === unsaved) return true;
  const wait = 900 - (Date.now() - touched);
  if (wait > 0) { clearTimeout(again); again = setTimeout(catchUp, wait); return true; }
  return false;
};
