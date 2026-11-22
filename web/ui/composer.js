// Composer: make and change graphics. Graphics list + layers on the left, the canvas in the middle,
// the picked layer's (or graphic's) settings on the right. Changes save as they're made; Ctrl+Z / Ctrl+Y undo / redo.
import { $, el, api, App, pages, picker, toast, upload, askText, typingIn, chipBox } from "./lib.js";
import { Stage, W, H } from "../engine/stage.js";
import { play } from "../engine/anim.js";
import { clipShapes } from "../engine/layers/box.js";
import { LOOKS } from "../engine/layers/shader.js";

let comp = null, compId = null, sel = new Set(), undo = [], redo = [], saveTimer = null, dirty = false, dragging = false;
// HUD mode: the HUD Builder edits one part of a HUD here (same canvas and tools); the rest of the HUD shows dimmed
// behind it, and its Show buttons decide which phase the live data is in (all: every layer, force: fields set).
let hudCtx = null, lastData = null, lastHud = null;
const editing = () => App.page === "composer" || (App.page === "hudbuilder" && !!hudCtx);
const hudOf = () => hudCtx && (App.state.project.huds || []).find(h => h.id === hudCtx.hudId);
// Ruler guides as [{axis, at}]; a graphic from GFX Baby keeps them as {x: [...], y: [...]}: read either.
const guides = () => {
  const g = comp.guides;
  if (Array.isArray(g)) return g;
  comp.guides = g && typeof g === "object" ? ["x", "y"].flatMap(a => (Array.isArray(g[a]) ? g[a] : []).map(at => ({ axis: a, at: +at || 0 }))) : [];
  return comp.guides;
};
const layerById = id => comp && comp.layers.find(l => l.id === id);
const picked = () => comp ? comp.layers.filter(l => sel.has(l.id)) : [];
const uid = p => p + Math.random().toString(36).slice(2, 10);
const lab = (t, input) => el("label", { class: "f" }, el("span", {}, t), input);

// --- keeping and saving ---------------------------------------------------------
function snapshot() { undo.push(JSON.stringify(comp)); if (undo.length > 100) undo.shift(); redo = []; undoButtons(); }
// Each graphic (and HUD part) keeps its own undo / redo while the app is open: switch away and back, it's still there.
const histories = new Map();
function keepHistory() { if (compId) histories.set(compId, { undo, redo }); }
function takeHistory(id) { const h = histories.get(id) || { undo: [], redo: [] }; undo = h.undo; redo = h.redo; undoButtons(); }
function undoButtons() {
  const u = document.getElementById("cmp-undo"), r = document.getElementById("cmp-redo");
  if (u) { u.disabled = !undo.length; u.title = `Undo (Ctrl+Z)${undo.length ? ` · ${undo.length} step${undo.length === 1 ? "" : "s"}` : ""}`; }
  if (r) { r.disabled = !redo.length; r.title = `Redo (Ctrl+Y or Ctrl+Shift+Z)${redo.length ? ` · ${redo.length} step${redo.length === 1 ? "" : "s"}` : ""}`; }
}
function changed(opts = {}) {
  reroute();
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 350);
  drawCanvas();
  if (!opts.keepList) renderLayers();
  if (!opts.keepProps) renderProps();
}
async function save() {
  if (!comp) return;
  if (hudCtx) {   // (a HUD part: its layers back into the HUD, which saves and goes on air)
    const h = hudOf(); if (!h) return;
    const copy = JSON.parse(JSON.stringify(h)), part = copy.parts.find(x => x.id === hudCtx.partId); if (!part) return;
    part.layers = JSON.parse(JSON.stringify(comp.layers)); part.name = comp.name || part.name;
    await api("/api/hud", copy); dirty = false; return;
  }
  const c = JSON.parse(JSON.stringify(comp)); await api("/api/comp", { comp: c }); dirty = false;
}
function back(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify(comp));
  comp = JSON.parse(from.pop());
  sel = new Set([...sel].filter(id => layerById(id)));
  changed(); undoButtons();
}

// --- graphics list --------------------------------------------------------------
function openComp(id) {
  if (dirty) save();
  const c = App.state.project.compositions.find(x => x.id === id);
  keepHistory();
  compId = id; comp = c ? JSON.parse(JSON.stringify(c)) : null; sel = new Set(); takeHistory(id);
  renderGraphics(); renderLayers(); drawCanvas(); renderProps();
}
function renderGraphics() {
  const cs = App.state.project.compositions;
  $("#cmp-graphics").replaceChildren(...cs.map(c => el("div", { class: "gfx" + (c.id === compId ? " sel" : ""), onclick: () => openComp(c.id) },
    el("span", { class: "bar-ind" }), el("div", {}, el("div", { class: "name" }, c.name), el("div", { class: "sub" }, `${c.kind || "overlay"} · ${c.layers.length} layers`)), "")));
  const trash = App.state.trash || [];
  $("#cmp-bin").hidden = !trash.length;
  $("#cmp-bin").replaceChildren(el("option", { value: "" }, `Deleted (${trash.length})`), ...trash.map(t => el("option", { value: t.id }, `Bring back "${t.name}"`)));
}
$("#cmp-bin").addEventListener("change", async e => { if (!e.target.value) return; const r = await api("/api/comp/restore", { id: e.target.value }); toast(`"${r.comp.name}" is back`); });
$("#cmp-new").addEventListener("click", async () => {
  const name = await askText("Name of the new graphic", "New graphic");
  if (!name) return;
  const r = await api("/api/comp", { comp: { name, kind: "overlay", layer: 0, width: W, height: H, layers: [] } });
  setTimeout(() => openComp(r.comp.id), 300);
});

