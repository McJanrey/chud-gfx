// Composer's Add panel: tabs of things to put in the graphic (text, shapes, media, live data, frames, parts).
import { $, el, api, App, assets, toast, ask, askText } from "./lib.js";
import { addLayers, composer } from "./composer.js";

let tab = "graphics";
const T = (text, size, extra = {}) => ({ type: "text", name: extra.name || text.slice(0, 24), text, font: "Inter", size, color: "#ffffff", weight: 600, align: "left", valign: "middle", w: Math.max(200, Math.round(text.length * size * 0.6)), h: Math.round(size * 1.5), ...extra });
const tile = (label, sub, onclick) => el("button", { class: "lib-tile", onclick }, el("b", {}, label), sub ? el("span", { class: "muted small" }, sub) : "");
const group = (title, ...kids) => el("div", { class: "lib-group" }, el("h4", {}, title), el("div", { class: "lib-grid" }, ...kids));

// live data, by table and field
const G = f => `{{Global!${f}}}`;
const LIVE_TEXT = [["Left team name", G("Left name")], ["Right team name", G("Right name")], ["Left short name", G("Left short")], ["Right short name", G("Right short")],
  ["Left score", G("Left score")], ["Right score", G("Right score")], ["Event", G("Event")], ["Stage", G("Stage")], ["Game", G("Game")], ["Ticker", G("Ticker")],
  ["Clock", "{{CLOCK}}"], ["Date", "{{DATE}}"], ["Champion", "{{Tournament!Top champion}}"]];

function textTab() {
  return [group("Add text",
      tile("Heading", "96 · bold", () => addLayers([T("Heading", 96, { weight: 800 })])),
      tile("Subheading", "56", () => addLayers([T("Subheading", 56)])),
      tile("Body text", "32", () => addLayers([T("A little bit of body text", 32, { weight: 400 })])),
      tile("LABEL", "24 · capitals", () => addLayers([T("LABEL", 24, { caps: true, tracking: 120, weight: 700 })]))),
    group("Live text (follows the data)", ...LIVE_TEXT.map(([n, v]) => tile(n, v, () => addLayers([T(v, n.includes("score") ? 96 : 48, { name: n, weight: n.includes("score") ? 800 : 600, w: n.includes("score") ? 160 : 600 })]))))];
}

function shapesTab() {
  const S = (shape, w, h, extra = {}) => () => addLayers([{ type: "shape", name: extra.name || shape, shape, fill: "#c8f03c", w, h, ...extra }]);
  return [el("button", { class: "small primary", onclick: () => composer.startPen() }, "✎ Pen: draw your own shape"),
    el("p", { class: "muted small" }, "Click points on the canvas, click the first one to close."),
    group("Basic", tile("Box", "", S("rect", 400, 240)), tile("Rounded", "", S("rect", 400, 240, { radius: 24 })), tile("Pill", "", S("pill", 400, 120)), tile("Circle", "", S("ellipse", 240, 240)),
      tile("Triangle", "", S("triangle", 260, 220)), tile("Diamond", "", S("diamond", 240, 240)), tile("Hexagon", "", S("polygon", 260, 240, { sides: 6 })), tile("Star", "", S("star", 240, 240))),
    group("Lines", tile("Across", "4 px", S("rect", 600, 4, { name: "Line" })), tile("Up and down", "4 px", S("rect", 4, 300, { name: "Line" })), tile("Thick", "12 px", S("rect", 600, 12, { name: "Bar" }))),
    group("Broadcast", tile("Lower third bar", "", S("rect", 1100, 120, { name: "Lower third bar", fill: "#000000", x: 410, y: 860 })),
      tile("Name tab", "", S("tab", 420, 70, { name: "Name tab" })), tile("Slanted", "", S("parallelogram", 480, 90)), tile("Chevron", "", S("chevron", 300, 120)),
      tile("Score box", "", S("rect", 160, 120, { name: "Score box", fill: "#111111", radius: 10 })), tile("Arrow", "", S("arrow", 300, 120)), tile("Shield", "", S("shield", 200, 240)))];
}

