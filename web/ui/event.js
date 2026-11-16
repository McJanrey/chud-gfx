// Event setup: Teams (shared by every workspace), Tournament (standings, knockout bracket, groups), Upcoming Schedule.
import { $, el, api, App, pages, picker, ask } from "./lib.js";

const G = () => App.state.project.global || {};
const saveG = change => api("/api/global", { global: change });
const teams = () => (App.state.teams || []).map(t => ({ ...t, players: (t.players || []).map(p => ({ ...p })) }));
const lab = (t, input) => el("label", { class: "f" }, el("span", {}, t), input);
const inp = (value, onSave, attrs = {}) => el("input", { value: value ?? "", ...attrs, onchange: e => onSave(e.target.value) });
const head = (cls, ...labels) => el("div", { class: "phead " + cls }, ...labels.map(t => el("span", {}, t)));
const busy = page => $("#page-" + page).contains(document.activeElement);
const teamList = () => el("datalist", { id: "team-names" }, ...(App.state.teams || []).map(t => el("option", { value: t.name })));

// --- Teams ----------------------------------------------------------------------
let pickTeam = null, teamFind = "";
function renderTeams() {
  const all = teams(), saveAll = () => api("/api/teams", { teams: all });
  const cur = all.find(t => t.id === pickTeam) || null;
  const left = el("div", { class: "panel" }, el("div", { class: "panel-head" }, el("h3", {}, `Teams (${all.length})`),
      inp(teamFind, v => { teamFind = v.toLowerCase(); renderTeams(); }, { placeholder: "Find…", class: "search" }),
      el("button", { class: "small primary", onclick: () => { all.push({ name: "New team", short: "", players: [] }); pickTeam = null; saveAll(); } }, "+ Team")),
    el("div", { class: "list" }, ...all.filter(t => t.name.toLowerCase().includes(teamFind)).map(t =>
      el("div", { class: "gfx" + (t.id === pickTeam ? " sel" : ""), onclick: () => { pickTeam = t.id; renderTeams(); } },
        el("span", { class: "bar-ind", style: `background:${t.color || "transparent"}` }),
        el("div", {}, el("div", { class: "name" }, t.name), el("div", { class: "sub" }, `${t.short || "—"} · ${(t.players || []).length} players${t.game ? " · " + t.game : ""}`)), ""))));
  let right = el("div", { class: "panel" }, el("p", { class: "muted empty" }, all.length ? "Pick a team on the left." : "No teams yet: + Team adds one. Every workspace shares this list."));
  if (cur) {
    const set = (k, v) => { cur[k] = v; saveAll(); };
    const pl = cur.players;
    right = el("div", { class: "panel" }, el("div", { class: "panel-head" }, el("h3", {}, cur.name),
        el("button", { class: "small ghost", onclick: async () => { if (await ask(`Delete the team "${cur.name}"?`)) { all.splice(all.indexOf(cur), 1); pickTeam = null; saveAll(); } } }, "Delete team")),
      el("div", { class: "list form" },
        el("div", { class: "two" }, lab("Name", inp(cur.name, v => set("name", v))), lab("Short name", inp(cur.short, v => set("short", v)))),
        el("div", { class: "two" }, lab("Colour", el("input", { type: "color", value: cur.color || "#0b6b3a", onchange: e => set("color", e.target.value) })), lab("Game", inp(cur.game, v => set("game", v)))),
        lab("Logo", picker("image", cur.logo || "", v => set("logo", v), "logos")),
        el("h4", {}, "Players"),
        el("div", { class: "players" },
          head("", "Gamer tag", "Name", "ID", "Country", "Headshot", ""),
          ...pl.map((p, i) => el("div", { class: "prow" },
            inp(p.tag, v => { p.tag = v; saveAll(); }), inp(p.name, v => { p.name = v; saveAll(); }), inp(p.id, v => { p.id = v; saveAll(); }),
            inp(p.country, v => { p.country = v; saveAll(); }), picker("image", p.photo || "", v => { p.photo = v; saveAll(); }, "players"),
            el("button", { class: "small ghost", "aria-label": "Remove player", onclick: () => { pl.splice(i, 1); saveAll(); } }, "✕")))),
        el("button", { class: "small", onclick: () => { pl.push({ tag: "", name: "", id: "", country: "", photo: "" }); saveAll(); } }, "+ Player")));
  }
  $("#teams-body").replaceChildren(left, right);
}

