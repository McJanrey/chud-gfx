// Home: the workspaces (one per event or show) and the open one's backups.
import { $, el, api, App, pages, toast, ask, askText } from "./lib.js";

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
        el("div", { class: "ws-head" }, el("div", { class: "name" }, w.name), el("div", { class: "muted small" }, `${w.graphics} graphics · ${ago(w.changed)}`)),
        el("div", { class: "ws-actions" },
          w.open ? el("span", { class: "ws-current" }, "● Open now") : el("button", { class: "small primary", onclick: () => api("/api/workspace/open", { folder: w.folder }).then(() => toast(`Opened ${w.name}`)) }, "Open"),
          el("button", { class: "small ghost", onclick: async () => { const n = await askText("Name", w.name); if (n) api("/api/workspace/rename", { folder: w.folder, name: n }); } }, "Rename"),
          el("button", { class: "small ghost", onclick: () => api("/api/workspace/copy", { folder: w.folder }) }, "Duplicate"),
          w.open ? el("a", { class: "small ghost btn", href: "/api/export", download: "" }, "Export pack") : null,
          w.open ? null : el("button", { class: "small ghost", onclick: async () => { if (await ask(`Remove "${w.name}"? It's moved to the .removed folder, not deleted.`)) api("/api/workspace/remove", { folder: w.folder }); } }, "Remove")))),
      el("button", { class: "ws-card new", onclick: async () => { const n = await askText("Name of the new workspace", "New workspace"); if (n) api("/api/workspace/new", { name: n }); } }, "+ New workspace"));
    const gone = st.removed_ws || [];   // (Remove keeps them: they come back from here)
    if (gone.length) body = el("div", {}, body, el("h4", { class: "g-head" }, "Removed workspaces"),
      el("div", { class: "panel" }, el("div", { class: "list" }, ...gone.map(w => el("div", { class: "gfx" }, el("span", { class: "bar-ind" }),
        el("div", {}, el("div", { class: "name" }, w.name), el("div", { class: "muted small" }, `${w.graphics} graphics · removed ${ago(w.removed)}`)),
        el("button", { class: "small", onclick: () => api("/api/workspace/unremove", { folder: w.folder }).then(() => toast(`"${w.name}" is back`)) }, "Bring back"))))));

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
