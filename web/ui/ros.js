// Run of show: templates per game (blocks of segments) on the left, the picked template in the middle,
// tonight's show (live times) on the right. On Control: the show strip (now / next / Next) and the playlists.
import { $, el, api, App, pages, toast, ask, typingIn } from "./lib.js";

let skew = 0;
const now = () => Date.now() / 1000 + skew;
const R = () => App.state.ros || { templates: [], timeline: [], games: [] };
const copy = o => JSON.parse(JSON.stringify(o));
const nid = () => Math.random().toString(16).slice(2, 12);
const hm = t => { if (t == null) return "—"; const d = new Date(t * 1000); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
const mmss = s => { s = Math.max(0, Math.round(s)); return (s >= 3600 ? Math.floor(s / 3600) + ":" : "") + String(Math.floor(s / 60) % 60).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
const lab = (t, input) => el("label", { class: "f" }, el("span", {}, t), input);
const busy = id => typingIn($(id));
const gameName = k => (R().games.find(g => g[0] === k) || [k, "Any game"])[1];

// --- the page ------------------------------------------------------------------------
let pickT = null;
function saveT(all) { return api("/api/ros", { templates: all }); }
function seg() { return { id: nid(), title: "Segment", notes: "", color: "#ffffff", mins: 5, game: false, skip_last: false, graphics: [] }; }

function templates(all) {
  return el("div", { class: "panel" }, el("div", { class: "panel-head" }, el("h3", {}, "Templates per game"),
      el("button", { class: "small primary", onclick: () => { const t = { id: nid(), name: "New template", game: "", best_of: 3, blocks: [{ id: nid(), name: "Pre-show", color: "#bf5af2", repeat: false, segments: [seg()] }] }; all.push(t); pickT = t.id; saveT(all); } }, "+ New")),
    el("div", { class: "list" }, ...all.map(t => el("div", { class: "gfx" + (t.id === pickT ? " sel" : ""), onclick: () => { pickT = t.id; render(); } },
      el("span", { class: "bar-ind", style: `background:${(t.blocks[0] || {}).color || "transparent"}` }),
      el("div", {}, el("div", { class: "name" }, t.name), el("div", { class: "sub" }, `${gameName(t.game)} · Best of ${t.best_of || 1} · ${t.blocks.length} blocks · ${t.blocks.reduce((n, b) => n + b.segments.length, 0)} segments`)), "")),
      ...R().games.filter(([k]) => !all.some(t => t.game === k)).map(([k, n]) => el("div", { class: "gfx dim" },
        el("span", { class: "bar-ind" }), el("div", {}, el("div", { class: "name" }, n), el("div", { class: "sub" }, "Starts blank")),
        el("button", { class: "small", onclick: () => { const t = { id: nid(), name: `${n} · Best of 3`, game: k, best_of: 3, blocks: [] }; all.push(t); pickT = t.id; saveT(all); } }, "+ Make one")))),
    el("label", { class: "switch" }, el("input", { type: "checkbox", checked: R().auto !== false, onchange: e => api("/api/ros", { auto: e.target.checked }) }), "Auto-apply: tonight's Schedule match picks its game's template"));
}

function editor(all) {
  const t = all.find(x => x.id === pickT);
  if (!t) return el("div", { class: "panel" }, el("p", { class: "muted empty" }, all.length ? "Pick a template." : "No templates yet: + New makes one."));
  const save = () => saveT(all);
  const move = (arr, i, by) => { const j = i + by; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; save(); };
  const names = (App.state.project.compositions || []).map(c => c.name);
  const blockEl = (b, bi) => el("div", { class: "ros-block", style: `--c:${b.color}` },
    el("div", { class: "row" },
      el("input", { type: "color", value: b.color, "aria-label": "Block colour", onchange: e => { b.color = e.target.value; save(); } }),
      el("input", { value: b.name, "aria-label": "Block name", onchange: e => { b.name = e.target.value; save(); } }),
      el("label", { class: "switch" }, el("input", { type: "checkbox", checked: !!b.repeat, onchange: e => { b.repeat = e.target.checked; save(); } }), "Repeat for each map"),
      el("span", { class: "muted small" }, mmss(b.segments.reduce((n, s) => n + (+s.mins || 0), 0) * 60)),
      el("button", { class: "small ghost", "aria-label": "Move block up", onclick: () => move(t.blocks, bi, -1) }, "↑"),
      el("button", { class: "small ghost", "aria-label": "Move block down", onclick: () => move(t.blocks, bi, 1) }, "↓"),
      el("button", { class: "small ghost", "aria-label": "Delete block", onclick: () => { t.blocks.splice(bi, 1); save(); } }, "✕")),
    b.repeat ? el("p", { class: "muted small" }, `↻ Repeats for each map of the series (Best of ${t.best_of}) and stops when a team wins.`) : null,
    ...b.segments.map((s, si) => el("div", { class: "ros-seg", style: `--c:${s.color}` },
      el("input", { type: "color", value: s.color, "aria-label": "Segment colour", onchange: e => { s.color = e.target.value; save(); } }),
      el("div", { class: "grow" },
        el("input", { value: s.title, "aria-label": "Segment title", onchange: e => { s.title = e.target.value; save(); } }),
        el("input", { value: s.notes, placeholder: "Notes ({{Match.TeamA}}, {{Match.TeamB}}, {{Map.N}})", "aria-label": "Notes", onchange: e => { s.notes = e.target.value; save(); } }),
        el("input", { value: (s.graphics || []).join(", "), placeholder: "Graphics to cue (names, commas between)", list: "ros-gfx", "aria-label": "Graphics", onchange: e => { s.graphics = e.target.value.split(",").map(x => x.trim()).filter(Boolean); save(); } })),
      el("div", { class: "ros-n" }, el("input", { type: "number", min: 0, step: 1, value: s.mins, "aria-label": "Minutes", onchange: e => { s.mins = +e.target.value || 0; save(); } }), el("span", { class: "muted small" }, s.game ? "min (estimate)" : "min")),
      el("div", { class: "ros-flags" },
        el("label", { class: "switch" }, el("input", { type: "checkbox", checked: !!s.game, onchange: e => { s.game = e.target.checked; save(); } }), "Game length"),
        b.repeat ? el("label", { class: "switch" }, el("input", { type: "checkbox", checked: !!s.skip_last, onchange: e => { s.skip_last = e.target.checked; save(); } }), "Skip after last map") : null),
      el("div", { class: "col" },
        el("button", { class: "small ghost", "aria-label": "Move segment up", onclick: () => move(b.segments, si, -1) }, "↑"),
        el("button", { class: "small ghost", "aria-label": "Move segment down", onclick: () => move(b.segments, si, 1) }, "↓"),
        el("button", { class: "small ghost", "aria-label": "Delete segment", onclick: () => { b.segments.splice(si, 1); save(); } }, "✕")))),
    el("button", { class: "small", onclick: () => { b.segments.push(seg()); save(); } }, "+ Segment"));
  return el("div", { class: "panel" }, el("div", { class: "panel-head" }, el("input", { value: t.name, class: "title-in", "aria-label": "Template name", onchange: e => { t.name = e.target.value; save(); } })),
    el("div", { class: "list form" },
      el("datalist", { id: "ros-gfx" }, ...names.map(n => el("option", { value: n }))),
      el("div", { class: "two" },
        lab("Game", el("select", { onchange: e => { t.game = e.target.value; save(); } }, el("option", { value: "" }, "Any game"), ...R().games.map(([k, n]) => el("option", { value: k, selected: t.game === k }, n)))),
        lab("Series", el("select", { onchange: e => { t.best_of = +e.target.value; save(); } }, ...[1, 3, 5, 7].map(n => el("option", { value: n, selected: +t.best_of === n }, `Best of ${n}`))))),
      el("p", { class: "muted small" }, "Blocks group segments. Fixed segments have a set length; game segments last as long as the game does, and everything after them moves when they end."),
      ...t.blocks.map(blockEl),
      el("div", { class: "row" },
        el("button", { class: "small", onclick: () => { t.blocks.push({ id: nid(), name: "Block", color: "#64d2ff", repeat: false, segments: [seg()] }); save(); } }, "+ Block"),
        el("button", { class: "small", onclick: () => { t.blocks.push({ id: nid(), name: "Match", color: "#64d2ff", repeat: true, segments: [{ ...seg(), title: "Map {{Map.N}}", mins: 40, game: true, color: "#30d158" }] }); save(); } }, "+ Repeat block"),
        el("span", { class: "spacer" }),
        el("button", { class: "small", onclick: () => { const c = copy(t); c.id = nid(); c.name += " copy"; all.push(c); pickT = c.id; save(); } }, "Duplicate"),
        el("button", { class: "small ghost", onclick: async () => { if (await ask(`Delete the template "${t.name}"?`)) { all.splice(all.indexOf(t), 1); pickT = null; save(); } } }, "Delete"),
        el("button", { class: "small primary", onclick: () => api("/api/ros/build", { template: t.id }).then(() => toast(`Tonight uses "${t.name}"`)) }, "Use tonight"))));
}

function tonight() {
  const r = R(), show = r.show, m = (show && show.match) || r.next_match || {};
  const head = el("div", { class: "panel-head" }, el("h3", {}, "Tonight"), el("span", { class: "muted small" }, "~ = estimated, moves when a game ends"));
  if (!show) return el("div", { class: "panel" }, head, el("p", { class: "muted empty" }, r.next_match ? `Next match: ${r.next_match.team1} vs ${r.next_match.team2}. Pick a template and press "Use tonight".` : "No upcoming match in the Schedule. Pick a template and press \"Use tonight\"."));
  let block = null;
  const rows = [];
  r.timeline.forEach((x, i) => {
    if (x.seg.block !== block) { block = x.seg.block; rows.push(el("div", { class: "tl-block", style: `--c:${x.seg.block_color}` }, block)); }
    rows.push(el("div", { class: "tl" + (i === show.current ? " now" : "") + (x.done ? " done" : "") + (x.skip ? " skip" : ""), style: `--c:${x.seg.color}` },
      el("span", { class: "t" }, x.skip ? "skip" : (x.est && i !== show.current ? "~" : "") + hm(x.start)), el("span", { class: "name" }, x.seg.title), el("span", { class: "muted small" }, x.seg.notes)));
  });
  return el("div", { class: "panel" }, head,
    el("div", { class: "list" },
      el("div", { class: "kv" }, el("span", { class: "muted" }, "Match"), el("b", {}, `${m.team1 || "Team A"} vs ${m.team2 || "Team B"}`), el("span", { class: "muted small" }, `${m.date || ""} · ${m.time || ""} · Best of ${m.best_of || "?"}`)),
      el("div", { class: "kv" }, el("span", { class: "muted" }, "Template"), el("b", {}, show.template_name)),
      ...rows,
      showButtons()));
}

function showButtons() {
  return el("div", { class: "row" },
    el("button", { class: "small ghost", onclick: () => api("/api/ros/step", { by: -1 }) }, "← Back"),
    el("button", { class: "small primary", onclick: () => api("/api/ros/step", { by: 1 }) }, (R().show || {}).current >= 0 ? "Next segment →" : "Start the show →"));
}

function render() {
  if (App.page !== "ros" || busy("#page-ros")) return;
  const all = copy(R().templates || []);
  if (!pickT && all[0]) pickT = all[0].id;
  $("#ros-body").replaceChildren(templates(all), editor(all), tonight());
}
pages.ros = { shown: render };

// --- on Control: the show strip and the playlists ----------------------------------------
function strip() {
  const box = $("#ros-strip");
  if (!box) return;
  const r = R(), show = r.show;
  if (!show) { box.replaceChildren(el("span", { class: "muted small" }, "No run of show tonight."), el("button", { class: "small ghost", onclick: () => document.querySelector('#nav button[data-page="ros"]').click() }, "Run of show")); return; }
  const tl = r.timeline, i = show.current, cur = tl[i], nxt = tl.slice(i + 1).find(x => !x.skip);
  const left = cur && cur.start != null ? cur.start + cur.seg.mins * 60 - now() : null;
  box.replaceChildren(
    el("div", { class: "now", style: `--c:${cur ? cur.seg.color : "transparent"}` }, el("span", { class: "muted small" }, cur ? "Now" : "Not started"),
      el("b", {}, cur ? cur.seg.title : show.template_name), cur && cur.seg.notes ? el("span", { class: "muted small" }, cur.seg.notes) : null),
    el("span", { class: "count" + (left != null && left < 0 ? " over" : ""), id: "ros-count" }, left == null ? "" : (left < 0 ? "+" : "") + mmss(Math.abs(left))),
    el("div", { class: "next" }, el("span", { class: "muted small" }, "Next"), el("b", {}, nxt ? nxt.seg.title : "End of show"), nxt ? el("span", { class: "muted small" }, "~" + hm(nxt.start)) : null),
    showButtons());
}

let pickPl = null;
function playlists() {
  const box = $("#playlists");
  if (!box || busy("#playlists")) return;
  const all = copy(App.state.project.playlists || []), playing = App.state.playing;
  const comps = App.state.project.compositions || [];
  const save = () => api("/api/playlists", { playlists: all });
  const pl = all.find(p => p.id === pickPl);
  box.replaceChildren(
    ...all.map(p => el("div", { class: "gfx" + (p.id === pickPl ? " sel" : "") + (playing && playing.id === p.id ? " live" : ""), onclick: e => { if (e.target.closest("button")) return; pickPl = pickPl === p.id ? null : p.id; playlists(); } },
      el("span", { class: "bar-ind" }), el("div", {}, el("div", { class: "name" }, p.name), el("div", { class: "sub" }, `${p.items.length} graphics · ${p.items.reduce((n, i) => n + i.secs, 0)} s${p.loop ? " · loops" : ""}`)),
      playing && playing.id === p.id ? el("button", { class: "small", onclick: () => api("/api/playlist/stop") }, "■ Stop") : el("button", { class: "small primary", onclick: () => api("/api/playlist/play", { id: p.id }) }, "▶ Play"))),
    pl ? el("div", { class: "form" },
      el("div", { class: "row" }, el("input", { value: pl.name, "aria-label": "Playlist name", onchange: e => { pl.name = e.target.value; save(); } }),
        el("label", { class: "switch" }, el("input", { type: "checkbox", checked: pl.loop, onchange: e => { pl.loop = e.target.checked; save(); } }), "Loop"),
        el("button", { class: "small ghost", onclick: () => { all.splice(all.indexOf(pl), 1); pickPl = null; save(); } }, "Delete")),
      ...pl.items.map((it, i) => el("div", { class: "row" },
        el("select", { "aria-label": "Graphic", onchange: e => { it.comp = e.target.value; save(); } }, ...comps.map(c => el("option", { value: c.id, selected: c.id === it.comp }, c.name))),
        el("input", { type: "number", min: 1, step: 1, value: it.secs, class: "num", "aria-label": "Seconds", onchange: e => { it.secs = +e.target.value || 5; save(); } }), el("span", { class: "muted small" }, "s"),
        el("button", { class: "small ghost", "aria-label": "Remove graphic", onclick: () => { pl.items.splice(i, 1); save(); } }, "✕"))),
      el("button", { class: "small", onclick: () => { pl.items.push({ comp: (comps[0] || {}).id, secs: 5 }); save(); } }, "+ Graphic")) : "",
    el("button", { class: "small", onclick: () => { const p = { id: "p" + nid(), name: "New playlist", loop: true, items: [] }; all.push(p); pickPl = p.id; save(); } }, "+ Playlist"));
}

App.on((st, msg) => {
  if (!msg || msg.now) skew = st.now - Date.now() / 1000;
  if (!msg || msg.ros || msg.project) render();
  if (!msg || msg.ros) strip();
  if (!msg || msg.project || "playing" in msg) playlists();
});
setInterval(() => {   // the countdown
  const c = $("#ros-count"), r = R(), show = r.show;
  if (!c || !show) return;
  const cur = r.timeline[show.current];
  if (!cur || cur.start == null) return;
  const left = cur.start + cur.seg.mins * 60 - now();
  c.textContent = (left < 0 ? "+" : "") + mmss(Math.abs(left));
  c.classList.toggle("over", left < 0);
}, 1000);
