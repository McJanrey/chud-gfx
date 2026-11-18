// Rotator: one item at a time (a picture and / or words), each for `secs`, with a swap animation.
// Items come from the layer's list or a data table's columns. The turn is worked out from the clock,
// so every output shows the same item at the same moment.
// Ticker: the items end to end, scrolling.
import { scrollIn, fontReady } from "./text.js";

function items(layer, ctx) {
  if (layer.source) {
    // a table: one item per row, its text / picture from the named columns
    const rows = ctx.table(layer.source) || [];
    const head = (rows[0] || []).map(h => String(h).toLowerCase());
    const ti = head.indexOf(String(layer.textCol || "").toLowerCase()), ii = head.indexOf(String(layer.imgCol || "").toLowerCase());
    return rows.slice(1).map(r => ({ text: ti >= 0 ? r[ti] : "", img: ii >= 0 ? r[ii] : "" })).filter(x => x.text || x.img);
  }
  return (layer.items || []).map(x => ({ text: ctx.resolve(x.text || ""), img: ctx.resolve(x.img || "") })).filter(x => x.text || x.img);
}

function itemEl(it, layer, ctx, full) {
  const d = document.createElement("div");
  Object.assign(d.style, { position: "absolute", inset: "0", display: "flex", alignItems: "center", justifyContent: "center", gap: "16px" });
  if (it.img) {
    const img = document.createElement("img");
    img.src = ctx.url(it.img);
    img.draggable = false;
    Object.assign(img.style, it.text || !full ? { height: (+layer.imgSize || 80) + "px", width: "auto", objectFit: "contain" }
      : { width: "100%", height: "100%", objectFit: layer.fit === "fill" ? "fill" : layer.fit === "cover" ? "cover" : "contain" });
    d.appendChild(img);
  }
  if (it.text) {
    const t = document.createElement("span");
    Object.assign(t.style, { fontFamily: `"${String(layer.font || "Inter").replace(/"/g, "")}", Inter, sans-serif`, fontSize: (+layer.size || 36) + "px",
      color: ctx.resolve(layer.color || "#fff"), fontWeight: String(layer.weight || 600), fontStyle: layer.italic ? "italic" : "normal",
      textTransform: layer.caps ? "uppercase" : "none", letterSpacing: (+layer.tracking || 0) / 1000 + "em", whiteSpace: "nowrap" });
    t.textContent = it.text;
    d.appendChild(t);
  }
  return d;
}

// shuffle the same way on every output (seeded by the list)
function order(n, shuffle, seed) {
  const idx = [...Array(n).keys()];
  if (!shuffle) return idx;
  let s = seed || 1;
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5) >>> 0) / 4294967296;
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx;
}

