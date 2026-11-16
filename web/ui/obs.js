// OBS Studio: connection + rules (Outputs page) and the scene bar on Control.
import { $, el, api, App, pages, toast } from "./lib.js";

const O = () => App.state.obs || { status: {}, rules: [] };
const STATE = { off: "Off", connecting: "Connecting…", on: "Connected", error: "Not connected" };

export function obsCard() {
  const o = O(), st = o.status || {}, comps = App.state.project.compositions || [];
  const rules = JSON.parse(JSON.stringify(o.rules || []));
  const saveRules = () => api("/api/obs", { rules });
  const host = el("input", { value: o.host || "127.0.0.1", "aria-label": "OBS PC" });
  const port = el("input", { type: "number", value: o.port || 4455, "aria-label": "Port" });
  const pw = el("input", { type: "password", autocomplete: "off", placeholder: o.has_password ? "(saved)" : "", "aria-label": "Password" });
  return el("div", { class: "card", id: "obs-card" }, el("div", { class: "row" }, el("h3", {}, "OBS Studio"),
      el("label", { class: "switch" }, el("input", { type: "checkbox", checked: !!o.on, onchange: e => api("/api/obs", { on: e.target.checked }) }), o.on ? "On" : "Off"),
      el("span", { class: "pill" + (st.state === "on" ? " ok" : st.state === "error" ? " warn" : "") }, STATE[st.state] || st.state || "Off")),
    st.detail ? el("p", { class: st.state === "error" ? "err small" : "muted small" }, st.detail) : null,
    el("p", { class: "muted small" }, "In OBS: Tools › WebSocket Server Settings: turn it on, then Show Connect Info for the password. Then Control shows OBS's scene, LIVE and REC, and switches scenes."),
    el("div", { class: "three" }, el("label", { class: "f" }, el("span", {}, "OBS PC"), host), el("label", { class: "f" }, el("span", {}, "Port"), port), el("label", { class: "f" }, el("span", {}, "Password"), pw)),
    el("div", { class: "row" },
      el("button", { class: "small primary", onclick: () => api("/api/obs", { host: host.value.trim(), port: +port.value || 4455, password: pw.value, on: true }).then(() => toast("Connecting to OBS…")) }, "Save and connect"),
      st.state === "on" ? el("button", { class: "small", onclick: () => api("/api/obs/add", {}).then(r => toast(r.added.length ? `Added ${r.added.join(", ")} to OBS` : "Already in OBS")) }, "Add StandBy GFX to OBS") : null),
    el("h4", {}, "When OBS shows a scene"),
    el("p", { class: "muted small" }, "Take a graphic in or out by itself when OBS switches to a scene. (To switch OBS when a graphic goes on air, pick the scene in Composer › the graphic.)"),
    ...rules.map((r, i) => el("div", { class: "row" },
      el("select", { "aria-label": "Scene", onchange: e => { r.scene = e.target.value; saveRules(); } }, ...[...new Set([r.scene, ...(st.scenes || [])])].filter(Boolean).map(s => el("option", { value: s, selected: s === r.scene }, s))),
      el("span", { class: "muted small" }, "→"),
      el("select", { "aria-label": "In or out", onchange: e => { r.action = e.target.value; saveRules(); } }, el("option", { value: "in", selected: r.action !== "out" }, "take in"), el("option", { value: "out", selected: r.action === "out" }, "take out")),
      el("select", { "aria-label": "Graphic", onchange: e => { r.comp = e.target.value; saveRules(); } }, ...comps.map(c => el("option", { value: c.id, selected: c.id === r.comp }, c.name))),
      el("button", { class: "small ghost", "aria-label": "Remove rule", onclick: () => { rules.splice(i, 1); saveRules(); } }, "✕"))),
    el("button", { class: "small", onclick: () => { rules.push({ scene: (st.scenes || [])[0] || "", comp: (comps[0] || {}).id, action: "in" }); saveRules(); } }, "+ Add a rule"));
}

// Control: OBS's scenes as buttons (the one on air lit), LIVE / REC.
function bar() {
  const box = $("#obs-bar");
  if (!box) return;
  const o = O(), st = o.status || {};
  box.hidden = !o.on;
  if (!o.on) return;
  box.replaceChildren(el("span", { class: "muted small" }, "OBS"),
    st.state !== "on" ? el("span", { class: "small warn-text" }, STATE[st.state] || "") : "",
    ...(st.scenes || []).map(s => el("button", { class: "small" + (s === st.scene ? " on" : ""), onclick: () => api("/api/obs/scene", { scene: s }) }, s)),
    el("span", { class: "spacer" }),
    el("span", { class: "pill" + (st.live ? " live" : "") }, st.live ? "● LIVE" : "Not live"),
    el("span", { class: "pill" + (st.rec ? " live" : "") }, st.rec ? "● REC" : "Not recording"));
}
App.on((st, msg) => {
  if (!msg || msg.obs) {
    bar();
    if (App.page === "outputs") { const c = $("#obs-card"), f = c && c.contains(document.activeElement); if (c && !f) c.replaceWith(obsCard()); }
  }
});
