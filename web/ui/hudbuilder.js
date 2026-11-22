// HUD Builder: a game's broadcast HUD, its own tool (not the Composer). A HUD has parts (top bar, player tabs, ...);
// each part has layers drawn by the engine from live game data. The middle shows the HUD itself, live (its browser
// source), with handles on top to move and size the layers of the part being edited.
import { $, el, api, App, toast, pages, askText, ask, picker, typingIn } from "./lib.js";

const W = 1920, H = 1080;
const FONTS = ["Inter", "Barlow Condensed", "Anton", "Bebas Neue", "Montserrat", "Permanent Marker", "Vazirmatn"];
const ANIMS = [["none", "None"], ["fade", "Fade"], ["push-right", "Push in from the left"], ["push-left", "Push in from the right"], ["push-up", "Push up from the bottom"],
  ["slide-down", "Slide down"], ["slide-up", "Slide up"], ["pop", "Pop"], ["scale", "Scale"], ["grow-x", "Grow sideways"], ["wipe-right", "Wipe from the left"], ["blur", "Blur"]];
let hudId = null, partId = null, sel = null, hud = null, dirty = false, saveTimer = null, undo = [];
let built = false, view = "list", mode = "live", bg = "checker", demo = false;
const GAMES = { valorant: "VALORANT", val: "VALORANT", lol: "League of Legends", league: "League of Legends", rl: "Rocket League", rocket: "Rocket League", other: "Other" };
const gameName = g => GAMES[String(g || "other").toLowerCase()] || g;
// The Show buttons: see one phase of the HUD without a game (fields forced in the preview only, never on air).
const PHASES = {
  VALORANT: [["Round in play", { "In round": "yes", "Names": "yes", "Condensed": "", "Top on": "yes", "Buy phase": "", "Planted": "", "Round won": "", "Select on": "" }],
    ["Top bar small", { "In round": "yes", "Names": "", "Condensed": "yes", "Top on": "yes", "Buy phase": "", "Planted": "", "Select on": "" }],
    ["Spike planted", { "In round": "yes", "Names": "", "Condensed": "yes", "Top on": "yes", "Planted": "yes", "Buy phase": "", "Select on": "" }],
    ["Buy phase", { "Buy phase": "yes", "In round": "", "Names": "yes", "Top on": "yes", "Planted": "", "Select on": "" }],
    ["Round win", { "Round won": "yes", "Names": "yes", "Top on": "yes", "Banner": "ROUND WIN" }],
    ["Agent select", { "Select on": "yes", "Top on": "", "In round": "", "Buy phase": "" }]],
};

const huds = () => (App.state.project.huds || []);
const part = () => hud && hud.parts.find(p => p.id === partId);
const layer = () => part() && part().layers.find(l => l.id === sel);
const uid = () => Math.random().toString(16).slice(2, 10);

function edit(fn, now) {   // every change: kept for undo, drawn, saved a moment later
  undo.push(JSON.stringify(hud)); if (undo.length > 80) undo.shift();
  fn(); dirty = true; drawBoxes(); drawSide(); drawProps();
  clearTimeout(saveTimer); saveTimer = setTimeout(save, now ? 0 : 350);
}
async function save() {
  if (!hud || !dirty) return; dirty = false; const m = $("#hb-saved"); if (m) m.textContent = "Saving…";
  try { await api("/api/hud", hud); if (m) m.textContent = "Saved · on air"; } catch (e) { dirty = true; if (m) m.textContent = "Not saved"; }
}

