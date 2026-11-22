// Global: set once, used by every graphic (teams, series, sponsors, background loop, ticker, clock, casters).
import { $, el, api, App, pages, picker, typingIn, upload, toast } from "./lib.js";
import { sponsorTurn } from "../engine/data.js";

const save = change => api("/api/global", { global: change });
const G = () => App.state.project.global || {};
const field = (label, input) => el("label", { class: "f" }, el("span", {}, label), input);
const text = (value, onSave, attrs = {}) => el("input", { value: value ?? "", ...attrs, onchange: e => onSave(e.target.value) });
const num = (value, onSave, attrs = {}) => el("input", { type: "number", value: value ?? 0, ...attrs, onchange: e => onSave(+e.target.value || 0) });
const toggle = (label, on, onSave) => el("label", { class: "switch" }, el("input", { type: "checkbox", checked: on, onchange: e => onSave(e.target.checked) }), label);
const card = (title, ...kids) => el("section", { class: "card" }, el("h3", {}, title), ...kids);
// A logo spot: shows the picture, click or drop a file on it to change it.
function logoDrop(value, onPick, folder, empty = "Click or drop the logo") {
  const choose = async f => { if (!f) return; const p = await upload(f, folder); if (p) onPick(p); };
  const input = el("input", { type: "file", accept: "image/*", hidden: true, onchange: e => choose(e.target.files[0]) });
  const box = el("button", { class: "logo-drop" + (value ? " has" : ""), "aria-label": value ? "Change the logo" : empty, onclick: () => input.click(),
    ondragover: e => { e.preventDefault(); box.classList.add("over"); }, ondragleave: () => box.classList.remove("over"),
    ondrop: e => { e.preventDefault(); box.classList.remove("over"); choose(e.dataTransfer.files[0]); } },
    value ? el("img", { src: value.split("/").map(encodeURIComponent).join("/"), alt: "" }) : el("span", { class: "muted small" }, empty), input);
  return el("div", { class: "logo-spot" }, box, value ? el("button", { class: "small ghost", onclick: () => onPick("") }, "Remove logo") : "");
}

function team(side) {
  const t = G()[side] || {};
  const set = (k, v) => save({ [side]: { [k]: v } });
  const list = App.state.teams || [];
  const low = v => String(v || "").trim().toLowerCase(), same = list.find(x => x.name && low(x.name) === low(t.name));
  const fromList = el("select", { "aria-label": "From the team list", onchange: e => { const x = list.find(y => y.id === e.target.value); if (x) save({ [side]: { name: x.name, short: x.short || "", color: x.color || t.color || "", logo: x.logo || "" } }); } },
    el("option", { value: "" }, "Pick a team…"), ...list.map(x => el("option", { value: x.id, selected: same && same.id === x.id }, x.name + (x.game ? ` · ${x.game}` : ""))));
  const keep = () => {   // (adds the team, or updates the one with this name)
    if (!t.name) return toast("Give the team a name first");
    const teams = list.slice(), i = teams.findIndex(x => low(x.name) === low(t.name)), row = { name: t.name, short: t.short || "", color: t.color || "", logo: t.logo || "" };
    if (i >= 0) teams[i] = { ...teams[i], ...row }; else teams.push({ ...row, players: [] });
    api("/api/teams", { teams }).then(() => toast(i >= 0 ? `"${t.name}" updated in the team list` : `"${t.name}" added to the team list`));
  };
  return card(side === "left" ? "Left team" : "Right team",
    logoDrop(t.logo || "", v => set("logo", v), "logos"),
    field("From the team list", fromList),
    field("Name", text(t.name, v => set("name", v))),
    el("div", { class: "two" }, field("Short name", text(t.short, v => set("short", v), { placeholder: "e.g. SCC" })), field("Colour", el("input", { type: "color", value: t.color || "#0b6b3a", onchange: e => set("color", e.target.value) }))),
    el("button", { class: "small ghost g-keep", onclick: keep }, "Save to the team list"));
}

