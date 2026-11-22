// Home: the workspaces (one per event or show) and the open one's backups.
import { $, el, api, App, pages, toast, ask, askText } from "./lib.js";

let tab = "ws";
const ago = t => { const s = Date.now() / 1000 - t; return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; };
const when = n => n.replace(".json", "").replace("_", " · ").replace(/-(\d\d)-(\d\d)$/, ":$1:$2");

const GAMES = { lol: "League of Legends", val: "VALORANT", rl: "Rocket League", other: "Other" };
let find = "";

// New event (or Edit details): name, organiser, game, and what it starts from (blank or another event's graphics).
function eventForm(w) {
  const list = App.state.workspaces || [];
  const name = el("input", { value: w ? w.name : "", placeholder: "SCC Winter Split", "aria-label": "Event name" });
  const org = el("input", { value: w ? w.organiser : "", placeholder: "St. Clair College", "aria-label": "Organiser" });
  const game = el("select", { "aria-label": "Game" }, el("option", { value: "" }, "Pick a game"),
    ...Object.entries(GAMES).map(([k, t]) => el("option", { value: k }, t)));
  game.value = w ? (w.game || "other") : "";
  const start = el("select", { "aria-label": "Start from" });
  const fill = () => {
    const same = list.filter(x => x.game === game.value), rest = list.filter(x => x.game !== game.value);
    start.replaceChildren(el("option", { value: "" }, "Blank event"),
      ...same.map(x => el("option", { value: x.folder }, `Copy of ${x.name}`)),
      ...rest.map(x => el("option", { value: x.folder }, `Copy of ${x.name} (${GAMES[x.game] || "no game"})`)));
  };
  const go = el("button", { class: "primary" }, w ? "Save" : "Create event");
  const ok = () => { go.disabled = !name.value.trim() || !game.value; };
  name.addEventListener("input", ok); game.addEventListener("change", () => { fill(); ok(); });
  fill(); ok();
  const field = (label, input) => el("label", { class: "ev-field" }, el("span", {}, label), input);
  const d = el("dialog", { class: "dlg ev-dlg" },
    el("div", { class: "ev-dlg-head" }, el("div", {}, el("h3", {}, w ? "Event details" : "New event"),
      el("p", { class: "muted" }, w ? "Shown on the event's card." : "Each event keeps its own graphics, files, data and settings.")),
      el("button", { class: "ghost small", "aria-label": "Close", onclick: () => close() }, "✕")),
    el("div", { class: "ev-grid" }, field("Event name", name), field("Organiser", org), field("Game", game), w ? "" : field("Start from", start)),
    el("div", { class: "row end" }, el("button", { class: "ghost", onclick: () => close() }, "Cancel"), go));
  const close = () => { d.close(); d.remove(); };
  d.addEventListener("cancel", close);
  go.addEventListener("click", async () => {
    if (go.disabled) return;
    const body = { name: name.value.trim(), organiser: org.value, game: game.value };
    if (w) { if (body.name !== w.name) await api("/api/workspace/rename", { folder: w.folder, name: body.name }); await api("/api/workspace/details", { folder: w.folder, ...body }); toast("Saved"); }
    else { const r = await api("/api/workspace/new", { ...body, start: start.value }); await api("/api/workspace/open", { folder: r.folder }); toast(`Opened ${body.name}`); }
    close();
  });
  document.body.appendChild(d); d.showModal(); name.focus();
}

function card(w) {
  const open = () => w.open ? document.querySelector('#nav button[data-page="control"]').click() : api("/api/workspace/open", { folder: w.folder }).then(() => toast(`Opened ${w.name}`));
  const act = (t, f) => el("button", { onclick: e => { e.stopPropagation(); e.target.closest("details").open = false; f(); } }, t);
  const menu = el("details", { class: "menu ev-more", onclick: e => e.stopPropagation() }, el("summary", { "aria-label": `More for ${w.name}` }, "•••"),
    el("div", { class: "menu-list" },
      act("Edit details", () => eventForm(w)),
      act("Duplicate", () => api("/api/workspace/copy", { folder: w.folder })),
      w.open ? el("a", { class: "btn", href: "/api/export", download: "" }, "Export pack") : null,
      w.open ? null : act("Remove", async () => { if (await ask(`Remove "${w.name}"? It's kept in the .removed folder and can come back from here.`)) api("/api/workspace/remove", { folder: w.folder }); })));
  return el("div", { class: "ev-card" + (w.open ? " open" : ""), role: "button", tabindex: "0", onclick: open, onkeydown: e => { if (e.key === "Enter" && e.target === e.currentTarget) open(); } },
    el("div", { class: "ev-cover g-" + (w.game || "other") }, el("span", { class: "ev-game" }, GAMES[w.game] || "No game set"), menu),
    el("div", { class: "ev-info" }, el("div", { class: "name" }, w.name),
      el("div", { class: "muted small" }, [w.organiser, `${w.graphics} graphics`, ago(w.changed)].filter(Boolean).join(" · ")),
      el("div", { class: "ev-state" }, w.open ? "Open now · go to Control" : "Open event")));
}

