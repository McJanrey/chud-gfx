// The stage: draws what a bus has on (Spec 01 sections 5-7) and plays transitions.
import { box, placeMove, effects } from "./layers/box.js";
import { rect, image, video, web } from "./layers/basic.js";
import { text } from "./layers/text.js";
import { shape } from "./layers/shape.js";
import { bracket } from "./layers/bracket.js";
import { rotator, ticker } from "./layers/rotator.js";
import { lottie } from "./layers/lottie.js";
import { camera } from "./layers/camera.js";
import { play } from "./anim.js";
import { resolve, setNow, ticks, nowSkew } from "./data.js";

const DRAW = { rect, image, video, web, text, shape, bracket, rotator, ticker, lottie, camera };
const KIND_ORDER = { board: 0, overlay: 1, "lower third": 2 };
export const W = 1920, H = 1080;
const truthy = v => { const t = String(v).trim().toLowerCase(); return t !== "" && t !== "0" && t !== "false" && t !== "off" && t !== "no"; };

// Slots: a graphic that shows as many as there are (casters: 1-4). comp.slots = {on, count, axis: "x" | "y", step}.
// count blank: the slots with something typed in (any of their words, after live data); or a number / live data,
// e.g. "{{Global!Caster boxes}}". A layer's "slot": 1, 2, 3... (that slot's parts), "stretch" (a bar behind
// them all: shrinks to fit) or "follow" (moves with the bar's edge, a logo). The slots that show close up in
// order (1, 2, 4 -> three in a row) and the row moves to the middle.
export function slotFit(comp, tables, values = {}) {
  const S = comp.slots;
  if (!S || !S.on) return l => l;
  const ls = comp.layers || [], max = Math.max(0, ...ls.map(l => +l.slot || 0));
  if (max < 2) return l => l;
  const words = l => String(resolve(String(l.field && values[l.field] != null ? values[l.field] : (l.text ?? "")), tables)).trim();
  let shown;
  if (S.count && String(S.count).trim()) {
    const n = parseInt(resolve(String(S.count), tables), 10);
    const c = Math.max(1, Math.min(max, Number.isFinite(n) ? n : max));
    shown = Array.from({ length: c }, (_, i) => i + 1);
  } else {
    shown = Array.from({ length: max }, (_, i) => i + 1).filter(k => ls.some(l => +l.slot === k && l.type === "text" && words(l)));
    if (!shown.length) shown = [1];
  }
  const y = S.axis === "y", P = y ? "y" : "x", D = y ? "h" : "w";
  const at = k => Math.min(...ls.filter(l => +l.slot === k).map(l => +l[P] || 0));
  const step = +S.step || (at(2) - at(1)) || 0, shift = (max - shown.length) * step / 2;
  return l => {
    const k = +l.slot || 0;
    if (k) {
      const j = shown.indexOf(k);
      if (j < 0) return null;
      return { ...l, [P]: (+l[P] || 0) + (j + 1 - k) * step + shift };
    }
    if (l.slot === "follow") return { ...l, [P]: (+l[P] || 0) + shift };
    if (l.slot === "stretch") return { ...l, [P]: (+l[P] || 0) + shift, [D]: Math.max(1, (+l[D] || 0) - 2 * shift) };
    return l;
  };
}

export class Stage {
  constructor(root, { bus = "program", comp = null, muted = false, base = "", editor = false } = {}) {
    this.root = root;
    this.opts = { bus, comp, muted, base, editor };
    this.on = new Map();          // comp id -> {el, sig}
    this.cutSeq = null;
    root.classList.add("sg-stage");
    setInterval(() => { for (const o of this.on.values()) (o.el._ticks || []).forEach(fn => fn()); }, 1000);
  }

  url(src) { return /^(https?:|data:|blob:)/.test(src) ? src : this.opts.base + "/" + encodeURI(src.replace(/^\/+/, "")); }

  // What this output should show now: [ids], and each one's values.
  wanted(state) {
    const comps = new Map(state.project.compositions.map(c => [c.id, c]));
    const c = this.opts.comp;
    // (a graphic's own output switched off in Outputs shows nothing)
    if (c) return { ids: comps.has(c) && comps.get(c).output !== false ? [c] : [], comps, values: { [c]: Object.assign({}, state.live.preview.values[c], state.live.program.values[c]) } };
    const bus = state.live[this.opts.bus];
    return { ids: bus.on.filter(id => comps.has(id)), comps, values: bus.values || {} };
  }

