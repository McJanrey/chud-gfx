// Composer: making and editing graphics. The graphic list and its layers on
// the left, the canvas in the middle (drag to move, handles to resize), the
// selected layer's properties and animation on the right.
"use strict";

(function composer() {
  const canvas = $("#canvas"), stage = $("#canvas-stage"), selLayer = $("#canvas-sel");
  let compId = null;          // the graphic being edited
  let comp = null;            // our copy of it (changes are saved as they're made)
  let root = null;            // its element on the canvas
  let selected = null;        // selected layer id
  const multi = new Set();    // more layers picked with Ctrl / Shift (their "Show when" set together)
  let scale = 0.5, offX = 0, offY = 0;
  let pending = false, lastSent = "";
  const undo = [], redo = [];
  try { compId = localStorage.getItem("gfx-edit"); } catch (e) { /* */ }

  const TYPE_ICON = { shape: "◆", text: "T", rect: "▭", image: "🖼", video: "▶", lottie: "✦", bracket: "⊏", web: "◫", ticker: "≋", rotator: "⟳" };

  // --- saving ------------------------------------------------------------
  const saveSoon = debounce(save, 120);
  function save() {
    if (!comp) return;
    const body = JSON.stringify(comp);
    if (body === lastSent) { pending = false; return; }
    lastSent = body;
    api("/api/comp/save", { comp }).finally(() => { pending = false; });
  }
  window.saveForUpdate = async () => {
    try { localStorage.setItem("gfx-resume", JSON.stringify({ comp: compId, layer: selected, multi: [...multi] })); } catch (e) { /* */ }
    if (!comp) return;
    const body = JSON.stringify(comp);
    if (body === lastSent) return;
    lastSent = body;
    await api("/api/comp/save", { comp });
  };
  function resume() {
    let r = null;
    try { r = JSON.parse(localStorage.getItem("gfx-resume") || "null"); localStorage.removeItem("gfx-resume"); } catch (e) { /* */ }
    if (!r || r.comp !== compId || !comp) return;
    const has = id => comp.layers.some(l => l.id === id);
    selected = has(r.layer) ? r.layer : null;
    multi.clear();
    for (const id of r.multi || []) if (has(id)) multi.add(id);
  }
  function changed(opts) {
    pending = true;
    saveSoon();
    redraw();
    if (!opts || !opts.keepList) renderLayers();
    if (opts && opts.props) renderProps();
    else syncPropsGeometry();
  }
  function snapshot() {
    undo.push(JSON.stringify(comp));
    if (undo.length > 100) undo.shift();
    redo.length = 0;
  }
  function restore(json) {
    comp = JSON.parse(json);
    if (!comp.layers.some(l => l.id === selected)) selected = null;
    for (const id of [...multi]) if (!comp.layers.some(l => l.id === id)) multi.delete(id);
    if (multi.size < 2) multi.clear();
    changed({ props: true });
  }

  // --- the graphic list ---------------------------------------------------
  function renderComps() {
    const list = $("#comp-list");
    const comps = App.comps();
    const sig = JSON.stringify([comps.map(c => [c.id, c.name, c.layers]), (App.state.trash || []).map(t => t.id)]) + compId;
    if (list.dataset.sig === sig) return;
    list.dataset.sig = sig;
    list.replaceChildren(...comps.map(c => h("div", { class: "comp-item" + (c.id === compId ? " sel" : ""), onclick: () => open(c.id),
      ondblclick: () => renameGraphic(c.id), oncontextmenu: e => { e.preventDefault(); renameGraphic(c.id); }, title: "Double-click or right-click to rename" },
      thumb(c, {}, 48), h("span", { class: "nm" }, c.name))));
    if (!comps.length) list.replaceChildren(h("div", { class: "empty" }, "No graphics yet."));
    renderTrash();
  }
  function open(id) {
    compId = id;
    selected = null;
    multi.clear();
    undo.length = redo.length = 0;
    try { localStorage.setItem("gfx-edit", id); } catch (e) { /* */ }
    adopt(true);
  }
  // Takes the engine's copy of the graphic (unless we've changes on the way).
  function adopt(force) {
    const server = App.comp(compId) || App.comps()[0];
    if (!server) { comp = null; compId = null; draw(); renderLayers(); renderProps(); renderComps(); return; }
    if (server.id !== compId) { compId = server.id; force = true; }
    const json = JSON.stringify(server);
    if (!force && (pending || json === JSON.stringify(comp))) return;
    if (!force && json === lastSent) return;
    comp = JSON.parse(json);
    lastSent = json;
    if (!adopt.done) { adopt.done = true; resume(); }
    if (selected && !comp.layers.some(l => l.id === selected)) selected = null;
    draw();
    renderLayers();
    renderProps();
    renderComps();
  }
  $("#comp-new").addEventListener("click", async () => {
    const name = prompt("Name of the new graphic", "New graphic");
    if (!name) return;
    const r = await api("/api/comp/new", { name, after: compId });
    open(r.comp.id);
  });
  $("#comp-import").addEventListener("click", () => $("#comp-import-file").click());
  $("#comp-import-file").addEventListener("change", async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    let r = await upload(f, true);
    // (video and After Effects are converted / rendered first)
    if (r && r.job && !(r.comps && r.comps[0])) r = await waitJob(r.job);
    if (!(r && r.comps && r.comps[0])) return;
    if (r.comps.length && !r.missing_fonts && !r.imported) toast(`Made the graphic "${r.comps[0].name}"`);
    // (once the engine's update with the new graphic is here)
    const id = r.comps[0].id;
    for (let i = 0; i < 40 && !App.comp(id); i++) await new Promise(res => setTimeout(res, 100));
    open(id);
  });
  $("#comp-export").addEventListener("click", () => {
    if (!compId) return;
    toast(`Exporting "${App.comp(compId).name}"… send the .chudgfx file to the other PC and Import it there`);
    location.href = `/api/share?comps=${compId}`;
  });
  $("#comp-dup").addEventListener("click", async () => { if (compId) open((await api("/api/comp/duplicate", { id: compId })).comp.id); });
  // Deleted graphics go to a bin: Undo on the message, or "Deleted…" above the list, brings them back.
  $("#comp-del").addEventListener("click", async () => {
    if (!comp) return;
    const id = compId, name = comp.name;
    await api("/api/comp/delete", { id });
    compId = null;
    adopt(true);
    toast(`Deleted "${name}" (off air too)`, false, { label: "Undo", run: async () => open((await restoreGraphic(id)).id) });
  });
  $("#comp-rename").addEventListener("click", () => compId && renameGraphic(compId));
  $("#canvas-name").addEventListener("dblclick", () => compId && renameGraphic(compId));
  const trashSel = $("#comp-trash");
  function renderTrash() {
    const t = App.state.trash || [];
    trashSel.hidden = !t.length;
    trashSel.replaceChildren(h("option", { value: "" }, `Deleted (${t.length})…`),
      ...t.map(x => h("option", { value: x.id }, `${x.name} · ${new Date(x.at * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`)));
  }
  trashSel.addEventListener("change", async () => {
    const id = trashSel.value;
    trashSel.value = "";
    if (id) open((await restoreGraphic(id)).id);
  });

  // --- layers ---------------------------------------------------------------
  // Like Canva / vMix: top layer first, each row a small preview of the layer,
  // its name (double-click to rename), and on hover its eye and lock. Drag to
  // restack (a line shows where it lands), right-click for the layer menu.
  let dragLayer = null;
  const SVG = d => { const t = document.createElement("template"); t.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">${d}</svg>`; return t.content.firstChild; };
  const ICONS = {
    eye: '<path d="M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7zm0 3a4 4 0 100 8 4 4 0 000-8zm0 2.2a1.8 1.8 0 110 3.6 1.8 1.8 0 010-3.6z"/>',
    eyeOff: '<path d="M3.3 2l18.7 18.7-1.3 1.3-3.4-3.4A11 11 0 0112 19c-5 0-9-4.5-10-7 .6-1.5 2.1-3.6 4.2-5.2L2 3.3zM8.4 9.7A4 4 0 0014.3 15.6zM12 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.3 3.5L16 11.8A4 4 0 0012.2 8L9.8 5.6C10.5 5.2 11.2 5 12 5z"/>',
    lock: '<path d="M7 10V7a5 5 0 0110 0v3h1a1 1 0 011 1v9a1 1 0 01-1 1H6a1 1 0 01-1-1v-9a1 1 0 011-1zm2 0h6V7a3 3 0 00-6 0z"/>',
    unlock: '<path d="M7 10V7a5 5 0 019.6-2l-1.8.9A3 3 0 009 7v3h9a1 1 0 011 1v9a1 1 0 01-1 1H6a1 1 0 01-1-1v-9a1 1 0 011-1z"/>',
  };
  // A small picture of the layer: its image, its colour, its text in its own font, or its kind.
  function layerPreview(l) {
    const box = h("span", { class: "ly-pv" });
    const plain = v => typeof v === "string" && v && !/\{\{/.test(v);
    if ((l.type === "image" || l.type === "video") && plain(l.src) && !/\.(mp4|webm|mov|m4v)$/i.test(l.src)) {
      box.appendChild(h("img", { src: encodeURI(l.src), alt: "", draggable: false, loading: "lazy" }));
    } else if (l.type === "rect") {
      box.appendChild(h("span", { class: "ly-sw", style: { background: plain(l.fill) ? l.fill : "repeating-linear-gradient(45deg,#555 0 4px,#333 4px 8px)",
        borderRadius: l.radius ? "4px" : "1px", outline: l.strokeWidth ? `2px solid ${l.stroke || "#fff"}` : "" } }));
    } else if (l.type === "shape") {
      const pv = GFX.buildShape(Object.assign({}, l, { fx: null }), l.fillType === "image" ? "" : (/\{\{/.test(l.fill || "") ? "#888" : l.fill), { still: true });
      const svg = pv.querySelector("svg");
      if (svg) svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      pv.style.padding = "3px";
      box.appendChild(pv);
    } else if (l.type === "text") {
      const [family, weight] = GFX.fontFor(l);
      box.appendChild(h("span", { class: "ly-tx", style: { fontFamily: family, fontWeight: weight, color: plain(l.color) ? l.color : "#fff" } }, "Aa"));
    } else {
      box.appendChild(h("span", { class: "ly-ic" }, TYPE_ICON[l.type] || "?"));
    }
    return box;
  }
  function renameLayer(l, row) {
    const nm = row.querySelector(".nm");
    if (!nm) return;
    const input = h("input", { class: "ly-rename", value: l.name, spellcheck: false });
    let done = false;
    const finish = keep => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (keep && v && v !== l.name) { snapshot(); l.name = v; changed({ props: true }); } else renderLayers();
    };
    input.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("click", e => e.stopPropagation());
    nm.replaceWith(input);
    input.focus();
    input.select();
  }
  // Restacking: "forward" is towards the front (later in comp.layers).
  function restack(ls, where) {
    if (!ls.length) return;
    snapshot();
    const ids = new Set(ls.map(x => x.id));
    if (where === "front" || where === "back") {
      const rest = comp.layers.filter(x => !ids.has(x.id)), moving = comp.layers.filter(x => ids.has(x.id));
      comp.layers = where === "front" ? [...rest, ...moving] : [...moving, ...rest];
    } else {
      const arr = comp.layers, up = where === "forward";
      const order = up ? [...arr.keys()].reverse() : [...arr.keys()];
      for (const i of order) {
        const j = up ? i + 1 : i - 1;
        if (ids.has(arr[i].id) && j >= 0 && j < arr.length && !ids.has(arr[j].id)) [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }
    changed();
  }
  function layerMenu(l, x, y) {
    if (!picked().includes(l)) selectLayer(l.id);
    const ls = picked(), one = ls.length === 1;
    let close = () => {};
    const item = (label, fn, extra) => h("button", Object.assign({ role: "menuitem", onclick: () => { close(); fn(); } }, extra || {}), label);
    const menu = h("div", { class: "ly-menu", role: "menu" },
      one ? item("Rename", () => { const row = document.querySelector(`#layer-list .ly[data-id="${l.id}"]`); if (row) renameLayer(l, row); }) : null,
      item("Duplicate", () => one ? duplicateLayer(l) : placeLayers(ls, 20, " copy")),
      item(ls.every(o => o.visible === false) ? "Show" : "Hide", () => { snapshot(); const show = ls.every(o => o.visible === false); ls.forEach(o => { o.visible = show; }); changed(); }),
      ls.length > 1 ? item("Group  (Ctrl+G)", () => groupLayers(ls)) : null,
      ls.some(o => o.group) ? item("Ungroup  (Ctrl+Shift+G)", () => ungroupLayers(ls)) : null,
      item("Save as part", () => saveAsPart(ls)),
      item(ls.every(o => o.locked) ? "Unlock" : "Lock", () => { snapshot(); const lock = !ls.every(o => o.locked); ls.forEach(o => { o.locked = lock; }); changed(); drawSelection(); }),
      h("hr"),
      item("Bring to front", () => restack(ls, "front")),
      item("Bring forward", () => restack(ls, "forward")),
      item("Send backward", () => restack(ls, "backward")),
      item("Send to back", () => restack(ls, "back")),
      h("hr"),
      item("Delete", () => removeLayers(ls), { class: "danger" }));
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    Object.assign(menu.style, { left: Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px", top: Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px" });
    const away = e => { if (!menu.contains(e.target)) close(); };
    const esc = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    close = () => { menu.remove(); removeEventListener("mousedown", away, true); removeEventListener("keydown", esc, true); };
    setTimeout(() => { addEventListener("mousedown", away, true); addEventListener("keydown", esc, true); });
  }
  function renderLayers() {
    const list = $("#layer-list");
    if (!comp) { list.replaceChildren(); return; }
    if (!comp.layers.length) { list.replaceChildren(h("div", { class: "empty" }, "No layers yet. Add one with the buttons above.")); return; }
    const rowOf = l => {
      const row = h("div", {
        class: "ly" + (l.id === selected || multi.has(l.id) ? " sel" : "") + (l.visible === false ? " hid" : "") + (l.locked ? " locked" : ""),
        draggable: true, "data-id": l.id,
        onclick: e => (e.ctrlKey || e.metaKey || e.shiftKey) ? pickToo(l.id) : selectLayer(l.id),
        ondblclick: e => { if (!e.target.closest(".ly-btn")) renameLayer(l, row); },
        oncontextmenu: e => { e.preventDefault(); layerMenu(l, e.clientX, e.clientY); },
        ondragstart: e => { dragLayer = l.id; e.dataTransfer.effectAllowed = "move"; row.classList.add("dragging"); },
        ondragend: () => { row.classList.remove("dragging"); list.querySelectorAll(".drop-above,.drop-below").forEach(x => x.classList.remove("drop-above", "drop-below")); },
        ondragover: e => {
          e.preventDefault();
          const below = e.clientY - row.getBoundingClientRect().top > row.offsetHeight / 2;
          row.classList.toggle("drop-below", below);
          row.classList.toggle("drop-above", !below);
        },
        ondragleave: () => row.classList.remove("drop-above", "drop-below"),
        ondrop: e => {
          e.preventDefault();
          const below = row.classList.contains("drop-below");
          row.classList.remove("drop-above", "drop-below");
          if (!dragLayer || dragLayer === l.id) return;
          snapshot();
          const moving = comp.layers.find(x => x.id === dragLayer);
          comp.layers = comp.layers.filter(x => x.id !== dragLayer);
          // The list is top-first: dropped above a row = in front of it.
          const at = comp.layers.findIndex(x => x.id === l.id);
          comp.layers.splice(below ? at : at + 1, 0, moving);
          changed();
        },
      },
        layerPreview(l),
        h("span", { class: "nm", title: `${l.name} (double-click to rename)` }, l.name),
        l.field ? h("span", { class: "fld", title: `Changed from Control as "${l.field}"` }, "field") : null,
        linked(l) ? h("span", { class: "fld live", title: "Follows live data" }, "live") : null,
        h("button", { class: "ly-btn" + (l.locked ? " on" : ""), title: l.locked ? "Unlock (it can be picked and moved on the canvas again)" : "Lock (it can't be picked or moved on the canvas)",
          "aria-label": l.locked ? "Unlock layer" : "Lock layer",
          onclick: e => { e.stopPropagation(); snapshot(); l.locked = !l.locked; changed(); drawSelection(); } }, SVG(l.locked ? ICONS.lock : ICONS.unlock)),
        h("button", { class: "ly-btn" + (l.visible === false ? " on" : ""), title: l.visible === false ? "Show" : "Hide", "aria-label": l.visible === false ? "Show layer" : "Hide layer",
          onclick: e => { e.stopPropagation(); snapshot(); l.visible = l.visible === false; changed(); } }, SVG(l.visible === false ? ICONS.eyeOff : ICONS.eye)));
      if (l.group) row.classList.add("in-group");
      return row;
    };
    const rows = [], done = new Set();
    for (const l of [...comp.layers].reverse()) {
      if (!l.group) { rows.push(rowOf(l)); continue; }
      if (done.has(l.group)) continue;
      done.add(l.group);
      const members = comp.layers.filter(o => o.group === l.group).reverse();
      const gid = l.group, open = !collapsed.has(gid), allPicked = members.every(o => multi.has(o.id) || o.id === selected && members.length === 1);
      const name = (comp.groupNames || {})[gid] || "Group", hidden = members.every(o => o.visible === false), locked = members.every(o => o.locked);
      const head = h("div", { class: "ly ly-group" + (allPicked ? " sel" : ""), "data-group": gid,
        onclick: e => { if (e.target.closest(".ly-btn,.ly-fold")) return; multi.clear(); members.forEach(o => multi.add(o.id)); selected = members[0].id; if (multi.size < 2) multi.clear(); renderLayers(); renderProps(); drawSelection(); },
        ondblclick: e => { if (e.target.closest(".ly-btn,.ly-fold")) return; const v = prompt("Name of the group", name); if (v && v.trim()) { snapshot(); comp.groupNames = Object.assign({}, comp.groupNames, { [gid]: v.trim() }); changed(); } },
        oncontextmenu: e => { e.preventDefault(); multi.clear(); members.forEach(o => multi.add(o.id)); selected = members[0].id; layerMenu(members[0], e.clientX, e.clientY); } },
        h("button", { class: "ly-fold", title: open ? "Fold" : "Unfold", "aria-label": open ? "Fold the group" : "Unfold the group", "aria-expanded": String(open),
          onclick: () => { if (open) collapsed.add(gid); else collapsed.delete(gid); renderLayers(); } }, open ? "▾" : "▸"),
        h("span", { class: "ly-pv ly-gpv" }, members[0].part ? "◆" : "▣"),
        h("span", { class: "nm", title: `${name} (double-click to rename)` }, name),
        members[0].part ? h("span", { class: "fld", title: "A copy of a part (Parts)" }, "part") : null,
        h("button", { class: "ly-btn" + (locked ? " on" : ""), title: locked ? "Unlock the group" : "Lock the group", "aria-label": locked ? "Unlock group" : "Lock group",
          onclick: e => { e.stopPropagation(); snapshot(); members.forEach(o => { o.locked = !locked; }); changed(); } }, SVG(locked ? ICONS.lock : ICONS.unlock)),
        h("button", { class: "ly-btn" + (hidden ? " on" : ""), title: hidden ? "Show the group" : "Hide the group", "aria-label": hidden ? "Show group" : "Hide group",
          onclick: e => { e.stopPropagation(); snapshot(); members.forEach(o => { o.visible = hidden; }); changed(); } }, SVG(hidden ? ICONS.eyeOff : ICONS.eye)));
      rows.push(head);
      if (open) members.forEach(o => rows.push(rowOf(o)));
    }
    list.replaceChildren(...rows);
  }
  // Does the layer follow live data (a link, a fill or a "Show when")?
  const linked = l => !!(l.meter || l.when || [l.text, l.src, l.fill].some(v => /\{\{\s*(Rocket League HUD|Global)!/i.test(v || "")));
  // Ctrl / Shift + click: one more layer (or one less).
  function pickToo(id) {
    if (!multi.size && selected) multi.add(selected);
    if (multi.has(id)) multi.delete(id); else multi.add(id);
    selected = multi.has(id) ? id : [...multi].pop() || null;
    if (multi.size < 2) multi.clear();
    renderLayers();
    renderProps();
    drawSelection();
  }
  function selectLayer(id) {
    multi.clear();
    selected = id;
    renderLayers();
    renderProps();
    drawSelection();
  }
  document.querySelectorAll("[data-add]").forEach(b => b.addEventListener("click", () => {
    const t = b.dataset.add;
    addLayer(t, null, { text: "Text", rect: "Shape", image: "Picture", video: "Video", lottie: "Animation", ticker: "Ticker", rotator: "Rotator", web: "Web page" }[t] || "Layer");
  }));

  // Special elements: layers that show what Global has (and change with it).
  const pictureOf = (src, w, h) => ({ src, w, h, x: Math.round((GFX.W - w) / 2), y: Math.round((GFX.H - h) / 2), fit: "contain" });
  const textOf = (text, extra) => Object.assign({ text, font: "Bebas Neue", weight: 400, size: 72, caps: true, w: 600, h: 90 }, extra);
  const SPECIAL = [
    ["Logos", [
      ["Left team logo", "image", pictureOf("{{Global!Left logo}}", 240, 240)],
      ["Right team logo", "image", pictureOf("{{Global!Right logo}}", 240, 240)],
      ["Tournament logo", "image", pictureOf("{{Global!Tournament logo}}", 260, 260)],
      ["Sponsors (in turn)", "image", Object.assign(pictureOf("{{Sponsors}}", 320, 120), { timer: false })]]],
    ["Teams", [
      ["Left team name", "text", textOf("{{Global!Left name}}")],
      ["Right team name", "text", textOf("{{Global!Right name}}", { align: "right" })],
      ["Left short name", "text", textOf("{{Global!Left short}}", { w: 220 })],
      ["Right short name", "text", textOf("{{Global!Right short}}", { w: 220, align: "right" })],
      ["Left score", "text", textOf("{{Global!Left score}}", { w: 140, size: 96, h: 120, align: "center" })],
      ["Right score", "text", textOf("{{Global!Right score}}", { w: 140, size: 96, h: 120, align: "center" })],
      ["Left team colour", "rect", { fill: "{{Global!Left color}}", w: 400, h: 12 }],
      ["Right team colour", "rect", { fill: "{{Global!Right color}}", w: 400, h: 12 }]]],
    ["Event", [
      ["Event", "text", textOf("{{Global!Event}}", { size: 40, h: 54 })],
      ["Stage", "text", textOf("{{Global!Stage}}", { size: 40, h: 54 })],
      ["Game number", "text", textOf("GAME {{Global!Game}}", { size: 40, h: 54 })],
      ["Ticker", "text", { text: "{{Global!Ticker}}", font: "Inter", weight: 600, size: 28, caps: true, scroll: 90, fit: "none", x: 0, y: 1030, w: 1920, h: 40 }],
      ["Background loop", "video", { src: "{{Global!BG loop}}", x: 0, y: 0, w: 1920, h: 1080, fit: "cover", blend: "screen", audio: false,
        tint: "{{Global!BG loop colour}}", brightness: "{{Global!BG loop brightness}}", speed: "{{Global!BG loop speed}}" }]]],
    ["Rocket League HUD", [
      ["Spectated player's cam", "web", { src: "{{Rocket League HUD!target_cam}}", x: 40, y: 760, w: 360, h: 240,
        when: [{ value: "{{Rocket League HUD!target_has_cam}}", op: "has" }],
        anim: { in: { type: "slide-up", dur: 400, delay: 0 }, out: { type: "slide-up", dur: 350, delay: 0 } } }],
      ["Spectated player's name", "text", textOf("{{Rocket League HUD!target}}")],
      ["Spectated player's boost", "text", textOf("{{Rocket League HUD!target_boost}}", { w: 160, size: 96, h: 120, align: "center" })],
      ["Clock", "text", textOf("{{Rocket League HUD!clock}}", { w: 220, align: "center" })]]],
    ["Tournament", [
      ["Knockout bracket (8 or 16)", "bracket", { x: 144, y: 196, w: 1566, h: 748, font: "Bebas Neue", color: "#ffffff",
        gold: "#b28a1d", dark: "#000b05", line: "#b28a1d", champ: "#ffc52a" }],
      ["Champion", "text", textOf("{{Tournament!Top champion}}")],
      ["Bracket size (8 / 16)", "text", textOf("{{Tournament!Top teams}} COMPETITOR BRACKET", { size: 48, h: 64 })]]],
  ];
  const special = $("#add-special");
  special.replaceChildren(h("option", { value: "" }, "★"),
    ...SPECIAL.map(([group, items], gi) => h("optgroup", { label: group }, ...items.map((it, i) => h("option", { value: gi + ":" + i }, it[0])))));
  special.addEventListener("change", () => {
    const v = special.value;
    special.value = "";
    if (v) addSpecial(...v.split(":").map(Number));
  });
  async function addSpecial(gi, i) {
    if (!comp) return toast("Make or pick a graphic first", true);
    const [name, type, extra] = SPECIAL[gi][1][i];
    const { layer } = await api("/api/layer/blank", { type });
    snapshot();
    Object.assign(layer, JSON.parse(JSON.stringify(extra)), { name });
    if (layer.type === "image" && !layer.src.includes("Sponsors")) layer.placeholder = "";
    comp.layers.push(layer);
    multi.clear();
    selected = layer.id;
    changed({ props: true });
  }

  // --- the left side: a rail of panels, like Canva ----------------------------------
  const page = $("#page-composer");
  let pane = "layers";
  try { pane = localStorage.getItem("gfx-pane") || "layers"; } catch (e) { /* */ }
  function showPane(name, toggle) {
    const same = name === pane && !page.classList.contains("drawer-off");
    pane = name;
    try { localStorage.setItem("gfx-pane", name); } catch (e) { /* */ }
    page.classList.toggle("drawer-off", !!toggle && same);
    document.querySelectorAll("#comp-rail button").forEach(b => b.classList.toggle("on", b.dataset.pane === name && !page.classList.contains("drawer-off")));
    document.querySelectorAll("#comp-drawer .pane").forEach(p2 => p2.classList.toggle("on", p2.dataset.pane === name));
    if (name === "media") renderMedia();
    if (name === "parts") renderParts();
    requestAnimationFrame(() => fitStage());
  }
  document.querySelectorAll("#comp-rail button").forEach(b => b.addEventListener("click", () => showPane(b.dataset.pane, true)));

  // Adding a layer: in the middle of the canvas unless it says where, picked.
  async function addLayer(type, extra, name) {
    if (!comp) { toast("Make or pick a graphic first", true); return null; }
    const { layer } = await api("/api/layer/blank", { type });
    snapshot();
    Object.assign(layer, JSON.parse(JSON.stringify(extra || {})));
    if (name) layer.name = name;
    if (!extra || extra.x == null) { layer.x = Math.round((GFX.W - layer.w) / 2); layer.y = Math.round((GFX.H - layer.h) / 2); }
    comp.layers.push(layer);
    multi.clear();
    selected = layer.id;
    changed({ props: true });
    return layer;
  }
  const TEXT_PRESETS = {
    heading: ["Heading", { text: "Heading", size: 110, weight: 800, w: 1000, h: 130 }],
    sub: ["Subheading", { text: "Subheading", size: 60, weight: 600, w: 900, h: 80 }],
    body: ["Body text", { text: "A little bit of body text", size: 36, weight: 400, w: 800, h: 110, fit: "none" }],
    label: ["Label", { text: "LABEL", size: 26, weight: 700, caps: true, tracking: 140, w: 420, h: 40 }],
  };
  document.querySelectorAll("[data-text]").forEach(b => b.addEventListener("click", () => {
    const [name, extra] = TEXT_PRESETS[b.dataset.text];
    addLayer("text", extra, name);
  }));

  // Shapes, lines and the broadcast shapes, each a tile drawn with the real renderer.
  const SHAPES = [
    ["Basic", [["Square", "rect", { w: 300, h: 300 }], ["Rounded square", "rect", { w: 300, h: 300, radius: 48 }], ["Circle", "ellipse", { w: 300, h: 300 }],
      ["Triangle", "triangle", { w: 320, h: 280 }], ["Diamond", "diamond", { w: 300, h: 300 }], ["Pentagon", "polygon", { sides: 5, w: 300, h: 290 }],
      ["Hexagon", "polygon", { sides: 6, w: 320, h: 300 }], ["Octagon", "polygon", { sides: 8, w: 300, h: 300 }], ["Star", "star", { points: 5, inner: 0.45, w: 300, h: 290 }],
      ["Burst", "star", { points: 14, inner: 0.74, w: 300, h: 300 }], ["Plus", "plus", { w: 280, h: 280 }], ["Ring", "ring", { w: 300, h: 300 }], ["Heart", "heart", { w: 300, h: 270 }]]],
    ["Lines", [["Line", "line", { w: 500, h: 40 }], ["Arrow", "arrow", { w: 500, h: 60 }], ["Double arrow", "arrow", { w: 500, h: 60, headStart: "arrow" }],
      ["Dashed line", "line", { w: 500, h: 40, dash: "dash" }], ["Dotted line", "line", { w: 500, h: 40, dash: "dot", strokeWidth: 10 }],
      ["Line with dots", "line", { w: 500, h: 40, headStart: "circle", headEnd: "circle" }], ["Block arrow", "tab", { w: 400, h: 160, slant: 90 }]]],
    ["Broadcast", [["Slanted bar", "parallelogram", { w: 640, h: 90, slant: 36 }], ["Chevron", "chevron", { w: 420, h: 120, slant: 50 }],
      ["Arrow tab", "tab", { w: 480, h: 100, slant: 50 }], ["Trapezoid", "trapezoid", { w: 600, h: 110, slant: 50 }], ["Notched bar", "notch", { w: 640, h: 110, slant: 28 }],
      ["Pill", "pill", { w: 420, h: 90 }], ["Speech bubble", "bubble", { w: 520, h: 240, radius: 24 }], ["Rounded bar", "rect", { w: 640, h: 90, radius: 14 }],
      ["Score box", "rect", { w: 160, h: 120, radii: [0, 18, 0, 18] }], ["Name plate", "parallelogram", { w: 560, h: 70, slant: 22, radii: [6, 6, 6, 6] }]]],
  ];
  const isLineShape = k => k === "line" || k === "arrow";
  function shapeTile(name, kind, extra, onAdd, look) {
    const L = Object.assign({ shape: kind, fill: "#f28c28", stroke: "#ffffff", strokeWidth: isLineShape(kind) ? 8 : 0 }, extra, look || {});
    const pv = GFX.buildShape(L, L.fillType === "image" ? "" : L.fill, { still: true });
    const svg = pv.querySelector("svg");
    if (svg) svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    return h("button", { class: "shape-tile", title: name, "aria-label": name, onclick: onAdd }, pv);
  }
  const shapeDefaults = kind => isLineShape(kind) ? { stroke: "#ffffff", strokeWidth: 8, fill: "", headEnd: kind === "arrow" ? "arrow" : "none", headStart: "none" } : {};
  function renderShapeTiles() {
    const box = $("#shape-tiles");
    box.replaceChildren(
      h("button", { class: "txt-tile pen-tile", title: "Click points on the canvas; click the first point (or press Enter) to close it, Esc to stop. Shift: straight angles",
        onclick: () => startPen() }, h("b", {}, "✎ Pen: draw your own shape"), h("div", { class: "muted small" }, "Click points on the canvas, click the first one to close")),
      ...SHAPES.flatMap(([group, list]) => [h("h4", {}, group),
        h("div", { class: "shape-grid" }, list.map(([name, kind, extra]) =>
          shapeTile(name, kind, extra, () => addLayer("shape", Object.assign({ shape: kind }, shapeDefaults(kind), extra), name))))]));
  }
  const FRAMES = [["Rounded", "rect", { radius: 40, w: 420, h: 420 }], ["Circle", "ellipse", { w: 420, h: 420 }], ["Hexagon", "polygon", { sides: 6, w: 440, h: 420 }],
    ["Diamond", "diamond", { w: 420, h: 420 }], ["Slanted", "parallelogram", { w: 580, h: 340, slant: 60 }], ["Notched", "notch", { w: 540, h: 380, slant: 54 }],
    ["Star", "star", { w: 420, h: 400 }], ["Pill", "pill", { w: 580, h: 240 }], ["Heart", "heart", { w: 420, h: 380 }], ["Triangle", "triangle", { w: 440, h: 400 }],
    ["Chevron", "chevron", { w: 520, h: 300, slant: 80 }], ["Wide", "rect", { w: 640, h: 360, radius: 16 }]];
  function renderFrameTiles() {
    $("#frame-tiles").replaceChildren(...FRAMES.map(([name, kind, extra]) => shapeTile(name + " frame", kind, extra,
      () => addLayer("shape", Object.assign({ shape: kind, fillType: "image", fit: "cover", src: "", stroke: "#ffffff", strokeWidth: 0 }, extra), name + " frame"),
      { fill: "#3b4148", stroke: "#8e8e93", strokeWidth: 6, dash: "dash" })));
  }
  // Media: the kinds, and every picture already in the workspace as a tile.
  let mediaSig = "";
  function renderMedia() {
    const pics = App.assets.filter(a => a.kind === "image");
    const sig = pics.map(a => a.path).join("|");
    if (sig === mediaSig) return;
    mediaSig = sig;
    $("#media-grid").replaceChildren(...(pics.length ? pics.map(a => h("button", { title: a.path.replace(/^assets\//, ""), onclick: async () => {
      const l = await addLayer("image", { src: a.path, w: 480, h: 480, fit: "contain" }, a.path.replace(/^.*\//, "").replace(/\.[^.]+$/, ""));
      if (l) naturalSize(l);
    } }, h("img", { src: encodeURI(a.path), alt: "", loading: "lazy", draggable: false }), h("span", {}, a.path.replace(/^.*\//, ""))))
      : [h("p", { class: "muted small" }, "No pictures yet: add some in Assets, or with Picture above.")]));
  }
  // Live: the special elements (teams, event, HUD data, tournament) as tiles.
  function renderLiveTiles() {
    $("#live-tiles").replaceChildren(...SPECIAL.flatMap(([group, items], gi) => [h("h4", {}, group),
      h("div", { class: "tile-list" }, items.map((it, i) => h("button", { onclick: () => addSpecial(gi, i) }, it[0])))]));
    $("#live-text-tiles").replaceChildren(...SPECIAL.flatMap(([, items], gi) => items.map((it, i) => it[1] === "text"
      ? h("button", { onclick: () => addSpecial(gi, i) }, it[0]) : null)).filter(Boolean));
  }

  // --- groups (Ctrl+G): picked together, moved, hidden and locked as one ---------------
  const groupOf = l => l && l.group ? comp.layers.filter(o => o.group === l.group) : [];
  function groupLayers(ls) {
    if (ls.length < 2) return toast("Pick two or more layers to group (Shift or Ctrl + click)", true);
    snapshot();
    const gid = "g" + Math.random().toString(16).slice(2, 8);
    const ids = new Set(ls.map(o => o.id));
    // (kept together in the stacking order, where the top one was)
    const top = Math.max(...ls.map(o => comp.layers.indexOf(o)));
    const members = comp.layers.filter(o => ids.has(o.id));
    const rest = comp.layers.filter(o => !ids.has(o.id));
    const at = rest.filter(o => comp.layers.indexOf(o) < top).length;
    rest.splice(at, 0, ...members);
    comp.layers = rest;
    members.forEach(o => { o.group = gid; });
    comp.groupNames = Object.assign({}, comp.groupNames, { [gid]: "Group" });
    multi.clear(); members.forEach(o => multi.add(o.id));
    selected = members[members.length - 1].id;
    changed({ props: true });
  }
  function ungroupLayers(ls) {
    const gids = new Set(ls.map(o => o.group).filter(Boolean));
    if (!gids.size) return;
    snapshot();
    comp.layers.forEach(o => { if (gids.has(o.group)) delete o.group; });
    if (comp.groupNames) gids.forEach(g => delete comp.groupNames[g]);
    changed({ props: true });
  }
  const collapsed = new Set();

  // --- pen tool: click points, close on the first one --------------------------------
  let pen = null;
  function startPen() {
    if (!comp) return toast("Make or pick a graphic first", true);
    pen = { pts: [] };
    canvas.classList.add("pen-on");
    toast("Pen: click points on the canvas. Click the first point or press Enter to finish, Esc to stop.");
    drawPen();
  }
  function stopPen(make) {
    const p2 = pen;
    pen = null;
    canvas.classList.remove("pen-on");
    const ov = selLayer.querySelector(".pen-svg");
    if (ov) ov.remove();
    if (!make || !p2 || p2.pts.length < 3) return;
    const xs = p2.pts.map(q => q[0]), ys = p2.pts.map(q => q[1]);
    const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(1, Math.max(...xs) - x), hh = Math.max(1, Math.max(...ys) - y);
    addLayer("shape", { shape: "path", x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh), closed: p2.closed !== false,
      pts: p2.pts.map(q => [+((q[0] - x) / w).toFixed(4), +((q[1] - y) / hh).toFixed(4)]) }, "Drawn shape");
  }
  function drawPen(mouse) {
    let ov = selLayer.querySelector(".pen-svg");
    if (!pen) { if (ov) ov.remove(); return; }
    if (!ov) { ov = document.createElementNS("http://www.w3.org/2000/svg", "svg"); ov.setAttribute("class", "pen-svg"); selLayer.appendChild(ov); }
    const pts = pen.pts.map(q => toScreen(q[0], q[1]));
    if (mouse) pts.push(toScreen(mouse[0], mouse[1]));
    ov.innerHTML = (pts.length > 1 ? `<polyline points="${pts.map(q => q.join(",")).join(" ")}" fill="rgba(242,140,40,.12)" stroke="#f28c28" stroke-width="2"/>` : "")
      + pen.pts.map((q, i) => { const [sx, sy] = toScreen(q[0], q[1]); return `<circle cx="${sx}" cy="${sy}" r="${i ? 4 : 6}" fill="${i ? "#fff" : "#f28c28"}" stroke="#f28c28" stroke-width="2"/>`; }).join("");
  }
  function penPoint(e) {
    const r = canvas.getBoundingClientRect();
    let px = (e.clientX - r.left - offX) / scale, py = (e.clientY - r.top - offY) / scale;
    const last = pen.pts[pen.pts.length - 1];
    if (e.shiftKey && last) {   // straight: snapped to 45°
      const a = Math.round(Math.atan2(py - last[1], px - last[0]) / (Math.PI / 4)) * Math.PI / 4, d = Math.hypot(px - last[0], py - last[1]);
      px = last[0] + d * Math.cos(a); py = last[1] + d * Math.sin(a);
    }
    return [Math.round(px), Math.round(py)];
  }
  canvas.addEventListener("mousedown", e => {
    if (!pen || e.button !== 0) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const q = penPoint(e), first = pen.pts[0];
    if (first && pen.pts.length > 2 && Math.hypot((q[0] - first[0]) * scale, (q[1] - first[1]) * scale) < 10) return stopPen(true);
    pen.pts.push(q);
    drawPen();
  }, true);
  canvas.addEventListener("mousemove", e => { if (pen) drawPen(penPoint(e)); });
  addEventListener("keydown", e => {
    if (!pen) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); stopPen(false); }
    else if (e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); stopPen(true); }
    else if (e.key === "Backspace") { e.preventDefault(); e.stopImmediatePropagation(); pen.pts.pop(); drawPen(); }
  }, true);

  // --- combining shapes: union, subtract, intersect --------------------------------------
  const combinable = l => l.type === "shape" && !isLineShape(l.shape);
  function combine(ls, op) {
    ls = ls.filter(combinable);
    if (ls.length < 2) return toast("Pick two or more shapes to combine", true);
    snapshot();
    const x0 = Math.min(...ls.map(o => o.x)), y0 = Math.min(...ls.map(o => o.y));
    const x1 = Math.max(...ls.map(o => o.x + o.w)), y1 = Math.max(...ls.map(o => o.y + o.h));
    const base = ls[0];   // (the bottom one: its fill, border and effects)
    const KEEP = ["shape", "radius", "radii", "sides", "points", "inner", "slant", "thick", "pts", "smooth", "closed", "parts", "op"];
    const parts = ls.map(o => Object.assign(Object.fromEntries(KEEP.filter(k => o[k] != null).map(k => [k, JSON.parse(JSON.stringify(o[k]))])),
      { x: o.x - x0, y: o.y - y0, w: o.w, h: o.h }));
    const made = Object.assign(JSON.parse(JSON.stringify(base)), { id: newLayerId(), name: { union: "Joined shape", subtract: "Cut-out shape", intersect: "Overlap shape" }[op],
      shape: "combo", op, parts, x: x0, y: y0, w: x1 - x0, h: y1 - y0, rotation: 0 });
    const at = Math.max(...ls.map(o => comp.layers.indexOf(o)));
    const gone = new Set(ls.map(o => o.id));
    const before = comp.layers.slice(0, at + 1).filter(o => !gone.has(o.id)), after = comp.layers.slice(at + 1);
    comp.layers = [...before, made, ...after];
    multi.clear();
    selected = made.id;
    changed({ props: true });
  }
  function splitCombo(l) {
    snapshot();
    const made = (l.parts || []).map((pt, i) => Object.assign(JSON.parse(JSON.stringify(l)), pt, { id: newLayerId(), name: `${l.name} ${i + 1}`,
      x: l.x + (pt.x || 0), y: l.y + (pt.y || 0), parts: undefined, op: undefined }));
    made.forEach(o => { delete o.parts; delete o.op; });
    comp.layers.splice(comp.layers.indexOf(l), 1, ...made);
    multi.clear(); made.forEach(o => multi.add(o.id));
    selected = made.length ? made[made.length - 1].id : null;
    if (multi.size < 2) multi.clear();
    changed({ props: true });
  }

  // --- parts: reusable pieces (a name plate made once, used everywhere) -------------------
  // project.parts = [{id, name, w, h, layers (positions from the part's top left)}].
  // A copy's layers carry part (its id) and group; "Update the part" changes every copy.
  const partsList = () => App.state.project.parts || [];
  function partFrom(ls, name, id) {
    const x0 = Math.min(...ls.map(o => o.x)), y0 = Math.min(...ls.map(o => o.y));
    const x1 = Math.max(...ls.map(o => o.x + o.w)), y1 = Math.max(...ls.map(o => o.y + o.h));
    const layers = ls.map(o => { const c = JSON.parse(JSON.stringify(o)); c.x -= x0; c.y -= y0; delete c.group; delete c.part; delete c.locked; return c; });
    return { id: id || "p" + Math.random().toString(16).slice(2, 10), name, w: x1 - x0, h: y1 - y0, layers };
  }
  async function saveAsPart(ls) {
    if (!ls.length) return;
    const name = prompt("Name of the part (it appears under Parts, ready to use in any graphic)", (comp.groupNames || {})[ls[0].group] || ls[0].name);
    if (!name || !name.trim()) return;
    const part = partFrom(ls, name.trim());
    await api("/api/parts", { parts: [...partsList(), part] });
    // (these layers become the first copy of it)
    snapshot();
    const gid = ls[0].group && ls.every(o => o.group === ls[0].group) ? ls[0].group : "g" + Math.random().toString(16).slice(2, 8);
    ls.forEach(o => { o.part = part.id; o.group = gid; });
    comp.groupNames = Object.assign({}, comp.groupNames, { [gid]: part.name });
    changed({ props: true });
    toast(`Saved the part "${part.name}"`);
  }
  async function usePart(part) {
    if (!comp) return toast("Make or pick a graphic first", true);
    snapshot();
    const gid = "g" + Math.random().toString(16).slice(2, 8), x0 = Math.round((GFX.W - part.w) / 2), y0 = Math.round((GFX.H - part.h) / 2);
    const made = part.layers.map(src => { const l = JSON.parse(JSON.stringify(src)); l.id = newLayerId(); l.x += x0; l.y += y0; l.group = gid; l.part = part.id; if (l.field) l.field = uniqueField(l.field); return l; });
    comp.layers.push(...made);
    comp.groupNames = Object.assign({}, comp.groupNames, { [gid]: part.name });
    multi.clear(); made.forEach(o => multi.add(o.id));
    selected = made[made.length - 1].id;
    if (multi.size < 2) multi.clear();
    changed({ props: true });
  }
  async function updatePart(ls) {
    const pid = ls[0].part, old = partsList().find(p2 => p2.id === pid);
    if (!old) return toast("That part isn't saved any more", true);
    await window.saveForUpdate();   // (this graphic first, so the engine changes the latest copy)
    const part = partFrom(ls, old.name, pid);
    const r = await api("/api/parts/update", { part, keep: { comp: compId, group: ls[0].group } });
    toast(`Updated "${part.name}" in ${r.copies} other place${r.copies === 1 ? "" : "s"}`);
  }
  function renderParts() {
    const box = $("#parts-pane"), list = partsList();
    box.replaceChildren(
      h("p", { class: "muted small" }, "Make a name plate, a score box or a sponsor strip once, then use it in any graphic. Pick its layers and press Save as part (on the right). Change one copy and use Update the part: every copy changes."),
      list.length ? h("div", { class: "media-grid" }, list.map(part => h("button", { title: `Add "${part.name}"`, onclick: () => usePart(part),
        oncontextmenu: e => { e.preventDefault(); if (confirm(`Delete the part "${part.name}"? Copies already in graphics stay (as plain layers).`)) api("/api/parts", { parts: partsList().filter(p2 => p2.id !== part.id) }).then(renderParts); } },
        thumb({ id: "part-" + part.id, name: part.name, layers: part.layers.map(l => Object.assign({}, l, { x: l.x + (GFX.W - part.w) / 2, y: l.y + (GFX.H - part.h) / 2 })) }, {}, 132),
        h("span", {}, part.name))))
        : h("p", { class: "muted small" }, "No parts yet."));
  }

  // --- shape properties --------------------------------------------------------------------
  const SHAPE_NAMES = [["Basic", [["rect", "Rectangle"], ["pill", "Pill"], ["ellipse", "Ellipse / circle"], ["triangle", "Triangle"], ["diamond", "Diamond"], ["polygon", "Polygon"],
    ["star", "Star"], ["plus", "Plus"], ["ring", "Ring"], ["heart", "Heart"]]],
    ["Broadcast", [["parallelogram", "Slanted bar"], ["chevron", "Chevron"], ["tab", "Arrow tab"], ["trapezoid", "Trapezoid"], ["notch", "Notched bar"], ["bubble", "Speech bubble"]]],
    ["Lines", [["line", "Line"], ["arrow", "Arrow"]]], ["Other", [["path", "Drawn shape"], ["combo", "Combined shape"]]]];
  function seg(options, cur, pick2) {
    return h("div", { class: "seg", role: "group" }, options.map(([v, t]) => h("button", { type: "button", class: v === cur ? "on" : "", "aria-pressed": String(v === cur), onclick: () => pick2(v) }, t)));
  }
  const setK = (obj, key, v, redrawProps) => { snapshot(); obj[key] = v; changed(redrawProps ? { props: true } : { keepList: true }); };
  function colorField(label, get, put) {
    const v = get() || "";
    return lab(label, h("div", { class: "row-gap" },
      h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(v) ? v : "#ffffff", oninput: e => { put(e.target.value, true); e.target.nextSibling.value = e.target.value; }, onchange: () => { snapshot(); changed({ keepList: true }); } }),
      h("input", { value: v, placeholder: "#ffffff or rgba()", onchange: e => { snapshot(); put(e.target.value); changed({ keepList: true }); } })));
  }
  // Colour chips: the teams' colours and a few house ones, one click.
  function chips(onPick) {
    const g = App.state.global || {};
    const list = [["{{Global!Left color}}", (g.left || {}).color || "#888", "Left team colour"], ["{{Global!Right color}}", (g.right || {}).color || "#888", "Right team colour"],
      ["#ffffff", "#ffffff", "White"], ["#000000", "#000000", "Black"], ["#f28c28", "#f28c28", "Orange"], ["#0b6b3a", "#0b6b3a", "Green"], ["#f5c518", "#f5c518", "Gold"], ["rgba(0,0,0,.55)", "rgba(0,0,0,.55)", "See-through black"]];
    return h("div", { class: "chips" }, list.map(([v, show, t]) => h("button", { type: "button", class: "chip-c", title: t, "aria-label": t, style: { background: show }, onclick: () => onPick(v) })));
  }
  function shapeProps(l) {
    const out = [];
    const line = isLineShape(l.shape);
    const num2 = (key, label, opt) => lab(label, bind(l, key, "number", opt));
    const kids = [lab("Shape", h("select", { onchange: e => { snapshot(); l.shape = e.target.value; if (isLineShape(l.shape) && !l.strokeWidth) { l.strokeWidth = 8; l.stroke = l.stroke || "#ffffff"; } changed({ props: true }); } },
      SHAPE_NAMES.map(([g, list]) => h("optgroup", { label: g }, list.map(([v, t]) => h("option", { value: v, selected: (l.shape || "rect") === v }, t))))))];
    const k = l.shape || "rect";
    if (["rect", "parallelogram", "trapezoid"].includes(k)) {
      const each = Array.isArray(l.radii);
      kids.push(h("div", { class: "fx-row" }, h("span", { class: "muted small", style: { flex: 1 } }, "Corners"),
        seg([["all", "All the same"], ["each", "Each corner"]], each ? "each" : "all", v => { snapshot(); if (v === "each") l.radii = [+l.radius || 0, +l.radius || 0, +l.radius || 0, +l.radius || 0]; else { l.radius = l.radii ? l.radii[0] : 0; delete l.radii; } changed({ props: true }); })));
      kids.push(each ? h("div", { class: "grid4" }, ["Top left", "Top right", "Bottom right", "Bottom left"].map((t, i) => lab(t, h("input", { type: "number", min: 0, value: l.radii[i] ?? 0,
        onchange: e => { snapshot(); l.radii[i] = Math.max(0, +e.target.value || 0); changed({ keepList: true }); } }))))
        : num2("radius", "Corner radius", { min: 0 }));
    } else if (!line && !["ellipse", "ring", "heart", "pill", "path", "combo"].includes(k)) kids.push(num2("radius", "Round the corners", { min: 0 }));
    if (k === "polygon") kids.push(num2("sides", "Sides", { min: 3, max: 64 }));
    if (k === "star") kids.push(h("div", { class: "grid2" }, num2("points", "Points", { min: 3, max: 64 }), num2("inner", "Inner size (0-1)", { min: 0.05, max: 0.95, step: 0.05 })));
    if (k === "plus" || k === "ring") kids.push(num2("thick", "Thickness (0-1)", { min: 0.02, max: 0.98, step: 0.02 }));
    if (["parallelogram", "trapezoid", "chevron", "tab", "notch"].includes(k)) kids.push(num2("slant", k === "notch" ? "Corner cut (px)" : "Slant (px)", { min: 0 }));
    if (k === "path") kids.push(h("div", { class: "row-gap" }, bind(l, "smooth", "check", { label: "Smooth curves" }), h("label", { class: "toggle" },
      h("input", { type: "checkbox", checked: l.closed !== false, onchange: e => setK(l, "closed", e.target.checked) }), "Closed")));
    if (k === "combo") kids.push(lab("Combine", seg([["union", "Join"], ["subtract", "Cut out"], ["intersect", "Overlap"]], l.op || "union", v => setK(l, "op", v, true))),
      h("button", { class: "small", onclick: () => splitCombo(l) }, "Split apart"));
    if (line) {
      const ends = [["none", "None"], ["arrow", "Arrow"], ["triangle", "Solid arrow"], ["circle", "Dot"], ["bar", "Bar"]];
      kids.push(h("div", { class: "grid2" }, num2("strokeWidth", "Thickness", { min: 1 }), colorField("Colour", () => l.stroke, (v) => { l.stroke = v; redraw(); })),
        chips(v => setK(l, "stroke", v, true)),
        h("div", { class: "grid2" }, lab("Start", bind(l, "headStart", "select", { options: ends })), lab("End", bind(l, "headEnd", "select", { options: ends }))),
        lab("Style", seg([["solid", "Solid"], ["dash", "Dashed"], ["dot", "Dotted"]], l.dash || "solid", v => setK(l, "dash", v, true))),
        h("p", { class: "muted small" }, "Rotate the layer to point it any way (Rotate ° above)."));
      out.push(h("div", { class: "sect" }, h("h3", {}, "Line"), ...kids));
      return out;
    }
    out.push(h("div", { class: "sect" }, h("h3", {}, "Shape"), ...kids));

    // Fill: a colour, a gradient or a picture (a frame).
    const ft = l.fillType || "solid";
    const fill = [seg([["solid", "Colour"], ["linear", "Gradient"], ["radial", "Radial"], ["image", "Picture"]], ft, v => {
      snapshot(); l.fillType = v;
      if ((v === "linear" || v === "radial") && !(l.grad && l.grad.stops)) l.grad = { angle: 90, stops: [{ at: 0, color: /^#/.test(l.fill || "") ? l.fill : "#f28c28" }, { at: 100, color: "#000000" }] };
      if (v === "image" && !l.fit) l.fit = "cover";
      changed({ props: true });
    })];
    if (ft === "solid") fill.push(bind(l, "fill", "color", { label: "Colour" }), chips(v => setK(l, "fill", v, true)));
    else if (ft === "image") fill.push(lab("Picture", assetSelect("image", l.src, v => { snapshot(); l.src = v; changed({ props: true }); })),
      lab("Fit", seg([["cover", "Fill"], ["contain", "Fit"], ["fill", "Stretch"]], l.fit || "cover", v => setK(l, "fit", v, true))));
    else {
      const g = l.grad || (l.grad = { angle: 90, stops: [] });
      if (ft === "linear") fill.push(lab("Angle °", h("input", { type: "number", step: 15, value: g.angle ?? 90, onchange: e => { snapshot(); g.angle = +e.target.value || 0; changed({ keepList: true }); } })));
      g.stops.forEach((st, i) => fill.push(h("div", { class: "stop-row" },
        h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(st.color) ? st.color : "#ffffff", "aria-label": `Stop ${i + 1} colour`, oninput: e => { st.color = e.target.value; redraw(); }, onchange: () => { snapshot(); changed({ keepList: true }); } }),
        h("input", { value: st.color, "aria-label": `Stop ${i + 1} colour code`, onchange: e => { snapshot(); st.color = e.target.value; changed({ props: true }); } }),
        h("input", { type: "number", min: 0, max: 100, value: st.at, title: "Where (0-100 %)", "aria-label": `Stop ${i + 1} position`, onchange: e => { snapshot(); st.at = Math.max(0, Math.min(100, +e.target.value || 0)); changed({ keepList: true }); } }),
        h("button", { class: "small danger", title: "Remove this colour", disabled: g.stops.length <= 2, onclick: () => { snapshot(); g.stops.splice(i, 1); changed({ props: true }); } }, "×"))));
      fill.push(h("button", { class: "small", onclick: () => { snapshot(); g.stops.push({ at: 50, color: "#ffffff" }); g.stops.sort((a, b) => a.at - b.at); changed({ props: true }); } }, "+ Colour"));
    }
    out.push(h("div", { class: "sect" }, h("h3", {}, "Fill"), ...fill));
    out.push(h("div", { class: "sect" }, h("h3", {}, "Border"),
      h("div", { class: "grid2" }, num2("strokeWidth", "Width", { min: 0 }), colorField("Colour", () => l.stroke, v => { l.stroke = v; redraw(); })),
      +l.strokeWidth > 0 ? h("div", {},
        lab("Position", seg([["inside", "Inside"], ["center", "Centre"], ["outside", "Outside"]], l.strokeAlign || "center", v => setK(l, "strokeAlign", v, true))),
        lab("Style", seg([["solid", "Solid"], ["dash", "Dashed"], ["dot", "Dotted"]], l.dash || "solid", v => setK(l, "dash", v, true)))) : null));
    return out;
  }
  // Effects, for every kind of layer: shadow, glow, inner shadow (shapes), blur, blur behind.
  function fxSection(l) {
    const fx = l.fx || {};
    const put = (key, v) => { snapshot(); l.fx = Object.assign({}, l.fx, { [key]: v }); changed({ props: true }); };
    const sub = (key, defaults, fields) => {
      const cur = fx[key] || {}, on = !!cur.on;
      const upd = (k2, v) => { snapshot(); l.fx = Object.assign({}, l.fx, { [key]: Object.assign({}, defaults, cur, { [k2]: v }) }); changed({ keepList: true }); };
      return h("div", {},
        h("div", { class: "fx-row" }, h("label", { class: "toggle" }, h("input", { type: "checkbox", checked: on, onchange: e => put(key, Object.assign({}, defaults, cur, { on: e.target.checked })) }), fields.title)),
        on ? h("div", { class: "grid4" }, ...fields.nums.map(([k2, t, o]) => lab(t, h("input", Object.assign({ type: "number", value: cur[k2] ?? defaults[k2], onchange: e => upd(k2, +e.target.value) }, o)))),
          lab("Colour", h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(cur.color || defaults.color) ? (cur.color || defaults.color) : "#000000", onchange: e => upd("color", e.target.value) }))) : null);
    };
    const shapeish = l.type === "shape" || l.type === "rect";
    return h("div", { class: "sect" }, h("h3", {}, "Effects"),
      sub("shadow", { x: 0, y: 8, blur: 16, color: "#000000" }, { title: "Drop shadow", nums: [["x", "X"], ["y", "Y"], ["blur", "Blur", { min: 0 }]] }),
      sub("glow", { blur: 16, color: "#f28c28" }, { title: "Glow", nums: [["blur", "Size", { min: 0 }]] }),
      l.type === "shape" ? sub("inner", { x: 0, y: 4, blur: 8, color: "#000000" }, { title: "Inner shadow", nums: [["x", "X"], ["y", "Y"], ["blur", "Blur", { min: 0 }]] }) : null,
      h("div", { class: "grid2" },
        lab("Blur", h("input", { type: "number", min: 0, value: fx.blur || 0, onchange: e => put("blur", Math.max(0, +e.target.value || 0)) })),
        shapeish ? lab("Blur behind (glass)", h("input", { type: "number", min: 0, value: fx.backdrop || 0, title: "Blurs what's behind it, like frosted glass (use a see-through fill)", onchange: e => put("backdrop", Math.max(0, +e.target.value || 0)) })) : null));
  }
  // Extra sections for several picked layers: group, combine, parts.
  function multiExtras(layers) {
    const grouped = layers.some(o => o.group);
    const shapes = layers.filter(combinable);
    const isPart = layers[0].part && layers.every(o => o.part === layers[0].part && o.group === layers[0].group);
    return [h("div", { class: "sect" }, h("h3", {}, "Group"),
      h("div", { class: "row-gap" },
        h("button", { class: "small", title: "Ctrl+G", onclick: () => groupLayers(layers) }, "Group"),
        grouped ? h("button", { class: "small", title: "Ctrl+Shift+G", onclick: () => ungroupLayers(layers) }, "Ungroup") : null,
        h("button", { class: "small", onclick: () => saveAsPart(layers) }, "Save as part"),
        isPart ? h("button", { class: "small primary", title: "Every copy of this part, in every graphic, changes to look like this one", onclick: () => updatePart(layers) }, "Update the part") : null,
        isPart ? h("button", { class: "small", title: "Stop following the part: these layers stay as they are", onclick: () => { snapshot(); layers.forEach(o => delete o.part); changed({ props: true }); } }, "Detach") : null)),
    shapes.length > 1 ? h("div", { class: "sect" }, h("h3", {}, "Combine shapes"),
      h("p", { class: "muted small" }, "The bottom shape's fill and border are kept."),
      h("div", { class: "grid3" },
        h("button", { class: "small", onclick: () => combine(layers, "union") }, "Join"),
        h("button", { class: "small", onclick: () => combine(layers, "subtract") }, "Cut out"),
        h("button", { class: "small", onclick: () => combine(layers, "intersect") }, "Overlap"))) : null].filter(Boolean);
  }

  // --- the canvas --------------------------------------------------------------
  // Zoom: Ctrl + scroll wheel zooms toward the mouse, the scroll wheel pans
  // while zoomed in (Shift: sideways), middle mouse or Space + drag pans too,
  // Ctrl+0 or the zoom button fits the whole graphic again. zoom is relative
  // to "fit"; offX/offY are where the graphic's top left sits on screen.
  let zoom = 1, spaceDown = false;
  const ZOOM_MIN = 0.25, ZOOM_MAX = 16;
  const fitScale = r => Math.max(0.01, Math.min((r.width - 48) / GFX.W, (r.height - 48) / GFX.H));
  function applyView() {
    const r = canvas.getBoundingClientRect();
    // Keep at least 80 px of the graphic on screen.
    const w = GFX.W * scale, hh = GFX.H * scale, keep = 80;
    offX = Math.min(r.width - keep, Math.max(keep - w, offX));
    offY = Math.min(r.height - keep, Math.max(keep - hh, offY));
    stage.style.transform = `translate(${offX}px, ${offY}px) scale(${scale})`;
    const zb = $("#canvas-zoom");
    if (zb) zb.textContent = zoom === 1 ? "Fit" : Math.round(scale * 100) + "%";   // % of real size
    canvas.classList.toggle("zoomed", zoom !== 1);
    drawSelection();
  }
  function fitStage() {
    const r = canvas.getBoundingClientRect();
    zoom = 1;
    scale = fitScale(r);
    offX = (r.width - GFX.W * scale) / 2;
    offY = (r.height - GFX.H * scale) / 2;
    applyView();
  }
  function zoomTo(z, cx, cy) {
    const r = canvas.getBoundingClientRect();
    if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    if (Math.abs(zoom - 1) < 0.02) return fitStage();
    // The point of the graphic under (cx, cy) stays under it.
    const gx = (cx - offX) / scale, gy = (cy - offY) / scale;
    scale = fitScale(r) * zoom;
    offX = cx - gx * scale; offY = cy - gy * scale;
    applyView();
  }
  let lastSize = null;
  new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect();
    if (zoom === 1 || !lastSize) fitStage();
    else {
      // Keep the middle of the view where it was and the same zoom.
      offX += (r.width - lastSize[0]) / 2; offY += (r.height - lastSize[1]) / 2;
      scale = fitScale(r) * zoom;
      applyView();
    }
    lastSize = [r.width, r.height];
  }).observe(canvas);
  canvas.addEventListener("wheel", e => {
    if (!comp) return;
    const r = canvas.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      // Pixel or line deltas; trackpad pinch also arrives as Ctrl + wheel.
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      zoomTo(zoom * Math.exp(-Math.max(-300, Math.min(300, dy)) * 0.0015), e.clientX - r.left, e.clientY - r.top);
    } else if (zoom > 1) {
      e.preventDefault();
      const k = e.deltaMode === 1 ? 33 : 1;
      if (e.shiftKey && !e.deltaX) offX -= e.deltaY * k;
      else { offX -= e.deltaX * k; offY -= e.deltaY * k; }
      applyView();
    }
  }, { passive: false });
  // Middle mouse, or Space held, drags the view.
  canvas.addEventListener("mousedown", e => {
    if (!(e.button === 1 || (e.button === 0 && spaceDown))) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const sx = e.clientX - offX, sy = e.clientY - offY;
    canvas.classList.add("panning");
    const move = ev => { offX = ev.clientX - sx; offY = ev.clientY - sy; applyView(); };
    const up = () => { removeEventListener("mousemove", move); removeEventListener("mouseup", up); canvas.classList.remove("panning"); };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
  }, true);
  canvas.addEventListener("auxclick", e => { if (e.button === 1) e.preventDefault(); });
  addEventListener("keydown", e => {
    if (App.tab !== "composer" || (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === " " && !mod) { e.preventDefault(); if (!spaceDown) { spaceDown = true; canvas.classList.add("can-pan"); } return; }
    if (!mod) return;
    if (e.key === "0") { e.preventDefault(); fitStage(); }
    else if (e.key === "1") { e.preventDefault(); zoomTo(1 / fitScale(canvas.getBoundingClientRect())); }   // 100%: real pixels
    else if (e.key === "=" || e.key === "+") { e.preventDefault(); zoomTo(zoom * 1.25); }
    else if (e.key === "-") { e.preventDefault(); zoomTo(zoom / 1.25); }
  });
  addEventListener("keyup", e => { if (e.key === " ") { spaceDown = false; canvas.classList.remove("can-pan"); } });
  addEventListener("blur", () => { spaceDown = false; canvas.classList.remove("can-pan"); });
  $("#canvas-zoom").addEventListener("click", fitStage);
  $("#canvas-bg").addEventListener("change", e => { canvas.className = "canvas " + e.target.value; try { localStorage.setItem("gfx-canvas-bg", e.target.value); } catch (err) { /* */ } });
  try { const bg = localStorage.getItem("gfx-canvas-bg"); if (bg) { $("#canvas-bg").value = bg; } } catch (e) { /* */ }
  canvas.className = "canvas " + $("#canvas-bg").value;

  function draw() {
    if (root) { GFX.destroy(root); root.remove(); root = null; }
    $("#canvas-name").textContent = comp ? comp.name : "";
    if (!comp) return;
    root = GFX.buildComp(comp, {}, { showHidden: true, muted: true });
    stage.appendChild(root);
    drawSelection();
  }
  function redraw() {
    if (!comp) return;
    if (!root) return draw();
    GFX.updateComp(root, comp, {});
    $("#canvas-name").textContent = comp.name;
    drawSelection();
  }
  const layerById = id => comp && comp.layers.find(l => l.id === id);
  const toScreen = (x, y) => [offX + x * scale, offY + y * scale];

  const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  function drawSelection(guides) {
    selLayer.replaceChildren();
    for (const id of multi) {
      const o = layerById(id);
      if (!o || id === selected) continue;
      const [ox, oy] = toScreen(o.x, o.y);
      selLayer.appendChild(h("div", { class: "sel-box also", style: { left: ox + "px", top: oy + "px", width: o.w * scale + "px", height: o.h * scale + "px",
        transform: o.rotation ? `rotate(${o.rotation}deg)` : "" } }));
    }
    const l = layerById(selected);
    if (!l) { $("#canvas-pos").textContent = ""; return; }
    const [x, y] = toScreen(l.x, l.y);
    const w = l.w * scale, hgt = l.h * scale;
    const box = h("div", { class: "sel-box", style: { left: x + "px", top: y + "px", width: w + "px", height: hgt + "px",
      transform: l.rotation ? `rotate(${l.rotation}deg)` : "" } });
    for (const hd of HANDLES) {
      const hx = hd.includes("w") ? 0 : hd.includes("e") ? 100 : 50;
      const hy = hd.includes("n") ? 0 : hd.includes("s") ? 100 : 50;
      box.appendChild(h("div", { class: "handle", "data-h": hd, style: { left: hx + "%", top: hy + "%", cursor: hd + "-resize" } }));
    }
    selLayer.appendChild(box);
    for (const g of guides || []) {
      if (g.x != null) { const [gx] = toScreen(g.x, 0); selLayer.appendChild(h("div", { class: "guide", style: { left: gx + "px", top: 0, bottom: 0, width: "1px" } })); }
      if (g.y != null) { const [, gy] = toScreen(0, g.y); selLayer.appendChild(h("div", { class: "guide", style: { top: gy + "px", left: 0, right: 0, height: "1px" } })); }
    }
    $("#canvas-pos").textContent = `${Math.round(l.x)}, ${Math.round(l.y)} · ${Math.round(l.w)}×${Math.round(l.h)}`;
  }

  // Which layer is at a point (top first, visible ones only).
  function hit(px, py) {
    for (const l of [...comp.layers].reverse()) {
      if (l.visible === false || l.locked) continue;
      if (px >= l.x && px <= l.x + l.w && py >= l.y && py <= l.y + l.h) return l;
    }
    return null;
  }
  // Snapping to the canvas' edges and middle and other layers' edges and middles.
  function snap(l, moving, resizing) {
    const tol = 6 / scale;
    const xs = [0, GFX.W / 2, GFX.W], ys = [0, GFX.H / 2, GFX.H];
    for (const o of comp.layers) {
      if (o.id === l.id || o.visible === false || (moving && multi.has(o.id))) continue;   // never snap to layers moving along
      xs.push(o.x, o.x + o.w / 2, o.x + o.w);
      ys.push(o.y, o.y + o.h / 2, o.y + o.h);
    }
    const guides = [];
    const best = (vals, cands) => {
      let b = null;
      for (const [edge, off] of vals) for (const c of cands) if (Math.abs(edge - c) < tol && (!b || Math.abs(edge - c) < Math.abs(b.d))) b = { d: c - edge, c, off };
      return b;
    };
    if (moving) {
      const bx = best([[l.x, 0], [l.x + l.w / 2, 0], [l.x + l.w, 0]], xs);
      if (bx) { l.x += bx.d; guides.push({ x: bx.c }); }
      const by = best([[l.y, 0], [l.y + l.h / 2, 0], [l.y + l.h, 0]], ys);
      if (by) { l.y += by.d; guides.push({ y: by.c }); }
    } else if (resizing) {
      // Resizing: only the edges being dragged snap; the opposite edges stay put.
      const one = (edge, cands, apply, guide) => { const b = best([[edge, 0]], cands); if (b && apply(b.d)) guides.push(guide(b.c)); };
      if (resizing.includes("e")) one(l.x + l.w, xs, d => l.w + d >= 4 && (l.w += d, true), c => ({ x: c }));
      if (resizing.includes("w")) one(l.x, xs, d => l.w - d >= 4 && (l.x += d, l.w -= d, true), c => ({ x: c }));
      if (resizing.includes("s")) one(l.y + l.h, ys, d => l.h + d >= 4 && (l.h += d, true), c => ({ y: c }));
      if (resizing.includes("n")) one(l.y, ys, d => l.h - d >= 4 && (l.y += d, l.h -= d, true), c => ({ y: c }));
    }
    return guides;
  }

  canvas.addEventListener("mousedown", e => {
    if (!comp || e.button !== 0) return;
    const r = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left - offX) / scale, py = (e.clientY - r.top - offY) / scale;
    const handle = e.target.dataset && e.target.dataset.h;
    let l = layerById(selected);
    const inside = o => o && px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h;
    if (!handle) {
      const under = hit(px, py);
      // Like Canva: Shift / Ctrl + click adds a layer to the selection (or takes it out);
      // Shift / Ctrl + drag on empty canvas adds a box's worth.
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (under) pickToo(under.id); else marquee(r, px, py, true);
        return;
      }
      // Clicking inside a picked layer keeps the whole pick (it may be under another layer).
      const keep = e.altKey ? null : inside(l) ? l : picked().find(inside);
      l = keep || under;
      if (l && l.group && !e.altKey && !multi.has(l.id) && !insideGroup.has(l.group)) {
        multi.clear();
        groupOf(l).filter(o => !o.locked && o.visible !== false).forEach(o => multi.add(o.id));
        if (multi.size < 2) multi.clear();
      }
      if (!l || !multi.has(l.id)) multi.clear();
      selected = l ? l.id : null;
      renderLayers();
      renderProps();
      drawSelection();
      if (!l) { e.preventDefault(); return marquee(r, px, py, false); }
    }
    e.preventDefault();
    if (l.locked) return;   // (picked from the list: shown, but stays put)
    // Moving one of several picked layers moves them all (not the locked ones).
    const others = !handle && multi.size > 1 ? picked().filter(o => o !== l && !o.locked).map(o => ({ o, x: o.x, y: o.y })) : [];
    const start = { x: l.x, y: l.y, w: l.w, h: l.h, px, py };
    const ratio = l.w / Math.max(1, l.h);
    let moved = false;
    const move = ev => {
      const qx = (ev.clientX - r.left - offX) / scale, qy = (ev.clientY - r.top - offY) / scale;
      let dx = qx - start.px, dy = qy - start.py;
      if (!moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      if (!moved) { snapshot(); moved = true; }
      let guides = [];
      if (!handle) {
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        l.x = Math.round(start.x + dx); l.y = Math.round(start.y + dy);
        if (!ev.ctrlKey) guides = snap(l, true);
        l.x = Math.round(l.x); l.y = Math.round(l.y);
        for (const m of others) { m.o.x = m.x + l.x - start.x; m.o.y = m.y + l.y - start.y; }
      } else {
        let { x, y, w, h: hh } = start;
        if (handle.includes("e")) w = Math.max(4, start.w + dx);
        if (handle.includes("s")) hh = Math.max(4, start.h + dy);
        if (handle.includes("w")) { w = Math.max(4, start.w - dx); x = start.x + start.w - w; }
        if (handle.includes("n")) { hh = Math.max(4, start.h - dy); y = start.y + start.h - hh; }
        if (ev.shiftKey && handle.length === 2) {
          // Keep the shape.
          if (w / hh > ratio) { hh = w / ratio; if (handle.includes("n")) y = start.y + start.h - hh; }
          else { w = hh * ratio; if (handle.includes("w")) x = start.x + start.w - w; }
        }
        Object.assign(l, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) });
        if (!ev.ctrlKey && !ev.shiftKey) {   // Shift keeps the exact shape, so no snapping then
          guides = snap(l, false, handle);
          Object.assign(l, { x: Math.round(l.x), y: Math.round(l.y), w: Math.round(l.w), h: Math.round(l.h) });
        }
      }
      pending = true;
      saveSoon();
      redraw();
      drawSelection(guides);
      syncPropsGeometry();
    };
    const up = () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
      if (moved) changed();
      drawSelection();
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
  });
  // Drag a box over empty canvas: every visible layer it touches is picked (added to the pick with Shift / Ctrl).
  function marquee(r, sx, sy, add) {
    const before = add ? new Set(picked().map(o => o.id)) : new Set();
    const box = h("div", { class: "sel-box marquee" });
    let shown = false;
    const move = ev => {
      const qx = (ev.clientX - r.left - offX) / scale, qy = (ev.clientY - r.top - offY) / scale;
      const x0 = Math.min(sx, qx), y0 = Math.min(sy, qy), x1 = Math.max(sx, qx), y1 = Math.max(sy, qy);
      if (!shown && (x1 - x0) * scale < 3 && (y1 - y0) * scale < 3) return;
      const ids = new Set(before);
      for (const o of comp.layers) if (o.visible !== false && !o.locked && o.x < x1 && o.x + o.w > x0 && o.y < y1 && o.y + o.h > y0) ids.add(o.id);
      multi.clear();
      ids.forEach(id => multi.add(id));
      const order = comp.layers.filter(o => ids.has(o.id));
      selected = order.length ? order[order.length - 1].id : null;
      if (multi.size < 2) multi.clear();
      drawSelection();
      const [bx, by] = toScreen(x0, y0);
      Object.assign(box.style, { left: bx + "px", top: by + "px", width: (x1 - x0) * scale + "px", height: (y1 - y0) * scale + "px" });
      selLayer.appendChild(box);
      shown = true;
    };
    const up = () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
      box.remove();
      renderLayers();
      renderProps();
      drawSelection();
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
  }
  function selectAll() {
    const all = comp.layers.filter(o => o.visible !== false && !o.locked);
    multi.clear();
    if (all.length > 1) all.forEach(o => multi.add(o.id));
    selected = all.length ? all[all.length - 1].id : null;
    renderLayers();
    renderProps();
    drawSelection();
  }
  // Double-click a group: go inside it (single layers pick one at a time until you click outside).
  const insideGroup = new Set();
  canvas.addEventListener("mousedown", e => {
    if (pen || e.detail > 1) return;
    const r = canvas.getBoundingClientRect();
    const under = comp && hit((e.clientX - r.left - offX) / scale, (e.clientY - r.top - offY) / scale);
    if (!under || !under.group) insideGroup.clear();
    else if (!insideGroup.has(under.group)) insideGroup.clear();
  }, true);
  canvas.addEventListener("dblclick", e => {
    const r = canvas.getBoundingClientRect();
    const under = comp && hit((e.clientX - r.left - offX) / scale, (e.clientY - r.top - offY) / scale);
    if (under && under.group && !insideGroup.has(under.group)) { insideGroup.add(under.group); selectLayer(under.id); return; }
    const l = layerById(selected);
    if (l && l.type === "text") { const t = document.querySelector("#props textarea[data-k=text]"); if (t) { t.focus(); t.select(); } }
  });

  addEventListener("keydown", e => {
    if (App.tab !== "composer" || !comp || (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable)) return;
    const l = layerById(selected);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      const from = e.shiftKey ? redo : undo, to = e.shiftKey ? undo : redo;
      if (from.length) { to.push(JSON.stringify(comp)); restore(from.pop()); }
      return;
    }
    if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); if (redo.length) { undo.push(JSON.stringify(comp)); restore(redo.pop()); } return; }
    if (mod && e.key.toLowerCase() === "v" && !e.altKey) { e.preventDefault(); pasteLayers(); return; }
    if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); selectAll(); return; }
    if (!l) return;
    if (mod && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "x") && !e.altKey) {
      e.preventDefault();
      copyLayers(e.key.toLowerCase() === "x");
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      snapshot();
      for (const o of picked()) if (!o.locked) { o.x += moves[e.key][0]; o.y += moves[e.key][1]; }
      changed({ keepList: true });
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeLayers(picked());
    } else if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      if (multi.size > 1) placeLayers(picked(), 20, " copy");
      else duplicateLayer(l);
    } else if (mod && e.key.toLowerCase() === "g") {
      e.preventDefault();
      if (e.shiftKey) ungroupLayers(picked()); else groupLayers(picked());
    } else if (mod && (e.key === "]" || e.key === "[")) {
      e.preventDefault();
      restack(picked(), e.key === "]" ? (e.altKey ? "front" : "forward") : (e.altKey ? "back" : "backward"));
    } else if (e.key === "Escape") {
      selectLayer(null);
    }
  });
  // --- copy and paste -------------------------------------------------------
  // Ctrl+C / Ctrl+X copy the picked layers (all of a Ctrl / Shift pick, in
  // their stacking order) whole: style, field, live data links, "Show when",
  // animations and the files they use. Ctrl+V puts them in whichever graphic
  // is open, where they were (20 px on in the graphic they came from, more
  // each time), above the selected layer, with new ids. The copy is kept
  // while the engine runs (and in other Composer windows); from a graphic in
  // another workspace the engine brings the files over too.
  const CLIP_KEY = "gfx-layer-clip";
  let clip = null, pastes = {};
  const picked = () => multi.size > 1 ? comp.layers.filter(x => multi.has(x.id)) : [layerById(selected)].filter(Boolean);
  const newLayerId = () => "l" + Math.random().toString(16).slice(2, 10);
  const workspaceId = () => (App.state && App.state.workspace && App.state.workspace.id) || "";
  function copyLayers(cut) {
    const layers = picked();
    if (!layers.length) return;
    clip = { kind: "chud-gfx-layers", workspace: workspaceId(), comp: compId, cut: !!cut, at: Date.now(),
      layers: JSON.parse(JSON.stringify(layers)) };
    pastes = {};
    try { localStorage.setItem(CLIP_KEY, JSON.stringify(clip)); } catch (e) { /* too big or private: this window keeps it */ }
    const what = layers.length === 1 ? `"${layers[0].name}"` : `${layers.length} layers`;
    if (cut) { removeLayers(layers); toast(`Cut ${what}: Ctrl+V pastes it into any graphic`); }
    else toast(`Copied ${what}: Ctrl+V pastes into any graphic`);
  }
  function readClip() {
    // (the newest copy, this window's or another Composer window's)
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(CLIP_KEY) || "null"); } catch (e) { /* */ }
    // A copy is kept for 30 minutes: an old one must not pop up in a paste much later.
    if (stored && stored.kind === "chud-gfx-layers" && Date.now() - stored.at < 30 * 60e3 && (!clip || stored.at > clip.at)) { clip = stored; pastes = {}; }
    return clip;
  }
  async function pasteLayers() {
    if (!comp) return toast("Make or pick a graphic first", true);
    const c = readClip();
    if (!c || !c.layers || !c.layers.length) return toast("Nothing copied yet: pick a layer and press Ctrl+C", true);
    let layers = JSON.parse(JSON.stringify(c.layers));
    if (c.workspace && c.workspace !== workspaceId()) {
      // From another workspace: its pictures, videos and animations come too.
      const r = await api("/api/layer/paste", { workspace: c.workspace, layers });
      layers = r.layers;
      if (r.assets && r.assets.length) toast(`Brought ${r.assets.length} file(s) over from the other workspace`);
    }
    // Same graphic: a step on each time (a cut goes back where it was first).
    const here = c.comp === compId && c.workspace === workspaceId();
    const n = (pastes[compId] || 0) + (here && !c.cut ? 1 : 0);
    pastes[compId] = (pastes[compId] || 0) + 1;
    placeLayers(layers, 20 * n, "", true);
  }
  // Adds copies of the layers to the open graphic, above the selected layer
  // (or on top), and picks them.
  function placeLayers(layers, offset, suffix, fresh) {
    if (!layers.length) return;
    snapshot();
    const made = layers.map(src => {
      const l = fresh ? src : JSON.parse(JSON.stringify(src));
      l.id = newLayerId();
      if (suffix) l.name = (l.name || "Layer") + suffix;
      l.x = Math.round((+l.x || 0) + offset); l.y = Math.round((+l.y || 0) + offset);
      return l;
    });
    // (a field of the same name would be one field with another layer here)
    for (const l of made) if (l.field) l.field = uniqueField(l.field);
    const anchor = picked().reduce((i, x) => Math.max(i, comp.layers.indexOf(x)), -1);
    comp.layers.splice(anchor >= 0 ? anchor + 1 : comp.layers.length, 0, ...made);
    multi.clear();
    if (made.length > 1) made.forEach(l => multi.add(l.id));
    selected = made[made.length - 1].id;
    changed({ props: true });
  }
  function removeLayers(layers) {
    if (!layers.length) return;
    snapshot();
    const gone = new Set(layers.map(x => x.id));
    comp.layers = comp.layers.filter(x => !gone.has(x.id));
    multi.clear();
    selected = null;
    changed({ props: true });
  }

  function duplicateLayer(l) {
    snapshot();
    const copyL = JSON.parse(JSON.stringify(l));
    copyL.id = "l" + Math.random().toString(16).slice(2, 10);
    copyL.name = l.name + " copy";
    copyL.x += 20; copyL.y += 20;
    if (copyL.field) copyL.field = uniqueField(copyL.field);
    comp.layers.splice(comp.layers.indexOf(l) + 1, 0, copyL);
    selected = copyL.id;
    changed({ props: true });
  }
  function uniqueField(name) {
    const taken = new Set(comp.layers.map(l => (l.field || "").toLowerCase()));
    let n = 2, out = name;
    while (taken.has(out.toLowerCase())) out = `${name.replace(/ \d+$/, "")} ${n++}`;
    return out;
  }

  // Playing the animation on the canvas.
  $("#anim-in").addEventListener("click", () => { if (root) { GFX.finish(root); GFX.play(root, "in").then(() => {}); } });
  $("#anim-out").addEventListener("click", () => {
    if (!root) return;
    GFX.finish(root);
    GFX.play(root, "out").then(() => setTimeout(() => root && root.querySelectorAll(".gfx-A").forEach(a => a.getAnimations().forEach(x => x.cancel())), 600));
  });

  // --- properties ----------------------------------------------------------------
  const props = $("#props");
  function fontOptions(current) {
    const assetFonts = (App.state.fonts || []).map(f => f.postscript);
    const all = [...GFX.builtinFonts, ...assetFonts];
    const out = [];
    if (current && !all.includes(current)) out.push(h("option", { value: current, selected: true }, `${current} (not added: stand-in)`));
    out.push(h("optgroup", { label: "Built in" }, GFX.builtinFonts.map(f => h("option", { value: f, selected: f === current }, f))));
    if (assetFonts.length) out.push(h("optgroup", { label: "Added fonts" }, [...new Set(assetFonts)].sort().map(f => h("option", { value: f, selected: f === current }, f))));
    return out;
  }
  function assetSelect(kind, value, onChange) {
    const kinds = kind === "video" ? ["video"] : [kind];
    const list = App.assets.filter(a => kinds.includes(a.kind));
    // Pictures and the loop can follow the global configuration.
    const linked = kind === "image" ? [["{{Global!Left logo}}", "Left team's logo"], ["{{Global!Right logo}}", "Right team's logo"],
      ["{{Global!Tournament logo}}", "Tournament logo"], ["{{Sponsors}}", "Sponsors (in turn)"]]
      : kind === "video" ? [["{{Global!BG loop}}", "Background loop"]] : [];
    const known = list.some(a => a.path === value) || linked.some(([v]) => v === value);
    const sel = h("select", { onchange: e => onChange(e.target.value) },
      h("option", { value: "" }, "(none)"),
      linked.length ? h("optgroup", { label: "Global configuration" }, linked.map(([v, t]) => h("option", { value: v, selected: v === value }, t))) : null,
      h("optgroup", { label: "Files" }, list.map(a => h("option", { value: a.path, selected: a.path === value }, a.path.replace(/^assets\//, "")))),
      value && !known ? h("option", { value, selected: true }, value + " (missing)") : null);
    const file = h("input", { type: "file", hidden: true, accept: kind === "image" ? "image/*" : kind === "video" ? "video/*,.mov,.webm,.mxf,.zip,.aep,.aepx" : ".json,.lottie,.zip",
      onchange: async e => {
        const f = e.target.files[0];
        e.target.value = "";
        if (!f) return;
        let r = await upload(f);
        // (converted or rendered in the background: picked once it's ready)
        if (r && r.job && !(r.assets && r.assets[0])) r = await waitJob(r.job);
        const rel = r && r.assets && (r.assets.find(p => kind === "lottie" ? /\.json$/i.test(p) : kind === "video" ? /\.(webm|mp4|m4v)$/i.test(p) : true) || r.assets[0]);
        if (rel) onChange(rel);
      } });
    return h("div", { class: "pick" }, sel, h("button", { class: "small", title: "Add a file", onclick: () => file.click() }, "+"), file);
  }

  // An input bound to a layer property.
  // Text box that shows codes as chips. l.text keeps the real codes; the chips are only how they look.
  function tokenEditor(l) {
    const chip = code => h("span", { class: "code-chip", contenteditable: "false", "data-code": code, title: code,
      style: { display: "inline-block", padding: "0 6px", margin: "0 1px", borderRadius: "6px", fontSize: "12px", lineHeight: "18px",
        background: "rgba(80,150,255,.22)", border: "1px solid rgba(80,150,255,.55)", whiteSpace: "nowrap", userSelect: "all" } }, codeLabel(code));
    const ed = h("div", { class: "token-edit", contenteditable: "true", spellcheck: "false", role: "textbox", "aria-multiline": "true",
      style: { minHeight: "54px", padding: "6px 8px", border: "1px solid var(--line, #333)", borderRadius: "6px", background: "var(--input-bg, #0f1115)",
        whiteSpace: "pre-wrap", lineHeight: "22px", outline: "none", cursor: "text" } });
    const fill = text => ed.replaceChildren(...String(text || "").split(/(\{\{[^{}]+\}\})/).filter(Boolean)
      .map(part => /^\{\{[^{}]+\}\}$/.test(part) ? chip(part) : document.createTextNode(part)));
    // DOM back to text: chips become their codes, line breaks become \n.
    const read = node => [...node.childNodes].map(n => n.nodeType === 3 ? n.nodeValue
      : n.dataset && n.dataset.code ? n.dataset.code
      : n.nodeName === "BR" ? "\n"
      : (n.nodeName === "DIV" || n.nodeName === "P" ? "\n" : "") + read(n)).join("");
    let range = null, dirty = false;
    const keepRange = () => { const sel = getSelection(); if (sel.rangeCount && ed.contains(sel.anchorNode)) range = sel.getRangeAt(0).cloneRange(); };
    const sync = () => { l.text = read(ed).replace(/^\n/, ""); dirty = true; pending = true; saveSoon(); redraw(); };
    ed.addEventListener("input", () => { sync(); keepRange(); });
    ["keyup", "mouseup", "focus"].forEach(t => ed.addEventListener(t, keepRange));
    ed.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); document.execCommand("insertLineBreak"); } });
    ed.addEventListener("paste", e => {   // pasted codes turn into chips too
      e.preventDefault();
      const t = (e.clipboardData || window.clipboardData).getData("text");
      document.execCommand("insertText", false, t);
      if (/\{\{[^{}]+\}\}/.test(t)) { snapshot(); fill(read(ed)); sync(); }
    });
    ed.addEventListener("blur", () => { if (dirty) { dirty = false; snapshot(); changed({ keepList: true }); } });
    ed.insertCode = code => {
      snapshot();
      const c = chip(code);
      if (range && ed.contains(range.startContainer)) { range.deleteContents(); range.insertNode(c); }
      else ed.appendChild(c);
      l.text = read(ed).replace(/^\n/, "");
      changed({ props: true });
    };
    fill(l.text);
    return ed;
  }
  // Items typed here (picture + text) or read from a data source's columns: shared by the ticker and the rotator.
  function itemsEditor(l, save) {
    const srcNames = ["", "Global", ...(App.state.project.sources || []).map(x => x.name), ...Object.keys(App.state.data.feeds || {})];
    const head = ((App.state.data.tables || {})[l.source] || [])[0] || [];
    const colSel = (key, label) => lab(label, h("select", { onchange: e => { l[key] = e.target.value; save(); } },
      h("option", { value: "" }, "(none)"), head.filter(Boolean).map(c => h("option", { value: c, selected: l[key] === c }, c))));
    const items = l.items || (l.items = []);
    // One card per item: its text on top, its picture (optional) under it.
    const itemRows = items.map((it, i) => h("div", { style: { border: "1px solid var(--line, #333)", borderRadius: "6px", padding: "6px", marginBottom: "6px" } },
      h("div", { class: "row-gap", style: { alignItems: "center" } },
        h("input", { value: it.text || "", placeholder: `Item ${i + 1} text`, style: { flex: 1, minWidth: 0 }, onchange: e => { it.text = e.target.value; save(); } }),
        h("button", { class: "small", title: "Move up", disabled: !i, onclick: () => { items.splice(i - 1, 0, items.splice(i, 1)[0]); save(true); } }, "↑"),
        h("button", { class: "small danger", title: "Remove", onclick: () => { items.splice(i, 1); save(true); } }, "×")),
      h("div", { class: "row-gap", style: { alignItems: "center", marginTop: "4px" } }, h("span", { class: "muted small" }, "Picture"),
        assetSelect("image", it.img, v => { it.img = v; save(true); }))));
    return [
      lab("Items from", h("select", { onchange: e => { l.source = e.target.value; l.textCol = l.imgCol = ""; save(true); } },
        srcNames.map(n => h("option", { value: n, selected: (l.source || "") === n }, n || "The list below")))),
      l.source ? h("div", { class: "grid2" }, colSel("textCol", "Text column"), colSel("imgCol", "Picture column"))
        : h("div", {}, ...itemRows, h("button", { class: "small", onclick: () => { items.push({ text: "", img: "" }); save(true); } }, "+ Add item"))];
  }
  function tickerProps(l) {
    const save = (redrawProps) => { snapshot(); changed(redrawProps ? { props: true } : { keepList: true }); };
    return h("div", { class: "sect" }, h("h3", {}, "Ticker"),
      ...itemsEditor(l, save),
      h("div", { class: "grid3" }, lab("Speed px/s", bind(l, "speed", "number", { min: 5, step: 10 })),
        lab("Gap", bind(l, "gap", "number", { min: 0, step: 10 })), lab("Separator", bind(l, "sep", "text"))),
      h("div", { class: "grid3" }, lab("Picture height", bind(l, "imgSize", "number", { min: 8 })), lab("Size", bind(l, "size", "number", { min: 1 })),
        bind(l, "color", "color", { label: "Colour" })),
      lab("Font", h("select", { onchange: e => { snapshot(); l.font = e.target.value; changed({ props: true }); } }, fontOptions(l.font))),
      h("div", { class: "grid2" }, bind(l, "caps", "check", { label: "ALL CAPS" }),
        lab("Edge fade % (0 = hard edge)", h("input", { type: "number", min: 0, max: 45, step: 1,
          value: l.fade === false ? 0 : typeof l.fade === "number" ? l.fade : 8,
          onchange: e => { snapshot(); l.fade = Math.max(0, Math.min(45, +e.target.value || 0)); changed({ keepList: true }); } }))));
  }
  // Rotator: one item at a time in this box (sponsor logos, lines of text), swapping every few seconds.
  function rotatorProps(l) {
    const save = (redrawProps) => { snapshot(); changed(redrawProps ? { props: true } : { keepList: true }); };
    const pick = (key, opts) => h("select", { onchange: e => { snapshot(); l[key] = e.target.value; changed({ keepList: true }); } },
      opts.map(([v, t]) => h("option", { value: v, selected: (l[key] || opts[0][0]) === v }, t)));
    return h("div", { class: "sect" }, h("h3", {}, "Rotator"),
      h("p", { class: "muted small" }, "Shows one item at a time in this box, then swaps to the next. A picture on its own fills the box: drag the box's handles to size it."),
      lab("Pictures", pick("fit", [["contain", "Fit (whole picture)"], ["cover", "Fill (crop the edges)"], ["fill", "Stretch (to the box's shape)"]])),
      ...itemsEditor(l, save),
      h("div", { class: "grid3" }, lab("Seconds each", bind(l, "secs", "number", { min: 1, step: 1 })),
        lab("Swap", pick("swap", GFX.rotatorSwaps.map(k => [k, k[0].toUpperCase() + k.slice(1)]))),
        lab("Order", pick("order", [["in order", "In order"], ["shuffle", "Shuffled"]]))),
      lab("Swap time (ms)", bind(l, "swapMs", "number", { min: 80, step: 50, placeholder: "600" })),
      h("div", { class: "grid3" }, lab("Picture height (with text)", bind(l, "imgSize", "number", { min: 8 })), lab("Size", bind(l, "size", "number", { min: 1 })),
        bind(l, "color", "color", { label: "Colour" })),
      h("div", { class: "grid2" }, lab("Font", h("select", { onchange: e => { snapshot(); l.font = e.target.value; changed({ props: true }); } }, fontOptions(l.font))),
        lab("Align", pick("align", [["center", "Centre"], ["left", "Left"], ["right", "Right"]]))),
      bind(l, "caps", "check", { label: "ALL CAPS" }));
  }
  // Insert menu for text layers: data fields, the clock and countdowns, so nobody types {{...}} codes by hand.
  function insertPicker(l, textBox) {
    const put = token => textBox.insertCode(token);
    const sources = ["Global", ...(App.state.project.sources || []).map(x => x.name), ...Object.keys(App.state.data.feeds || {})];
    const fieldSel = h("select", { style: { flex: 1, minWidth: 0 } });
    const rowIn = h("input", { type: "number", min: 1, value: 1, title: "Row under the headers", style: { width: "56px" }, hidden: true });
    const srcSel = h("select", { style: { flex: 1, minWidth: 0 }, onchange: () => fillFields() },
      sources.length ? sources.map(n => h("option", { value: n }, n)) : [h("option", { value: "" }, "No data sources yet")]);
    function fillFields() {
      const name = srcSel.value, rows = (App.state.data.tables || {})[name] || [];
      const labels = rows.filter((r, i) => r[0] && r.length > 1 && !(i === 0 && name === "Global")).map(r => h("option", { value: `{{${name}!${r[0]}}}` }, `${r[0]}  (${String(r[1] ?? "").slice(0, 24)})`));
      const cols = (rows[0] || []).filter(Boolean).map(c => h("option", { value: `{{${name}!${c}#ROW}}`, "data-col": "1" }, `${c} column`));
      fieldSel.replaceChildren(...(rows.length ? [h("optgroup", { label: "Value next to a label" }, labels), h("optgroup", { label: "A column, by row" }, cols)]
        : [h("option", { value: "" }, name ? "No data read yet" : "Add a source on the Data page")]));
      fieldSel.onchange();
    }
    fieldSel.onchange = () => { const o = fieldSel.selectedOptions[0]; rowIn.hidden = !(o && o.dataset.col); };
    fillFields();
    const clockSel = h("select", { style: { flex: 1 }, onchange: () => { at.hidden = clockSel.value !== "countdown"; } },
      [["clock", "Clock (Global: time, Starting soon or BRB)"], ["timer", "Timer (Global)"], ["time", "Time (12-hour)"], ["time24", "Time (24-hour)"], ["date", "Date"], ["countdown", "Countdown to…"]].map(([v, t]) => h("option", { value: v }, t)));
    const at = h("input", { type: "time", value: "19:30", hidden: true, style: { width: "110px" } });
    return h("div", { class: "insert-picker", style: { display: "flex", flexDirection: "column", gap: "6px", margin: "6px 0 10px" } },
      h("div", { class: "row-gap" }, h("span", { class: "muted small", style: { width: "44px" } }, "Data"), srcSel, fieldSel, rowIn,
        h("button", { class: "small", onclick: () => { if (fieldSel.value) put(fieldSel.value.replace("ROW", Math.max(1, +rowIn.value || 1))); } }, "Insert")),
      h("div", { class: "row-gap" }, h("span", { class: "muted small", style: { width: "44px" } }, "Clock"), clockSel, at,
        h("button", { class: "small", onclick: () => put(clockSel.value === "countdown" ? `{{countdown:${at.value || "19:30"}}}` : `{{${clockSel.value}}}`) }, "Insert")));
  }
  function bind(l, key, kind, extra) {
    extra = extra || {};
    const set = v => { snapshot(); l[key] = v; changed({ keepList: key !== "name" && key !== "field" }); };
    let input;
    if (kind === "number") {
      input = h("input", { type: "number", step: extra.step || 1, min: extra.min, max: extra.max, value: l[key] ?? "", "data-k": key,
        onchange: e => set(e.target.value === "" ? 0 : +e.target.value) });
    } else if (kind === "color") {
      input = h("div", { class: "row-gap" },
        h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(l[key]) ? l[key] : "#ffffff", oninput: e => { l[key] = e.target.value; e.target.nextSibling.value = e.target.value; changed({ keepList: true }); }, onchange: () => {} }),
        h("input", { value: l[key] || "", "data-k": key, onchange: e => set(e.target.value) }));
    } else if (kind === "check") {
      input = h("label", { class: "toggle" }, h("input", { type: "checkbox", checked: !!l[key], onchange: e => set(e.target.checked) }), extra.label);
    } else if (kind === "select") {
      input = h("select", { "data-k": key, onchange: e => set(extra.num ? +e.target.value : e.target.value) },
        extra.options.map(o => Array.isArray(o) ? h("option", { value: o[0], selected: String(l[key]) === String(o[0]) }, o[1]) : h("option", { value: o, selected: l[key] === o }, o)));
    } else if (kind === "textarea") {
      input = h("textarea", { "data-k": key, rows: 3, oninput: e => { l[key] = e.target.value; pending = true; saveSoon(); redraw(); }, onchange: () => { snapshot(); changed({ keepList: true }); } });
      input.value = l[key] || "";
    } else {
      input = h("input", { value: l[key] ?? "", "data-k": key, placeholder: extra.placeholder || "", onchange: e => set(e.target.value) });
    }
    return extra.label && kind !== "check" ? h("label", {}, extra.label, input) : kind === "check" ? input : input;
  }
  const lab = (text, ...kids) => h("label", {}, text, ...kids);

  function syncPropsGeometry() {
    const l = layerById(selected);
    if (!l) return;
    for (const k of ["x", "y", "w", "h"]) {
      const input = props.querySelector(`input[data-k="${k}"]`);
      if (input && document.activeElement !== input) input.value = Math.round(l[k]);
    }
  }

  function renderProps() {
    if (!comp) { props.replaceChildren(h("div", { class: "empty" }, "Make a graphic with + New, or Import a Photoshop file.")); return; }
    if (multi.size > 1) return renderMulti();
    const l = layerById(selected);
    if (!l) return renderCompProps();
    const sections = [];
    sections.push(h("div", { class: "sect" },
      h("h3", {}, ({ text: "Text", rect: "Shape", image: "Picture", video: "Video", lottie: "Lottie animation", bracket: "Bracket", web: "Web page", ticker: "Ticker", rotator: "Rotator", shape: "Shape" }[l.type] || "Layer") + " layer"),
      lab("Name", bind(l, "name", "text")),
      h("label", { title: "Give it a name to change it from Control (and from data)" }, "Field (changed from Control)",
        h("div", { class: "row-gap" },
          h("input", { value: l.field || "", placeholder: "(fixed: not a field)", "data-k": "field",
            onchange: e => { snapshot(); l.field = e.target.value.trim() ? uniqueFieldExcept(e.target.value.trim(), l) : ""; changed({ props: true }); } }),
          !l.field ? h("button", { class: "small", onclick: () => { snapshot(); l.field = uniqueField(l.name); changed({ props: true }); } }, "Make field") : null)),
      h("div", { class: "grid4" }, lab("X", bind(l, "x", "number")), lab("Y", bind(l, "y", "number")),
        lab("W", bind(l, "w", "number", { min: 1 })), lab("H", bind(l, "h", "number", { min: 1 }))),
      h("div", { class: "grid3" },
        lab("Opacity", bind(l, "opacity", "number", { step: 0.05, min: 0, max: 1 })),
        lab("Rotate °", bind(l, "rotation", "number")),
        lab("Blend", bind(l, "blend", "select", { options: ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "plus-lighter"] }))),
      h("div", { class: "row-gap" },
        h("button", { class: "small", onclick: () => duplicateLayer(l) }, "Duplicate"),
        h("button", { class: "small", title: "Full screen", onclick: () => { snapshot(); Object.assign(l, { x: 0, y: 0, w: GFX.W, h: GFX.H }); changed({ props: true }); } }, "Fill"),
        h("button", { class: "small", title: "Centre on the canvas", onclick: () => { snapshot(); l.x = Math.round((GFX.W - l.w) / 2); l.y = Math.round((GFX.H - l.h) / 2); changed({ props: true }); } }, "Centre"),
        h("div", { class: "spacer" }),
        h("button", { class: "small danger", onclick: () => { snapshot(); comp.layers = comp.layers.filter(x => x !== l); selected = null; changed({ props: true }); } }, "Delete"))));

    if (l.type === "text") {
      const missing = !GFX.hasFont(l.font);
      const textBox = tokenEditor(l);
      sections.push(h("div", { class: "sect" }, h("h3", {}, "Text"),
        lab("Text", textBox),
        insertPicker(l, textBox),
        lab("Font", h("select", { onchange: e => { snapshot(); l.font = e.target.value; changed({ props: true }); } }, fontOptions(l.font))),
        missing ? h("div", { class: "warnline" }, `"${l.font}" isn't added: a similar font stands in. Add the font file in Assets.`) : null,
        h("div", { class: "grid3" }, lab("Size", bind(l, "size", "number", { min: 1 })), bind(l, "color", "color", { label: "Colour" }),
          lab("Weight", bind(l, "weight", "select", { num: true, options: [[300, "Light"], [400, "Regular"], [500, "Medium"], [600, "Semibold"], [700, "Bold"], [800, "Extra bold"], [900, "Black"]] }))),
        h("div", { class: "grid3" },
          lab("Align", bind(l, "align", "select", { options: [["left", "Left"], ["center", "Centre"], ["right", "Right"]] })),
          lab("Vertical", bind(l, "valign", "select", { options: [["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]] })),
          lab("Too long", bind(l, "fit", "select", { options: [["shrink", "Shrink"], ["squeeze", "Squeeze"], ["none", "Overflow"]] }))),
        h("div", { class: "grid3" },
          lab("Tracking", bind(l, "tracking", "number", { step: 10 })),
          lab("Line height", bind(l, "lineHeight", "number", { step: 0.05, min: 0.5 })),
          lab("Scroll px/s", bind(l, "scroll", "number", { min: 0, step: 10 }))),
        h("div", { class: "row-gap" }, bind(l, "caps", "check", { label: "ALL CAPS" }), bind(l, "italic", "check", { label: "Italic" }),
          bind(l, "shadow", "check", { label: "Shadow" })),
        l.scroll > 0 ? h("div", { class: "grid2" }, bind(l, "divider", "color", { label: "Divider between lines" }),
          lab("Divider width", bind(l, "dividerWidth", "number", { min: 0, step: 1 }))) : null,
        lab("Picture before the text", bind(l, "icon", "text", { placeholder: "e.g. {{Roster!Player 1 flag}}" })),
        l.show ? h("div", { class: "muted small" }, `Shown only while ${l.show} has something in it.`) : null));
    } else if (l.type === "ticker") {
      sections.push(tickerProps(l));
    } else if (l.type === "rotator") {
      sections.push(rotatorProps(l));
    } else if (l.type === "bracket") {
      sections.push(h("div", { class: "sect" }, h("h3", {}, "Bracket"),
        h("p", { class: "muted small" }, "The knockout bracket from Global > Tournament: 8 or 16 teams, single or double elimination (Control has the choice), drawn to fit this box."),
        lab("Font", h("select", { onchange: e => { snapshot(); l.font = e.target.value; changed({ props: true }); } }, fontOptions(l.font))),
        h("div", { class: "grid2" }, bind(l, "color", "color", { label: "Text" }), bind(l, "gold", "color", { label: "First round" })),
        h("div", { class: "grid2" }, bind(l, "dark", "color", { label: "Later rounds" }), bind(l, "line", "color", { label: "Lines" })),
        bind(l, "champ", "color", { label: "Champion's frame" })));
    } else if (l.type === "web") {
      sections.push(h("div", { class: "sect" }, h("h3", {}, "Page"),
        lab("Address", bind(l, "src", "text", { placeholder: "{{Rocket League HUD!target_cam}}" })),
        h("p", { class: "muted small" }, "A live web page in this box: a game HUD's page, or the spectated player's cam."),
        l.design != null ? h("button", { class: "small", onclick: () => { snapshot(); l.type = /^#|^rgb|^\{\{Global!.*colou?r/i.test(l.design) ? "rect" : "image";
          if (l.type === "rect") { l.fill = l.design; delete l.src; } else l.src = l.design; delete l.design; delete l.when; changed({ props: true }); } }, "Back to the design's picture") : null));
    } else if (l.type === "shape") {
      sections.push(...shapeProps(l));
    } else if (l.type === "rect") {
      sections.push(h("div", { class: "sect" }, h("h3", {}, "Shape"),
        h("div", { class: "grid2" }, bind(l, "fill", "color", { label: "Fill" }), lab("Corner radius", bind(l, "radius", "number", { min: 0 }))),
        h("div", { class: "grid2" }, bind(l, "stroke", "color", { label: "Border" }), lab("Border width", bind(l, "strokeWidth", "number", { min: 0 })))));
    } else {
      sections.push(h("div", { class: "sect" }, h("h3", {}, "Source"),
        lab("File", assetSelect(l.type, l.src, v => { snapshot(); l.src = v; changed({ props: true }); })),
        l.type === "image" && l.src ? h("button", { class: "small", style: { marginTop: "6px" }, onclick: () => naturalSize(l) }, "Actual size") : null,
        l.type === "image" ? lab("Sits at", bind(l, "position", "select", { options: [["", "Middle"], ["bottom", "Bottom"], ["top", "Top"], ["left", "Left"], ["right", "Right"]] })) : null,
        lab("Fit", bind(l, "fit", "select", { options: [["contain", "Fit inside"], ["cover", "Fill and crop"], ["fill", "Stretch"]] })),
        /\{\{\s*sponsors\s*\}\}/i.test(l.src || "") ? bind(l, "timer", "check", { label: "Show a bar with the time it has left" }) : null,
        l.type === "image" && /\{\{/.test(l.src || "") ? lab("When Global has none", assetSelect("image", l.placeholder || "", v => { snapshot(); l.placeholder = v; changed({ props: true }); })) : null,
        l.type === "video" ? h("div", { class: "row-gap" },
          bind(l, "tint", "text", { label: "Tint colour (e.g. {{Global!BG loop colour}})", placeholder: "(none)" })) : null,
        l.type !== "image" ? h("div", { class: "row-gap" }, bind(l, "loop", "check", { label: "Loop" }),
          l.type === "video" ? bind(l, "audio", "check", { label: "Sound (Program output)" }) : null) : null));
    }
    sections.push(fxSection(l));
    sections.push(liveSection([l]));
    sections.push(animSection(l));
    props.replaceChildren(...sections);
  }

  // --- live data: what a layer shows, fills by, and when it shows ------------------
  // (the property a layer's content is in)
  const contentKey = l => l.type === "text" ? "text" : l.type === "rect" ? "fill" : l.type === "shape" ? (isLineShape(l.shape) ? null : l.fillType === "image" ? "src" : l.fillType === "linear" || l.fillType === "radial" ? null : "fill")
    : ["image", "web", "video"].includes(l.type) ? "src" : null;
  function setShows(l, v) {
    const key = contentKey(l);
    if (!key) return;
    snapshot();
    // (the design's own text or picture is kept, to go back to)
    if (v && !LiveData.isToken(l[key]) && l.design == null) l.design = l[key] ?? "";
    if (v) l[key] = v;
    else if (l.design != null) { l[key] = l.design; delete l.design; }
    changed({ props: true });
  }
  function liveSection(layers) {
    const one = layers.length === 1 ? layers[0] : null;
    const each = fn => { snapshot(); layers.forEach(fn); changed({ props: true }); };
    const kids = [h("h3", {}, "Live data")];
    if (!one) kids.push(h("p", { class: "muted small" }, `${layers.length} layers: their "Show when" and "Fill by" are set together.`));
    const key = one && contentKey(one);
    if (key) {
      const v = LiveData.isToken(one[key]) ? one[key].trim() : "";
      kids.push(lab(one.type === "text" ? "Text shows" : one.type === "rect" ? "Colour from" : one.type === "web" ? "Page from" : "Picture from",
        LiveData.select(v, val => setShows(one, val), "(as designed)")));
    }
    // Fill by: a bar (or the dial's ring) cut to how full the value is.
    const m = one ? one.meter : null;
    kids.push(lab("Fill by (a boost bar or dial)", LiveData.select(m ? m.value : "", val =>
      each(l => { if (!val) delete l.meter; else l.meter = Object.assign({ max: "100", dir: "right" }, l.meter, { value: val }); }), "(always full)")));
    if (m) {
      const setM = (k, val) => { snapshot(); one.meter[k] = val; changed({ props: true }); };
      kids.push(h("div", { class: "grid3" },
        lab("Full at", h("input", { value: m.max ?? "100", onchange: e => setM("max", e.target.value) })),
        lab("Fills", h("select", { onchange: e => setM("dir", e.target.value) },
          [["right", "Left to right"], ["left", "Right to left"], ["up", "Bottom up"], ["down", "Top down"], ["ring", "Round (a dial)"]]
            .map(([o, t]) => h("option", { value: o, selected: (m.dir || "right") === o }, t)))),
        m.dir === "ring" ? lab("Starts at °", h("input", { type: "number", step: 5, value: m.start || 0, onchange: e => setM("start", +e.target.value) })) : null),
        m.dir === "ring" ? lab("Goes round °", h("input", { type: "number", step: 5, value: m.sweep || 360, onchange: e => setM("sweep", +e.target.value) })) : null,
        m.dir === "ring" ? h("p", { class: "muted small" }, "0° is the top, going clockwise. A dial that starts bottom-left and ends bottom-right: start 225°, round 270°.") : null);
    }
    // Show when: all of these true (else hidden, with its Out animation).
    const rules = one ? (Array.isArray(one.when) ? one.when : one.when ? [one.when] : []) : [];
    const setRules = list => each(l => { if (list.length) l.when = JSON.parse(JSON.stringify(list)); else delete l.when; });
    kids.push(h("label", {}, "Show when"));
    rules.forEach((r, i) => {
      const upd = (k, val) => { const list = rules.map(x => Object.assign({}, x)); list[i][k] = val; setRules(list); };
      kids.push(h("div", { class: "rule" },
        LiveData.select(r.value, val => { const list = rules.map(x => Object.assign({}, x)); if (val) list[i].value = val; else list.splice(i, 1); setRules(list); }, "(remove)"),
        h("div", { class: "row-gap" },
          h("select", { onchange: e => upd("op", e.target.value) }, GFX.RULE_OPS.map(([o, t]) => h("option", { value: o, selected: (r.op || "has") === o }, t))),
          ["has", "empty"].includes(r.op || "has") ? null : h("input", { value: r.to ?? "", placeholder: "value", onchange: e => upd("to", e.target.value) }))));
    });
    kids.push(h("div", { class: "row-gap" },
      LiveData.select("", val => { if (val) setRules([...rules, { value: val, op: "has" }]); }, rules.length ? "+ and also…" : "(always shown) + add a rule…")));
    if (rules.length || !one) {
      kids.push(lab("Otherwise", h("select", { onchange: e => each(l => { if (e.target.value) l.otherwise = e.target.value; else delete l.otherwise; }) },
        [["", "Hide (plays its Out animation, then In when it's back)"], ["dim", "Fade it (an empty series box)"]]
          .map(([o, t]) => h("option", { value: o, selected: ((one && one.otherwise) || "") === o }, t)))));
      if (!one) kids.push(h("button", { class: "small", onclick: () => each(l => { delete l.when; delete l.otherwise; }) }, "Clear their rules"));
    }
    if (rules.length) kids.push(h("p", { class: "muted small" }, "Composer shows it either way; on air it follows the rule, playing its In and Out animations. A box that rises in and sinks away: In and Out both slide-up."));
    if (one && ["image", "rect", "video"].includes(one.type)) kids.push(h("button", { class: "small", style: { marginTop: "6px" },
      title: "The Rocket League HUD's player cam (Player Cam or a VDO.Ninja link) for whoever is spectated, in this box",
      onclick: () => { snapshot(); makeCam(one); changed({ props: true }); } }, "Make this the spectated player's cam"));
    return h("div", { class: "sect" }, ...kids);
  }
  // A box that shows the spectated player's cam, and slides away when they have none.
  function makeCam(l) {
    l.design = l.design ?? (l.src || l.fill || "");
    l.type = "web";
    l.src = `{{${LiveData.RL}!target_cam}}`;
    delete l.fill;
    l.when = [{ value: `{{${LiveData.RL}!target_has_cam}}`, op: "has" }];
    l.anim = Object.assign({}, l.anim, { in: { type: "slide-up", dur: 400, delay: 0 }, out: { type: "slide-up", dur: 350, delay: 0 } });
  }
  function renderMulti() {
    const layers = comp.layers.filter(l => multi.has(l.id));
    const setAnim = (dir, type) => { if (!type) return; snapshot(); layers.forEach(l => { l.anim = l.anim || {}; l.anim[dir] = Object.assign({ dur: 300, delay: 0 }, l.anim[dir], { type }); }); changed({ props: true }); };
    const edit = fn => { snapshot(); layers.forEach(fn); changed({ props: true }); };
    // Align to each other (to the canvas when the pick is only one layer wide or tall makes no sense, so always to the pick's box).
    const x0 = Math.min(...layers.map(l => l.x)), y0 = Math.min(...layers.map(l => l.y));
    const x1 = Math.max(...layers.map(l => l.x + l.w)), y1 = Math.max(...layers.map(l => l.y + l.h));
    const ALIGN = [["Left", l => { l.x = x0; }], ["Centre", l => { l.x = Math.round((x0 + x1 - l.w) / 2); }], ["Right", l => { l.x = x1 - l.w; }],
      ["Top", l => { l.y = y0; }], ["Middle", l => { l.y = Math.round((y0 + y1 - l.h) / 2); }], ["Bottom", l => { l.y = y1 - l.h; }]];
    // Spread evenly: same gap between neighbours, the outer two stay put.
    const spread = (pos, size) => {
      const s = [...layers].sort((a, b) => a[pos] - b[pos]), first = s[0], last = s[s.length - 1];
      const gap = (last[pos] + last[size] - first[pos] - s.reduce((t, o) => t + o[size], 0)) / (s.length - 1);
      snapshot();
      let at = first[pos];
      for (const o of s) { o[pos] = Math.round(at); at += o[size] + gap; }
      changed({ props: true });
    };
    // One value for every picked layer that has it; blank when they differ.
    const same = (list, key) => list.every(o => o[key] === list[0][key]) ? list[0][key] : "";
    const typed = layers.filter(o => o.type === "text" || o.type === "ticker" || o.type === "rotator");
    const num = (list, key, label, opt) => lab(label, h("input", Object.assign({ type: "number", value: same(list, key) ?? "", placeholder: "mixed",
      onchange: e => { if (e.target.value === "") return; const v = +e.target.value; snapshot(); list.forEach(o => { o[key] = v; }); changed({ props: true }); } }, opt)));
    props.replaceChildren(
      h("div", { class: "sect" }, h("h3", {}, `${layers.length} layers`),
        h("p", { class: "muted small" }, layers.map(l => l.name).join(", ")),
        h("p", { class: "muted small" }, "Shift or Ctrl + click picks more (or fewer), on the canvas or in the list. Drag a box on empty canvas to pick everything it touches. Ctrl+A picks all."),
        h("div", { class: "row-gap" },
          h("button", { class: "small", onclick: () => placeLayers(picked(), 20, " copy") }, "Duplicate"),
          h("button", { class: "small", onclick: () => edit(l => { l.visible = l.visible === false; }) }, "Show / hide"),
          h("div", { class: "spacer" }),
          h("button", { class: "small danger", onclick: () => removeLayers(picked()) }, "Delete"))),
      ...multiExtras(layers),
      h("div", { class: "sect" }, h("h3", {}, "Align"),
        h("div", { class: "grid3" }, ...ALIGN.map(([t, fn]) => h("button", { class: "small", onclick: () => edit(fn) }, t))),
        layers.length > 2 ? h("div", { class: "grid2", style: { marginTop: "6px" } },
          h("button", { class: "small", onclick: () => spread("x", "w") }, "Space evenly across"),
          h("button", { class: "small", onclick: () => spread("y", "h") }, "Space evenly down")) : null,
        h("div", { class: "grid2", style: { marginTop: "6px" } },
          h("button", { class: "small", title: "Centre the group on the canvas", onclick: () => { const dx = Math.round((GFX.W - (x1 - x0)) / 2) - x0, dy = Math.round((GFX.H - (y1 - y0)) / 2) - y0; edit(l => { l.x += dx; l.y += dy; }); } }, "Centre on canvas"),
          h("button", { class: "small", title: "Give them all the first one's size", onclick: () => { const f = layers[0]; edit(l => { l.w = f.w; l.h = f.h; }); } }, "Same size"))),
      h("div", { class: "sect" }, h("h3", {}, "Style (all picked)"),
        h("div", { class: "grid3" }, num(layers, "opacity", "Opacity", { step: 0.05, min: 0, max: 1 }), num(layers, "rotation", "Rotate °"),
          lab("Blend", h("select", { onchange: e => edit(l => { l.blend = e.target.value; }) },
            h("option", { value: "" }, same(layers, "blend") ? same(layers, "blend") : "mixed"),
            ["normal", "multiply", "screen", "overlay", "darken", "lighten", "soft-light", "difference"].map(b => h("option", { value: b }, b))))),
        typed.length ? h("div", {},
          h("p", { class: "muted small" }, `Text: ${typed.length} of them`),
          h("div", { class: "grid3" }, num(typed, "size", "Size", { min: 1 }),
            lab("Colour", h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(same(typed, "color")) ? same(typed, "color") : "#ffffff",
              onchange: e => { snapshot(); typed.forEach(o => { o.color = e.target.value; }); changed({ props: true }); } })),
            h("label", {}, h("input", { type: "checkbox", checked: typed.every(o => o.caps),
              onchange: e => { snapshot(); typed.forEach(o => { o.caps = e.target.checked; }); changed({ props: true }); } }), " ALL CAPS")),
          lab("Font", h("select", { onchange: e => { snapshot(); typed.forEach(o => { o.font = e.target.value; }); changed({ props: true }); } },
            same(typed, "font") ? null : h("option", { value: "", selected: true, disabled: true }, "mixed"), fontOptions(same(typed, "font") || "")))) : null),
      liveSection(layers),
      h("div", { class: "sect" }, h("h3", {}, "Animation"),
        h("div", { class: "grid2" },
          lab("All in", h("select", { onchange: e => setAnim("in", e.target.value) }, h("option", { value: "" }, "(as they are)"), GFX.animTypes.map(t => h("option", { value: t }, t)))),
          lab("All out", h("select", { onchange: e => setAnim("out", e.target.value) }, h("option", { value: "" }, "(as they are)"), GFX.animTypes.map(t => h("option", { value: t }, t)))))));
  }
  function uniqueFieldExcept(name, layer) {
    const taken = new Set(comp.layers.filter(x => x !== layer).map(x => (x.field || "").toLowerCase()));
    let n = 2, out = name;
    while (taken.has(out.toLowerCase())) out = `${name} ${n++}`;
    return out;
  }
  function naturalSize(l) {
    const img = new Image();
    img.onload = () => { snapshot(); l.w = img.naturalWidth; l.h = img.naturalHeight; changed({ props: true }); };
    img.src = "/" + l.src;
  }

  function animSection(l) {
    l.anim = l.anim || {};
    const row = dir => {
      const a = (l.anim[dir] = l.anim[dir] || { type: "fade", dur: 300, delay: 0 });
      const set = (k, v) => { snapshot(); a[k] = v; changed({ keepList: true }); };
      return h("div", { class: "grid3" },
        lab(dir === "in" ? "In" : "Out", h("select", { onchange: e => set("type", e.target.value) },
          GFX.animTypes.map(t => h("option", { value: t, selected: a.type === t }, t)))),
        lab("ms", h("input", { type: "number", min: 0, step: 50, value: a.dur, onchange: e => set("dur", +e.target.value) })),
        lab("Delay ms", h("input", { type: "number", min: 0, step: 50, value: a.delay || 0, onchange: e => set("delay", +e.target.value) })));
    };
    return h("div", { class: "sect" }, h("h3", {}, "Animation"), row("in"), row("out"),
      h("div", { class: "row-gap", style: { marginTop: "8px" } },
        h("button", { class: "small", onclick: () => { if (root) GFX.play(root, "in"); } }, "▶ Play in")));
  }

  function renderCompProps() {
    const fields = App.fields(comp);
    props.replaceChildren(
      h("div", { class: "sect" }, h("h3", {}, "Graphic"),
        lab("Name", h("input", { value: comp.name, onchange: e => { snapshot(); comp.name = e.target.value || "Graphic"; changed({ props: true }); renderComps(); } })),
        lab("Kind", h("select", { onchange: e => { snapshot(); comp.kind = e.target.value; changed(); } },
          [["board", "Full-page board"], ["lower third", "Lower third"], ["overlay", "Overlay (scorebug, ticker…)"]].map(([v, t]) => h("option", { value: v, selected: (comp.kind || "overlay") === v }, t)))),
        h("p", { class: "muted small" }, "On air there's one board and one lower third at a time: taking another replaces it. Overlays stay."),
        lab("Stacking on the output", h("select", { onchange: e => { snapshot(); comp.layer = +e.target.value; changed(); } },
          [[-1, "Behind others"], [0, "Normal"], [1, "In front"], [2, "Always on top"]].map(([v, t]) => h("option", { value: v, selected: (comp.layer || 0) === v }, t)))),
        lab("On air, switch OBS to", h("select", { title: "When this graphic goes on Program, OBS switches to this scene (Outputs > OBS Studio)",
          onchange: e => { snapshot(); comp.obsScene = e.target.value; changed(); } },
          h("option", { value: "" }, "(don't switch)"),
          [...new Set([...((App.state.obs || {}).scenes || []), comp.obsScene].filter(Boolean))].map(n => h("option", { value: n, selected: comp.obsScene === n }, n)))),
        h("p", { class: "muted small" }, `${comp.layers.length} layers, ${fields.length} fields. Click a layer to change it.`)),
      h("div", { class: "sect" }, h("h3", {}, "Animation"),
        h("p", { class: "muted small" }, "Every layer has its own In and Out animation. Set them all at once:"),
        h("div", { class: "row-gap" },
          h("button", { class: "small", onclick: () => autoAnimate() }, "Auto (one after another)"),
          h("button", { class: "small", onclick: () => allAnim("fade") }, "All fade"),
          h("button", { class: "small", onclick: () => allAnim("none") }, "None"))),
      hudSection(),
      linksSection(),
      h("div", { class: "sect" }, h("h3", {}, "Shortcuts"),
        h("p", { class: "muted small" }, "Drag to move (Shift: straight, Ctrl: no snapping), handles to resize (snaps too; Shift: keep shape, Ctrl: no snapping). Arrows nudge (Shift: 10). Ctrl+C / Ctrl+X copy or cut (Ctrl / Shift + click picks more) and Ctrl+V pastes, into this graphic or any other. Ctrl+D duplicates, Delete removes, Ctrl+Z / Ctrl+Shift+Z undo / redo. Alt+click picks the layer underneath (or one layer of a group; double-click goes inside a group). Ctrl+G groups, Ctrl+Shift+G ungroups. Ctrl+] / Ctrl+[ bring forward / send backward (with Alt: to front / to back). In the layers list: double-click renames, right-click opens the layer menu, the lock keeps a layer from being picked on the canvas. Ctrl+scroll zooms (Ctrl+0 fits, Ctrl+1 is 100%), scroll or middle-drag or Space+drag moves around while zoomed.")));
  }
  // --- Add to a HUD: this graphic as a game HUD's own overlay -------------------
  let hudGame = "rl";
  try { hudGame = localStorage.getItem("gfx-hud-game") || "rl"; } catch (e) { /* */ }
  function hudSection() {
    const box = h("div", { class: "sect hud-add" }, h("h3", {}, "Add this to a game HUD"),
      h("p", { class: "muted small" }, "Makes this graphic that game's overlay, with the HUD's live data."),
      h("div", { class: "muted small" }, "Looking for the HUDs…"));
    const forComp = compId;
    fetch("/api/hud-looks").then(r => r.json()).then(r => {
      if (compId !== forComp || !box.isConnected) return;
      const huds = r.huds || [];
      const pick = huds.find(x => x.game === hudGame) || huds[0];
      const list = h("select", { onchange: e => { hudGame = e.target.value; try { localStorage.setItem("gfx-hud-game", hudGame); } catch (err) { /* */ } renderProps(); } },
        huds.map(x => h("option", { value: x.game, selected: x === pick }, x.name + (x.look ? ` · "${x.look.name}"` : ""))));
      const kids = [lab("Game", list)];
      if (pick) {
        const look = pick.look, mine = look && look.comp === compId;
        const n = comp.layers.filter(linked).length;
        if (pick.native) {
          // The Rocket League HUD plays the graphic itself (no delay).
          kids.push(h("p", { class: "muted small" }, `The ${pick.hud} plays it itself, with its own live data (no delay), cams and all.`));
          kids.push(h("p", { class: "small " + (pick.connected ? "" : "warnline") }, pick.connected
            ? `${pick.hud} is connected (${pick.from}).` + (look ? (pick.took === look.rev ? " It's playing what was sent last." : " It picks up the last one in a few seconds.") : "")
            : `${pick.hud} isn't connected to this engine now. It takes the graphic when it connects (Connect to GFX Baby in the HUD).`));
        } else {
          // Every other game: GFX Baby plays it on the game's overlay output, fed by the HUD's data.
          const app = App.state.app || {}, host = (app.addresses || [])[0] || location.hostname;
          const url = `http://${host}:${app.port || location.port}${pick.output}`;
          kids.push(h("p", { class: "muted small" }, `GFX Baby plays it as the ${pick.name} overlay. Add this address in OBS as a browser source (1920 × 1080) above the ${pick.hud}:`));
          kids.push(h("div", { class: "row-gap", style: { alignItems: "center" } },
            h("input", { value: url, readOnly: true, style: { flex: 1, minWidth: 0 }, onfocus: e => e.target.select() }),
            h("button", { class: "small", onclick: () => copy(url, "the overlay address") }, "Copy"),
            h("a", { class: "btn small", href: pick.output + "&bg=checker", target: "_blank" }, "Open ↗")));
          kids.push(h("p", { class: "small " + (pick.connected ? "" : "warnline") }, pick.connected
            ? `${pick.hud} is connected (${pick.from}): its live data is in the overlay.`
            : `${pick.hud} isn't connected now. The overlay shows, and its live data comes in once the HUD connects (Connect to GFX Baby in the HUD).`));
        }
        if (look) kids.push(h("p", { class: "muted small" }, `${mine ? "This graphic" : `"${look.name}"`} is the ${pick.name} overlay (since ${new Date(look.at * 1000).toLocaleString()}).`));
        if (!n) kids.push(h("p", { class: "warnline small" }, "None of its layers follow the live data yet: link them below, or pick a layer and use Live data."));
        kids.push(h("div", { class: "row-gap" },
          h("button", { class: "primary", onclick: async () => {
            const r2 = await api("/api/hud-look", { comp: compId, game: pick.game });
            if (r2 && r2.look) { toast(pick.native ? `Sent to the ${pick.hud}` : `"${comp.name}" is the ${pick.name} overlay`); renderProps(); }
          } }, pick.native ? (look && mine ? `Send the changes to the ${pick.hud}` : `Make it the ${pick.hud}'s overlay`) : (mine ? "It's the overlay ✓" : `Make it the ${pick.name} overlay`)),
          look ? h("button", { class: "small", title: `Nothing on the ${pick.name} overlay`, onclick: async () => {
            await api("/api/hud-look", { game: pick.game, clear: true });
            toast(`The ${pick.name} overlay is empty now`);
            renderProps();
          } }, "Clear") : null));
      }
      box.replaceChildren(box.firstChild, box.children[1], ...kids);
    }).catch(() => { if (box.isConnected) box.lastChild.textContent = "Couldn't ask the engine about the HUDs."; });
    return box;
  }
  // Every field of the graphic, with the live data it follows: linking a whole HUD in one place.
  function linksSection() {
    const rows = comp.layers.filter(l => l.field || contentKey(l) && LiveData.isToken(l[contentKey(l)]));
    if (!rows.length) return null;
    return h("div", { class: "sect links" }, h("h3", {}, "Live data links"),
      h("p", { class: "muted small" }, "Each field and what it shows on air. Click a name to find it on the canvas."),
      ...[...rows].reverse().map(l => {
        const key = contentKey(l), v = key && LiveData.isToken(l[key]) ? l[key].trim() : "";
        const was = l.type === "text" ? (l.design ?? l.text) : "";
        return h("div", { class: "link-row" },
          h("a", { href: "#", title: was ? `Designed as "${was}"` : l.name, onclick: e => { e.preventDefault(); selected = l.id; renderLayers(); drawSelection(); } },
            l.name + (was && !v ? ` · "${String(was).slice(0, 14)}"` : "")),
          key ? LiveData.select(v, val => setShows(l, val), "(as designed)") : h("span", { class: "muted small" }, "—"));
      }));
  }

  function allAnim(type) {
    snapshot();
    for (const l of comp.layers) l.anim = { in: { type, dur: 300, delay: 0 }, out: { type: type === "none" ? "none" : "fade", dur: 250, delay: 0 } };
    changed();
  }
  function autoAnimate() {
    snapshot();
    const order = comp.layers.map((l, i) => i).sort((a, b) => Math.floor(comp.layers[a].x / 120) - Math.floor(comp.layers[b].x / 120) || comp.layers[a].y - comp.layers[b].y);
    order.forEach((i, n) => {
      const l = comp.layers[i];
      let type = "fade", delay = 80;
      if (l.w >= GFX.W * 0.9 && l.h >= GFX.H * 0.9) { type = "fade"; delay = 0; }
      else if (l.type === "text") { type = "slide-up"; delay = 150; }
      else if (l.w > l.h * 3) { type = "wipe-right"; delay = 0; }
      else if (l.w < 400 && l.h < 400) type = "scale";
      l.anim = { in: { type, dur: 450, delay: Math.min(700, delay + n * 12) }, out: { type: "fade", dur: 250, delay: 0 } };
    });
    changed();
  }

  App.on((s, what) => {
    renderComps();
    if (what === "assets") { if (selected) renderProps(); return; }
    adopt(false);
  });
  renderShapeTiles();
  renderFrameTiles();
  renderLiveTiles();
  showPane(pane, false);
  pages.composer = { shown() { fitStage(); adopt(!comp); } };
  window.editGraphic = id => { open(id); showTab("composer"); };
})();