// a small padlock (line icon, closed when locked)
function lockIcon(locked) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("width", "14"); svg.setAttribute("height", "14");
  svg.innerHTML = `<rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="${locked ? "M5.5 7V5a2.5 2.5 0 0 1 5 0v2" : "M5.5 7V5a2.5 2.5 0 0 1 4.9-.7"}" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
  return svg;
}
// --- layers list ----------------------------------------------------------------
const ICON = { text: "T", rect: "▭", shape: "◆", image: "▣", video: "▶", rotator: "↻", ticker: "⇆", bracket: "⊢", web: "◎", lottie: "✧", camera: "◉", shader: "◍" };
function renderLayers() {
  if (!comp) return $("#cmp-layers").replaceChildren(el("p", { class: "muted empty" }, "Pick a graphic or make one with + New."));
  // top of the list = in front (the last layer)
  $("#cmp-layers").replaceChildren(...[...comp.layers].reverse().map(l => el("div", {
    class: "ly" + (sel.has(l.id) ? " sel" : "") + (l.visible === false ? " off" : ""), draggable: "true",
    onclick: e => { pick(l.id, e.shiftKey || e.ctrlKey); },
    ondragstart: e => e.dataTransfer.setData("text/layer", l.id),
    ondragover: e => e.preventDefault(),
    ondrop: e => { e.preventDefault(); const from = e.dataTransfer.getData("text/layer"); if (from && from !== l.id) moveLayer(from, l.id); } },
    el("span", { class: "ly-ic" }, ICON[l.type] || "?"),
    el("span", { class: "ly-name" }, l.name || l.type), l.field ? el("span", { class: "tag" }, "field") : "",
    el("button", { class: "small ghost" + (l.locked ? " on-lock" : ""), "aria-label": l.locked ? "Unlock" : "Lock", title: l.locked ? "Locked: can't be picked on the canvas (click to unlock)" : "Lock (can't be picked on the canvas)",
      onclick: e => { e.stopPropagation(); snapshot(); l.locked = !l.locked; if (l.locked) sel.delete(l.id); changed(); } }, lockIcon(l.locked)),
    el("button", { class: "small ghost", "aria-label": l.visible === false ? "Show" : "Hide", onclick: e => { e.stopPropagation(); snapshot(); l.visible = l.visible === false; changed(); } }, l.visible === false ? "◌" : "●"))));
}
function moveLayer(fromId, toId) {
  snapshot();
  const from = comp.layers.findIndex(l => l.id === fromId), item = comp.layers.splice(from, 1)[0];
  comp.layers.splice(comp.layers.findIndex(l => l.id === toId) + 1, 0, item);
  changed();
}
function pick(id, add) {
  if (!add) sel = new Set();
  if (id) sel.has(id) && add ? sel.delete(id) : sel.add(id);
  renderLayers(); drawSelection(); renderProps();
}

// Import: graphic packs (.sgfx, GFX Baby .chudgfx) and Photoshop files become graphics here; so does a video
// or a Lottie animation, as a graphic of its own with one layer playing it (see-through video plays once and
// holds on its last frame, other video loops). Videos that need converting (.mov...) wait for their job.
const waitJob = id => new Promise((ok, fail) => {
  const look = () => { const j = (App.state.jobs || []).find(x => x.id === id); if (j && j.state === "done") return ok(j.result); if (j && j.state === "error") return fail(new Error(j.detail)); setTimeout(look, 500); };
  look();
});
async function importMedia(f) {
  const ext = (f.name.match(/\.[^.]+$/) || [""])[0].toLowerCase(), stem = f.name.replace(/\.[^.]+$/, "");
  if (ext === ".aep") return toast("After Effects: export the composition as Lottie (.json, Bodymovin) or render a .mov with alpha, then import that");
  const lottie = ext === ".json";
  toast(`Adding ${f.name}…`);
  let path = await upload(f, lottie ? "lottie" : "video");
  if (path && path.job) path = await waitJob(path.job).catch(e => { toast(`Couldn't convert ${f.name}: ${e.message}`); return null; });
  if (!path || typeof path !== "string") return;
  const alpha = /\.webm$/i.test(path);   // (converted see-through video is WebM: plays once and holds)
  const layer = { id: "l" + Math.random().toString(16).slice(2, 10), name: stem, type: lottie ? "lottie" : "video", src: path, x: 0, y: 0, w: 1920, h: 1080,
    opacity: 1, visible: true, fit: "contain", loop: lottie ? true : !alpha };
  const { comp: made } = await api("/api/comp", { comp: { name: stem, kind: "overlay", layers: [layer] } });
  toast(`Made "${made.name}" from ${f.name}`);
  setTimeout(() => openComp(made.id), 300);
}
$("#cmp-import").addEventListener("change", async e => {
  for (const f of e.target.files) {
    if (/\.(mp4|webm|mov|avi|mkv|m4v|wmv|flv|json|aep)$/i.test(f.name)) { await importMedia(f); continue; }
    const r = await upload(f);
    if (r && r.comps) toast(`Added ${r.comps.map(c => c.name).join(", ")}`);
    if (r && r.comp) { toast(`Made "${r.comp.name}" from ${f.name}`); setTimeout(() => openComp(r.comp.id), 300); }
  }
  e.target.value = "";
});
// --- canvas -----------------------------------------------------------------------
const view = $("#cmp-view"), sheet = $("#cmp-sheet"), box = $("#cmp-sel");
const stage = new Stage(sheet, { muted: true, editor: true });
setInterval(() => { const n = sheet.firstElementChild; for (const fn of (n && n._ticks) || []) fn(); }, 1000);   // (live data that moves on by itself, e.g. {{Sponsors}}, turns here too)
// Zoom: "fit" (the whole page in view) or a fixed scale; zoomed in, the page pans (scroll, or drag with the
// middle button / Space held). Ctrl + scroll zooms at the pointer; the toolbar has - / % / + / Fit.
let scale = 0.5, zoom = "fit", panX = 0, panY = 0;
function fit() {
  const r = view.getBoundingClientRect();
  if (zoom === "fit") {
    scale = Math.min((r.width - 40) / W, (r.height - 40) / H);
    panX = Math.round((r.width - W * scale) / 2);
    panY = Math.round((r.height - H * scale) / 2);
  } else {
    scale = zoom;
    // (keep some of the page in view)
    panX = Math.min(r.width - 80, Math.max(80 - W * scale, panX));
    panY = Math.min(r.height - 80, Math.max(80 - H * scale, panY));
  }
  sheet.style.transform = `scale(${scale})`;
  sheet.style.left = Math.round(panX) + "px";
  sheet.style.top = Math.round(panY) + "px";
  const z = document.getElementById("cmp-zoom");
  if (z) z.textContent = Math.round(scale * 100) + "%";
  drawSelection();
  if (typeof drawRulers === "function") drawRulers();
}
new ResizeObserver(fit).observe(view);
function zoomTo(next, cx, cy) {   // (cx, cy: the point in the view that stays put)
  const r = view.getBoundingClientRect();
  next = Math.max(0.1, Math.min(4, next));
  if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
  const sx = (cx - panX) / scale, sy = (cy - panY) / scale;
  zoom = next;
  panX = cx - sx * next;
  panY = cy - sy * next;
  fit();
}
const STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const stepZoom = dir => zoomTo(dir > 0 ? (STEPS.find(z => z > scale + 0.001) || 4) : ([...STEPS].reverse().find(z => z < scale - 0.001) || 0.1));
view.addEventListener("wheel", e => {
  if (!comp) return;
  e.preventDefault();
  const r = view.getBoundingClientRect();
  if (e.ctrlKey || e.metaKey) return zoomTo(scale * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  if (zoom === "fit") return;
  panX -= e.shiftKey ? e.deltaY : e.deltaX;
  panY -= e.shiftKey ? 0 : e.deltaY;
  fit();
}, { passive: false });
let spaceDown = false;
addEventListener("keydown", e => { if (e.code === "Space" && editing() && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) { spaceDown = true; view.classList.add("grab"); e.preventDefault(); } });
addEventListener("keyup", e => { if (e.code === "Space") { spaceDown = false; view.classList.remove("grab"); } });
view.addEventListener("mousedown", e => {   // (pan: middle button, or Space + drag)
  if (!(e.button === 1 || (e.button === 0 && spaceDown))) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (zoom === "fit") zoom = scale;
  const sx = e.clientX - panX, sy = e.clientY - panY;
  const move = ev => { panX = ev.clientX - sx; panY = ev.clientY - sy; fit(); };
  const up = () => { removeEventListener("mousemove", move); removeEventListener("mouseup", up); };
  addEventListener("mousemove", move); addEventListener("mouseup", up);
}, true);
function drawCanvas() {
  if (!comp) return sheet.replaceChildren();
  let tables = (App.state.data && App.state.data.tables) || {};
  if (hudCtx) tables = stage.tables({ data: App.state.data });   // (with the Show buttons' phase applied)
  stage.cams = App.state.project.cams || [];
  const node = stage.build(comp, (App.state.live.preview.values || {})[comp.id] || {}, tables);
  const old = sheet.firstChild;
  if (old && old._comp === comp.id && [...old.children].some(c => c._keep)) stage.patch(old, node);   // (videos keep playing)
  else { node._comp = comp.id; sheet.replaceChildren(node); node._later.forEach(fn => fn()); }
  for (const n of sheet.querySelectorAll(":scope > .cmp-ctx")) n.remove();
  if (hudCtx) {   // (the HUD's other parts that are on, dimmed behind: the part is edited in place)
    for (const p of (hudOf() || { parts: [] }).parts) {
      if (p.id === hudCtx.partId || p.on === false) continue;
      const n = stage.build({ id: "ctx-" + p.id, layers: p.layers }, {}, tables);
      n.classList.add("cmp-ctx"); sheet.appendChild(n); n._later.forEach(fn => fn());
    }
  }
  drawSelection();
  drawRulers();
}
// Where a layer is drawn on the canvas (in 1920 x 1080 px): live data can move it (a caster box's "move" for
// 1-4 casters), so this is read from the drawing, not from its x / y. Hidden: its own box.
function shown(l) {
  const node = sheet.firstChild, e = node && [...node.children].find(c => c._layer && c._layer.id === l.id);
  if (!e || !e.getClientRects().length) return { x: l.x, y: l.y, w: l.w, h: l.h };
  const r = e.getBoundingClientRect(), s = sheet.getBoundingClientRect();
  return { x: (r.left - s.left) / scale, y: (r.top - s.top) / scale, w: r.width / scale, h: r.height / scale };
}
function drawSelection() {
  const ls = picked().map(shown);
  box.hidden = !ls.length;
  if (!ls.length) { if (typeof drawPoints === "function") drawPoints(); return; }
  const x0 = Math.min(...ls.map(l => l.x)), y0 = Math.min(...ls.map(l => l.y));
  const x1 = Math.max(...ls.map(l => l.x + l.w)), y1 = Math.max(...ls.map(l => l.y + l.h));
  const r = sheet.getBoundingClientRect(), v = view.getBoundingClientRect();
  Object.assign(box.style, { left: r.left - v.left + x0 * scale + "px", top: r.top - v.top + y0 * scale + "px", width: (x1 - x0) * scale + "px", height: (y1 - y0) * scale + "px" });
  if (typeof drawPoints === "function") drawPoints();
}
// The layer under the pointer: the smallest one there (a full-screen background never hides the text on it).
// Picking on the canvas works as in Canva / Figma: the layer in front under the pointer; a layer filling (almost) the
// whole page is the background, never picked by a click or a drag box (pick it in Layers); Alt+click goes one
// layer further back each time; locked and hidden layers are skipped.
const isBackground = b => b.w * b.h >= W * H * 0.9;
function layersAt(x, y) {   // (front first)
  const out = [];
  for (const l of [...comp.layers].reverse()) {
    if (l.visible === false || l.locked) continue;
    const b = shown(l);
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) out.push({ l, bg: isBackground(b) });
  }
  return out;
}
function layerAt(x, y) {
  const hit = layersAt(x, y).find(h => !h.bg);
  return hit ? hit.l : null;
}
const toStage = e => { const r = sheet.getBoundingClientRect(); return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale]; };
// Snapping: edges and centres of the canvas and the other layers (a square's or circle's middle too) and the
// ruler guides, within 8 screen px; the lines it snapped to show while dragging (pink), so you see what lines up.
function snapTargets() {
  const others = comp.layers.filter(l => !sel.has(l.id) && l.visible !== false), gs = guides();
  return { xs: [0, W / 2, W, ...others.flatMap(o => [o.x, o.x + o.w / 2, o.x + o.w]), ...gs.filter(g => g.axis === "x").map(g => g.at)],
    ys: [0, H / 2, H, ...others.flatMap(o => [o.y, o.y + o.h / 2, o.y + o.h]), ...gs.filter(g => g.axis === "y").map(g => g.at)] };
}
function nearest(edges, targets) {   // -> [shift, the line it snapped to] or [0, null]
  let d = null, at = null;
  for (const e of edges) for (const t of targets) if (Math.abs(t - e) <= 8 / scale && (d === null || Math.abs(t - e) < Math.abs(d))) { d = t - e; at = t; }
  return d === null ? [0, null] : [d, at];
}
function snap(ls, dx, dy) {
  const { xs, ys } = snapTargets();
  const x0 = Math.min(...ls.map(l => l.x)) + dx, x1 = Math.max(...ls.map(l => l.x + l.w)) + dx, y0 = Math.min(...ls.map(l => l.y)) + dy, y1 = Math.max(...ls.map(l => l.y + l.h)) + dy;
  let [sx, lx] = nearest([x0, (x0 + x1) / 2, x1], xs), [sy, ly] = nearest([y0, (y0 + y1) / 2, y1], ys);
  // equal spacing (as Figma): a gap to a neighbour the same as a gap between other layers, or the middle between two
  const others = comp.layers.filter(l => !sel.has(l.id) && l.visible !== false).map(shown).filter(b => !isBackground(b));
  const gx = gapSnap({ a0: x0, a1: x1, b0: y0, b1: y1 }, others.map(o => ({ a0: o.x, a1: o.x + o.w, b0: o.y, b1: o.y + o.h })));
  const gy = gapSnap({ a0: y0, a1: y1, b0: x0, b1: x1 }, others.map(o => ({ a0: o.y, a1: o.y + o.h, b0: o.x, b1: o.x + o.w })));
  let marks = [];
  if (gx && (lx == null || Math.abs(gx.shift) <= Math.abs(sx))) { sx = gx.shift; lx = null; marks = marks.concat(gx.marks.map(m => ({ ...m, axis: "x" }))); }
  if (gy && (ly == null || Math.abs(gy.shift) <= Math.abs(sy))) { sy = gy.shift; ly = null; marks = marks.concat(gy.marks.map(m => ({ ...m, axis: "y" }))); }
  showSnap(lx, ly, marks);
  return [Math.round(dx + sx), Math.round(dy + sy)];   // (whole pixels)
}
// One axis of equal spacing. Boxes as {a0, a1} along the axis and {b0, b1} across it; neighbours are the boxes that
// overlap the moving one across the axis. Returns {shift, marks: [{from, to, at}]} or null (nothing within 8 screen px).
function gapSnap(m, boxes) {
  const tol = 8 / scale, w = m.a1 - m.a0;
  const row = boxes.filter(o => o.b0 < m.b1 && o.b1 > m.b0);
  const before = row.filter(o => o.a1 <= m.a0 + tol).sort((p, q) => q.a1 - p.a1)[0];
  const after = row.filter(o => o.a0 >= m.a1 - tol).sort((p, q) => p.a0 - q.a0)[0];
  const gaps = [];   // (gaps between neighbouring other boxes in the same row or column)
  for (const o of boxes) {
    const next = boxes.filter(q => q !== o && q.a0 >= o.a1 && q.b0 < o.b1 && q.b1 > o.b0).sort((p, q) => p.a0 - q.a0)[0];
    if (next && next.a0 - o.a1 > 0) gaps.push({ g: next.a0 - o.a1, from: o.a1, to: next.a0, at: (Math.max(o.b0, next.b0) + Math.min(o.b1, next.b1)) / 2 });
  }
  const cand = [];
  if (before && after) cand.push({ start: (before.a1 + after.a0 - w) / 2, mid: true });   // (the middle between the two)
  for (const g of gaps) {
    if (before) cand.push({ start: before.a1 + g.g, g });
    if (after) cand.push({ start: after.a0 - g.g - w, g });
  }
  let best = null;
  for (const c of cand) { const shift = c.start - m.a0; if (Math.abs(shift) <= tol && (!best || Math.abs(shift) < Math.abs(best.shift))) best = { ...c, shift }; }
  if (!best) return null;
  const s0 = best.start, s1 = s0 + w, mid = (m.b0 + m.b1) / 2, marks = [];
  const g = best.mid ? Math.round(s0 - before.a1) : Math.round(best.g.g);
  if (before && Math.abs(s0 - before.a1 - g) < 1) marks.push({ from: before.a1, to: s0, at: mid, g });
  if (after && Math.abs(after.a0 - s1 - g) < 1) marks.push({ from: s1, to: after.a0, at: mid, g });
  for (const q of gaps) if (Math.abs(q.g - g) < 1) marks.push({ from: q.from, to: q.to, at: q.at, g });
  return marks.length >= 2 ? { shift: best.shift, marks } : null;
}
const snapLines = el("div", { class: "cmp-snaps" });
view.appendChild(snapLines);
function showSnap(x, y, marks = []) {
  if (x == null && y == null && !marks.length) return snapLines.replaceChildren();
  const r = sheet.getBoundingClientRect(), v = view.getBoundingClientRect(), ox = r.left - v.left + view.scrollLeft, oy = r.top - v.top + view.scrollTop;
  const gap = m => m.axis === "x"   // (each equal gap: a pink bar with end ticks and its size in px)
    ? el("div", { class: "cmp-gap x", style: `left:${ox + m.from * scale}px;top:${oy + m.at * scale}px;width:${(m.to - m.from) * scale}px` }, el("span", {}, String(m.g)))
    : el("div", { class: "cmp-gap y", style: `top:${oy + m.from * scale}px;left:${ox + m.at * scale}px;height:${(m.to - m.from) * scale}px` }, el("span", {}, String(m.g)));
  snapLines.replaceChildren(...(x != null ? [el("div", { class: "cmp-snap x", style: `left:${ox + x * scale}px;top:${oy}px;height:${H * scale}px` })] : []),
    ...(y != null ? [el("div", { class: "cmp-snap y", style: `top:${oy + y * scale}px;left:${ox}px;width:${W * scale}px` })] : []), ...marks.map(gap));
}
// Drag on empty canvas: a box picks every layer it touches, never the background (Shift adds to what's picked).
const band = el("div", { class: "cmp-band", hidden: true });
view.appendChild(band);
function marquee(e, sx, sy, under) {
  const keep = e.shiftKey || e.ctrlKey ? new Set(sel) : new Set();
  let rect = null;
  const move = ev => {
    const [mx, my] = toStage(ev);
    rect = { x0: Math.min(sx, mx), y0: Math.min(sy, my), x1: Math.max(sx, mx), y1: Math.max(sy, my) };
    const r = sheet.getBoundingClientRect(), v = view.getBoundingClientRect();
    band.hidden = false;
    Object.assign(band.style, { left: r.left - v.left + rect.x0 * scale + "px", top: r.top - v.top + rect.y0 * scale + "px", width: (rect.x1 - rect.x0) * scale + "px", height: (rect.y1 - rect.y0) * scale + "px" });
  };
  const up = () => {
    removeEventListener("mousemove", move); removeEventListener("mouseup", up);
    band.hidden = true;
    if (!rect || rect.x1 - rect.x0 < 3 / scale && rect.y1 - rect.y0 < 3 / scale) return pick(under ? under.id : null, e.shiftKey || e.ctrlKey);   // (a click, not a drag: what's under it, or nothing)
    sel = keep;
    for (const l of comp.layers) {
      if (l.visible === false || l.locked) continue;
      const b = shown(l);   // (everything the box touches, as Figma; never the full-page background)
      if (!isBackground(b) && b.x < rect.x1 && b.x + b.w > rect.x0 && b.y < rect.y1 && b.y + b.h > rect.y0) sel.add(l.id);
    }
    renderLayers(); drawSelection(); renderProps();
  };
  addEventListener("mousemove", move); addEventListener("mouseup", up);
}
let pen = null;   // [[x, y], ...] while drawing with the pen
const penLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
penLayer.classList.add("cmp-pen");
view.appendChild(penLayer);
function drawPen(mx, my) {
  if (!pen) { penLayer.replaceChildren(); penLayer.style.display = "none"; return; }
  const r = sheet.getBoundingClientRect(), v = view.getBoundingClientRect();
  penLayer.style.display = "block";
  const pts = [...pen, ...(mx != null ? [[mx, my]] : [])].map(([x, y]) => `${r.left - v.left + x * scale},${r.top - v.top + y * scale}`).join(" ");
  penLayer.innerHTML = `<polyline points="${pts}" fill="none" stroke="#c8f03c" stroke-width="2"/>` + pen.map(([x, y], i) => `<circle cx="${r.left - v.left + x * scale}" cy="${r.top - v.top + y * scale}" r="${i ? 3 : 6}" fill="${i ? "#c8f03c" : "none"}" stroke="#c8f03c" stroke-width="2"/>`).join("");
}
// --- the line tool: click points (Shift: straight, 45 degree steps), double-click / Enter / Esc to finish. A point
// lands on another line's point when near it (they join); starting on a line's end carries that line on (one line).
let liner = null;   // {pts: [[x, y]...], extend: {id, atStart}, from: {id, side}, to: {id, side}}