async function mediaTab() {
  const list = await assets();
  const add = a => {
    if (a.kind === "video") return addLayers([{ type: "video", name: a.path.split("/").pop(), src: a.path, fit: "cover", loop: true, w: 1920, h: 1080, x: 0, y: 0 }]);
    const img = new Image();
    img.onload = () => { const k = Math.min(1, 1920 / img.naturalWidth, 1080 / img.naturalHeight); addLayers([{ type: "image", name: a.path.split("/").pop(), src: a.path, fit: "contain", w: Math.round(img.naturalWidth * k), h: Math.round(img.naturalHeight * k) }]); };
    img.src = a.path.split("/").map(encodeURIComponent).join("/");
  };
  return [group("Add",
      tile("Picture", "pick its file on the right", () => addLayers([{ type: "image", name: "Picture", src: "", fit: "contain", w: 600, h: 400 }])),
      tile("Video", "", () => addLayers([{ type: "video", name: "Video", src: "", fit: "cover", loop: true, w: 960, h: 540 }])),
      tile("Lottie", "After Effects animation (.json)", () => addLayers([{ type: "lottie", name: "Lottie", src: "", loop: true, w: 600, h: 600 }])),
      tile("Web page", "", () => addLayers([{ type: "web", name: "Web page", src: "https://", w: 960, h: 540 }]))),
    el("h4", {}, "This workspace's files (click to add)"),
    el("div", { class: "lib-files" }, ...list.filter(a => a.kind === "image" || a.kind === "video").map(a => el("button", { class: "lib-file", title: a.path, onclick: () => add(a) },
      a.kind === "image" ? el("img", { src: a.path.split("/").map(encodeURIComponent).join("/"), alt: "", loading: "lazy" }) : el("span", { class: "muted small" }, "▶ video"),
      el("span", { class: "small" }, a.path.split("/").pop()))))];
}

function liveTab() {
  const I = (name, src, w, h, extra = {}) => () => addLayers([{ type: "image", name, src, fit: "contain", w, h, ...extra }]);
  const huds = ((App.state.data || {}).tables || {}).HUDs || [];
  const hudGroups = huds.slice(1).map(([n]) => group(n, ...(((App.state.data.tables[n]) || []).slice(1).map(([f]) => tile(f, `{{${n}!${f}}}`, () => addLayers([T(`{{${n}!${f}}}`, 40, { name: f })]))))));
  return [group("Logos", tile("Left team logo", "", I("Left logo", G("Left logo"), 240, 240)), tile("Right team logo", "", I("Right logo", G("Right logo"), 240, 240)),
      tile("Tournament logo", "", I("Tournament logo", G("Tournament logo"), 240, 240)), tile("Sponsors (in turn)", "", I("Sponsor", "{{Sponsors}}", 300, 120, { swap: "fade" })),
      tile("All sponsors (a row)", "", I("Sponsors", "{{Sponsors all}}", 1200, 45, { mono: true }))),
    group("Teams", ...LIVE_TEXT.slice(0, 6).map(([n, v]) => tile(n, "", () => addLayers([T(v, n.includes("score") ? 96 : 48, { name: n })]))),
      tile("Left team colour", "a box", () => addLayers([{ type: "rect", name: "Left colour", fill: G("Left color"), w: 400, h: 120 }])),
      tile("Right team colour", "a box", () => addLayers([{ type: "rect", name: "Right colour", fill: G("Right color"), w: 400, h: 120 }]))),
    group("Show", tile("Ticker", "Global's ticker", () => addLayers([{ type: "text", name: "Ticker", text: G("Ticker"), font: "Inter", size: 32, color: "#ffffff", weight: 600, scroll: 120, valign: "middle", w: 1920, h: 60, x: 0, y: 1020 }])),
      tile("Rotator", "", () => addLayers([{ type: "rotator", name: "Rotator", items: [{ text: "First", img: "" }, { text: "Second", img: "" }], secs: 5, swap: "crossfade", order: "in order", font: "Inter", size: 48, color: "#ffffff", weight: 700, w: 900, h: 120 }])),
      tile("Background loop", "Global's loop in the team colour", () => addLayers([{ type: "video", name: "Background loop", src: G("BG loop"), tint: G("BG loop colour"), brightness: G("BG loop brightness"), speed: G("BG loop speed"), fit: "cover", loop: true, w: 1920, h: 1080, x: 0, y: 0 }])),
      tile("Clock", "", () => addLayers([T("{{CLOCK}}", 72, { name: "Clock", weight: 800 })]))),
    group("Cameras (Cameras page)",
      tile("Camera", "a guest's webcam", () => addLayers([{ type: "camera", name: "Camera", cam: ((App.state.project.cams || [])[0] || {}).name || "", w: 640, h: 360 }])),
      tile("Player's camera", "follows the Roster's player 1", () => addLayers([{ type: "camera", name: "Player 1 camera", cam: "{{Roster!Player 1 name}}", w: 480, h: 270 }])),
      tile("Caster cameras", "on the caster boxes (moving with them), or two to place", () => casterCams())),
    group("Tournament", tile("Knockout bracket", "8 or 16", () => addLayers([{ type: "bracket", name: "Bracket", font: "Bebas Neue", color: "#ffffff", gold: "#b28a1d", dark: "#000b05", line: "#b28a1d", w: 1566, h: 748 }])),
      tile("Champion", "", () => addLayers([T("{{Tournament!Top champion}}", 64, { name: "Champion" })]))),
    ...rlGroups(),
    ...(hudGroups.length ? hudGroups : [el("p", { class: "muted small" }, "Game HUDs show up here once one sends its data (Outputs › HUD link).")])];
}

