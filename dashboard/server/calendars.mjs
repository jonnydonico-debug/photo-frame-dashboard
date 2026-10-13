// Connected calendars: read-only iCal (.ics) feeds — iCloud "Public Calendar" links and Google's
// "Secret address in iCal format". Each feed is assigned to JD, Georgia or both, refreshed every
// 10 minutes, and its events (7 days back to 90 days ahead, repeats expanded) are merged into
// state.events marked with `src`, alongside events typed in by hand. Feed links live in
// secrets.json (they are private URLs) and are never sent to the screens.
import crypto from 'node:crypto';

const PAST_MS = 7 * 864e5, AHEAD_MS = 90 * 864e5;
const WIN_TZ = { // Exchange/Outlook names that sometimes appear in feeds
  'Pacific Standard Time': 'America/Los_Angeles', 'Mountain Standard Time': 'America/Denver', 'Central Standard Time': 'America/Chicago',
  'Eastern Standard Time': 'America/New_York', 'GMT Standard Time': 'Europe/London', 'UTC': 'UTC', 'Coordinated Universal Time': 'UTC'
};

// ---------------------------------------------------------------- time zones
const fmtCache = {};
function tzOffset(ms, tz) {
  let f = fmtCache[tz];
  if (!f) f = fmtCache[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const p = {}; for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
function validTz(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } }
// Wall-clock time in a zone → UTC ms. tz null = floating (the Mac's own zone).
function wallToMs(y, mo, d, h, mi, s, tz) {
  if (!tz) return new Date(y, mo, d, h, mi, s).getTime();
  if (tz === 'UTC') return Date.UTC(y, mo, d, h, mi, s);
  const guess = Date.UTC(y, mo, d, h, mi, s);
  let ms = guess - tzOffset(guess, tz);
  const o2 = tzOffset(ms, tz); ms = guess - o2;
  return ms;
}

// ---------------------------------------------------------------- ICS parsing
function unescapeText(v) { return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim(); }
function parseLine(line) {
  let i = 0, q = false;
  for (; i < line.length; i++) { const ch = line[i]; if (ch === '"') q = !q; else if (ch === ':' && !q) break; }
  const head = line.slice(0, i), value = line.slice(i + 1);
  const parts = head.split(';'), name = parts.shift().toUpperCase(), params = {};
  for (const p of parts) { const j = p.indexOf('='); if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, ''); }
  return { name, params, value };
}
function parseICS(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = []; let cur = null, depth = 0, calTz = null;
  for (const raw of lines) {
    if (!raw) continue;
    const { name, params, value } = parseLine(raw);
    if (name === 'X-WR-TIMEZONE' && !cur) calTz = value.trim();
    if (name === 'BEGIN') { if (value === 'VEVENT' && !cur) { cur = { props: {}, multi: {} }; depth = 0; } else if (cur) depth++; continue; }
    if (name === 'END') { if (cur && value === 'VEVENT' && depth === 0) { events.push(cur); cur = null; } else if (cur) depth--; continue; }
    if (!cur || depth > 0) continue;
    if (name === 'EXDATE' || name === 'RDATE') (cur.multi[name] = cur.multi[name] || []).push({ params, value });
    else if (!cur.props[name]) cur.props[name] = { params, value };
  }
  return { events, calTz };
}
// A DATE or DATE-TIME property → { ms, allDay, tz, wall:[y,mo,d,h,mi,s] }
function parseDate(prop, calTz) {
  if (!prop) return null;
  const v = prop.value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1, d = +m[3];
  if (!m[4] || prop.params.VALUE === 'DATE') return { allDay: true, ms: new Date(y, mo, d).getTime(), wall: [y, mo, d, 0, 0, 0], tz: null };
  const h = +m[4], mi = +m[5], s = +(m[6] || 0);
  let tz = m[7] ? 'UTC' : (prop.params.TZID || calTz || null);
  if (tz && tz !== 'UTC') { tz = WIN_TZ[tz] || tz.replace(/^\/[^/]+\/[^/]+\//, ''); if (!validTz(tz)) tz = null; }
  return { allDay: false, ms: wallToMs(y, mo, d, h, mi, s, tz), wall: [y, mo, d, h, mi, s], tz };
}
function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || '').trim());
  if (!m) return null;
  const ms = ((+m[2] || 0) * 7 * 864e5) + ((+m[3] || 0) * 864e5) + ((+m[4] || 0) * 36e5) + ((+m[5] || 0) * 6e4) + ((+m[6] || 0) * 1e3);
  return m[1] === '-' ? -ms : ms;
}

