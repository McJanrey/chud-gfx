// VALORANT (Outputs page): live data from any reader (Chud Hud, a screen reader, a person) into the "VALORANT"
// table, every finished map frozen as "VAL Map N", and a map win added to the series.
import { $, el, api, App, ask, toast, morph } from "./lib.js";

const STATE = { off: "Waiting for a reader", waiting: "Reader went quiet", on: "Reading" };

// Which of this PC's screens a game is on (for a screen reader): each screen by its size and place, and a live
// picture of the one picked so you can see the game is there. Any game's screen reader can use it.
let screens = null, screensAt = 0;
const where = (m, all) => {
  const main = all.find(x => x.main) || all[0];
  if (m.main) return "main screen";
  return m.x >= main.x + main.w ? "right of main" : m.x + m.w <= main.x ? "left of main" : m.y + m.h <= main.y ? "above main" : m.y >= main.y + main.h ? "below main" : "";
};
export function screenPicker(current, onPick) {
  const sel = el("select", { "aria-label": "Game screen", onchange: e => { onPick(+e.target.value); pic.src = `/api/screens/${e.target.value}.jpg?t=${Date.now()}`; } });
  const pic = el("img", { class: "screen-pic", alt: "What's on that screen now", src: `/api/screens/${current}.jpg?t=${Math.floor(Date.now() / 5000)}` });
  const fill = list => sel.replaceChildren(...list.map(m => el("option", { value: m.n, selected: m.n === current },
    `Screen ${m.n} · ${m.w}×${m.h}${where(m, list) ? " · " + where(m, list) : ""}`)));
  if (screens) fill(screens); else sel.appendChild(el("option", { value: current, selected: true }, `Screen ${current}`));
  if (!screens || Date.now() - screensAt > 30000) fetch("/api/screens").then(r => r.json()).then(list => { screens = list; screensAt = Date.now(); if (sel.isConnected || true) fill(list); }).catch(() => {});
  const again = el("button", { class: "small ghost", title: "Look at the screen again", onclick: () => { pic.src = `/api/screens/${sel.value}.jpg?t=${Date.now()}`; } }, "Refresh");
  return el("div", { class: "screen-picker" }, el("label", { class: "f" }, el("span", {}, "Game screen"), sel), pic, again);
}

export function valCard() {
  const v = App.state.val || { on: true, series: true, status: "off", maps: [] };
  const app = App.state.app || {}, host = (app.addresses || [])[0] || "127.0.0.1";
  return el("div", { class: "card", id: "val-card" },
    el("div", { class: "row" }, el("h3", {}, "VALORANT"),
      el("label", { class: "switch" }, el("input", { type: "checkbox", checked: v.on !== false, onchange: e => api("/api/val", { on: e.target.checked }) }), v.on !== false ? "On" : "Off"),
      el("span", { class: "pill" + (v.status === "on" ? " ok" : "") }, STATE[v.status] || v.status)),
    el("p", { class: "muted small" }, `A reader sends the match here as it changes (score, round, sides, spike, players). Chud Hud or a screen reader on the observer PC posts to http://${host}:${app.port || 7820}/api/val/ingest. The ready-made graphics (scorebug, round win, spike, timeout, tech pause, buy-phase scoreboard) appear in the HUD Builder as "VALORANT graphics" with the first data, each switched off until you turn it on.`),
    el("div", { class: "row" },
      el("label", { class: "switch" }, el("input", { type: "checkbox", checked: !!(v.reader || {}).on, onchange: e => api("/api/val/reader", { on: e.target.checked }) }), "Read this PC's screen"),
      screenPicker((v.reader || {}).screen || 1, n => api("/api/val/reader", { screen: n })),
      el("span", { class: "muted small" }, (v.reader || {}).on ? (v.reader.status || "") : "")),
    el("label", { class: "f" }, el("span", {}, "Send to a HUD"),
      el("select", { "aria-label": "Send to a HUD", onchange: e => api("/api/val", { target: e.target.value }) },
        ...[["owen", "SCC Broadcast Engine (VAL HUD, port 8778)"], ["chud", "Chud Hud (VALORANT HUD)"], ["off", "Off"]].map(([k, t]) => el("option", { value: k, selected: ((v.chud || {}).target || "owen") === k }, t))),
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
