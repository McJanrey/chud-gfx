// Playlists (Control): graphics played on Program one after another by
// themselves, each for its seconds, then looping or stopping. The engine runs
// it (it keeps going with this page closed); this panel makes and steers them.
"use strict";

(function playlists() {
  const box = $("#playlist");
  let current = null;
  try { current = localStorage.getItem("gfx-playlist"); } catch (e) { /* */ }
  let endsAt = 0, endsKey = "";

  const lists = () => JSON.parse(JSON.stringify(App.state.project.playlists || []));
  const save = all => api("/api/playlists", { playlists: all });
  function edit(fn) {
    const all = lists(), p = all.find(x => x.id === current);
    if (!p) return;
    fn(p, all);
    save(all);
  }
  function choose(id) {
    current = id;
    try { localStorage.setItem("gfx-playlist", id || ""); } catch (e) { /* */ }
    render(true);
  }
  async function newList() {
    const name = prompt("Name of the playlist", "Sponsor loop");
    if (!name || !name.trim()) return;
    const all = lists(), id = "p" + Math.random().toString(16).slice(2, 10);
    all.push({ id, name: name.trim(), loop: true, items: [] });
    await save(all);
    choose(id);
  }

  function render(force) {
    const s = App.state, all = s.project.playlists || [];
    if (!all.some(p => p.id === current)) current = all[0] ? all[0].id : null;
    const p = all.find(x => x.id === current), pl = s.playlist;
    // Counting down on this page from what the engine said (its clock, not this PC's).
    const key = pl ? pl.id + ":" + pl.index + ":" + pl.until : "";
    if (key !== endsKey) { endsKey = key; endsAt = pl ? Date.now() + (pl.until - pl.now) * 1000 : 0; }
    const sig = JSON.stringify([all, pl && [pl.id, pl.index], current, s.project.compositions.map(c => [c.id, c.name])]);
    if (!force && box.dataset.sig === sig) return;
    // (not while a seconds box is being typed in)
    if (!force && box.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
    box.dataset.sig = sig;

    const head = h("div", { class: "row-gap pl-head" },
      all.length ? h("select", { onchange: e => choose(e.target.value) }, all.map(x => h("option", { value: x.id, selected: x.id === current }, x.name))) : null,
      h("button", { class: "small", onclick: newList }, "+ New"),
      p ? h("button", { class: "small", title: "Rename this playlist", onclick: () => {
        const name = prompt("Rename the playlist", p.name);
        if (name && name.trim()) edit(x => { x.name = name.trim(); });
      } }, "Rename") : null,
      p ? h("button", { class: "small danger", title: "Delete this playlist (its graphics stay)", onclick: () => {
        const rest = lists().filter(x => x.id !== p.id);
        save(rest).then(() => toast(`Deleted the playlist "${p.name}"`, false, { label: "Undo", run: () => save([...lists(), p]).then(() => choose(p.id)) }));
      } }, "Delete") : null);
    if (!p) {
      box.replaceChildren(head, h("div", { class: "empty" }, "No playlists yet. A playlist plays graphics on air one after another by itself, like a sponsor rotation for whole graphics."));
      return;
    }
    const playingThis = pl && pl.id === p.id;
    const items = p.items.filter(it => App.comp(it.comp));
    const bar = h("div", { class: "pl-bar" + (playingThis ? " on" : "") },
      playingThis
        ? [h("span", { class: "tally pgm" }, "ON AIR"), h("span", { class: "pl-now" }, `${pl.index + 1}/${pl.count} · ${(App.comp(pl.comp) || {}).name || ""}`), h("span", { class: "pl-left muted small" }),
           h("button", { class: "small", title: "Previous graphic", onclick: () => api("/api/playlist/step", { back: true }) }, "◀"),
           h("button", { class: "small", title: "Next graphic now", onclick: () => api("/api/playlist/step", {}) }, "▶▶"),
           h("button", { class: "small danger", title: "Stop: the graphic on air goes out", onclick: () => api("/api/playlist/stop", {}) }, "Stop")]
        : [h("button", { class: "primary small", disabled: !items.length, title: pl ? `Stops "${pl.name}" and plays this one` : "Puts the first graphic on Program, then the next after its seconds",
            onclick: () => api("/api/playlist/play", { id: p.id, index: 0 }) }, "▶ Play"),
           pl ? h("span", { class: "muted small" }, `"${pl.name}" is playing`) : null],
      h("label", { class: "pl-loop small", title: "After the last graphic, start again (off: stop and take it off air)" },
        h("input", { type: "checkbox", checked: p.loop !== false, onchange: e => edit(x => { x.loop = e.target.checked; }) }), " Loop"));
    const rows = p.items.map((it, i) => {
      const c = App.comp(it.comp);
      if (!c) return null;
      const live = playingThis && pl.index === i;
      return h("div", { class: "pl-row" + (live ? " live" : ""), title: "Click to play from here",
        onclick: e => { if (e.target.closest("input,button")) return; api("/api/playlist/play", { id: p.id, index: i }); } },
        thumb(c, App.state.live.preview.values[c.id], 72),
        h("span", { class: "pl-name" }, c.name),
        h("input", { type: "number", min: 1, max: 3600, step: 1, value: it.secs, title: "Seconds on air",
          onchange: e => edit(x => { x.items[i].secs = Math.max(1, Math.min(3600, +e.target.value || 10)); }) }), h("span", { class: "muted small" }, "s"),
        h("button", { class: "small", title: "Move up", disabled: !i, onclick: () => edit(x => { x.items.splice(i - 1, 0, x.items.splice(i, 1)[0]); }) }, "↑"),
        h("button", { class: "small danger", title: "Take it out of the playlist", onclick: () => edit(x => { x.items.splice(i, 1); }) }, "×"));
    });
    const add = h("select", { class: "small", onchange: e => { const id = e.target.value; if (id) edit(x => { x.items.push({ comp: id, secs: 10 }); }); } },
      h("option", { value: "" }, "+ Add a graphic…"), App.comps().filter(c => !c.hud).map(c => h("option", { value: c.id }, c.name)));
    box.replaceChildren(head, bar, h("div", { class: "pl-list" }, ...rows, items.length ? null : h("div", { class: "empty" }, "Add the graphics to play, in order.")), add);
    tickLeft();
  }
  function tickLeft() {
    const el = box.querySelector(".pl-left");
    if (el) el.textContent = endsAt ? `${Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))}s left` : "";
  }
  setInterval(tickLeft, 500);
  App.on(() => render(false));
})();
