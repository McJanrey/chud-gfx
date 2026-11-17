// Text layers: font, size, colour, alignment, tracking, caps, and "shrink to fit" (Spec 01 section 2).
import { content } from "./box.js";
import { ticks } from "../data.js";

const JUSTIFY = { left: "flex-start", center: "center", right: "flex-end" };
const ALIGN = { top: "flex-start", middle: "center", bottom: "flex-end" };

export function text(el, layer, ctx) {
  const s = el.style;
  s.display = layer.visible === false ? "none" : "flex";
  s.justifyContent = JUSTIFY[layer.align] || "flex-start";
  s.alignItems = ALIGN[layer.valign] || "center";
  const span = document.createElement("span");
  span.className = "sg-text";
  const t = span.style;
  const fam = String(layer.font || "Inter").replace(/"/g, "");
  t.fontFamily = `"${fam}", ${standIn(fam)}, Inter, sans-serif`;
  t.fontSize = (+layer.size || 32) + "px";
  t.color = ctx.resolve(layer.color || "#ffffff");
  t.fontWeight = String(layer.weight || 400);
  if (layer.italic) t.fontStyle = "italic";
  if (+layer.tracking) t.letterSpacing = (+layer.tracking / 1000) + "em";   // (thousandths of an em, like Photoshop)
  if (layer.caps) t.textTransform = "uppercase";
  t.lineHeight = String(+layer.lineHeight || 1.2);
  t.textAlign = layer.align || "left";
  span.textContent = content(layer, "text", ctx.values, ctx.resolve);
  const raw = layer.field && ctx.values[layer.field] ? ctx.values[layer.field] : layer.text;
  el.appendChild(span);
  // ({{TIME}}: every second, redrawn the way it was first drawn, only when the words changed)
  let shown = span.textContent;
  const tick = redraw => { if (ticks(raw)) ctx.tick(() => { const v = ctx.resolve(raw); if (v !== shown) redraw(shown = v); }); };
  if (+layer.scroll > 0) return tick(scroller(el, span, layer, ctx.hold ? ctx.hold(layer) : 0, ctx.entering !== false));
  // baseline: the text's baseline sits this many px below the box's top (as the design had it)
  const fit = () => {
    // (text shrinks to fit its box unless it's set to overflow or wrap)
    if (layer.fit !== "none" && layer.fit !== "wrap") shrink(el, span, +layer.size || 32);
    // baseline: the text's baseline sits this many px below the box's top (as the design had it)
    if (layer.baseline != null && layer.baseline !== "") { s.alignItems = "flex-start"; span.style.marginTop = (+layer.baseline - baselineOf(span)) + "px"; }
  };
  tick(v => { span.textContent = v; fit(); });
  ctx.later(fit);
  // and again whenever its box gets a size: a graphic built off the page (preloaded for TAKE) measures 0 and skipped the shrink
  if (window.ResizeObserver) new ResizeObserver(() => { if (el.clientWidth) fit(); }).observe(el);
  // measured again once its font file has loaded (measuring with the stand-in font shrank it too much)
  // (with its weight and style: asking for a weight the font doesn't have finds nothing and never refits)
  if (document.fonts && layer.font) document.fonts.load(`${layer.italic ? "italic " : ""}${layer.weight || 400} ${+layer.size || 32}px "${String(layer.font).replace(/"/g, "")}"`, span.textContent || "A")
    .then(() => { if (el.isConnected) fit(); }, () => {});
}

// Smaller until it fits the box (never bigger than its set size).
export function shrink(el, span, size) {
  const W = el.clientWidth, H = el.clientHeight;
  if (!W || !H) return;   // (not laid out yet: keep the last fit, the ResizeObserver comes back)
  span.style.fontSize = size + "px";
  let lo = 4, hi = size;
  if (span.scrollWidth <= W && span.scrollHeight <= H) return;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    span.style.fontSize = mid + "px";
    if (span.scrollWidth <= W && span.scrollHeight <= H) lo = mid; else hi = mid;
  }
  span.style.fontSize = lo + "px";
}

// A ticker strip starts empty: it slides in from the right edge (W wide box) at `speed` px/s, then loops one copy (w) forever.
// Redrawn while on air (a score changed on the same graphic), it carries on from where it was instead of starting again.
const running = new Map();   // layer id -> when its slide-in started (performance.now)
export function scrollIn(track, W, w, speed, delay = 0, key = "", entering = true) {
  const introMs = W / speed * 1000, frames = [{ transform: "translateX(0)" }, { transform: `translateX(${-w}px)` }];
  const loop = at => { track.animate(frames, { duration: w / speed * 1000, iterations: Infinity, easing: "linear" }).currentTime = at; };
  const was = !entering && key ? running.get(key) : undefined;
  if (was === undefined && key) running.set(key, performance.now() + delay);
  const since = was === undefined ? -delay : performance.now() - was;
  if (since >= introMs) return loop(since - introMs);
  const intro = track.animate([{ transform: `translateX(${W}px)` }, { transform: "translateX(0)" }], { duration: introMs, easing: "linear", fill: "backwards" });
  intro.currentTime = since;   // (negative: waits that long, still empty)
  intro.onfinish = () => loop(0);
}