// --- connectors: a line whose two ends sit on two boxes ({from: {id, side}, to: {id, side}}); it bends at right
// angles between them and follows when either box moves. A box's spots: the middle of each side.
const SIDES = ["top", "bottom", "left", "right"];
function anchor(l, side) {
  return { top: [l.x + l.w / 2, l.y], bottom: [l.x + l.w / 2, l.y + l.h], left: [l.x, l.y + l.h / 2], right: [l.x + l.w, l.y + l.h / 2] }[side];
}
function routeLine(a, as, b, bs) {
  const V = s => s === "top" || s === "bottom", r = p => [Math.round(p[0]), Math.round(p[1])];
  let pts;
  if (V(as) && V(bs)) { const m = (a[1] + b[1]) / 2; pts = [a, [a[0], m], [b[0], m], b]; }
  else if (!V(as) && !V(bs)) { const m = (a[0] + b[0]) / 2; pts = [a, [m, a[1]], [m, b[1]], b]; }
  else if (V(as)) pts = [a, [a[0], b[1]], b];
  else pts = [a, [b[0], a[1]], b];
  pts = pts.map(r).filter((p, i, all) => !i || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1]);   // (no repeated points: a straight run stays one segment)
  return pts.filter((p, i, all) => i === 0 || i === all.length - 1 || !((all[i - 1][0] === p[0] && p[0] === all[i + 1][0]) || (all[i - 1][1] === p[1] && p[1] === all[i + 1][1])));
}
function sidesFor(A, B) {   // (which sides face each other)
  const ax = A.x + A.w / 2, ay = A.y + A.h / 2, bx = B.x + B.w / 2, by = B.y + B.h / 2;
  if (B.y >= A.y + A.h) return ["bottom", "top"];
  if (B.y + B.h <= A.y) return ["top", "bottom"];
  if (B.x >= A.x + A.w) return ["right", "left"];
  if (B.x + B.w <= A.x) return ["left", "right"];
  return Math.abs(by - ay) >= Math.abs(bx - ax) ? (by > ay ? ["bottom", "top"] : ["top", "bottom"]) : (bx > ax ? ["right", "left"] : ["left", "right"]);
}
function reroute() {
  if (!comp) return;
  for (const l of comp.layers) {
    if (l.shape !== "line" || !l.from || !l.to) continue;
    const A = layerById(l.from.id), B = layerById(l.to.id);
    if (!A || !B) { delete l.from; delete l.to; continue; }   // (a box gone: the line stays where it is)
    setLinePts(l, routeLine(anchor(A, l.from.side), l.from.side, anchor(B, l.to.side), l.to.side));
  }
}
function connect(A, B) {
  const [as, bs] = sidesFor(A, B);
  const l = { type: "shape", name: `Line: ${A.name || "box"} to ${B.name || "box"}`, shape: "line", stroke: "#ffffff", strokeWidth: 4, fill: "none", points: [],
    from: { id: A.id, side: as }, to: { id: B.id, side: bs } };
  setLinePts(l, routeLine(anchor(A, as), as, anchor(B, bs), bs));
  addLayers([l], { keepPlace: true });
}
function boxSpot(x, y) {   // (the middle of a box's side under the pointer, within 12 screen px)
  let best = null;
  for (const l of comp.layers) {
    if (l.shape === "line" || l.visible === false || l.locked || isBackground(l)) continue;
    for (const side of SIDES) { const p = anchor(l, side), d = Math.hypot(p[0] - x, p[1] - y); if (d <= 12 / scale && (!best || d < best.d)) best = { d, p, id: l.id, side }; }
  }
  return best;
}
const lineLayers = () => comp.layers.filter(l => l.shape === "line" && l.visible !== false);
function linePts(l) { return (l.points || []).map(([fx, fy]) => [l.x + fx * l.w, l.y + fy * l.h]); }
function setLinePts(l, pts) {
  const x0 = Math.min(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1]));
  const spanX = Math.max(...pts.map(p => p[0])) - x0, spanY = Math.max(...pts.map(p => p[1])) - y0;
  l.x = Math.round(x0); l.y = Math.round(y0); l.w = Math.max(1, Math.round(spanX)); l.h = Math.max(1, Math.round(spanY));
  l.points = pts.map(([x, y]) => [spanX ? +((x - x0) / spanX).toFixed(5) : 0, spanY ? +((y - y0) / spanY).toFixed(5) : 0]);
}
function snapPoint(x, y, prev, shift, skip) {
  if (shift && prev) {   // (straight: across, down or diagonal from the last point)
    const dx = x - prev[0], dy = y - prev[1], a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), d = Math.hypot(dx, dy);
    x = prev[0] + Math.round(Math.cos(a) * d); y = prev[1] + Math.round(Math.sin(a) * d);
  }
  let best = null;   // (onto a point of another line, or of this one: a join)
  for (const l of lineLayers()) {
    if (l.id === skip) continue;
    for (const p of linePts(l)) { const d = Math.hypot(p[0] - x, p[1] - y); if (d <= 10 / scale && (!best || d < best.d)) best = { d, p, l }; }
  }
  if (best) return { p: [Math.round(best.p[0]), Math.round(best.p[1])], on: best.l };
  const spot = comp && boxSpot(x, y);
  if (spot) return { p: [Math.round(spot.p[0]), Math.round(spot.p[1])], on: null, box: { id: spot.id, side: spot.side } };
  if (!shift && prev) {   // (else line up with the last point: straight across or down)
    if (Math.abs(x - prev[0]) <= 8 / scale) x = prev[0];
    if (Math.abs(y - prev[1]) <= 8 / scale) y = prev[1];
  }
  return { p: [Math.round(x), Math.round(y)], on: null };
}
function drawLiner(mx, my) {
  if (!liner) return drawPen();
  const r = sheet.getBoundingClientRect(), v = view.getBoundingClientRect();
  const P = ([x, y]) => [r.left - v.left + x * scale, r.top - v.top + y * scale];
  penLayer.style.display = "block";
  const pts = [...liner.pts, ...(mx != null ? [[mx, my]] : [])].map(p => P(p).join(",")).join(" ");
  penLayer.innerHTML = `<polyline points="${pts}" fill="none" stroke="#c8f03c" stroke-width="2"/>` +
    liner.pts.map(p => { const [cx, cy] = P(p); return `<circle cx="${cx}" cy="${cy}" r="4" fill="#c8f03c"/>`; }).join("");
}
function finishLine() {
  const L = liner;
  liner = null; drawPen(); view.classList.remove("pen");
  if (!L || L.pts.length < 2) return;
  if (L.extend) {   // (carried on from another line's end: that line gets the new points)
    const l = layerById(L.extend.id);
    if (l) {
      snapshot();
      const old = linePts(l), add = L.pts.slice(1);
      setLinePts(l, L.extend.atStart ? [...add.reverse(), ...old] : [...old, ...add]);
      sel = new Set([l.id]); changed(); return;
    }
  }
  if (L.from && L.to && L.from.id !== L.to.id) {   // (box to box: a connector, bent at right angles, following the boxes)
    const A = layerById(L.from.id), B = layerById(L.to.id);
    if (A && B) {
      const l = { type: "shape", name: `Line: ${A.name || "box"} to ${B.name || "box"}`, shape: "line", stroke: "#ffffff", strokeWidth: 4, fill: "none", points: [], from: L.from, to: L.to };
      setLinePts(l, routeLine(anchor(A, L.from.side), L.from.side, anchor(B, L.to.side), L.to.side));
      return addLayers([l], { keepPlace: true });
    }
  }
  const l = { type: "shape", name: "Line", shape: "line", stroke: "#ffffff", strokeWidth: 4, fill: "none", points: [] };
  setLinePts(l, L.pts);
  addLayers([l], { keepPlace: true });
}
view.addEventListener("mousedown", e => {
  if (!liner || e.button !== 0) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const [x, y] = toStage(e), prev = liner.pts[liner.pts.length - 1];
  const s = snapPoint(x, y, prev, e.shiftKey, liner.extend && liner.extend.id);
  if (!liner.pts.length && s.on) {   // (starting on a line's end: carry that line on)
    const ends = linePts(s.on);
    const atStart = Math.hypot(ends[0][0] - s.p[0], ends[0][1] - s.p[1]) < 1, atEnd = Math.hypot(ends[ends.length - 1][0] - s.p[0], ends[ends.length - 1][1] - s.p[1]) < 1;
    if (atStart || atEnd) liner.extend = { id: s.on.id, atStart: atStart && !atEnd };
  }
  if (!liner.pts.length) liner.from = s.box || null;
  if (e.detail > 1) return finishLine();   // (double-click: done)
  if (!prev || prev[0] !== s.p[0] || prev[1] !== s.p[1]) liner.pts.push(s.p);
  liner.to = s.box || null;
  drawLiner();
}, true);
view.addEventListener("mousemove", e => {
  if (!liner) return;
  const [x, y] = toStage(e), s = snapPoint(x, y, liner.pts[liner.pts.length - 1], e.shiftKey, liner.extend && liner.extend.id);
  drawLiner(...s.p);
});
addEventListener("keydown", e => { if (liner && (e.key === "Enter" || e.key === "Escape")) { e.preventDefault(); finishLine(); } });

