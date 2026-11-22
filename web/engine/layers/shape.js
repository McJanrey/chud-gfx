// Vector shapes as one SVG path in the layer's box (Spec 01 section 2, phase 1 set).
import { content } from "./box.js";

const NS = "http://www.w3.org/2000/svg";
const poly = pts => "M" + pts.map(p => p.map(n => +n.toFixed(2)).join(" ")).join("L") + "Z";
const star = (w, h, n, inner) => poly(Array.from({ length: n * 2 }, (_, i) => {
  const a = Math.PI * i / n - Math.PI / 2, r = i % 2 ? inner : 1;
  return [w / 2 + Math.cos(a) * r * w / 2, h / 2 + Math.sin(a) * r * h / 2];
}));
const ngon = (w, h, n) => poly(Array.from({ length: n }, (_, i) => {
  const a = 2 * Math.PI * i / n - Math.PI / 2;
  return [w / 2 + Math.cos(a) * w / 2, h / 2 + Math.sin(a) * h / 2];
}));
function rounded(w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`;
}

export const SHAPES = {
  rect: (w, h, l) => rounded(w, h, +l.radius || 0),
  pill: (w, h) => rounded(w, h, Math.min(w, h) / 2),
  ellipse: (w, h) => `M0 ${h / 2}A${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2}A${w / 2} ${h / 2} 0 1 0 0 ${h / 2}Z`,
  triangle: (w, h) => poly([[w / 2, 0], [w, h], [0, h]]),
  diamond: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]),
  polygon: (w, h, l) => ngon(w, h, Math.max(3, +l.sides || 6)),
  star: (w, h, l) => star(w, h, Math.max(3, +l.points || 5), +l.inner || 0.45),
  parallelogram: (w, h) => { const k = Math.min(w * 0.25, h); return poly([[k, 0], [w, 0], [w - k, h], [0, h]]); },
  trapezoid: (w, h) => { const k = w * 0.2; return poly([[k, 0], [w - k, 0], [w, h], [0, h]]); },
  chevron: (w, h) => { const k = Math.min(w * 0.3, h / 2); return poly([[0, 0], [w - k, 0], [w, h / 2], [w - k, h], [0, h], [k, h / 2]]); },
  // a line (the line tool): open, through its points (fractions of the box), drawn by its stroke
  line: (w, h, l) => (Array.isArray(l.points) && l.points.length > 1 ? "M" + l.points.map(([x, y]) => `${+(x * w).toFixed(2)} ${+(y * h).toFixed(2)}`).join("L") : ""),
  // drawn with the pen: points as fractions of the box, [[0..1, 0..1], ...]
  path: (w, h, l) => (Array.isArray(l.points) && l.points.length > 2 ? poly(l.points.map(([x, y]) => [x * w, y * h])) : ""),
  // broadcast pieces
  tab: (w, h) => { const k = Math.min(w * 0.12, h * 0.6); return poly([[0, 0], [w - k, 0], [w, h], [0, h]]); },
  arrow: (w, h) => { const k = Math.min(w * 0.35, h); return poly([[0, h * 0.3], [w - k, h * 0.3], [w - k, 0], [w, h / 2], [w - k, h], [w - k, h * 0.7], [0, h * 0.7]]); },
  shield: (w, h) => `M0 0H${w}V${h * 0.55}Q${w} ${h * 0.85} ${w / 2} ${h}Q0 ${h * 0.85} 0 ${h * 0.55}Z`,
};

export function shape(el, layer, ctx) {
  if ((layer.shape === "path" || layer.shape === "line") && typeof layer.points === "string") { try { layer = { ...layer, points: JSON.parse(layer.points) }; } catch (e) { /* */ } }
  const w = Math.max(1, layer.w || 1), h = Math.max(1, layer.h || 1);
  const make = SHAPES[layer.shape] || SHAPES.rect;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.classList.add("sg-fill");
  svg.style.overflow = "visible";
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", make(w, h, layer));
  path.setAttribute("fill", content(layer, "fill", ctx.values, ctx.resolve) || "none");
  // gradient fills: fillType "linear" / "radial", grad = {angle, stops: [{at: 0-100, color}]}
  const g = layer.grad;
  if ((layer.fillType === "linear" || layer.fillType === "radial") && g && Array.isArray(g.stops) && g.stops.length) {
    const id = "g" + Math.random().toString(36).slice(2, 9);
    const grad = document.createElementNS(NS, layer.fillType === "radial" ? "radialGradient" : "linearGradient");
    grad.setAttribute("id", id);
    if (layer.fillType === "linear") {
      const a = ((+g.angle || 0) - 90) * Math.PI / 180, cx = Math.cos(a) / 2, cy = Math.sin(a) / 2;   // (CSS angles: 0 up, 90 right)
      grad.setAttribute("x1", String(0.5 - cx)); grad.setAttribute("y1", String(0.5 - cy)); grad.setAttribute("x2", String(0.5 + cx)); grad.setAttribute("y2", String(0.5 + cy));
    }
    for (const st of g.stops) {
      const stop = document.createElementNS(NS, "stop");
      stop.setAttribute("offset", (+st.at || 0) + "%");
      stop.setAttribute("stop-color", ctx.resolve(st.color || "#000000"));
      grad.appendChild(stop);
    }
    const defs = document.createElementNS(NS, "defs");
    defs.appendChild(grad);
    svg.appendChild(defs);
    path.setAttribute("fill", `url(#${id})`);
  }
  if (layer.dash === "dashed" || layer.dash === "dotted") {
    const sw = +layer.strokeWidth || 1;
    path.setAttribute("stroke-dasharray", layer.dash === "dotted" ? `0 ${sw * 2}` : `${sw * 3} ${sw * 2}`);
    if (layer.dash === "dotted") path.setAttribute("stroke-linecap", "round");
  }
  if (+layer.strokeWidth > 0) {
    path.setAttribute("stroke", ctx.resolve(layer.stroke || "#ffffff"));
    path.setAttribute("stroke-width", String(+layer.strokeWidth));
  }
  if (layer.shape === "line") {   // (a line is its stroke: no fill, round ends and corners, never thinner than 1 px)
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", ctx.resolve(layer.stroke || "#ffffff"));
    path.setAttribute("stroke-width", String(Math.max(1, +layer.strokeWidth || 4)));
    path.setAttribute("stroke-linecap", layer.cap || "round");
    path.setAttribute("stroke-linejoin", "round");
  }
  svg.appendChild(path);
  el.appendChild(svg);
}
