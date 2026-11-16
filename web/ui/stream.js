// Stream: multistream (OBS once to this PC, copied to every platform turned on).
import { $, el, api, App, pages, typingIn } from "./lib.js";

const busy = () => typingIn($("#page-stream"));
const STATE = { off: "Off", waiting: "Waiting for OBS", live: "Live", error: "Problem" };

function render() {
  if (App.page !== "stream" || busy()) return;
  const s = App.state.stream;
  if (!s) return;
  const all = JSON.parse(JSON.stringify(s.targets)), save = () => api("/api/stream/set", { targets: all });
  const host = ((App.state.app || {}).addresses || [])[0] || "this-pc";
  const st = s.status || {};
  $("#stream-body").replaceChildren(
    el("section", { class: "card wide" },
      el("div", { class: "row" }, el("h3", {}, "Multistream"),
        el("label", { class: "switch" }, el("input", { type: "checkbox", checked: s.on, onchange: e => api("/api/stream/on", { on: e.target.checked }) }), s.on ? "On" : "Off"),
        el("span", { class: "pill" + (st.state === "live" ? " live" : "") }, STATE[st.state] || st.state, st.kbps ? ` · ${st.kbps} kb/s` : ""),
        el("span", { class: "spacer" }), el("span", { class: "small" + (st.state === "error" ? " err" : " muted") }, st.detail || "")),
      s.ffmpeg ? null : el("p", { class: "err" }, "FFmpeg isn't on this PC: install it to multistream."),
      el("p", { class: "muted" }, "In OBS: Settings › Stream › Service: Custom. Server ", el("code", {}, `rtmp://${host}:${s.port}/live`),
        " (on this PC: ", el("code", {}, `rtmp://127.0.0.1:${s.port}/live`), "), any stream key. Then turn on the platforms below.")),
    el("section", { class: "card wide" }, el("h3", {}, "Platforms"),
      ...all.map((t, i) => el("div", { class: "row" },
        el("label", { class: "switch" }, el("input", { type: "checkbox", checked: t.on, onchange: e => { t.on = e.target.checked; save(); } }), ""),
        el("select", { "aria-label": "Platform", onchange: e => { t.platform = e.target.value; const p = s.platforms.find(x => x[0] === t.platform); if (p && p[2]) t.url = p[2]; if (!t.name && p) t.name = p[1]; save(); } },
          ...s.platforms.map(([k, n]) => el("option", { value: k, selected: t.platform === k }, n))),
        el("input", { value: t.name, placeholder: "Name", "aria-label": "Name", style: "max-width:140px", onchange: e => { t.name = e.target.value; save(); } }),
        el("input", { value: t.url, placeholder: "rtmp://…", "aria-label": "Server", onchange: e => { t.url = e.target.value; save(); } }),
        el("input", { type: "password", value: t.key, placeholder: "Stream key", autocomplete: "off", "aria-label": "Stream key", onchange: e => { t.key = e.target.value; save(); } }),
        el("button", { class: "small ghost", "aria-label": "Remove platform", onclick: () => { all.splice(i, 1); save(); } }, "✕"))),
      el("button", { class: "small", onclick: () => { all.push({ platform: "twitch", name: "Twitch", url: s.platforms[0][2], key: "", on: false }); save(); } }, "+ Platform"),
      el("p", { class: "muted small" }, "Stream keys stay on this PC and are never shown again after you type them. The video is copied as OBS sends it, so set OBS's bitrate for the slowest platform.")));
}
pages.stream = { shown: render };
App.on((st, msg) => { if (!msg || msg.stream) render(); });