function series() {
  const g = G();
  // (every key both ways, blank where a team has none: the engine merges teams, so a missing key would stay put)
  const swap = () => {
    const keys = [...new Set([...Object.keys(g.left || {}), ...Object.keys(g.right || {})])];
    const pick = t => Object.fromEntries(keys.map(k => [k, (t || {})[k] ?? ""]));
    save({ left: pick(g.right), right: pick(g.left) });
  };
  const L = g.left || {}, R = g.right || {}, best = +g.best_of || 3, need = Math.floor(best / 2) + 1;
  const game = +g.game || (+L.score || 0) + (+R.score || 0) + 1;
  const score = (side, t) => el("div", { class: "g-score" },
    el("span", { class: "g-side", style: `color:${t.color || (side === "left" ? "#3ddc84" : "#f0454b")}` }, t.short || (side === "left" ? "LEFT" : "RIGHT")),
    el("span", { class: "big" }, String(+t.score || 0)),
    el("div", { class: "row" },
      el("button", { class: "small", "aria-label": "One less", onclick: () => save({ [side]: { score: t.score = Math.max(0, (+t.score || 0) - 1) } }) }, "−"),
      el("button", { class: "small", "aria-label": "One more", onclick: () => save({ [side]: { score: t.score = (+t.score || 0) + 1 } }) }, "+")));
  return card("Series",
    el("div", { class: "g-scores" }, score("left", L),
      el("div", { class: "g-game" }, el("b", {}, `Game ${game}`), el("span", { class: "muted small" }, `Best of ${best}`), el("span", { class: "muted small" }, `First to ${need}`)),
      score("right", R)),
    el("div", { class: "two" },
      field("Best of", el("select", { onchange: e => save({ best_of: +e.target.value }) }, ...[1, 3, 5, 7].map(n => el("option", { value: n, selected: (+g.best_of || 3) === n }, String(n))))),
      field("Game (blank: from the score)", num(g.game || "", v => save({ game: v || "" }), { min: 0 }))),
    field("Event", text(g.event, v => save({ event: v }))),
    field("Stage", text(g.stage, v => save({ stage: v }))),
    el("div", { class: "row" },
      el("button", { class: "small", onclick: swap }, "Swap sides"),
      el("button", { class: "small", onclick: () => save({ left: { score: 0 }, right: { score: 0 }, game: "" }) }, "Reset series")));
}

function sponsors() {
  const list = (G().sponsors || []).slice();
  const put = () => save({ sponsors: list, sponsor_epoch: Date.now() / 1000 });
  return card("Sponsors",
    el("p", { class: "muted small" }, "Shown in turn wherever a graphic shows {{Sponsors}}."),
    ...list.map((s, i) => el("div", { class: "sponsor" },
      el("div", { class: "thumb-pick" }, s.logo ? el("img", { src: s.logo, alt: "" }) : el("span", { class: "muted" }, "—"),
        picker("image", s.logo || "", v => { list[i] = { ...list[i], logo: v }; put(); }, "sponsors")),
      el("label", { class: "inline" }, num(s.secs || 10, v => { list[i] = { ...list[i], secs: Math.max(1, v) }; put(); }, { min: 1, style: "width:70px" }), "s"),
      toggle("White", !!s.white, v => { list[i] = { ...list[i], white: v }; put(); }),   // (list[i], not s: an edit just before this one stays)
      el("span", { class: "sp-left small", "data-i": String(i) }),
      el("button", { class: "small ghost", "aria-label": "Move up", disabled: !i, onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; put(); } }, "↑"),
      el("button", { class: "small ghost", "aria-label": "Remove", onclick: () => { list.splice(i, 1); put(); } }, "✕"))),
    el("button", { class: "small", onclick: () => { list.push({ logo: "", secs: 10, white: false }); put(); } }, "+ Sponsor"));
}

