// Shared by the VALORANT page's preview and the HUD Builder: the current map's art and the phase field sets.
import { App } from "./lib.js";

// The Show buttons: one phase of the HUD without a game (fields forced in this editor only, never on air).
// (each player's own show flags too: the tabs and the buy-phase board rows wait on them, not just the phase)
const each = (here, up, board) => Object.fromEntries(["Left", "Right"].flatMap(sd => [1, 2, 3, 4, 5].flatMap(n => [
  [`${sd} ${n} here`, here], [`${sd} ${n} up`, up], [`${sd} ${n} down`, ""], [`${sd} ${n} board`, board]])));
// (the round tracker's per-round fields are off outside the buy-phase board: a preview mid-buy shows no stray win icons)
const NOROUNDS = Object.fromEntries(Array.from({ length: 24 }, (_, i) => i + 1).flatMap(r => [[`Round ${r} left won`, ""], [`Round ${r} right won`, ""], [`Round ${r} now`, ""]]));
const TABS = { ...each("yes", "yes", ""), ...NOROUNDS }, BOARD = each("", "", "yes"), NONE = { ...each("", "", ""), ...NOROUNDS };
export const PHASES = {
  // (every preset sets all of the phase keys, so one phase never mixes with the live data's other states)
  VALORANT: [["Round in play", { "In round": "yes", "Names": "yes", "Condensed": "", "Top on": "yes", "Buy phase": "", "Planted": "", "Round won": "", "Select on": "", "Banner": "", ...TABS }],
    ["Top bar small", { "In round": "yes", "Names": "", "Condensed": "yes", "Top on": "yes", "Buy phase": "", "Planted": "", "Round won": "", "Select on": "", "Banner": "", ...TABS }],
    ["Spike planted", { "In round": "yes", "Names": "", "Condensed": "yes", "Top on": "yes", "Buy phase": "", "Planted": "yes", "Round won": "", "Select on": "", "Banner": "", ...TABS }],
    ["Buy phase", { "In round": "", "Names": "yes", "Condensed": "", "Top on": "yes", "Buy phase": "yes", "Planted": "", "Round won": "", "Select on": "", "Banner": "", ...BOARD }],
    ["Round win", { "In round": "", "Names": "yes", "Condensed": "", "Top on": "yes", "Buy phase": "", "Planted": "", "Round won": "yes", "Select on": "", "Banner": "ROUND WIN", ...TABS }],
    ["Agent select", { "In round": "", "Names": "", "Condensed": "", "Top on": "", "Buy phase": "", "Planted": "", "Round won": "", "Select on": "yes", "Banner": "", ...NONE }]],
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
