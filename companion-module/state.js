// The engine's state as the module keeps it (pure functions, tested by test.js).

// The stream sends only the parts that changed (project, live, ros, obs, playing, now ...).
function merge(state, msg) {
	return Object.assign({}, state || {}, msg || {})
}

// Dropdown choices from the state.
function choices(s) {
	const p = (s && s.project) || {}
	return {
		comps: (p.compositions || []).map((c) => ({ id: c.id, label: c.name })),
		transitions: (p.transitions || []).filter((t) => t.enabled !== false).map((t) => ({ id: t.id, label: t.name || t.type })),
		playlists: (p.playlists || []).map((x) => ({ id: x.id, label: x.name })),
		scenes: ((((s && s.obs) || {}).status || {}).scenes || []).map((n) => ({ id: n, label: n })),
		looks: (p.cam_looks || []).map((l) => ({ id: l.name, label: l.name })),
		cams: (p.cams || []).map((c) => ({ id: c.id, label: c.name })),
	}
}

function names(s, bus) {
	const byId = Object.fromEntries((((s && s.project) || {}).compositions || []).map((c) => [c.id, c.name]))
	return ((((s && s.live) || {})[bus] || {}).on || []).map((id) => byId[id] || id).join(", ")
}

const pad = (n) => String(n).padStart(2, "0")
function clock(secs) {
	const neg = secs < 0
	secs = Math.abs(Math.round(secs))
	return (neg ? "+" : "") + (secs >= 3600 ? Math.floor(secs / 3600) + ":" : "") + pad(Math.floor(secs / 60) % 60) + ":" + pad(secs % 60)
}

// The run of show: the segment on now, the next one, and the time left in this one (nowSecs: the engine's clock).
function segment(s, nowSecs) {
	const r = (s && s.ros) || {}
	const show = r.show
	if (!show) return { now: "", next: "", left: "" }
	const tl = r.timeline || []
	const i = show.current
	const cur = tl[i]
	const nxt = tl.slice(i + 1).find((x) => !x.skip)
	const left = cur && cur.start != null ? cur.start + cur.seg.mins * 60 - nowSecs : null
	return { now: cur ? cur.seg.title : "", next: nxt ? nxt.seg.title : "", left: left == null ? "" : clock(left) }
}

module.exports = { merge, choices, names, segment, clock }