  // Every picture the graphics use, loaded and decoded ahead (kept: a few hundred MB with many graphics, on purpose).
  preload(state) {
    const sig = JSON.stringify(state.project.compositions.map(c => c.layers.map(l => l.src)));
    if (sig === this.preSig) return;
    this.preSig = sig;
    this.held = this.held || new Map();
    for (const c of state.project.compositions) for (const l of c.layers || []) {
      const src = String(l.type === "image" && l.src || "");
      if (!src || src.includes("{{") || this.held.has(src)) continue;
      const img = new Image();
      img.src = this.url(src);
      img.decode().catch(() => {});
      this.held.set(src, img);
    }
  }

  tables(state) {
    if (state.now) setNow(state.now);
    if (!this.opts.editor && state.project) this.preload(state);
    this.cams = (state.project && state.project.cams) || this.cams || [];
    this.camPassword = (state.project && state.project.cam_password) || "";
    return (state.data && state.data.tables) || {};
  }

  // entering: the graphic is coming in (tickers wait for their layer's In animation, from their start)
  build(comp, values, tables, entering = false) {
    const el = document.createElement("div");
    el.className = "sg-comp";
    const later = [];
    const ticking = [];
    const ctx = { values: values || {}, resolve: v => resolve(v, tables), url: s => this.url(s), muted: this.opts.muted, later: fn => later.push(fn), tick: fn => ticking.push(fn),
      table: name => tables[name], now: () => Date.now() + nowSkew(),
      cams: this.cams || [], camPassword: this.camPassword, liveCams: !this.opts.editor, cardCams: !!this.opts.editor, camBitrate: this.opts.muted ? 800 : 0,
      hold: layer => { const a = (layer.anim || {}).in || {}; return entering && a.type && a.type !== "none" ? (+a.delay || 0) + (+a.dur || 400) : 0; } };
    const fit = slotFit(comp, tables, values || {});
    for (const raw of comp.layers || []) {
      const layer = fit(raw);
      if (!layer) continue;   // (a slot past the count: e.g. caster 3 with 2 casters)
      const draw = DRAW[layer.type];
      if (!draw || layer.reference) continue;
      // show: the layer is there only while this has a value (e.g. "{{Roster!Player 1 headshot}}")
      if (layer.show != null && layer.show !== "" && !truthy(resolve(String(layer.show), tables))) continue;
      const lel = box(layer);
      placeMove(lel, layer, ctx.resolve);
      draw(lel, layer, ctx);
      effects(lel, layer, ctx.resolve);
      lel._layer = layer;
      if (layer !== raw) { lel._shift = [layer.x - raw.x, layer.y - raw.y, layer.w - raw.w, layer.h - raw.h]; lel._layer = raw; }
      el.appendChild(lel);
    }
    el._later = later;
    el._ticks = ticking;
    return el;
  }

  order(want) {
    want.ids.forEach((id, i) => {
      const c = want.comps.get(id), o = this.on.get(id);
      if (o) o.el.style.zIndex = String(10 + (+c.layer || 0) * 1000 + (KIND_ORDER[c.kind] ?? 1) * 300 + i);
    });
  }