// Scrolling text (a ticker): right to left at layer.scroll px a second, copies end to end so it never runs out.
// Divider: the lines (kept apart by "|", as {{Global!Ticker}} is) get a bar of that colour between them.
// Returns set(words): new words ({{COUNTDOWN}} ticking) in every copy, the loop measured again if its width changed.
function scroller(el, span, layer, hold = 0, entering = true) {
  el.style.overflow = "hidden";
  el.style.justifyContent = "flex-start";
  const track = document.createElement("div");
  track.className = "sg-track";
  track.style.cssText = "display:flex;flex:none;white-space:pre;will-change:transform;align-items:center";
  const size = +layer.size || 32, gap = Math.round(size * 2);
  if (!layer.divider) span.style.paddingRight = gap + "px";
  span.remove();
  track.append(span);
  el.appendChild(track);
  const born = performance.now();
  let gen = 0, w0 = 0;
  const set = words => {
    const g = ++gen;
    if (layer.divider) {
      const parts = words.split(/\s*\|\s*/).map(p => p.trim()).filter(Boolean);
      span.replaceChildren(...parts.flatMap(p => {
        const bar = document.createElement("span");
        bar.style.cssText = `display:inline-block;vertical-align:middle;width:${+layer.dividerWidth || 5}px;height:0.9em;margin:0 ${Math.round(size * 0.75)}px;background:${layer.divider}`;
        return [document.createTextNode(p), bar];
      }));
    } else span.textContent = words;
    // (measured once its font has loaded: measured in the stand-in font, the loop jumped at every wrap)
    fontReady(layer, layer.weight || 400, size, words).then(() => requestAnimationFrame(() => {
      if (g !== gen) return;   // (newer words came while it waited)
      const k = el.getBoundingClientRect().width / el.offsetWidth || 1;
      const w = span.getBoundingClientRect().width / k;
      if (!w) return;
      // (enough copies that a line shorter than the box still fills it all the way round)
      track.replaceChildren(span);
      while (track.children.length < Math.ceil((el.offsetWidth || 1920) / w) + 1) track.append(span.cloneNode(true));
      if (w === w0) return;   // (same width: the loop carries on untouched)
      const a = w0 && track.getAnimations()[0], sp = +layer.scroll;
      const loop = at => { track.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-w}px)` }], { duration: w / sp * 1000, iterations: Infinity, easing: "linear" }).currentTime = at; };
      // (a new width on air carries on from where the strip is now: proportional digits change it most ticks,
      // and the start time would put it loops x the change away; still sliding in, it loops at the new width once in)
      if (a && a.effect && a.effect.getTiming().iterations !== Infinity) { a.onfinish = () => loop(0); w0 = w; return; }
      if (a) { const at = (a.currentTime || 0) / 1000 * sp % w0 % w; a.cancel(); loop(at / sp * 1000); w0 = w; return; }
      track.getAnimations().forEach(a => a.cancel());
      // (empty while it animates in)
      scrollIn(track, el.offsetWidth || 1920, w, +layer.scroll, Math.max(0, hold - (performance.now() - born)), layer.id, entering && !w0);
      w0 = w;
    }));
  };
  set(span.textContent);
  return set;
}

// Resolves once the layer's font file has loaded (at once with no font, or if it can't load).
export function fontReady(layer, weight, size, sample) {
  if (!document.fonts || !layer.font) return Promise.resolve();
  return document.fonts.load(`${layer.italic ? "italic " : ""}${weight} ${size}px "${String(layer.font).replace(/"/g, "")}"`, sample || "A").catch(() => {});
}

// A font that isn't installed shows in the nearest built-in one.
// (a file name of a font that's built in, "Anton-Regular", "Vazirmatn-Black": that font itself, not a look-alike)
const STANDINS = [[/^anton(-?regular)?$/i, "Anton"], [/^vazirmatn/i, "Vazirmatn"], [/^permanent ?marker/i, '"Permanent Marker"'], [/^montserrat/i, "Montserrat"],
  [/^barlow ?condensed/i, '"Barlow Condensed"'], [/^bebas ?neue/i, '"Bebas Neue"'], [/^inter(-|$)/i, "Inter"],
  [/redzone|bebas|anton|impact|cond|compressed|knockout|oswald|league gothic/i, '"Bebas Neue"'],
  [/gotham|montserrat|proxima|futura|avenir|brick/i, "Montserrat"], [/barlow|din|trade gothic|tradegothic/i, '"Barlow Condensed"']];
function standIn(fam) {
  for (const [re, f] of STANDINS) if (re.test(fam)) return f;
  return "Inter";
}

// Where the first line's baseline falls inside the span (its font's real ascent and half-leading).
const meter = document.createElement("canvas").getContext("2d");
function baselineOf(span) {
  const cs = getComputedStyle(span), size = parseFloat(cs.fontSize);
  meter.font = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
  const m = meter.measureText("Hg");
  const asc = m.fontBoundingBoxAscent || size * 0.9, desc = m.fontBoundingBoxDescent || size * 0.25;
  const lh = parseFloat(cs.lineHeight) || size * 1.2;
  return (lh - (asc + desc)) / 2 + asc;
}
