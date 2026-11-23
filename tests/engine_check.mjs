// node tests/engine_check.mjs : quick checks of engine pieces that run without a browser
import assert from "node:assert/strict";
globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };   // (text.js makes a measuring canvas when loaded)
const { usedTables } = await import("../web/engine/stage.js");
const { play } = await import("../web/engine/anim.js");

const tables = { Global: [["Ticker", "{{News!A1}}"]], News: [["hi"]], "League HUD": [["KILLS", "3"]], Tournament: [["R1"]] };
assert.deepEqual(Object.keys(usedTables({ layers: [{ type: "text", text: "{{Global!Ticker}}" }] }, {}, tables)).sort(), ["Global", "News"]);
assert.deepEqual(Object.keys(usedTables({ layers: [{ type: "bracket" }] }, {}, tables)), ["Tournament"]);
assert.deepEqual(usedTables({ layers: [{ type: "text", text: "hello" }] }, {}, tables), {});

let kf; const el = { animate: k => { kf = k; return { finished: Promise.resolve(), cancel() {} }; } };
await play(el, { opacity: 0.6, anim: { in: { type: "fade" } } }, "in");
assert.deepEqual(kf, [{ opacity: 0 }, { opacity: 0.6 }]);

// layers: {{TIME}} counting to a time after midnight, ticking text redrawn whole, Game HUD web layer, lottie dropped early
{
  const { resolve, setNow } = await import("../web/engine/data.js");
  const at = new Date(); at.setHours(23, 50, 0, 0); setNow(at / 1000);
  const g = { Global: [["Field", "Value"], ["Clock mode", "soon"], ["Clock until", "00:15"]] };
  assert.match(resolve("{{TIME}}", g), /^2[45]:\d\d$/);   // (25 minutes to go, not 00:00)
  setNow(Date.now() / 1000);

  // (a tiny stand-in DOM: a span is 10 px a letter wide)
  class El {
    constructor(t = "") { this.style = {}; this.kids = []; this.text = t; this.parent = null; this.w = 0; this.h = 0; this.anims = 0; }
    get children() { return this.kids; }
    get textContent() { return this.kids.length ? this.kids.map(k => k.textContent).join("") : this.text; }
    set textContent(v) { this.kids = []; this.text = String(v); }
    get isConnected() { return true; }
    get offsetWidth() { return this.w; }
    get clientWidth() { return this.w; }
    get clientHeight() { return this.h; }
    get scrollWidth() { return 0; }
    get scrollHeight() { return 0; }
    getBoundingClientRect() { return { width: this.w || this.textContent.length * 10 }; }
    appendChild(c) { c.remove(); c.parent = this; this.kids.push(c); return c; }
    append(...cs) { cs.forEach(c => this.appendChild(c)); }
    replaceChildren(...cs) { this.kids = []; this.text = ""; this.append(...cs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter(k => k !== this); this.parent = null; }
    cloneNode() { const c = new El(this.text); c.style = { ...this.style }; c.append(...this.kids.map(k => k.cloneNode())); return c; }
    setAttribute() {}
    getAnimations() { return []; }
    animate() { this.anims++; return { cancel() {} }; }
  }
  const doc = globalThis.document;
  globalThis.document = { createElement: () => new El(), createTextNode: t => new El(t) };
  globalThis.window = globalThis.window || {};
  globalThis.requestAnimationFrame = fn => fn();
  const { text } = await import("../web/engine/layers/text.js");
  const { web, image } = await import("../web/engine/layers/basic.js");
  const { lottie } = await import("../web/engine/layers/lottie.js");
  const t = { Global: [["Field", "Value"], ["Timer secs", "5"]] }, ticking = [];
  const ctx = { values: {}, resolve: v => resolve(v, t), url: s => s, later: () => {}, tick: fn => ticking.push(fn) };
  const settle = () => new Promise(r => setTimeout(r));

  const box = new El(); box.w = 400; box.h = 50;
  text(box, { text: "BACK IN {{TIMER}}" }, ctx);
  const span = box.kids[0];
  span.style.fontSize = "1px";
  t.Global[1][1] = "75";
  ticking.forEach(fn => fn());
  assert.equal(span.textContent, "BACK IN 01:15");
  assert.equal(span.style.fontSize, "32px");   // (fitted again)

  ticking.length = 0;
  t.Global[1][1] = "5";
  const strip = new El(); strip.w = 1920;
  text(strip, { id: "tk", text: "NEXT {{TIMER}} | FOLLOW", scroll: 120, divider: "#f00" }, ctx);
  await settle();
  const track = strip.kids[0];
  const copies = () => track.kids.map(c => [c.textContent, c.kids.length]);
  assert.ok(track.kids.length > 1 && track.anims === 1);
  t.Global[1][1] = "65";   // (same width: every copy changes, dividers kept, the loop carries on)
  ticking.forEach(fn => fn());
  await settle();
  assert.ok(copies().every(([s, n]) => s === "NEXT 01:05FOLLOW" && n === 4));
  assert.equal(track.anims, 1);
  t.Global[1][1] = "3605";   // (wider: measured again)
  ticking.forEach(fn => fn());
  await settle();
  assert.ok(copies().every(([s, n]) => s === "NEXT 1:00:05FOLLOW" && n === 4));
  assert.equal(track.anims, 2);

  // (width changes on air, no id: the loop carries on from where the strip is, it doesn't slide in again)
  {
    const s2 = new El(); s2.w = 1920; t.Global[1][1] = "5";
    text(s2, { text: "NEXT {{TIMER}}", scroll: 100 }, ctx);
    await settle();
    const tr = s2.kids[0], made = [];
    tr.getAnimations = () => made.filter(x => !x.gone);
    tr.animate = (k, o) => { const x = { k, o, currentTime: 0, effect: { getTiming: () => o }, cancel() { this.gone = true; } }; made.push(x); return x; };
    made.push({ currentTime: 12345, effect: { getTiming: () => ({ iterations: Infinity }) }, cancel() { this.gone = true; } });
    const w1 = tr.kids[0].getBoundingClientRect().width;
    t.Global[1][1] = "3605";
    ticking.forEach(fn => fn());
    await settle();
    const now = made.at(-1), w2 = tr.kids[0].getBoundingClientRect().width;
    assert.ok(made[0].gone && now.o.iterations === Infinity && now.k.length === 2);
    assert.equal(Math.round(now.currentTime), Math.round((12.345 * 100 % w1 % w2) / 100 * 1000));
  }

  const page = new El();
  web(page, { type: "web", url: "http://127.0.0.1:7897/hud" }, ctx);
  assert.equal(page.kids[0].src, "http://127.0.0.1:7897/hud");

  // (an image whose {{token}} is still empty draws nothing; a plain or fully resolved src is drawn)
  t.Val = [["Field", "Value"], ["Agent", ""]];
  const pic = src => { const e = new El(); image(e, { type: "image", src }, { ...ctx, table: () => [] }); return e.kids.length; };
  assert.equal(pic("/Agentes/{{Val!Agent}}/X.png"), 0);
  t.Val[1][1] = "Jett";
  assert.equal(pic("/Agentes/{{Val!Agent}}/X.png"), 1);
  assert.equal(pic("/Agentes/plain.png"), 1);

  let made = 0;
  window.lottie = { loadAnimation: () => { made++; return { setSpeed() {}, destroy() {} }; } };
  lottie({ isConnected: false }, { src: "a.json" }, ctx);
  await settle();
  assert.equal(made, 0);   // (dropped before lottie-web was ready: never drawn)
  globalThis.document = doc;
}

// stage: dropped video copy stopped, TAKE finishes only transition animations, redraw mid-In carries on,
// merge keeps the old layer only when drawn the same (and moves its ticks), dip swaps once
{
  const { Stage } = await import("../web/engine/stage.js");
  const si = globalThis.setInterval; globalThis.setInterval = () => 0;
  const stage = new Stage({ classList: { add() {} }, children: [], appendChild() {} });
  globalThis.setInterval = si;
  const node = (props = {}) => ({ style: {}, children: [], getAnimations: () => [], querySelectorAll: () => [], remove() { this.gone = true; }, ...props });

  const vid = { pause() { this.paused = true; }, removeAttribute(a) { this.dropped = a; }, load() {} };
  const kept = node({ _keep: "v" }), n = node({ _keep: "v", querySelectorAll: () => [vid] });
  const oldEl = node({ children: [kept] }), newEl = node({ children: [n], _ticks: [], _later: [] });
  stage.patch(oldEl, newEl);
  assert.ok(vid.paused && vid.dropped === "src");

  const anim = () => ({ effect: { target: null }, finish() { this.done = true; } });
  const g = node(), lay = node({ parentNode: g }), inner = node({ parentNode: lay });
  const [a1, a2, a3] = [anim(), anim(), anim()];
  a1.effect.target = g; a2.effect.target = lay; a3.effect.target = inner;   // (a3: a sponsor bar inside a layer)
  g.getAnimations = () => [a1, a2, a3];
  g._in = { at: 5 };
  stage.on.set("g", { el: g });
  stage.settle();
  assert.ok(a1.done && a2.done && !a3.done && g._in.at === 0);
  stage.on.clear();

  const made = { currentTime: 0 }, child = node({ getAnimations: () => [made] });
  const from = node(), to = node({ children: [child] });
  const run = from._in = { el: from, at: performance.now() - 300, in: () => {} };
  stage.carryIn(from, to);
  assert.ok(run.el === to && to._in === run && made.currentTime >= 300);
  const hid = node({ style: { visibility: "hidden" } }), next = node();
  hid._in = { el: hid, at: 0, in: () => { throw new Error("no In while hidden"); } };
  stage.carryIn(hid, next);
  assert.equal(next.style.visibility, "hidden");

  globalThis.getComputedStyle = () => ({ opacity: "1" });
  const L = { name: "clock", type: "text", x: 10, y: 0, w: 100, h: 20 };
  const merged = (html, oldHtml = "<b>12:00</b>", drawn = [undefined, undefined]) => {
    const tOld = () => {}, tNew = () => {}, other = () => {};
    const o = node({ _layer: { ...L, id: "a" }, outerHTML: oldHtml, _drawn: drawn[0], _ticks: [tOld], textContent: "12:00" });
    const l = node({ _layer: { ...L, id: "b" }, outerHTML: html, _drawn: drawn[1], _ticks: [tNew], textContent: "12:00", animate() { this.glided = true; } });
    const el = node({ parentNode: stage.root, children: [l], _later: [], _ticks: [tNew, other] });
    l.replaceWith = x => { el.children[0] = x; };
    stage.merge([el], [node({ children: [o] })], { dur: 300 });
    return { el, o, l, tOld, other };
  };
  let m = merged("<b>12:00</b>");
  assert.ok(m.el.children[0] === m.o && m.el._ticks.length === 2 && m.el._ticks.includes(m.tOld) && m.el._ticks.includes(m.other));
  m = merged("<b>Other player</b>");   // (a field value changed the drawing: it glides, the old one isn't kept)
  assert.ok(m.el.children[0] === m.l && m.l.glided && m.o.style.visibility === "hidden");
  m = merged("<div></div>", "<div><svg></svg></div>", ["<div></div>", "<div></div>"]);   // (a lottie on air already drawn, the new copy not yet: kept)
  assert.ok(m.el.children[0] === m.o);
  m = merged("<div></div>", "<div><svg></svg></div>", ["<div>a</div>", "<div>b</div>"]);   // (drawn differently at build: glides)
  assert.ok(m.el.children[0] === m.l && m.l.glided);

  let swaps = 0, endCover;
  const cover = node({ animate: () => ({ finished: new Promise(r => { endCover = endCover || r; }) }) });
  const doc = globalThis.document;
  globalThis.document = { createElement: () => cover };
  stage.root.appendChild = () => {};
  stage.swapIn = () => { swaps++; stage.hold = null; };
  stage.gen = 7; stage.hold = 7;
  stage.dip({}, { dur: 100 });
  await new Promise(r => setTimeout(r, 500));   // (the fallback swaps first: the cover's animation never ran)
  endCover();
  await new Promise(r => setTimeout(r));
  assert.equal(swaps, 1);
  for (const id of stage.timers) clearTimeout(id);
  globalThis.document = doc;
}
console.log("engine checks OK");

// Fly from right: every layer travels the whole page width (so a graphic flies as one piece); Out goes back the same way
await play(el, { x: 1500, w: 300, anim: { in: { type: "fly-right" } } }, "in");
assert.deepEqual(kf[0], { translate: "1920px 0" });
await play(el, { x: 1500, w: 300, anim: { out: { type: "fly-right" } } }, "out");
assert.equal(kf.at(-1).translate, "1920px 0");
console.log("animation checks OK");

// Easing pick: "sharp" is constant speed; blank keeps the default
let opts; const el2 = { animate: (k, o) => { opts = o; return { finished: Promise.resolve(), cancel() {} }; } };
await play(el2, { anim: { in: { type: "fly-right", ease: "sharp" } } }, "in");
assert.equal(opts.easing, "linear");
await play(el2, { anim: { in: { type: "fly-right" } } }, "in");
assert.notEqual(opts.easing, "linear");
console.log("easing checks OK");