// --- the page: a gallery of HUDs by game, or the editor (HUDs + parts + layers | the HUD | settings) --------
function build() {
  if (built) return; built = true;
  $("#page-hudbuilder").replaceChildren(
    el("div", { class: "hb-gallery", id: "hb-gallery" }),
    el("div", { class: "hb", id: "hb-editor", hidden: true },
      el("div", { class: "hb-left" },
        el("div", { class: "panel" }, el("div", { class: "panel-head" }, el("h3", {}, "HUDs"), el("button", { class: "small", onclick: () => show("list") }, "All HUDs")), el("div", { class: "list", id: "hb-huds" })),
        el("div", { class: "panel" }, el("div", { class: "panel-head" }, el("h3", {}, "Parts"), el("button", { class: "small", onclick: newPart }, "+ Part")), el("div", { class: "list", id: "hb-parts" })),
        el("div", { class: "panel grow" }, el("div", { class: "panel-head" }, el("h3", {}, "Layers"),
          el("div", { class: "hb-add" }, el("button", { class: "small", title: "Add text", onclick: () => add("text") }, "T"), el("button", { class: "small", title: "Add a box", onclick: () => add("rect") }, "▭"),
            el("button", { class: "small", title: "Add a picture", onclick: () => add("image") }, "▣"))), el("div", { class: "list", id: "hb-layers" }))),
      el("div", { class: "hb-mid" },
        el("div", { class: "hb-head", id: "hb-head" }),
        el("div", { class: "hb-show", id: "hb-show" }),
        el("div", { class: "hb-view", id: "hb-view" },
          el("div", { class: "hb-stage", id: "hb-stage" }, el("iframe", { id: "hb-live", title: "The HUD, live" }), el("div", { class: "hb-boxes", id: "hb-boxes" })))),
      el("div", { class: "hb-right panel", id: "hb-props" })));
  $("#hb-boxes").addEventListener("pointerdown", down);
  addEventListener("resize", fit);
  addEventListener("keydown", key);
}
function show(v) { view = v; if (v === "list") { save(); hudId = hud = null; } $("#hb-gallery").hidden = v !== "list"; $("#hb-editor").hidden = v === "list"; v === "list" ? drawGallery() : drawAll(); }

function fit() {
  const v = $("#hb-view"); if (!v || !v.clientWidth) return;
  const k = Math.min(v.clientWidth / W, (innerHeight - 230) / H);
  const s = $("#hb-stage"); s.style.transform = `scale(${k})`; s.style.width = W + "px"; s.style.height = H + "px";
  v.style.height = H * k + "px";
}

function preview() {   // the iframe's link: the HUD, with the Show mode and background (the browser source itself stays live)
  if (!hud) return "about:blank";
  const ph = (PHASES[gameName(hud.game)] || []).find(([n]) => n === mode);
  return `/output?hud=${encodeURIComponent(hud.id)}&bg=${bg}` + (mode === "all" ? "&all=1" : "") + (ph ? "&force=" + encodeURIComponent(JSON.stringify({ [gameName(hud.game)]: ph[1] })) : "");
}
function reload(force) { const f = $("#hb-live"), want = preview(); if (force || f.getAttribute("src") !== want) { f.setAttribute("src", "about:blank"); setTimeout(() => f.setAttribute("src", want), force ? 30 : 0); } }

function open(id) {
  save();
  const h = huds().find(x => x.id === id);
  hudId = id; hud = h ? JSON.parse(JSON.stringify(h)) : null; undo = [];
  if (!(PHASES[gameName(hud && hud.game)] || []).some(([n]) => n === mode) && mode !== "all") mode = "live";
  partId = hud && hud.parts[0] ? hud.parts[0].id : null; sel = null;
  view = "edit"; $("#hb-gallery").hidden = true; $("#hb-editor").hidden = false;
  reload();
  drawAll();
}
function drawAll() { drawHuds(); drawSide(); drawTools(); drawBoxes(); drawProps(); setTimeout(fit, 0); }

function drawGallery() {
  const by = {};
  for (const h of huds()) (by[gameName(h.game)] = by[gameName(h.game)] || []).push(h);
  const tables = App.state.data.tables || {}, live = g => ((tables[g] || []).find(r => r[0] === "Status") || [])[1] === "on";
  $("#hb-gallery").replaceChildren(
    el("div", { class: "hb-gal-head" }, el("div", {}, el("h2", {}, "HUDs"),
      el("p", { class: "muted" }, "Each game's broadcast HUD: open one to move, resize, recolour or add boxes, text and pictures. Its live data keeps working while you edit.")),
      el("span", { class: "spacer" }), el("button", { class: "primary", onclick: newHud }, "New HUD")),
    ...Object.entries(by).map(([g, list]) => el("section", { class: "hb-game" },
      el("h3", {}, g, live(g) ? el("span", { class: "hb-live-tag" }, "Game running") : ""),
      el("div", { class: "hb-cards" }, ...list.map(h => el("div", { class: "hb-card", role: "button", tabindex: "0", onclick: () => open(h.id), onkeydown: e => { if (e.key === "Enter") open(h.id); } },
        el("div", { class: "name" }, h.name), el("div", { class: "muted small" }, `${h.parts.length} parts` + (h.key ? " · built-in" : "")),
        el("div", { class: "row" }, el("button", { class: "small primary" }, "Edit"),
          el("button", { class: "small ghost", onclick: e => { e.stopPropagation(); navigator.clipboard.writeText(`${location.origin}/hud/${h.id}`).then(() => toast("Browser source link copied")); } }, "Copy OBS link"))))))),
    huds().length ? "" : el("div", { class: "hb-empty" }, el("h3", {}, "Make your first HUD"),
      el("p", { class: "muted" }, "The VALORANT HUD appears here with the first VALORANT data (try the demo match on the Outputs page), or start your own."),
      el("button", { class: "primary", onclick: newHud }, "New HUD")));
}

