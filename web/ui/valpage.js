// The VALORANT page: header (map, phase, live feed / demo, clock) and five sections, all on data the app already has:
// the VALORANT module (App.state.val), Global's teams and series, the "VALORANT graphics" HUD.
import { $, el, api, App, pages, toast, morphKids, typingIn } from "./lib.js";
import { outputs, sourcePicker } from "./valorant.js";
import { PHASES, curMap, mapArt } from "./valmap.js";

const TABS = [["overview", "Overview"], ["players", "Players and teams"], ["tournament", "Tournament"], ["live", "Live game"], ["select", "Agent select"]];
let tab = "overview", cat = null, sig = "";
try { tab = localStorage.getItem("sg-val-tab") || tab; } catch (e) { /* private window */ }
const V = () => App.state.val || { on: true, maps: [], match: {} };
const M = () => V().match || {};
const G = () => App.state.project.global || {};
const gsave = change => api("/api/global", { global: change });
const ingest = body => api("/api/val/ingest", body);
const card = (title, ...kids) => el("section", { class: "card" }, el("h3", {}, title), ...kids);
const SIDES = ["left", "right"];
const tri = (s, i) => (G()[s] || {}).short || (G()[s] || {}).name || (i ? "Right" : "Left");
const field = (label, input) => el("label", { class: "f" }, el("span", {}, label), input);

// --- header -------------------------------------------------------------------
function head() {
  const v = V(), m = M(), demo = !!v.demo;
  return el("div", { class: "val-head" },
    el("b", {}, `${m.map || "No map yet"} · ${m.phase || "waiting"}`),
    el("div", { class: "seg", role: "group", "aria-label": "Data source" },
      el("button", { class: demo ? "" : "on", onclick: () => demo && api("/api/val/demo", { on: false }) }, "Live feed"),
      el("button", { class: demo ? "on" : "", onclick: () => !demo && api("/api/val/demo", { on: true }) }, "Demo match")),
    el("span", { class: "pill" + (v.status === "on" ? " ok" : "") }, v.on === false ? "VALORANT off" : v.status === "on" ? "Receiving" : "Waiting for data"),
    el("span", { class: "spacer" }),
    el("span", { class: "mono val-clock" }, `R${m.round || 1} ${m.timer || "-:--"}`));
}

// --- live data (kept as one node: its picture of the game window must not reload on every update) -------------
let liveNode = null, liveKey = "", liveText = null;
function liveCard() {
  const v = V(), r = v.reader || {}, key = JSON.stringify([r.on, r.source]);
  if (!liveNode || key !== liveKey) {
    liveKey = key;
    liveText = el("p", { class: "muted small" });
    liveNode = card("Live data",
      el("button", { class: "val-big" + (r.on ? " on" : ""), onclick: () => api("/api/val/reader", { on: !r.on }) }, r.on ? "Reading VALORANT on this PC (click to stop)" : "Read VALORANT on this PC"),
      el("p", { class: "muted small", id: "val-reader-status" }, r.on ? (r.status || "Starting...") : "Off. Turn on when VALORANT (spectating or a replay) runs on this PC."),
      sourcePicker(r.source || { kind: "auto" }, src => api("/api/val/reader", { source: src })),
      liveText);
  }
  const n = v.updates || 0;
  liveText.textContent = n ? `${n} updates received; last ${v.ago ?? 0}s ago${v.source ? "; from " + v.source : ""}` : "No updates received yet.";
  const st = liveNode.querySelector("#val-reader-status");
  if (st && r.on) st.textContent = r.status || "Starting...";
  return liveNode;
}

