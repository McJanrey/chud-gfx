// node smoke.js [port]: runs the module against a running engine with a stand-in for Companion,
// checks it follows the state and that a button press reaches the engine.
const Module = require("module")
const real = require("@companion-module/base")
let Instance
const fake = {
	...real,
	runEntrypoint: (cls) => (Instance = cls),
	InstanceBase: class {
		updateStatus(s, m) { this.status = [s, m] }
		log() {}
		setActionDefinitions(d) { this.actions = d }
		setFeedbackDefinitions(d) { this.feedbacks = d }
		setVariableDefinitions() {}
		setPresetDefinitions(p) { this.presets = p }
		setVariableValues(v) { this.vars = { ...(this.vars || {}), ...v } }
		checkFeedbacks() {}
	},
}
const load = Module._load
Module._load = function (req, ...rest) { return req === "@companion-module/base" ? fake : load.call(this, req, ...rest) }
require("./main")

;(async () => {
	const m = new Instance()
	await m.init({ host: "127.0.0.1", port: +(process.argv[2] || 7820) })
	await new Promise((r) => setTimeout(r, 2500))
	const comp = m.state.project.compositions[0]
	console.log("status", m.status[0], "| actions", Object.keys(m.actions).length, "| presets", Object.keys(m.presets).length)
	console.log("vars", JSON.stringify(m.vars))
	await m.actions.cue.callback({ options: { comp: comp.id, mode: "in" } })
	await new Promise((r) => setTimeout(r, 800))
	console.log("cued", comp.name, "-> on preview:", m.on("preview", comp.id), "| preview var:", m.vars.preview)
	await m.actions.cue.callback({ options: { comp: comp.id, mode: "out" } })
	await new Promise((r) => setTimeout(r, 500))
	console.log("after out:", m.on("preview", comp.id))
	await m.destroy()
	process.exit(0)
})()
