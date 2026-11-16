// Live data (Spec 01 section 4): {{Table!Field}} in any string, from tables
// shaped [["Field", "Value"], [field, value], ...].
const TOKEN = /\{\{\s*([^{}!]+?)\s*!\s*([^{}]+?)\s*\}\}/g;

export function lookup(tables, table, field) {
  const rows = tables[table];
  if (!Array.isArray(rows)) return "";
  const want = field.toLowerCase();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase() === want) return rows[i][1] == null ? "" : String(rows[i][1]);
  }
  // a column by its header and a row number: {{Match!Score#3}} (the 3rd row under the header)
  const col = /^(.+?)#(\d+)$/.exec(field.trim());
  if (col) {
    const c = (rows[0] || []).findIndex(h => String(h).toLowerCase() === col[1].toLowerCase());
    const v = c >= 0 ? (rows[+col[2]] || [])[c] : undefined;
    return v == null ? "" : String(v);
  }
  // a cell by spreadsheet reference: {{Match!B2}} (column letters, row number from 1)
  const cell = /^([a-z]{1,3})(\d+)$/i.exec(field.trim());
  if (cell) {
    let c = 0;
    for (const ch of cell[1].toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64;
    const v = (rows[+cell[2] - 1] || [])[c - 1];
    return v == null ? "" : String(v);
  }
  return "";
}

// Built-in tokens with no table: {{TIME}} / {{CLOCK}} (the Global clock), {{DATE}}, {{Sponsors}}.
const pad = n => String(n).padStart(2, "0");
let skew = 0;   // engine clock minus this PC's (so every output shows the same second)
export function setNow(engineSeconds) { skew = engineSeconds * 1000 - Date.now(); }
export const nowSkew = () => skew;
function clockText(tables) {
  const now = new Date(Date.now() + skew);
  const mode = lookup(tables, "Global", "Clock mode"), until = lookup(tables, "Global", "Clock until"), zone = lookup(tables, "Global", "Clock zone");
  if ((mode === "soon" || mode === "brb") && /^\d{1,2}:\d{2}$/.test(until)) {
    const [h, m] = until.split(":").map(Number), end = new Date(now);
    end.setHours(h, m, 0, 0);
    const left = Math.max(0, Math.floor((end - now) / 1000));
    return (left >= 3600 ? Math.floor(left / 3600) + ":" : "") + pad(Math.floor(left / 60) % 60) + ":" + pad(left % 60);
  }
  const h = now.getHours();
  return `${pad((h % 12) || 12)}:${pad(now.getMinutes())} ${h < 12 ? "AM" : "PM"}` + (zone ? " " + zone : "");
}
// {{Sponsors}}: the sponsor showing now. Every output picks the same one: they take turns from the
// list's epoch, each for its seconds (Sponsors table: Logo, Seconds, Epoch, White).
function sponsorNow(tables) {
  const rows = (tables.Sponsors || []).slice(1).filter(r => r[0]);
  if (!rows.length) return "";
  const secs = rows.map(r => Math.max(1, +r[1] || 10)), total = secs.reduce((a, b) => a + b, 0);
  let t = ((Date.now() + skew) / 1000 - (+rows[0][2] || 0)) % total;
  for (let i = 0; i < rows.length; i++) { if (t < secs[i]) return rows[i][0]; t -= secs[i]; }
  return rows[0][0];
}
const time24 = () => { const n = new Date(Date.now() + skew); return pad(n.getHours()) + ":" + pad(n.getMinutes()); };
// {{countdown:19:30}}: time left until that time today (or tomorrow once it's passed more than 12 hours ago)
function countdown(_, until) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(until || "");
  if (!m) return "";
  const now = new Date(Date.now() + skew), end = new Date(now);
  end.setHours(+m[1], +m[2], 0, 0);
  if (end - now < -12 * 3600e3) end.setDate(end.getDate() + 1);
  const left = Math.max(0, Math.floor((end - now) / 1000));
  return (left >= 3600 ? Math.floor(left / 3600) + ":" : "") + pad(Math.floor(left / 60) % 60) + ":" + pad(left % 60);
}
// {{TIMER}}: the Global timer. Timer secs = time already counted; Timer started = when it began running
// (0: stopped). Up: secs + running time (whole seconds down); down: secs - running time (up), never below 0.
function timerText(tables) {
  const secs = +lookup(tables, "Global", "Timer secs") || 0, started = +lookup(tables, "Global", "Timer started") || 0, down = !!lookup(tables, "Global", "Timer down");
  const ran = started ? Math.max(0, (Date.now() + skew) / 1000 - started) : 0;
  const t = down ? Math.max(0, Math.ceil(secs - ran)) : Math.floor(secs + ran);
  return (t >= 3600 ? Math.floor(t / 3600) + ":" : "") + pad(Math.floor(t / 60) % 60) + ":" + pad(t % 60);
}
const BUILTIN = { TIMER: timerText, TIME: clockText, CLOCK: clockText, TIME24: time24, SPONSORS: sponsorNow, COUNTDOWN: countdown, DATE: () => new Date(Date.now() + skew).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" }).toUpperCase() };
const PLAIN = /\{\{\s*(TIMER|TIME24|TIME|CLOCK|DATE|SPONSORS|COUNTDOWN)\s*(?::\s*([0-9:]+)\s*)?\}\}/gi;

export function resolve(text, tables) {
  if (typeof text !== "string" || !text.includes("{{")) return text;
  return text.replace(PLAIN, (_, k, arg) => BUILTIN[k.toUpperCase()](tables, arg)).replace(TOKEN, (_, t, f) => lookup(tables, t, f));
}
export const ticks = text => typeof text === "string" && PLAIN.test(text) && !(PLAIN.lastIndex = 0);

// (old, client-side Global table: kept only for pages without an engine)
export function globalTable(g = {}) {
  const rows = [["Field", "Value"]];
  const add = (k, v) => rows.push([k, v == null ? "" : String(v)]);
  add("Event", g.event); add("Stage", g.stage); add("Best of", g.best_of);
  for (const [side, S] of [["left", "Left"], ["right", "Right"]]) {
    const t = g[side] || {};
    add(`${S} name`, t.name); add(`${S} short`, t.short); add(`${S} logo`, t.logo);
    add(`${S} color`, t.color); add(`${S} score`, t.score);
  }
  add("Tournament logo", g.tournament_logo);
  for (const [k, v] of g.custom || []) add(k, v);
  return rows;
}
