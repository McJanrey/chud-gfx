// rect, image and video layers (Spec 01 section 2).
import { content, picture } from "./box.js";
import { ticks } from "../data.js";

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
    Object.assign(d.style, { background: tint, maskImage: u, webkitMaskImage: u, maskSize: "100% 100%", webkitMaskSize: "100% 100%", maskRepeat: "no-repeat", webkitMaskRepeat: "no-repeat" });
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
  // ({{Sponsors}}: the picture changes when the turn moves on)
  if (ticks(raw)) ctx.tick(() => {
    const u = ctx.url(ctx.resolve(raw));
    if (img.src === new URL(u, location.href).href) return;
    img.src = u;
    if (layer.mono) white();
    if (layer.swap && layer.swap !== "cut") img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, easing: "ease-out" });
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
  if (speed > 0) v.playbackRate = speed;
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
}

// A web page (a live scoreboard, a chat overlay...), see-through where the page is.
export function web(el, layer, ctx) {
  const src = content(layer, "src", ctx.values, ctx.resolve);
  if (!src) return;
  const f = document.createElement("iframe");
  f.className = "sg-fill";
  Object.assign(f.style, { border: "0", background: "transparent", pointerEvents: "none" });
  f.setAttribute("allowtransparency", "true");
  f.src = /^https?:/.test(src) ? src : ctx.url(src);
  el.appendChild(f);
}
