// Global: set once, used by every graphic (teams, series, sponsors, background loop, ticker, clock, casters).
import { $, el, api, App, pages, picker } from "./lib.js";

const save = change => api("/api/global", { global: change });
const G = () => App.state.project.global || {};
const field = (label, input) => el("label", { class: "f" }, el("span", {}, label), input);
const text = (value, onSave, attrs = {}) => el("input", { value: value ?? "", ...attrs, onchange: e => onSave(e.target.value) });
const num = (value, onSave, attrs = {}) => el("input", { type: "number", value: value ?? 0, ...attrs, onchange: e => onSave(+e.target.value || 0) });
const toggle = (label, on, onSave) => el("label", { class: "switch" }, el("input", { type: "checkbox", checked: on, onchange: e => onSave(e.target.checked) }), label);
const card = (title, ...kids) => el("section", { class: "card" }, el("h3", {}, title), ...kids);

function team(side) {
  const t = G()[side] || {};
  const set = (k, v) => save({ [side]: { [k]: v } });
  return card(side === "left" ? "Left team" : "Right team",
    field("Name", text(t.name, v => set("name", v))),
    el("div", { class: "two" }, field("Short name", text(t.short, v => set("short", v))), field("Colour", el("input", { type: "color", value: t.color || "#0b6b3a", onchange: e => set("color", e.target.value) }))),
    field("Logo", picker("image", t.logo || "", v => set("logo", v), "logos")),
    el("div", { class: "score" },
      el("button", { "aria-label": "One less", onclick: () => set("score", Math.max(0, (+t.score || 0) - 1)) }, "−"),
      el("span", { class: "big" }, String(+t.score || 0)),
      el("button", { "aria-label": "One more", onclick: () => set("score", (+t.score || 0) + 1) }, "+")));
}

function series() {
  const g = G();
  return card("Series",
    el("div", { class: "two" },
      field("Best of", el("select", { onchange: e => save({ best_of: +e.target.value }) }, ...[1, 3, 5, 7].map(n => el("option", { value: n, selected: (+g.best_of || 3) === n }, String(n))))),
      field("Game (blank: from the score)", num(g.game || "", v => save({ game: v || "" }), { min: 0 }))),
    field("Event", text(g.event, v => save({ event: v }))),
    field("Stage", text(g.stage, v => save({ stage: v }))),
    field("Tournament logo", picker("image", g.tournament_logo || "", v => save({ tournament_logo: v }), "logos")),
    el("div", { class: "row" },
      el("button", { class: "small", onclick: () => save({ left: g.right || {}, right: g.left || {} }) }, "Swap sides"),
      el("button", { class: "small", onclick: () => save({ left: { score: 0 }, right: { score: 0 }, game: "" }) }, "Reset series")));
}

function sponsors() {
  const list = (G().sponsors || []).slice();
  const put = () => save({ sponsors: list, sponsor_epoch: Date.now() / 1000 });
  return card("Sponsors",
    el("p", { class: "muted small" }, "Shown in turn wherever a graphic shows {{Sponsors}}."),
    ...list.map((s, i) => el("div", { class: "sponsor" },
      el("div", { class: "thumb-pick" }, s.logo ? el("img", { src: s.logo, alt: "" }) : el("span", { class: "muted" }, "—"),
        picker("image", s.logo || "", v => { list[i] = { ...s, logo: v }; put(); }, "sponsors")),
      el("label", { class: "inline" }, num(s.secs || 10, v => { list[i] = { ...s, secs: Math.max(1, v) }; put(); }, { min: 1, style: "width:70px" }), "s"),
      toggle("White", !!s.white, v => { list[i] = { ...s, white: v }; put(); }),
      el("button", { class: "small ghost", "aria-label": "Move up", disabled: !i, onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; put(); } }, "↑"),
      el("button", { class: "small ghost", "aria-label": "Remove", onclick: () => { list.splice(i, 1); put(); } }, "✕"))),
    el("button", { class: "small", onclick: () => { list.push({ logo: "", secs: 10, white: false }); put(); } }, "+ Sponsor"));
}

function loop() {
  const b = G().bgloop || {};
  const set = (k, v) => save({ bgloop: { [k]: v } });
  return card("Background loop",
    toggle("On", b.on !== false, v => set("on", v)),
    field("Video (blank: StandBy's own loop)", picker("video", b.src || "", v => set("src", v), "loops")),
    el("div", { class: "two" },
      field("Colour", el("input", { type: "color", value: b.color || "#2fa85a", onchange: e => set("color", e.target.value) })),
      field("Brightness", num(b.brightness ?? 1.6, v => set("brightness", v), { step: 0.1, min: 0 }))),
    field("Speed", num(b.speed ?? 1, v => set("speed", v), { step: 0.1, min: 0.1 })));
}

function ticker() {
  const items = (G().ticker || []).slice();
  const put = () => save({ ticker: items.filter(x => x.trim()) });
  return card("Ticker",
    ...items.map((t, i) => el("div", { class: "row" }, text(t, v => { items[i] = v; put(); }), el("button", { class: "small ghost", "aria-label": "Remove", onclick: () => { items.splice(i, 1); put(); } }, "✕"))),
    el("div", { class: "row" }, text("", v => { if (v.trim()) { items.push(v); put(); } }, { placeholder: "Add a line…" })));
}

function clock() {
  const c = G().clock || {};
  const set = (k, v) => save({ clock: { [k]: v } });
  return card("Clock",
    field("Shows", el("select", { onchange: e => set("mode", e.target.value) },
      ...[["time", "Time of day (LOCAL TIME)"], ["soon", "Countdown: Starting soon"], ["brb", "Countdown: Be right back"]].map(([v, t]) => el("option", { value: v, selected: (c.mode || "time") === v }, t)))),
    el("div", { class: "two" }, field("Counts down to", el("input", { type: "time", value: c.until || "", onchange: e => set("until", e.target.value) })),
      field("Time zone label", text(c.zone, v => set("zone", v), { placeholder: "e.g. EST" }))));
}

function casters() {
  const c = G().caster || {};
  const set = (k, v) => save({ caster: { [k]: v } });
  return card("Caster boxes",
    field("How many", el("select", { onchange: e => set("count", +e.target.value) }, ...[1, 2, 3, 4].map(n => el("option", { value: n, selected: (+c.count || 1) === n }, String(n))))),
    el("div", { class: "two" },
      field("Box colour", el("input", { type: "color", value: c.primary || "#c2bdff", onchange: e => set("primary", e.target.value) })),
      field("Edge and shadow", el("input", { type: "color", value: c.secondary || "#001a1a", onchange: e => set("secondary", e.target.value) }))),
    field("Text colour", el("input", { type: "color", value: c.text || c.secondary || "#001a1a", onchange: e => set("text", e.target.value) })));
}

let sig = "";
function render() {
  const g = G();
  const s = JSON.stringify(g);
  if (s === sig || $("#page-global").contains(document.activeElement)) return;
  sig = s;
  $("#global-grid").replaceChildren(team("left"), series(), team("right"), sponsors(), loop(), ticker(), clock(), casters());
}
App.on(() => { if (App.page === "global") render(); });
pages.global = { shown() { sig = ""; if (App.state) render(); } };
