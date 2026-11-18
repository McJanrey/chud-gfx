// Transitions and Outputs pages, and the "Program connected" check in the page bar.
import { $, el, api, App, pages, picker, toast, typingIn } from "./lib.js";
import { obsCard } from "./obs.js";
import { rlCard } from "./rocket.js";

// --- Transitions ----------------------------------------------------------------
const list = () => (App.state.project.transitions || []).map(t => ({ ...t }));
const saveT = (items, def) => api("/api/transitions", { transitions: items, default: def });
const NEW = { fade: { type: "fade", name: "Fade", dur: 500 }, dip: { type: "dip", name: "Dip to black", color: "#000000", dur: 800 },
  wipe: { type: "wipe", name: "Wipe", direction: "left", dur: 600 }, stinger: { type: "stinger", name: "Stinger", src: "", cut: 500, audio: true, volume: 1 },
  delay: { type: "delay", name: "Delay", ms: 500 }, merge: { type: "merge", name: "Merge", dur: 700 } };
const lab = (t, input) => el("label", { class: "f" }, el("span", {}, t), input);

function tCard(t, i, items) {
  const def = App.state.project.default_transition === t.id;
  const set = (k, v) => { items[i] = { ...items[i], [k]: v }; saveT(items); };
  const num = (k, v, extra = {}) => el("input", { type: "number", value: v ?? 0, min: 0, ...extra, onchange: e => set(k, +e.target.value || 0) });
  const params = {
    fade: () => [lab("Length (ms)", num("dur", t.dur ?? 500, { step: 50 }))],
    dip: () => [el("div", { class: "two" }, lab("Length (ms)", num("dur", t.dur ?? 800, { step: 50 })), lab("Colour", el("input", { type: "color", value: t.color || "#000000", onchange: e => set("color", e.target.value) })))],
    wipe: () => [el("div", { class: "two" }, lab("Length (ms)", num("dur", t.dur ?? 600, { step: 50 })),
      lab("Direction", el("select", { onchange: e => set("direction", e.target.value) }, ...["left", "right", "up", "down"].map(d => el("option", { value: d, selected: (t.direction || "left") === d }, d)))))],
    stinger: () => {
      const find = src => api("/api/stinger/cut", { src }).then(r => { set("cut", r.cut); toast(`Covers the screen at ${r.cut} ms`); }, () => {});
      const pv = t.src ? el("video", { src: t.src, class: "stinger-pv", controls: true, muted: true, onloadedmetadata: e => { e.target.currentTime = (t.cut ?? 500) / 1000; } }) : null;
      return [lab("Video (see-through WebM)", picker("video", t.src || "", v => { set("src", v); if (v) find(v); }, "stingers")),
        el("div", { class: "two" }, lab("Swap under it at (ms)", num("cut", t.cut ?? 500, { step: 10 })), lab("Volume", num("volume", t.volume ?? 1, { step: 0.1, max: 1 }))),
        t.src ? el("div", { class: "row" }, el("button", { class: "small", onclick: () => find(t.src) }, "Find the cut point"),
          el("button", { class: "small ghost", onclick: () => set("cut", Math.round(pv.currentTime * 1000)) }, "Use the frame showing")) : null,
        el("label", { class: "switch" }, el("input", { type: "checkbox", checked: t.audio !== false, onchange: e => set("audio", e.target.checked) }), "Sound"),
        pv];
    },
    delay: () => [lab("Wait (ms)", num("ms", t.ms ?? 500, { step: 50 }))],
    merge: () => [el("p", { class: "muted small" }, "Board to board: layers with the same name in both graphics glide to their new place and size (and stay if they're the same); the rest plays its Out and In."),
      lab("Length (ms)", num("dur", t.dur ?? 700, { step: 50 }))],
  }[t.type];
  return el("section", { class: "card" },
    el("div", { class: "row" }, el("label", { class: "switch" }, el("input", { type: "checkbox", checked: t.enabled !== false, onchange: e => set("enabled", e.target.checked) })),
      el("input", { value: t.name, "aria-label": "Name", onchange: e => set("name", e.target.value) }),
      el("span", { class: "tag" }, t.type),
      def ? el("span", { class: "tag on" }, "Default") : el("button", { class: "small", onclick: () => saveT(items, t.id) }, "Make default"),
      el("button", { class: "small ghost", "aria-label": "Delete", onclick: () => { items.splice(i, 1); saveT(items).catch(() => {}); } }, "✕")),
    ...(params ? params() : [el("p", { class: "muted small" }, t.type === "animate" ? "Each graphic plays its own In and Out animations." : "Straight away, no animation.")]));
}
let tSig = "";
function renderTransitions() {
  const s = JSON.stringify([App.state.project.transitions, App.state.project.default_transition]);
  if (s === tSig || typingIn($("#page-transitions"))) return;
  tSig = s;
  const items = list();
  const own = t => t.type === "animate" || t.type === "cut";
  const def = App.state.project.default_transition, ownDefault = !items.some(t => t.id === def && !own(t));
  $("#tr-grid").replaceChildren(
    el("section", { class: "card" }, el("h3", {}, "The graphics' own animations"),
      el("p", { class: "muted small" }, "TAKE plays each layer's In and Out animation (set in Composer). Light a transition on the take bar to use it instead; CUT is always a hard cut."),
      ownDefault ? el("span", { class: "tag on" }, "Default") : el("button", { class: "small", onclick: () => saveT(items, "animate") }, "Make default")),
    ...items.map((t, i) => own(t) ? null : tCard(t, i, items)).filter(Boolean));
}
for (const [k] of Object.entries(NEW)) document.querySelector(`[data-new-tr="${k}"]`)?.addEventListener("click", () => saveT([...list(), { ...NEW[k] }]));
pages.transitions = { shown() { tSig = ""; renderTransitions(); } };

