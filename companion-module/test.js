// node test.js
const assert = require("assert")
const { merge, choices, names, segment, clock } = require("./state")

const s = merge(
	{ project: { compositions: [{ id: "c1", name: "Scorebug" }, { id: "c2", name: "Break" }], transitions: [{ id: "cut", name: "Cut" }, { id: "w", name: "Wipe", enabled: false }], playlists: [{ id: "p1", name: "Loop" }] } },
	{ live: { program: { on: ["c1"] }, preview: { on: ["c2", "gone"] } }, obs: { status: { scenes: ["Game"], scene: "Game" } }, now: 1000 }
)
assert.deepStrictEqual(choices(s).transitions, [{ id: "cut", label: "Cut" }])
assert.deepStrictEqual(choices(s).scenes, [{ id: "Game", label: "Game" }])
assert.strictEqual(names(s, "program"), "Scorebug")
assert.strictEqual(names(s, "preview"), "Break, gone")
assert.strictEqual(clock(65), "01:05")
assert.strictEqual(clock(-3725), "+1:02:05")
const ros = { ros: { show: { current: 0 }, timeline: [{ seg: { title: "Countdown", mins: 15 }, start: 1000 }, { seg: { title: "Skip" }, skip: true }, { seg: { title: "Desk", mins: 10 }, start: 1900 }] }, now: 1000 }
assert.deepStrictEqual(segment(ros, 1060), { now: "Countdown", next: "Desk", left: "14:00" })
assert.deepStrictEqual(segment({}, 0), { now: "", next: "", left: "" })
console.log("ok")