// ---------------------------------------------------------------- repeats (RRULE)
const DOW = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
function parseRule(v) {
  const r = {}; for (const kv of v.split(';')) { const [k, x] = kv.split('='); if (k) r[k.toUpperCase()] = x; }
  return r;
}
const daysIn = (y, mo) => new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
const dowOf = (y, mo, d) => new Date(Date.UTC(y, mo, d)).getUTCDay();
// Days (1-based) in a month matching BYDAY entries like "MO", "2TU", "-1FR"
function monthDaysByDay(y, mo, byday) {
  const out = [], n = daysIn(y, mo);
  for (const t of byday) {
    const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(t); if (!m || !(m[2] in DOW)) continue;
    const want = DOW[m[2]], all = [];
    for (let d = 1; d <= n; d++) if (dowOf(y, mo, d) === want) all.push(d);
    if (!m[1]) out.push(...all);
    else { const k = +m[1]; const d = k > 0 ? all[k - 1] : all[all.length + k]; if (d) out.push(d); }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}
// Wall-clock start dates [y,mo,d] of each occurrence, in order, from DTSTART
function* occurrences(start, rule) {
  const freq = rule.FREQ, interval = Math.max(1, +rule.INTERVAL || 1);
  const [y0, mo0, d0] = start.wall;
  const byday = rule.BYDAY ? rule.BYDAY.split(',') : null;
  const bymd = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : null;
  const bymonth = rule.BYMONTH ? rule.BYMONTH.split(',').map(x => +x - 1) : null;
  const startKey = y0 * 10000 + mo0 * 100 + d0;
  const key = (y, mo, d) => y * 10000 + mo * 100 + d;
  for (let step = 0; step < 3000; step++) {
    let cands = [];
    if (freq === 'DAILY') {
      const t = new Date(Date.UTC(y0, mo0, d0 + step * interval));
      cands = [[t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()]];
      if (bymonth && !bymonth.includes(cands[0][1])) cands = [];
    } else if (freq === 'WEEKLY') {
      const wkst = DOW[rule.WKST || 'MO'];
      const back = (dowOf(y0, mo0, d0) - wkst + 7) % 7;
      const weekStart = new Date(Date.UTC(y0, mo0, d0 - back + step * 7 * interval));
      const want = byday ? byday.map(x => DOW[x.slice(-2)]).filter(x => x != null) : [dowOf(y0, mo0, d0)];
      for (let i = 0; i < 7; i++) {
        const t = new Date(+weekStart + i * 864e5);
        if (want.includes(t.getUTCDay())) cands.push([t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()]);
      }
    } else if (freq === 'MONTHLY') {
      const t = new Date(Date.UTC(y0, mo0 + step * interval, 1)), y = t.getUTCFullYear(), mo = t.getUTCMonth();
      if (bymonth && !bymonth.includes(mo)) { cands = []; }
      else {
        let ds = byday ? monthDaysByDay(y, mo, byday) : bymd ? bymd.map(x => x < 0 ? daysIn(y, mo) + x + 1 : x) : [d0];
        if (byday && bymd) ds = ds.filter(x => bymd.includes(x));
        cands = ds.filter(d => d >= 1 && d <= daysIn(y, mo)).map(d => [y, mo, d]);
      }
    } else if (freq === 'YEARLY') {
      const y = y0 + step * interval;
      for (const mo of bymonth || [mo0]) {
        const ds = byday ? monthDaysByDay(y, mo, byday) : bymd ? bymd.map(x => x < 0 ? daysIn(y, mo) + x + 1 : x) : [d0];
        for (const d of ds) if (d >= 1 && d <= daysIn(y, mo)) cands.push([y, mo, d]);
      }
    } else return;
    for (const c of cands.sort((a, b) => key(...a) - key(...b))) if (key(...c) >= startKey) yield c;
  }
}

function expand(ev, calTz, winStart, winEnd) {
  const p = ev.props;
  if (!p.DTSTART || (p.STATUS && /CANCELLED/i.test(p.STATUS.value))) return [];
  const start = parseDate(p.DTSTART, calTz); if (!start) return [];
  const endP = parseDate(p.DTEND, calTz);
  const dur = endP ? endP.ms - start.ms : p.DURATION ? parseDuration(p.DURATION.value) : (start.allDay ? 864e5 : 0);
  const base = { uid: p.UID ? p.UID.value : crypto.createHash('md5').update(JSON.stringify(p.DTSTART) + (p.SUMMARY && p.SUMMARY.value)).digest('hex'),
    title: p.SUMMARY ? unescapeText(p.SUMMARY.value) || 'Busy' : 'Busy', loc: p.LOCATION ? unescapeText(p.LOCATION.value).split('\n')[0].slice(0, 120) : '',
    notes: p.DESCRIPTION ? unescapeText(p.DESCRIPTION.value).slice(0, 300) : '', allDay: start.allDay };
  const out = [];
  const push = ms => {
    let endMs = ms + Math.max(0, dur || 0);
    if (start.allDay) { const a = new Date(ms); const b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + Math.max(1, Math.round((dur || 864e5) / 864e5))); endMs = b.getTime(); }
    if (endMs > winStart && ms < winEnd) out.push(Object.assign({ startMs: ms, endMs }, base));
  };
  if (!p.RRULE) { push(start.ms); return out; }
  const rule = parseRule(p.RRULE.value);
  const until = rule.UNTIL ? (parseDate({ value: rule.UNTIL, params: {} }, calTz) || {}).ms : null;
  const count = rule.COUNT ? +rule.COUNT : null;
  const ex = new Set();
  for (const e of ev.multi.EXDATE || []) for (const v of e.value.split(',')) { const d = parseDate({ value: v, params: e.params }, calTz); if (d) ex.add(start.allDay ? new Date(d.ms).toDateString() : d.ms); }
  let n = 0;
  const [, , , h, mi, s] = start.wall;
  for (const [y, mo, d] of occurrences(start, rule)) {
    const ms = start.allDay ? new Date(y, mo, d).getTime() : wallToMs(y, mo, d, h, mi, s, start.tz);
    if (until != null && ms > until) break;
    n++;
    if (count != null && n > count) break;
    if (ms > winEnd) break;
    if (ex.has(start.allDay ? new Date(ms).toDateString() : ms)) continue;
    push(ms);
  }
  for (const r of ev.multi.RDATE || []) for (const v of r.value.split(',')) { const d = parseDate({ value: v, params: r.params }, calTz); if (d) push(d.ms); }
  return out;
}

