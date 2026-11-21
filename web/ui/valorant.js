// VALORANT (Outputs page): live data from any reader (Chud Hud, a screen reader, a person) into the "VALORANT"
// table, every finished map frozen as "VAL Map N", and a map win added to the series.
import { $, el, api, App, ask, toast, morph } from "./lib.js";

const STATE = { off: "Waiting for a reader", waiting: "Reader went quiet", on: "Reading" };

export function valCard() {
  const v = App.state.val || { on: true, series: true, status: "off", maps: [] };
  const app = App.state.app || {}, host = (app.addresses || [])[0] || "127.0.0.1";
  return el("div", { class: "card", id: "val-card" },
    el("div", { class: "row" }, el("h3", {}, "VALORANT"),
      el("label", { class: "switch" }, el("input", { type: "checkbox", checked: v.on !== false, onchange: e => api("/api/val", { on: e.target.checked }) }), v.on !== false ? "On" : "Off"),
      el("span", { class: "pill" + (v.status === "on" ? " ok" : "") }, STATE[v.status] || v.status)),
    el("p", { class: "muted small" }, `A reader sends the match here as it changes (score, round, sides, spike, players). Chud Hud or a screen reader on the observer PC posts to http://${host}:${app.port || 7820}/api/val/ingest. The ready-made graphics (scorebug, round win, spike, timeout, tech pause, buy-phase scoreboard) appear under Game HUD with the first data.`),
    el("div", { class: "row" },
      el("label", { class: "switch" }, el("input", { type: "checkbox", checked: !!(v.reader || {}).on, onchange: e => api("/api/val/reader", { on: e.target.checked }) }), "Read this PC's screen"),
      el("label", { class: "f" }, el("span", {}, "Screen"), el("input", { type: "number", min: 1, value: (v.reader || {}).screen || 1, "aria-label": "Screen number", onchange: e => api("/api/val/reader", { screen: +e.target.value || 1 }) })),
      el("span", { class: "muted small" }, (v.reader || {}).on ? (v.reader.status || "") : "")),
    el("label", { class: "f" }, el("span", {}, "Send to a HUD"),
      el("select", { "aria-label": "Send to a HUD", onchange: e => api("/api/val", { target: e.target.value }) },
        ...[["chud", "Chud Hud (VALORANT HUD)"], ["owen", "SCC Broadcast Engine (VAL HUD, port 8778)"], ["off", "Off"]].map(([k, t]) => el("option", { value: k, selected: ((v.chud || {}).target || "chud") === k }, t))),
      el("span", { class: "muted small" }, v.chud && v.chud.target !== "off" ? (v.chud.ok ? "Sending" : "Not reachable: is that HUD open?") : "")),
    el("div", { class: "row" },
      el("button", { class: "small", onclick: () => api("/api/val/demo", { on: !v.demo }) }, v.demo ? "Stop demo match" : "Demo match"),
      el("a", { class: "button small", href: "/val-live.html", target: "_blank" }, "Open reader check")),
    el("label", { class: "f" }, el("span", {}, "Series score"),
      el("label", { class: "switch" }, el("input", { type: "checkbox", checked: v.series !== false, onchange: e => api("/api/val", { series: e.target.checked }) }), "A map win adds 1 (first team = left)")),
    el("h4", {}, "Finished maps"),
    ...(v.maps || []).map(m => el("div", { class: "row" }, el("span", {}, `VAL Map ${m.n}${m.map ? " · " + m.map : ""}`),
      el("span", { class: "muted small" }, `${m.score[0] ?? 0} : ${m.score[1] ?? 0}`))),
    (v.maps || []).length ? "" : el("p", { class: "muted small" }, "None yet."),
    (v.maps || []).length ? el("div", { class: "row" }, el("button", { class: "small", onclick: async () => { if (await ask(`Start a new series? The ${v.maps.length} saved maps are put aside in a file in the workspace, not deleted.`)) api("/api/val/clear", {}).then(() => toast("New series: saved maps put aside")); } }, "New series")) : "");
}

let sig = "";
App.on((st, msg) => {
  if (msg && !msg.val) return;
  const s = JSON.stringify(st.val);
  if (App.page === "outputs" && s !== sig) { const c = $("#val-card"); if (c) { sig = s; morph(c, valCard()); } }
});