// A picked line shows its points: drag one to move it (it joins another line's point when near; Shift: straight).
var ptBox = el("div", { class: "cmp-pts" });   // (var: drawSelection can run before this line)
view.appendChild(ptBox);
function drawPoints() {
  if (!ptBox) return;
  const ls = picked();
  if (ls.length !== 1 || ls[0].shape !== "line" || liner) return ptBox.replaceChildren();
  const l = ls[0], r = sheet.getBoundingClientRect(), v = view.getBoundingClientRect();
  ptBox.replaceChildren(...linePts(l).map(([x, y], i) => el("i", { class: "cmp-pt", "data-pt": String(i), style: `left:${r.left - v.left + x * scale}px;top:${r.top - v.top + y * scale}px` })));
}
ptBox.addEventListener("mousedown", e => {
  const h = e.target.closest("[data-pt]"); if (!h) return;
  e.preventDefault(); e.stopPropagation();
  const l = picked()[0], i = +h.dataset.pt;
  let moved = false;
  const move = ev => {
    const [x, y] = toStage(ev), pts = linePts(l);
    if (!moved) { snapshot(); moved = dragging = true; }
    const sp = snapPoint(x, y, pts[i - 1] || pts[i + 1], ev.shiftKey, l.id);
    if (l.from && l.to && (i === 0 || i === pts.length - 1) && sp.box) {   // (a connector's end onto another box: re-routed)
      l[i === 0 ? "from" : "to"] = sp.box; reroute();
    } else {
      if (l.from || l.to) { delete l.from; delete l.to; }   // (moved by hand: a plain line from here on)
      pts[i] = sp.p; setLinePts(l, pts);
    }
    drawCanvas();
  };
  const up = () => { removeEventListener("mousemove", move); removeEventListener("mouseup", up); dragging = false; if (moved) changed({ keepList: true }); };
  addEventListener("mousemove", move); addEventListener("mouseup", up);
});

function finishPen() {
  const pts = pen;
  pen = null; drawPen(); view.classList.remove("pen");
  if (!pts || pts.length < 3) return;
  const x0 = Math.min(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), w = Math.max(4, Math.max(...pts.map(p => p[0])) - x0), h = Math.max(4, Math.max(...pts.map(p => p[1])) - y0);
  addLayers([{ type: "shape", name: "Drawn shape", shape: "path", fill: "#c8f03c", x: Math.round(x0), y: Math.round(y0), w: Math.round(w), h: Math.round(h),
    points: pts.map(([x, y]) => [+((x - x0) / w).toFixed(4), +((y - y0) / h).toFixed(4)]) }]);
}
view.addEventListener("mousemove", e => { if (pen) drawPen(...toStage(e)); });
view.addEventListener("mousedown", e => {
  if (pen && e.button === 0) {
    const [x, y] = toStage(e);
    if (pen.length > 2 && Math.hypot(x - pen[0][0], y - pen[0][1]) < 10 / scale) return finishPen();
    pen.push([Math.round(x), Math.round(y)]);
    return drawPen();
  }
}, true);
view.addEventListener("mousedown", e => {
  if (!comp || e.button !== 0 || pen) return;
  const handle = e.target.closest("[data-h]");
  const [sx, sy] = toStage(e);
  if (!handle) {
    const under = layersAt(sx, sy);
    if (e.altKey && under.length) {   // (one layer further back each Alt+click, round to the front again)
      const i = under.findIndex(h => sel.has(h.l.id));
      pick(under[(i + 1) % under.length].l.id, false);
      return;
    }
    const picked1 = under.find(h => sel.has(h.l.id));   // (already picked, even the background: drag it)
    const hit = picked1 ? picked1.l : layerAt(sx, sy);
    if (!hit) return marquee(e, sx, sy, null);
    if (!sel.has(hit.id)) pick(hit.id, e.shiftKey || e.ctrlKey);
  }
  const ls = picked(), start = ls.map(l => ({ l, x: l.x, y: l.y, w: l.w, h: l.h }));
  let moved = false;
  const move = ev => {
    const [mx, my] = toStage(ev);
    let dx = Math.round(mx - sx), dy = Math.round(my - sy);
    if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    if (!moved) { snapshot(); moved = dragging = true; }   // (dragging: a server push mid-drag must not swap the layers out)
    if (handle) {
      // (resizing: every picked layer, as one box: each keeps its place and share inside the box)
      const h = handle.dataset.h;
      const G = { x: Math.min(...start.map(s => s.x)), y: Math.min(...start.map(s => s.y)) };
      G.w = Math.max(...start.map(s => s.x + s.w)) - G.x; G.h = Math.max(...start.map(s => s.y + s.h)) - G.y;
      const N = { ...G };
      if (h.includes("e")) N.w = Math.max(4, G.w + dx);
      if (h.includes("s")) N.h = Math.max(4, G.h + dy);
      if (h.includes("w")) { const d = Math.min(dx, G.w - 4); N.x = G.x + d; N.w = G.w - d; }
      if (h.includes("n")) { const d = Math.min(dy, G.h - 4); N.y = G.y + d; N.h = G.h - d; }
      if (ev.shiftKey && G.w && G.h) { N.h = Math.round(N.w * G.h / G.w); if (h.includes("n")) N.y = G.y + G.h - N.h; }   // (Shift keeps the shape)
      if (!ev.altKey) {   // (the edge being pulled snaps too, with its line)
        const { xs, ys } = snapTargets();
        const [ex, lx] = h.includes("e") ? nearest([N.x + N.w], xs) : h.includes("w") ? nearest([N.x], xs) : [0, null];
        const [ey, ly] = h.includes("s") ? nearest([N.y + N.h], ys) : h.includes("n") ? nearest([N.y], ys) : [0, null];
        if (h.includes("e")) N.w += ex; else if (h.includes("w")) { N.x += ex; N.w -= ex; }
        if (h.includes("s")) N.h += ey; else if (h.includes("n")) { N.y += ey; N.h -= ey; }
        showSnap(lx, ly);
      }
      const kx = G.w ? N.w / G.w : 1, ky = G.h ? N.h / G.h : 1;
      for (const s of start) {
        s.l.x = Math.round(N.x + (s.x - G.x) * kx); s.l.w = Math.max(1, Math.round(s.w * kx));
        s.l.y = Math.round(N.y + (s.y - G.y) * ky); s.l.h = Math.max(1, Math.round(s.h * ky));
      }
    } else {
      if (!ev.altKey) [dx, dy] = snap(start.map(s => ({ ...s.l, x: s.x, y: s.y })), dx, dy);
      for (const s of start) { s.l.x = s.x + dx; s.l.y = s.y + dy; }
    }
    // (only the picked layers move while dragging; everything is drawn again on release)
    if (comp.layers.some(c => c.shape === "line" && c.from && (sel.has(c.from.id) || sel.has(c.to.id)))) { reroute(); drawCanvas(); }   // (their connectors follow)
    const node = sheet.firstChild;
    for (const s of start) {
      const e = node && [...node.children].find(c => c._layer && c._layer.id === s.l.id);
      const k = (e && e._shift) || [0, 0, 0, 0];   // (a slot moved to the middle: drawn shifted)
      if (e) Object.assign(e.style, { left: s.l.x + k[0] + "px", top: s.l.y + k[1] + "px", width: s.l.w + k[2] + "px", height: s.l.h + k[3] + "px" });
    }
    drawSelection();
    renderPropsNumbers();
  };
  const up = () => { removeEventListener("mousemove", move); removeEventListener("mouseup", up); dragging = false; showSnap(); if (moved) changed({ keepList: true }); };
  addEventListener("mousemove", move); addEventListener("mouseup", up);
});
// Copy / paste: Ctrl+C / Ctrl+X take the picked layers, Ctrl+V puts them in the open graphic or HUD part (new ids;
// a few px down and right when the copies would sit exactly on their originals), and picks them.
let clip = null;
function paste() {
  let got = clip;
  try { got = JSON.parse(localStorage.getItem("sg-clip") || "null") || clip; } catch (x) { /* */ }
  if (!comp || !Array.isArray(got) || !got.length) return toast("Nothing copied yet: pick layers and press Ctrl+C");
  snapshot();
  const onTop = got.some(c => comp.layers.some(l => l.x === c.x && l.y === c.y && l.type === c.type));
  const copies = got.map(l => { const c = { ...JSON.parse(JSON.stringify(l)), id: uid("l") }; if (onTop) { c.x += 20; c.y += 20; } delete c.part; delete c.part_at; return c; });
  comp.layers.push(...copies); sel = new Set(copies.map(c => c.id)); changed();
  toast(`Pasted ${copies.length} layer${copies.length === 1 ? "" : "s"}`);
}
addEventListener("keydown", e => {
  if (!editing() || !comp) return;
  const k = e.key.toLowerCase(), a = document.activeElement, mod = e.ctrlKey || e.metaKey;
  // (undo / redo: also with the cursor in a setting, unless its text is being typed and not saved yet)
  const typing = a.isContentEditable || (/^(TEXTAREA|INPUT)$/.test(a.tagName) && !/^(checkbox|radio|color|range|button)$/.test(a.type) && a.value !== a.defaultValue);
  if (mod && (k === "z" || k === "y") && !typing) {
    e.preventDefault(); if (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) a.blur();
    (k === "y" || e.shiftKey) ? back(redo, undo) : back(undo, redo); return;
  }
  if (/INPUT|TEXTAREA|SELECT/.test(a.tagName) || a.isContentEditable) return;   // (a chip box is typed in too)
  if (pen && (k === "enter" || k === "escape")) { e.preventDefault(); if (k === "escape") pen = []; finishPen(); return; }
  if (mod && k === "a") { e.preventDefault(); sel = new Set(comp.layers.filter(l => l.visible !== false).map(l => l.id)); renderLayers(); drawSelection(); renderProps(); return; }
  if (mod && k === "v") { e.preventDefault(); paste(); return; }
  const ls = picked();
  if (!ls.length) return;
  if (mod && (k === "c" || k === "x")) {   // (copy / cut: kept on this PC, so it pastes into another graphic or HUD part too)
    e.preventDefault();
    try { localStorage.setItem("sg-clip", JSON.stringify(ls)); } catch (x) { /* private window */ }
    clip = JSON.parse(JSON.stringify(ls));
    if (k === "x") { snapshot(); comp.layers = comp.layers.filter(l => !sel.has(l.id)); sel = new Set(); changed(); }
    toast(`${ls.length} layer${ls.length === 1 ? "" : "s"} ${k === "x" ? "cut" : "copied"}`);
    return;
  }
  if (k === "delete" || k === "backspace") { e.preventDefault(); snapshot(); comp.layers = comp.layers.filter(l => !sel.has(l.id)); sel = new Set(); changed(); return; }
  if ((e.ctrlKey || e.metaKey) && k === "d") { e.preventDefault(); snapshot(); const copies = ls.map(l => ({ ...JSON.parse(JSON.stringify(l)), id: uid("l"), name: (l.name || "") + " copy", x: l.x + 20, y: l.y + 20 }));
    const at = {};   // (a copied part copy is its own copy of the part; a copied piece of one is no part)
    for (const c of copies) if (c.part_at) {
      if (comp.layers.every(l => l.part_at !== c.part_at || sel.has(l.id))) c.part_at = at[c.part_at] ||= uid("i");
      else { delete c.part; delete c.part_at; }
    }
    comp.layers.push(...copies); sel = new Set(copies.map(c => c.id)); changed(); return; }
  const step = e.shiftKey ? 10 : 1, d = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[k];
  if (d) { e.preventDefault(); snapshot(); for (const l of ls) { l.x += d[0]; l.y += d[1]; } changed({ keepList: true }); }
});