// Rocket League (Outputs › Rocket League): the live match, and the last finished game for a post-game card.
// (the player lines, Blue 1 goals and so on, are in Pick live data on any text)
function rlGroups() {
  const t = (App.state.data || {}).tables || {};
  const tiles = n => (t[n] || []).slice(1).map(([f]) => f).filter(f => !/^(Blue|Orange) \d /.test(f))
    .map(f => tile(f, "", () => addLayers([T(`{{${n}!${f}}}`, /score$/.test(f) ? 96 : 40, { name: f })])));
  return [t["Rocket League"] ? group("Rocket League (live)", ...tiles("Rocket League")) : null,
    t["RL Last game"] ? group("Rocket League (last finished game)", ...tiles("RL Last game")) : null].filter(Boolean);
}

// One camera per caster box (Caster 1-4), placed above the box and moved / shown by the same live data,
// so the cameras follow the 1, 2, 3 or 4 caster layouts like the boxes do.
function casterCams() {
  const c = composer.comp;
  if (!c) return toast("Pick a graphic first");
  const made = [];
  for (let n = 1; n <= 4; n++) {
    const box = c.layers.filter(l => (l.move || "").includes(`Caster ${n} move`) && l.type === "image").sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (!box) continue;
    const w = box.w, h = Math.round(w * 9 / 16);
    made.push({ type: "camera", name: `Caster ${n} camera`, cam: `Caster ${n}`, x: box.x, y: box.y - h - 8, w, h, move: box.move, origin: box.origin || [box.x, box.y],
      show: box.show || `{{Global!Caster ${n} shown}}`, fx: { shadow: { x: 0, y: 8, blur: 24, color: "#000000" } } });
  }
  if (made.length) {
    addLayers(made, { keepPlace: true });
    return toast(`Added ${made.length} caster cameras on the caster boxes: name the cameras Caster 1-${made.length} on the Cameras page`);
  }
  // (no caster lower-third boxes: the design's own caster frames, named "caster", filled left to right)
  const frames = c.layers.filter(l => /caster/i.test(l.name || "") && l.type !== "text" && l.type !== "camera" && l.w >= 200 && l.h >= 150)
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (frames.length) {
    addLayers(frames.map((f, i) => ({ type: "camera", name: `Caster ${i + 1} camera`, cam: `Caster ${i + 1}`, x: f.x, y: f.y, w: f.w, h: f.h, fit: "cover", clip: f.clip || "" })), { keepPlace: true });
    return toast(`Put Caster 1-${frames.length} cameras in the ${frames.length} caster frames`);
  }
  // (nothing to go by: two cameras side by side to drag onto the design)
  addLayers([1, 2].map(n => ({ type: "camera", name: `Caster ${n} camera`, cam: `Caster ${n}`, x: n === 1 ? 120 : 1020, y: 200, w: 780, h: 439 })), { keepPlace: true });
  toast("No caster boxes in this graphic: added Caster 1 and 2 cameras to place on your design");
}