function drawHuds() {
  $("#hb-huds").replaceChildren(...huds().map(h => el("div", { class: "gfx" + (h.id === hudId ? " sel" : ""), onclick: () => open(h.id) },
    el("div", {}, el("div", { class: "name" }, `${gameName(h.game)} · ${h.name}`), el("div", { class: "sub" }, `${h.parts.length} parts`)))));
}

function drawSide() {
  if (!hud) { $("#hb-parts").replaceChildren(); $("#hb-layers").replaceChildren(); return; }
  $("#hb-parts").replaceChildren(...hud.parts.map(p => el("div", { class: "gfx" + (p.id === partId ? " sel" : ""), onclick: () => { partId = p.id; sel = null; drawSide(); drawBoxes(); drawProps(); } },
    el("label", { class: "switch", title: "Shown in the HUD", onclick: e => e.stopPropagation() }, el("input", { type: "checkbox", checked: p.on !== false, onchange: e => edit(() => { p.on = e.target.checked; }, true) })),
    el("div", {}, el("div", { class: "name" }, p.name), el("div", { class: "sub" }, `${p.layers.length} layers`)))));
  const p = part();
  $("#hb-layers").replaceChildren(...(p ? [...p.layers].reverse().map(l => el("div", { class: "gfx" + (l.id === sel ? " sel" : ""), onclick: () => select(l.id) },
    el("span", { class: "muted small" }, { text: "T", rect: "▭", image: "▣" }[l.type] || "◆"), el("div", { class: "name" }, l.name, l.show ? el("span", { class: "muted small" }, "  ·  live") : ""))) : []));
}

function drawTools() {
  const t = $("#hb-head"), sh = $("#hb-show");
  if (!hud) { t.replaceChildren(); sh.replaceChildren(); return; }
  const url = `${location.origin}/hud/${hud.id}`;
  const item = (txt, fn) => el("button", { onclick: e => { e.target.closest("details").open = false; fn(); } }, txt);
  t.replaceChildren(
    el("h3", {}, hud.name), el("span", { class: "muted small" }, gameName(hud.game)),
    el("span", { class: "spacer" }),
    el("button", { class: "small", title: "Undo (Ctrl+Z)", onclick: doUndo, disabled: !undo.length }, "↶ Undo"),
    el("button", { class: "small", title: "Play the HUD's animations again", onclick: () => reload(true) }, "▶ Replay"),
    el("select", { class: "small", "aria-label": "Background", onchange: e => { bg = e.target.value; reload(); } },
      ...[["checker", "Checker"], ["dark", "Dark"], ["green", "Green"]].map(([v, n]) => el("option", { value: v, selected: bg === v }, n))),
    el("span", { class: "muted small hb-saved", id: "hb-saved" }, dirty ? "Saving…" : "Saved · on air"),
    el("details", { class: "menu hb-menu" }, el("summary", { class: "small" }, "More"), el("div", { class: "menu-list" },
      item("Copy OBS link", () => navigator.clipboard.writeText(url).then(() => toast("Browser source link copied"))),
      item("Open the HUD", () => window.open(`/hud/${hud.id}`, "_blank")),
      item("Control page", () => window.open(`/hud/${hud.id}/control`, "_blank")),
      el("label", { class: "btn", title: "A Figma file (File > Save local copy): each frame becomes a part" }, "Import Figma…", el("input", { type: "file", accept: ".fig", hidden: true, onchange: figma })),
      item("Rename", renameHud),
      hud.key ? item("Reset to built-in", rebuildHud) : "",
      item("Delete HUD", deleteHud))));
  const chip = (k, n) => el("button", { class: "small" + (mode === k ? " on" : ""), onclick: () => { mode = k; drawTools(); reload(); } }, n);
  const g = gameName(hud.game);
  sh.replaceChildren(el("span", { class: "muted small" }, "Show:"), chip("live", "Live"), chip("all", "Everything"), ...(PHASES[g] || []).map(([n]) => chip(n, n)),
    g === "VALORANT" ? el("button", { class: "small ghost", title: "A made-up match, so names, money and guns show without a game", onclick: () => api("/api/val/demo", { on: !demo }).then(r => { demo = r.on; toast(r.on ? "Sample match on" : "Sample match off"); drawTools(); }) }, demo ? "Stop sample match" : "Sample match") : "");
}

