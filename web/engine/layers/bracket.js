// The knockout bracket (Spec: the Tournament table's "Top" rounds), drawn to fill the layer's box:
// a column per round, two rows per match (name, score), gold for the winner, faded for the loser,
// lines to the next round, the champion in an outlined box on the right.
const NS = "http://www.w3.org/2000/svg";

export function bracket(el, layer, ctx) {
  const T = k => ctx.resolve(`{{Tournament!${k}}}`);
  const size = +T("Top teams") === 16 ? 16 : 8, rounds = Math.log2(size), short = T("Top short names") === "on";
  const W = layer.w, H = layer.h;
  const champW = W * 0.2778, step = (W - champW) / rounds;
  const nameW = step * 0.637, scoreW = step * 0.106, gap = step * 0.032, left = step * 0.04;
  const gold = ctx.resolve(layer.gold || "#b28a1d"), dark = ctx.resolve(layer.dark || "#000b05"), line = ctx.resolve(layer.line || gold);
  const font = `"${String(layer.font || "Bebas Neue").replace(/"/g, "")}", "Bebas Neue", Inter, sans-serif`;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", W); svg.setAttribute("height", H);
  svg.style.cssText = "position:absolute;inset:0;overflow:visible";
  el.appendChild(svg);
  const cell = (x, y, w, h, text, bg, fg, alpha = 1, align = "left") => {
    const d = document.createElement("div");
    Object.assign(d.style, { position: "absolute", left: x + "px", top: y + "px", width: w + "px", height: h + "px", background: bg, color: fg, opacity: alpha,
      display: "flex", alignItems: "center", justifyContent: align === "center" ? "center" : "flex-start", padding: align === "center" ? "0" : `0 ${h * 0.15}px`,
      boxSizing: "border-box", fontFamily: font, fontSize: h * 0.6 + "px", textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden" });
    d.textContent = text;
    el.appendChild(d);
  };
  const slot0 = H / (size / 2);
  const rowH = slot0 * 0.32, rowGap = slot0 * 0.048, block = rowH * 2 + rowGap;
  const ends = [];   // [round][match] -> y of the match's middle, for the lines
  for (let r = 1; r <= rounds; r++) {
    const slot = slot0 * 2 ** (r - 1), x = left + (r - 1) * step;
    ends.push([]);
    for (let m = 1; m <= size / 2 ** r; m++) {
      const key = `R${r} M${m}`, y = (m - 1) * slot + (slot - block) / 2;
      const winner = T(`Top ${key} winner`);
      for (const n of [1, 2]) {
        const name = T(`Top ${key} team ${n}${short ? " short" : ""}`) || T(`Top ${key} team ${n}`), score = T(`Top ${key} team ${n} score`);
        const decided = !!winner, won = decided && T(`Top ${key} team ${n}`) === winner;
        const ry = y + (n - 1) * (rowH + rowGap);
        cell(x, ry, nameW, rowH, name, decided ? gold : dark, "#fff", decided && !won ? 0.45 : 1);
        cell(x + nameW + gap, ry, scoreW, rowH, score, "#000", "#fff", 1, "center");
      }
      ends[r - 1].push(y + block / 2);
    }
  }
  // lines: each pair of matches joins the next round's match
  const path = d => { const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); p.setAttribute("fill", "none"); p.setAttribute("stroke", line); p.setAttribute("stroke-width", Math.max(2, rowH * 0.05)); svg.appendChild(p); };
  for (let r = 1; r < rounds; r++) {
    const x0 = left + (r - 1) * step + nameW + gap + scoreW + 4, x1 = left + r * step - 19, xm = (x0 + x1) / 2;
    ends[r].forEach((yNext, i) => { const a = ends[r - 1][2 * i], b = ends[r - 1][2 * i + 1]; path(`M${x0} ${a}H${xm}V${b}H${x0}M${xm} ${yNext}H${x1}`); });
  }
  // the champion
  const cw = champW, ch = H * 0.1925, cx = W - cw, cy = (H - ch) / 2;
  path(`M${left + (rounds - 1) * step + nameW + gap + scoreW + 4} ${H / 2}H${cx}`);
  const box = document.createElement("div");
  Object.assign(box.style, { position: "absolute", left: cx + "px", top: cy + "px", width: cw + "px", height: ch + "px", border: `${Math.max(2, ch * 0.03)}px solid ${line}`,
    background: dark, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", color: ctx.resolve(layer.color || "#fff"),
    fontFamily: font, fontSize: ch * 0.335 + "px", textTransform: "uppercase" });
  box.textContent = T(`Top champion${short ? " short" : ""}`) || T("Top champion");
  el.appendChild(box);
}