function framesTab() {
  const F = clip => () => addLayers([{ type: "image", name: clip + " frame", src: "", placeholder: "placeholders/player.png", fit: "cover", clip, w: 360, h: 360 }]);
  return [el("p", { class: "muted small" }, "A picture inside a shape: add a frame, then pick its picture (or a team logo / player photo from the data) on the right."),
    group("Frames", ...["circle", "rounded", "hexagon", "diamond", "shield", "parallelogram", "triangle", "star"].map(c => tile(c[0].toUpperCase() + c.slice(1), "", F(c))))];
}

function partsTab() {
  const ps = App.state.project.parts || [];
  return [el("p", { class: "muted small" }, "Make a name plate, a score box or a sponsor strip once, then use it in any graphic. Pick its layers and press Save as part (on the right). Change one copy and use Update the part: every copy changes."),
    ...(ps.length ? ps.map(p => el("div", { class: "gfx" }, el("span", { class: "bar-ind" }), el("div", {}, el("div", { class: "name" }, p.name), el("div", { class: "sub" }, `${p.layers.length} layers · ${Math.round(p.w)} × ${Math.round(p.h)}`)),
      el("div", { class: "row" },
        el("button", { class: "small primary", onclick: () => { const inst = "i" + Math.random().toString(36).slice(2, 10), x = Math.round((1920 - p.w) / 2), y = Math.round((1080 - p.h) / 2);
          addLayers(p.layers.map(l => ({ ...l, x: (l.x || 0) + x, y: (l.y || 0) + y, part: p.id, part_at: inst })), { keepPlace: true }); } }, "Add"),
        el("button", { class: "small ghost", onclick: async () => { const n = await askText("Name", p.name); if (n) api("/api/parts", { parts: ps.map(x => x.id === p.id ? { ...x, name: n } : x) }); } }, "Rename"),
        el("button", { class: "small ghost", "aria-label": "Delete part", onclick: async () => { if (await ask(`Delete the part "${p.name}"? Its copies stay as plain layers.`)) api("/api/parts", { parts: ps.filter(x => x.id !== p.id) }); } }, "✕"))))
      : [el("p", { class: "muted empty" }, "No parts yet.")])];
}

const TABS = [["graphics", "Graphics"], ["text", "Text"], ["shapes", "Shapes"], ["media", "Media"], ["live", "Live"], ["frames", "Frames"], ["parts", "Parts"]];
async function render() {
  $("#cmp-tabs").replaceChildren(...TABS.map(([k, n]) => el("button", { class: "small" + (tab === k ? " on" : ""), onclick: () => { tab = k; render(); } }, n)));
  const lib = tab !== "graphics";
  for (const p of document.querySelectorAll(".cmp-left > .panel")) p.hidden = lib;
  $("#cmp-lib").hidden = !lib;
  if (!lib) return;
  const body = await ({ text: textTab, shapes: shapesTab, media: mediaTab, live: liveTab, frames: framesTab, parts: partsTab })[tab]();
  $("#cmp-lib").replaceChildren(...body);
}
render();
App.on((st, msg) => { if (msg && (msg.project || msg.data) && (tab === "parts" || tab === "live")) render(); });
