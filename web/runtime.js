// The GFX Baby player: draws graphics (compositions of layers) and plays
// them in and out, and the transitions between Preview and Program.
//
// Used by the outputs (output.html), the control panel's thumbnails and
// Composer canvas, and exported HTML graphics.

// Shapes: the geometry of every shape layer, as an SVG path for a box w × h.
// Used by the outputs (runtime.js) and by Composer (its shape picker's
// previews and the pen tool). Plain functions, no page needed.
//
//   layer.shape   rect | pill | ellipse | triangle | diamond | polygon | star | plus |
//                 ring | heart | parallelogram | trapezoid | chevron | tab | notch |
//                 bubble | line | arrow | path | combo
//   layer.radius  corner rounding (px); layer.radii [tl, tr, br, bl] for a rectangle
//   layer.sides   polygon sides; layer.points + layer.inner (0-1) for a star
//   layer.slant   px the slanted / pointed shapes lean or point by
//   layer.thick   0-1, how thick a ring or plus is
//   layer.pts     the pen tool's points [[x, y], ...] in 0-1 of the box; layer.smooth
//   layer.parts   a combined shape's shapes [{shape, x, y, w, h, ...}] (px in the box); layer.op

(function (root) {
  const f = n => Math.round(n * 100) / 100;

  // A closed polygon with its corners rounded (each corner its own radius).
  function roundPoly(pts, radii) {
    const n = pts.length;
    if (!radii || !radii.some(r => r > 0)) return "M" + pts.map(p => f(p[0]) + " " + f(p[1])).join("L") + "Z";
    let d = "";
    for (let i = 0; i < n; i++) {
      const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
      const r = Math.max(0, Math.min(radii[i % radii.length] || 0, la / 2, lb / 2));
      const p1 = [p[0] + (a[0] - p[0]) * r / (la || 1), p[1] + (a[1] - p[1]) * r / (la || 1)];
      const p2 = [p[0] + (b[0] - p[0]) * r / (lb || 1), p[1] + (b[1] - p[1]) * r / (lb || 1)];
      d += (i ? "L" : "M") + f(p1[0]) + " " + f(p1[1]) + "Q" + f(p[0]) + " " + f(p[1]) + " " + f(p2[0]) + " " + f(p2[1]);
    }
    return d + "Z";
  }
  function ellipse(cx, cy, rx, ry) {
    return `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`;
  }
  // Points through the given ones, smoothed (Catmull-Rom as curves).
  function smoothPath(p, closed) {
    if (p.length < 3) return "M" + p.map(q => f(q[0]) + " " + f(q[1])).join("L") + (closed ? "Z" : "");
    const n = p.length, at = i => closed ? p[(i + n) % n] : p[Math.max(0, Math.min(n - 1, i))];
    let d = `M${f(p[0][0])} ${f(p[0][1])}`;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
    }
    return d + (closed ? "Z" : "");
  }

  function path(l, w, h) {
    const r = +l.radius || 0, s = Math.max(0, Math.min(+(l.slant ?? Math.min(w, h) * 0.35), w / 2));
    const rr = Array.isArray(l.radii) ? l.radii.map(Number) : [r, r, r, r];
    switch (l.shape || "rect") {
      case "rect": return roundPoly([[0, 0], [w, 0], [w, h], [0, h]], rr);
      case "pill": return roundPoly([[0, 0], [w, 0], [w, h], [0, h]], [Math.min(w, h) / 2]);
      case "ellipse": return ellipse(w / 2, h / 2, w / 2, h / 2);
      case "triangle": return roundPoly([[w / 2, 0], [w, h], [0, h]], [r]);
      case "diamond": return roundPoly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]], [r]);
      case "polygon": {
        const n = Math.max(3, Math.min(64, Math.round(+l.sides || 6)));
        return roundPoly([...Array(n)].map((_, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [w / 2 + w / 2 * Math.cos(a), h / 2 + h / 2 * Math.sin(a)]; }), [r]);
      }
      case "star": {
        const n = Math.max(3, Math.min(64, Math.round(+l.points || 5))), k = Math.max(0.05, Math.min(0.95, +(l.inner ?? 0.45)));
        return roundPoly([...Array(n * 2)].map((_, i) => { const a = -Math.PI / 2 + i * Math.PI / n, q = i % 2 ? k : 1; return [w / 2 + w / 2 * q * Math.cos(a), h / 2 + h / 2 * q * Math.sin(a)]; }), [r]);
      }
      case "plus": {
        const t = Math.max(0.05, Math.min(0.95, +(l.thick ?? 0.34))), x0 = w * (1 - t) / 2, x1 = w - x0, y0 = h * (1 - t) / 2, y1 = h - y0;
        return roundPoly([[x0, 0], [x1, 0], [x1, y0], [w, y0], [w, y1], [x1, y1], [x1, h], [x0, h], [x0, y1], [0, y1], [0, y0], [x0, y0]], [r]);
      }
      case "ring": {
        const t = Math.max(0.02, Math.min(0.98, +(l.thick ?? 0.25)));
        return ellipse(w / 2, h / 2, w / 2, h / 2) + ellipse(w / 2, h / 2, w / 2 * (1 - t), h / 2 * (1 - t));
      }
      case "heart":
        return `M${f(w / 2)} ${f(h)}C${f(w * 0.12)} ${f(h * 0.72)} 0 ${f(h * 0.5)} 0 ${f(h * 0.28)}C0 ${f(h * 0.1)} ${f(w * 0.14)} 0 ${f(w * 0.28)} 0C${f(w * 0.4)} 0 ${f(w * 0.47)} ${f(h * 0.08)} ${f(w / 2)} ${f(h * 0.18)}`
          + `C${f(w * 0.53)} ${f(h * 0.08)} ${f(w * 0.6)} 0 ${f(w * 0.72)} 0C${f(w * 0.86)} 0 ${f(w)} ${f(h * 0.1)} ${f(w)} ${f(h * 0.28)}C${f(w)} ${f(h * 0.5)} ${f(w * 0.88)} ${f(h * 0.72)} ${f(w / 2)} ${f(h)}Z`;
      case "parallelogram": return roundPoly([[s, 0], [w, 0], [w - s, h], [0, h]], rr);
      case "trapezoid": return roundPoly([[s, 0], [w - s, 0], [w, h], [0, h]], rr);
      case "chevron": return roundPoly([[0, 0], [w - s, 0], [w, h / 2], [w - s, h], [0, h], [s, h / 2]], [r]);
      case "tab": return roundPoly([[0, 0], [w - s, 0], [w, h / 2], [w - s, h], [0, h]], [r]);
      case "notch": { const c = Math.min(s, h / 2); return roundPoly([[c, 0], [w, 0], [w, h - c], [w - c, h], [0, h], [0, c]], [r]); }
      case "bubble": {
        const th = Math.min(h * 0.3, 60), bh = h - th, tx = Math.min(w * 0.18, w - 40);
        return roundPoly([[0, 0], [w, 0], [w, bh], [tx + th, bh], [tx, h], [tx, bh], [0, bh]], [Math.min(r || 16, bh / 2), Math.min(r || 16, bh / 2), Math.min(r || 16, bh / 2), 0, 0, 0, Math.min(r || 16, bh / 2)]);
      }
      case "path": {
        const p = (l.pts || []).map(q => [q[0] * w, q[1] * h]);
        if (p.length < 2) return "";
        const closed = l.closed !== false;
        return l.smooth ? smoothPath(p, closed) : "M" + p.map(q => f(q[0]) + " " + f(q[1])).join("L") + (closed ? "Z" : "");
      }
      case "combo": return (l.parts || []).map(pt => offset(path(pt, +pt.w || 1, +pt.h || 1), +pt.x || 0, +pt.y || 0)).join("");
      default: return roundPoly([[0, 0], [w, 0], [w, h], [0, h]], rr);
    }
  }
  // A path moved by (dx, dy): every absolute coordinate pair shifted (the paths here are all absolute).
  function offset(d, dx, dy) {
    if (!dx && !dy) return d;
    return d.replace(/([MLQCA])([^MLQCAZ]*)/g, (m, cmd, args) => {
      const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (cmd === "A") { n[5] += dx; n[6] += dy; }
      else for (let i = 0; i < n.length; i += 2) { n[i] += dx; n[i + 1] += dy; }
      return cmd + n.map(f).join(" ");
    });
  }
  const LINES = new Set(["line", "arrow"]);

  root.Shapes = { path, offset, roundPoly, isLine: l => LINES.has(l.shape) };
})(typeof window !== "undefined" ? window : globalThis);

