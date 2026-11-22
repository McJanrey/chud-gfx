// HUD Builder: a game's broadcast HUD, its own tool (not the Composer's list of graphics). A HUD has parts (top bar,
// player tabs, ...), each part layers drawn from live game data. The page is a gallery of HUDs by game; opening one
// edits a part with the Composer's own editor (canvas, rulers, snapping, Add library, every layer setting), the rest
// of the HUD dimmed behind it, and Show buttons to see each phase without a game. Nothing here goes on air but the
// HUD itself: every change saves at once and shows wherever its browser source is.
import { $, el, api, App, toast, pages, askText, ask } from "./lib.js";
import { composer } from "./composer.js";

let built = false, view = "list", hudId = null, partId = null, mode = "live", demo = false;
const GAMES = { valorant: "VALORANT", val: "VALORANT", lol: "League of Legends", league: "League of Legends", rl: "Rocket League", rocket: "Rocket League", other: "Other" };
const gameName = g => GAMES[String(g || "other").toLowerCase()] || g;
const huds = () => (App.state.project.huds || []);
const hud = () => huds().find(h => h.id === hudId);
const uid = () => Math.random().toString(16).slice(2, 10);
// The Show buttons: one phase of the HUD without a game (fields forced in this editor only, never on air).
const PHASES = {
  VALORANT: [["Round in play", { "In round": "yes", "Names": "yes", "Condensed": "", "Top on": "yes", "Buy phase": "", "Planted": "", "Round won": "", "Select on": "" }],
    ["Top bar small", { "In round": "yes", "Names": "", "Condensed": "yes", "Top on": "yes", "Buy phase": "", "Planted": "", "Select on": "" }],
    ["Spike planted", { "In round": "yes", "Names": "", "Condensed": "yes", "Top on": "yes", "Planted": "yes", "Buy phase": "", "Select on": "" }],
    ["Buy phase", { "Buy phase": "yes", "In round": "", "Names": "yes", "Top on": "yes", "Planted": "", "Select on": "" }],
    ["Round win", { "Round won": "yes", "Names": "yes", "Top on": "yes", "Banner": "ROUND WIN" }],
    ["Agent select", { "Select on": "yes", "Top on": "", "In round": "", "Buy phase": "" }]],
};

function build() {
  if (built) return; built = true;
  $("#page-hudbuilder").replaceChildren(
    el("div", { class: "hb-gallery", id: "hb-gallery" }),
    el("div", { class: "hb-edit", id: "hb-editor", hidden: true },
      el("div", { class: "hb-head", id: "hb-head" }),
      el("div", { class: "hb-show", id: "hb-show" }),
      el("div", { class: "hb-slot", id: "hb-slot" })));
}
function show(v) {
  view = v;
  $("#hb-gallery").hidden = v !== "list"; $("#hb-editor").hidden = v === "list";
  if (v === "list") { composer.leaveHud(); hudId = partId = null; drawGallery(); }
}