// --- Outputs --------------------------------------------------------------------
function copyRow(label, url, count) {
  return el("div", { class: "url-row" }, el("span", { class: "lbl" }, label, count ? el("span", { class: "dot-on", title: `${count} connected` }, ` ●${count > 1 ? " ×" + count : ""}`) : ""),
    el("code", {}, url),
    el("button", { class: "small", onclick: () => navigator.clipboard.writeText(url).then(() => toast("Copied")) }, "Copy"),
    el("a", { class: "btn small ghost", href: url, target: "_blank" }, "Open"));
}
let oSig = "";
function renderOutputs() {
  const st = App.state, outs = st.outputs || {};
  const s = JSON.stringify([st.project.compositions.map(c => [c.id, c.name, c.output !== false]), outs, st.app]);
  if (s === oSig) return;
  oSig = s;
  const net = (st.app || {}).network || {};
  const port = (st.app || {}).port || location.port, hosts = ["localhost", ...(net.network ? (net.bind ? [net.bind] : (st.app || {}).addresses || []) : [])];
  const base = h => `http://${h}:${port}`;
  $("#out-list").replaceChildren(
    ...hosts.map(h => el("div", { class: "card" }, el("h3", {}, h === "localhost" ? "On this PC" : `From other PCs (${h})`),
      copyRow("Program", base(h) + "/output", outs.program), copyRow("Preview", base(h) + "/output?bus=preview", outs.preview))),
    el("div", { class: "card" }, el("h3", {}, "One graphic each"),
      el("p", { class: "muted small" }, "On, a link always shows its graphic (its Program values, or else its Preview ones): add the ones you want to OBS as browser sources (1920 × 1080). Off, it shows nothing, so a source you aren't using costs the PC nothing."),
      ...st.project.compositions.map(c => el("div", { class: "out-one" },
        el("label", { class: "switch", title: c.output !== false ? "Its own output is on" : "Its own output is off" }, el("input", { type: "checkbox", checked: c.output !== false, "aria-label": `${c.name}: its own output`,
          // (the live graphic: this list only redraws on name/output, so c can hold old layers)
          onchange: e => api("/api/comp", { comp: { ...(App.state.project.compositions.find(x => x.id === c.id) || c), output: e.target.checked } }) }), ""),
        copyRow(c.name, base(hosts[hosts.length - 1]) + "/output?comp=" + c.id, outs["comp:" + c.id])))),
    networkCard(), exportCard());
  $("#out-list").prepend(obsCard(), rlCard());
}
function exportCard() {
  const comps = App.state.project.compositions || [], boxes = comps.map(c => el("input", { type: "checkbox", value: c.id }));
  const ids = () => boxes.filter(b => b.checked).map(b => b.value).join(",");
  const go = path => { const i = ids(); if (!i) return toast("Tick the graphics first"); location.href = `${path}?ids=${encodeURIComponent(i)}`; };
  return el("div", { class: "card" }, el("h3", {}, "Export"),
    el("p", { class: "muted small" }, "The ticked graphics, to take to another StandBy GFX (pack) or to play without the engine (HTML: CasparCG / SPX template, or any browser; play(), stop(), next(), update(data))."),
    el("div", { class: "export-list" }, ...comps.map((c, i) => el("label", { class: "switch" }, boxes[i], c.name))),
    el("div", { class: "row" }, el("button", { class: "small", onclick: () => go("/api/export") }, "Export pack"), el("button", { class: "small", onclick: () => go("/api/export/html") }, "Export HTML")));
}
let engines = null;
function networkCard() {
  const app = App.state.app || {}, net = app.network || {}, addrs = app.addresses || [];
  const save = change => api("/api/network", change);
  return el("div", { class: "card" }, el("h3", {}, "Network"),
    el("label", { class: "switch" }, el("input", { type: "checkbox", checked: !!net.network, onchange: e => save({ network: e.target.checked }) }), "Let other PCs use this engine (outputs, control panel, finding it)"),
    el("label", { class: "f" }, el("span", {}, "Other PCs reach it on"), el("select", { onchange: e => save({ bind: e.target.value }) },
      el("option", { value: "" }, "Every network on this PC"), ...addrs.map(a => el("option", { value: a, selected: net.bind === a }, a)))),
    el("p", { class: "muted small" }, "Pick one (your NDI VLAN, say) to keep the engine to it."),
    el("label", { class: "f" }, el("span", {}, "This engine's name on the network"), el("input", { value: net.name || "", onchange: e => save({ name: e.target.value }) })),
    el("h4", {}, "Bitfocus Companion (Stream Deck)"),
    el("p", { class: "muted small" }, "Import Chud-GFX-Companion-module.tgz (from the release) on Companion's Modules page, then add a StandBy GFX connection with:"),
    copyRow("On this PC", "127.0.0.1"), ...(net.network ? addrs.filter(a => !net.bind || a === net.bind).map(a => copyRow("From another PC", a)) : []), copyRow("Port", String(app.port || location.port)),
    el("div", { class: "row" }, el("h4", {}, "Engines on the network"), el("span", { class: "spacer" }),
      el("button", { class: "small", onclick: async () => { engines = (await api("/api/network/scan")).engines; oSig = ""; renderOutputs(); } }, "Scan")),
    engines == null ? el("p", { class: "muted small" }, "Scan finds every StandBy GFX with its network on.")
      : engines.length ? el("div", {}, ...engines.map(x => copyRow(x.name, `http://${x.address}:${x.port}/control`)))
      : el("p", { class: "muted small" }, "None answered."));
}
pages.outputs = { shown() { oSig = ""; renderOutputs(); } };

// --- page bar: is Program really shown somewhere? -------------------------------
function renderCheck() {
  const n = (App.state.outputs || {}).program || 0, p = $("#out-pill");
  p.textContent = n ? `Program out ×${n}` : "Program not connected";
  p.classList.toggle("ok", !!n); p.classList.toggle("warn", !n);
}

App.on(() => { renderCheck(); if (App.page === "transitions") renderTransitions(); if (App.page === "outputs") renderOutputs(); });