// --- canvas tools -----------------------------------------------------------------
let rulers = true;
try { rulers = localStorage.getItem("sg-rulers") !== "off"; } catch (e) { /* */ }   // (on unless turned off on this PC)
const rulerX = el("div", { class: "cmp-ruler x" }), rulerY = el("div", { class: "cmp-ruler y" }), guideBox = el("div", { class: "cmp-guides" });
view.append(rulerX, rulerY, guideBox);
function drawRulers() {
  rulerX.hidden = rulerY.hidden = guideBox.hidden = !rulers;
  if (!rulers || !comp) return;
  const r = sheet.getBoundingClientRect(), v = view.getBoundingClientRect(), ox = r.left - v.left, oy = r.top - v.top;
  const ticks = (n, horiz) => Array.from({ length: n / 100 + 1 }, (_, i) => el("span", { style: horiz ? `left:${ox + i * 100 * scale}px` : `top:${oy + i * 100 * scale}px` }, i % 2 ? "" : String(i * 100)));
  rulerX.replaceChildren(...ticks(W, true)); rulerY.replaceChildren(...ticks(H, false));
  guideBox.replaceChildren(...guides().map((g, i) => el("div", { class: "cmp-guide " + g.axis, title: `${g.at} px · double-click to remove`,
    style: g.axis === "x" ? `left:${ox + g.at * scale}px` : `top:${oy + g.at * scale}px`,
    ondblclick: () => { snapshot(); comp.guides.splice(i, 1); changed({ keepList: true }); } })));
}
const addGuide = axis => e => {   // (clicking a ruler drops a guide there)
  if (!comp) return;
  const [x, y] = toStage(e);
  snapshot();
  guides().push({ axis, at: Math.round(axis === "x" ? x : y) });
  changed({ keepList: true });
};
rulerX.addEventListener("mousedown", e => { e.stopPropagation(); addGuide("x")(e); });
rulerY.addEventListener("mousedown", e => { e.stopPropagation(); addGuide("y")(e); });
new ResizeObserver(() => drawRulers()).observe(view);
function canvasTools() {
  const t = $("#cmp-canvas-tools");
  const bgs = [["checker", "Checker"], ["#000", "Black"], ["#808080", "Grey"], ["#fff", "White"]];
  let bg = "checker";
  try { bg = localStorage.getItem("sg-cmp-bg") || bg; } catch (e) { /* */ }
  const paint = () => { view.dataset.bg = bg === "checker" ? "checker" : ""; view.style.setProperty("--cmp-bg", bg === "checker" ? "" : bg); };
  paint();
  t.replaceChildren(
    el("div", { class: "seg" }, el("button", { class: "small", id: "cmp-undo", "aria-label": "Undo", title: "Undo (Ctrl+Z)", disabled: true, onclick: () => back(undo, redo) }, "↶ Undo"),
      el("button", { class: "small", id: "cmp-redo", "aria-label": "Redo", title: "Redo (Ctrl+Y)", disabled: true, onclick: () => back(redo, undo) }, "Redo ↷")),
    el("button", { class: "small" + (rulers ? " on" : ""), onclick: e => { rulers = !rulers; try { localStorage.setItem("sg-rulers", rulers ? "on" : "off"); } catch (x) { /* */ } e.target.classList.toggle("on", rulers); drawRulers(); } }, "Rulers"),
    el("div", { class: "seg zoom" },
      el("button", { class: "small", "aria-label": "Zoom out", onclick: () => stepZoom(-1) }, "−"),
      el("button", { class: "small", id: "cmp-zoom", title: "100%", onclick: () => zoomTo(1) }, Math.round(scale * 100) + "%"),
      el("button", { class: "small", "aria-label": "Zoom in", onclick: () => stepZoom(1) }, "+")),
    el("button", { class: "small", onclick: () => { zoom = "fit"; fit(); } }, "Fit"),
    el("button", { class: "small", onclick: () => { const n = sheet.firstChild; if (n) [...n.children].forEach(l => play(l, l._layer, "in")); } }, "▶ In"),
    el("button", { class: "small", onclick: () => { const n = sheet.firstChild; if (n) Promise.all([...n.children].map(l => play(l, l._layer, "out"))).then(() => setTimeout(drawCanvas, 400)); } }, "Out"),
    el("span", { class: "spacer" }),
    ...bgs.map(([v, n]) => el("button", { class: "small ghost", onclick: () => { bg = v; try { localStorage.setItem("sg-cmp-bg", v); } catch (e) { /* */ } paint(); } }, n)));
}
canvasTools();

// --- for the Add panel (composer-lib.js) ---------------------------------------------------
export function addLayers(list, { keepPlace = false } = {}) {
  if (!comp) { toast("Pick a graphic first"); return []; }
  snapshot();
  const made = list.map(o => {
    const l = { visible: true, opacity: 1, rotation: 0, anim: { in: { type: "fade", dur: 400, delay: 0 }, out: { type: "fade", dur: 250, delay: 0 } }, ...JSON.parse(JSON.stringify(o)), id: uid("l") };
    if (!keepPlace && l.x == null) { l.x = Math.round((W - l.w) / 2); l.y = Math.round((H - l.h) / 2); }
    return l;
  });
  comp.layers.push(...made);
  sel = new Set(made.map(l => l.id));
  changed();
  return made;
}
export const composer = {
  get comp() { return comp; }, picked, open: openComp, changed, snapshot,
  // HUD mode: the editor moves into the HUD Builder page and edits one part of a HUD
  editPart(hudId, partId, into) {
    if (dirty) save();
    const h = (App.state.project.huds || []).find(x => x.id === hudId), p = h && h.parts.find(x => x.id === partId);
    if (!p) return;
    const cmp = document.querySelector("#page-composer .cmp, #page-hudbuilder .cmp");
    if (into && cmp.parentNode !== into) into.appendChild(cmp);
    cmp.classList.add("hud-mode");
    hudCtx = { hudId, partId };
    keepHistory();
    compId = "hud:" + hudId + ":" + partId;
    comp = { id: compId, name: p.name, width: W, height: H, layers: JSON.parse(JSON.stringify(p.layers)) };
    sel = new Set(); takeHistory(compId);
    renderLayers(); drawCanvas(); renderProps(); setTimeout(fit, 0);
  },
  setShow(all, force) { stage.opts.all = !!all; stage.opts.force = force || null; if (hudCtx) drawCanvas(); },
  leaveHud() {
    if (!hudCtx) return;
    if (dirty) save();
    hudCtx = null; comp = null; compId = null; sel = new Set(); stage.opts.all = false; stage.opts.force = null;
    const cmp = document.querySelector(".cmp"); cmp.classList.remove("hud-mode");
    document.getElementById("hb-parts-panel")?.remove();   // (the HUD Builder's Parts panel stays with it)
    $("#page-composer").appendChild(cmp);
    renderLayers(); drawCanvas(); renderProps();
  },
  startLine() { if (!comp) return toast("Pick a graphic first"); liner = { pts: [] }; view.classList.add("pen"); sel = new Set(); drawSelection(); toast("Click to place points (Shift: straight). Start on a line's end to carry it on. Double-click or Enter to finish"); },
  startPen() { if (!comp) return toast("Pick a graphic first"); pen = []; view.classList.add("pen"); toast("Click points on the canvas; click the first one (or press Enter) to close"); },
};

// --- properties ---------------------------------------------------------------------
const FONTS = ["Inter", "Montserrat", "Barlow Condensed", "Bebas Neue", "Anton", "Permanent Marker", "Vazirmatn"];
const SHAPES = ["rect", "pill", "ellipse", "triangle", "diamond", "polygon", "star", "parallelogram", "trapezoid", "chevron", "tab", "arrow", "shield", "path"];
const EASE_OPTS = [["", "Smooth"], ["sharp", "Sharp (no easing)"], ["in", "Ease in"], ["out", "Ease out"], ["inout", "Ease in and out"], ["snappy", "Snappy"], ["overshoot", "Overshoot"]];
const ANIMS = [["none", "None"], ["fade", "Fade"],
  ["fly-left", "Fly from left (off screen)"], ["fly-right", "Fly from right (off screen)"], ["fly-top", "Fly from top (off screen)"], ["fly-bottom", "Fly from bottom (off screen)"],
  ["fly-left-bounce", "Fly from left + bounce"], ["fly-right-bounce", "Fly from right + bounce"], ["drop", "Drop and bounce"], ["rise", "Rise"],
  ["slide-left", "Slide in from right (short)"], ["slide-right", "Slide in from left (short)"], ["slide-up", "Slide up (short)"], ["slide-down", "Slide down (short)"], ["push-right", "Push in from the left (a side panel)"], ["push-left", "Push in from the right (a side panel)"], ["push-up", "Push up from the bottom (a board)"], ["blur-slide", "Blur slide"],
  ["wipe-right", "Wipe right"], ["wipe-left", "Wipe left"], ["wipe-down", "Wipe down"], ["wipe-up", "Wipe up"], ["blinds", "Open from the middle"], ["blinds-y", "Open from the middle (up/down)"], ["iris", "Iris (circle)"], ["type-on", "Typewriter"],
  ["grow-x", "Grow across"], ["grow-y", "Grow down"], ["scale", "Scale"], ["zoom-in", "Zoom in"], ["zoom-out", "Zoom out"], ["pop", "Pop"], ["elastic", "Elastic pop"],
  ["flip-x", "Flip (sideways)"], ["flip-y", "Flip (over)"], ["swing", "Swing down"], ["spin", "Spin in"], ["blur", "Blur"], ["glitch", "Glitch"],
  ["dissolve", "Dissolve"], ["nano", "Nano drones (glowing edge)"], ["parasite", "Parasites (eaten away)"]];   // ([saved name, what it's called]; Out plays each one backwards)
