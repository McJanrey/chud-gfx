// Home: the workspaces (one per event or show) and the open one's backups.
import { $, el, api, App, pages, toast } from "./lib.js";

let tab = "ws";
const ago = t => { const s = Date.now() / 1000 - t; return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; };
const when = n => n.replace(".json", "").replace("_", " · ").replace(/-(\d\d)-(\d\d)$/, ":$1:$2");

function render() {
  if (App.page !== "home") return;
  const st = App.state, list = st.workspaces || [];
  const tabs = el("div", { class: "seg" }, ...[["ws", "My workspaces"], ["bk", "Backups"]].map(([k, t]) =>
    el("button", { class: "small" + (tab === k ? " on" : ""), onclick: () => { tab = k; render(); } }, t)));
  let body;
  if (tab === "ws") {
    body = el("div", { class: "ws-grid" },
      ...list.map(w => el("div", { class: "ws-card" + (w.open ? " open" : "") },
        el("div", { class: "name" }, w.name), el("div", { class: "muted small" }, `${w.graphics} graphics · ${ago(w.changed)}`),
        el("div", { class: "row" },
          w.open ? el("span", { class: "pill" }, "Open") : el("button", { class: "small primary", onclick: () => api("/api/workspace/open", { folder: w.folder }).then(() => toast(`Opened ${w.name}`)) }, "Open"),
          el("span", { class: "spacer" }),
          el("button", { class: "small ghost", onclick: () => { const n = prompt("Name", w.name); if (n) api("/api/workspace/rename", { folder: w.folder, name: n }); } }, "Rename"),
          el("button", { class: "small ghost", onclick: () => api("/api/workspace/copy", { folder: w.folder }) }, "Duplicate"),
          w.open ? el("a", { class: "small ghost btn", href: "/api/export", download: "" }, "Export pack") : null,
          w.open ? null : el("button", { class: "small ghost", onclick: () => { if (confirm(`Remove "${w.name}"? It's moved to the .removed folder, not deleted.`)) api("/api/workspace/remove", { folder: w.folder }); } }, "Remove")))),
      el("button", { class: "ws-card new", onclick: () => { const n = prompt("Name of the new workspace", "New workspace"); if (n) api("/api/workspace/new", { name: n }); } }, "+ New workspace"),
      el("button", { class: "ws-card new", onclick: async () => {
        const path = prompt("Where GFX Baby is installed", "C:\\Chud GFX Baby");
        if (!path) return;
        const r = await api("/api/import/gfxbaby", { path });
        toast(`Brought in ${r.workspaces.length} workspaces (${r.workspaces.join(", ") || "none new"}), ${r.fonts} fonts${r.run_of_show ? ", the run of show" : ""}. Retype OBS and stream passwords.`);
      } }, "Bring in from GFX Baby"));
  } else {
    const bk = st.backups || [];
    body = el("div", { class: "panel" }, el("div", { class: "list" },
      el("p", { class: "muted small" }, `A copy of "${st.project.name}" is kept every 10 minutes while it changes (the last 50). Restoring keeps what's there now as a backup too.`),
      ...(bk.length ? bk.map(b => el("div", { class: "gfx" }, el("span", { class: "bar-ind" }),
        el("div", {}, el("div", { class: "name" }, when(b.name)), el("div", { class: "sub" }, `${Math.round(b.size / 1024)} KB`)),
        el("button", { class: "small", onclick: () => { if (confirm(`Go back to the ${when(b.name)} copy?`)) api("/api/backup/restore", { name: b.name }).then(() => toast("Restored")); } }, "Restore")))
        : [el("p", { class: "muted empty" }, "No backups yet.")])));
  }
  $("#home-body").replaceChildren(tabs, el("p", { class: "muted" }, "One per event or show: its own graphics, files, data, transitions and global settings. Fonts and teams are shared."), body);
}
pages.home = { shown: render };
App.on((st, msg) => {
  for (const id of ["#ws-name", "#crumb-ws"]) { const e = $(id); if (e && st.project) e.textContent = st.project.name || "Workspace"; }
  if (!msg || msg.workspaces || msg.backups || msg.project) render();
});

// The page bar: a newer StandBy GFX is out (installs and restarts; never while something is on air).
App.on((st, msg) => {
  if (msg && !msg.update && !msg.live) return;
  const u = st.update || {}, b = $("#upd-pill");
  if (!b) return;
  b.hidden = !(u.update || u.state === "installing");
  b.disabled = u.state === "installing";
  b.textContent = u.state === "installing" ? `Updating… ${u.progress || 0}%` : `Update to ${u.version}`;
  b.onclick = () => { if (confirm(`Install StandBy GFX ${u.version}? It closes and opens again in a few seconds.`)) api("/api/update/install"); };
});

// Show check: what could go wrong on air, worst first, each with the page that fixes it.
async function runCheck() {
  const { items } = await api("/api/check");
  const mark = { stop: "✕", warn: "!", ok: "✓" };
  $("#check-list").replaceChildren(...items.map(i => el("div", { class: "check " + i.level }, el("span", { class: "mark" }, mark[i.level]), el("span", {}, i.text),
    el("span", { class: "spacer" }), i.page && i.level !== "ok" ? el("button", { class: "small ghost", onclick: () => { $("#check-dlg").close(); document.querySelector(`#nav button[data-page="${i.page}"]`)?.click(); } }, "Fix") : "")));
  const worst = items[0] ? items[0].level : "ok";
  $("#check-btn").className = "small " + (worst === "stop" ? "check-stop" : worst === "warn" ? "check-warn" : "");
}
$("#check-btn").addEventListener("click", () => { $("#check-dlg").showModal(); runCheck(); });
$("#check-again").addEventListener("click", runCheck);
$("#check-close").addEventListener("click", () => $("#check-dlg").close());