// --- overview -----------------------------------------------------------------
function overview() {
  const app = App.state.app || {};
  return [previewCard("overview"), card("Outputs", ...outputs(app),
      el("p", { class: "muted small" }, `From another PC, use this PC's network address instead of 127.0.0.1${(app.addresses || [])[0] ? ` (for example http://${app.addresses[0]}:${app.port || location.port}/hud/val27)` : ""}.`)),
    liveCard()];
}

// --- players and teams ----------------------------------------------------------
function teamBox(side, i) {
  const t = G()[side] || {}, set = (k, v) => gsave({ [side]: { [k]: v } });
  const col = t.color || (i ? "#ff4f5e" : "#21c7b0");
  return el("section", { class: `card val-team ${side}`, style: `--team:${col}` },
    el("div", { class: "row" }, t.logo ? el("img", { class: "val-logo", src: t.logo.split("/").map(encodeURIComponent).join("/"), alt: "" }) : el("span", { class: "val-logo none" }),
      el("div", { class: "grow" }, el("b", {}, i ? "Right team" : "Left team"))),
    el("div", { class: "two" },
      field("Tricode", el("input", { value: t.short || "", maxlength: 5, onchange: e => set("short", e.target.value) })),
      field("Team name", el("input", { value: t.name || "", onchange: e => set("name", e.target.value) }))),
    el("div", { class: "row" }, el("span", {}, "Series wins"), el("span", { class: "spacer" }),
      el("button", { class: "small", "aria-label": "One less", onclick: () => set("score", Math.max(0, (+t.score || 0) - 1)) }, "-"),
      el("b", { class: "val-num" }, String(+t.score || 0)),
      el("button", { class: "small", "aria-label": "One more", onclick: () => set("score", (+t.score || 0) + 1) }, "+")));
}
function swap() {   // (the same swap as Global's)
  const g = G(), keys = [...new Set([...Object.keys(g.left || {}), ...Object.keys(g.right || {})])];
  const pick = t => Object.fromEntries(keys.map(k => [k, (t || {})[k] ?? ""]));
  gsave({ left: pick(g.right), right: pick(g.left) });
}
function playerRow(side, i, n) {
  const m = M(), p = (m.players || []).find(x => x.team === i && x.slot === n) || {}, names = (V().names || {})[side] || [];
  const stats = p.name || p.read_name || p.agent_id ? `${p.health ?? "-"} HP · ¤${p.credits ?? 0} · ${p.kills ?? 0}/${p.deaths ?? 0}/${p.assists ?? 0}` : "Not read yet";
  const put = v => { const all = { left: [...((V().names || {}).left || [])], right: [...((V().names || {}).right || [])] }; all[side][n - 1] = v.trim(); api("/api/val", { names: all }); };
  return el("div", { class: "val-player" + (p.alive === false ? " dead" : "") },
    p.agent_id ? el("img", { class: "val-agent", src: `/val-img/agent/${p.agent_id}/displayicon.png`, alt: "" }) : el("span", { class: "val-agent none" }),
    el("div", { class: "grow" },
      el("input", { value: names[n - 1] || "", placeholder: p.read_name || `${tri(side, i)} player ${n}`, "aria-label": `${side} player ${n} name`, onchange: e => put(e.target.value) }),
      el("span", { class: "muted small" }, stats)));
}
function players() {
  return [el("div", { class: "val-teams" }, teamBox("left", 0), teamBox("right", 1)),
    el("div", { class: "row" }, el("button", { class: "small", onclick: swap }, "Swap sides"),
      el("span", { class: "muted small" }, "Swaps the two teams, their series wins included (same as Global).")),
    card("Players", el("p", { class: "muted small" }, "Names come from the game. Type a name to override it; leave it blank to use the game's."),
      el("div", { class: "val-teams" }, ...SIDES.map((s, i) => el("div", { class: `val-col ${s}` }, el("h4", {}, tri(s, i)), ...[1, 2, 3, 4, 5].map(n => playerRow(s, i, n))))))];
}

// --- tournament ---------------------------------------------------------------
function tournament() {
  const g = G(), best = +g.best_of || 3, plan = (V().plan || []).slice(), m = M();
  const maps = ((cat || {}).maps || []).map(x => x.name);
  const put = list => api("/api/val", { plan: list });
  const rows = Array.from({ length: best }, (_, k) => {
    const row = plan[k] || { map: "", result: "" }, opts = maps.includes(row.map) || !row.map ? maps : [row.map, ...maps];
    const edit = change => { const list = Array.from({ length: best }, (_, j) => plan[j] || { map: "", result: "" }); list[k] = { ...list[k], ...change }; put(list); };
    return el("div", { class: "row val-map" }, el("b", {}, `Map ${k + 1}`),
      el("select", { "aria-label": `Map ${k + 1}`, onchange: e => edit({ map: e.target.value }) }, el("option", { value: "" }, "Pick a map"), ...opts.map(n => el("option", { value: n, selected: n === row.map }, n))),
      el("select", { "aria-label": `Map ${k + 1} result`, onchange: e => edit({ result: e.target.value }) },
        el("option", { value: "" }, "Not played yet"), ...SIDES.map((s, i) => el("option", { value: s, selected: row.result === s }, `Won by ${tri(s, i)}`))));
  });
  return [card("Series and maps",
      el("div", { class: "two" },
        field("Best of", el("select", { onchange: e => gsave({ best_of: +e.target.value }) }, ...[1, 3, 5].map(n => el("option", { value: n, selected: best === n }, String(n))))),
        field("Attacks first (round 1)", el("select", { onchange: e => ingest({ first_attack: +e.target.value }) }, ...SIDES.map((s, i) => el("option", { value: i, selected: (m.first_attack || 0) === i }, tri(s, i)))))),
      ...rows),
    card("Finished maps", ...((V().maps || []).length ? V().maps.map(x => el("div", { class: "row" }, el("span", {}, `VAL Map ${x.n}${x.map ? " · " + x.map : ""}`), el("span", { class: "spacer" }),
      el("span", { class: "muted small" }, `${x.score[0] ?? 0} : ${x.score[1] ?? 0}`))) : [el("p", { class: "muted small" }, "None yet. A finished map is saved here and adds a win to the series.")]))];
}

// --- live game ----------------------------------------------------------------
const sectionsEl = el("div", { class: "val-sections" });
sectionsEl._whole = true;
let preview = null, previewIn = "", bgImg = null, bgFor = null, pframe = null, phase = "Live", phaseBtns = [];
// One preview per section that shows it (Overview or Live game): built fresh when the section changes, kept while it stays,
// so only the shown section has an iframe and it doesn't reload on every update (a reused node got mangled by morph).
function previewCard(section) {
  if (preview && previewIn !== section) preview = null;
  if (!preview) {
    previewIn = section; bgFor = null;
    pframe = el("iframe", { src: "/hud/val27", title: "VALORANT HUD preview", tabindex: "-1" });
    bgImg = el("img", { class: "val-pbg", alt: "" });
    const box = el("div", { class: "val-preview" }, bgImg, pframe);
    new ResizeObserver(() => { pframe.style.transform = `scale(${box.clientWidth / 1920})`; }).observe(box);
    const pick = n => {   // ("Live" = the real feed, no force; the rest force one phase's fields)
      phase = n; phaseBtns.forEach(([k, b]) => b.classList.toggle("on", k === n));
      const f = (PHASES.VALORANT.find(([k]) => k === n) || [])[1];
      pframe.src = "/hud/val27" + (f ? "?force=" + encodeURIComponent(JSON.stringify({ VALORANT: f })) : "");
    };
    const names = ["Live", "Buy phase", "Round in play", "Top bar small", "Spike planted", "Round win"];
    phaseBtns = names.map(n => [n, el("button", { class: n === phase ? "on" : "", onclick: () => pick(n) }, n)]);
    preview = card("Preview", box, el("div", { class: "seg val-phases", role: "group", "aria-label": "Preview state" }, ...phaseBtns.map(b => b[1])),
      el("a", { class: "btn small", href: "/hud/val27", target: "_blank" }, "Open the HUD"));
    preview._whole = true;   // (the same card every render: morph leaves it alone, or swaps it in or out whole; re-wrapping its nodes moved the iframe and reloaded it)
  }
  const name = curMap();
  if (name !== bgFor) {   // (art follows the map; no map yet = Ascent, else a dark gradient)
    bgFor = name;
    mapArt(name).then(u => { if (bgFor === name) { bgImg.hidden = !u; if (u) bgImg.src = u; } });
  }
  return preview;
}
function broadcast() {
  const m = M(), to = (m.teams || []).map(t => +t.timeouts || 0), hud = (App.state.project.huds || []).find(h => h.id === "val");
  const setTo = (i, n) => ingest({ teams: i ? [{}, { timeouts: Math.max(0, n) }] : [{ timeouts: Math.max(0, n) }, {}] });
  const flip = id => api("/api/hud", { ...hud, parts: hud.parts.map(p => p.id === id ? { ...p, on: !p.on } : p) });
  const callTimeout = i => { setTo(i, to[i] - 1); ingest({ banner: `TACTICAL TIMEOUT · ${tri(SIDES[i], i)}`, banner_side: i }); };
  return card("Broadcast",
    el("h4", {}, "Timeouts left"),
    ...SIDES.map((s, i) => el("div", { class: "row" }, el("span", {}, tri(s, i)), el("span", { class: "spacer" }),
      el("button", { class: "small", "aria-label": `${tri(s, i)} one less`, onclick: () => setTo(i, to[i] - 1) }, "-"), el("b", { class: "val-num" }, String(to[i] ?? 0)),
      el("button", { class: "small", "aria-label": `${tri(s, i)} one more`, onclick: () => setTo(i, to[i] + 1) }, "+"))),
    el("h4", {}, "Banner under the top bar"),
    el("div", { class: "row wrap" }, ...SIDES.map((s, i) => el("button", { class: "small", onclick: () => callTimeout(i) }, `Timeout ${tri(s, i)}`)),
      el("button", { class: "small", onclick: () => ingest({ banner: "TECHNICAL PAUSE" }) }, "Technical pause"),
      el("button", { class: "small ghost", onclick: () => ingest({ banner: "" }) }, "Clear banner")),
    m.banner ? el("p", { class: "muted small" }, `Showing: ${m.banner}`) : "",
    el("h4", {}, "VALORANT graphics"),
    hud ? el("div", { class: "row wrap" }, ...hud.parts.map(p => el("button", { class: "small" + (p.on ? " on" : ""), "aria-pressed": String(!!p.on), onclick: () => flip(p.id) }, `${p.name}: ${p.on ? "on" : "off"}`)))
      : el("p", { class: "muted small" }, "These graphics are added with the first VALORANT data (try the demo match)."));
}
function live() {
  return [previewCard("live"), broadcast(), liveCard()];
}

// --- agent select ---------------------------------------------------------------
function select() {
  const m = M(), on = !!(m.select || {}).on, agents = Object.fromEntries(((cat || {}).agents || []).map(a => [a.id, a.name]));
  const base = `http://127.0.0.1:${(App.state.app || {}).port || location.port}`, url = `${base}/output?hud=val27&part=select`;
  return [card("Agent select",
      el("div", { class: "row" }, el("input", { readonly: true, value: url, class: "mono", onclick: e => e.target.select() }),
        el("button", { class: "small", onclick: () => navigator.clipboard.writeText(url).then(() => toast("Link copied")) }, "Copy")),
      el("div", { class: "row" }, el("button", { class: "small" + (on ? " on" : ""), onclick: () => ingest({ select: { on: !on } }) }, on ? "Hide agent select" : "Show agent select"),
        el("button", { class: "small", onclick: () => ingest({ select: { reset: true } }) }, "Clear picks"))),
    card("Picks", ...SIDES.map((s, i) => el("div", { class: `val-col ${s}` }, el("h4", {}, tri(s, i)),
      ...[1, 2, 3, 4, 5].map(n => {
        const p = (m.players || []).find(x => x.team === i && x.slot === n) || {};
        return el("div", { class: "val-player" }, p.pick ? el("img", { class: "val-agent", src: `/val-img/agent/${p.pick}/displayicon.png`, alt: "" }) : el("span", { class: "val-agent none" }),
          el("div", { class: "grow" }, el("b", {}, p.name || `Player ${n}`), el("span", { class: "muted small" }, p.pick ? (agents[p.pick] || "Picked") : "No pick yet")),
          p.locked ? el("span", { class: "pill ok" }, "Locked") : "");
      }))))];
}

// --- page ---------------------------------------------------------------------
function render() {
  const body = $("#val-body");
  if (!body || !App.state || !App.state.project) return;
  const s = JSON.stringify([tab, App.state.val, G(), App.state.project.huds && App.state.project.huds.find(h => h.id === "val"), !!cat]);
  if (s === sig || typingIn($("#page-valorant"))) return;
  sig = s;
  const sections = { overview, players, tournament, live, select }[tab]();
  morphKids(sectionsEl, sections);   // (into the same container every time: a fresh one would adopt the preview's nodes and the iframe would reload)
  morphKids(body, [head(),
    el("div", { class: "seg val-tabs", role: "tablist" }, ...TABS.map(([k, t]) => el("button", { role: "tab", class: k === tab ? "on" : "", "aria-selected": String(k === tab),
      onclick: () => { tab = k; sig = ""; try { localStorage.setItem("sg-val-tab", k); } catch (e) { /* */ } render(); } }, t))),
    sectionsEl]);
}
App.on(() => { if (App.page === "valorant") render(); });
pages.valorant = {
  shown() {
    sig = "";
    if (!cat) fetch("/api/val/catalog").then(r => r.json()).then(c => { cat = c; sig = ""; render(); }).catch(() => { cat = { agents: [], maps: [] }; });
    render();
  }
};