function bind(l, key, kind = "text", extra = {}) {
  const set = v => { snapshot(); l[key] = v; changed({ keepList: key !== "name" && key !== "field", keepProps: !extra.redraw }); };
  if (kind === "select") return el("select", { onchange: e => set(extra.num && e.target.value !== "" ? +e.target.value : e.target.value) }, ...extra.options.map(o => Array.isArray(o) ? el("option", { value: o[0], selected: String(l[key] ?? extra.def ?? "") === String(o[0]) }, o[1]) : el("option", { value: o, selected: (l[key] ?? extra.def) === o }, o)));
  if (kind === "check") return el("label", { class: "switch" }, el("input", { type: "checkbox", checked: !!l[key], onchange: e => set(e.target.checked) }), extra.label);
  if (kind === "color") return el("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(l[key] || "") ? l[key] : "#ffffff", onchange: e => set(e.target.value) });
  if (kind === "number") return el("input", { type: "number", value: l[key] ?? extra.def ?? 0, step: extra.step || 1, min: extra.min, "data-k": key,
    onfocus: () => snapshot(),   // (one undo step per box, however many changes while typing)
    oninput: e => { if (e.target.value === "" || isNaN(+e.target.value)) return; l[key] = +e.target.value; changed({ keepList: key !== "name" && key !== "field", keepProps: true }); },   // (the canvas follows as you type)
    onchange: e => set(+e.target.value || 0) });
  if (kind === "chip") {   // (live data as labelled chips, plus a list to pick it from: no {{...}} to type)
    const box = chipBox(l[key] ?? "", set, { placeholder: extra.placeholder || "", label: extra.label || key });
    const tables = (App.state && App.state.data && App.state.data.tables) || {};
    const groups = Object.entries(tables).filter(([, rows]) => rows && rows[0] && rows[0][0] === "Field" && rows[0][1] === "Value")
      .map(([t, rows]) => el("optgroup", { label: t }, ...rows.slice(1).filter(r => r[0]).map(r => el("option", { value: `{{${t}!${r[0]}}}` }, r[0]))));
    const pick = el("select", { "aria-label": "Pick live data", onchange: e => { const v = e.target.value === "__clear" ? "" : e.target.value; e.target.value = ""; box.set(v); set(v); } },
      el("option", { value: "" }, "Pick live data…"), el("option", { value: "__clear" }, "None (clear it)"), ...groups);
    return el("div", { class: "chip-field" }, box, pick);
  }
  if (kind === "area") return el("textarea", { rows: 3, onchange: e => set(e.target.value) }, l[key] ?? "");
  return el("input", { value: l[key] ?? "", placeholder: extra.placeholder || "", onchange: e => set(e.target.value) });
}
function renderPropsNumbers() {   // (while dragging: just the position boxes)
  const l = picked()[0];
  if (!l) return;
  for (const k of ["x", "y", "w", "h"]) { const i = $(`#cmp-props [data-k="${k}"]`); if (i) i.value = Math.round(l[k]); }
}
function animSect(l) {
  const a = l.anim = l.anim || {};
  const row = dir => { const d = a[dir] = a[dir] || {}; return el("div", { class: "three" },
    lab(dir === "in" ? "In" : "Out", bind(d, "type", "select", { options: ANIMS, def: "none" })), lab("Length (ms)", bind(d, "dur", "number", { def: 400, step: 50 })), lab("Delay (ms)", bind(d, "delay", "number", { def: 0, step: 50 })),
    lab("Easing", bind(d, "ease", "select", { options: EASE_OPTS, def: "" }))); };
  return el("section", { class: "sect" }, el("h4", {}, "Animation"), row("in"), row("out"));
}
// Slots: shows as many as there are (casters). Each layer's slot is set in its own settings.
function slotsSect() {
  const S = comp.slots = comp.slots || {};
  const used = comp.layers.filter(l => l.slot).length;
  return el("div", { class: "stack" }, el("h4", {}, "Shows as many as there are"),
    el("label", { class: "switch" }, el("input", { type: "checkbox", checked: !!S.on, onchange: e => { snapshot(); S.on = e.target.checked; changed(); } }), "On (like the caster lower third)"),
    S.on ? el("div", { class: "stack" },
      lab("How many (blank: the ones with a name typed in)", bind(S, "count", "chip", { placeholder: "the filled ones, or pick e.g. Caster boxes" })),
      el("div", { class: "two" }, lab("Slots go", bind(S, "axis", "select", { options: [["x", "Across"], ["y", "Down"]], def: "x" })), lab("Slot to slot (px, blank: measured)", bind(S, "step", "text", { placeholder: "auto" }))),
      el("p", { class: "muted small" }, `${used} layers have a slot. Give each layer its slot (1, 2, 3, 4) in its settings, the bar behind them "Stretch", and things on the bar's edge (a logo) "Follow". A slot with nothing typed in hides; the rest close up and move to the middle.`),
      el("button", { class: "small", onclick: autoSlots }, "Guess the slots from the layout")) : "");
}
// The repeated columns (or rows) of a design become slots 1, 2, 3...; wide layers across them stretch; the rest at an edge follow.
function autoSlots() {
  const S = comp.slots, P = S.axis === "y" ? "y" : "x", D = S.axis === "y" ? "h" : "w";
  const small = comp.layers.filter(l => l[D] < (S.axis === "y" ? 1080 : 1920) * 0.4);
  const starts = [...new Set(small.map(l => Math.round(l[P])))].sort((a, b) => a - b);
  // columns that repeat: starts with at least 2 layers each, evenly spaced
  const cols = starts.filter(x => small.filter(l => Math.abs(l[P] - x) < 4).length >= 2);
  if (cols.length < 2) return toast("Couldn't find repeated slots: set each layer's slot by hand");
  snapshot();
  const step = cols[1] - cols[0];
  const lo = cols[0], hi = cols[cols.length - 1] + step;
  for (const l of comp.layers) {
    const i = cols.findIndex(x => Math.abs(l[P] - x) < 4);
    if (i >= 0 && l[D] <= step * 1.05) l.slot = i + 1;
    else if (l[P] <= lo && l[P] + l[D] >= hi - 4) l.slot = "stretch";
    else if (l[P] + l[D] <= lo + 4) l.slot = "follow";
    else if (l[P] >= hi - 4) l.slot = "follow";
    else delete l.slot;
  }
  changed();
  toast(`${cols.length} slots, ${step} px apart: clear a caster's name on Control and that slot goes`);
}
function setAll(stagger) {
  const type = $("#cmp-all-anim").value;
  snapshot();
  comp.layers.forEach((l, i) => {
    l.anim = l.anim || {};
    l.anim.in = { ...(l.anim.in || {}), type, dur: (l.anim.in || {}).dur || 400, delay: stagger ? i * 60 : 0 };
    l.anim.out = { ...(l.anim.out || {}), type: type === "none" ? "none" : "fade", dur: 250, delay: 0 };
  });
  changed();
}
function renderProps() {
  const box = $("#cmp-props");
  if (!comp) return box.replaceChildren();
  const ls = picked();
  if (!ls.length && hudCtx) {
    return box.replaceChildren(el("section", { class: "sect" }, el("h4", {}, "HUD part"),
      lab("Name", bind(comp, "name")),
      el("p", { class: "muted small" }, `${comp.layers.length} layers. Click a layer on the canvas or in Layers to change it; Add (left) puts in text, shapes, pictures and more.`),
      el("p", { class: "muted small" }, "The rest of the HUD shows dimmed behind this part. Live data keeps working: use Show above to see a phase (buy phase, a round win) without a game."),
      el("p", { class: "muted small" }, "A layer shows only while its “Show only while” field has a value (Layer settings). Changes save by themselves and are on air at once."),
      el("h4", {}, "Animation"),
      el("p", { class: "muted small" }, "Set every layer's In and Out at once:"),
      el("div", { class: "row" }, el("select", { id: "cmp-all-anim" }, ...ANIMS.map(([v, t]) => el("option", { value: v, selected: v === "fade" }, t))),
        el("button", { class: "small", onclick: () => setAll(false) }, "All together"), el("button", { class: "small", onclick: () => setAll(true) }, "One after another"))));
  }
  if (!ls.length) {
    return box.replaceChildren(el("section", { class: "sect" }, el("h4", {}, "Graphic"),
      lab("Name", bind(comp, "name")),
      lab("Kind", bind(comp, "kind", "select", { options: [["board", "Full-page board (one at a time)"], ["lower third", "Lower third (one at a time)"], ["overlay", "Overlay (scorebug, ticker…)"]], def: "overlay" })),
      lab("Stacking on the output", bind(comp, "layer", "select", { options: [[-10, "Behind others"], [0, "Normal"], [10, "In front"], [100, "Always on top"]], def: 0, num: true })),
      App.state.obs && App.state.obs.on ? lab("When it goes on air, switch OBS to", bind(comp, "obs_scene", "select", { options: [["", "(don't switch)"], ...[...new Set([comp.obs_scene, ...((App.state.obs.status || {}).scenes || [])])].filter(Boolean).map(s => [s, s])], def: "" })) : null,
      el("p", { class: "muted small" }, `${comp.layers.length} layers, ${comp.layers.filter(l => l.field).length} fields. Click a layer to change it.`),
      slotsSect(),
      el("h4", {}, "Animation"),
      el("p", { class: "muted small" }, "Every layer has its own In and Out animation. Set them all at once:"),
      el("div", { class: "row" }, el("select", { id: "cmp-all-anim" }, ...ANIMS.map(([v, t]) => el("option", { value: v, selected: v === "fade" }, t))),
        el("button", { class: "small", onclick: () => setAll(false) }, "All together"), el("button", { class: "small", onclick: () => setAll(true) }, "One after another")),
      el("div", { class: "row" },
        el("button", { class: "small", onclick: async () => { const c = JSON.parse(JSON.stringify(comp)); delete c.id; c.name += " copy"; c.layers.forEach(l => (l.id = uid("l"))); const r = await api("/api/comp", { comp: c }); setTimeout(() => openComp(r.comp.id), 300); } }, "Duplicate"),
        el("a", { class: "small ghost btn", href: `/api/export?ids=${encodeURIComponent(comp.id)}`, download: "", title: "A pack for another StandBy GFX" }, "Export"),
        el("a", { class: "small ghost btn", href: `/api/export/html?ids=${encodeURIComponent(comp.id)}`, download: "", title: "Plays without the engine: CasparCG / SPX template or any browser" }, "HTML"),
        el("button", { class: "small ghost", onclick: async () => { const name = comp.name; await api("/api/comp/delete", { id: comp.id }); compId = null; comp = null; renderLayers(); drawCanvas(); renderProps(); toast(`Deleted "${name}"`, { label: "Undo", run: () => api("/api/comp/restore", {}) }); } }, "Delete"))));
  }
  const partOf = ls.length && ls.every(l => l.part && l.part === ls[0].part && l.part_at === ls[0].part_at) ? ls[0] : null;
  const partSect = partOf ? el("section", { class: "sect" }, el("h4", {}, "Part: " + (((App.state.project.parts || []).find(p => p.id === partOf.part) || {}).name || "?")),
      el("p", { class: "muted small" }, "Change this copy, then update the part: every copy in every graphic changes."),
      el("div", { class: "row" },
        el("button", { class: "small primary", onclick: async () => { await save(); const r = await api("/api/part/update", { id: partOf.part, comp: comp.id, inst: partOf.part_at }); toast(`Updated ${r.copies} copies`); setTimeout(() => openComp(comp.id), 300); } }, "Update the part"),
        el("button", { class: "small ghost", onclick: () => { snapshot(); for (const l of comp.layers) if (l.part_at === partOf.part_at) { delete l.part; delete l.part_at; } changed(); } }, "Detach this copy")))
    : ls.length > 1 ? el("section", { class: "sect" }, el("h4", {}, "Part"),
      el("button", { class: "small", onclick: async () => {
        const name = await askText("Name of the part", "Name plate");
        if (!name) return;
        const r = await api("/api/part/make", { name, layers: ls });
        snapshot();
        const inst = uid("i");
        for (const l of ls) { l.part = r.part.id; l.part_at = inst; }
        changed();
        toast(`Saved the part "${name}": find it under Parts`);
      } }, "Save as part")) : null;
  if (ls.length > 1) {
    return box.replaceChildren(...[partSect].filter(Boolean), el("section", { class: "sect" }, el("h4", {}, `${ls.length} layers`),
      el("div", { class: "three" }, ...[["Left", l => l.x = Math.min(...ls.map(o => o.x))], ["Centre", l => l.x = Math.round((Math.min(...ls.map(o => o.x)) + Math.max(...ls.map(o => o.x + o.w)) - l.w) / 2)], ["Right", l => l.x = Math.max(...ls.map(o => o.x + o.w)) - l.w],
        ["Top", l => l.y = Math.min(...ls.map(o => o.y))], ["Middle", l => l.y = Math.round((Math.min(...ls.map(o => o.y)) + Math.max(...ls.map(o => o.y + o.h)) - l.h) / 2)], ["Bottom", l => l.y = Math.max(...ls.map(o => o.y + o.h)) - l.h]]
        .map(([t, fn]) => el("button", { class: "small", onclick: () => { snapshot(); ls.forEach(fn); changed({ keepList: true }); } }, t))),
      ls.filter(o => o.shape !== "line").length >= 2 ? el("button", { class: "small primary", title: "A line from each box to the next (in the order picked), bent at right angles; it follows the boxes",
        onclick: () => { const bs = ls.filter(o => o.shape !== "line"); for (let i = 1; i < bs.length; i++) connect(bs[i - 1], bs[i]); } }, "Connect with lines") : ""),
      ...multiEdit(ls));
  }
  const l = ls[0], T = l.type;
  const connSect = l.shape === "line" && l.from && l.to ? el("section", { class: "sect" }, el("h4", {}, "Connector"),
    el("p", { class: "muted small" }, `From "${(layerById(l.from.id) || {}).name || "box"}" to "${(layerById(l.to.id) || {}).name || "box"}": it follows the boxes. Drag an end onto another box's side to move it.`),
    el("div", { class: "two" },
      lab("Leaves from", el("select", { onchange: e => { snapshot(); l.from.side = e.target.value; changed({ keepList: true }); } }, ...SIDES.map(sd => el("option", { value: sd, selected: l.from.side === sd }, sd)))),
      lab("Arrives at", el("select", { onchange: e => { snapshot(); l.to.side = e.target.value; changed({ keepList: true }); } }, ...SIDES.map(sd => el("option", { value: sd, selected: l.to.side === sd }, sd)))))) : null;
  const sects = [el("section", { class: "sect" }, el("h4", {}, ({ text: "Text", rect: "Box", shape: "Shape", image: "Picture", video: "Video", rotator: "Rotator", ticker: "Ticker", bracket: "Bracket", web: "Web page", lottie: "Lottie", camera: "Camera", shader: "Shader" })[T] || T),
    lab("Name", bind(l, "name")),
    lab("Field (set from Control)", bind(l, "field", "text", { placeholder: "(fixed: not a field)" })),
    el("div", { class: "four" }, ...["x", "y", "w", "h"].map(k => lab(k.toUpperCase(), bind(l, k, "number")))),
    el("div", { class: "three" }, lab("Opacity", bind(l, "opacity", "number", { def: 1, step: 0.05, min: 0 })), lab("Rotate °", bind(l, "rotation", "number")),
      lab("Blend", bind(l, "blend", "select", { options: ["normal", "multiply", "screen", "overlay", "darken", "lighten", "soft-light", "difference"], def: "normal" }))),
    lab("Only shows while this has a value", bind(l, "show", "chip", { placeholder: "always shows; or pick e.g. Player 1 headshot" })),
    comp.slots && comp.slots.on ? lab("Slot (shows as many as there are)", bind(l, "slot", "select", { options: [["", "None"], ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => [n, `Slot ${n}`]), ["stretch", "Stretch (the bar behind)"], ["follow", "Follow (moves with the bar's edge)"]], def: "" })) : "")];
  if (T === "text") sects.push(el("section", { class: "sect" }, el("h4", {}, "Words"),
    lab("Text (live data shows as chips)", chipBox(l.text, v => { snapshot(); l.text = v; changed({ keepList: true, keepProps: true }); }, { multiline: true, label: "Text" })),
    el("div", { class: "two" }, lab("Font", bind(l, "font", "select", { options: [...new Set([...FONTS, ...(App.state.fonts || []).map(f => f.name), l.font].filter(Boolean))], def: "Inter" })), lab("Size", bind(l, "size", "number", { def: 32 }))),
    el("div", { class: "three" }, lab("Colour", bind(l, "color", "color")), lab("Weight", bind(l, "weight", "select", { options: [300, 400, 500, 600, 700, 800, 900].map(n => [n, String(n)]), def: 400, num: true })), lab("Spacing", bind(l, "tracking", "number"))),
    el("div", { class: "three" }, lab("Across", bind(l, "align", "select", { options: ["left", "center", "right"], def: "left" })), lab("Down", bind(l, "valign", "select", { options: ["top", "middle", "bottom"], def: "middle" })), lab("Line height", bind(l, "lineHeight", "number", { def: 1.15, step: 0.05 }))),
    el("div", { class: "two" }, lab("Too long", bind(l, "fit", "select", { options: [["shrink", "Shrink to fit"], ["none", "Run over"], ["wrap", "Wrap"]], def: "shrink" })), lab("Scroll (px/s, ticker)", bind(l, "scroll", "number", { def: 0 }))),
    +l.scroll > 0 ? lab("Between lines", ((sel) => (sel.addEventListener("change", () => changed({ keepList: true })), sel))(bind(l, "sepMark", "select", { options: [["bar", "Bar"], ["|", "|"], ["•", "•"], ["/", "/"], ["◆", "◆"], ["—", "—"], ["none", "None (just space)"]], def: l.divider ? "bar" : "|" }))) : null,
    +l.scroll > 0 && (l.sepMark || (l.divider ? "bar" : "|")) === "bar" ? el("div", { class: "two" }, lab("Bar colour", bind(l, "divider", "text", { placeholder: "e.g. #ffc52a (blank: the text's)" })), lab("Bar width", bind(l, "dividerWidth", "number", { def: 5 }))) : null,
    el("div", { class: "row" }, bind(l, "caps", "check", { label: "Capitals" }), bind(l, "italic", "check", { label: "Italic" }))));
  if (T === "rect" || T === "shape") sects.push(el("section", { class: "sect" }, el("h4", {}, "Look"),
    T === "shape" ? lab("Shape", bind(l, "shape", "select", { options: SHAPES, def: "rect" })) : null,
    el("div", { class: "two" }, lab("Fill", bind(l, "fill", "color")), lab("Corner radius", bind(l, "radius", "number"))),
    el("div", { class: "two" }, lab("Border", bind(l, "stroke", "color")), lab("Border width", bind(l, "strokeWidth", "number"))),
    T === "shape" && l.shape === "polygon" ? lab("Sides", bind(l, "sides", "number", { def: 6, min: 3 })) : null,
    T === "shape" && l.shape === "star" ? lab("Points", bind(l, "points", "number", { def: 5, min: 3 })) : null,
    lab("Fill from live data (instead)", bind(l, "fill", "chip", { placeholder: "pick e.g. Left color" }))));
  if (T === "image" || T === "video") sects.push(el("section", { class: "sect" }, el("h4", {}, "Source"),
    lab("File", picker(T, (l.src || "").startsWith("assets/") ? l.src : "", v => { snapshot(); l.src = v; changed({ keepProps: true }); }, comp.name)),
    lab("Or live data", bind(l, "src", "chip", { placeholder: "pick e.g. Left logo" })),
    el("div", { class: "two" }, lab("Fit", bind(l, "fit", "select", { options: [["contain", "Fit inside"], ["cover", "Fill and crop"], ["fill", "Stretch"]], def: "contain" })),
      lab("Sits at", bind(l, "position", "select", { options: [["", "Middle"], ["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"]], def: "" }))),
    lab("Cut to a shape (frame)", bind(l, "clip", "select", { options: [["", "None"], ...clipShapes.map(c => [c, c])], def: "" })),
    T === "image" ? lab("When live data has none", picker("image", l.placeholder || "", v => { snapshot(); l.placeholder = v; changed({ keepProps: true }); })) : null,
    T === "image" ? el("p", { class: "muted small" }, "{{Sponsors}} shows each sponsor in turn; {{Sponsors all}} shows every sponsor in a row.") : null,
    T === "image" ? el("div", { class: "two" }, bind(l, "mono", "check", { label: "White sponsor logos (footer)" }),
      lab("Sponsor change", bind(l, "swap", "select", { options: [["", "Lift and fade"], ["fade", "Fade"], ["cut", "Cut"]], def: "" }))) : null,
    T === "image" && /\{\{\s*sponsors\s*\}\}/i.test(l.src || "") ? el("div", { class: "two" }, bind(l, "bar", "check", { label: "Show a bar with the time it has left" }),
      l.bar ? lab("Bar colour", bind(l, "barColor", "text", { placeholder: "#ffffff" })) : el("span")) : null,
    T === "video" ? el("div", { class: "row" }, bind(l, "loop", "check", { label: "Loop" }), bind(l, "audio", "check", { label: "Sound on Program" })) : null,
    T === "video" ? el("div", { class: "three" }, lab("Tint", bind(l, "tint", "text", { placeholder: "(none)" })), lab("Brightness", bind(l, "brightness", "text")), lab("Speed", bind(l, "speed", "text"))) : null));
  if (T === "rotator" || T === "ticker") sects.push(itemsSect(l));
  if (T === "bracket") sects.push(el("section", { class: "sect" }, el("h4", {}, "Bracket"),
    el("p", { class: "muted small" }, "Shows the Tournament page's knockout bracket."),
    lab("Font", bind(l, "font", "select", { options: fontList(l) })),
    el("div", { class: "four" }, lab("Winner", bind(l, "gold", "color")), lab("Empty", bind(l, "dark", "color")), lab("Lines", bind(l, "line", "color")), lab("Champion text", bind(l, "color", "color")))));
  if (T === "camera") {
    const cams = App.state.project.cams || [];
    sects.push(el("section", { class: "sect" }, el("h4", {}, "Camera"),
      lab("Camera", bind(l, "cam", "select", { options: [["", "(pick one)"], ...cams.map(c => [c.name, c.name]), ...(l.cam && !cams.some(c => c.name === l.cam) ? [[l.cam, l.cam]] : [])], def: "" })),
      lab("Or the camera named by live data", bind(l, "cam", "chip", { placeholder: "pick e.g. Player 1 name" })),
      el("p", { class: "muted small" }, "Cameras are set up on the Cameras page (a VDO.Ninja link per guest). Their look and framing apply everywhere they show. Here the canvas shows a card; outputs show the live picture."),
      lab("Picture", bind(l, "fit", "select", { options: [["cover", "Fill the box (crop the sides)"], ["contain", "Whole picture (bars)"]], def: "cover" })),
      lab("Behind the picture", bind(l, "bg", "text", { placeholder: "transparent" }))));
  }
  if (T === "lottie") sects.push(el("section", { class: "sect" }, el("h4", {}, "Lottie"),
    lab("Animation (.json from After Effects / Bodymovin)", picker("data", (l.src || "").startsWith("assets/") ? l.src : "", v => { snapshot(); l.src = v; changed({ keepProps: true }); }, comp.name)),
    el("div", { class: "three" }, bind(l, "loop", "check", { label: "Loop" }), lab("Speed", bind(l, "speed", "number", { def: 1, step: 0.1 })),
      lab("Fit", bind(l, "fit", "select", { options: [["contain", "Fit inside"], ["cover", "Fill and crop"]], def: "contain" })))));
  if (T === "shader") sects.push(el("section", { class: "sect" }, el("h4", {}, "Shader"),
    lab("Look", bind(l, "look", "select", { options: [...Object.entries(LOOKS).map(([k, v]) => [k, v[0]]), ["custom", "Custom (GLSL)"]], def: "aurora", redraw: true })),
    el("div", { class: "three" }, lab("Colour 1", bind(l, "a", "color")), lab("Colour 2", bind(l, "b", "color")), lab("Colour 3", bind(l, "c", "color"))),
    el("div", { class: "two" }, lab("Speed", bind(l, "speed", "number", { def: 1, step: 0.1, min: 0 })),
      lab("Sharpness", bind(l, "quality", "select", { options: [["0.25", "Soft (lightest)"], ["0.5", "Normal"], ["1", "Full (heaviest)"]], def: "0.5" }))),
    l.look === "custom" ? lab("GLSL (set gl_FragColor; u_time, u_res, u_a, u_b, u_c and fbm(p) are ready)", bind(l, "code", "area")) : "",
    el("p", { class: "muted small" }, "Runs on the graphics card in OBS or vMix. Keep big shaders on Soft or Normal.")));
  if (T === "web") sects.push(el("section", { class: "sect" }, el("h4", {}, "Web page"), lab("Address", bind(l, "src", "text", { placeholder: "https://" }))));
  if (T === "image" || T === "video") sects.push(picSect(l));
  if (partSect) sects.unshift(partSect);
  if (connSect) sects.splice(1, 0, connSect);
  sects.push(fxSect(l));
  sects.push(animSect(l));
  box.replaceChildren(...sects);
}

