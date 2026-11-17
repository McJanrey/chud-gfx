// node tests/engine_check.mjs : quick checks of engine pieces that run without a browser
import assert from "node:assert/strict";
globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };   // (text.js makes a measuring canvas when loaded)
const { usedTables } = await import("../web/engine/stage.js");
const { play } = await import("../web/engine/anim.js");

const tables = { Global: [["Ticker", "{{News!A1}}"]], News: [["hi"]], "League HUD": [["KILLS", "3"]], Tournament: [["R1"]] };
assert.deepEqual(Object.keys(usedTables({ layers: [{ type: "text", text: "{{Global!Ticker}}" }] }, {}, tables)).sort(), ["Global", "News"]);
assert.deepEqual(Object.keys(usedTables({ layers: [{ type: "bracket" }] }, {}, tables)), ["Tournament"]);
assert.deepEqual(usedTables({ layers: [{ type: "text", text: "hello" }] }, {}, tables), {});

let kf; const el = { animate: k => { kf = k; return { finished: Promise.resolve() }; } };
await play(el, { opacity: 0.6, anim: { in: { type: "fade" } } }, "in");
assert.deepEqual(kf, [{ opacity: 0 }, { opacity: 0.6 }]);
console.log("engine checks OK");
