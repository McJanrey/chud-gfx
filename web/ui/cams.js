// Cameras: guests' webcams through VDO.Ninja. Each camera has a guest link (they open it and pick their camera)
// and is shown by Camera layers and its own output page. Look (colour) and framing are set here, once.
import { $, el, api, App, pages, toast } from "./lib.js";


const busy = () => { const p = $("#page-cams"); return p && p.contains(document.activeElement) && document.activeElement.matches("input, select"); };
const copy = (t, what) => navigator.clipboard.writeText(t).then(() => toast(`Copied ${what}`), () => toast(t));
export function guestUrl(cam, pw) {
  const q = new URLSearchParams({ push: cam.stream, label: cam.name });
  if (pw) q.set("password", pw);
  return "https://vdo.ninja/?" + q.toString();
}

function render() {
  if (App.page !== "cams" || busy()) return;
  const P = App.state.project, all = JSON.parse(JSON.stringify(P.cams || [])), pw = P.cam_password || "";
  const save = () => api("/api/cams", { cams: all });
  const looks = P.cam_looks || [];
  const port = (App.state.app || {}).port || location.port;
  const lookSel = el("select", { "aria-label": "Look" }, ...(looks.length ? looks.map(l => el("option", { value: l.name }, l.name)) : [el("option", { value: "" }, "None saved")]));
  const slider = (c, k, label, min, max, def, unit = "") => {
    const out = el("span", { class: "muted small" }, (c[k] ?? def) + unit);
    return el("label", { class: "f" }, el("span", {}, label), el("div", { class: "row" },
      el("input", { type: "range", min, max, step: k === "zoom" ? 0.05 : 1, value: c[k] ?? def,
        oninput: e => { c[k] = +e.target.value; out.textContent = e.target.value + unit; },
        onchange: save }), out));
  };
  const card = c => el("section", { class: "card cam-card" },
    el("div", { class: "row" }, el("input", { value: c.name, "aria-label": "Camera name", class: "title-in", onchange: e => { c.name = e.target.value; save(); } }),
      el("button", { class: "small ghost", "aria-label": `Remove ${c.name}`, onclick: () => { if (confirm(`Remove the camera "${c.name}"? Its guest link stops working.`)) { all.splice(all.indexOf(c), 1); save(); } } }, "✕")),
    el("div", { class: "cam-slot", "data-slot": c.id }),   // (the live picture is drawn here: camdock.js)
    (() => { const st = ((App.state.cam_status || {})[c.id] || {}).state || "waiting";
      return el("span", { class: "cam-state st-" + st }, { live: "● Live", lost: "● Connection lost", waiting: "○ Waiting for the guest" }[st]); })(),
    el("div", { class: "row" },
      el("button", { class: "small primary", onclick: () => copy(guestUrl(c, pw), "the guest link") }, "Copy guest link"),
      el("button", { class: "small", onclick: () => copy(`http://127.0.0.1:${port}/cam?id=${c.id}`, "the output link") }, "Copy output link"),
      el("button", { class: "small ghost", title: "A new link: the old one stops working", onclick: () => { c.stream = Math.random().toString(36).slice(2, 12); save(); toast("New guest link: send it again"); } }, "New link")),
    el("details", {}, el("summary", { class: "muted small" }, "Use another VDO.Ninja link instead"),
      el("input", { value: c.link || "", placeholder: "https://vdo.ninja/?view=… (a view link from a VDO.Ninja room)", onchange: e => { c.link = e.target.value.trim(); save(); } })),
    el("h4", {}, "Look"),
    slider(c, "bright", "Brightness", 0, 200, 100, "%"), slider(c, "contrast", "Contrast", 0, 200, 100, "%"),
    slider(c, "sat", "Saturation", 0, 200, 100, "%"), slider(c, "warm", "Warmth", -100, 100, 0),
    el("h4", {}, "Framing"),
    slider(c, "zoom", "Zoom", 1, 4, 1, "×"), slider(c, "x", "Left / right", -100, 100, 0), slider(c, "y", "Up / down", -100, 100, 0),
    el("label", { class: "switch" }, el("input", { type: "checkbox", checked: !!c.mirror, onchange: e => { c.mirror = e.target.checked; save(); } }), "Mirror"));
  $("#cams-body").replaceChildren(
    el("section", { class: "card wide" },
      el("div", { class: "row" }, el("h3", {}, "Looks"), lookSel,
        el("button", { class: "small", onclick: () => lookSel.value && api("/api/cams/look", { action: "recall", name: lookSel.value }).then(() => toast(`Recalled "${lookSel.value}"`)) }, "Recall"),
        el("button", { class: "small", onclick: () => { const n = prompt("Save every camera's colours as", lookSel.value || "Main lights"); if (n) api("/api/cams/look", { action: "save", name: n }); } }, "Save as…"),
        el("button", { class: "small ghost", onclick: () => lookSel.value && confirm(`Delete the look "${lookSel.value}"?`) && api("/api/cams/look", { action: "delete", name: lookSel.value }) }, "Delete"),
        el("span", { class: "spacer" }),
        el("button", { class: "small primary", onclick: () => { all.push({ name: `Camera ${all.length + 1}` }); save(); } }, "+ Camera")),
      el("p", { class: "muted small" }, "Send each guest their link: they open it, pick their camera and mic, and press Start. Graphics show a camera with a Camera layer (Composer › Live), or add its output link to OBS as a browser source (tick Control audio via OBS). Each card shows its camera live, with whether it's connected (the status keeps updating on the other pages too). Every other place showing a camera (OBS sources) is one more upload for the guest.")),
    ...(all.length ? all.map(card) : [el("p", { class: "muted empty" }, "No cameras yet: + Camera makes one with its own guest link. Name them Caster 1-4 for the caster boxes.")]));
}
pages.cams = { shown: render };
App.on((st, msg) => { if (!msg || msg.project || msg.cam_status) render(); });