  // in / out: every layer plays its own animation (or the transition's effect for the whole graphic).
  async goIn(el, mode, t) {
    if (el.parentNode !== this.root) this.root.appendChild(el);   // (a warmed-up graphic is there already: moving it would reconnect its cameras)
    // (its pictures decoded first, so it never plays in half drawn; they're preloaded, so this is usually instant)
    const gen = this.gen;
    el.style.visibility = "hidden";
    await Promise.race([Promise.all([...el.querySelectorAll("img")].map(i => i.decode().catch(() => {}))), new Promise(r => setTimeout(r, 700))]);
    if (gen !== this.gen && !el.isConnected) return;
    el.style.visibility = "";
    el._later.forEach(fn => fn());
    if (mode === "cut") return;
    if (mode === "fade") return el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: +t.dur || 500 }).finished.catch(() => {});
    if (mode === "wipe") return el.animate(wipeFrames(t.direction, true), { duration: +t.dur || 600, easing: "ease-in-out" }).finished.catch(() => {});
    await Promise.all([...el.children].filter(l => l._layer).map(l => play(l, l._layer, "in")));
  }
  async goOut(el, mode, t) {
    (this.leaving = this.leaving || new Set()).add(el);
    if (mode === "fade") await el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: +t.dur || 500, fill: "forwards" }).finished.catch(() => {});
    else if (mode === "wipe") await el.animate(wipeFrames(t.direction, false), { duration: +t.dur || 600, easing: "ease-in-out", fill: "forwards" }).finished.catch(() => {});
    else if (mode !== "cut") await Promise.all([...el.children].filter(l => l._layer).map(l => play(l, l._layer, "out")));
    el.remove();
    this.leaving.delete(el);
  }

  // A new TAKE while the last one is still playing: that one ends at once (its animations jump to the end,
  // what was leaving is gone, a dip or stinger stops), so TAKE always answers straight away, however fast.
  settle() {
    this.gen = (this.gen || 0) + 1;   // (a dip / stinger still on its way does nothing once a newer TAKE came)
    for (const id of this.timers || []) clearTimeout(id);
    this.timers = [];
    for (const el of this.leaving || []) el.remove();
    this.leaving = new Set();
    for (const c of [...this.root.children]) if (c.classList.contains("sg-cover") || c.classList.contains("sg-stinger")) c.remove();
    for (const { el } of this.on.values()) {
      for (const g of el.querySelectorAll(".sg-ghost")) g.remove();
      for (const a of el.getAnimations({ subtree: true })) {
        const iters = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming().iterations : 1;
        if (iters !== Infinity) { try { a.finish(); } catch (e) { a.cancel(); } }   // (tickers keep running)
      }
      for (const l of el.children) if (l._layer && l.style.visibility === "hidden") l.style.visibility = "";
      el.style.visibility = "";
    }
  }
  later(fn, ms) { (this.timers = this.timers || []).push(setTimeout(fn, ms)); }

  // Shows exactly what's wanted: new graphics in, gone ones out, the rest redrawn only when they changed.
  sync(state, mode = "cut", t = {}) {
    const want = this.wanted(state), tables = this.tables(state), keep = new Set(want.ids);
    const fresh = [];
    for (const id of want.ids) {
      const comp = want.comps.get(id), hasCam = (comp.layers || []).some(l => l.type === "camera");
      const sig = JSON.stringify([comp, want.values[id], tables, hasCam ? [this.cams, this.camPassword] : 0]);
      const o = this.on.get(id);
      if (o && o.sig === sig) continue;
      const el = this.build(comp, want.values[id], tables, !o);
      if (o && [...o.el.children].some(c => c._keep)) { this.patch(o.el, el); this.on.set(id, { el: o.el, sig }); }
      else if (o) { o.el.replaceWith(el); el._later.forEach(fn => fn()); this.on.set(id, { el, sig }); }
      else if (this.warm && this.warm.has(id)) {   // (it was waiting, hidden, with its cameras connected)
        const w = this.warm.get(id);
        this.warm.delete(id);
        this.patch(w.el, el);
        this.on.set(id, { el: w.el, sig });
        fresh.push(w.el);
      }
      else { this.on.set(id, { el, sig }); fresh.push(el); }
    }
    const going = [];
    for (const [id, o] of this.on) if (!keep.has(id)) { this.on.delete(id); going.push(o.el); }
    this.order(want);
    if (mode === "merge" && fresh.length && going.length) { this.merge(fresh, going, t); return this.warmUp(state, tables); }
    // (a wipe or fade moves old and new together: both start in the same frame)
    for (const el of fresh) this.goIn(el, mode, t);
    for (const el of going) this.goOut(el, mode, t);
    this.warmUp(state, tables);
  }

  // Graphics with cameras waiting on Preview are built here too, hidden, so their cameras are already
  // connected when TAKE puts them on (a camera connecting on air would show black for a second or two).
  warmUp(state, tables) {
    if (this.opts.bus !== "program" || this.opts.comp || !state.live.preview) return;
    this.warm = this.warm || new Map();
    const comps = new Map(state.project.compositions.map(c => [c.id, c]));
    const want = new Set((state.live.preview.on || []).filter(id => !this.on.has(id) && ((comps.get(id) || {}).layers || []).some(l => l.type === "camera")));
    for (const [id, w] of this.warm) if (!want.has(id)) { w.el.remove(); this.warm.delete(id); }
    for (const id of want) {
      const comp = comps.get(id), values = (state.live.preview.values || {})[id];
      const sig = JSON.stringify([comp, values, tables, [this.cams, this.camPassword]]), w = this.warm.get(id);
      if (w && w.sig === sig) continue;
      const el = this.build(comp, values, tables, true);
      if (w) { this.patch(w.el, el); w.sig = sig; continue; }
      el.style.visibility = "hidden";
      el.style.zIndex = "-1";
      this.root.appendChild(el);
      el._later.forEach(fn => fn());
      this.warm.set(id, { el, sig });
    }
  }

  // Merge: what both graphics have (the same layer name) glides from where it was to where it goes and stays
  // on screen; the rest of the old one plays its Out, the rest of the new one its In (a scene "morph").
  merge(fresh, going, t) {
    const dur = +t.dur || 700, easing = "cubic-bezier(.65, 0, .35, 1)";
    const key = l => `${(l._layer.name || "").trim().toLowerCase()}|${l._layer.type}`;
    const same = (a, b) => JSON.stringify({ ...a, id: 0, anim: 0 }) === JSON.stringify({ ...b, id: 0, anim: 0 });
    const olds = new Map();
    for (const g of going) for (const l of g.children) { if (!l._layer) continue; const k = key(l); if (!olds.has(k)) olds.set(k, []); olds.get(k).push(l); }
    const box = l => { const L = l._layer; return { left: (L.x || 0) + "px", top: (L.y || 0) + "px", width: (L.w || 0) + "px", height: (L.h || 0) + "px", opacity: getComputedStyle(l).opacity }; };
    for (const el of fresh) {
      if (el.parentNode !== this.root) this.root.appendChild(el);
      el.style.visibility = "";
      el._later.forEach(fn => fn());
      for (const l of [...el.children]) {
        if (!l._layer) continue;
        const old = (olds.get(key(l)) || []).shift();
        if (!old) { play(l, l._layer, "in"); continue; }
        old._merged = true;
        old.style.visibility = "hidden";
        const from = box(old), to = box(l);
        if (JSON.stringify(from) === JSON.stringify(to) && old.textContent === l.textContent && same(old._layer, l._layer)) {
          old.style.visibility = "";   // (the very same layer: the one on screen moves over and keeps playing, a loop or a ticker doesn't restart)
          l.replaceWith(old);
          continue;
        }
        l.animate([from, to], { duration: dur, easing });
        if (old.textContent !== l.textContent && l._layer.type === "text") {   // (new words: the old ones fade out where they move)
          const ghost = old.cloneNode(true);
          ghost.classList.add("sg-ghost");
          ghost.style.visibility = "visible";
          el.appendChild(ghost);
          ghost.animate([from, { ...to, opacity: 0 }], { duration: dur, easing, fill: "forwards" }).finished.then(() => ghost.remove(), () => ghost.remove());
          l.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: to.opacity }], { duration: dur });
        }
      }
    }
    for (const el of fresh) for (const l of el.children) l._merged = false;
    for (const g of going) {
      (this.leaving = this.leaving || new Set()).add(g);
      Promise.all([...g.children].filter(l => l._layer && !l._merged).map(l => play(l, l._layer, "out")))
        .then(() => this.later(() => { g.remove(); this.leaving.delete(g); }, Math.max(0, dur - 300)), () => g.remove());
    }
  }

  // Redraw a graphic without touching its cameras and videos (a new iframe reconnects, a new video restarts):
  // the new layers go in around the ones that stay (those with the same _keep key).
  patch(oldEl, newEl) {
    const keep = new Map([...oldEl.children].filter(c => c._keep).map(c => [c._keep, c]));
    const stay = new Set();
    let cursor = null;
    for (const n of [...newEl.children]) {
      const old = n._keep && keep.get(n._keep);
      if (old) {
        old.style.cssText = n.style.cssText;
        old._layer = n._layer;
        [...n.children].forEach((c, i) => { const o = old.children[i]; if (o && o.tagName === c.tagName) o.style.cssText = c.style.cssText; });
        keep.delete(n._keep);
        stay.add(old);
        cursor = old;
        continue;
      }
      if (cursor) cursor.after(n); else oldEl.prepend(n);
      stay.add(n);
      cursor = n;
    }
    for (const c of [...oldEl.children]) if (!stay.has(c)) c.remove();
    oldEl._ticks = newEl._ticks;
    newEl._later.forEach(fn => fn());
  }

  // A new state from the engine: a TAKE plays its transition, anything else updates in place.
  apply(state) {
    const cut = state.live.cut || { seq: 0 };
    const first = this.cutSeq === null, took = !first && cut.seq !== this.cutSeq && this.opts.bus === "program" && !this.opts.comp;
    this.cutSeq = cut.seq;
    // (while a dip / stinger / delay hasn't swapped yet, other updates wait: the new graphic mustn't show before the cover)
    if (!took && this.hold && this.hold === this.gen) { this.latest = state; return; }
    if (!took) return this.sync(state, first ? "cut" : "animate");
    this.settle();
    const t = cut.transition || { type: "cut" };
    this.latest = state;
    if (["dip", "delay", "stinger"].includes(t.type) && (t.type !== "stinger" || t.src)) this.hold = this.gen;
    if (t.type === "dip") return this.dip(state, t);
    if (t.type === "delay") return this.later(() => this.swapIn(), +t.ms || 0);
    if (t.type === "stinger") return this.stinger(state, t);
    this.sync(state, ["cut", "fade", "wipe", "merge"].includes(t.type) ? t.type : "animate", t);
  }

  // The held TAKE goes on (with the newest state that came while it waited).
  swapIn() {
    this.hold = null;
    this.sync(this.latest, "cut");
  }

  dip(state, t) {
    const cover = document.createElement("div");
    cover.className = "sg-cover";
    cover.style.background = t.color || "#000";
    this.root.appendChild(cover);
    const half = (+t.dur || 800) / 2, gen = this.gen;
    this.later(() => { if (this.hold === gen) this.swapIn(); }, half + 400);   // (if the cover's animation never finishes, the TAKE still goes on)
    cover.animate([{ opacity: 0 }, { opacity: 1 }], { duration: half, fill: "forwards" }).finished.then(() => {
      if (gen !== this.gen) return;
      this.swapIn();
      return cover.animate([{ opacity: 1 }, { opacity: 0 }], { duration: half, fill: "forwards" }).finished;
    }).finally(() => cover.remove());
  }

  stinger(state, t) {
    if (!t.src) return this.sync(state, "cut");
    const v = document.createElement("video");
    v.className = "sg-stinger";
    v.src = this.url(t.src);
    v.muted = this.opts.muted || t.audio === false;
    v.volume = t.volume == null ? 1 : +t.volume;
    v.playsInline = true;
    this.root.appendChild(v);
    let swapped = false;
    const gen = this.gen;
    const swap = () => { if (!swapped && gen === this.gen) { swapped = true; this.swapIn(); } };
    this.later(swap, Math.max(0, +t.cut || 0));
    v.onended = () => { swap(); v.remove(); };
    v.play().catch(() => { swap(); v.remove(); });
  }
}

function wipeFrames(direction, entering) {
  const hidden = { left: ["inset(0 0 0 100%)", "inset(0 100% 0 0)"], right: ["inset(0 100% 0 0)", "inset(0 0 0 100%)"],
    up: ["inset(100% 0 0 0)", "inset(0 0 100% 0)"], down: ["inset(0 0 100% 0)", "inset(100% 0 0 0)"] }[direction || "left"];
  return entering ? [{ clipPath: hidden[0] }, { clipPath: "inset(0 0 0 0)" }] : [{ clipPath: "inset(0 0 0 0)" }, { clipPath: hidden[1] }];
}
