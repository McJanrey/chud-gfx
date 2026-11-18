// Layer in / out animations (Spec 01 section 3) as Web Animations keyframes.
const MOVE = 60;   // px a slide travels
const K = {
  none: [{}, {}],
  fade: [{ opacity: 0 }, { opacity: 1 }],
  "slide-left": [{ opacity: 0, translate: `${MOVE}px 0` }, { opacity: 1, translate: "0 0" }],
  "slide-right": [{ opacity: 0, translate: `-${MOVE}px 0` }, { opacity: 1, translate: "0 0" }],
  "slide-up": [{ opacity: 0, translate: `0 ${MOVE}px` }, { opacity: 1, translate: "0 0" }],
  "slide-down": [{ opacity: 0, translate: `0 -${MOVE}px` }, { opacity: 1, translate: "0 0" }],
  "wipe-right": [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }],
  "wipe-left": [{ clipPath: "inset(0 0 0 100%)" }, { clipPath: "inset(0 0 0 0)" }],
  "wipe-down": [{ clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0 0)" }],
  "wipe-up": [{ clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0 0 0 0)" }],
  "grow-x": [{ scale: "0 1" }, { scale: "1 1" }],
  "grow-y": [{ scale: "1 0" }, { scale: "1 1" }],
  scale: [{ opacity: 0, scale: "0.85" }, { opacity: 1, scale: "1" }],
  pop: [{ opacity: 0, scale: "0.6" }, { opacity: 1, scale: "1.06", offset: 0.7 }, { opacity: 1, scale: "1" }],
  blur: [{ opacity: 0, filter: "blur(16px)" }, { opacity: 1, filter: "blur(0)" }],
  // From fully off the page (as vMix): the distance is to the page edge, worked out from where the layer sits.
  "fly-left": l => [{ translate: `${-((+l.x || 0) + (+l.w || 0))}px 0` }, { translate: "0 0" }],
  "fly-right": l => [{ translate: `${1920 - (+l.x || 0)}px 0` }, { translate: "0 0" }],
  "fly-top": l => [{ translate: `0 ${-((+l.y || 0) + (+l.h || 0))}px` }, { translate: "0 0" }],
  "fly-bottom": l => [{ translate: `0 ${1080 - (+l.y || 0)}px` }, { translate: "0 0" }],
  "fly-left-bounce": l => [{ translate: `${-((+l.x || 0) + (+l.w || 0))}px 0` }, { translate: "24px 0", offset: 0.75 }, { translate: "0 0" }],
  "fly-right-bounce": l => [{ translate: `${1920 - (+l.x || 0)}px 0` }, { translate: "-24px 0", offset: 0.75 }, { translate: "0 0" }],
  "zoom-in": [{ scale: "0" }, { scale: "1" }],
  "zoom-out": [{ opacity: 0, scale: "1.6" }, { opacity: 1, scale: "1" }],
  "elastic": [{ scale: "0" }, { scale: "1.15", offset: 0.55 }, { scale: "0.95", offset: 0.8 }, { scale: "1" }],
  "flip-x": [{ opacity: 0, transform: "perspective(900px) rotateY(90deg)" }, { opacity: 1, transform: "perspective(900px) rotateY(0)" }],
  "flip-y": [{ opacity: 0, transform: "perspective(900px) rotateX(90deg)" }, { opacity: 1, transform: "perspective(900px) rotateX(0)" }],
  "spin": [{ opacity: 0, rotate: "-180deg", scale: "0.3" }, { opacity: 1, rotate: "0deg", scale: "1" }],
  "swing": [{ opacity: 0, transformOrigin: "top", transform: "perspective(900px) rotateX(-90deg)" }, { opacity: 1, transformOrigin: "top", transform: "perspective(900px) rotateX(0)" }],
  "drop": l => [{ translate: `0 ${-((+l.y || 0) + (+l.h || 0))}px` }, { translate: "0 0", offset: 0.6 }, { translate: "0 -30px", offset: 0.78 }, { translate: "0 0", offset: 0.9 }, { translate: "0 -8px", offset: 0.95 }, { translate: "0 0" }],
  "rise": [{ opacity: 0, translate: "0 140px", scale: "0.9" }, { opacity: 1, translate: "0 0", scale: "1" }],
  "iris": [{ clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(75% at 50% 50%)" }],
  "blinds": [{ clipPath: "inset(0 50% 0 50%)" }, { clipPath: "inset(0 0 0 0)" }],
  "blinds-y": [{ clipPath: "inset(50% 0 50% 0)" }, { clipPath: "inset(0 0 0 0)" }],
  "blur-slide": [{ opacity: 0, translate: "160px 0", filter: "blur(12px)" }, { opacity: 1, translate: "0 0", filter: "blur(0)" }],
  "type-on": [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }],
  "glitch": [{ opacity: 0, translate: "-20px 0" }, { opacity: 1, translate: "14px 0", offset: 0.2 }, { opacity: 0.4, translate: "-10px 0", offset: 0.35 }, { opacity: 1, translate: "6px 0", offset: 0.55 }, { opacity: 0.7, translate: "-3px 0", offset: 0.75 }, { opacity: 1, translate: "0 0" }],
};
const STEPPED = { "type-on": "steps(12, end)" };   // (the typewriter reveals in jumps, not smoothly)
const EASE_IN = "cubic-bezier(.2,.8,.2,1)", EASE_OUT = "cubic-bezier(.6,0,.8,.2)";

// Plays a layer's "in" or "out"; resolves when it's done.
export function play(el, layer, dir) {
  const a = ((layer.anim || {})[dir]) || {};
  const k = K[a.type] || (dir === "in" || dir === "out" ? K.none : K.fade), frames = typeof k === "function" ? k(layer) : k;
  if (!a.type || a.type === "none") return Promise.resolve();
  const base = layer.opacity != null && layer.opacity !== "" ? +layer.opacity : 1;   // (a fade ends at the layer's own opacity, not 100%)
  const kf = (dir === "out" ? [...frames].reverse().map((f, i, all) => ({ ...f, offset: f.offset != null ? 1 - f.offset : undefined })) : frames)
    .map(f => f.opacity != null ? { ...f, opacity: f.opacity * base } : f);
  const anim = el.animate(kf, { duration: Math.max(0, +a.dur || 400), delay: Math.max(0, +a.delay || 0),
    easing: STEPPED[a.type] || (dir === "out" ? EASE_OUT : EASE_IN), fill: "both" });
  // (an In lets go once done: its last frame would otherwise sit on top of the layer's own move, rotation, frame and blur)
  return anim.finished.then(() => { if (dir === "in") anim.cancel(); }, () => {});
}
