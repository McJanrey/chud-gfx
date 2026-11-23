// VALORANT (Outputs page): live data from any reader (Chud Hud, a screen reader, a person) into the "VALORANT"
// table, every finished map frozen as "VAL Map N", and a map win added to the series.
import { $, el, api, App, ask, toast, morph } from "./lib.js";

const STATE = { off: "Waiting for a reader", waiting: "Reader went quiet", on: "Reading" };

// Outputs: the browser-source links (copy into OBS / vMix as 1920x1080 browser sources) and the data source.
export function outputs(app) {
  const base = `http://127.0.0.1:${app.port || location.port}`;
  const row = (label, url) => el("label", { class: "f" }, el("span", {}, label),
    el("div", { class: "row" }, el("input", { readonly: true, value: url, class: "mono", onclick: e => e.target.select() }),
      el("button", { class: "small", onclick: () => navigator.clipboard.writeText(url).then(() => toast("Link copied")) }, "Copy")));
  return [row("HUD overlay (OBS / vMix browser source, 1920x1080)", `${base}/hud/val27`),
    row("Scoreboard overlay (shows itself in the buy phase)", `${base}/output?hud=val27&part=owboard`),
    row("vMix data source (CSV; also .json)", `${base}/data/VALORANT.csv`)];
}

// Which window or screen the game is on, for the screen reader (Owen's "Game window"): find VALORANT by itself, one
// window captured like OBS's Window Capture (covered or not), or a whole screen; with a picture of what it reads.
let wins = null, screens = null;
const where = (m, all) => {
  const main = all.find(x => x.main) || all[0];
  if (m.main) return "main screen";
  return m.x >= main.x + main.w ? "right of main" : m.x + m.w <= main.x ? "left of main" : m.y + m.h <= main.y ? "above main" : m.y >= main.y + main.h ? "below main" : "";
};
export function sourcePicker(cur, onPick) {
  const key = s => s.kind === "auto" ? "auto" : s.kind === "screen" ? `screen:${s.n}` : `window:${s.exe}|${s.title}`;
  const sel = el("select", { "aria-label": "Game window", onchange: e => {
    const o = e.target.selectedOptions[0];
    onPick(JSON.parse(o.dataset.src));
    setTimeout(look, 600);
  } });
  // (nothing to show, e.g. the game isn't open: an empty box, not a broken picture)
  const pic = el("img", { class: "screen-pic", alt: "", onerror: e => { e.target.style.visibility = "hidden"; }, onload: e => { e.target.style.visibility = ""; } });
  const look = () => { pic.src = `/api/val/reader/frame.jpg?t=${Date.now()}`; };
  const fill = () => {
    const opts = [["Find VALORANT by itself (any screen)", { kind: "auto" }]];
    for (const w of wins || []) opts.push([`${w.title}  ·  ${w.exe}${w.minimised ? "  (minimised)" : ""}`, { kind: "window", exe: w.exe, title: w.title }]);
    for (const m of screens || []) opts.push([`Whole screen ${m.n} · ${m.w}x${m.h}${where(m, screens) ? " · " + where(m, screens) : ""}`, { kind: "screen", n: m.n }]);
    if (!opts.some(([, s]) => key(s) === key(cur))) opts.splice(1, 0, [cur.kind === "window" ? `${cur.title} · ${cur.exe} (not open)` : `Whole screen ${cur.n}`, cur]);
    sel.replaceChildren(...opts.map(([t, s]) => el("option", { value: key(s), "data-src": JSON.stringify(s), selected: key(s) === key(cur) }, t)));
  };
  const load = () => Promise.all([fetch("/api/windows").then(r => r.json()).catch(() => []), fetch("/api/screens").then(r => r.json()).catch(() => [])])
    .then(([w, sc]) => { wins = w; screens = sc; fill(); });
  fill();
  if (!wins) load();
  look();
  return el("div", { class: "screen-picker" },
    el("label", { class: "f grow" }, el("span", {}, "Game window"), sel),
    el("button", { class: "small", onclick: () => { load(); look(); } }, "Refresh list"),
    pic);
}

export function valCard() {
  const v = App.state.val || { on: true, series: true, status: "off", maps: [] };
  const app = App.state.app || {}, host = (app.addresses || [])[0] || "127.0.0.1";
  return el("div", { class: "card", id: "val-card" },
    el("div", { class: "row" }, el("h3", {}, "VALORANT"),
      el("label", { class: "switch" }, el("input", { type: "checkbox", checked: v.on !== false, onchange: e => api("/api/val", { on: e.target.checked }) }), v.on !== false ? "On" : "Off"),
      el("span", { class: "pill" + (v.status === "on" ? " ok" : "") }, STATE[v.status] || v.status)),
    el("p", { class: "muted small" }, `A reader sends the match here as it changes (score, round, sides, spike, players). Chud Hud or a screen reader on the observer PC posts to http://${host}:${app.port || 7820}/api/val/ingest. The ready-made graphics (scorebug, round win, spike, timeout, tech pause, buy-phase scoreboard) appear in the HUD Builder as "VALORANT graphics" with the first data, each switched off until you turn it on.`),
    el("h4", {}, "Outputs"),
    ...outputs(app),
    el("h4", {}, "Live data"),
    el("button", { class: "big-toggle" + ((v.reader || {}).on ? " on" : ""), onclick: () => api("/api/val/reader", { on: !(v.reader || {}).on }) },
      (v.reader || {}).on ? "Reading VALORANT on this PC (click to stop)" : "Read VALORANT on this PC"),
    el("p", { class: "muted small" }, (v.reader || {}).on ? (v.reader.status || "Starting...") : "Off. Turn on when VALORANT (spectating or a replay) runs on this PC."),
    sourcePicker((v.reader || {}).source || { kind: "auto" }, src => api("/api/val/reader", { source: src })),
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