function render() {
  if (App.page !== "home") return;
  const st = App.state, list = st.workspaces || [];
  const tabs = el("div", { class: "seg" }, ...[["ws", "Events"], ["bk", "Backups"]].map(([k, t]) =>
    el("button", { class: "small" + (tab === k ? " on" : ""), onclick: () => { tab = k; render(); } }, t)));
  let body;
  if (tab === "ws") {
    const q = find.toLowerCase(), shown = list.filter(w => !q || `${w.name} ${w.organiser} ${GAMES[w.game] || ""}`.toLowerCase().includes(q));
    const search = el("input", { class: "search", type: "search", placeholder: "Search events", value: find, "aria-label": "Search events",
      oninput: e => { find = e.target.value; render(); const i = $("#home-body .search"); i.focus(); i.setSelectionRange(find.length, find.length); } });
    body = el("div", { class: "stack" },
      el("div", { class: "ev-tools" }, tabs, search, el("button", { class: "primary", onclick: () => eventForm() }, "New event")),
      el("div", { class: "ev-grid-cards" }, ...shown.map(card),
        q ? "" : el("button", { class: "ev-card ev-new", onclick: () => eventForm() }, el("span", { class: "plus" }, "+"), "New event")),
      shown.length || !q ? "" : el("p", { class: "muted" }, `No events match "${find}".`));
    const gone = st.removed_ws || [];   // (Remove keeps them: they come back from here)
    if (gone.length) body = el("div", { class: "stack" }, body, el("h4", { class: "g-head" }, "Removed events"),
      el("div", { class: "panel" }, el("div", { class: "list" }, ...gone.map(w => el("div", { class: "gfx" }, el("span", { class: "bar-ind" }),
        el("div", {}, el("div", { class: "name" }, w.name), el("div", { class: "muted small" }, `${w.graphics} graphics · removed ${ago(w.removed)}`)),
        el("button", { class: "small", onclick: () => api("/api/workspace/unremove", { folder: w.folder }).then(() => toast(`"${w.name}" is back`)) }, "Bring back"))))));
    $("#home-body").replaceChildren(body);
    return;
  } else {
    const bk = st.backups || [];
    body = el("div", { class: "panel" }, el("div", { class: "list" },
      el("p", { class: "muted small" }, `A copy of "${st.project.name}" is kept every 10 minutes while it changes (the last 50). Restoring keeps what's there now as a backup too.`),
      ...(bk.length ? bk.map(b => el("div", { class: "gfx" }, el("span", { class: "bar-ind" }),
        el("div", {}, el("div", { class: "name" }, when(b.name)), el("div", { class: "sub" }, `${Math.round(b.size / 1024)} KB`)),
        el("button", { class: "small", onclick: async () => { if (await ask(`Go back to the ${when(b.name)} copy?`)) api("/api/backup/restore", { name: b.name }).then(() => toast("Restored")); } }, "Restore")))
        : [el("p", { class: "muted empty" }, "No backups yet.")])));
  }
  $("#home-body").replaceChildren(tabs, body);
}
pages.home = { shown: render };
App.on((st, msg) => {
  for (const id of ["#ws-name", "#crumb-ws"]) { const e = $(id); if (e && st.project) e.textContent = st.project.name || "Workspace"; }
  if (!msg || msg.workspaces || msg.backups || msg.project) render();
});