// Several layers picked: one box changes them all (a box shows a value only when they all have the same one).
function many(ls, defs = {}) {
  const m = {};
  for (const k of ["font", "size", "weight", "color", "tracking", "align", "valign", "lineHeight", "caps", "italic", "opacity", "fill", "radius", "stroke", "strokeWidth"])
    Object.defineProperty(m, k, { enumerable: true, get: () => { const v = ls.map(l => l[k] ?? defs[k]); return v.every(x => String(x) === String(v[0])) ? v[0] : undefined; },
      set: v => { if (v === "") return; for (const l of ls) l[k] = v; } });   // ("(mixed)" picked: leaves them as they are)
  return m;
}
function multiEdit(ls) {
  const texts = ls.filter(l => l.type === "text"), boxes = ls.filter(l => l.type === "rect" || l.type === "shape"), out = [];
  if (texts.length) {
    const m = many(texts, { font: "Inter", size: 32, weight: 400, align: "left", valign: "middle", lineHeight: 1.15 });
    out.push(el("section", { class: "sect" }, el("h4", {}, `Text: all ${texts.length}`),
      el("div", { class: "two" }, lab("Font", bind(m, "font", "select", { options: ["", ...new Set(texts.flatMap(fontList))].map(f => [f, f || "(mixed)"]) })), lab("Size", bind(m, "size", "number", { def: "" }))),
      el("div", { class: "three" }, lab("Colour", bind(m, "color", "color")), lab("Weight", bind(m, "weight", "select", { options: [["", "(mixed)"], ...[300, 400, 500, 600, 700, 800, 900].map(n => [n, String(n)])], num: true })), lab("Spacing", bind(m, "tracking", "number", { def: "" }))),
      el("div", { class: "three" }, lab("Across", bind(m, "align", "select", { options: [["", "(mixed)"], "left", "center", "right"] })), lab("Down", bind(m, "valign", "select", { options: [["", "(mixed)"], "top", "middle", "bottom"] })), lab("Line height", bind(m, "lineHeight", "number", { def: "", step: 0.05 }))),
      el("div", { class: "row" }, bind(m, "caps", "check", { label: "Capitals" }), bind(m, "italic", "check", { label: "Italic" }))));
  }
  if (boxes.length) {
    const m = many(boxes);
    out.push(el("section", { class: "sect" }, el("h4", {}, `Boxes and shapes: all ${boxes.length}`),
      el("div", { class: "two" }, lab("Fill", bind(m, "fill", "color")), lab("Corner radius", bind(m, "radius", "number", { def: "" }))),
      el("div", { class: "two" }, lab("Border", bind(m, "stroke", "color")), lab("Border width", bind(m, "strokeWidth", "number", { def: "" })))));
  }
  // their In / Out animations, all at once
  const anim = dir => { const ds = ls.map(l => { const a = l.anim = l.anim || {}; return a[dir] = a[dir] || {}; }), m = {};
    for (const [k, d] of [["type", "none"], ["dur", 400], ["delay", 0], ["ease", ""]])
      Object.defineProperty(m, k, { get: () => { const v = ds.map(x => x[k] ?? d); return v.every(x => String(x) === String(v[0])) ? v[0] : undefined; },
        set: v => { if (v === "" && k !== "ease" || v === "__mixed") return; for (const x of ds) x[k] = v; } });   // ("" is Smooth for easing)
    return el("div", { class: "three" }, lab(dir === "in" ? "In" : "Out", bind(m, "type", "select", { options: [["", "(mixed)"], ...ANIMS] })),
      lab("Length (ms)", bind(m, "dur", "number", { def: "", step: 50 })), lab("Delay (ms)", bind(m, "delay", "number", { def: "", step: 50 })),
      lab("Easing", bind(m, "ease", "select", { options: [["__mixed", "(mixed)"], ...EASE_OPTS], def: "__mixed" }))); };
  out.push(el("section", { class: "sect" }, el("h4", {}, `Animation: all ${ls.length}`), anim("in"), anim("out")));
  const all = many(ls, { opacity: 1 });
  out.push(el("section", { class: "sect" }, el("h4", {}, `All ${ls.length}`), lab("Opacity", bind(all, "opacity", "number", { def: "", step: 0.05, min: 0 }))));
  return out;
}
const fontList = l => [...new Set([...FONTS, ...(App.state.fonts || []).map(f => f.name), l.font].filter(Boolean))];
// Rotator / ticker items: typed in, or one per row of a data table.
function itemsSect(l) {
  const tables = Object.keys((App.state.data && App.state.data.tables) || {});
  const list = l.items = l.items || [];
  const rows = list.map((it, i) => el("div", { class: "row" },
    el("input", { value: it.text || "", placeholder: "Words", onchange: e => { snapshot(); it.text = e.target.value; changed({ keepProps: true }); } }),
    picker("image", it.img || "", v => { snapshot(); it.img = v; changed({ keepProps: true }); }, comp.name),
    el("button", { class: "small ghost", "aria-label": "Remove item", onclick: () => { snapshot(); list.splice(i, 1); changed(); } }, "✕")));
  return el("section", { class: "sect" }, el("h4", {}, l.type === "rotator" ? "Rotator" : "Ticker"),
    lab("Items from a data table", bind(l, "source", "select", { options: [["", "(the list below)"], ...tables.map(t => [t, t])], def: "" })),
    l.source ? el("div", { class: "two" }, lab("Words column", bind(l, "textCol")), lab("Picture column", bind(l, "imgCol"))) : el("div", {}, ...rows,
      el("button", { class: "small", onclick: () => { snapshot(); list.push({ text: "", img: "" }); changed(); } }, "+ Item")),
    l.type === "rotator"
      ? el("div", { class: "three" }, lab("Each (s)", bind(l, "secs", "number", { def: 5, step: 0.5 })), lab("Swap", bind(l, "swap", "select", { options: ["crossfade", "fade", "cut", "slide up", "slide left", "push", "flip", "zoom", "blur", "wipe"], def: "crossfade" })),
          lab("Order", bind(l, "order", "select", { options: ["in order", "shuffle"], def: "in order" })))
      : el("div", { class: "three" }, lab("Speed (px/s)", bind(l, "speed", "number", { def: 120 })), lab("Gap", bind(l, "gap", "number", { def: 60 })), lab("Between", bind(l, "sep"))),
    el("div", { class: "three" }, lab("Font", bind(l, "font", "select", { options: fontList(l), def: "Inter" })), lab("Size", bind(l, "size", "number", { def: 36 })), lab("Colour", bind(l, "color", "color"))),
    el("div", { class: "three" }, lab("Picture height", bind(l, "imgSize", "number", { def: 80 })), lab("Weight", bind(l, "weight", "select", { options: [400, 500, 600, 700, 800].map(n => [n, String(n)]), def: 600, num: true })), bind(l, "caps", "check", { label: "Capitals" })),
    l.type === "ticker" ? bind(l, "fade", "check", { label: "Fade the edges" }) : null);
}
// Picture: light, colour, flip, crop.
function picSect(l) {
  const p = () => (l.pic = l.pic || {});
  const slider = (k, label, min, max, def, unit) => {
    const out = el("span", { class: "muted small" }, ((l.pic || {})[k] ?? def) + unit);
    return el("label", { class: "f" }, el("span", {}, label),
      el("div", { class: "row" }, el("input", { type: "range", min, max, value: (l.pic || {})[k] ?? def, onpointerdown: () => snapshot(),
        oninput: e => { p()[k] = +e.target.value; out.textContent = e.target.value + unit; changed({ keepList: true, keepProps: true }); } }), out));
  };
  const crop = side => el("input", { type: "number", min: 0, max: 95, value: ((l.pic || {}).crop || {})[side] || 0, onchange: e => { snapshot(); (p().crop = p().crop || {})[side] = +e.target.value || 0; changed({ keepProps: true }); } });
  return el("section", { class: "sect" }, el("h4", {}, "Picture"),
    slider("bright", "Brightness", 0, 200, 100, "%"), slider("contrast", "Contrast", 0, 200, 100, "%"), slider("sat", "Saturation", 0, 200, 100, "%"),
    slider("gray", "Black and white", 0, 100, 0, "%"), slider("hue", "Hue", -180, 180, 0, "°"),
    el("div", { class: "row" }, bind(p(), "flipX", "check", { label: "Flip across" }), bind(p(), "flipY", "check", { label: "Flip up and down" })),
    el("span", { class: "muted small" }, "Crop (% off each edge)"),
    el("div", { class: "four" }, lab("Left", crop("l")), lab("Top", crop("t")), lab("Right", crop("r")), lab("Bottom", crop("b"))),
    el("button", { class: "small", onclick: () => { snapshot(); delete l.pic; changed(); } }, "Reset picture"));
}
// Effects: shadow, glow, blur, background blur (each on / off with its settings).
function fxSect(l) {
  const fx = () => (l.fx = l.fx || {});
  const part = (key, label, def, fields) => {
    const on = !!(l.fx || {})[key];
    return el("div", {}, el("label", { class: "switch" }, el("input", { type: "checkbox", checked: on, onchange: e => { snapshot(); if (e.target.checked) fx()[key] = { ...def }; else delete fx()[key]; changed(); } }), label),
      on ? el("div", { class: "four" }, ...fields.map(([k, t, kind]) => lab(t, bind(fx()[key], k, kind || "number")))) : null);
  };
  return el("section", { class: "sect" }, el("h4", {}, "Effects"),
    part("shadow", "Shadow", { x: 0, y: 8, blur: 16, color: "#000000" }, [["x", "X"], ["y", "Y"], ["blur", "Blur"], ["color", "Colour", "color"]]),
    part("glow", "Glow", { blur: 16, color: "#c8f03c" }, [["blur", "Size"], ["color", "Colour", "color"]]),
    part("blur", "Blur", { blur: 6 }, [["blur", "Amount"]]),
    part("backdrop", "Blur what's behind", { blur: 12 }, [["blur", "Amount"]]));
}

