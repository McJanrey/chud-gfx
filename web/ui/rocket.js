// Rocket League (Outputs page): the game's own Stats API, live into the "Rocket League" table, and every
// finished game frozen as "RL Game N" so a player who quits straight away keeps their final line.
import { $, el, api, App, ask, toast, typingIn } from "./lib.js";

const STATE = { off: "Off", waiting: "Waiting for the game", on: "Reading" };
const SIDE = ["Blue", "Orange"];

export function rlCard() {
  const r = App.state.rl || { on: true, port: 49123, series: true, status: "off", games: [] };
  const port = el("input", { type: "number", value: r.port || 49123, "aria-label": "Port", onchange: e => api("/api/rl", { port: +e.target.value || 49123 }) });
  return el("div", { class: "card", id: "rl-card" },
    el("div", { class: "row" }, el("h3", {}, "Rocket League"),
      el("label", { class: "switch" }, el("input", { type: "checkbox", checked: r.on !== false, onchange: e => api("/api/rl", { on: e.target.checked }) }), r.on !== false ? "On" : "Off"),
      el("span", { class: "pill" + (r.status === "on" ? " ok" : "") }, STATE[r.status] || r.status)),
    el("p", { class: "obs-status " + (r.status === "on" ? "on" : "off") }, r.detail || "Off: turn it on to read the game"),
    el("p", { class: "muted small" }, "In the game's folder, open TAGame\\Config\\TAStatsAPI.ini (or DefaultStatsAPI.ini) and under [TAGame.MatchStatsExporter_TA] set PacketSendRate=30 and Port=49123. Save, then start Rocket League. Pick fields from the \"Rocket League\" table in Composer."),
    el("div", { class: "three" },
      el("label", { class: "f" }, el("span", {}, "Port"), port),
      el("label", { class: "f" }, el("span", {}, "Series score"),
        el("label", { class: "switch" }, el("input", { type: "checkbox", checked: r.series !== false, onchange: e => api("/api/rl", { series: e.target.checked }) }), "A win adds 1 (Blue = left, Orange = right)"))),
    el("h4", {}, "Finished games"),
    el("p", { class: "muted small" }, "Saved the moment each game ends, as tables RL Game 1, RL Game 2… and RL Last game. Save now if a game never ends properly (a forfeit, someone leaving)."),
    ...(r.games || []).map(g => el("div", { class: "row" },
      el("span", {}, `RL Game ${g.n}`), el("span", { class: "muted small" }, `${g.score[0] ?? 0} : ${g.score[1] ?? 0}`),
      el("span", { class: "muted small" }, g.winner === 0 || g.winner === 1 ? `${SIDE[g.winner]} won` : "no winner"),
      g.why === "manual" ? el("span", { class: "muted small" }, "saved by hand") : "")),
    (r.games || []).length ? "" : el("p", { class: "muted small" }, "None yet."),
    el("div", { class: "row" },
      el("button", { class: "small primary", onclick: () => api("/api/rl/save", {}).then(x => x && x.game && toast(`Saved as RL Game ${x.game}`)) }, "Save now"),
      (r.games || []).length ? el("button", { class: "small", onclick: async () => { if (await ask(`Start a new series? The ${r.games.length} saved games are put aside in a file in the workspace, not deleted.`)) api("/api/rl/clear", {}).then(() => toast("New series: saved games put aside")); } }, "New series") : ""));
}

let sig = "";
App.on((st, msg) => {
  if (msg && !msg.rl) return;
  const s = JSON.stringify(st.rl);
  if (App.page === "outputs" && s !== sig) { const c = $("#rl-card"); if (c && !typingIn(c)) { sig = s; c.replaceWith(rlCard()); } }
});
