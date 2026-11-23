// Local only (not shipped): turns GFX Baby's VALORANT data (/api/val/hud) into the state Owen's SCC 2027 HUD reads.
(function () {
  var SIDES = ["left", "right"];
  var WIN = { elimination: "Elimination", spike: "Detonation", defuse: "Deactivation", time: "Time" };
  function secs(t) { var m = /^(\d+):(\d\d)$/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : 0; }
  function logo(p) { return p ? String(p).replace(/^\//, "") : ""; }
  function build(h) {
    var T = h.teams || [{}, {}], atk = (T[1] || {}).side === "ATK" ? "right" : "left";
    var players = [], carrier = null;
    (h.players || [[], []]).forEach(function (list, ti) {
      (list || []).forEach(function (p) {
        var q = { team: SIDES[ti], slot: p.slot, name: p.name || "", agent: p.agent || "", alive: p.alive !== false,
          health: p.health == null ? 100 : p.health, credits: p.credits || 0, kills: p.kills || 0, deaths: p.deaths || 0,
          assists: p.assists || 0, ult_points: p.ult || 0, ult_max: p.ult_max || 7, weapon: p.weapon || "",
          shield: p.armor != null ? ({ heavy: 50, light: 25 }[p.armor] || 0) : (p.shields || 0), regen_shield: p.armor === "regen",
          spike: !!p.spike, abilities: p.abilities || {}, spent: 0, round_kills: 0, first_kills: 0 };
        if (q.spike) carrier = [q.team, q.slot];
        players.push(q);
      });
    });
    function won(i) { return (h.history || []).filter(function (r) { return r.winner === i; }).length; }   // (no score sent: count the round history)
    var rounds = (h.history || []).map(function (r) { return { winner: SIDES[r.winner] || "left", win_type: WIN[r.how] || "Elimination" }; });
    var match = { map: h.map || "", round: h.round || 1, phase: h.phase || "", timer: secs(h.timer),
      score: { left: (T[0] || {}).score || won(0), right: (T[1] || {}).score || won(1) }, attackers: atk,
      spike: carrier && !h.spike ? { state: "carried", carrier: carrier } : { state: h.spike || "", timer: 0 },
      rounds: rounds, round_winner: "", win_type: "", observed: null };
    if (rounds.length && h.phase === "end") { match.round_winner = rounds[rounds.length - 1].winner; match.win_type = rounds[rounds.length - 1].win_type; }
    function team(t) { return { name: t.name || "", tricode: t.short || t.name || "", logo: logo(t.logo), wins: +t.series || 0, color: t.color || "" }; }
    return { game: { connected: !!h.live, match: match, players: players },
      config: { left: team(T[0] || {}), right: team(T[1] || {}), best_of: h.best_of || 3, team_size: 5, maps: [], current_map: 0,
        timeouts: { left: (T[0] || {}).timeouts == null ? 2 : T[0].timeouts, right: (T[1] || {}).timeouts == null ? 2 : T[1].timeouts },
        timeout_call: "", tech_pause: false, event_text: "", sponsors: [], sponsor_seconds: 4,
        show: { timeouts: true, scoreboard: true, ace: true, listen_in: "" }, ace_pictures: { left: "agent", right: "agent" } } };
  }
  window.sgState = function () {
    return fetch("/api/val/hud", { cache: "no-store" }).then(function (r) { return r.json(); })
      .then(function (h) { var s = build(h); return { json: function () { return s; } }; });
  };
})();
