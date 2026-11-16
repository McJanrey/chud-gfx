// The Control page: Preview / Program, transitions, TAKE, the graphics list and each graphic's fields.
import { $, el, api, toast, App, pages, typingIn } from "./lib.js";

let S = null, selected = null, transition = null, filter = "";
const KINDS = [["board", "Full-page boards"], ["lower third", "Lower thirds"], ["overlay", "Overlays"]];
const CONTENT = { text: "text", rect: "fill", shape: "fill", image: "src", video: "src" };
const comp = id => S.project.compositions.find(c => c.id === id);
const names = ids => ids.map(id => (comp(id) || {}).name).filter(Boolean).join(", ") || "—";

// --- monitors -------------------------------------------------------------------
$("#mon-pvw").src = "output?bus=preview&monitor=1&bg=checker";
$("#mon-pgm").src = "output?monitor=1&bg=checker";

// --- transitions + take ---------------------------------------------------------
// TAKE plays each graphic's own In / Out animations; a chip swaps that for a whole-screen transition
// (fade, wipe, dip, stinger). Clicking the lit chip goes back to the graphics' own animations.
const OWN = t => !t || t.type === "animate" || t.type === "cut";
let picked = undefined;   // (undefined: the default transition; null: the graphics' own animations)
function chosen() {
  const ts = (S.project.transitions || []).filter(t => t.enabled !== false && !OWN(t));
  if (picked === undefined) { const d = ts.find(t => t.id === S.project.default_transition); return d ? d.id : null; }
  return ts.some(t => t.id === picked) ? picked : null;
}
function renderChips() {
  const ts = (S.project.transitions || []).filter(t => t.enabled !== false && !OWN(t));
  const cur = chosen();
  $("#chips").replaceChildren(...ts.map(t => el("button", { role: "radio", "aria-checked": String(t.id === cur), title: t.id === cur ? "Click again for the graphics' own animations" : t.name,
    onclick: () => { picked = t.id === cur ? null : t.id; renderChips(); } }, t.name)));
  const name = (ts.find(t => t.id === cur) || {}).name;
  $("#take").replaceChildren("TAKE", el("small", {}, name || "own animations"));
}
$("#take").addEventListener("click", () => api("/api/take", { transition: chosen() || "animate" }));
$("#cut").addEventListener("click", () => api("/api/take", { transition: "cut" }));
$("#pvw-clear").addEventListener("click", () => api("/api/clear", { bus: "preview" }));
$("#undo").addEventListener("click", () => api("/api/undo"));
$("#pgm-clear").addEventListener("click", async () => {
  const had = S.live.program.on.length;
  await api("/api/clear", { bus: "program" });
  if (had) toast("Program cleared", { label: "Undo", run: () => api("/api/undo") });
});
// (no keyboard shortcuts for TAKE, CUT or transitions: buttons or a Stream Deck only)

// --- graphics list --------------------------------------------------------------
function fieldsOf(c) {
  return (c.layers || []).filter(l => l.field && CONTENT[l.type]);
}
function renderGraphics() {
  const pv = S.live.preview.on, pg = S.live.program.on;
  const rows = [];
  for (const [kind, label] of KINDS) {
    const list = S.project.compositions.filter(c => (c.kind || "overlay") === kind && c.name.toLowerCase().includes(filter));
    if (!list.length) continue;
    rows.push(el("div", { class: "kind" }, label));
    for (const c of list) {
      const onPv = pv.includes(c.id), onPg = pg.includes(c.id);
      rows.push(el("div", { class: `gfx${onPv ? " on-pvw" : ""}${onPg ? " on-pgm" : ""}${selected === c.id ? " sel" : ""}`, onclick: () => { selected = c.id; render(); } },
        el("span", { class: "bar-ind" }),
        el("div", {}, el("div", { class: "name" }, c.name), el("div", { class: "sub" }, `${fieldsOf(c).length} fields${onPg ? " · on air" : onPv ? " · on preview" : ""}`)),
        el("div", { class: "btns" },
          el("button", { class: "pvw" + (onPv ? " on" : ""), title: "Put on Preview", onclick: e => { e.stopPropagation(); api("/api/cue", { id: c.id, on: !onPv }); } }, "PVW"),
          el("button", { class: "in" + (onPg ? " on" : ""), title: onPg ? "Take off Program" : "Straight to Program", onclick: e => { e.stopPropagation(); api("/api/program", { id: c.id, on: !onPg }); } }, onPg ? "OUT" : "IN"))));
    }
  }
  $("#graphics").replaceChildren(...rows);
}
$("#find").addEventListener("input", e => { filter = e.target.value.toLowerCase(); renderGraphics(); });