// All occurrences in the window, with moved/edited single occurrences (RECURRENCE-ID) applied
export function eventsFromICS(text, now = Date.now()) {
  const { events, calTz } = parseICS(text);
  const winStart = now - PAST_MS, winEnd = now + AHEAD_MS;
  const overridden = new Set(), out = [];
  for (const ev of events) {
    const rid = ev.props['RECURRENCE-ID'];
    if (rid && ev.props.UID) { const d = parseDate(rid, calTz); if (d) overridden.add(ev.props.UID.value + '|' + d.ms); }
  }
  for (const ev of events) {
    const isOverride = !!ev.props['RECURRENCE-ID'];
    for (const o of expand(ev, calTz, winStart, winEnd)) {
      if (!isOverride && ev.props.RRULE && overridden.has(o.uid + '|' + o.startMs)) continue;
      out.push(o);
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs).slice(0, 2000);
}

// ---------------------------------------------------------------- the service
export function createCalendars({ secrets, saveSecrets, getState, commit, log }) {
  const status = {};       // feed id -> { ok, count, error, checked }
  let feedEvents = null;   // events from feeds, as stored in state.events
  let timer = null, busy = false;
  const feeds = () => (secrets.calendars = secrets.calendars || []);
  const peopleFor = who => who === 'both' ? (getState().people || []).map(p => p.id) : [who];
  const byFeed = {};       // feed id -> last good events (kept when a refresh fails)

  function current() {
    if (feedEvents) return feedEvents;
    return (getState().events || []).filter(e => e.src); // from before a restart
  }
  // Keep feed events intact whenever a screen saves its (hand-made) events
  function mergeIncoming(list) {
    return (Array.isArray(list) ? list : []).filter(e => e && !e.src).concat(current());
  }
  function publish() {
    feedEvents = feeds().flatMap(f => byFeed[f.id] || []);
    const manual = (getState().events || []).filter(e => !e.src);
    commit({ events: manual.concat(feedEvents) }, 'server');
  }
  async function fetchFeed(f) {
    const url = f.url.trim().replace(/^webcal:\/\//i, 'https://');
    let r;
    try { r = await fetch(url, { headers: { 'User-Agent': 'HomeHQ/1.0 (calendar sync)', Accept: 'text/calendar,*/*' }, signal: AbortSignal.timeout(30000), redirect: 'follow' }); }
    catch (e) { if (e.name === 'TimeoutError') throw e; throw new Error('Couldn’t reach that calendar link (check it was copied in full)'); }
    if (!r.ok) throw new Error(r.status === 404 ? 'Link not found (it may have been turned off or regenerated)' : r.status === 401 || r.status === 403 ? 'The calendar refused the link (private or turned off)' : 'Calendar server said ' + r.status);
    const text = await r.text();
    if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('That link isn’t an iCal calendar feed');
    const people = peopleFor(f.person);
    return eventsFromICS(text).map(o => ({
      id: 'cal-' + f.id + '-' + crypto.createHash('md5').update(o.uid + '|' + o.startMs).digest('hex').slice(0, 12),
      title: o.title, start: new Date(o.startMs).toISOString(), end: new Date(Math.max(o.endMs, o.startMs + (o.allDay ? 864e5 : 0))).toISOString(),
      allDay: o.allDay || undefined, loc: o.loc || undefined, notes: o.notes || undefined, people, src: f.id, srcName: f.name
    }));
  }
  async function sync() {
    if (busy) return status;
    busy = true;
    try {
      for (const f of feeds()) {
        try {
          byFeed[f.id] = await fetchFeed(f);
          status[f.id] = { ok: true, count: byFeed[f.id].length, checked: new Date().toISOString() };
        } catch (e) {
          status[f.id] = { ok: false, error: e.name === 'TimeoutError' ? 'The calendar server didn’t answer' : e.message, checked: new Date().toISOString(), count: (byFeed[f.id] || []).length };
          if (!byFeed[f.id]) byFeed[f.id] = (getState().events || []).filter(x => x.src === f.id); // keep what we had
          log('calendar', f.name + ':', status[f.id].error);
        }
      }
      for (const k of Object.keys(byFeed)) if (!feeds().some(f => f.id === k)) delete byFeed[k];
      publish();
    } finally { busy = false; }
    return status;
  }
  function list() {
    return feeds().map(f => ({ id: f.id, name: f.name, person: f.person, host: (() => { try { return new URL(f.url.replace(/^webcal:/i, 'https:')).hostname; } catch { return ''; } })(), status: status[f.id] || { ok: false, note: 'Not synced yet' } }));
  }
  async function add({ name, url, person }) {
    url = String(url || '').trim();
    if (!/^(https?|webcal):\/\/\S+$/i.test(url)) throw Object.assign(new Error('Paste the calendar’s full link (starts with webcal:// or https://)'), { status: 400 });
    const valid = ['both'].concat((getState().people || []).map(p => p.id));
    if (!valid.includes(person)) throw Object.assign(new Error('Pick whose calendar it is'), { status: 400 });
    const f = { id: crypto.randomBytes(4).toString('hex'), name: String(name || 'Calendar').trim().slice(0, 40) || 'Calendar', url, person };
    // Check it works before saving
    try { byFeed[f.id] = await fetchFeed(f); }
    catch (e) { throw Object.assign(new Error(e.name === 'TimeoutError' ? 'The calendar server didn’t answer' : e.message), { status: 400 }); }
    status[f.id] = { ok: true, count: byFeed[f.id].length, checked: new Date().toISOString() };
    feeds().push(f); saveSecrets(); publish();
    return { id: f.id, count: byFeed[f.id].length };
  }
  function update(id, b) {
    const f = feeds().find(x => x.id === id); if (!f) throw Object.assign(new Error('No such calendar'), { status: 404 });
    if (b.name) f.name = String(b.name).trim().slice(0, 40);
    if (b.person) f.person = b.person;
    saveSecrets(); sync();
  }
  function remove(id) {
    secrets.calendars = feeds().filter(f => f.id !== id); delete byFeed[id]; delete status[id];
    saveSecrets(); publish();
  }
  function start() { clearInterval(timer); if (feeds().length) sync(); timer = setInterval(() => { if (feeds().length) sync(); }, 10 * 60000); }
  return { start, sync, list, add, update, remove, mergeIncoming, count: () => feeds().length };
}