const SWAPS = {
  cut: [[], []],
  crossfade: [[{ opacity: 0 }, { opacity: 1 }], [{ opacity: 1 }, { opacity: 0 }]],
  "alpha fade": [[{ opacity: 0 }, { opacity: 1 }], [{ opacity: 1 }, { opacity: 0 }]],
  fade: [[{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], [{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }]],
  "slide up": [[{ transform: "translateY(100%)", opacity: 0 }, { transform: "none", opacity: 1 }], [{ transform: "none", opacity: 1 }, { transform: "translateY(-100%)", opacity: 0 }]],
  "slide left": [[{ transform: "translateX(100%)", opacity: 0 }, { transform: "none", opacity: 1 }], [{ transform: "none", opacity: 1 }, { transform: "translateX(-100%)", opacity: 0 }]],
  push: [[{ transform: "translateX(100%)" }, { transform: "none" }], [{ transform: "none" }, { transform: "translateX(-100%)" }]],
  flip: [[{ transform: "perspective(600px) rotateX(-90deg)", opacity: 0 }, { transform: "none", opacity: 1 }], [{ transform: "none", opacity: 1 }, { transform: "perspective(600px) rotateX(90deg)", opacity: 0 }]],
  zoom: [[{ transform: "scale(.6)", opacity: 0 }, { transform: "none", opacity: 1 }], [{ transform: "none", opacity: 1 }, { transform: "scale(1.3)", opacity: 0 }]],
  blur: [[{ filter: "blur(14px)", opacity: 0 }, { filter: "none", opacity: 1 }], [{ filter: "none", opacity: 1 }, { filter: "blur(14px)", opacity: 0 }]],
  wipe: [[{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], [{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 0 0 100%)" }]],
};
export const rotatorSwaps = Object.keys(SWAPS);

export function rotator(el, layer, ctx) {
  el.style.overflow = "hidden";
  const list = items(layer, ctx);
  if (!list.length) return;
  const secs = Math.max(0.5, +layer.secs || 5), ms = +layer.swapMs || 600;
  const seq = order(list.length, layer.order === "shuffle", list.length * 7919 + (layer.id || "").length);
  const full = list.every(x => x.img && !x.text);
  let shown = -1, cur = null;
  const step = () => {
    if (!el.isConnected && shown >= 0) return clearInterval(timer);
    const now = ctx.now() / 1000, k = seq[Math.floor(now / secs) % list.length];
    if (k === shown) return;
    const next = itemEl(list[k], layer, ctx, full);
    el.appendChild(next);
    const sw = SWAPS[layer.swap] || SWAPS.crossfade;
    if (cur && sw[0].length) {
      next.animate(sw[0], { duration: ms, easing: "ease-in-out" });
      const old = cur;
      old.animate(sw[1], { duration: ms, easing: "ease-in-out", fill: "forwards" }).finished.then(() => old.remove(), () => old.remove());
    } else if (cur) cur.remove();
    cur = next; shown = k;
  };
  step();
  const timer = setInterval(step, 200);
}

export function ticker(el, layer, ctx) {
  el.style.overflow = "hidden";
  const list = items(layer, ctx);
  if (!list.length) return;
  const track = document.createElement("div");
  Object.assign(track.style, { position: "absolute", top: "0", bottom: "0", left: "0", display: "flex", alignItems: "center", whiteSpace: "nowrap", willChange: "transform", visibility: "hidden" });   // (shown once its slide-in starts)
  const gap = +layer.gap || 60, sep = layer.sep ?? layer.separator ?? "";   // (GFX Baby saves it as "sep"; none unless one is set)
  const run = () => list.flatMap((it, i) => {
    const d = itemEl(it, layer, ctx, false);
    Object.assign(d.style, { position: "relative", inset: "auto", flex: "none", paddingRight: gap / 2 + "px", paddingLeft: i ? gap / 2 + "px" : "0" });
    if (!sep) return [d];
    const s = itemEl({ text: sep }, layer, ctx, false);
    Object.assign(s.style, { position: "relative", inset: "auto", flex: "none" });
    return [d, s];
  });
  const copy = () => { const h = document.createElement("div"); Object.assign(h.style, { display: "flex", alignItems: "center", flex: "none", paddingRight: gap / 2 + "px" }); h.append(...run()); track.append(h); return h; };
  const a = copy();
  copy();
  el.appendChild(track);
  if (layer.fade) el.style.maskImage = el.style.webkitMaskImage = "linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)";
  // Measured once the pictures and the font have loaded (before that a logo is 0 wide, words are in the stand-in font,
  // so the loop jumped back early),
  // with enough copies end to end that the strip never runs out before it wraps.
  const hold = ctx.hold ? ctx.hold(layer) : 0, born = performance.now();
  const start = async (tries = 0) => {
    await Promise.all([...a.querySelectorAll("img")].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
    await fontReady(layer, layer.weight || 600, +layer.size || 36, a.textContent);
    const w = a.offsetWidth;
    if (!w) return tries < 50 && setTimeout(() => start(tries + 1), 100);   // (not on the page yet)
    while (track.children.length < Math.ceil((el.offsetWidth || 1920) / w) + 1) copy();
    track.style.visibility = "";
    scrollIn(track, el.offsetWidth || 1920, w, Math.max(10, +layer.speed || 120), Math.max(0, hold - (performance.now() - born)), layer.id, ctx.entering !== false);   // (empty while it animates in)
  };
  requestAnimationFrame(() => start());
}
