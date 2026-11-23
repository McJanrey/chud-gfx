// Shared by the VALORANT page's preview and the HUD Builder: the current map's art and the phase field sets.
import { App } from "./lib.js";

// The Show buttons: one phase of the HUD without a game (fields forced in this editor only, never on air).
// (each player's own show flags too: the tabs and the buy-phase board rows wait on them, not just the phase)
const each = (here, up, board) => Object.fromEntries(["Left", "Right"].flatMap(sd => [1, 2, 3, 4, 5].flatMap(n => [
  [`${sd} ${n} here`, here], [`${sd} ${n} up`, up], [`${sd} ${n} down`, ""], [`${sd} ${n} board`, board]])));
const TABS = each("yes", "yes", ""), BOARD = each("", "", "yes"), NONE = each("", "", "");
export const PHASES = {
  VALORANT: [["Round in play", { "In round": "yes", "Names": "yes", "Condensed": "", "Top on": "yes", "Buy phase": "", "Planted": "", "Round won": "", "Select on": "", ...TABS }],
    ["Top bar small", { "In round": "yes", "Names": "", "Condensed": "yes", "Top on": "yes", "Buy phase": "", "Planted": "", "Select on": "", ...TABS }],
    ["Spike planted", { "In round": "yes", "Names": "", "Condensed": "yes", "Top on": "yes", "Planted": "yes", "Buy phase": "", "Select on": "", ...TABS }],
    ["Buy phase", { "Buy phase": "yes", "In round": "", "Names": "yes", "Condensed": "", "Top on": "yes", "Planted": "", "Round won": "", "Select on": "", ...BOARD }],
    ["Round win", { "Round won": "yes", "Names": "yes", "Condensed": "", "Top on": "yes", "Planted": "", "Banner": "ROUND WIN", ...TABS }],
    ["Agent select", { "Select on": "yes", "Top on": "", "In round": "", "Buy phase": "", ...NONE }]],
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