// --- the gallery -------------------------------------------------------------------------------------
function drawGallery() {
  const by = {};
  for (const h of huds()) (by[gameName(h.game)] = by[gameName(h.game)] || []).push(h);
  const tables = App.state.data.tables || {}, live = g => ((tables[g] || []).find(r => r[0] === "Status") || [])[1] === "on";
  $("#hb-gallery").replaceChildren(
    el("div", { class: "hb-gal-head" }, el("div", {}, el("h2", {}, "HUDs"),
      el("p", { class: "muted" }, "Each game's broadcast HUD. Open one to change it with the same tools as the Composer: move, resize, recolour, add text, shapes and pictures. Its live data keeps working while you edit.")),
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

// --- the editor --------------------------------------------------------------------------------------
function open(id, part) {
  const h = huds().find(x => x.id === id); if (!h) return;
  hudId = id; view = "edit";
  $("#hb-gallery").hidden = true; $("#hb-editor").hidden = false;
  if (!(PHASES[gameName(h.game)] || []).some(([n]) => n === mode) && mode !== "all") mode = "live";
  applyShow();
  editPart(part || (h.parts.find(p => p.on !== false) || h.parts[0] || {}).id);
  drawHead();
}
function editPart(id) {
  const h = hud(); if (!h || !id) return;
  partId = id;
  composer.editPart(hudId, id, $("#hb-slot"));
  drawParts();
}
function applyShow() {
  const h = hud(), ph = h && (PHASES[gameName(h.game)] || []).find(([n]) => n === mode);
  composer.setShow(mode === "all", ph ? { [gameName(h.game)]: ph[1] } : null);
}

function drawParts() {   // (the Composer's Graphics panel becomes this HUD's parts)
  const left = document.querySelector("#hb-slot .cmp-left"); if (!left) return;
  let panel = $("#hb-parts-panel");
  if (!panel) {
    panel = el("div", { class: "panel", id: "hb-parts-panel" },
      el("div", { class: "panel-head" }, el("h3", {}, "Parts"), el("button", { class: "small", onclick: newPart }, "+ Part")), el("div", { class: "list", id: "hb-parts" }));
    left.insertBefore(panel, left.querySelector(".panel:has(#cmp-layers)"));
  }
  const h = hud(); if (!h) return;
  $("#hb-parts").replaceChildren(...h.parts.map(p => el("div", { class: "gfx hb-part" + (p.id === partId ? " sel" : ""), onclick: () => editPart(p.id) },
    el("label", { class: "switch", title: p.on === false ? "Off: not in the HUD" : "On: in the HUD", onclick: e => e.stopPropagation() },
      el("input", { type: "checkbox", checked: p.on !== false, onchange: e => setPart(p.id, { on: e.target.checked }) })),
    el("div", {}, el("div", { class: "name" }, p.name), el("div", { class: "sub" }, `${p.layers.length} layers` + (p.on === false ? " · off" : ""))))));
}
async function setPart(id, change) {
  const h = JSON.parse(JSON.stringify(hud())), p = h.parts.find(x => x.id === id);
  Object.assign(p, change); await api("/api/hud", h);
}

function drawHead() {
  const h = hud(); if (!h) return;
  const url = `${location.origin}/hud/${h.id}`;
  const item = (txt, fn) => el("button", { onclick: e => { e.target.closest("details").open = false; fn(); } }, txt);
  $("#hb-head").replaceChildren(
    el("button", { class: "small ghost", onclick: () => show("list") }, "← All HUDs"),
    el("h3", {}, h.name), el("span", { class: "muted small" }, gameName(h.game)),
    el("span", { class: "spacer" }),
    el("span", { class: "muted small" }, "Saves by itself · on air at once"),
    el("button", { class: "small", onclick: () => navigator.clipboard.writeText(url).then(() => toast("Browser source link copied")) }, "Copy OBS link"),
    el("details", { class: "menu hb-menu" }, el("summary", { class: "small" }, "More"), el("div", { class: "menu-list" },
      item("Open the HUD", () => window.open(`/hud/${h.id}`, "_blank")),
      item("Control page", () => window.open(`/hud/${h.id}/control`, "_blank")),
      el("label", { class: "btn", title: "A Figma file (File > Save local copy): each frame becomes a part" }, "Import Figma…", el("input", { type: "file", accept: ".fig", hidden: true, onchange: figma })),
      item("Rename HUD", renameHud),
      item("Rename part", renamePart),
      item("Delete part", deletePart),
      h.key ? item("Reset to built-in", rebuildHud) : "",
      item("Delete HUD", deleteHud))));
  const chip = (k, n) => el("button", { class: "small" + (mode === k ? " on" : ""), onclick: () => { mode = k; applyShow(); drawHead(); } }, n);
  const g = gameName(h.game);
  $("#hb-show").replaceChildren(el("span", { class: "muted small" }, "Show:"), chip("live", "Live"), chip("all", "Everything"), ...(PHASES[g] || []).map(([n]) => chip(n, n)),
    g === "VALORANT" ? el("button", { class: "small ghost", title: "A made-up match, so names, money and guns show without a game", onclick: () => api("/api/val/demo", { on: !demo }).then(r => { demo = r.on; toast(r.on ? "Sample match on" : "Sample match off"); drawHead(); }) }, demo ? "Stop sample match" : "Sample match") : "");
}

// --- HUD and part actions ----------------------------------------------------------------------------
async function newHud() {
  const name = await askText("Name of the new HUD", "New HUD"); if (!name) return;
  const r = await api("/api/hud", { name, game: "other", parts: [{ id: uid(), name: "Main", on: true, layers: [] }] });
  setTimeout(() => open(r.hud.id), 200);
}
async function newPart() {
  const name = await askText("Name of the new part", "New part"); if (!name) return;
  const h = JSON.parse(JSON.stringify(hud())), p = { id: uid(), name, on: true, layers: [] };
  h.parts.push(p); await api("/api/hud", h); setTimeout(() => editPart(p.id), 200);
}
async function renameHud() { const h = hud(), n = await askText("HUD name", h.name); if (!n) return; await api("/api/hud", { ...JSON.parse(JSON.stringify(h)), name: n }); }
async function renamePart() {
  const p = hud().parts.find(x => x.id === partId); if (!p) return;
  const n = await askText("Part name", p.name); if (n) { await setPart(p.id, { name: n }); setTimeout(() => editPart(p.id), 200); }
}
async function deletePart() {
  const h = JSON.parse(JSON.stringify(hud())), p = h.parts.find(x => x.id === partId); if (!p) return;
  if (!(await ask(`Delete the part "${p.name}"?`, `Its ${p.layers.length} layers go too. The HUD's earlier versions are kept, so it can come back with Reset or Versions.`))) return;
  h.parts = h.parts.filter(x => x.id !== p.id); await api("/api/hud", h);
  setTimeout(() => open(h.id), 200);
}
async function rebuildHud() {
  const h = hud();
  if (!(await ask(`Reset "${h.name}" to the built-in look?`, "Your changes to its layers are replaced by the latest built-in version. The current one is kept in the workspace's bin. Which parts are shown stays as it is."))) return;
  await api("/api/hud/rebuild", { id: h.id }); toast("Reset to the built-in look"); setTimeout(() => open(h.id), 300);
}
async function deleteHud() {
  const h = hud();
  if (!(await ask(`Delete "${h.name}"?`, "It's put aside in the workspace's bin, not deleted for good."))) return;
  await api("/api/hud/delete", { id: h.id }); show("list");
}
async function figma(e) {
  const f = e.target.files[0]; e.target.value = ""; const h = hud(); if (!f || !h) return;
  toast("Reading the Figma file…");
  const r = await fetch(`/api/hud/figma?hud=${encodeURIComponent(h.id)}&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return toast(j.error || "Couldn't read that Figma file");
  toast(`${j.parts} part${j.parts === 1 ? "" : "s"} added from Figma (${j.layers} layers)`);
  setTimeout(() => open(h.id), 300);
}

// --- the page ----------------------------------------------------------------------------------------
pages.hudbuilder = { shown() { build(); if (view === "edit" && hud()) open(hudId, partId); else show("list"); } };
let sig = "";
App.on(st => {
  if (App.page !== "hudbuilder" || !built) return;
  const s = JSON.stringify((st.project.huds || []).map(h => [h.id, h.name, h.key, h.parts.map(p => [p.id, p.name, p.on, p.layers.length])]));
  if (s === sig) return; sig = s;
  if (view === "list") return drawGallery();
  if (!hud()) return show("list");
  if (!hud().parts.some(p => p.id === partId)) return open(hudId);
  drawParts(); drawHead();
});
