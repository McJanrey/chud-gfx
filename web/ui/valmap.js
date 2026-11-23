// Shared by the VALORANT page's preview and the HUD Builder: the current map's art and the phase field sets.
import { App } from "./lib.js";

// The Show buttons: one phase of the HUD without a game (fields forced in this editor only, never on air).
export const PHASES = {
  VALORANT: [["Round in play", { "In round": "yes", "Names": "yes", "Condensed": "", "Top on": "yes", "Buy phase": "", "Planted": "", "Round won": "", "Select on": "" }],
    ["Top bar small", { "In round": "yes", "Names": "", "Condensed": "yes", "Top on": "yes", "Buy phase": "", "Planted": "", "Select on": "" }],
    ["Spike planted", { "In round": "yes", "Names": "", "Condensed": "yes", "Top on": "yes", "Planted": "yes", "Buy phase": "", "Select on": "" }],
    ["Buy phase", { "Buy phase": "yes", "In round": "", "Names": "yes", "Condensed": "", "Top on": "yes", "Planted": "", "Round won": "", "Select on": "" }],
    ["Round win", { "Round won": "yes", "Names": "yes", "Condensed": "", "Top on": "yes", "Planted": "", "Banner": "ROUND WIN" }],
    ["Agent select", { "Select on": "yes", "Top on": "", "In round": "", "Buy phase": "" }]],
};


let cat = null;
const catalog = () => cat || (cat = fetch("/api/val/catalog").then(r => r.json()).catch(() => ({ maps: [] })));   // (once)
export const curMap = () => (((App.state.val || {}).match || {}).map) || (((App.state.data || {}).tables || {}).VALORANT || []).map(r => r[0] === "Map" ? r[1] : "").find(Boolean) || "";
// The map's splash picture as a URL, else Ascent's, else "" (the caller shows a dark gradient).
export async function mapArt(name) {
  const maps = ((await catalog()).maps || []), low = s => String(s || "").toLowerCase();
  const m = maps.find(x => low(x.name) === low(name)) || maps.find(x => low(x.name) === "ascent");
  return m ? `/val-img/map/${m.id}/splash.png` : "";
}