// --- the handles over the live HUD -------------------------------------------------------------------
function drawBoxes() {
  const p = part(), box = $("#hb-boxes");
  if (!p) return box.replaceChildren();
  if (p.on === false) return box.replaceChildren(el("div", { class: "hb-off" }, `“${p.name}” is switched off in Parts, so it isn't in the HUD. Switch it on to see and edit it.`));
  box.replaceChildren(...p.layers.map(l => el("div", { class: "hb-box" + (l.id === sel ? " sel" : "") + (l.show ? " live" : ""), "data-id": l.id,
    style: `left:${l.x}px;top:${l.y}px;width:${Math.max(1, l.w)}px;height:${Math.max(1, l.h)}px` },
    ...(l.id === sel ? ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map(h => el("i", { class: "hd " + h, "data-h": h })) : []))));
}
function select(id) { sel = id; drawSide(); drawBoxes(); drawProps(); }

let drag = null;
function down(e) {
  const b = e.target.closest(".hb-box"); if (!b) { select(null); return; }
  const l = part().layers.find(x => x.id === b.dataset.id); if (!l) return;
  if (l.id !== sel) select(l.id);
  const k = $("#hb-stage").getBoundingClientRect().width / W;
  drag = { l, h: e.target.dataset.h || "", x: e.clientX, y: e.clientY, k, start: { x: l.x, y: l.y, w: l.w, h: l.h }, before: JSON.stringify(hud) };
  e.preventDefault();
  addEventListener("pointermove", move); addEventListener("pointerup", up, { once: true });
}
function move(e) {
  if (!drag) return;
  const dx = Math.round((e.clientX - drag.x) / drag.k), dy = Math.round((e.clientY - drag.y) / drag.k), s = drag.start, l = drag.l, h = drag.h;
  if (!h) { l.x = s.x + dx; l.y = s.y + dy; }
  else {
    if (h.includes("e")) l.w = Math.max(2, s.w + dx);
    if (h.includes("s")) l.h = Math.max(2, s.h + dy);
    if (h.includes("w")) { l.x = s.x + Math.min(dx, s.w - 2); l.w = Math.max(2, s.w - dx); }
    if (h.includes("n")) { l.y = s.y + Math.min(dy, s.h - 2); l.h = Math.max(2, s.h - dy); }
  }
  drawBoxes(); drawProps(true);
  dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(save, 120);   // (the HUD behind follows as you drag)
}
function up() { removeEventListener("pointermove", move); if (drag && JSON.stringify(hud) !== drag.before) { undo.push(drag.before); save(); } drag = null; }
function key(e) {
  if (App.page !== "hudbuilder" || !layer() || typingIn(document.body)) return;
  const d = e.shiftKey ? 10 : 1, l = layer(), m = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
  if (m) { e.preventDefault(); edit(() => { l.x += m[0]; l.y += m[1]; }); }
  else if (e.key === "Delete") remove();
  else if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); doUndo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key === "d") { e.preventDefault(); dup(); }
}

// --- layer actions -----------------------------------------------------------------------------------
function add(type) {
  const p = part(); if (!p) return toast("Pick a part first (or + Part)");
  const base = { id: "l" + uid(), type, name: { text: "Text", rect: "Box", image: "Picture" }[type], x: 860, y: 480, w: 200, h: 80, opacity: 1, rotation: 0, visible: true, blend: "normal",
    anim: { in: { type: "fade", dur: 300, delay: 0 }, out: { type: "fade", dur: 250, delay: 0 } } };
  const extra = type === "text" ? { text: "Text", font: "Inter", size: 32, weight: 700, color: "#ffffff", align: "center", valign: "middle", caps: false, fit: "shrink", lineHeight: 1.15 }
    : type === "rect" ? { fill: "#111823", radius: 0, stroke: "#ffffff", strokeWidth: 0 } : { src: "", fit: "contain" };
  const l = { ...base, ...extra };
  edit(() => p.layers.push(l)); select(l.id);
}
function dup() { const l = layer(); if (!l) return; const c = { ...JSON.parse(JSON.stringify(l)), id: "l" + uid(), name: l.name + " copy", x: l.x + 20, y: l.y + 20 }; edit(() => part().layers.splice(part().layers.indexOf(l) + 1, 0, c)); select(c.id); }
function remove() { const l = layer(); if (!l) return; edit(() => part().layers.splice(part().layers.indexOf(l), 1)); sel = null; drawAll(); }
function order(d) { const p = part(), l = layer(); if (!l) return; const i = p.layers.indexOf(l), j = Math.max(0, Math.min(p.layers.length - 1, i + d)); edit(() => { p.layers.splice(i, 1); p.layers.splice(j, 0, l); }); }
function doUndo() { const s = undo.pop(); if (!s) return toast("Nothing to undo"); hud = JSON.parse(s); dirty = true; save(); drawAll(); }