(function () {
  "use strict";
  const GFX = (window.GFX = {});
  const W = 1920, H = 1080;
  GFX.W = W; GFX.H = H;
  GFX.base = "";          // where assets/ and fonts/ are (another engine, for ?live=)

  const url = p => (!p ? "" : /^(https?:|data:|blob:)/.test(p) ? p : GFX.base + (GFX.base && !p.startsWith("/") ? "/" : "") + p);
  GFX.url = url;

  // --- fonts ------------------------------------------------------------------
  // Fonts that come with the engine, and stand-ins for broadcast fonts that
  // can't (Gotham, Trade Gothic...) until their files are added to the assets.
  const BUILTIN = [
    ["Inter", "fonts/Inter.ttf", "100 900"],
    ["Bebas Neue", "fonts/BebasNeue.ttf", "400"],
    ["Anton", "fonts/Anton-Regular.ttf", "400"],
    // (stands in for Brick, the Smash scoreboard's names, at Brick's size)
    ["Permanent Marker", "fonts/PermanentMarker-Regular.ttf", "400", "size-adjust:80%"],
    ...[400, 500, 700, 800, 900].map(w => ["Montserrat", `fonts/Montserrat-${w}.woff2`, String(w)]),
    ...[500, 600, 700].map(w => ["Barlow Condensed", `fonts/BarlowCondensed-${w}.woff2`, String(w)]),
    ...[700, 900].map(w => ["Vazirmatn", `fonts/Vazirmatn-${w}.woff2`, String(w)]),
  ];
  GFX.builtinFonts = ["Inter", "Montserrat", "Barlow Condensed", "Bebas Neue", "Anton", "Permanent Marker", "Vazirmatn"];
  const STANDINS = [
    [/gotham.*(black|ultra)/i, "Montserrat", 900], [/gotham.*bold/i, "Montserrat", 700],
    [/gotham.*medium/i, "Montserrat", 500], [/gotham/i, "Montserrat", 400],
    [/(trade.?gothic|tradegothic).*(cond|cn|20)/i, "Barlow Condensed", 700], [/trade.?gothic/i, "Barlow Condensed", 600],
    [/vazirmatn.*black/i, "Vazirmatn", 900], [/vazirmatn/i, "Vazirmatn", 700],
    [/anton/i, "Anton", 400], [/brick/i, "Permanent Marker", 400],
    [/redzone|carbon|bebas|impact|oswald/i, "Bebas Neue", 400],
    [/(helvetica|arial|roboto|sf.?pro|segoe).*(black|heavy)/i, "Inter", 900],
    [/(helvetica|arial|roboto|sf.?pro|segoe).*bold/i, "Inter", 700],
  ];
  let assetFonts = new Set();
  let fontStyle = null;
  GFX.loadFonts = function (fonts) {
    fonts = fonts || [];
    const key = JSON.stringify(fonts.map(f => f.path)) + GFX.base;
    if (fontStyle && fontStyle.dataset.key === key) return;
    // Each font by its PostScript name, then by its other names (its file
    // name, full name...), which a design may know it by; the first claim wins.
    const named = new Map();
    for (const f of fonts) if (f.postscript && !named.has(f.postscript.toLowerCase())) named.set(f.postscript.toLowerCase(), [f.postscript, f]);
    for (const f of fonts) for (const a of f.aliases || []) if (a && !named.has(a.toLowerCase())) named.set(a.toLowerCase(), [a, f]);
    assetFonts = new Set([...named.keys()]);
    const css = BUILTIN.map(([fam, file, weight, extra]) =>
      `@font-face{font-family:"${fam}";src:url("${url(file)}");font-weight:${weight};font-display:block${extra ? ";" + extra : ""}}`);
    for (const [name, f] of named.values()) css.push(`@font-face{font-family:"${cssq(name)}";src:url("${url(encodeURI(f.path))}");font-display:block}`);
    if (!fontStyle) { fontStyle = document.createElement("style"); document.head.appendChild(fontStyle); }
    fontStyle.dataset.key = key;
    fontStyle.textContent = css.join("\n");
    if (document.fonts) document.fonts.ready.then(() => GFX.refit());
  };
  const cssq = s => String(s).replace(/["\\]/g, "");
  // [font-family stack, weight] for a text layer.
  GFX.fontFor = function (layer) {
    const name = layer.font || "Inter";
    if (assetFonts.has(name.toLowerCase())) return [`"${cssq(name)}", "Inter", sans-serif`, "normal"];
    if (GFX.builtinFonts.includes(name)) return [`"${name}", "Inter", sans-serif`, layer.weight || 400];
    for (const [re, fam, weight] of STANDINS) if (re.test(name)) return [`"${cssq(name)}", "${fam}", "Inter", sans-serif`, weight];
    return [`"${cssq(name)}", "Inter", sans-serif`, layer.weight || 400];
  };
  GFX.hasFont = name => assetFonts.has(String(name || "").toLowerCase()) || GFX.builtinFonts.includes(name);

  // --- picture adjustments (Composer > Picture) ------------------------------------
  // layer.pic = {bright, contrast, sat, gray, hue (degrees), flipX, flipY, crop: {l, t, r, b} (% taken off each edge)}
  GFX.picFilter = function (layer) {
    const p = layer.pic || {}, f = [];
    if (p.bright != null && +p.bright !== 100) f.push(`brightness(${+p.bright}%)`);
    if (p.contrast != null && +p.contrast !== 100) f.push(`contrast(${+p.contrast}%)`);
    if (p.sat != null && +p.sat !== 100) f.push(`saturate(${+p.sat}%)`);
    if (+p.gray) f.push(`grayscale(${+p.gray}%)`);
    if (+p.hue) f.push(`hue-rotate(${+p.hue}deg)`);
    return f.join(" ");
  };
  GFX.picStyle = function (node, layer) {
    const p = layer.pic || {};
    node.style.filter = GFX.picFilter(layer);
    node.style.transform = p.flipX || p.flipY ? `scale(${p.flipX ? -1 : 1}, ${p.flipY ? -1 : 1})` : "";
  };
  GFX.picCrop = function (layer) {
    const c = (layer.pic || {}).crop;
    if (!c) return null;
    const l = Math.max(0, +c.l || 0), t = Math.max(0, +c.t || 0), r = Math.max(0, +c.r || 0), b = Math.max(0, +c.b || 0);
    if (!(l || t || r || b) || l + r >= 99 || t + b >= 99) return null;
    const w = 100 - l - r, h = 100 - t - b;
    return { img: { position: "absolute", inset: "auto", width: (10000 / w) + "%", height: (10000 / h) + "%",
                    left: (-l * 100 / w) + "%", top: (-t * 100 / h) + "%", maxWidth: "none" } };
  };

  // --- data and fields -----------------------------------------------------------
  const ctx = { tables: {} };
  GFX.setData = function (tables) { ctx.tables = tables || {}; GFX.retext(); tickRotators(); redrawBrackets(); reshow(); };
  // The engine's clock (seconds), so every output changes sponsor at the same moment.
  let clockOffset = 0;
  GFX.setClock = function (engineNow) { if (engineNow) clockOffset = engineNow * 1000 - Date.now(); };
  GFX.now = () => Date.now() + clockOffset;

  const colIndex = s => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  GFX.lookup = function (rows, ref) {
    ref = ref.trim();
    let m = /^([A-Za-z]{1,3})(\d{1,5})$/.exec(ref);
    if (m) { const r = rows[+m[2] - 1]; return (r && r[colIndex(m[1])]) || ""; }
    m = /^(.*)#\s*(\d+)$/.exec(ref);
    if (m && rows.length) {
      const c = rows[0].findIndex(h => h.trim().toLowerCase() === m[1].trim().toLowerCase());
      if (c >= 0) { const r = rows[+m[2]]; return (r && r[c]) || ""; }
    }
    const row = rows.find(r => r[0] && r[0].trim().toLowerCase() === ref.toLowerCase());
    return row ? row[1] || "" : "";
  };
  const pad = n => String(n).padStart(2, "0");
  function token(t) {
    const now = new Date();
    const low = t.toLowerCase();
    if (low === "time") { const h = now.getHours() % 12 || 12; return `${pad(h)}:${pad(now.getMinutes())} ${now.getHours() < 12 ? "AM" : "PM"}`; }
    if (low === "time24") return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (low === "date") return now.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" }).toUpperCase();
    if (low === "clock") {
      // Global's clock: the time of day, or the countdown for Starting Soon / Be Right Back.
      const g = k => GFX.lookup(ctx.tables.Global || [], k);
      const mode = g("Clock mode"), until = g("Clock until");
      if (mode === "soon" || mode === "brb") return until ? token("countdown:" + until) : "00:00";
      return token("time") + (g("Clock zone") ? " " + g("Clock zone") : "");
    }
    if (low === "timer") return GFX.timerText();
    let m = /^countdown:\s*(\d{1,2}):(\d{2})$/i.exec(t);
    if (m) {
      // To a time of day (today, or tomorrow if it's gone).
      const target = new Date(now); target.setHours(+m[1], +m[2], 0, 0);
      let s = Math.max(0, Math.round((target - now) / 1000));
      if (target < now && now - target > 12 * 3600e3) { target.setDate(target.getDate() + 1); s = Math.round((target - now) / 1000); }
      const h = Math.floor(s / 3600);
      return (h ? `${h}:${pad(Math.floor(s / 60) % 60)}` : pad(Math.floor(s / 60))) + `:${pad(s % 60)}`;
    }
    m = /^([^!]+)!(.+)$/.exec(t);
    if (m) {
      const name = Object.keys(ctx.tables).find(k => k.toLowerCase() === m[1].trim().toLowerCase());
      return name ? GFX.lookup(ctx.tables[name], m[2]) : "";
    }
    return "{{" + t + "}}";
  }
  // Global's timer: started, paused, reset and set from Control (or Companion).
  GFX.timerSecs = function () {
    const g = k => GFX.lookup(ctx.tables.Global || [], k);
    const secs = +g("Timer secs") || 0, started = +g("Timer started") || 0, down = !!g("Timer down");
    if (!started) return secs;
    const run = GFX.now() / 1000 - started;
    return down ? Math.max(0, secs - run) : secs + run;
  };
  GFX.timerText = function () {
    // (counting down, 0:04.2 shows 00:05, so 00:00 is when it runs out)
    const v = GFX.timerSecs(), s = GFX.lookup(ctx.tables.Global || [], "Timer down") ? Math.ceil(v - 0.001) : Math.floor(v);
    const h = Math.floor(s / 3600);
    return (h ? `${h}:${pad(Math.floor(s / 60) % 60)}` : pad(Math.floor(s / 60))) + `:${pad(s % 60)}`;
  };
  GFX.resolve = s => String(s == null ? "" : s).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, t) => token(t));
  const hasTokens = s => /\{\{[^{}]+\}\}/.test(String(s || ""));
  const ticking = s => /\{\{\s*(time|time24|date|clock|timer|countdown:[^}]*)\s*\}\}/i.test(String(s || ""));

  // What a layer shows: its field's value if set, else its own.
  GFX.content = function (layer, values) {
    const v = layer.field && values && values[layer.field] != null && values[layer.field] !== "" ? values[layer.field] : null;
    if (layer.type === "text") return v != null ? String(v) : layer.text || "";
    // (a picture or colour can come from the data too: {{Global!Left logo}})
    const own = v != null ? String(v) : (layer.type === "rect" || layer.type === "shape" && layer.fillType !== "image" ? layer.fill : layer.src) || "";
    if (SPONSORS.test(own)) return "{{Sponsors}}";
    // (every sponsor in a row: the list is part of the value, so a new list redraws it)
    if (STRIP.test(own)) return "{{Sponsors all}}" + GFX.sponsors().map(x => "|" + (x.white ? "w:" : "c:") + x.logo).join("");
    const out = hasTokens(own) ? GFX.resolve(own).trim() : own;
    // A picture linked to Global with nothing there yet shows the design's own.
    return !out && layer.placeholder ? layer.placeholder : out;
  };

  // --- the sponsors: one after another, each for its own seconds ---------------
  // A picture layer whose file is {{Sponsors}} shows Global's sponsors in turn.
  const SPONSORS = /^\s*\{\{\s*sponsors\s*\}\}\s*$/i;
  const STRIP = /^\s*\{\{\s*sponsors all\s*\}\}\s*$/i;
  GFX.sponsors = function () {
    return (ctx.tables.Sponsors || []).slice(1).filter(r => r[0])
      .map(r => ({ logo: r[0], secs: Math.max(1, +r[1] || 10), epoch: +r[2] || 0, white: r[3] == null || r[3] === "1" }));
  };
  // {index, left (s), secs, list} of the sponsor on now.
  GFX.sponsorNow = function (list) {
    list = list || GFX.sponsors();
    if (!list.length) return { index: -1, left: 0, secs: 0, list };
    const total = list.reduce((n, s) => n + s.secs, 0);
    let t = ((GFX.now() / 1000 - list[0].epoch) % total + total) % total;
    for (let i = 0; i < list.length; i++) {
      if (t < list[i].secs) return { index: i, left: list[i].secs - t, secs: list[i].secs, list };
      t -= list[i].secs;
    }
    return { index: list.length - 1, left: 0, secs: list[list.length - 1].secs, list };
  };
  const rotators = new Set();
  // A picture layer whose file is {{Sponsors all}}: every sponsor side by side,
  // centred, as tall as the box; each white like the design's unless the sponsor
  // is set to keep its colours (or the layer's "mono" is off).
  function sponsorStrip(layer, logos) {
    const box = el("div", "gfx-media gfx-strip", { gap: Math.round(layer.h * 0.7) + "px" });
    for (const item of logos) {
      const white = item.startsWith("w:") && layer.mono !== false, logo = item.slice(2);
      const img = el("img", "", { height: "100%", maxWidth: Math.round(layer.h * 3.2) + "px", objectFit: "contain",
        filter: white ? "brightness(0) invert(1)" : "" });
      img.src = url(encodeURI(logo));
      box.appendChild(img);
    }
    return box;
  }
  function sponsorBox(layer, opts) {
    const box = el("div", "gfx-media gfx-rot");
    box._layer = layer;
    box._opts = opts;
    if (layer.timer) box.appendChild(el("div", "gfx-rot-bar"));
    rotators.add(box);
    turn(box, true);
    return box;
  }
  function turn(box, first) {
    const layer = box._layer, now = GFX.sponsorNow();
    const logo = now.index >= 0 ? now.list[now.index].logo : layer.placeholder || "";
    const key = now.index + "|" + logo;
    const bar = box.querySelector(".gfx-rot-bar");
    if (bar) bar.style.transform = `scaleX(${now.secs ? Math.max(0, now.left / now.secs) : 0})`;
    if (box._key === key) return;
    box._key = key;
    // (layer.mono: each sponsor white unless it's set to keep its colours)
    const white = layer.mono && now.index >= 0 && now.list[now.index].white;
    const img = el("img", "gfx-rot-img", { objectFit: fitOf(layer.fit), filter: white ? "brightness(0) invert(1)" : "" });
    img.draggable = false;
    if (logo) img.src = url(encodeURI(logo));
    const old = [...box.querySelectorAll(".gfx-rot-img")];
    box.insertBefore(img, bar || null);
    if (first || box._opts.still || !old.length) { old.forEach(o => o.remove()); return; }
    if (layer.swap === "fade") {
      // The old one fades out, then the new one fades in.
      for (const o of old) o.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, easing: "ease", fill: "forwards" })
        .finished.then(() => o.remove(), () => o.remove());
      img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, delay: 500, easing: "ease", fill: "backwards" });
      return;
    }
    // The old one lifts away, the new one rises into place.
    for (const o of old) o.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-35%) scale(.92)", filter: "blur(4px)" }],
      { duration: 450, easing: EASE_OUT, fill: "forwards" }).finished.then(() => o.remove(), () => o.remove());
    img.animate([{ opacity: 0, transform: "translateY(35%) scale(.92)", filter: "blur(4px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }],
      { duration: 650, delay: 200, easing: EASE, fill: "backwards" });
  }
  function tickRotators() { for (const b of rotators) { if (!b.isConnected && b._seen) rotators.delete(b); else { if (b.isConnected) b._seen = true; turn(b); } } }
  setInterval(tickRotators, 100);

  // --- building graphics -----------------------------------------------------------
  const live = new Set();   // text elements that change with time or data

  function el(tag, cls, style) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (style) Object.assign(e.style, style);
    return e;
  }

  function buildContent(layer, value, opts) {
    const t = layer.type;
    if (t === "image" && value === "{{Sponsors}}") return sponsorBox(layer, opts);
    if (t === "image" && value.startsWith("{{Sponsors all}}")) return sponsorStrip(layer, value.split("|").slice(1));
    if (t === "video" && layer.tint) return tintedVideo(layer, value, opts);
    if (t === "bracket") return bracketBox(layer);
    if (t === "image" && layer.recolor && value) {
      // A one-colour shape in another colour (from Global): the picture as a mask.
      const m = el("div", "gfx-media gfx-recolor");
      const src = `url("${url(encodeURI(value))}")`, size = { fill: "100% 100%", cover: "cover" }[layer.fit] || "contain";
      Object.assign(m.style, { webkitMaskImage: src, maskImage: src, webkitMaskSize: size, maskSize: size,
        webkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", webkitMaskPosition: "center", maskPosition: "center" });
      return m;
    }
    if (t === "image" && layer.topThird && value) {
      // Only the top third of the picture (a headshot's face), across the box.
      return el("div", "gfx-media", { backgroundImage: `url("${url(encodeURI(value))}")`, backgroundSize: "auto 300%",
        backgroundPosition: "center top", backgroundRepeat: "no-repeat" });
    }
    // A page of a game HUD (its agent select, its overlay...), live.
    if (t === "web") {
      if (!value) return opts.showHidden ? el("div", "gfx-media", { background: "repeating-linear-gradient(45deg,#2b2f36 0 12px,#22252b 12px 24px)", outline: "2px dashed #5b6270", outlineOffset: "-2px" }) : el("div");
      const f = el("iframe", "gfx-media", { border: "0", background: "transparent", pointerEvents: "none" });
      f.setAttribute("allowtransparency", "true");
      f.setAttribute("scrolling", "no");
      f.src = url(value);
      return f;
    }
    if (t === "image") {
      if (!value) return el("div");
      const crop = GFX.picCrop(layer);
      const img = el("img", "gfx-media", crop ? Object.assign({ objectFit: "fill" }, crop.img) : { objectFit: fitOf(layer.fit), objectPosition: POSITIONS[layer.position] || "" });
      img.draggable = false;
      GFX.picStyle(img, layer);
      const done = !crop && smoothed.get(smoothKey(value, layer));
      img.src = done || url(encodeURI(value));
      if (!crop && !done && layer.fit !== "fill" && !/\.(gif|svg)(\?|$)/i.test(value)) img.addEventListener("load", () => smooth(img, layer, value), { once: true });
      if (!crop) return img;
      // Cropped: the picture is drawn bigger inside a box that cuts off the edges taken away.
      const box = el("div", "gfx-media", { overflow: "hidden" });
      box.appendChild(img);
      return box;
    }
    if (t === "video") {
      if (!value) return el("div");
      const v = el("video", "gfx-media", { objectFit: fitOf(layer.fit) });
      GFX.picStyle(v, layer);
      v.src = url(encodeURI(value));
      v.muted = opts.muted || !layer.audio;
      v.loop = layer.loop !== false;
      v.playsInline = true;
      v.preload = "auto";
      if (opts.still) v.addEventListener("loadeddata", () => { try { v.currentTime = Math.min(1, (v.duration || 2) / 2); } catch (e) { /* not seekable */ } }, { once: true });
      else { v.autoplay = true; v.play().catch(() => { v.muted = true; v.play().catch(() => {}); }); }
      return v;
    }
    return buildOther(layer, value, opts);
  }

  // A video in one colour (the background loop): the video in grey, the colour
  // multiplied over it; the layer's blend (screen) lets the board show through
  // its dark parts. Colour, brightness and speed can come from Global.
  function tintedVideo(layer, value, opts) {
    const box = el("div", "gfx-media gfx-tint");
    if (!value) return box;
    const v = el("video", "gfx-media", { objectFit: "cover",
      filter: `grayscale(1) brightness(${+GFX.resolve(layer.brightness ?? 1.6) || 1.6})` });
    v.src = url(encodeURI(value));
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = "auto";
    const speed = Math.max(0.1, Math.min(4, +GFX.resolve(layer.speed ?? 1) || 1));
    v.addEventListener("loadedmetadata", () => { v.playbackRate = speed; });
    if (opts.still) v.addEventListener("loadeddata", () => { try { v.currentTime = 2; } catch (e) { /* */ } }, { once: true });
    else { v.autoplay = true; v.play().catch(() => {}); }
    // (the colour only once there's a picture to colour: on its own it would fill the box)
    const tint = el("div", "gfx-media", { background: GFX.resolve(layer.tint) || "#ffffff", mixBlendMode: "multiply", visibility: "hidden" });
    v.addEventListener("loadeddata", () => { tint.style.visibility = ""; });
    v.addEventListener("error", () => { v.remove(); tint.remove(); });
    box.append(v, tint);
    return box;
  }

  // --- the knockout bracket: drawn from the "Tournament" data, for 8 or 16
  // teams ({{Tournament!Top teams}}), in the layer's box. The first round's
  // slots are gold, the later ones dark, the champion's outlined; a slot shows
  // the team's logo, name and score, and the team that lost is dimmed.
  const brackets = new Set();
  function bracketBox(layer) {
    const box = el("div", "gfx-media gfx-bracket");
    box._layer = layer;
    brackets.add(box);
    drawBracket(box);
    return box;
  }
  function redrawBrackets() {
    for (const b of brackets) { if (!b.isConnected && b._seen) brackets.delete(b); else { if (b.isConnected) b._seen = true; drawBracket(b); } }
  }
  function drawBracket(box) {
    const layer = box._layer;
    const rows = (ctx.tables.Tournament || []).filter(r => /^Top /.test(r[0] || ""));
    const size = +GFX.lookup(rows, "Top teams") === 16 ? 16 : 8;
    const key = JSON.stringify([rows, layer.w, layer.h, layer.font, layer.color, layer.gold, layer.line]);
    if (box._key === key) return;
    box._key = key;
    box.textContent = "";
    const get = k => GFX.lookup(rows, k);
    const Wd = layer.w, Ht = layer.h, rounds = Math.log2(size);
    const sw = Wd * (size === 16 ? 0.17 : 0.196), cw = Wd * (size === 16 ? 0.25 : 0.278);
    const gap = (Wd - rounds * sw - cw) / rounds;
    const unit = Ht / (size / 2);
    const sh = Math.min(Ht * 0.08, unit * 0.34), g = sh / 6;
    const gold = layer.gold || "#b28a1d", dark = layer.dark || "#000b05", line = layer.line || gold;
    const [family, weight] = GFX.fontFor(layer);
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", Wd); svg.setAttribute("height", Ht);
    Object.assign(svg.style, { position: "absolute", left: 0, top: 0, overflow: "visible" });
    box.appendChild(svg);
    const path = d => { const p = document.createElementNS(svgNS, "path"); p.setAttribute("d", d); p.setAttribute("fill", "none");
      p.setAttribute("stroke", line); p.setAttribute("stroke-width", Math.max(2, sh / 18)); svg.appendChild(p); };
    function slot(x, y, w, hgt, team, score, fill, lost, big) {
      const s = el("div", "gfx-bk-slot", { left: x + "px", top: y + "px", width: w + "px", height: hgt + "px", background: fill,
        opacity: lost ? 0.5 : 1, fontFamily: family, fontWeight: weight, color: layer.color || "#ffffff" });
      // (Short names: the team list's short name, when it has one)
      const name = (get("Top short names") === "on" && get(team + " short")) || get(team), logo = get(team + " logo");
      const sq = big ? 0 : hgt * 0.67;
      if (logo) {
        const img = el("img", "gfx-bk-logo", { width: hgt * 0.8 + "px", height: hgt * 0.8 + "px", left: hgt * 0.12 + "px", top: hgt * 0.1 + "px" });
        img.src = url(encodeURI(logo));
        s.appendChild(img);
      }
      const left = logo ? hgt * 1.05 : hgt * 0.25;
      const nameBox = el("div", "gfx-bk-name", { left: left + "px", right: sq + hgt * 0.2 + "px", fontSize: hgt * (big ? 0.42 : 0.6) + "px",
        justifyContent: big ? "center" : "flex-start" });
      nameBox.textContent = name;
      s.appendChild(nameBox);
      if (!big) {
        const sc = el("div", "gfx-bk-score", { width: sq + "px", fontSize: hgt * 0.6 + "px" });
        sc.textContent = get(score);
        s.appendChild(sc);
      }
      box.appendChild(s);
      // (too long: narrower)
      requestAnimationFrame(() => { const k = nameBox.clientWidth / (nameBox.scrollWidth || 1); if (k < 1) nameBox.style.fontSize = parseFloat(nameBox.style.fontSize) * Math.max(0.5, k) + "px"; });
    }
    if (get("Top format") === "double") return drawDouble();
    let centres = [];
    for (let r = 0; r < rounds; r++) {
      const n = size >> (r + 1), x = r * (sw + gap), next = [];
      for (let m = 0; m < n; m++) {
        const cy = r === 0 ? unit * (m + 0.5) : (centres[2 * m] + centres[2 * m + 1]) / 2;
        next.push(cy);
        const k = `Top R${r + 1} M${m + 1}`;
        const winner = get(r + 1 < rounds ? `Top R${r + 2} M${(m >> 1) + 1} team ${(m & 1) + 1}` : "Top champion");
        for (let t = 0; t < 2; t++) {
          const team = `${k} team ${t + 1}`;
          const lost = !!winner && !!get(team) && get(team) !== winner;
          slot(x, t ? cy + g / 2 : cy - g / 2 - sh, sw, sh, team, team + " score", r === 0 ? gold : dark, lost);
        }
        if (r + 1 === rounds) path(`M${x + sw + 4} ${cy}H${x + sw + gap - 4}`);   // (on to the champion)
      }
      if (r + 1 < rounds) {
        // The line on to where the winner goes: the next round's matches sit
        // between the two that feed them.
        for (let m = 0; m < n; m++) {
          const cy = next[m], pair = m >> 1, side = m & 1;
          const ny = (next[2 * pair] + next[2 * pair + 1]) / 2;
          const ty = side ? ny + g / 2 + sh / 2 : ny - g / 2 - sh / 2;
          const x1 = x + sw + 4, x2 = x + sw + gap - 4, xm = (x1 + x2) / 2;
          path(`M${x1} ${cy}H${xm}V${ty}H${x2}`);
        }
      }
      centres = next;
    }
    // The champion.
    const cx = rounds * (sw + gap), ch = sh * 2.4, cy = centres[0];
    const frame = el("div", "gfx-bk-champ", { left: cx + "px", top: cy - ch / 2 + "px", width: cw + "px", height: ch + "px",
      borderColor: layer.champ || "#ffc52a", borderWidth: Math.max(2, sh / 14) + "px" });
    box.appendChild(frame);
    const pad = ch * 0.1;
    slot(cx + pad, cy - ch / 2 + pad, cw - 2 * pad, ch - 2 * pad, "Top champion", "", dark, false, true);

    // Double elimination: the upper bracket on top, the lower bracket under
    // it (its rounds in columns, the upper rounds lined up with the lower
    // rounds they drop teams into), then the grand final, its reset and the
    // champion. The same slots, lines and champion frame as the single one.
    function drawDouble() {
      const k = rounds, L = 2 * k - 2, reset = get("Top reset") !== "off";
      const ncols = L + 1 + (reset ? 1 : 0);
      const sw = Wd / (ncols * 1.22 + 1.15), gap = sw * 0.22, cw = sw * 1.15;
      const lh = Math.max(14, Ht * 0.045), sepH = Ht * 0.03;
      const unit = (Ht - 2 * lh - sepH) / (size * 0.75);
      const sh = Math.min(Ht * 0.08, unit * (size === 16 ? 0.36 : 0.42)), g = sh / 6;
      const uTop = lh, lTop = lh + unit * size / 2 + sepH + lh;
      const colX = c => c * (sw + gap);
      const label = (text, x, y, w, align) => {
        const t = el("div", "gfx-bk-label", { left: x + "px", top: y + "px", width: w + "px", height: lh + "px", fontSize: lh * 0.8 + "px",
          fontFamily: family, fontWeight: weight, color: line, justifyContent: align || "flex-start" });
        t.textContent = text;
        box.appendChild(t);
      };
      label("Upper bracket", 0, 0, Wd * 0.5);
      label("Lower bracket", 0, lTop - lh, Wd * 0.5);
      const match = (key, x, cy, fill, unneeded) => {
        const winner = get(`Top ${key} winner`);
        for (let t = 0; t < 2; t++) {
          const team = `Top ${key} team ${t + 1}`;
          const lost = unneeded || (!!winner && !!get(team) && get(team) !== winner);
          slot(x, t ? cy + g / 2 : cy - g / 2 - sh, sw, sh, team, team + " score", fill, lost);
        }
      };
      // (a line from a match on to a slot of a later one)
      const into = (x, cy, tx, ncy, side) => {
        const ty = side ? ncy + g / 2 + sh / 2 : ncy - g / 2 - sh / 2;
        const x1 = x + sw + 4, x2 = tx - 4, xm = x2 - gap / 2 + 4;
        path(`M${x1} ${cy}H${xm}V${ty}H${x2}`);
      };
      // The upper bracket.
      let ucs = [], ucol = 0;
      for (let r = 0; r < k; r++) {
        const n = size >> (r + 1), col = r === 0 ? 0 : 2 * r - 1, x = colX(col), next = [];
        for (let m = 0; m < n; m++) {
          const cy = r === 0 ? uTop + unit * (m + 0.5) : (ucs[2 * m] + ucs[2 * m + 1]) / 2;
          next.push(cy);
          match(`R${r + 1} M${m + 1}`, x, cy, r === 0 ? gold : dark);
        }
        if (r > 0) for (let m = 0; m < ucs.length; m++) into(colX(ucol), ucs[m], x, next[m >> 1], m & 1);
        ucs = next; ucol = col;
      }
      // The lower bracket.
      let lcs = [];
      for (let r = 0; r < L; r++) {
        const n = (size / 4) >> (r >> 1), x = colX(r), next = [];
        const halves = r > 0 && r % 2 === 0;
        for (let m = 0; m < n; m++) {
          const cy = r === 0 ? lTop + unit * (m + 0.5) : halves ? (lcs[2 * m] + lcs[2 * m + 1]) / 2 : lcs[m];
          next.push(cy);
          match(`L${r + 1} M${m + 1}`, x, cy, dark);
        }
        if (r > 0) for (let m = 0; m < lcs.length; m++) into(colX(r - 1), lcs[m], x, halves ? next[m >> 1] : next[m], halves ? m & 1 : 0);
        lcs = next;
      }
      // The grand final (the upper bracket's winner against the lower's), its reset, the champion.
      const gy = (ucs[0] + lcs[0]) / 2, gx = colX(L);
      into(colX(L - 1), ucs[0], gx, gy, 0);
      into(colX(L - 1), lcs[0], gx, gy, 1);
      label("Grand final", gx, gy - g / 2 - sh - lh * 1.15, sw, "center");
      match("GF", gx, gy, dark);
      let last = gx;
      if (reset) {
        const rx = colX(L + 1);
        label("Reset", rx, gy - g / 2 - sh - lh * 1.15, sw, "center");
        path(`M${gx + sw + 4} ${gy}H${rx - 4}`);
        // (dimmed when the upper bracket's team won the grand final: no reset)
        const gfw = get("Top GF winner");
        match("GF2", rx, gy, dark, !!gfw && gfw === get("Top GF team 1"));
        last = rx;
      }
      const cx = colX(ncols), ch = sh * 2.4;
      path(`M${last + sw + 4} ${gy}H${cx - 4}`);
      const frame = el("div", "gfx-bk-champ", { left: cx + "px", top: gy - ch / 2 + "px", width: cw + "px", height: ch + "px",
        borderColor: layer.champ || "#ffc52a", borderWidth: Math.max(2, sh / 14) + "px" });
      box.appendChild(frame);
      const pad = ch * 0.1;
      slot(cx + pad, gy - ch / 2 + pad, cw - 2 * pad, ch - 2 * pad, "Top champion", "", dark, false, true);
    }
  }

  // --- shapes: an SVG of the layer's shape (see Shapes above) ---------------------
  // Fill: a colour (value: it can come from the data), a gradient or a picture
  // (a picture frame). Border inside, centred or outside, solid / dashed / dotted.
  let svgIds = 0;
  const NS = "http://www.w3.org/2000/svg";
  const sv = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); return e; };
  function gradientEl(layer, id) {
    const g = layer.grad || {}, radial = layer.fillType === "radial";
    const el2 = radial ? sv("radialGradient", { id, cx: "50%", cy: "50%", r: "70%" })
      : sv("linearGradient", { id, x1: "0", y1: "0", x2: "1", y2: "0", gradientTransform: `rotate(${+(g.angle ?? 90) - 90} .5 .5)` });
    const stops = (g.stops && g.stops.length ? g.stops : [{ at: 0, color: "#f28c28" }, { at: 100, color: "#7a2a00" }]);
    for (const st of stops) el2.appendChild(sv("stop", { offset: (+st.at || 0) + "%", "stop-color": GFX.resolve(st.color || "#000") || "#000", "stop-opacity": st.alpha ?? 1 }));
    return el2;
  }
  function buildShape(layer, value, opts) {
    const w = Math.max(1, +layer.w || 1), h = Math.max(1, +layer.h || 1), id = "s" + (++svgIds);
    const box = el("div", "gfx-shape", { position: "relative", width: "100%", height: "100%" });
    const svg = sv("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", height: "100%", preserveAspectRatio: "none" });
    svg.style.overflow = "visible";
    svg.style.display = "block";
    const defs = sv("defs", {});
    svg.appendChild(defs);
    const sw = +layer.strokeWidth || 0, stroke = sw ? (GFX.resolve(layer.stroke || "#ffffff") || "#ffffff") : null;
    const dash = layer.dash === "dash" ? `${sw * 3} ${sw * 2}` : layer.dash === "dot" ? `0 ${sw * 2}` : null;
    const cap = layer.dash === "dot" ? "round" : layer.cap || "butt";

    if (Shapes.isLine(layer)) {
      // A line across the box's middle (rotate the layer to point it), with its ends.
      const t = Math.max(1, sw || 6), col = GFX.resolve(layer.stroke || value || "#ffffff") || "#ffffff";
      const ends = { start: layer.headStart || "none", end: layer.headEnd || (layer.shape === "arrow" ? "arrow" : "none") };
      const len = t * 3.2, y = h / 2;
      let x0 = 0, x1 = w;
      for (const side of ["start", "end"]) {
        const kind = ends[side];
        if (kind === "none") continue;
        const tip = side === "end" ? w : 0, dir = side === "end" ? -1 : 1;
        if (kind === "arrow" || kind === "triangle") {
          const base = tip + dir * len;
          if (kind === "triangle") svg.appendChild(sv("path", { d: `M${tip} ${y}L${base} ${y - len * 0.6}L${base} ${y + len * 0.6}Z`, fill: col }));
          else svg.appendChild(sv("path", { d: `M${base} ${y - len * 0.6}L${tip} ${y}L${base} ${y + len * 0.6}`, fill: "none", stroke: col, "stroke-width": t, "stroke-linecap": "round", "stroke-linejoin": "round" }));
          if (kind === "triangle") { if (side === "end") x1 = base + 1; else x0 = base - 1; }
        } else if (kind === "circle") svg.appendChild(sv("circle", { cx: tip + dir * t * 1.2, cy: y, r: t * 1.2, fill: col }));
        else if (kind === "bar") svg.appendChild(sv("rect", { x: tip - (side === "end" ? t : 0), y: y - t * 1.6, width: t, height: t * 3.2, fill: col }));
      }
      svg.insertBefore(sv("path", { d: `M${x0} ${y}L${x1} ${y}`, stroke: col, "stroke-width": t, "stroke-dasharray": layer.dash === "dash" ? `${t * 3} ${t * 2}` : layer.dash === "dot" ? `0 ${t * 2}` : null,
        "stroke-linecap": layer.dash === "dot" ? "round" : layer.cap || "butt", fill: "none" }), defs.nextSibling);
      box.appendChild(svg);
      return box;
    }

    const d = Shapes.path(layer, w, h);
    // The fill.
    let fill = value || "transparent";
    const ft = layer.fillType || "solid";
    if (ft === "linear" || ft === "radial") { defs.appendChild(gradientEl(layer, id + "g")); fill = `url(#${id}g)`; }
    else if (ft === "image") {
      const pat = sv("pattern", { id: id + "p", patternUnits: "userSpaceOnUse", width: w, height: h });
      if (value) {
        const im = sv("image", { href: url(encodeURI(value)), width: w, height: h,
          preserveAspectRatio: layer.fit === "fill" ? "none" : layer.fit === "contain" ? "xMidYMid meet" : "xMidYMid slice" });
        pat.appendChild(im);
      }
      defs.appendChild(pat);
      fill = value ? `url(#${id}p)` : "rgba(255,255,255,.08)";
    }
    // Inner shadow (inside the shape's edge).
    const fx = layer.fx || {};
    let filter = null;
    if (fx.inner && fx.inner.on) {
      const s2 = fx.inner, f2 = sv("filter", { id: id + "i", x: "-20%", y: "-20%", width: "140%", height: "140%" });
      f2.innerHTML = `<feComponentTransfer in="SourceAlpha"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>`
        + `<feGaussianBlur stdDeviation="${+s2.blur || 8}"/><feOffset dx="${+s2.x || 0}" dy="${+s2.y || 4}" result="o"/>`
        + `<feFlood flood-color="${s2.color || "#000"}" flood-opacity="${s2.alpha ?? 0.6}"/><feComposite in2="o" operator="in"/>`
        + `<feComposite in2="SourceAlpha" operator="in"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode/></feMerge>`;
      defs.appendChild(f2);
      filter = `url(#${id}i)`;
    }
    const paths = [];
    if (layer.shape === "combo" && (layer.parts || []).length) {
      // A combined shape: joined (union), the first minus the rest (subtract) or only where all overlap (intersect).
      const parts = layer.parts.map(pt => Shapes.offset(Shapes.path(pt, +pt.w || 1, +pt.h || 1), +pt.x || 0, +pt.y || 0));
      const op = layer.op || "union";
      if (op === "union") paths.push(...parts.map(pd => ({ d: pd })));
      else if (op === "subtract") {
        const m = sv("mask", { id: id + "m", maskUnits: "userSpaceOnUse", x: -w, y: -h, width: w * 3, height: h * 3 });
        m.appendChild(sv("rect", { x: -w, y: -h, width: w * 3, height: h * 3, fill: "#fff" }));
        parts.slice(1).forEach(pd => m.appendChild(sv("path", { d: pd, fill: "#000" })));
        defs.appendChild(m);
        paths.push({ d: parts[0], mask: `url(#${id}m)` });
      } else {
        let clip = null;
        parts.slice(1).forEach((pd, i) => {
          const c = sv("clipPath", { id: `${id}c${i}`, "clip-path": clip });
          c.appendChild(sv("path", { d: pd }));
          defs.appendChild(c);
          clip = `url(#${id}c${i})`;
        });
        paths.push({ d: parts[0], clip });
      }
    } else paths.push({ d });
    const g = sv("g", { filter, mask: paths[0].mask, "clip-path": paths[0].clip });
    const rule = layer.shape === "ring" ? "evenodd" : "nonzero";
    const align = layer.strokeAlign || "center";
    for (const p of paths) {
      if (stroke && align === "outside") g.appendChild(sv("path", { d: p.d, fill: "none", stroke, "stroke-width": sw * 2, "stroke-dasharray": dash, "stroke-linecap": cap, "stroke-linejoin": "round" }));
      g.appendChild(sv("path", { d: p.d, fill, "fill-rule": rule }));
    }
    if (stroke && align !== "outside") {
      for (const [i, p] of paths.entries()) {
        let clip = null;
        if (align === "inside") {
          const c = sv("clipPath", { id: `${id}s${i}` });
          c.appendChild(sv("path", { d: p.d, "clip-rule": rule }));
          defs.appendChild(c);
          clip = `url(#${id}s${i})`;
        }
        g.appendChild(sv("path", { d: p.d, fill: "none", stroke, "stroke-width": align === "inside" ? sw * 2 : sw, "stroke-dasharray": dash, "stroke-linecap": cap, "stroke-linejoin": "round", "clip-path": clip }));
      }
    }
    svg.appendChild(g);
    // Blur behind (frosted glass): the page behind, blurred, in the shape's outline.
    if (+fx.backdrop > 0 && d) {
      const back = el("div", "", { position: "absolute", inset: "0", backdropFilter: `blur(${+fx.backdrop}px)`, webkitBackdropFilter: `blur(${+fx.backdrop}px)` });
      back.style.clipPath = `path('${d}')`;
      box.appendChild(back);
    }
    box.appendChild(svg);
    return box;
  }
  GFX.buildShape = buildShape;

  // Effects any layer can have (layer.fx): drop shadow, glow and blur, as a CSS filter
  // on the layer's content (they follow its outline: text, a logo's edges, a shape).
  function fxFilter(layer) {
    const fx = layer.fx || {}, out = [];
    if (fx.shadow && fx.shadow.on) { const s2 = fx.shadow; out.push(`drop-shadow(${+s2.x || 0}px ${+(s2.y ?? 6)}px ${+(s2.blur ?? 12)}px ${GFX.resolve(s2.color || "rgba(0,0,0,.6)") || "rgba(0,0,0,.6)"})`); }
    if (fx.glow && fx.glow.on) { const c = GFX.resolve(fx.glow.color || "#f28c28") || "#f28c28", b = +(fx.glow.blur ?? 14); out.push(`drop-shadow(0 0 ${b}px ${c})`, `drop-shadow(0 0 ${Math.round(b / 2)}px ${c})`); }
    if (+fx.blur > 0) out.push(`blur(${+fx.blur}px)`);
    return out.join(" ");
  }
  GFX.fxFilter = fxFilter;

  function buildOther(layer, value, opts) {
    const t = layer.type;
    if (t === "shape") return buildShape(layer, value, opts);
    if (t === "lottie") {
      const box = el("div", "gfx-media");
      if (value && window.lottie) {
        const anim = window.lottie.loadAnimation({ container: box, renderer: "svg", loop: layer.loop !== false,
          autoplay: !opts.still, path: url(encodeURI(value)), rendererSettings: { preserveAspectRatio: layer.fit === "fill" ? "none" : layer.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet" } });
        box._lottie = anim;
        if (opts.still) anim.addEventListener("DOMLoaded", () => anim.goToAndStop(Math.floor(anim.totalFrames / 2), true));
      }
      return box;
    }
    if (t === "ticker") {
      const box = el("div", "gfx-ticker", { overflow: "hidden", display: "flex", alignItems: "center", width: "100%", height: "100%" });
      // Soft edges so logos slide in and out instead of being cut off. On unless turned off; a number is the fade width in %.
      const fade = layer.fade === false ? 0 : typeof layer.fade === "number" ? layer.fade : 8;
      if (fade > 0) box.style.maskImage = box.style.webkitMaskImage = `linear-gradient(90deg,transparent,#000 ${fade}%,#000 ${100 - fade}%,transparent)`;
      box._layer = layer;
      box._still = !!opts.still;
      buildTicker(box);
      if (!opts.still) tickers.add(box);
      return box;
    }
    if (t === "rotator") {
      const box = el("div", "gfx-rotator", { position: "relative", overflow: "hidden", width: "100%", height: "100%" });
      box._layer = layer;
      box._still = !!opts.still;
      turnRotator(box);
      if (!opts.still) itemRotators.add(box);
      return box;
    }
    if (t === "rect") {
      return el("div", "gfx-rect", {
        background: value || "transparent", borderRadius: (layer.radius || 0) + "px",
        border: layer.strokeWidth ? `${layer.strokeWidth}px solid ${layer.stroke || "#fff"}` : "none",
      });
    }
    if (t === "text") {
      const box = el("div", "gfx-text");
      const [family, weight] = GFX.fontFor(layer);
      Object.assign(box.style, {
        fontFamily: family, fontWeight: weight, fontStyle: layer.italic ? "italic" : "normal",
        fontSize: layer.size + "px", color: layer.color,
        lineHeight: layer.lineHeight || 1.15, letterSpacing: ((layer.tracking || 0) / 1000) + "em",
        textTransform: layer.caps ? "uppercase" : "none", textAlign: layer.align || "left",
        justifyContent: { left: "flex-start", center: "center", right: "flex-end" }[layer.align || "left"],
        alignItems: { top: "flex-start", middle: "center", bottom: "flex-end" }[layer.valign || "top"],
        textShadow: layer.shadow ? "0 2px 8px rgba(0,0,0,.6)" : "none",
        fontVariant: layer.smallCaps ? "small-caps" : "normal",
      });
      const span = el("span", "gfx-t");
      box.appendChild(span);
      box._layer = layer;
      box._raw = value;
      setText(box, opts);
      if (!opts.still && (hasTokens(value))) live.add(box);
      // Fitted (and put on its baseline) once it's on the page with its real
      // size, and again whenever it's shown after being hidden.
      if (sized) sized.observe(box);
      return box;
    }
    return el("div");
  }
  const fitOf = f => ({ fill: "fill", contain: "contain", cover: "cover" }[f] || "contain");
  // Where a picture sits in its box when it doesn't fill it (a headshot stands on the bottom).
  const POSITIONS = { top: "50% 0%", bottom: "50% 100%", left: "0% 50%", right: "100% 50%" };

  // A big picture in a small box (a team's logo, say) is scaled down by the
  // browser in one step, which looks jagged: it's resampled once, smoothly, to
  // twice the size it's shown at.
  // (each picture is resampled once, then kept: the next take has it at once)
  const smoothed = new Map();
  const smoothKey = (value, layer) => [value, layer.w, layer.h, layer.fit].join("|");
  function smooth(img, layer, value) {
    const nw = img.naturalWidth, nh = img.naturalHeight;
    const k = layer.fit === "cover" ? Math.max(layer.w / nw, layer.h / nh) : Math.min(layer.w / nw, layer.h / nh);
    if (!nw || !nh || k * 2 >= 0.75 || !window.createImageBitmap) return;
    const w = Math.max(1, Math.round(nw * k * 2)), h = Math.max(1, Math.round(nh * k * 2));
    const key = smoothKey(value, layer);
    createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" }).then(bmp => {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(bmp, 0, 0);
      bmp.close && bmp.close();
      c.toBlob(b => {
        if (!b) return;
        const u = URL.createObjectURL(b);
        // (swapped in once it's decoded: no blank frame)
        const next = new Image();
        next.src = u;
        (next.decode ? next.decode() : Promise.resolve()).catch(() => {}).then(() => {
          if (smoothed.size > 400) { for (const old of smoothed.values()) URL.revokeObjectURL(old); smoothed.clear(); }
          smoothed.set(key, u);
          warm.set(u, next);
          if (img.isConnected || !img.complete) img.src = u;
        });
      }, "image/png");
    }).catch(() => {});
  }

  // --- pictures kept ready ----------------------------------------------------------
  // Every picture the graphics show is loaded and decoded ahead, and kept in
  // memory, so a graphic taken to air has all of them on its first frame.
  const warm = new Map();      // address -> decoded <img>
  const warmVideos = new Map(); // address -> <video> kept loading
  GFX.warm = function (comps, valuesOf) {
    const want = new Set(), videos = new Set();
    const add = v => { if (v && !/\{\{/.test(v)) want.add(url(encodeURI(v))); };
    for (const s of GFX.sponsors()) add(s.logo);
    for (const comp of comps || []) {
      const values = valuesOf(comp.id) || {};
      for (const layer of comp.layers || []) {
        if (layer.visible === false) continue;
        if (layer.type !== "image" && layer.type !== "video") continue;
        const v = GFX.content(layer, values);
        if (layer.type === "video") { if (v && !/\{\{/.test(v)) videos.add(url(encodeURI(v))); continue; }
        if (v.startsWith("{{Sponsors")) continue;
        add(v);
        const done = smoothed.get(smoothKey(v, layer));
        if (done) want.add(done);
      }
    }
    for (const u of want) {
      if (warm.has(u)) continue;
      const img = new Image();
      img.decoding = "async";
      img.src = u;
      img._ready = (img.decode ? img.decode() : new Promise(r => { img.onload = img.onerror = r; })).catch(() => {});
      warm.set(u, img);
    }
    for (const u of [...warm.keys()]) if (!want.has(u)) warm.delete(u);
    // (the few videos, the background loop say, are kept loaded too)
    for (const u of [...videos].slice(0, 8)) {
      if (warmVideos.has(u)) continue;
      const v = document.createElement("video");
      v.muted = true; v.preload = "auto"; v.src = u;
      warmVideos.set(u, v);
    }
    for (const [u, v] of [...warmVideos]) if (!videos.has(u)) { v.removeAttribute("src"); v.load(); warmVideos.delete(u); }
  };
  // Resolves once a graphic's pictures are ready to show (or after `ms`, whatever comes first).
  GFX.ready = function (root, ms) {
    const waits = [];
    root.querySelectorAll("img").forEach(img => {
      if (!img.src) return;
      const kept = warm.get(img.src);
      if (kept) waits.push(kept._ready);
      else if (!img.complete) waits.push(new Promise(r => { img.addEventListener("load", r, { once: true }); img.addEventListener("error", r, { once: true }); }));
      else if (img.decode) waits.push(img.decode().catch(() => {}));
    });
    // (a game HUD's page: loaded before it's shown, a little longer allowed)
    const pages = root.querySelectorAll("iframe");
    pages.forEach(f => waits.push(new Promise(r => { f.addEventListener("load", r, { once: true }); f.addEventListener("error", r, { once: true }); })));
    if (!waits.length) return Promise.resolve();
    return Promise.race([Promise.all(waits), new Promise(r => setTimeout(r, pages.length ? 1500 : ms || 400))]);
  };

  function setText(box, opts) {
    const layer = box._layer;
    const text = GFX.resolve(box._raw);
    // A picture before the text (a player's flag), sized to the letters.
    const icon = layer.icon ? GFX.resolve(layer.icon).trim() : "";
    if (box._shown === text + "\u0000" + icon && !opts) return;
    box._shown = text + "\u0000" + icon;
    const span = box.firstChild;
    if (layer.scroll > 0) {
      // A ticker: the text twice in a row, sliding along forever.
      box.classList.add("gfx-scroll");
      span.textContent = "";
      const a = tickerRun(layer, text), b = tickerRun(layer, text);
      span.append(a, b);
      requestAnimationFrame(() => {
        const w = a.offsetWidth || 1;
        span.getAnimations().forEach(x => x.cancel());
        span.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-w}px)` }],
          { duration: (w / layer.scroll) * 1000, iterations: Infinity });
      });
      return;
    }
    span.textContent = text;
    if (icon && text) {
      const img = el("img", "gfx-icon");
      img.src = url(encodeURI(icon));
      img.onload = () => fit(box);
      span.insertBefore(img, span.firstChild);
    }
    fit(box);
  }

  // --- ticker: items (picture + text) side by side, twice in a row, sliding forever ---
  const tickers = new Set();
  function tickerItems(layer) {
    let items = layer.items || [];
    const name = layer.source && Object.keys(ctx.tables || {}).find(k => k.toLowerCase() === layer.source.toLowerCase());
    if (name) {
      const rows = ctx.tables[name] || [], head = rows[0] || [];
      const ti = head.indexOf(layer.textCol), ii = head.indexOf(layer.imgCol);
      items = rows.slice(1).map(r => ({ text: ti >= 0 ? r[ti] || "" : "", img: ii >= 0 ? r[ii] || "" : "" }));
    }
    return items.map(it => ({ text: GFX.resolve(it.text || ""), img: hasTokens(it.img) ? GFX.resolve(it.img).trim() : it.img || "" }))
      .filter(it => it.text || it.img);
  }
  function buildTicker(box) {
    const layer = box._layer, items = tickerItems(layer), sig = JSON.stringify(items);
    if (box._sig === sig) return;
    box._sig = sig;
    const [family, weight] = GFX.fontFor(layer);
    const gap = (layer.gap ?? 60) + "px";
    const group = el("div", "", { display: "flex", alignItems: "center", flex: "none", whiteSpace: "nowrap", paddingRight: gap,
      fontFamily: family, fontWeight: weight, fontStyle: layer.italic ? "italic" : "normal", fontSize: layer.size + "px", color: layer.color,
      letterSpacing: ((layer.tracking || 0) / 1000) + "em", textTransform: layer.caps ? "uppercase" : "none" });
    items.forEach((it, i) => {
      if (i && layer.sep) group.appendChild(Object.assign(el("span", "", { margin: `0 calc(${gap} / 2)`, opacity: 0.7 }), { textContent: layer.sep }));
      else if (i) group.appendChild(el("span", "", { width: gap, flex: "none" }));
      const item = el("span", "", { display: "inline-flex", alignItems: "center", gap: "12px" });
      if (it.img) { const img = el("img", "", { height: (layer.imgSize || 48) + "px", width: "auto", objectFit: "contain" }); img.draggable = false; img.src = url(encodeURI(it.img)); item.appendChild(img); }
      if (it.text) item.appendChild(Object.assign(el("span"), { textContent: it.text }));
      group.appendChild(item);
    });
    const row = el("div", "", { display: "flex", alignItems: "center", flex: "none" });
    row.append(group, group.cloneNode(true));
    box.replaceChildren(row);
    if (box._still || !items.length) return;
    const go = () => {
      const w = group.offsetWidth || 1;
      row.getAnimations().forEach(x => x.cancel());
      row.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-w}px)` }], { duration: (w / Math.max(5, layer.speed || 120)) * 1000, iterations: Infinity });
    };
    setTimeout(go, 30);   // a timer, not a frame callback: outputs in a hidden tab or vMix input still start
    box.querySelectorAll("img").forEach(img => img.addEventListener("load", go, { once: true }));   // widths change as pictures load
  }
  // New data or the clock: rebuild a ticker only when its items really changed.
  setInterval(() => { for (const b of tickers) { if (!b.isConnected) tickers.delete(b); else buildTicker(b); } }, 1000);
  // --- rotator: one item at a time in place, swapping every few seconds ---
  // Which item shows comes from the clock, so every output (Preview, Program, a
  // second PC) shows the same one at the same time without talking to each other.
  const itemRotators = new Set();
  function rotatorIndex(layer, n, now) {
    const ms = Math.max(1, +layer.secs || 8) * 1000, turn = Math.floor(now / ms);
    if (layer.order !== "shuffle" || n < 3) return turn % n;
    // Shuffled: a fresh order every round, the same on every output (seeded by the round).
    const round = Math.floor(turn / n), order = [...Array(n).keys()];
    let seed = round * 2654435761 % 4294967296;
    for (let i = n - 1; i > 0; i--) { seed = (seed * 1664525 + 1013904223) % 4294967296; const j = seed % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    return order[turn % n];
  }
  GFX.rotatorIndex = rotatorIndex;
  function rotatorItem(layer, it) {
    const [family, weight] = GFX.fontFor(layer);
    const item = el("div", "", { position: "absolute", inset: "0", display: "flex", alignItems: "center", justifyContent: layer.align === "left" ? "flex-start" : layer.align === "right" ? "flex-end" : "center", gap: "14px",
      fontFamily: family, fontWeight: weight, fontStyle: layer.italic ? "italic" : "normal", fontSize: layer.size + "px", color: layer.color, whiteSpace: "nowrap",
      letterSpacing: ((layer.tracking || 0) / 1000) + "em", textTransform: layer.caps ? "uppercase" : "none" });
    if (it.img) {
      // A picture on its own fills the box; next to text it's the set height.
      const img = el("img", "", it.text ? { height: (layer.imgSize || 80) + "px", width: "auto", objectFit: "contain" } : { width: "100%", height: "100%", objectFit: fitOf(layer.fit) });
      img.draggable = false; img.src = url(encodeURI(it.img)); item.appendChild(img);
    }
    if (it.text) item.appendChild(Object.assign(el("span"), { textContent: it.text }));
    return item;
  }
  // Rotator swaps: [new one in, old one out, how] ("seq": the old goes out first, then the new comes in).
  const T = v => ({ transform: v }), O = (o, t) => ({ opacity: o, transform: t || "none" });
  const CLIP = (a, b) => [{ clipPath: a }, { clipPath: b }];
  const SWAPS = {
    "crossfade": [[O(0), O(1)], [O(1), O(0)]],
    "alpha fade": [[O(0), O(1)], [O(1), O(0)], "seq"],
    "dip to black": [[{ opacity: 0, filter: "brightness(0)" }, { opacity: 1, filter: "brightness(1)" }], [{ opacity: 1, filter: "brightness(1)" }, { opacity: 0, filter: "brightness(0)" }], "seq"],
    "slide up": [[T("translateY(100%)"), T("none")], [T("none"), T("translateY(-100%)")]],
    "slide down": [[T("translateY(-100%)"), T("none")], [T("none"), T("translateY(100%)")]],
    "slide left": [[T("translateX(100%)"), T("none")], [T("none"), T("translateX(-100%)")]],
    "slide right": [[T("translateX(-100%)"), T("none")], [T("none"), T("translateX(100%)")]],
    "rise": [[{ opacity: 0, transform: "translateY(35%) scale(.92)", filter: "blur(4px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }],
             [{ opacity: 1, transform: "none", filter: "blur(0)" }, { opacity: 0, transform: "translateY(-35%) scale(.92)", filter: "blur(4px)" }]],
    "swipe left": [CLIP("inset(0 0 0 100%)", "inset(0 0 0 0)"), CLIP("inset(0 0 0 0)", "inset(0 100% 0 0)")],
    "swipe right": [CLIP("inset(0 100% 0 0)", "inset(0 0 0 0)"), CLIP("inset(0 0 0 0)", "inset(0 0 0 100%)")],
    "swipe up": [CLIP("inset(100% 0 0 0)", "inset(0 0 0 0)"), CLIP("inset(0 0 0 0)", "inset(0 0 100% 0)")],
    "wipe": [CLIP("inset(0 100% 0 0)", "inset(0 0 0 0)"), [O(1), O(1)]],
    "iris": [CLIP("circle(0% at 50% 50%)", "circle(75% at 50% 50%)"), [O(1), O(1)]],
    "zoom in": [[O(0, "scale(.6)"), O(1)], [O(1), O(0, "scale(1.4)")]],
    "zoom out": [[O(0, "scale(1.4)"), O(1)], [O(1), O(0, "scale(.6)")]],
    "pop": [[O(0, "scale(.4)"), { opacity: 1, transform: "scale(1.08)", offset: .7 }, O(1)], [O(1), O(0, "scale(.8)")], "seq"],
    "flip": [[O(0, "perspective(600px) rotateX(-90deg)"), O(1, "perspective(600px) rotateX(0)")], [O(1, "perspective(600px) rotateX(0)"), O(0, "perspective(600px) rotateX(90deg)")], "seq"],
    "spin": [[O(0, "rotate(-180deg) scale(.5)"), O(1)], [O(1), O(0, "rotate(180deg) scale(.5)")]],
    "blur": [[{ opacity: 0, filter: "blur(16px)" }, { opacity: 1, filter: "blur(0)" }], [{ opacity: 1, filter: "blur(0)" }, { opacity: 0, filter: "blur(16px)" }]],
    "cut": null,
  };
  SWAPS.fade = SWAPS.crossfade;   // (rotators made before the list grew)
  GFX.rotatorSwaps = Object.keys(SWAPS).filter(k => k !== "fade");
  function turnRotator(box, now = GFX.now()) {
    const layer = box._layer, items = tickerItems(layer);
    const sig = JSON.stringify(items) + [layer.secs, layer.order, layer.size, layer.color, layer.font, layer.imgSize, layer.caps, layer.align, layer.fit];
    if (!items.length) { box._sig = sig; box._i = -1; box.replaceChildren(); return; }
    const i = box._still ? 0 : rotatorIndex(layer, items.length, now);
    if (box._sig === sig && box._i === i) return;
    const fresh = box._sig !== sig;
    box._sig = sig; box._i = i;
    const next = rotatorItem(layer, items[i]), old = [...box.children];
    box.appendChild(next);
    const swap = SWAPS[layer.swap || "crossfade"];
    if (fresh || box._still || !swap) { old.forEach(o => o.remove()); return; }
    // Swap time: set on the layer (ms), never more than a third of the time each item shows.
    const dur = Math.max(80, Math.min(+layer.swapMs || 600, Math.max(1, +layer.secs || 8) * 333));
    const seq = swap[2] === "seq", half = seq ? dur / 2 : dur;
    next.animate(swap[0], { duration: half, delay: seq ? half : 0, easing: "cubic-bezier(.2,.7,.2,1)", fill: "backwards" });
    old.forEach(o => o.animate(swap[1], { duration: half, easing: "cubic-bezier(.4,0,.6,1)", fill: "forwards" }));
    // (a timer, not the animation's end: paused or hidden pages never finish it)
    setTimeout(() => old.forEach(o => o.remove()), half + 50);
  }
  setInterval(() => { for (const b of itemRotators) { if (!b.isConnected && b._seen) itemRotators.delete(b); else if (b.isConnected) { b._seen = true; turnRotator(b); } } }, 200);

  // One run of a ticker's text. With a divider, the "|" between its lines is
  // drawn as a bar in the divider's colour.
  function tickerRun(layer, text) {
    const run = el("span", "gfx-tick");
    if (!layer.divider) { run.textContent = text; return run; }
    const w = layer.dividerWidth || 6, gap = layer.dividerGap ?? Math.round(layer.size * 1.4);
    text.split(/\s*\|\s*/).forEach((part, i, all) => {
      if (part) run.appendChild(document.createTextNode(part));
      if (i < all.length - 1) run.appendChild(el("i", "gfx-div", { width: w + "px", background: layer.divider, margin: `0 ${gap}px` }));
    });
    return run;
  }

  // A layer shown only while its "show" value has something in it (and isn't 0):
  // the Schedule's matches beyond how many it shows, say.
  const showing = layer => { const v = GFX.resolve(layer.show).trim(); return !!v && v !== "0" && v.toLowerCase() !== "false"; };
  function reshow() {
    document.querySelectorAll(".gfx-L").forEach(L => {
      if (L._layer && L._layer.show) L.style.display = showing(L._layer) ? "" : "none";
      if (L._layer) restyle(L);
      if (L._layer && L._layer.when && !L._edit) toggle(L);
    });
  }

  // --- live data rules: "Show when" and "Fill by" ----------------------------
  // layer.when: [{value: "{{Rocket League HUD!target_has_cam}}", op, to}], all
  // true for the layer to show. When that changes on air the layer plays its
  // own Out animation and hides (a cam box sliding down), or its In animation.
  const truthy = v => { v = String(v == null ? "" : v).trim().toLowerCase(); return !!v && v !== "0" && v !== "false"; };
  const num = v => { const n = parseFloat(String(v).replace(/[^0-9.+-]/g, "")); return isFinite(n) ? n : 0; };
  GFX.test = function (rule) {
    const v = GFX.resolve(rule.value).trim(), to = GFX.resolve(rule.to == null ? "" : rule.to).trim();
    switch (rule.op || "has") {
      case "has": return truthy(v);
      case "empty": return !truthy(v);
      case "is": return v.toLowerCase() === to.toLowerCase();
      case "not": return v.toLowerCase() !== to.toLowerCase();
      case ">=": return num(v) >= num(to);
      case "<=": return num(v) <= num(to);
      case ">": return num(v) > num(to);
      case "<": return num(v) < num(to);
      default: return true;
    }
  };
  GFX.wanted = layer => (Array.isArray(layer.when) ? layer.when : [layer.when]).filter(r => r && r.value).every(GFX.test);
  GFX.RULE_OPS = [["has", "has something"], ["empty", "is empty"], ["is", "is"], ["not", "isn't"],
    [">=", "is at least"], ["<=", "is at most"], [">", "is more than"], ["<", "is less than"]];
  function toggle(L, first) {
    const want = GFX.wanted(L._layer);
    if (L._on === want) return;
    const was = L._on;
    L._on = want;
    // Faded rather than hidden (an empty series box): just the opacity.
    if (L._layer.otherwise === "dim") {
      L.style.visibility = "";
      const to = want ? (L._layer.opacity == null ? 1 : L._layer.opacity) : 0.25;
      if (first || was == null) L.style.opacity = to;
      else L.animate([{ opacity: getComputedStyle(L).opacity }, { opacity: to }], { duration: 250, fill: "forwards" })
        .finished.then(a => { L.style.opacity = to; }, () => {});
      return;
    }
    const inner = L.firstChild;
    if (L._anim) { L._anim.cancel(); L._anim = null; }
    if (first || was == null || !inner) { L.style.visibility = want ? "" : "hidden"; return; }
    const a = (L._layer.anim && L._layer.anim[want ? "in" : "out"]) || { type: "fade", dur: 300 };
    const f = frames(a.type === "none" ? "fade" : a.type, L._layer);
    L.style.visibility = "";
    const run = inner.animate(want ? f : f.slice().reverse(), { duration: Math.max(1, +a.dur || 300),
      easing: want ? EASE : EASE_OUT, fill: want ? "none" : "forwards" });
    L._anim = run;
    run.finished.then(() => { if (L._anim === run) { L._anim = null; if (!want) { L.style.visibility = "hidden"; run.cancel(); } } }, () => {});
  }

  // layer.meter: {value, max, dir: right|left|up|down|ring, start, sweep}:
  // the layer is cut to how full the value is (a boost bar; the boost dial's
  // ring, swept from "start" degrees round by "sweep").
  function meter(L) {
    const m = L._layer.meter, box = L.firstChild && L.firstChild.firstChild;
    if (!m || !m.value || !box) return;
    const raw = GFX.resolve(m.value).trim();
    const max = num(GFX.resolve(m.max == null || m.max === "" ? "100" : m.max)) || 100;
    const k = raw === "" ? (L._edit ? 1 : 0) : Math.max(0, Math.min(1, num(raw) / max));
    const shape = [m.dir, m.start, m.sweep].join("|");
    if (box._k == null || box._shape !== shape) { box._shape = shape; cut(box, m, box._k = k); return; }
    if (Math.abs((box._to != null ? box._to : box._k) - k) < 0.0005) return;
    // (eases from one value to the next, as the game's numbers come in)
    const from = box._k, at = performance.now();
    box._to = k;
    cancelAnimationFrame(box._raf);
    const step = now => {
      const t = Math.min(1, (now - at) / 180);
      cut(box, m, box._k = from + (k - from) * t);
      if (t < 1) box._raf = requestAnimationFrame(step); else box._to = null;
    };
    box._raf = requestAnimationFrame(step);
  }
  function cut(box, m, k) {
    const p = ((1 - k) * 100).toFixed(2) + "%";
    if (m.dir === "ring") {
      const mask = `conic-gradient(from ${+m.start || 0}deg, #000 ${(k * (+m.sweep || 360)).toFixed(2)}deg, transparent 0)`;
      box.style.webkitMaskImage = box.style.maskImage = mask;
    } else {
      box.style.clipPath = { left: `inset(0 0 0 ${p})`, up: `inset(${p} 0 0 0)`, down: `inset(0 0 ${p} 0)` }[m.dir] || `inset(0 ${p} 0 0)`;
    }
  }

  // What a layer's look takes from the data as it changes: its colour
  // ({{Global!Caster primary}}) and where it's moved to ("dx dy scale", around
  // layer.origin on the canvas: the caster boxes, spaced out by how many there are).
  function restyle(L) {
    const layer = L._layer;
    if (layer.move) {
      const [dx, dy, sc] = GFX.resolve(layer.move).trim().split(/\s+/).map(Number);
      const o = layer.origin || [layer.x, layer.y];
      L.style.transformOrigin = `${o[0] - layer.x}px ${o[1] - layer.y}px`;
      L.style.transform = `translate(${dx || 0}px, ${dy || 0}px) scale(${sc || 1})` + (layer.rotation ? ` rotate(${layer.rotation}deg)` : "");
    }
    if (layer.recolor) { const m = L.querySelector(".gfx-recolor"); if (m) m.style.background = GFX.resolve(layer.recolor) || "#ffffff"; }
    if (layer.type === "text" && hasTokens(layer.color)) { const b = L.querySelector(".gfx-text"); if (b) b.style.color = GFX.resolve(layer.color); }
    if (layer.meter) meter(L);
  }

  // Text from a Photoshop file sits on its baseline where Photoshop put it,
  // whatever the font's own spacing above the letters.
  function baseline(box) {
    const layer = box._layer, span = box.firstChild;
    if (!layer || !span || layer.baseline == null || layer.scroll > 0 || (layer.valign || "top") !== "top") return;
    span.style.marginTop = "";
    let mark = span.querySelector(":scope > .gfx-bl");
    if (!mark) { mark = el("i", "gfx-bl"); }
    span.insertBefore(mark, span.firstChild);
    if (!box.isConnected || !box.offsetHeight) return;
    span.style.marginTop = (layer.baseline - mark.offsetTop) + "px";
  }

  // Text that doesn't fit its box: made smaller ("shrink") or narrower ("squeeze").
  function fit(box) {
    fitSize(box);
    baseline(box);
  }
  function fitSize(box) {
    const layer = box._layer, span = box.firstChild;
    if (!layer || !span || layer.scroll > 0) return;
    span.style.transform = "";
    box.style.fontSize = layer.size + "px";
    if (!layer.fit || layer.fit === "none") return;
    const bw = box.clientWidth, bh = box.clientHeight;
    const sw = span.scrollWidth, sh = span.scrollHeight;
    if (!bw || !sw) return;
    if (layer.fit === "squeeze") {
      if (sw > bw) {
        span.style.transform = `scaleX(${bw / sw})`;
        span.style.transformOrigin = { left: "0 50%", center: "50% 50%", right: "100% 50%" }[layer.align || "left"];
      }
      return;
    }
    const k = Math.min(1, bw / sw, sh > bh * 1.05 ? bh / sh : 1);
    if (k < 1) box.style.fontSize = Math.max(layer.size * 0.25, layer.size * k * 0.99) + "px";
  }
  GFX.refit = () => document.querySelectorAll(".gfx-text").forEach(fit);
  const sized = window.ResizeObserver ? new ResizeObserver(entries => {
    for (const e of entries) if (e.contentRect.width && e.target.isConnected) fit(e.target);
  }) : null;
  // A font that finishes loading after the text was fitted: fitted again.
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", () => GFX.refit());
  GFX.retext = () => document.querySelectorAll(".gfx-text").forEach(b => { if (hasTokens(b._raw) || hasTokens(b._layer && b._layer.icon)) setText(b); });
  setInterval(() => { for (const b of live) { if (!b.isConnected) live.delete(b); else if (ticking(b._raw)) setText(b); } }, 250);   // (often enough that the timer changes on the second)

  // What else a layer's look takes from the data (a tinted loop's colour...).
  const extraOf = layer => layer.tint ? [layer.tint, layer.brightness, layer.speed].map(v => GFX.resolve(v ?? "")).join("|") : "";

  function buildLayer(layer, values, opts) {
    const value = GFX.content(layer, values);
    const outer = el("div", "gfx-L", {
      left: layer.x + "px", top: layer.y + "px", width: layer.w + "px", height: layer.h + "px",
      opacity: layer.opacity == null ? 1 : layer.opacity,
      transform: layer.rotation ? `rotate(${layer.rotation}deg)` : "",
      mixBlendMode: layer.blend && layer.blend !== "normal" ? layer.blend : "",
    });
    outer.dataset.id = layer.id;
    if (layer.show && !opts.showHidden && !showing(layer)) outer.style.display = "none";
    const inner = el("div", "gfx-A");
    const content = buildContent(layer, value, opts);
    const fxf = layer.fx && fxFilter(layer);
    if (fxf) content.style.filter = [content.style.filter, fxf].filter(Boolean).join(" ");
    if (layer.fx && +layer.fx.backdrop > 0 && layer.type === "rect") content.style.backdropFilter = content.style.webkitBackdropFilter = `blur(${+layer.fx.backdrop}px)`;
    inner.appendChild(content);
    outer.appendChild(inner);
    outer._value = value;
    outer._extra = extraOf(layer);
    outer._layer = layer;
    outer._sig = JSON.stringify(layer);
    outer._edit = !!opts.showHidden;
    if (layer.move || layer.recolor || layer.meter || hasTokens(layer.color)) restyle(outer);
    if (layer.when && !opts.showHidden) toggle(outer, true);
    return outer;
  }

  // A graphic's element. opts: {still: no playing media (thumbnails),
  // muted, showHidden: include hidden layers (Composer)}.
  GFX.buildComp = function (comp, values, opts) {
    opts = opts || {};
    const root = el("div", "gfx-comp");
    root.dataset.comp = comp.id;
    root.style.zIndex = 10 + (comp.layer || 0);
    for (const layer of comp.layers || []) {
      if (layer.visible === false && !opts.showHidden) continue;
      const L = buildLayer(layer, values, opts);
      if (layer.visible === false) L.style.visibility = "hidden";
      root.appendChild(L);
    }
    root._comp = comp;
    root._values = values;
    root._opts = opts;
    return root;
  };

  // New values (or an edited graphic) for a graphic already showing:
  // only the layers that change are rebuilt.
  GFX.updateComp = function (root, comp, values) {
    const opts = root._opts || {};
    const existing = new Map([...root.children].map(c => [c.dataset.id, c]));
    const wanted = (comp.layers || []).filter(l => l.visible !== false || opts.showHidden);
    let prev = null;
    for (const layer of wanted) {
      let L = existing.get(layer.id);
      const value = GFX.content(layer, values);
      if (!L || L._sig !== JSON.stringify(layer) || L._value !== value || L._extra !== extraOf(layer)) {
        const fresh = buildLayer(layer, values, opts);
        if (layer.visible === false) fresh.style.visibility = "hidden";
        // (a rule's layer rebuilt with new data: it carries on from where it was)
        if (L && layer.when && !opts.showHidden && L._on !== fresh._on) { fresh._on = L._on; fresh.style.visibility = L.style.visibility; fresh.style.opacity = L.style.opacity; toggle(fresh); }
        if (L) { destroy(L); L.replaceWith(fresh); } else root.insertBefore(fresh, prev ? prev.nextSibling : root.firstChild);
        L = fresh;
      } else if (L.previousSibling !== prev && prev !== L) {
        root.insertBefore(L, prev ? prev.nextSibling : root.firstChild);
      }
      existing.delete(layer.id);
      prev = L;
    }
    for (const L of existing.values()) { destroy(L); L.remove(); }
    root._comp = comp;
    root._values = values;
    root.style.zIndex = 10 + (comp.layer || 0);
  };

  function destroy(node) {
    node.querySelectorAll(".gfx-media").forEach(m => {
      if (m._lottie) m._lottie.destroy();
      if (m.tagName === "VIDEO") { m.pause(); m.removeAttribute("src"); m.load(); }
    });
  }
  GFX.destroy = destroy;

  // --- animation -----------------------------------------------------------
  const EASE = "cubic-bezier(.2,.8,.2,1)";
  const EASE_OUT = "cubic-bezier(.6,0,.8,.3)";
  // Keyframes for an animation coming in (reversed for going out).
  function frames(type, layer) {
    const d = Math.max(40, Math.min(240, (layer.w || 300) * 0.15));
    const dv = Math.max(30, Math.min(160, (layer.h || 100) * 0.5));
    switch (type) {
      case "fade": return [{ opacity: 0 }, { opacity: 1 }];
      case "slide-left": return [{ opacity: 0, transform: `translateX(${d}px)` }, { opacity: 1, transform: "none" }];
      case "slide-right": return [{ opacity: 0, transform: `translateX(${-d}px)` }, { opacity: 1, transform: "none" }];
      case "slide-up": return [{ opacity: 0, transform: `translateY(${dv}px)` }, { opacity: 1, transform: "none" }];
      case "slide-down": return [{ opacity: 0, transform: `translateY(${-dv}px)` }, { opacity: 1, transform: "none" }];
      case "wipe-right": return [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }];
      case "wipe-left": return [{ clipPath: "inset(0 0 0 100%)" }, { clipPath: "inset(0 0 0 0)" }];
      case "wipe-down": return [{ clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0 0)" }];
      case "wipe-up": return [{ clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0 0 0 0)" }];
      case "grow-x": return [{ transform: "scaleX(0)", transformOrigin: "0 50%" }, { transform: "scaleX(1)", transformOrigin: "0 50%" }];
      case "grow-y": return [{ transform: "scaleY(0)", transformOrigin: "50% 100%" }, { transform: "scaleY(1)", transformOrigin: "50% 100%" }];
      case "scale": return [{ opacity: 0, transform: "scale(.85)" }, { opacity: 1, transform: "none" }];
      case "pop": return [{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "scale(1.06)", offset: .7 }, { opacity: 1, transform: "none" }];
      case "blur": return [{ opacity: 0, filter: "blur(20px)" }, { opacity: 1, filter: "blur(0)" }];
      default: return null;
    }
  }
  GFX.animTypes = ["none", "fade", "slide-left", "slide-right", "slide-up", "slide-down", "wipe-right", "wipe-left",
    "wipe-down", "wipe-up", "grow-x", "grow-y", "scale", "pop", "blur"];

  // Plays a graphic's layers in (or out), `wait` ms from now. Resolves when done.
  GFX.play = function (root, dir, wait) {
    const runs = [];
    for (const L of root.children) {
      const layer = L._layer;
      const a = (layer && layer.anim && layer.anim[dir]) || { type: "fade", dur: 300, delay: 0 };
      const f = frames(a.type, layer || {});
      const inner = L.firstChild;
      if (!f || !inner) { if (dir === "out") inner && (inner.style.opacity = 0); continue; }
      const anim = inner.animate(dir === "in" ? f : f.slice().reverse(), {
        duration: Math.max(1, +a.dur || 300), delay: Math.max(0, +a.delay || 0) + Math.max(0, wait || 0),
        easing: a.ease || (dir === "in" ? EASE : EASE_OUT), fill: "both" });
      runs.push(anim.finished.catch(() => {}));
    }
    return Promise.all(runs);
  };
  GFX.finish = root => root.querySelectorAll(".gfx-A").forEach(a => a.getAnimations().forEach(x => { try { x.finish(); } catch (e) { x.cancel(); } }));

  // --- a bus: the graphics on Program or Preview, kept in step with the engine --
  //
  // opts: {bus: "program" | "preview", comp: one graphic only, monitor: muted,
  //        stingers: play stinger videos (default: yes, except one-graphic outputs)}
  const KIND_RANK = { board: 0, overlay: 1, "lower third": 2 };
  GFX.Bus = class Bus {
    constructor(stage, opts) {
      this.stage = stage;
      this.opts = Object.assign({ bus: "program" }, opts || {});
      this.scene = el("div", "gfx-scene");
      stage.appendChild(this.scene);
      this.shown = new Map();     // comp id -> element
      this.leaving = new Set();
      this.seen = null;            // {rev, take, seq}
      this.stingers = new Map();   // src -> <video>, ready to go
      this.cleanup = [];
    }

    // A graphic's own output that's switched on (Outputs) always shows it,
    // with what it shows on Program (or else on Preview); switched off, nothing.
    always(state) {
      // (a graphic's own link always shows it: adding the link to OBS is the choice)
      return !!(this.opts.hud || this.opts.comp);
    }
    // The graphic this output shows on its own: ?comp=, or the one added to ?hud='s game.
    own(state) {
      return this.opts.hud ? ((state.hud_overlays || {})[this.opts.hud] || null) : this.opts.comp;
    }

    wanted(state) {
      const bus = state.live[this.opts.bus] || { on: [], values: {} };
      let on = bus.on || [];
      const comps = new Map(state.project.compositions.map(c => [c.id, c]));
      if (this.opts.comp || this.opts.hud) {
        const id = this.own(state), pg = state.live.program || {}, pv = state.live.preview || {};
        const values = (pg.values || {})[id] || (pv.values || {})[id] || {};
        return { ids: this.always(state) && comps.has(id) ? [id] : [], comps, values: { [id]: values } };
      }
      return { ids: on.filter(id => comps.has(id)), comps, values: bus.values || {} };
    }

    apply(state) {
      // (nothing it shows changed: nothing to do)
      const sig = [state.project, state.live, state.global, state.data, state.fonts, JSON.stringify(state.hud_overlays || null)];
      if (this.sig && sig.every((v, i) => v === this.sig[i])) return;
      this.sig = sig;
      GFX.loadFonts(state.fonts);
      this.preload(state.project.transitions || []);
      this.warmUp(state);
      const want = this.wanted(state);
      const bus = state.live[this.opts.bus] || {};
      const take = (state.live.take || {}).seq || 0;
      const first = !this.seen;
      const tookNow = !first && this.opts.bus === "program" && take !== this.seen.take;
      const t = (state.live.take || {}).transition || { type: "cut" };
      this.seen = { rev: state.rev, take, seq: bus.seq };
      if (tookNow) {
        // (one graphic's own output doesn't follow takes: it's on while switched on)
        if (!this.opts.comp && !this.opts.hud) return this.transition(want, t, state);
      }
      return this.sync(want, first ? "cut" : this.opts.bus === "preview" ? "cut" : "update");
    }

    // Shows exactly `want`: new graphics in (with mode's effect), gone ones out,
    // the rest updated in place.
    sync(want, mode, t) {
      t = t || {};
      const ids = new Set(want.ids);
      // A wipe or fade swaps old for new in one move: the old waits for the new
      // one's pictures (or there's a see-through gap between them).
      const readies = [], going = [];
      for (const [id, root] of this.shown) {
        if (!ids.has(id)) {
          this.shown.delete(id);
          // (under a stinger: gone at once, it's covered)
          if (!t.animAt && (mode === "wipe" || mode === "fade")) { this.leaving.add(root); going.push(root); }
          else this.out(root, t.animAt ? "cut" : mode, t);
        } else {
          GFX.updateComp(root, want.comps.get(id), want.values[id] || {});
        }
      }
      for (const id of want.ids) {
        if (this.shown.has(id)) continue;
        const root = GFX.buildComp(want.comps.get(id), want.values[id] || {}, { muted: this.opts.monitor });
        this.scene.appendChild(root);
        this.shown.set(id, root);
        // Played in once its pictures are decoded, so it never comes in half drawn.
        root.style.visibility = "hidden";
        const ready = GFX.ready(root, 400);
        readies.push(ready);
        ready.then(() => {
          if (this.shown.get(id) !== root) return;
          root.style.visibility = "";
          this.in(root, mode, t);
        });
      }
      if (going.length) Promise.allSettled(readies).then(() => going.forEach(root => { if (root.isConnected) this.out(root, mode, t); }));
      // Stacking: the graphic's "layer" setting, then its kind (full-page
      // boards at the back, overlays over them, lower thirds in front), then
      // its place in the list.
      want.ids.forEach((id, i) => {
        const root = this.shown.get(id), comp = want.comps.get(id);
        if (root) root.style.zIndex = 10 + (comp.layer || 0) * 1000 + (KIND_RANK[comp.kind] ?? 1) * 300 + i;
      });
    }

    in(root, mode, t) {
      if (mode === "animate") GFX.play(root, "in", t.animAt ? t.animAt - performance.now() : 0);
      else if (mode === "fade") root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: t.dur || 500, easing: "linear" });
      else if (mode === "wipe") root.animate(wipe(t.direction, true), { duration: t.dur || 600, easing: EASE });
      requestAnimationFrame(() => root.querySelectorAll(".gfx-text").forEach(fit));
    }

    out(root, mode, t) {
      let done;
      this.leaving.add(root);
      if (mode === "animate") done = GFX.play(root, "out");
      else if (mode === "fade") done = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: t.dur || 500, easing: "linear", fill: "forwards" }).finished;
      else if (mode === "wipe") done = root.animate(wipe(t.direction, false), { duration: t.dur || 600, easing: EASE, fill: "forwards" }).finished;
      else done = Promise.resolve();
      done.catch(() => {}).then(() => { this.leaving.delete(root); destroy(root); root.remove(); });
    }

    // Ends whatever transition is still playing, at once.
    hurry() {
      for (const fn of this.cleanup.splice(0)) fn();
      for (const root of this.leaving) { destroy(root); root.remove(); }
      this.leaving.clear();
      for (const root of this.shown.values()) { root.getAnimations().forEach(a => a.finish()); GFX.finish(root); }
    }

    transition(want, t, state) {
      this.hurry();
      switch (t.type) {
        case "cut": return this.sync(want, "cut");
        case "fade": return this.sync(want, "fade", t);
        case "wipe": return this.sync(want, "wipe", t);
        case "animate": return this.sync(want, "animate", t);
        case "dip": {
          const cover = el("div", "gfx-cover", { background: t.color || "#000", opacity: 0 });
          this.stage.appendChild(cover);
          const half = (t.dur || 800) / 2;
          const a = cover.animate([{ opacity: 0 }, { opacity: 1 }], { duration: half, fill: "forwards" });
          const end = () => { cover.remove(); };
          this.cleanup.push(() => { this.sync(want, "cut"); end(); });
          a.finished.then(() => {
            this.cleanup = this.cleanup.filter(f => f !== end);
            this.sync(want, "cut");
            cover.animate([{ opacity: 1 }, { opacity: 0 }], { duration: half, fill: "forwards" }).finished.then(end, end);
          }, () => {});
          return;
        }
        case "stinger": return this.stinger(want, t, +state.project.stinger_anim_delay || 0);
        case "delay": {
          const timer = setTimeout(() => this.sync(want, "cut"), t.ms || 0);
          this.cleanup.push(() => { clearTimeout(timer); this.sync(want, "cut"); });
          return;
        }
        default: return this.sync(want, "cut");
      }
    }

    // animDelay: the new graphics come in under the stinger and play their
    // intro animations this long (ms) after the TAKE, once it has cleared
    // (0: they just cut in).
    stinger(want, t, animDelay) {
      if (!t.src) return this.sync(want, "cut");
      const animAt = performance.now() + animDelay;
      const v = this.stingerVideo(t.src);
      v.muted = !!this.opts.monitor || t.audio === false;
      v.volume = t.volume == null ? 1 : +t.volume;
      v.currentTime = 0;
      v.style.visibility = "visible";
      let swapped = false;
      const swap = () => { if (!swapped) { swapped = true; animDelay > 0 ? this.sync(want, "animate", { animAt }) : this.sync(want, "cut"); } };
      const cutAt = Math.max(0, +t.cut || 0) / 1000;
      const hide = () => { v.pause(); v.style.visibility = "hidden"; v.removeEventListener("timeupdate", tick); };
      const tick = () => { if (v.currentTime >= cutAt) swap(); };
      // timeupdate fires only ~4 times a second: a timer catches the cut on time.
      const timer = setTimeout(swap, cutAt * 1000 + 30);
      v.addEventListener("timeupdate", tick);
      v.onended = () => { swap(); hide(); };
      this.cleanup.push(() => { clearTimeout(timer); swap(); hide(); });
      const started = v.play();
      if (started) started.catch(() => { v.muted = true; v.play().catch(() => { clearTimeout(timer); swap(); hide(); }); });
    }

    stingerVideo(src) {
      let v = this.stingers.get(src);
      if (!v) {
        v = el("video", "gfx-stinger");
        v.src = url(encodeURI(src));
        v.preload = "auto";
        v.playsInline = true;
        v.muted = true;
        this.stage.appendChild(v);
        this.stingers.set(src, v);
      }
      return v;
    }

    // The pictures of every graphic that could go on air, ready before the take
    // (on Program; a graphic's own output: its pictures).
    warmUp(state) {
      if (this.opts.bus !== "program" || this.warmed === state.project && this.warmedData === state.data && this.warmedLive === state.live) return;
      this.warmed = state.project; this.warmedData = state.data; this.warmedLive = state.live;
      const live = state.live || {}, pg = live.program || {}, pv = live.preview || {};
      const own = this.opts.comp || this.opts.hud ? this.own(state) : null;
      const comps = state.project.compositions.filter(c => !own && !this.opts.hud || c.id === own);
      const go = () => { this.warmTimer = null; this.warmAt = performance.now(); GFX.warm(comps, id => Object.assign({}, (pv.values || {})[id], (pg.values || {})[id])); };
      // (the game's data changes many times a second: looked at again every few seconds at most)
      if (this.warmTimer) clearTimeout(this.warmTimer);
      const wait = this.warmAt == null ? 0 : Math.max(250, 3000 - (performance.now() - this.warmAt));
      this.warmTimer = setTimeout(() => (window.requestIdleCallback || setTimeout)(go, { timeout: 1000 }), wait);
    }

    // Stinger videos load before they're needed, so they start on the button.
    preload(transitions) {
      if (this.opts.bus !== "program" || ((this.opts.comp || this.opts.hud) && !this.opts.stingers)) return;
      for (const t of transitions) if (t.type === "stinger" && t.src && t.enabled !== false) this.stingerVideo(t.src);
    }
  };

  function wipe(direction, entering) {
    const from = { left: "inset(0 0 0 100%)", right: "inset(0 100% 0 0)", up: "inset(100% 0 0 0)", down: "inset(0 0 100% 0)" }[direction || "left"];
    const to = { left: "inset(0 100% 0 0)", right: "inset(0 0 0 100%)", up: "inset(0 0 100% 0)", down: "inset(100% 0 0 0)" }[direction || "left"];
    return entering ? [{ clipPath: from }, { clipPath: "inset(0 0 0 0)" }] : [{ clipPath: "inset(0 0 0 0)" }, { clipPath: to }];
  }

  // --- styles ---------------------------------------------------------------
  const css = document.createElement("style");
  css.textContent = `
    .gfx-stage{position:relative;width:${W}px;height:${H}px;overflow:hidden}
    .gfx-scene,.gfx-comp{position:absolute;inset:0;pointer-events:none}
    .gfx-L{position:absolute;box-sizing:border-box}
    .gfx-A{position:absolute;inset:0}
    .gfx-media{position:absolute;inset:0;width:100%;height:100%;display:block}
    .gfx-rect{position:absolute;inset:0;box-sizing:border-box}
    .gfx-text{position:absolute;inset:0;display:flex;white-space:pre;overflow:visible}
    .gfx-t{display:inline-block;max-width:none}
    .gfx-scroll{overflow:hidden}
    .gfx-scroll .gfx-t{display:flex;white-space:pre}
    .gfx-tick{display:inline-flex;align-items:center}
    .gfx-media.gfx-strip{display:flex;align-items:center;justify-content:center}
    .gfx-strip img{min-width:0;flex:0 1 auto}
    .gfx-icon{display:inline-block;height:.72em;width:auto;margin-right:.32em;vertical-align:baseline;border-radius:.06em}
    .gfx-div{display:inline-block;height:1.05em;flex:0 0 auto}
    .gfx-tick{padding-right:1.5em}
    .gfx-bl{display:inline-block;width:0;height:0;vertical-align:baseline}
    .gfx-rot{overflow:visible}
    .gfx-rot-img{position:absolute;inset:0;width:100%;height:100%;display:block}
    .gfx-rot-bar{position:absolute;left:0;right:0;bottom:-8px;height:3px;background:currentColor;color:#f5c518;transform-origin:0 50%;opacity:.85}
    .gfx-bracket{overflow:visible}
    .gfx-bk-slot{position:absolute;box-sizing:border-box;overflow:hidden;transition:opacity .4s}
    .gfx-bk-logo{position:absolute;object-fit:contain}
    .gfx-bk-name{position:absolute;top:0;bottom:0;display:flex;align-items:center;white-space:nowrap;text-transform:uppercase;letter-spacing:-.01em;overflow:hidden}
    .gfx-bk-score{position:absolute;right:0;top:0;bottom:0;background:#000;display:flex;align-items:center;justify-content:center}
    .gfx-bk-label{position:absolute;display:flex;align-items:center;white-space:nowrap;text-transform:uppercase;letter-spacing:.04em}
    .gfx-bk-champ{position:absolute;box-sizing:border-box;border-style:solid}
    .gfx-cover{position:absolute;inset:0;z-index:9000}
    .gfx-stinger{position:absolute;inset:0;width:100%;height:100%;z-index:9500;visibility:hidden;object-fit:cover;pointer-events:none}
  `;
  document.head.appendChild(css);
})();
