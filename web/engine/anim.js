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
};
const EASE_IN = "cubic-bezier(.2,.8,.2,1)", EASE_OUT = "cubic-bezier(.6,0,.8,.2)";

// Plays a layer's "in" or "out"; resolves when it's done.
export function play(el, layer, dir) {
  const a = ((layer.anim || {})[dir]) || {};
  const frames = K[a.type] || (dir === "in" || dir === "out" ? K.none : K.fade);
  if (!a.type || a.type === "none") return Promise.resolve();
  const kf = dir === "out" ? [...frames].reverse().map((f, i, all) => ({ ...f, offset: f.offset != null ? 1 - f.offset : undefined })) : frames;
  const anim = el.animate(kf, { duration: Math.max(0, +a.dur || 400), delay: Math.max(0, +a.delay || 0),
    easing: dir === "out" ? EASE_OUT : EASE_IN, fill: "both" });
  return anim.finished.catch(() => {});
}