function loop() {
  const b = G().bgloop || {};
  const set = (k, v) => save({ bgloop: { [k]: v } });
  const src = b.src || "loops/standby-bg-loop.webm";
  // (the preview plays as the outputs do: the video in grey at its brightness, the colour multiplied over it, at its speed)
  const vid = el("video", { src: src.split("/").map(encodeURIComponent).join("/"), muted: true, loop: true, autoplay: true, playsInline: true });
  const wash = el("div", { class: "loop-wash" });
  const look = (color, bright, speed) => {
    vid.style.filter = `grayscale(1) brightness(${bright})`; wash.style.background = color;
    vid.defaultPlaybackRate = vid.playbackRate = speed;
  };
  vid.addEventListener("loadedmetadata", () => look(b.color || "#2fa85a", b.brightness ?? 1.6, b.speed ?? 1));
  const cur = { color: b.color || "#2fa85a", brightness: b.brightness ?? 1.6, speed: b.speed ?? 1 };
  const slider = (label, key, min, max, step, unit = "") => {
    const out = el("span", { class: "muted small" }, `${cur[key]}${unit}`);
    return el("label", { class: "f" }, el("span", {}, label, " ", out),
      el("input", { type: "range", min, max, step, value: cur[key],
        oninput: e => { cur[key] = +e.target.value; out.textContent = `${cur[key]}${unit}`; look(cur.color, cur.brightness, cur.speed); },
        onchange: e => set(key, +e.target.value) }));
  };
  look(cur.color, cur.brightness, cur.speed);
  return card("Background loop",
    toggle("On", b.on !== false, v => set("on", v)),
    el("div", { class: "loop-preview" + (b.on === false ? " off" : "") }, vid, wash),
    field("Video (blank: StandBy's own loop)", picker("video", b.src || "", v => set("src", v), "loops")),
    el("div", { class: "three" },
      field("Colour", el("input", { type: "color", value: cur.color, oninput: e => { cur.color = e.target.value; look(cur.color, cur.brightness, cur.speed); }, onchange: e => set("color", e.target.value) })),
      slider("Brightness", "brightness", 0, 3, 0.1), slider("Speed", "speed", 0.1, 3, 0.1, "×")),
    el("p", { class: "muted small" }, "Plays behind the schedule and the other full-screen boards."));
}

function tournament() {
  const g = G();
  return card("Tournament logo", logoDrop(g.tournament_logo || "", v => save({ tournament_logo: v }), "logos", "Click or drop the tournament's logo"),
    el("p", { class: "muted small" }, "Every tournament logo spot in the graphics shows it."));
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
  if (s === sig || typingIn($("#page-global"))) return;
  sig = s;
  // Match (the teams and the series, side by side), then what's on screen (sponsors down the side).
  const tag = (node, cls) => { node.classList.add(cls); return node; };
  $("#global-grid").replaceChildren(
    el("h4", { class: "g-head" }, "Match"),
    tag(team("left"), "g-match"), tag(series(), "g-match"), tag(team("right"), "g-match"),
    el("h4", { class: "g-head" }, "On screen"),
    tag(sponsors(), "g-sponsors"), tournament(), loop(), ticker(), clock(), casters());
}
App.on(() => { if (App.page === "global") render(); });
// Which sponsor is on air now, and how long it has left (the rows with a logo take turns).
setInterval(() => {
  if (App.page !== "global" || !App.state) return;
  const t = sponsorTurn(App.state.data.tables || {});
  const withLogo = (G().sponsors || []).map((s, i) => s.logo ? i : -1).filter(i => i >= 0);
  for (const e of document.querySelectorAll(".sp-left")) {
    const on = t && withLogo[t.i] === +e.dataset.i;
    e.textContent = on ? `On air · ${Math.ceil(t.left)}s left` : "";
    e.closest(".sponsor").classList.toggle("on-air", !!on);
  }
}, 500);
pages.global = { shown() { sig = ""; if (App.state) render(); } };