// --- Tournament: standings + knockout bracket + groups ---------------------------
const STATS = [["record", "Record (W-L)"], ["points", "Points"], ["wins", "Wins"], ["losses", "Losses"], ["diff", "+/-"]];
function standingsCard() {
  const st = { count: 8, stat: "record", stat2: "", teams: [], ...(G().standings || {}) };
  const rows = Array.from({ length: +st.count === 16 ? 16 : 8 }, (_, i) => ({ name: "", w: "", l: "", pts: "", diff: "", ...(st.teams[i] || {}) }));
  const put = change => { Object.assign(st, change || {}); return saveG({ standings: { ...st, teams: rows } }); };
  return el("section", { class: "card wide" },
    el("div", { class: "row" }, el("h3", {}, "Standings"),
      el("div", { class: "seg" }, ...[8, 16].map(n => el("button", { class: "small" + ((+st.count === 16 ? 16 : 8) === n ? " on" : ""), onclick: () => put({ count: n }) }, `${n} teams`))),
      lab("The box shows", el("select", { onchange: e => put({ stat: e.target.value }) }, ...STATS.map(([v, t]) => el("option", { value: v, selected: st.stat === v }, t)))),
      lab("Second box", el("select", { onchange: e => put({ stat2: e.target.value }) }, el("option", { value: "" }, "Nothing"), ...STATS.map(([v, t]) => el("option", { value: v, selected: st.stat2 === v }, t))))),
    el("div", { class: "two" }, lab("Title (blank: the Global event)", inp(st.title, v => put({ title: v }))), lab("Under it", inp(st.subtitle, v => put({ subtitle: v })))),
    el("div", { class: "st-grid" }, head("st", "#", "Team", "W", "L", "Pts", "+/-"),
      ...rows.map((r, i) => el("div", { class: "prow st" }, el("span", { class: "muted" }, String(i + 1)),
        inp(r.name, v => { r.name = v; put(); }, { list: "team-names" }),
        ...["w", "l", "pts", "diff"].map(k => inp(r[k], v => { r[k] = v; put(); }, { class: "num" }))))));
}
function matchBox(key, a, b, sc, onScore, onTeam) {
  const box = el("div", { class: "match" });
  for (const [n, name] of [[0, a], [1, b]]) {
    box.append(el("div", { class: "mrow" },
      onTeam ? inp(name, v => onTeam(n, v), { list: "team-names", placeholder: "Team" }) : el("span", { class: "mteam" + (name ? "" : " muted") }, name || "—"),
      inp(sc[n] ?? "", v => onScore(n, v), { class: "num", "aria-label": `${key} score ${n + 1}` })));
  }
  return box;
}
function bracketCard() {
  const top = { size: 8, format: "single", reset: true, short: false, teams: [], scores: {}, ...((G().tournament || {}).top || {}) };
  const size = +top.size === 16 ? 16 : 8, names = [...(top.teams || []), ...Array(16).fill("")].slice(0, 16);
  const put = change => { Object.assign(top, change || {}); return saveG({ tournament: { ...(G().tournament || {}), top: { ...top, teams: names } } }); };
  top.scores = { ...(top.scores || {}) };
  // (edits build on each other until the page redraws: one shared copy, changed in place)
  const score = (key, n, v) => { const cur = [...(top.scores[key] || ["", ""])]; cur[n] = v; top.scores[key] = cur; put(); };
  // the rounds as the engine works them out (its Tournament table), so winners move through
  const rows = Object.fromEntries((App.state.data.tables.Tournament || []).slice(1));
  const rounds = Math.log2(size), cols = [];
  for (let r = 1; r <= rounds; r++) {
    const ms = [];
    for (let m = 1; m <= size / 2 ** r; m++) {
      const key = `R${r} M${m}`;
      ms.push(matchBox(key, rows[`Top ${key} team 1`], rows[`Top ${key} team 2`], top.scores[key] || [], (n, v) => score(key, n, v),
        r === 1 ? (n, v) => { names[(m - 1) * 2 + n] = v; put(); } : null));
    }
    cols.push(el("div", { class: "bcol" }, el("div", { class: "bhead" }, r === rounds ? "Final" : r === rounds - 1 ? "Semi-finals" : r === rounds - 2 ? "Quarter-finals" : `Round ${r}`), ...ms));
  }
  if (top.format === "double") {
    const lb = Object.keys(rows).map(k => (k.match(/^Top (L\d+ M\d+) team 1$/) || [])[1]).filter(Boolean);
    const byRound = {};
    for (const key of lb) (byRound[key.split(" ")[0]] = byRound[key.split(" ")[0]] || []).push(key);
    for (const [rn, keys] of Object.entries(byRound))
      cols.push(el("div", { class: "bcol" }, el("div", { class: "bhead" }, `Losers ${rn.slice(1)}`),
        ...keys.map(key => matchBox(key, rows[`Top ${key} team 1`], rows[`Top ${key} team 2`], top.scores[key] || [], (n, v) => score(key, n, v)))));
    for (const key of ["GF", "GF2"])
      cols.push(el("div", { class: "bcol" }, el("div", { class: "bhead" }, key === "GF" ? "Grand final" : "Reset"),
        matchBox(key, rows[`Top ${key} team 1`], rows[`Top ${key} team 2`], top.scores[key] || [], (n, v) => score(key, n, v))));
  }
  cols.push(el("div", { class: "bcol" }, el("div", { class: "bhead" }, "Champion"), el("div", { class: "match champ" }, rows["Top champion"] || "—")));
  return el("section", { class: "card wide" },
    el("div", { class: "row" }, el("h3", {}, "Knockout bracket"),
      el("div", { class: "seg" }, ...[8, 16].map(n => el("button", { class: "small" + (size === n ? " on" : ""), onclick: () => put({ size: n }) }, `${n} teams`))),
      el("div", { class: "seg" }, ...[["single", "Single elimination"], ["double", "Double elimination"]].map(([v, t]) => el("button", { class: "small" + (top.format === v ? " on" : ""), onclick: () => put({ format: v }) }, t))),
      top.format === "double" ? el("label", { class: "switch" }, el("input", { type: "checkbox", checked: top.reset !== false, onchange: e => put({ reset: e.target.checked }) }), "Grand final reset") : null,
      el("label", { class: "switch" }, el("input", { type: "checkbox", checked: !!top.short, onchange: e => put({ short: e.target.checked }) }), "Short names on air"),
      el("span", { class: "spacer" }),
      el("button", { class: "small ghost", onclick: () => put({ scores: {} }) }, "Clear scores")),
    el("div", { class: "bracket" }, ...cols));
}
function groupsCard() {
  const t = G().tournament || {}, groups = (t.groups || []).map(g => ({ ...g, teams: [...(g.teams || []), "", "", "", ""].slice(0, 4), scores: { ...(g.scores || {}) } }));
  while (groups.length < 4) groups.push({ name: "GROUP " + "ABCD"[groups.length], teams: ["", "", "", ""], scores: {} });
  const put = () => saveG({ tournament: { ...t, groups } });
  const rows = Object.fromEntries((App.state.data.tables.Tournament || []).slice(1));
  return el("section", { class: "card wide" }, el("h3", {}, "Groups"),
    el("div", { class: "groups" }, ...groups.map((g, gi) => {
      const L = "ABCD"[gi];
      const box = key => matchBox(key, rows[`Group ${L} ${key} team 1`], rows[`Group ${L} ${key} team 2`], g.scores[key] || [],
        (n, v) => { const c = [...(g.scores[key] || ["", ""])]; c[n] = v; g.scores[key] = c; put(); },
        key.startsWith("Opening") ? (n, v) => { g.teams[(key.endsWith("1") ? 0 : 2) + n] = v; put(); } : null);
      return el("div", { class: "group-box" }, inp(g.name, v => { g.name = v; put(); }, { class: "gname" }),
        ...["Opening 1", "Opening 2", "Winners", "Elimination", "Decider"].map(k => el("div", {}, el("div", { class: "bhead" }, k), box(k))),
        el("div", { class: "muted small" }, `1st: ${rows[`Group ${L} 1st`] || "—"} · 2nd: ${rows[`Group ${L} 2nd`] || "—"}`));
    })));
}
function renderTournament() { $("#tour-body").replaceChildren(teamList(), standingsCard(), bracketCard(), groupsCard()); }

