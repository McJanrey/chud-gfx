// Bitfocus Companion module for StandBy GFX: buttons for TAKE / CUT / graphics / run of show / OBS,
// lit by what's on Program and Preview. Talks to the engine's HTTP API and follows its live stream.
const { InstanceBase, InstanceStatus, runEntrypoint, combineRgb, Regex } = require("@companion-module/base")
const http = require("http")
const { merge, choices, names, segment } = require("./state")

class StandByGFX extends InstanceBase {
	async init(config) {
		this.config = config
		this.state = null
		this.sig = ""
		this.connect()
	}

	async destroy() {
		this.closed = true
		if (this.req) this.req.destroy()
		clearTimeout(this.retry)
		clearInterval(this.tick)
	}

	async configUpdated(config) {
		this.config = config
		if (this.req) this.req.destroy()
		clearTimeout(this.retry)
		this.connect()
	}

	getConfigFields() {
		return [
			{ type: "textinput", id: "host", label: "Engine address", width: 8, default: "127.0.0.1", regex: Regex.HOSTNAME },
			{ type: "number", id: "port", label: "Port", width: 4, default: 7820, min: 1, max: 65535 },
		]
	}

	base() {
		return `http://${this.config.host || "127.0.0.1"}:${this.config.port || 7820}`
	}