// --- fields of the selected graphic --------------------------------------------
let fieldsSig = "";
function renderFields() {
  const c = selected && comp(selected);
  const sig = JSON.stringify([selected, c && c.layers.map(l => l.field), S.live.preview.values[selected], S.live.program.values[selected], (S.project.global || {}).timer]);
  if (sig === fieldsSig || typingIn($("#fields"))) return;
  fieldsSig = sig;
  $("#send").hidden = !c || !S.live.program.on.includes(selected);
  $("#fields-title").textContent = c ? c.name : "Fields";
  if (!c) return $("#fields").replaceChildren(el("p", { class: "muted empty" }, "Pick a graphic to set what it shows."));
  const fs = fieldsOf(c);
  const timer = /\{\{\s*timer\s*\}\}/i.test(JSON.stringify(c.layers)) ? timerBlock() : null;
  if (!fs.length) return $("#fields").replaceChildren(...(timer ? [timer] : [el("p", { class: "muted empty" }, "This graphic has no fields.")]));
  const vals = S.live.preview.values[c.id] || {};
  const seen = new Set();
  // reading order (top to bottom, left to right); a graphic with slots: slot by slot (each caster's name, then handle)
  const slotted = c.slots && c.slots.on;
  const order = (a, b) => (slotted ? (+a.slot || 99) - (+b.slot || 99) : 0) || (Math.round(a.y / 8) - Math.round(b.y / 8)) || (a.x - b.x);
  let lastSlot = null;
  $("#fields").replaceChildren(...(timer ? [timer] : []), ...fs.filter(l => !seen.has(l.field) && seen.add(l.field)).sort(order).flatMap(l => {
    const head = slotted && (+l.slot || 0) !== lastSlot ? [el("div", { class: "field-group" }, +l.slot ? `Slot ${+l.slot}` : "Other")] : [];
    lastSlot = +l.slot || 0;
    return [...head, fieldRow(l)];
  }));
  function fieldRow(l) {
    const key = CONTENT[l.type];
    const input = el("input", { value: vals[l.field] ?? l[key] ?? "", placeholder: l[key] || "", "aria-label": l.field,
      onchange: e => api("/api/values", { id: c.id, values: { [l.field]: e.target.value } }) });
    if (key === "fill" && /^#[0-9a-f]{6}$/i.test(vals[l.field] || l[key] || "")) input.type = "color";
    return el("div", { class: "field" }, el("label", {}, l.field, el("span", { class: "kindtag" }, l.type)), input);
  }
}
// The Global timer ({{TIMER}}): start / pause, reset to its start time, up or down. It runs on air too.
const mmss = t => (t >= 3600 ? Math.floor(t / 3600) + ":" : "") + String(Math.floor(t / 60) % 60).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
let skewT = 0;
function timerNow() {
  const t = (S.project.global || {}).timer || {}, ran = t.started ? Math.max(0, Date.now() / 1000 + skewT - t.started) : 0;
  return t.down ? Math.max(0, Math.ceil((+t.secs || 0) - ran)) : Math.floor((+t.secs || 0) + ran);
}
function timerBlock() {
  const t = (S.project.global || {}).timer || {}, act = (action, extra = {}) => api("/api/timer", { action, ...extra });
  return el("div", { class: "field timer" }, el("label", {}, "Timer", el("span", { class: "kindtag" }, "global")),
    el("div", { class: "row" }, el("b", { class: "timer-now", id: "timer-now" }, mmss(timerNow())),
      el("button", { class: "small primary", onclick: () => act(t.started ? "pause" : "start") }, t.started ? "Pause" : "Start"),
      el("button", { class: "small", onclick: () => act("reset") }, "Reset"),
      el("div", { class: "seg" }, el("button", { class: "small" + (t.down ? "" : " on"), onclick: () => act("down", { down: false }) }, "Counts up"),
        el("button", { class: "small" + (t.down ? " on" : ""), onclick: () => act("down", { down: true }) }, "Counts down"))),
    el("input", { value: mmss(+t.from || 0), "aria-label": "Starts from", placeholder: "m:ss", onchange: e => act("from", { from: e.target.value }) }),
    el("p", { class: "muted small" }, "Type the time it starts from (m:ss). Reset goes back to it. It runs on air too."));
}
setInterval(() => { const n = $("#timer-now"); if (n && S) n.textContent = mmss(timerNow()); }, 250);
$("#send").addEventListener("click", () => api("/api/send", { id: selected }));

// --- on air clock, pills --------------------------------------------------------
let takeSeq = null, takeAt = Date.now();
setInterval(() => {
  if (!S || !S.live.program.on.length) return ($("#pgm-clock").textContent = "");
  const s = Math.floor((Date.now() - takeAt) / 1000);
  $("#pgm-clock").textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}, 500);

function render() {
  const cut = S.live.cut || {};
  if (cut.seq !== takeSeq) { takeSeq = cut.seq; takeAt = Date.now(); }
  $("#pvw-list").textContent = names(S.live.preview.on);
  $("#pgm-list").textContent = names(S.live.program.on);
  $("#undo").disabled = !cut.undo;
  const n = S.live.program.on.length, pill = $("#air-pill");
  pill.textContent = n ? `${n} on air` : "Nothing on air";
  pill.classList.toggle("live", !!n);
  $("#ws-name").textContent = $("#crumb-ws").textContent = S.project.name || "Workspace";
  document.title = `${S.project.name || "Workspace"} · StandBy GFX`;
  renderChips(); renderGraphics(); renderFields();
}

App.on((st, msg) => { S = st; if (!msg || msg.now) skewT = st.now - Date.now() / 1000; render(); });
pages.control = { shown() { if (S) render(); } };