async function newHud() {
  const name = await askText("Name of the new HUD", "New HUD"); if (!name) return;
  const r = await api("/api/hud", { name, game: "other", parts: [{ name: "Main", on: true, layers: [] }] });
  setTimeout(() => open(r.hud.id), 200);
}
async function newPart() {
  if (!hud) return; const name = await askText("Name of the new part", "New part"); if (!name) return;
  const p = { id: uid(), name, on: true, layers: [] }; edit(() => hud.parts.push(p), true); partId = p.id; drawAll();
}
async function renameHud() { const n = await askText("HUD name", hud.name); if (n) edit(() => { hud.name = n; }, true); setTimeout(drawHuds, 400); }
async function rebuildHud() {
  if (!(await ask(`Reset "${hud.name}" to the built-in look?`, "Your changes to its layers are replaced by the latest built-in version. The current one is kept in the workspace's bin. Which parts are shown stays as it is."))) return;
  await save(); await api("/api/hud/rebuild", { id: hud.id }); toast("Reset to the built-in look"); setTimeout(() => open(hud.id), 300);
}
async function deleteHud() { if (!(await ask(`Delete "${hud.name}"?`, "It's put aside in the workspace's bin, not deleted for good."))) return; await api("/api/hud/delete", { id: hud.id }); show("list"); }

