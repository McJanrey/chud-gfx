// The camera dock: every camera live, small, with whether it's connected. Shown on the Cameras page only, but it
// stays loaded on every page, so the status keeps coming in and the previews never reconnect.
// One preview per camera (it stays put while pages change, so it never reconnects). VDO.Ninja tells the page
// when the guest's picture arrives or drops (its IFRAME API "view-connection" message); the dock passes that to the
// engine so the Show check and the Stream Deck know too.
import { $, el, api, App } from "./lib.js";
import { viewUrl, styleCam } from "../engine/layers/camera.js";

const tiles = new Map();   // camera id -> {tile, frame, wash, dot, label, src, state, since}
let collapsed = false;
try { collapsed = localStorage.getItem("sg-camdock") === "min"; } catch (e) { /* */ }
const WORD = { live: "Live", waiting: "Waiting for the guest", lost: "Lost" };

function setState(t, id, state) {
  if (t.state === state) return;
  t.state = state;
  t.since = Date.now();
  t.tile.dataset.state = state;
  paint(t);
  count();
  api("/api/cams/status", { id, state }).catch(() => {});
}
function paint(t) {
  const secs = Math.round((Date.now() - t.since) / 1000);
  t.label.textContent = WORD[t.state] + (t.state === "lost" ? ` ${secs < 60 ? secs + " s" : Math.round(secs / 60) + " min"} ago` : "");
}

addEventListener("message", e => {
  if (!e.data || typeof e.data !== "object" || !("action" in e.data)) return;
  for (const [id, t] of tiles) {
    if (e.source !== t.frame.contentWindow) continue;
    if (e.data.action === "view-connection") setState(t, id, e.data.value ? "live" : "lost");
  }
});

function render() {
  const dock = $("#cam-dock");
  const P = App.state.project, cams = P.cams || [];
  dock.hidden = !cams.length || App.page !== "cams";
  dock.classList.toggle("min", collapsed);
  for (const [id, t] of tiles) if (!cams.some(c => c.id === id)) { t.tile.remove(); tiles.delete(id); }
  for (const c of cams) {
    let t = tiles.get(c.id);
    const src = viewUrl(c, P.cam_password, 500);
    if (t && t.src !== src) { t.tile.remove(); tiles.delete(c.id); t = null; }   // (a new link: a new preview)
    if (!t) {
      const frame = el("iframe", { allow: "autoplay", title: c.name }), wash = el("div");
      frame.src = src;
      const dot = el("span", { class: "dot" }), label = el("span", { class: "small" }), name = el("b", {});
      const tile = el("div", { class: "cam-mini", "data-state": "waiting" }, el("div", { class: "pic" }, frame, wash), el("div", { class: "cap" }, dot, name), label);
      t = { tile, frame, wash, dot, label, name, src, state: "waiting", since: Date.now() };
      tiles.set(c.id, t);
      $("#cam-tiles").append(tile);
      paint(t);
      // (no word from VDO.Ninja for a while: still waiting for the guest)
    }
    t.name.textContent = c.name;
    styleCam(t.frame, t.wash, c);
    frame_order(c, t);
  }
  count();
}
function count() { $("#cam-dock-count").textContent = `${[...tiles.values()].filter(t => t.state === "live").length} / ${tiles.size} live`; }
function frame_order(c, t) { t.tile.style.order = String((App.state.project.cams || []).findIndex(x => x.id === c.id)); }

$("#cam-dock-toggle").addEventListener("click", () => {
  collapsed = !collapsed;
  try { localStorage.setItem("sg-camdock", collapsed ? "min" : ""); } catch (e) { /* */ }
  render();
});
setInterval(() => { for (const t of tiles.values()) if (t.state === "lost") paint(t); }, 1000);
App.on((st, msg) => { if (!msg || msg.project) render(); });
document.addEventListener("click", e => { if (e.target.closest("#nav button[data-page]")) setTimeout(render, 0); });   // (show / hide with the page)
addEventListener("load", () => setTimeout(() => App.state && render(), 0));   // (opening straight onto the Cameras page)
