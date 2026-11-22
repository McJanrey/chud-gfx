// rect, image and video layers (Spec 01 section 2).
import { content, picture } from "./box.js";
import { ticks, sponsorTurn } from "../data.js";

export function rect(el, layer, ctx) {
  const s = el.style;
  s.background = content(layer, "fill", ctx.values, ctx.resolve) || "transparent";
  if (+layer.radius) s.borderRadius = +layer.radius + "px";
  if (+layer.strokeWidth > 0) { s.boxSizing = "border-box"; s.border = `${+layer.strokeWidth}px solid ${ctx.resolve(layer.stroke || "#fff")}`; }
}

const SIDE = { top: "50% 0%", bottom: "50% 100%", left: "0% 50%", right: "100% 50%" };
const fitOf = f => (f === "cover" || f === "fill" ? f : "contain");

function media(tag, el, layer, ctx) {
  const src = content(layer, "src", ctx.values, ctx.resolve) || ctx.resolve(layer.placeholder || "");
  if (!src) return null;
  const m = document.createElement(tag);
  m.className = "sg-fill";
  m.style.objectFit = fitOf(layer.fit);
  if (SIDE[layer.position]) m.style.objectPosition = SIDE[layer.position];
  m.src = ctx.url(src);
  el.appendChild(m);
  picture(m, layer);
  return m;
}

export function image(el, layer, ctx) {
  // recolor: the picture's shape in one colour (a caster box in the Global caster colours)
  const tint = layer.recolor ? ctx.resolve(String(layer.recolor)) : "";
  if (tint) {
    const src = content(layer, "src", ctx.values, ctx.resolve) || ctx.resolve(layer.placeholder || "");
    if (!src) return;
    const d = document.createElement("div");
    d.className = "sg-fill";
    const u = `url("${ctx.url(src)}")`;
    const size = layer.fit === "cover" ? "cover" : "100% 100%", pos = SIDE[layer.position] || "50% 50%";   // (cover keeps the shape; otherwise stretched, as before)
    Object.assign(d.style, { background: tint, maskImage: u, webkitMaskImage: u, maskSize: size, webkitMaskSize: size, maskPosition: pos, webkitMaskPosition: pos,
      maskRepeat: "no-repeat", webkitMaskRepeat: "no-repeat" });
    if (layer.pic && layer.pic.flipX) d.style.transform = "scaleX(-1)";
    el.appendChild(d);
    return;
  }
  const raw = layer.field && ctx.values[layer.field] ? ctx.values[layer.field] : layer.src;
  if (ALL.test(String(raw || ""))) return strip(el, layer, ctx);
  const img = media("img", el, layer, ctx);
  if (!img) return;
  img.draggable = false;
  const white = () => { img.style.filter = layer.mono && whiteLogos(ctx).has(ctx.resolve(raw)) ? "brightness(0) invert(1)" : ""; if (layer.pic) picture(img, layer); };
  if (layer.mono) white();
  // ({{Sponsors}}: the picture changes when the turn moves on, with a lift and fade unless set otherwise)
  const isSponsor = /\{\{\s*sponsors\s*\}\}/i.test(String(raw || ""));
  const bar = isSponsor && layer.bar ? document.createElement("div") : null;
  if (bar) {
    Object.assign(bar.style, { position: "absolute", left: "0", bottom: "0", height: (+layer.barH || 4) + "px", width: "100%", background: ctx.resolve(layer.barColor || "#ffffff"), transformOrigin: "left", zIndex: "1" });
    el.appendChild(bar);
  }
  const showLeft = () => {   // (the bar shrinks over the sponsor's seconds)
    const t = sponsorTurn({ Sponsors: ctx.table("Sponsors") });
    if (!bar || !t) return;
    bar.getAnimations().forEach(a => a.cancel());
    bar.animate([{ transform: `scaleX(${t.left / t.secs})` }, { transform: "scaleX(0)" }], { duration: t.left * 1000, easing: "linear", fill: "forwards" });
  };
  showLeft();
  if (ticks(raw)) ctx.tick(() => {
    const u = ctx.url(ctx.resolve(raw));
    if (img.src === new URL(u, location.href).href) return;
    img.src = u;
    if (layer.mono) white();
    const swap = layer.swap || "lift";
    if (swap === "lift") img.animate([{ opacity: 0, transform: "translateY(14%)" }, { opacity: 1, transform: "none" }], { duration: 600, easing: "cubic-bezier(.2, .8, .2, 1)" });
    else if (swap === "fade") img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, easing: "ease-out" });
    showLeft();
  });
}

// Sponsor logos marked "White in footer rows" (shown white on mono layers).
const ALL = /\{\{\s*sponsors all\s*\}\}/i;
const whiteLogos = ctx => new Set((ctx.table("Sponsors") || []).slice(1).filter(r => r[3]).map(r => r[0]));
// {{Sponsors all}}: every sponsor logo in a centred row (a footer strip).
function strip(el, layer, ctx) {
  const rows = (ctx.table("Sponsors") || []).slice(1).filter(r => r[0]);
  if (!rows.length) return;
  const d = document.createElement("div");
  d.className = "sg-fill";
  const h = +layer.h || 45;
  Object.assign(d.style, { display: "flex", alignItems: "center", justifyContent: "center", gap: Math.floor(h * 0.69) + "px" });
  for (const r of rows) {
    const i = document.createElement("img");
    i.src = ctx.url(r[0]);
    i.draggable = false;
    Object.assign(i.style, { height: "100%", maxWidth: h * 3.2 + "px", objectFit: "contain" });
    if (layer.mono && r[3]) i.style.filter = "brightness(0) invert(1)";
    d.appendChild(i);
  }
  el.appendChild(d);
}

export function video(el, layer, ctx) {
  const v = media("video", el, layer, ctx);
  if (!v) return;
  v.muted = !layer.audio || ctx.muted;
  v.loop = layer.loop !== false;
  v.autoplay = true;
  v.playsInline = true;
  const speed = +ctx.resolve(String(layer.speed ?? ""));
  if (speed > 0) { v.defaultPlaybackRate = v.playbackRate = speed; v.addEventListener("loadedmetadata", () => { v.playbackRate = speed; }); }   // (a video resets playbackRate as it loads: the default is what it keeps)
  // Tinted (a background loop in the team colour): the video in grey at its brightness, the colour multiplied over it.
  const tint = ctx.resolve(String(layer.tint || ""));
  if (tint) {
    el.style.background = "#000";   // (until the video draws: black under the colour, never a flat sheet of it)
    v.style.filter = `grayscale(1) brightness(${+ctx.resolve(String(layer.brightness ?? "")) || 1})`;
    const wash = document.createElement("div");
    wash.className = "sg-fill";
    wash.style.cssText += `background:${tint};mix-blend-mode:multiply`;
    el.appendChild(wash);
  }
  v.play().catch(() => {});
  el._keep = JSON.stringify([layer.id, v.src, tint, v.loop, v.playbackRate, v.muted]);   // (a redraw keeps it playing)
}

// A web page (a live scoreboard, a chat overlay...), see-through where the page is.
export function web(el, layer, ctx) {
  // (a Game HUD page made by the HUD link keeps its address in "url")
  const src = content(layer, "src", ctx.values, ctx.resolve) || ctx.resolve(String(layer.url || ""));
  if (!src) return;
  const f = document.createElement("iframe");
  f.className = "sg-fill";
  Object.assign(f.style, { border: "0", background: "transparent", pointerEvents: "none" });
  f.setAttribute("allowtransparency", "true");
  f.src = /^https?:/.test(src) ? src : ctx.url(src);
  el.appendChild(f);
}