async function figma(e) {
  const f = e.target.files[0]; e.target.value = ""; if (!f || !hud) return;
  toast("Reading the Figma file…");
  const r = await fetch(`/api/hud/figma?hud=${encodeURIComponent(hud.id)}&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return toast(j.error || "Couldn't read that Figma file");
  toast(`${j.parts} part${j.parts === 1 ? "" : "s"} added from Figma (${j.layers} layers)`);
  setTimeout(() => open(hud.id), 300);
}

// --- the selected layer's settings -----------------------------------------------------------------------
function fieldsList() {   // every live-data field, as {{Table!Field}}
  const t = App.state.data.tables || {}, out = [];
  for (const name of ["VALORANT", "League", "Rocket League", "Global"]) for (const r of (t[name] || []).slice(1)) out.push(`{{${name}!${r[0]}}}`);
  return out;
}
function drawProps(quiet) {
  const box = $("#hb-props"), l = layer();
  if (quiet && box.contains(document.activeElement)) {   // (dragging: only the numbers move)
    for (const k of ["x", "y", "w", "h"]) { const i = box.querySelector(`[data-k="${k}"]`); if (i && document.activeElement !== i) i.value = l[k]; }
    return;
  }
  if (!l) return box.replaceChildren(el("h3", {}, hud ? hud.name : "Layer"), hud ? el("p", { class: "muted small" }, `${gameName(hud.game)} HUD · ${hud.parts.length} parts`) : "",
    el("h4", {}, "How it works"),
    el("p", { class: "muted small" }, "Click any part of the HUD to change it: drag to move, the handles to size, arrow keys to nudge (Shift: 10 px). Delete removes it, Ctrl+Z puts it back."),
    el("p", { class: "muted small" }, "Live data keeps working while you edit: names, scores, timers and pictures from the game."),
    el("p", { class: "muted small" }, "Parts that only show now and then (agent select, a round win): pick them under Show to see them without a game. That only changes this preview."),
    el("p", { class: "muted small" }, "Changes save by themselves and are on air at once, wherever the HUD is shown."));
  const set = (k, v) => edit(() => { if (v === "" || v == null) delete l[k]; else l[k] = v; });
  const inp = (k, type = "text", extra = {}) => el("input", { type, value: l[k] ?? "", "data-k": k, ...extra, onchange: e => set(k, type === "number" ? +e.target.value : e.target.value) });
  const lab = (t, ...kids) => el("label", { class: "f" }, el("span", {}, t), ...kids);
  const pick = (k) => el("select", { "aria-label": "Insert live data", onchange: e => { if (e.target.value) set(k, (l[k] || "") + e.target.value); e.target.value = ""; } },
    el("option", { value: "" }, "+ live data…"), ...fieldsList().map(f => el("option", { value: f }, f.replace(/^\{\{|\}\}$/g, ""))));
  const a = l.anim || { in: {}, out: {} }, setAnim = (dir, k, v) => edit(() => { l.anim = l.anim || { in: {}, out: {} }; l.anim[dir] = { ...(l.anim[dir] || {}), [k]: v }; });
  const animRow = dir => el("div", { class: "two" },
    lab(dir === "in" ? "Comes in" : "Goes out", el("select", { onchange: e => setAnim(dir, "type", e.target.value) }, ...ANIMS.map(([v, t]) => el("option", { value: v, selected: ((a[dir] || {}).type || "none") === v }, t)))),
    lab("ms", el("input", { type: "number", value: (a[dir] || {}).dur ?? 300, onchange: e => setAnim(dir, "dur", +e.target.value) })));
  box.replaceChildren(
    el("div", { class: "row" }, el("h3", { style: "flex:1;margin:0" }, "Layer"),
      el("button", { class: "small ghost", title: "Duplicate (Ctrl+D)", onclick: dup }, "Duplicate"), el("button", { class: "small ghost", title: "Forward", onclick: () => order(1) }, "↑"),
      el("button", { class: "small ghost", title: "Back", onclick: () => order(-1) }, "↓"), el("button", { class: "small ghost", title: "Delete", onclick: remove }, "Delete")),
    lab("Name", inp("name")),
    el("div", { class: "two" }, lab("X", inp("x", "number")), lab("Y", inp("y", "number"))),
    el("div", { class: "two" }, lab("Width", inp("w", "number")), lab("Height", inp("h", "number"))),
    lab("Opacity (0-1)", inp("opacity", "number", { step: 0.05, min: 0, max: 1 })),
    lab("Show only while", inp("show", "text", { placeholder: "always (or a live field)" }), pick("show")),
    l.type === "text" ? [lab("Words", inp("text"), pick("text")),
      el("div", { class: "two" }, lab("Font", el("select", { onchange: e => set("font", e.target.value) }, ...[...new Set([...FONTS, l.font])].map(f => el("option", { selected: f === l.font }, f)))), lab("Size", inp("size", "number"))),
      el("div", { class: "two" }, lab("Weight", inp("weight", "number", { step: 100 })), lab("Colour", inp("color", "text"))),
      lab("Align", el("select", { onchange: e => set("align", e.target.value) }, ...["left", "center", "right"].map(v => el("option", { selected: (l.align || "center") === v }, v))))] : null,
    l.type === "rect" ? [lab("Fill (colour or gradient)", inp("fill"), pick("fill")), el("div", { class: "two" }, lab("Corners", inp("radius", "text", { placeholder: "10, or 25 0 25 0" })), lab("Outline", inp("strokeWidth", "number"))),
      lab("Outline colour", inp("stroke"))] : null,
    l.type === "image" ? [lab("Picture", inp("src"), pick("src"), picker("image", "", p => set("src", p))),
      el("div", { class: "two" }, lab("Fit", el("select", { onchange: e => set("fit", e.target.value) }, ...["contain", "cover", "fill"].map(v => el("option", { selected: (l.fit || "contain") === v }, v)))), lab("Corners", inp("radius")))] : null,
    el("h4", {}, "Animation"), animRow("in"), animRow("out"),
    el("p", { class: "muted small" }, "A layer with “Show only while” plays these as the game makes it appear and go."));
}

pages.hudbuilder = { shown() { build(); view === "list" || !hud ? show("list") : drawAll(); } };
let sig = "";
App.on(st => {
  if (App.page !== "hudbuilder" || !built) return;
  const s = JSON.stringify(st.project.huds || []);
  if (s === sig) return; sig = s;
  if (view === "list") return drawGallery();
  drawHuds();
  const h = (st.project.huds || []).find(x => x.id === hudId);
  if (h && !dirty && !drag && JSON.stringify(h) !== JSON.stringify(hud) && !typingIn($("#hb-props"))) { hud = JSON.parse(JSON.stringify(h)); drawSide(); drawBoxes(); drawProps(); drawTools(); }
});