// --- the page ------------------------------------------------------------------------
let listSig = "";
App.on(st => {
  if (App.page === "hudbuilder" && hudCtx) {   // (the HUD changed elsewhere and nothing's unsaved here: take it)
    const h = hudOf(), p = h && h.parts.find(x => x.id === hudCtx.partId);
    if (!p) return;
    if (!dirty && !dragging && JSON.stringify(p.layers) !== JSON.stringify(comp.layers) && !typingIn($("#cmp-props"))) { comp.layers = JSON.parse(JSON.stringify(p.layers)); renderLayers(); renderProps(); }
    if (st.data !== lastData || h !== lastHud) { lastData = st.data; lastHud = h; drawCanvas(); }   // (live data, and the other parts behind)
    return;
  }
  if (App.page !== "composer") return;
  const sig = JSON.stringify([st.project.compositions.map(c => [c.id, c.name, c.kind, c.layers.length]), st.trash]);
  if (sig !== listSig) { listSig = sig; renderGraphics(); }
  // someone else changed the graphic we're on (and we've nothing unsaved): take theirs
  const c = compId && st.project.compositions.find(x => x.id === compId);
  if (c && !dirty && !dragging && JSON.stringify(c) !== JSON.stringify(comp) && !typingIn($("#page-composer"))) { comp = JSON.parse(JSON.stringify(c)); renderLayers(); drawCanvas(); renderProps(); }
});
pages.composer = { shown() { composer.leaveHud(); listSig = ""; renderGraphics(); if (!compId && App.state.project.compositions[0]) openComp(App.state.project.compositions[0].id); setTimeout(fit, 0); } };