// --- Upcoming Schedule ----------------------------------------------------------
function renderSchedule() {
  const s = { count: 3, matches: [], ...(G().schedule || {}) };
  const ms = (s.matches || []).map(m => ({ ...m }));
  const put = change => { Object.assign(s, change || {}); return saveG({ schedule: { ...s, matches: ms } }); };
  $("#sched-body").replaceChildren(teamList(), el("section", { class: "card wide" },
    el("div", { class: "row" }, el("h3", {}, "Matches"),
      lab("Graphics show", el("select", { onchange: e => put({ count: +e.target.value }) }, ...[1, 2, 3, 4, 5, 6].map(n => el("option", { value: n, selected: +s.count === n }, `${n} match${n > 1 ? "es" : ""}`)))),
      el("span", { class: "spacer" }),
      el("button", { class: "small primary", onclick: () => { ms.push({ tournament: "", game: "", type: "", team1: "", team2: "", date: "", time: "" }); put(); } }, "+ Match")),
    head("sch", "Tournament", "Game", "Stage", "Team 1", "Team 2", "Date", "Time", ""),
    ...ms.map((m, i) => el("div", { class: "prow sch" },
      ...["tournament", "game", "type"].map(k => inp(m[k], v => { m[k] = v; put(); })),
      ...["team1", "team2"].map(k => inp(m[k], v => { m[k] = v; put(); }, { list: "team-names" })),
      el("input", { type: "date", value: m.date || "", onchange: e => { m.date = e.target.value; put(); } }),
      el("input", { type: "time", value: m.time || "", onchange: e => { m.time = e.target.value; put(); } }),
      el("button", { class: "small ghost", "aria-label": "Remove match", onclick: () => { ms.splice(i, 1); put(); } }, "✕")))));
}

App.on(() => {
  if (App.page === "teams" && !busy("teams")) renderTeams();
  if (App.page === "tournament" && !busy("tournament")) renderTournament();
  if (App.page === "schedule" && !busy("schedule")) renderSchedule();
});
pages.teams = { shown: renderTeams };
pages.tournament = { shown: renderTournament };
pages.schedule = { shown: renderSchedule };
