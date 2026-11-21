// What every layer shares: its box on the 1920x1080 canvas, opacity, rotation, blend.
export function box(layer) {
  const el = document.createElement("div");
  el.className = "sg-layer";
  const s = el.style;
  s.left = (layer.x || 0) + "px";
  s.top = (layer.y || 0) + "px";
  s.width = Math.max(0, layer.w || 0) + "px";
  s.height = Math.max(0, layer.h || 0) + "px";
  if (layer.opacity != null && +layer.opacity !== 1) s.opacity = String(layer.opacity);
  if (+layer.rotation) s.rotate = `${+layer.rotation}deg`;
  if (layer.blend && layer.blend !== "normal") s.mixBlendMode = layer.blend;
  if (layer.visible === false) s.display = "none";
  return el;
}

// The value a field override or live data gives a layer's main content.
export function content(layer, key, values, resolve) {
  const v = layer.field && values && values[layer.field] != null && values[layer.field] !== "" ? values[layer.field] : layer[key];
  return resolve(v == null ? "" : String(v));
}

// move: "dx dy scale" from live data (e.g. a caster box's place for 1-4 boxes), about origin [x, y]
// on the canvas. Empty: the layer isn't shown.
export function placeMove(el, layer, resolve) {
  if (layer.move == null || layer.move === "") return;
  const v = String(resolve(String(layer.move))).trim();
  if (!v) { el.style.display = "none"; return; }
  const [dx, dy, sc] = v.split(/\s+/).map(Number);
  const [ox, oy] = Array.isArray(layer.origin) ? layer.origin : [layer.x || 0, layer.y || 0];
  el.style.transformOrigin = `${ox - (layer.x || 0)}px ${oy - (layer.y || 0)}px`;
  el.style.transform = `translate(${dx || 0}px, ${dy || 0}px) scale(${sc || 1})`;
}

// Effects on the whole layer: fx = {shadow: {x, y, blur, color}, glow: {blur, color}, blur: {blur}, backdrop: {blur}}
// Frames: a layer (usually a picture) cut to a shape.
const CLIPS = {
  circle: "ellipse(50% 50% at 50% 50%)", rounded: "inset(0 round 12%)", hexagon: "polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)",
  diamond: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)", triangle: "polygon(50% 0, 100% 100%, 0 100%)", shield: "polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%)",
  parallelogram: "polygon(18% 0, 100% 0, 82% 100%, 0 100%)", star: "polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
};
export const clipShapes = Object.keys(CLIPS);

export function effects(el, layer, resolve) {
  if (CLIPS[layer.clip]) el.style.clipPath = CLIPS[layer.clip];
  // radius "tl tr br bl" (each corner its own, any layer: what's inside is cut to it); a single number on a picture too
  const r = String(layer.radius ?? "").trim();
  if (/^\d+(\.\d+)?(\s+\d+(\.\d+)?){3}(\s*\/(\s*\d+(\.\d+)?){4})?$/.test(r) || (layer.type !== "rect" && +r > 0)) {   // (+ " / v v v v": elliptical)
    el.style.borderRadius = r.replace(/\//g, " / ").split(/\s+/).filter(Boolean).map(x => x === "/" ? x : x + "px").join(" ");
    el.style.overflow = "hidden";
  }
  // (GFX Baby keeps an effect that's switched off with "on": false)
  const fx = Object.fromEntries(Object.entries(layer.fx || {}).filter(([, v]) => v && v.on !== false)), f = [];
  const n = (o, k, d) => (o && o[k] != null && o[k] !== "" ? +o[k] : d);
  if (fx.shadow) f.push(`drop-shadow(${n(fx.shadow, "x", 0)}px ${n(fx.shadow, "y", 8)}px ${n(fx.shadow, "blur", 16)}px ${resolve(fx.shadow.color || "rgba(0,0,0,.5)")})`);
  if (fx.glow) f.push(`drop-shadow(0 0 ${n(fx.glow, "blur", 16)}px ${resolve(fx.glow.color || "#ffffff")})`);
  if (fx.blur) f.push(`blur(${n(fx.blur, "blur", n(fx.blur, "amount", 6))}px)`);
  if (f.length) el.style.filter = f.join(" ");
  if (fx.inner) el.style.boxShadow = `inset ${n(fx.inner, "x", 0)}px ${n(fx.inner, "y", 4)}px ${n(fx.inner, "blur", 8)}px ${resolve(fx.inner.color || "#000000")}`;
  if (fx.backdrop) el.style.backdropFilter = el.style.webkitBackdropFilter = `blur(${n(fx.backdrop, "blur", n(fx.backdrop, "amount", 12))}px)`;
}

// Picture adjustments: pic = {bright, contrast, sat, gray, hue, flipX, flipY, crop: {l, t, r, b} (% off each edge)}
export function picture(media, layer) {
  const p = layer.pic || {}, f = [];
  if (p.bright != null && +p.bright !== 100) f.push(`brightness(${+p.bright}%)`);
  if (p.contrast != null && +p.contrast !== 100) f.push(`contrast(${+p.contrast}%)`);
  if (p.sat != null && +p.sat !== 100) f.push(`saturate(${+p.sat}%)`);
  if (+p.gray) f.push(`grayscale(${+p.gray}%)`);
  if (+p.hue) f.push(`hue-rotate(${+p.hue}deg)`);
  if (f.length) media.style.filter = [media.style.filter, ...f].filter(Boolean).join(" ");
  if (p.flipX || p.flipY) media.style.transform = `scale(${p.flipX ? -1 : 1}, ${p.flipY ? -1 : 1})`;
  const c = p.crop;
  if (c && (+c.l || +c.t || +c.r || +c.b)) {
    const l = +c.l || 0, t = +c.t || 0, w = 100 - l - (+c.r || 0), h = 100 - t - (+c.b || 0);
    if (w > 1 && h > 1) Object.assign(media.style, { inset: "auto", objectFit: "fill", width: 10000 / w + "%", height: 10000 / h + "%", left: -l * 100 / w + "%", top: -t * 100 / h + "%" });   // (inset first: set after, it reset left / top)
    if (media.parentElement) media.parentElement.style.overflow = "hidden";
  }
}