// The update bar (as the Albion app): a newer StandBy GFX is out -> Update now downloads it (checked against
// GitHub's sha256), installs it and the app closes and opens again by itself. Something on air? It asks to take it
// off first. Later hides it until the next version; Turn off hides it for good (the sidebar version still offers it).
const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem(k) || ""; v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) { return ""; } };
async function updateNow(u) {
  const st = App.state, onAir = st.live && st.live.program.on.length;
  if (onAir && !(await ask(`Take everything off Program and update to ${u.version}?`, "The app closes and opens again by itself in about half a minute. Outputs go blank until then.", { ok: "Clear and update" }))) return;
  if (onAir) await api("/api/clear", { bus: "program" });
  api("/api/update/install").then(() => toast("Updating: StandBy GFX closes and opens again by itself")).catch(() => {});
}
App.on((st, msg) => {
  if (msg && !msg.update && !msg.live && !msg.app) return;
  const u = st.update || {}, bar = $("#upd-bar");
  const v = $("#app-version"), ver = (st.app || {}).version || u.current;
  const off = pref("sg-update-off") === "1", busy = u.state === "installing", failed = u.state === "error" && u.update;
  if (v && ver) {   // (the version this app is, in the sidebar; with updates turned off it's where an update is offered)
    v.textContent = "StandBy GFX v" + ver + (off && u.update ? ` · ${u.version} available` : "");
    v.classList.toggle("link", off && !!u.update);
    v.onclick = off && u.update ? () => updateNow(u) : null;
  }
  if (!bar) return;
  bar.hidden = !(busy || failed || (u.update && !off && pref("sg-update-later") !== u.version));
  $("#upd-text").textContent = busy ? (u.progress >= 100 ? "Installing. StandBy GFX closes and opens again by itself" : `Downloading StandBy GFX ${u.version}: ${u.progress || 0}%`)
    : failed ? `Update didn't work: ${u.detail || "try again"}` : `StandBy GFX ${u.version} is ready (you have ${ver})`;
  $("#upd-go").hidden = $("#upd-later").hidden = $("#upd-off").hidden = busy;
  $("#upd-go").textContent = failed ? "Try again" : "Update now";
  $("#upd-go").onclick = () => updateNow(u);
  $("#upd-later").onclick = () => { pref("sg-update-later", u.version); bar.hidden = true; };
  $("#upd-off").onclick = () => { pref("sg-update-off", "1"); bar.hidden = true; toast("Update bar off: the version at the bottom of the sidebar offers new ones", { label: "Undo", run: () => { pref("sg-update-off", ""); location.reload(); } }); };
});

// Show check: what could go wrong on air, worst first, each with the page that fixes it.
async function runCheck() {
  const { items } = await api("/api/check");
  const mark = { stop: "✕", warn: "!", ok: "✓" };
  $("#check-list").replaceChildren(...items.map(i => el("div", { class: "check " + i.level }, el("span", { class: "mark" }, mark[i.level]), el("span", {}, i.text),
    el("span", { class: "spacer" }), i.page && i.level !== "ok" ? el("button", { class: "small ghost", onclick: () => { if (i.page === "log") return showLog(); $("#check-dlg").close(); document.querySelector(`#nav button[data-page="${i.page}"]`)?.click(); } }, "Fix") : "")));
  const worst = items[0] ? items[0].level : "ok";
  $("#check-btn").className = "small " + (worst === "stop" ? "check-stop" : worst === "warn" ? "check-warn" : "");
}
$("#check-btn").addEventListener("click", () => { $("#check-dlg").showModal(); runCheck(); });
$("#check-again").addEventListener("click", runCheck);
$("#check-log").addEventListener("click", showLog);

// Error log: the newest lines of standby-gfx.log, to copy and send when something breaks.
async function showLog() {
  const { text, file } = await api("/api/log/read");
  const box = el("textarea", { class: "log-text", readonly: true, "aria-label": "Error log" }, text);
  const d = el("dialog", { class: "dlg log-dlg" },
    el("div", { class: "row" }, el("h3", {}, "Error log"), el("span", { class: "spacer" }),
      el("button", { class: "small", onclick: async () => { await navigator.clipboard.writeText(box.value).catch(() => { box.select(); document.execCommand("copy"); }); toast("Copied the log"); } }, "Copy"),
      el("button", { class: "small ghost", onclick: () => { d.close(); d.remove(); } }, "Close")),
    el("p", { class: "muted small" }, "Newest at the bottom. The whole file: ", el("code", {}, file || "standby-gfx.log")), box);
  document.body.appendChild(d);
  d.showModal();
  box.scrollTop = box.scrollHeight;
}
$("#check-close").addEventListener("click", () => $("#check-dlg").close());