	// --- talking to the engine ---------------------------------------------------------
	post(path, body = {}) {
		const data = JSON.stringify(body)
		return new Promise((resolve) => {
			const req = http.request(this.base() + path, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }, timeout: 5000 }, (res) => {
				let out = ""
				res.on("data", (c) => (out += c))
				res.on("end", () => {
					if (res.statusCode !== 200) this.log("warn", `${path}: ${out}`)
					resolve()
				})
			})
			req.on("error", (e) => {
				this.log("warn", `${path}: ${e.message}`)
				resolve()
			})
			req.end(data)
		})
	}

	connect() {
		if (this.closed) return
		this.updateStatus(InstanceStatus.Connecting)
		const again = () => {
			if (!this.closed) this.retry = setTimeout(() => this.connect(), 3000)
		}
		// the whole state once, then the changes as they happen
		http.get(this.base() + "/api/state", { timeout: 5000 }, (res) => {
			let body = ""
			res.on("data", (c) => (body += c))
			res.on("end", () => {
				if (res.statusCode !== 200) {
					this.updateStatus(InstanceStatus.ConnectionFailure, res.statusCode === 403 ? "Turn on Outputs › Network in StandBy GFX" : `HTTP ${res.statusCode}`)
					return again()
				}
				try {
					this.apply(JSON.parse(body))
				} catch (e) {
					return again()
				}
				this.follow(again)
			})
		}).on("error", (e) => {
			this.updateStatus(InstanceStatus.ConnectionFailure, e.message)
			again()
		})
	}

	follow(again) {
		this.req = http.get(this.base() + "/api/stream?client=companion", (res) => {
			this.updateStatus(InstanceStatus.Ok)
			let buf = ""
			res.setEncoding("utf8")
			res.on("data", (chunk) => {
				buf += chunk
				let i
				while ((i = buf.indexOf("\n\n")) >= 0) {
					const msg = buf.slice(0, i)
					buf = buf.slice(i + 2)
					const line = msg.split("\n").find((l) => l.startsWith("data:"))
					if (line) {
						try {
							this.apply(JSON.parse(line.slice(5)))
						} catch (e) {
							/* a ping */
						}
					}
				}
			})
			res.on("end", () => {
				this.updateStatus(InstanceStatus.Disconnected)
				again()
			})
		})
		this.req.setTimeout(10000, () => this.req.destroy(new Error("no ping"))) // (the engine pings every 2 s: silence = a dead PC, not a quiet show)
		this.req.on("error", () => {
			this.updateStatus(InstanceStatus.Disconnected)
			again()
		})
		clearInterval(this.tick)
		this.tick = setInterval(() => this.variables(), 1000) // (the segment countdown)
	}

	apply(msg) {
		if (msg && msg.now) this.skew = msg.now - Date.now() / 1000 // (count down on the engine's clock)
		this.state = merge(this.state, msg)
		const sig = JSON.stringify(choices(this.state))
		if (sig !== this.sig) {
			this.sig = sig
			this.definitions()
		}
		this.checkFeedbacks()
		this.variables()
	}

	// --- what the buttons can do --------------------------------------------------------
	definitions() {
		const c = choices(this.state)
		const comp = { type: "dropdown", id: "comp", label: "Graphic", choices: c.comps, default: c.comps[0] ? c.comps[0].id : "" }
		this.setActionDefinitions({
			take: { name: "TAKE", options: [{ type: "dropdown", id: "transition", label: "Transition", choices: [{ id: "", label: "(the one picked)" }, ...c.transitions], default: "" }],
				callback: (a) => this.post("/api/take", a.options.transition ? { transition: a.options.transition } : {}) },
			cut: { name: "CUT", options: [], callback: () => this.post("/api/take", { transition: "cut" }) },
			cue: { name: "Graphic on Preview", options: [comp, { type: "dropdown", id: "mode", label: "Do", choices: [{ id: "toggle", label: "Toggle" }, { id: "in", label: "In" }, { id: "out", label: "Out" }], default: "toggle" }],
				callback: (a) => this.post("/api/cue", { id: a.options.comp, on: this.mode(a.options.mode, "preview", a.options.comp) }) },
			program: { name: "Graphic on Program (in / out)", options: [comp, { type: "dropdown", id: "mode", label: "Do", choices: [{ id: "toggle", label: "Toggle" }, { id: "in", label: "In" }, { id: "out", label: "Out" }], default: "toggle" }],
				callback: (a) => this.post("/api/program", { id: a.options.comp, on: this.mode(a.options.mode, "program", a.options.comp) }) },
			send: { name: "Update on air (send Preview's fields)", options: [comp], callback: (a) => this.post("/api/send", { id: a.options.comp }) },
			clear: { name: "Clear", options: [{ type: "dropdown", id: "bus", label: "Bus", choices: [{ id: "program", label: "Program" }, { id: "preview", label: "Preview" }], default: "program" }],
				callback: (a) => this.post("/api/clear", { bus: a.options.bus }) },
			undo: { name: "Undo the last take", options: [], callback: () => this.post("/api/undo") },
			ros_next: { name: "Run of show: Next segment", options: [], callback: () => this.post("/api/ros/step", { by: 1 }) },
			ros_back: { name: "Run of show: Back", options: [], callback: () => this.post("/api/ros/step", { by: -1 }) },
			playlist_play: { name: "Playlist: play", options: [{ type: "dropdown", id: "id", label: "Playlist", choices: c.playlists, default: c.playlists[0] ? c.playlists[0].id : "" }],
				callback: (a) => this.post("/api/playlist/play", { id: a.options.id }) },
			playlist_stop: { name: "Playlist: stop", options: [], callback: () => this.post("/api/playlist/stop") },
			cam_look: { name: "Cameras: recall a look", options: [{ type: "dropdown", id: "name", label: "Look", choices: c.looks, default: c.looks[0] ? c.looks[0].id : "", allowCustom: true }],
				callback: (a) => this.post("/api/cams/look", { action: "recall", name: a.options.name }) },
			timer: { name: "Timer", options: [{ type: "dropdown", id: "do", label: "Do", choices: [{ id: "toggle", label: "Start / pause" }, { id: "start", label: "Start" }, { id: "pause", label: "Pause" }, { id: "reset", label: "Reset" }], default: "toggle" }],
				callback: (a) => this.post("/api/timer", { action: a.options.do === "toggle" ? (this.timerRunning() ? "pause" : "start") : a.options.do }) },
			score: { name: "Score", options: [{ type: "dropdown", id: "side", label: "Side", choices: [{ id: "left", label: "Left" }, { id: "right", label: "Right" }], default: "left" },
					{ type: "dropdown", id: "do", label: "Do", choices: [{ id: "up", label: "+1" }, { id: "down", label: "-1" }, { id: "set", label: "Set to" }], default: "up" },
					{ type: "number", id: "value", label: "Value (for Set to)", default: 0, min: 0, max: 99 }],
				callback: (a) => {
					const now = Number((this.global()[a.options.side] || {}).score || 0)
					const v = a.options.do === "up" ? now + 1 : a.options.do === "down" ? Math.max(0, now - 1) : Number(a.options.value) || 0
					return this.post("/api/global", { global: { [a.options.side]: { score: v } } })
				} },
			score_reset: { name: "Scores: reset both to 0", options: [], callback: () => this.post("/api/global", { global: { left: { score: 0 }, right: { score: 0 } } }) },
			swap: { name: "Swap left and right teams", options: [], callback: () => {
					const g = this.global(), L = g.left || {}, R = g.right || {}, left = {}, right = {}
					for (const k of new Set([...Object.keys(L), ...Object.keys(R)])) { left[k] = R[k] ?? ""; right[k] = L[k] ?? "" }
					return this.post("/api/global", { global: { left, right } })
				} },
			stream: { name: "Streaming: go live / stop", options: [{ type: "dropdown", id: "do", label: "Do", choices: [{ id: "toggle", label: "Toggle" }, { id: "on", label: "Go live" }, { id: "off", label: "Stop" }], default: "toggle" }],
				callback: (a) => this.post("/api/stream/on", { on: a.options.do === "toggle" ? !this.streaming() : a.options.do === "on" }) },
			rl_save: { name: "Rocket League: save this game now", options: [], callback: () => this.post("/api/rl/save") },
			rl_series: { name: "Rocket League: new series", options: [], callback: () => this.post("/api/rl/clear") },
			obs_scene: { name: "OBS: switch scene", options: [{ type: "dropdown", id: "scene", label: "Scene", choices: c.scenes, default: c.scenes[0] ? c.scenes[0].id : "", allowCustom: true }],
				callback: (a) => this.post("/api/obs/scene", { scene: a.options.scene }) },
		})

		const lit = { bgcolor: combineRgb(220, 40, 40), color: combineRgb(255, 255, 255) }
		this.setFeedbackDefinitions({
			on_program: { type: "boolean", name: "Graphic on Program", defaultStyle: lit, options: [comp], callback: (f) => this.on("program", f.options.comp) },
			on_preview: { type: "boolean", name: "Graphic on Preview", defaultStyle: { bgcolor: combineRgb(40, 170, 80), color: combineRgb(255, 255, 255) }, options: [comp],
				callback: (f) => this.on("preview", f.options.comp) },
			obs_scene: { type: "boolean", name: "OBS scene showing", defaultStyle: lit, options: [{ type: "dropdown", id: "scene", label: "Scene", choices: c.scenes, default: c.scenes[0] ? c.scenes[0].id : "", allowCustom: true }],
				callback: (f) => ((this.state && this.state.obs && this.state.obs.status) || {}).scene === f.options.scene },
			cam_live: { type: "boolean", name: "Camera connected", defaultStyle: { bgcolor: combineRgb(40, 170, 80), color: combineRgb(255, 255, 255) },
				options: [{ type: "dropdown", id: "id", label: "Camera", choices: c.cams, default: c.cams[0] ? c.cams[0].id : "" }],
				callback: (f) => (((this.state && this.state.cam_status) || {})[f.options.id] || {}).state === "live" },
			obs_live: { type: "boolean", name: "OBS is live", defaultStyle: lit, options: [], callback: () => !!((this.state && this.state.obs && this.state.obs.status) || {}).live },
			timer_running: { type: "boolean", name: "Timer running", defaultStyle: { bgcolor: combineRgb(40, 170, 80), color: combineRgb(255, 255, 255) }, options: [], callback: () => this.timerRunning() },
			streaming: { type: "boolean", name: "Streaming live", defaultStyle: lit, options: [], callback: () => this.streaming() },
			rl_reading: { type: "boolean", name: "Rocket League: reading the game", defaultStyle: { bgcolor: combineRgb(40, 170, 80), color: combineRgb(255, 255, 255) }, options: [],
				callback: () => ((this.state && this.state.rl) || {}).status === "on" },
			playing: { type: "boolean", name: "Playlist playing", defaultStyle: lit, options: [{ type: "dropdown", id: "id", label: "Playlist", choices: c.playlists, default: c.playlists[0] ? c.playlists[0].id : "" }],
				callback: (f) => !!(this.state && this.state.playing && this.state.playing.id === f.options.id) },
		})

		this.setVariableDefinitions([
			{ variableId: "program", name: "On Program" }, { variableId: "preview", name: "On Preview" },
			{ variableId: "segment", name: "Run of show: now" }, { variableId: "segment_next", name: "Run of show: next" }, { variableId: "segment_left", name: "Run of show: time left" },
			{ variableId: "obs_scene", name: "OBS scene" }, { variableId: "left_score", name: "Left score" }, { variableId: "right_score", name: "Right score" },
			{ variableId: "left_name", name: "Left team" }, { variableId: "right_name", name: "Right team" }, { variableId: "timer", name: "Timer" },
			{ variableId: "rl_blue", name: "Rocket League: Blue score" }, { variableId: "rl_orange", name: "Rocket League: Orange score" }, { variableId: "rl_clock", name: "Rocket League: clock" },
		])

		// one PVW and one IN button per graphic, and TAKE / CUT
		const presets = {
			take: { type: "button", category: "Take", name: "TAKE", style: { text: "TAKE", size: "24", color: combineRgb(255, 255, 255), bgcolor: combineRgb(200, 30, 30) },
				steps: [{ down: [{ actionId: "take", options: { transition: "" } }], up: [] }], feedbacks: [] },
			cut: { type: "button", category: "Take", name: "CUT", style: { text: "CUT", size: "24", color: combineRgb(255, 255, 255), bgcolor: combineRgb(40, 40, 40) },
				steps: [{ down: [{ actionId: "cut", options: {} }], up: [] }], feedbacks: [] },
			timer: { type: "button", category: "Timer and scores", name: "Timer start / pause", style: { text: "TIMER\\n$(standby-gfx:timer)", size: "14", color: combineRgb(255, 255, 255), bgcolor: combineRgb(30, 30, 30) },
				steps: [{ down: [{ actionId: "timer", options: { do: "toggle" } }], up: [] }], feedbacks: [{ feedbackId: "timer_running", options: {} }] },
			left_up: { type: "button", category: "Timer and scores", name: "Left +1", style: { text: "$(standby-gfx:left_name)\\n+1 ($(standby-gfx:left_score))", size: "auto", color: combineRgb(255, 255, 255), bgcolor: combineRgb(20, 60, 140) },
				steps: [{ down: [{ actionId: "score", options: { side: "left", do: "up", value: 0 } }], up: [] }], feedbacks: [] },
			right_up: { type: "button", category: "Timer and scores", name: "Right +1", style: { text: "$(standby-gfx:right_name)\\n+1 ($(standby-gfx:right_score))", size: "auto", color: combineRgb(255, 255, 255), bgcolor: combineRgb(150, 60, 20) },
				steps: [{ down: [{ actionId: "score", options: { side: "right", do: "up", value: 0 } }], up: [] }], feedbacks: [] },
			swap: { type: "button", category: "Timer and scores", name: "Swap sides", style: { text: "SWAP\\nSIDES", size: "18", color: combineRgb(255, 255, 255), bgcolor: combineRgb(30, 30, 30) },
				steps: [{ down: [{ actionId: "swap", options: {} }], up: [] }], feedbacks: [] },
			stream: { type: "button", category: "Streaming", name: "Go live / stop", style: { text: "STREAM", size: "18", color: combineRgb(255, 255, 255), bgcolor: combineRgb(30, 30, 30) },
				steps: [{ down: [{ actionId: "stream", options: { do: "toggle" } }], up: [] }], feedbacks: [{ feedbackId: "streaming", options: {} }] },
			rl_score: { type: "button", category: "Rocket League", name: "RL score (press: save game)", style: { text: "RL\\n$(standby-gfx:rl_blue) - $(standby-gfx:rl_orange)\\n$(standby-gfx:rl_clock)", size: "14", color: combineRgb(255, 255, 255), bgcolor: combineRgb(30, 30, 30) },
				steps: [{ down: [{ actionId: "rl_save", options: {} }], up: [] }], feedbacks: [{ feedbackId: "rl_reading", options: {} }] },
			next: { type: "button", category: "Run of show", name: "Next segment", style: { text: "NEXT\\n$(standby-gfx:segment_left)", size: "14", color: combineRgb(255, 255, 255), bgcolor: combineRgb(30, 30, 30) },
				steps: [{ down: [{ actionId: "ros_next", options: {} }], up: [] }], feedbacks: [] },
		}
		for (const g of c.comps) {
			presets["pvw_" + g.id] = { type: "button", category: "Preview", name: g.label, style: { text: g.label, size: "auto", color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
				steps: [{ down: [{ actionId: "cue", options: { comp: g.id, mode: "toggle" } }], up: [] }], feedbacks: [{ feedbackId: "on_preview", options: { comp: g.id } }] }
			presets["pgm_" + g.id] = { type: "button", category: "Program", name: g.label, style: { text: g.label, size: "auto", color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
				steps: [{ down: [{ actionId: "program", options: { comp: g.id, mode: "toggle" } }], up: [] }], feedbacks: [{ feedbackId: "on_program", options: { comp: g.id } }] }
		}
		for (const s of c.scenes) {
			presets["obs_" + s.id] = { type: "button", category: "OBS", name: s.label, style: { text: s.label, size: "auto", color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
				steps: [{ down: [{ actionId: "obs_scene", options: { scene: s.id } }], up: [] }], feedbacks: [{ feedbackId: "obs_scene", options: { scene: s.id } }] }
		}
		this.setPresetDefinitions(presets)
	}

	global() { return (this.state && this.state.project && this.state.project.global) || {} }
	timerRunning() { return !!(this.global().timer || {}).started }
	timerText() {
		const t = this.global().timer || {}, ran = t.started ? Math.max(0, Date.now() / 1000 + (this.skew || 0) - t.started) : 0
		const s = Math.max(0, Math.floor(t.down ? (t.secs || 0) - ran : (t.secs || 0) + ran))
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
	}
	streaming() { return !!((this.state && this.state.stream) || {}).on }
	rl(field) {
		const rows = (((this.state || {}).data || {}).tables || {})["Rocket League"] || []
		const r = rows.find((x) => x[0] === field)
		return r ? String(r[1] ?? "") : ""
	}

	on(bus, id) {
		const live = this.state && this.state.live
		return !!(live && live[bus] && (live[bus].on || []).includes(id))
	}

	mode(mode, bus, id) {
		return mode === "in" ? true : mode === "out" ? false : !this.on(bus, id)
	}

	variables() {
		if (!this.state || !this.state.live) return
		const g = (this.state.project && this.state.project.global) || {}
		const seg = segment(this.state, Date.now() / 1000 + (this.skew || 0))
		this.setVariableValues({
			program: names(this.state, "program"), preview: names(this.state, "preview"),
			segment: seg.now, segment_next: seg.next, segment_left: seg.left,
			obs_scene: ((this.state.obs && this.state.obs.status) || {}).scene || "",
			left_score: String((g.left || {}).score ?? ""), right_score: String((g.right || {}).score ?? ""),
			left_name: String((g.left || {}).name ?? ""), right_name: String((g.right || {}).name ?? ""), timer: this.timerText(),
			rl_blue: this.rl("Blue score"), rl_orange: this.rl("Orange score"), rl_clock: this.rl("Clock"),
		})
	}
}

runEntrypoint(StandByGFX, [])
