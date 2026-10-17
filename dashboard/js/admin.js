// Home HQ admin: runs on any phone or PC on the home network (or Tailscale).
// Edits the same state the wall display shows; every save is pushed live to every screen.
const CLIENT = 'admin-' + Math.random().toString(36).slice(2, 8);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DASH = /^admin\./.test(location.hostname) ? location.protocol + '//' + location.hostname.replace(/^admin\./, 'frame.') + '/' : '/';
const rid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

let S = null, rev = 0, cfg = null, shortcuts = [], section = 'overview', openItem = null, deferred = false;

// ------------------------------------------------------------------ API
async function call(path, opts = {}) {
  const r = await fetch(path, {
    method: opts.method || 'GET', cache: 'no-store',
    headers: Object.assign({ 'X-HQ': '1' }, opts.body ? { 'Content-Type': 'application/json' } : {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let j = null; try { j = await r.json(); } catch {}
  if (r.status === 401) { renderLogin(); throw new Error('login'); }
  if (!r.ok) throw new Error((j && j.error) || 'HTTP ' + r.status);
  return j;
}
const saveTimers = {};
function save(key, now) {
  clearTimeout(saveTimers[key]);
  const go = () => call('/api/state', { method: 'PATCH', body: { patch: { [key]: S[key] }, client: CLIENT } })
    .then(j => { rev = j.rev; flash('Saved'); })
    .catch(e => { if (e.message !== 'login') flash('Save failed: ' + e.message, true); });
  if (now) go(); else saveTimers[key] = setTimeout(go, 350);
}
let flashTimer;
function flash(msg, bad) {
  const f = $('#flash'); if (!f) return;
  f.textContent = msg; f.className = 'flash is-on' + (bad ? ' is-bad' : '');
  clearTimeout(flashTimer); flashTimer = setTimeout(() => { f.className = 'flash'; }, bad ? 4000 : 1200);
}

// ------------------------------------------------------------------ helpers
function hexRgb(hex) { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.replace(/./g, c => c + c) : h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function inkFor(hex) { const [r, g, b] = hexRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#111111' : '#FFFFFF'; }
function person(id) { return (S.people || []).find(p => p.id === id) || { name: id === 'any' ? 'Anyone' : id === 'family' ? 'Family' : id, color: '#111' }; }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function toLocalInput(iso, dateOnly) {
  const d = new Date(iso); if (isNaN(d)) return '';
  const day = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  return dateOnly ? day : day + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function fmtWhen(e) {
  const s = new Date(e.start);
  const day = s.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return e.allDay ? day + ' · all day' : day + ' · ' + s.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function photoUrl(p, w) { return p.src || 'https://picsum.photos/seed/' + p.seed + '/' + (w || 300) + '/' + Math.round((w || 300) * (p.o === 'p' ? 1.4 : 0.66)); }
const ICONS = ['sunrise', 'utensils', 'film', 'away', 'moon', 'sun', 'bulb', 'heart', 'star', 'home', 'bolt', 'music'];
const VIEWS = [['home', 'Today'], ['calendar', 'Calendar'], ['tasks', 'Chores'], ['shopping', 'Shopping'], ['reminders', 'Reminders'], ['notes', 'Notes'], ['recipes', 'Recipes'], ['music', 'Music'], ['photos', 'Photos'], ['map', 'Map'], ['games', 'Games'], ['control', 'Home'], ['settings', 'Settings'], ['agents', 'Agents'], ['costs', 'Costs']];

// ------------------------------------------------------------------ schema-driven list editor
// field: { k, label, type: text|number|color|check|select|people|datetime|date|textarea|shortcut|json, opts: () => [[v,label]] }
const SCHEMAS = {
  people: {
    title: 'Family', add: () => ({ id: rid('p'), name: 'New person', color: '#6E8069', rgb: '110 128 105', ink: '#FFFFFF', home: true, status: 'Home' }),
    sum: p => `<span class="dot" style="background:${esc(p.color)}"></span><b>${esc(p.name)}</b><small>${p.home ? 'Home' : esc(p.status || 'Away')}${p.eta ? ' · ETA ' + p.eta + ' min' : ''}</small>`,
    fields: [{ k: 'name', label: 'Name' }, { k: 'color', label: 'Colour', type: 'color' }, { k: 'home', label: 'At home', type: 'check' },
      { k: 'status', label: 'Status when away', ph: 'At the office' }, { k: 'eta', label: 'ETA (minutes)', type: 'number' }, { k: 'age', label: 'Age (kids earn stars)', type: 'number' }],
    onChange: (p, k) => {
      if (k === 'color') { p.rgb = hexRgb(p.color).join(' '); p.ink = inkFor(p.color); }
      if (k === 'age') { S.stars = S.stars || {}; if (p.age && S.stars[p.id] == null) { S.stars[p.id] = 0; save('stars'); } }
    }
  },
  events: {
    title: 'Calendar', add: () => { const s = new Date(); s.setMinutes(0, 0, 0); s.setHours(s.getHours() + 1); return { id: rid('e'), title: 'New event', start: s.toISOString(), end: new Date(+s + 3600e3).toISOString(), people: (S.people || []).map(p => p.id) }; },
    sum: e => `${dots(e.people)}<b>${esc(e.title)}</b><small>${esc(fmtWhen(e))}${e.loc ? ' · ' + esc(e.loc) : ''}</small>`,
    fields: [{ k: 'title', label: 'Title' }, { k: 'people', label: 'Who', type: 'people' }, { k: 'allDay', label: 'All day', type: 'check' },
      { k: 'start', label: 'Starts', type: 'datetime' }, { k: 'end', label: 'Ends', type: 'datetime' }, { k: 'loc', label: 'Where' },
      { k: 'travel', label: 'Travel time (min) · shows “leave in”', type: 'number' }, { k: 'notes', label: 'Notes', type: 'textarea' }],
    onChange: (e, k) => { if (k === 'start' && new Date(e.end) <= new Date(e.start)) e.end = new Date(+new Date(e.start) + 3600e3).toISOString(); }
  },
  chores: {
    title: 'Chores', add: () => ({ id: rid('c'), r: ((S.routines || [])[0] || {}).id, who: 'any', title: 'New chore', emoji: '✅', stars: 1, done: false }),
    sum: c => `<span class="emo">${esc(c.emoji || '•')}</span><b>${esc(c.title)}</b><small>${esc(person(c.who).name)} · ${esc(((S.routines || []).find(r => r.id === c.r) || {}).name || '')}${c.done ? ' · done' : ''}</small>`,
    fields: [{ k: 'title', label: 'Chore' }, { k: 'emoji', label: 'Emoji' }, { k: 'who', label: 'Who', type: 'select', opts: () => (S.people || []).map(p => [p.id, p.name]).concat([['any', 'Anyone']]) },
      { k: 'r', label: 'Routine', type: 'select', opts: () => (S.routines || []).map(r => [r.id, r.name + ' (' + r.range + ')']) },
      { k: 'stars', label: 'Stars', type: 'number' }, { k: 'done', label: 'Done', type: 'check' }]
  },
  routines: {
    title: 'Routines', add: () => ({ id: rid('r'), name: 'New routine', range: '', from: 0, to: 24 }),
    sum: r => `<b>${esc(r.name)}</b><small>${r.from}:00 – ${r.to}:00</small>`,
    fields: [{ k: 'name', label: 'Name' }, { k: 'from', label: 'From hour (0–23)', type: 'number' }, { k: 'to', label: 'To hour (1–24)', type: 'number' }, { k: 'range', label: 'Label', ph: '6 – 11 AM' }]
  },
  groceries: {
    title: 'Shopping list', add: () => ({ id: rid('g'), name: 'New item', cat: 'Other', qty: 1, store: '', done: false, note: '' }),
    sum: g => `<b class="${g.done ? 'strike' : ''}">${esc(g.name)}${g.qty > 1 ? ' ×' + g.qty : ''}</b><small>${esc(g.cat)} · ${esc(((S.stores || []).find(s => s.id === g.store) || {}).name || 'Any store')}${g.note ? ' · ' + esc(g.note) : ''}</small>`,
    fields: [{ k: 'name', label: 'Item' }, { k: 'qty', label: 'Qty', type: 'number' }, { k: 'cat', label: 'Aisle', type: 'select', opts: () => ((S.catOrder || {}).all || []).concat(['Other']).map(c => [c, c]) },
      { k: 'store', label: 'Store', type: 'select', opts: () => [['', 'Any store']].concat((S.stores || []).map(s => [s.id, s.name])) }, { k: 'note', label: 'Note' }, { k: 'done', label: 'Got it', type: 'check' }]
  },
  stores: {
    title: 'Stores', add: () => ({ id: rid('s'), name: 'New store' }), sum: s => `<b>${esc(s.name)}</b>`, fields: [{ k: 'name', label: 'Name' }],
    onChange: () => { S.catOrder = S.catOrder || {}; (S.stores || []).forEach(s => { if (!S.catOrder[s.id]) S.catOrder[s.id] = (S.catOrder.all || []).slice(); }); save('catOrder'); }
  },
  rooms: { title: 'Rooms', add: () => ({ id: rid('room'), name: 'New room' }), sum: r => `<b>${esc(r.name)}</b><small>${(S.devices || []).filter(d => d.room === r.id).length} devices</small>`, fields: [{ k: 'name', label: 'Name' }] },
  devices: {
    title: 'Devices', add: () => ({ id: rid('d'), room: ((S.rooms || [])[0] || {}).id, type: 'light', name: 'New light', on: false, level: 100, shortcut: '' }),
    sum: d => `<b>${esc(d.name)}</b><small>${esc(((S.rooms || []).find(r => r.id === d.room) || {}).name || '')} · ${esc(devState(d))}${d.shortcut ? ' · ⚡ ' + esc(d.shortcut) : ' · not linked'}</small>`,
    fields: [{ k: 'name', label: 'Name' }, { k: 'room', label: 'Room', type: 'select', opts: () => (S.rooms || []).map(r => [r.id, r.name]) },
      { k: 'type', label: 'Type', type: 'select', opts: () => [['light', 'Light'], ['blind', 'Blind / shade'], ['lock', 'Lock'], ['garage', 'Garage door']] },
      { k: 'shortcut', label: 'HomeKit Shortcut to run', type: 'shortcut' }],
    onChange: (d, k) => {
      if (k !== 'type') return;
      if (d.type === 'light') { d.on = !!d.on; d.level = d.level || 100; }
      if (d.type === 'blind') d.pos = d.pos || 0;
      if (d.type === 'lock') d.locked = d.locked !== false;
      if (d.type === 'garage') d.state = d.state || 'closed';
    }
  },
  scenes: {
    title: 'Scenes', add: () => ({ id: rid('sc'), name: 'New scene', icon: 'bulb', set: {}, shortcut: '' }),
    sum: s => `<b>${esc(s.name)}</b><small>${Object.keys(s.set || {}).length} devices${s.shortcut ? ' · ⚡ ' + esc(s.shortcut) : ''}</small>`,
    fields: [{ k: 'name', label: 'Name' }, { k: 'icon', label: 'Icon', type: 'select', opts: () => ICONS.map(i => [i, i]) },
      { k: 'shortcut', label: 'HomeKit Shortcut (runs instead of the per-device ones)', type: 'shortcut' }, { k: 'lockAll', label: 'Also lock every door', type: 'check' },
      { k: 'set', label: 'Device levels', type: 'sceneset' }]
  },
  cameras: {
    title: 'Cameras', add: () => ({ id: rid('cam'), name: 'New camera', url: '' }),
    sum: c => `<b>${esc(c.name)}</b><small>${c.url ? 'Snapshot URL set' : 'Demo picture'}</small>`,
    fields: [{ k: 'name', label: 'Name' }, { k: 'url', label: 'Snapshot image URL (JPEG)', ph: 'http://camera.local/snapshot.jpg' }]
  }
};
function devState(d) {
  if (d.type === 'light') return d.on ? d.level + '%' : 'Off';
  if (d.type === 'blind') return d.pos === 0 ? 'Closed' : d.pos + '% open';
  if (d.type === 'lock') return d.locked ? 'Locked' : 'Unlocked';
  return d.state || '';
}
function dots(ids) { return '<span class="dots">' + (ids || []).map(id => `<i style="background:${esc(person(id).color)}"></i>`).join('') + '</span>'; }

function fieldHTML(key, item, f) {
  const v = item[f.k], name = `data-k="${f.k}"`;
  const lab = `<span class="f-l">${esc(f.label)}</span>`;
  switch (f.type) {
    case 'check': return `<label class="f f--check"><input type="checkbox" ${name} ${v ? 'checked' : ''}>${lab}</label>`;
    case 'number': return `<label class="f">${lab}<input type="number" inputmode="numeric" ${name} value="${v == null ? '' : esc(v)}"></label>`;
    case 'color': return `<label class="f">${lab}<input type="color" ${name} value="${esc(v || '#111111')}"></label>`;
    case 'textarea': return `<label class="f f--wide">${lab}<textarea ${name} rows="2">${esc(v || '')}</textarea></label>`;
    case 'datetime': return `<label class="f">${lab}<input type="${item.allDay ? 'date' : 'datetime-local'}" ${name} data-t="dt" value="${esc(toLocalInput(v, item.allDay))}"></label>`;
    case 'select': return `<label class="f">${lab}<select ${name}>${f.opts().map(([o, l]) => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    case 'people': return `<div class="f f--wide">${lab}<div class="chips" ${name}>${(S.people || []).map(p => `<button type="button" class="chip ${(v || []).includes(p.id) ? 'is-on' : ''}" data-pid="${esc(p.id)}" style="--c:${esc(p.color)}">${esc(p.name)}</button>`).join('')}</div></div>`;
    case 'shortcut': return `<label class="f f--wide">${lab}<span class="row"><input ${name} list="shortcut-list" value="${esc(v || '')}" placeholder="e.g. Kitchen Pendants"><button type="button" class="btn btn--s" data-test="${esc(key)}">Test</button></span></label>`;
    case 'sceneset': return `<div class="f f--wide">${lab}<div class="scene-set">${(S.devices || []).filter(d => d.type === 'light' || d.type === 'blind').map(d => {
      const has = v && v[d.id] != null;
      return `<label class="ss-row"><input type="checkbox" data-ss="${esc(d.id)}" ${has ? 'checked' : ''}><span>${esc(d.name)}</span><input type="range" min="0" max="100" step="5" data-ssv="${esc(d.id)}" value="${has ? v[d.id] : 50}" ${has ? '' : 'disabled'}><output>${has ? (v[d.id] ? v[d.id] + '%' : 'Off') : '—'}</output></label>`;
    }).join('')}</div></div>`;
    default: return `<label class="f">${lab}<input ${name} value="${esc(v == null ? '' : v)}" placeholder="${esc(f.ph || '')}"></label>`;
  }
}

function listHTML(key, opts = {}) {
  const sc = SCHEMAS[key];
  let items = (S[key] || []).map((x, i) => [x, i]);
  if (opts.filter) items = items.filter(([x]) => opts.filter(x));
  if (opts.sort) items.sort((a, b) => opts.sort(a[0], b[0]));
  const shown = opts.limit ? items.slice(0, opts.limit) : items;
  return `<section class="block" data-list="${key}">
    <div class="block-h"><h2 class="serif">${esc(opts.title || sc.title)}</h2><span class="muted">${items.length}</span><button class="btn btn--s btn--solid" data-add="${key}">+ Add</button></div>
    ${opts.intro ? `<p class="intro">${opts.intro}</p>` : ''}
    <div class="items">${shown.map(([x, i]) => itemHTML(key, x, i)).join('') || '<p class="empty">Nothing here yet.</p>'}</div>
    ${opts.limit && items.length > opts.limit ? `<button class="btn btn--ghost" data-more="${key}">Show all ${items.length}</button>` : ''}
  </section>`;
}
function itemHTML(key, x, i) {
  const sc = SCHEMAS[key], open = openItem === key + ':' + x.id;
  const quick = key === 'devices' ? deviceControl(x) : key === 'groceries' ? `<input type="checkbox" class="q-check" data-qdone="${i}" ${x.done ? 'checked' : ''} aria-label="Got it">`
    : key === 'chores' ? `<input type="checkbox" class="q-check" data-qdone="${i}" ${x.done ? 'checked' : ''} aria-label="Done">` : '';
  return `<div class="item ${open ? 'is-open' : ''}" data-key="${key}" data-i="${i}">
    <div class="item-h">${quick}<button class="item-sum" data-open="${key}:${esc(x.id)}">${sc.sum(x)}</button></div>
    ${open ? `<form class="item-form" onsubmit="return false">${sc.fields.map(f => fieldHTML(key + ':' + i, x, f)).join('')}
      <div class="item-actions"><button type="button" class="btn btn--danger btn--s" data-del>Delete</button><button type="button" class="btn btn--s" data-open="${key}:${esc(x.id)}">Done</button></div></form>` : ''}
  </div>`;
}
function deviceControl(d) {
  if (d.type === 'light') return `<button class="tog ${d.on ? 'is-on' : ''}" data-dtog="${esc(d.id)}" aria-label="Toggle">${d.on ? d.level + '%' : 'Off'}</button>`;
  if (d.type === 'lock') return `<button class="tog ${d.locked ? '' : 'is-warn'}" data-dtog="${esc(d.id)}">${d.locked ? 'Locked' : 'Open'}</button>`;
  if (d.type === 'blind') return `<button class="tog ${d.pos ? 'is-on' : ''}" data-dtog="${esc(d.id)}">${d.pos ? d.pos + '%' : 'Shut'}</button>`;
  if (d.type === 'garage') return `<button class="tog ${d.state === 'closed' ? '' : 'is-warn'}" data-dtog="${esc(d.id)}">${esc(d.state)}</button>`;
  return '';
}

// ------------------------------------------------------------------ sections
const SECTIONS = [['overview', 'Overview'], ['family', 'Family'], ['calendar', 'Calendar'], ['chores', 'Chores'], ['shopping', 'Shopping'],
  ['photos', 'Photos'], ['music', 'Music'], ['home', 'Lights & Home'], ['assistant', 'iMessage'], ['agents', 'Agents'], ['costs', 'Costs'], ['settings', 'Settings']];

function overview() {
  const lights = (S.devices || []).filter(d => d.type === 'light' && d.on).length;
  const open = (S.groceries || []).filter(g => !g.done).length;
  const today = new Date(); today.setHours(0, 0, 0, 0); const tom = new Date(+today + 864e5);
  const evs = (S.events || []).filter(e => new Date(e.start) < tom && new Date(e.end) > today).length;
  const W = S.weather || {}, M = S.media || {};
  const base = location.origin;
  return `<section class="block hero-block">
      <div class="stats">
        <div><b>${W.t && W.t.length ? W.t[new Date().getHours()] + '°' : '—'}</b><span>${W.live ? esc(W.place || 'outside') : 'no address yet'}</span></div>
        <div><b>${(S.photos || []).length}</b><span>photos</span></div>
        <div><b>${(S.music || {}).playing ? '▶' : '—'}</b><span>${(S.music || {}).connected ? esc(((S.music || {}).device || {}).name || 'Spotify') : 'Spotify off'}</span></div>
        <div><b>${lights}</b><span>lights on</span></div>
      </div>
      <div class="row wrap">
        <a class="btn btn--solid" href="${DASH}" target="_blank">Open the dashboard ↗</a>
        <button class="btn" data-alloff>All lights off</button>
      </div>
    </section>
    <section class="block"><div class="block-h"><h2 class="serif">Scenes</h2></div>
      <div class="scene-grid">${(S.scenes || []).map(s => `<button class="btn scene-btn" data-scene="${esc(s.id)}">${esc(s.name)}</button>`).join('')}</div>
    </section>
    <section class="block"><div class="block-h"><h2 class="serif">Say something on the frame</h2></div>
      <div class="row"><input id="announce" placeholder="Dinner’s ready!" maxlength="200"><button class="btn btn--solid" data-announce>Show</button></div>
    </section>
    <section class="block"><div class="block-h"><h2 class="serif">Status</h2></div>
      <ul class="status">
        <li><b>Plex</b> ${cfg.plex.status.ok ? `Connected · ${M.source === 'plex' && M.playing ? 'playing ' + esc(M.title) + ' on ' + esc(M.room) : 'idle'}` : esc(cfg.plex.status.error || 'Not set up')}</li>
        <li><b>Weather</b> ${W.live ? 'Live for ' + esc(W.place) + ' · updated ' + new Date(W.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Add your home address in Settings'}</li>
        <li><b>BART</b> ${S.bart && !S.bart.error ? 'Live · ' + (S.bart.stations || []).map(x => esc(x.name)).join(' + ') : esc((S.bart && S.bart.error) || 'Starting…')}</li>
        <li><b>Photos</b> ${cfg.icloud.set ? (cfg.icloud.status.ok ? esc(cfg.icloud.status.name || 'Shared album') + ' · ' + cfg.icloud.status.count + ' photos' : esc(cfg.icloud.status.error || 'Syncing…')) : 'Link your iCloud shared album in Photos'}</li>
        <li><b>Spotify</b> ${cfg.spotify.connected ? (cfg.spotify.status.ok ? 'Connected' : esc(cfg.spotify.status.error || 'Connected')) : 'Not connected · set it up in Music'}</li>
        <li><b>HomeKit</b> ${cfg.isMac ? (S.devices || []).filter(d => d.shortcut).length + ' of ' + (S.devices || []).length + ' devices linked to Shortcuts' : 'Shortcuts only run on the Mac mini'}</li>

      </ul>
    </section>
    <section class="block"><div class="block-h"><h2 class="serif">Open it anywhere</h2></div>
      <p class="intro">Bookmark these on your phone and PC. On iPhone, Share → Add to Home Screen makes this admin an app.</p>
      <ul class="links">${[base].concat(cfg.addresses.map(a => 'http://' + a + ':' + cfg.port)).filter((x, i, a) => a.indexOf(x) === i).map(u => `<li><code>${esc(u)}/</code> dashboard · <code>${esc(u)}/admin</code></li>`).join('')}</ul>
    </section>`;
}
function family() {
  const kids = (S.people || []).filter(p => S.stars && S.stars[p.id] != null);
  return listHTML('people', { intro: 'Colours and names here drive the whole dashboard. Turning “At home” off shows the status (or ETA) on the Today screen.' }) +
    (kids.length ? `<section class="block"><div class="block-h"><h2 class="serif">Stars</h2></div>${kids.map(p => `<label class="f f--inline"><span class="f-l">${esc(p.name)}</span><input type="number" data-stars="${esc(p.id)}" value="${S.stars[p.id]}"></label>`).join('')}</section>` : '');
}
let calUI = { busy: false, person: 'jd' };
function calFeeds() {
  const L = cfg.calendars || [], P = S.people || [];
  const whose = id => id === 'both' ? 'Both' : ((P.find(p => p.id === id) || {}).name || id);
  const ago2 = iso => { if (!iso) return ''; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' hr ago'; };
  return `<section class="block" id="cal-feeds"><div class="block-h"><h2 class="serif">Connected calendars</h2>${L.length ? '<button class="btn btn--s" data-calsync>Sync now</button>' : ''}</div>
    <p class="intro">Your real calendars, shown on the frame’s Calendar and Today tabs and available to the iMessage assistant. They update every 10 minutes and are read-only here: add or change events on your phone as usual.</p>
    ${L.length ? `<ul class="status">${L.map(f => `<li><b>${esc(f.name)}</b><span>${esc(whose(f.person))} · ${esc(f.host)} · ${f.status.ok ? f.status.count + ' events · synced ' + ago2(f.status.checked) : f.status.error ? '<span class="warn-t">' + esc(f.status.error) + '</span>' : esc(f.status.note || '')}
      <select data-calwho="${esc(f.id)}">${P.map(p => [p.id, p.name]).concat([['both', 'Both']]).map(([v, l]) => `<option value="${esc(v)}" ${f.person === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <button class="linkbtn small" data-caldel="${esc(f.id)}">remove</button></span></li>`).join('')}</ul>` : ''}
    <div class="cal-add">
      <div class="grid2"><label class="f"><span class="f-l">Name</span><input id="cal-name" placeholder="JD work" maxlength="40"></label>
      <label class="f"><span class="f-l">Whose</span><select id="cal-person">${P.map(p => [p.id, p.name]).concat([['both', 'Both (shared calendar)']]).map(([v, l]) => `<option value="${esc(v)}" ${calUI.person === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label></div>
      <label class="f f--wide"><span class="f-l">Calendar link</span><div class="row"><input id="cal-url" autocomplete="off" data-1p-ignore data-lpignore="true" placeholder="webcal://… or https://…/basic.ics"><button class="btn btn--solid" data-caladd ${calUI.busy ? 'disabled' : ''}>${calUI.busy ? 'Checking…' : 'Connect'}</button></div></label>
    </div>
    <details class="cal-help"><summary>Where to find the link</summary>
      <p><b>iCloud (iPhone):</b> Calendar app → <i>Calendars</i> at the bottom → tap the ⓘ next to the calendar → turn on <b>Public Calendar</b> → <b>Share Link…</b> → Copy. Do this for each calendar you want (Georgia does hers on her phone and sends you the link). Note: anyone who has a public link can see that calendar, so only share it here. You can turn it off later to cut it off.</p>
      <p><b>Google (work):</b> on a computer, open calendar.google.com → ⚙︎ Settings → under <i>Settings for my calendars</i> click your calendar → <b>Integrate calendar</b> → copy <b>Secret address in iCal format</b>. If that option is missing, your company has turned it off; ask IT, or share the work calendar’s free/busy with your personal Google or iCloud account instead.</p>
      <p>Add one link per calendar. Shared family calendars: pick “Both”.</p>
    </details></section>`;
}
function calendar() {
  const from = new Date(); from.setHours(0, 0, 0, 0);
  return calFeeds() + listHTML('events', { title: 'Added by hand', filter: e => !e.src && (showPast || new Date(e.end) >= from), sort: (a, b) => new Date(a.start) - new Date(b.start), limit: moreKeys.events ? 0 : 40,
    intro: `Times are in this device’s time zone. <button class="linkbtn" data-past>${showPast ? 'Hide past events' : 'Show past events'}</button> · <button class="linkbtn" data-clearpast>Delete past events</button>` });
}
function chores() {
  return `<div class="row wrap block-tools"><button class="btn" data-resetchores>Mark all chores not done</button></div>` +
    listHTML('chores', { sort: (a, b) => String(a.r).localeCompare(String(b.r)) || String(a.who).localeCompare(String(b.who)) }) + listHTML('routines');
}
function shopping() {
  return `<div class="row block-tools"><input id="quickadd" placeholder="Add an item…"><button class="btn btn--solid" data-quickadd>Add</button><button class="btn" data-cleardone>Clear checked</button></div>` +
    listHTML('groceries', { sort: (a, b) => a.done - b.done }) + listHTML('stores');
}
function photos() {
  const list = S.photos || [], demo = list.filter(p => !p.src).length;
  return `<section class="block"><div class="block-h"><h2 class="serif">Photos</h2><span class="muted">${list.length}</span></div>
    <p class="intro">These rotate on the Photos tab, the Today tile and the screensaver.</p>
    <div class="f f--wide"><span class="f-l">iCloud shared album</span>
      <span class="row"><input id="icloud-url" placeholder="Paste the album’s share link" value="${cfg.icloud.set ? '••• linked •••' : ''}"><button class="btn btn--solid" data-icloud>${cfg.icloud.set ? 'Sync now' : 'Link'}</button>${cfg.icloud.set ? '<button class="btn btn--s btn--danger" data-icloudoff>Unlink</button>' : ''}</span>
      <span class="muted small">${cfg.icloud.set ? (cfg.icloud.status.ok ? 'Synced ' + esc(cfg.icloud.status.name || '') + ' · ' + cfg.icloud.status.count + ' photos · new ones arrive within 20 minutes' : esc(cfg.icloud.status.error || 'Syncing…')) : 'iPhone: Photos → the shared album → People icon → turn on <b>Public Website</b> → Share Link. Paste it here.'}</span></div>
    <p class="intro">Or add pictures from this device (they’re resized before upload):</p>
    <div class="up">
      <label class="f"><span class="f-l">From</span><select id="up-from">${(S.people || []).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}<option value="family">Family</option></select></label>
      <label class="f"><span class="f-l">Place</span><input id="up-place" placeholder="Backyard"></label>
      <label class="btn btn--solid upbtn">Choose photos<input type="file" id="up-files" accept="image/*" multiple hidden></label>
      <span id="up-prog" class="muted"></span>
    </div>
    ${demo ? `<p class="intro">${demo} demo pictures are still in the rotation. <button class="linkbtn" data-nodemo>Remove demo photos</button></p>` : ''}
    <div class="pgrid">${list.map((p, i) => `<figure class="ph ${p.fav ? 'is-fav' : ''}"><img loading="lazy" src="${esc(photoUrl(p))}" alt="">
      <figcaption><input data-pmeta="${i}" data-pk="place" value="${esc(p.place || '')}" placeholder="Place"><input type="date" data-pmeta="${i}" data-pk="date" value="${esc(p.date || '')}">
      <span class="row"><button class="btn btn--s" data-pfav="${i}">${p.fav ? '★ Favourite' : '☆ Favourite'}</button><button class="btn btn--s btn--danger" data-pdel="${esc(p.id || p.seed)}">Delete</button></span></figcaption></figure>`).join('')}</div>
  </section>`;
}
// ------------------------------------------------------------------ Costs (Claude API)
let CST = null, cstLoading = false;
async function loadCosts() { if (cstLoading) return; cstLoading = true; try { CST = await call('/api/admin/costs'); } catch (e) { CST = { error: e.message }; } cstLoading = false; if (section === 'costs') rerenderSoon(); }
const money = v => !v ? '$0' : v < 0.995 ? (v * 100 < 0.1 ? '<0.1¢' : (v * 100).toFixed(v * 100 < 10 ? 1 : 0) + '¢') : '$' + v.toFixed(2);
const ktok = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);
function costs() {
  if (!CST) { loadCosts(); return '<section class="block"><p class="muted">Loading costs…</p></section>'; }
  if (CST.error) return `<section class="block"><p class="warn">${esc(CST.error)}</p></section>`;
  const C = CST, max = Math.max(0.0001, ...C.days.map(d => d.cost)), B = C.budget;
  const stat = (label, o, extra) => `<div class="cs-stat"><span class="f-l">${label}</span><b class="num">${money(o.cost)}</b><small>${o.calls} call${o.calls === 1 ? '' : 's'}${o.searches ? ' · ' + o.searches + ' search' + (o.searches === 1 ? '' : 'es') : ''}</small>${extra || ''}</div>`;
  const pct = B ? Math.min(100, C.month.cost / B * 100) : 0;
  const table = (title, rows) => `<div class="cs-tab"><h3>${title}</h3>${rows.length ? `<table class="cs-t">${rows.map(r => `<tr><td>${esc(r.name)}</td><td class="muted">${r.calls}</td><td class="muted">${ktok(r.inTok)} in · ${ktok(r.outTok)} out</td><td class="num"><b>${money(r.cost)}</b></td></tr>`).join('')}</table>` : '<p class="muted small">Nothing this month yet.</p>'}</div>`;
  const P = C.prices || {}, models = (C.models || []).map(m => m[0]);
  const wsCost = C.month.searches * (P.web_search || 0);
  return `<section class="block"><div class="block-h"><h2 class="serif">Claude API costs</h2><button class="btn btn--s" data-cstreload>Refresh</button></div>
      <p class="intro small">What Home HQ’s agents and iMessage assistant have spent on your Claude API key, worked out from the token counts Claude reports on every reply. ${C.since ? 'Tracking since ' + new Date(C.since).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + '.' : 'Tracking starts with the next message.'} The official bill is at <a href="https://console.anthropic.com/settings/usage" target="_blank" rel="noopener">console.anthropic.com → Usage</a>.</p>
      <div class="cs-stats">${stat('Today', C.today)}${stat('Last 7 days', C.week)}${stat('This month', C.month, `<small>on pace for ~${money(C.forecast)}</small>`)}${stat('Last month', C.lastMonth)}</div>
      ${B ? `<div class="cs-budget"><div class="cs-bar"><i style="width:${pct}%" class="${pct >= 100 ? 'is-over' : pct >= 80 ? 'is-warn' : ''}"></i></div><small>${money(C.month.cost)} of your ${money(B)} monthly budget (${Math.round(pct)}%)</small></div>` : ''}
    </section>
    <section class="block"><div class="block-h"><h2 class="serif">Last 30 days</h2><span class="muted">${money(C.days.reduce((a, d) => a + d.cost, 0))}</span></div>
      <div class="cs-chart">${C.days.map(d => `<div class="cs-col" title="${esc(d.date)}: ${money(d.cost)}, ${d.calls} calls"><i style="height:${d.cost ? Math.max(2, d.cost / max * 100) : 0}%"></i><span>${+d.date.slice(8) % 5 === 0 || d === C.days[C.days.length - 1] ? +d.date.slice(8) : ''}</span></div>`).join('')}</div>
    </section>
    <section class="block"><div class="block-h"><h2 class="serif">This month by…</h2></div>
      <div class="cs-tabs">${table('Agent', C.byAgent)}${table('Where it came from', C.byChannel)}${table('Model', C.byModel)}</div>
      ${C.month.searches ? `<p class="intro small">Web searches: ${C.month.searches} this month, ${money(wsCost)} of the total.</p>` : ''}
    </section>
    <section class="block"><div class="block-h"><h2 class="serif">Recent calls</h2><span class="muted">${C.all.calls} all time · ${money(C.all.cost)}</span></div>
      ${C.recent.length ? `<div class="cs-scroll"><table class="cs-t cs-t--recent"><tr><th>When</th><th>Agent</th><th>Via</th><th>Model</th><th>Tokens</th><th></th></tr>${C.recent.map(r => `<tr><td>${new Date(r.t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td><td>${esc(r.agentName || '—')}</td><td class="muted">${esc(r.ch || '')}</td><td class="muted">${esc(r.label)}</td><td class="muted">${ktok(r.in + r.cw + r.cr)} in · ${ktok(r.out)} out${r.ws ? ' · ' + r.ws + ' search' : ''}</td><td class="num"><b>${money(r.cost)}</b></td></tr>`).join('')}</table></div>` : '<p class="muted">No calls yet.</p>'}
    </section>
    <section class="block"><div class="block-h"><h2 class="serif">Budget &amp; prices</h2></div>
      <label class="f"><span class="f-l">Monthly budget (USD, 0 = none). JD gets a text at 80% and 100%.</span><div class="row"><input id="cs-budget" type="number" min="0" step="1" value="${B || ''}" placeholder="10"><button class="btn btn--solid" data-cstbudget>Save</button></div></label>
      <p class="intro small" style="margin-top:12px">Prices per million tokens, used for the estimates above. Change them if Anthropic changes its prices; past calls are re-priced too.</p>
      <table class="cs-t cs-prices"><tr><th>Model</th><th>Input $/M</th><th>Output $/M</th></tr>${models.map(m => `<tr><td>${esc(m)}</td><td><input type="number" step="0.01" min="0" data-cstin="${esc(m)}" value="${(P[m] || {}).in ?? ''}"></td><td><input type="number" step="0.01" min="0" data-cstout="${esc(m)}" value="${(P[m] || {}).out ?? ''}"></td></tr>`).join('')}
        <tr><td>Web search</td><td colspan="2"><input type="number" step="0.001" min="0" id="cs-ws" value="${P.web_search ?? ''}"> per search</td></tr></table>
      <div class="row wrap" style="margin-top:10px"><button class="btn btn--solid" data-cstprices>Save prices</button><button class="btn" data-cstreset>Reset to defaults</button></div>
    </section>`;
}
// ------------------------------------------------------------------ Agents studio
let AGS = null, agUI = { edit: null, chat: null, logs: {}, busy: false, open: {}, loading: false };
async function loadAgents() { if (agUI.loading) return; agUI.loading = true; try { AGS = await call('/api/admin/agents'); } catch (e) { AGS = { error: e.message }; } agUI.loading = false; if (section === 'agents') rerenderSoon(); }
const agName = id => { const a = AGS && AGS.agents.find(x => x.id === id); return a ? a.icon + ' ' + a.name : id; };
const modelShort = m => /haiku/.test(m) ? 'Haiku' : /opus/.test(m) ? 'Opus' : 'Sonnet';
const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' hr ago' : new Date(t).toLocaleDateString(); };
function agents() {
  if (!AGS) { loadAgents(); return '<section class="block"><p class="muted">Loading agents…</p></section>'; }
  if (AGS.error) return `<section class="block"><p class="warn">${esc(AGS.error)}</p></section>`;
  const A = AGS.agents, running = new Set(AGS.runs.filter(r => r.status === 'running').map(r => r.agent));
  const card = (a, depth) => `<div class="ag-card ${a.enabled ? '' : 'is-off'}" style="margin-left:${depth * 22}px">
      <div class="ag-top"><span class="ag-ico">${esc(a.icon)}</span><div class="ag-main"><b>${esc(a.name)}</b>${running.has(a.id) ? ' <span class="ag-live">working…</span>' : ''}<small>${esc(a.role)}</small>
      <span class="ag-meta">${modelShort(a.model)} · ${(a.tools || []).length} tools${(a.channels || []).includes('imessage') ? ' · answers iMessage' : ''}${(a.can || []).length ? ' · hands off to ' + a.can.map(agName).join(', ') : ''}${a.enabled ? '' : ' · off'}</span></div></div>
      <div class="row wrap"><button class="btn btn--s btn--solid" data-agchat="${esc(a.id)}">Chat</button><button class="btn btn--s" data-agedit="${esc(a.id)}">Edit</button><button class="btn btn--s" data-agsub="${esc(a.id)}">+ Sub-agent</button></div></div>`;
  const tree = (parent, depth) => A.filter(a => (a.parent || null) === parent || (parent === null && a.parent && !A.some(x => x.id === a.parent))).map(a => card(a, depth) + tree(a.id, depth + 1)).join('');
  return (AGS.hasKey ? '' : '<section class="block"><p class="warn">Add a Claude API key in Admin → iMessage first. Every agent uses it.</p></section>') +
    `<section class="block"><div class="block-h"><h2 class="serif">Your agents</h2><button class="btn btn--s btn--solid" data-agnew>+ New agent</button></div>
      <p class="intro">Agents share one memory and one activity log, and can hand work to the agents on their team (sub-agents report to the agent above them). The one marked “answers iMessage” gets your texts.</p>
      <div class="ag-tree">${tree(null, 0)}</div></section>` +
    (agUI.edit ? agEditor(agUI.edit) : '') + (agUI.chat ? agChat(agUI.chat) : '') + agSchedules() + agMemory() + agActivity();
}
const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function agSchedules() {
  const L = AGS.schedules || [], P = AGS.people || [], f = agUI.sched;
  const toName = d => d === 'frame' ? 'the wall frame' : d === 'both' ? 'JD & Georgia' : d === 'house' ? 'the house (both + frame)' : d === 'none' ? 'nobody (log only)' : ((P.find(p => p.id === d) || {}).name || d);
  const nextTxt = t => { if (!t) return ''; const d = new Date(t), today = new Date().toDateString() === d.toDateString(); return 'next ' + (today ? 'today' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
  const row = s => `<div class="ag-sch ${s.enabled ? '' : 'is-off'}"><div class="ag-sch-main"><b>${s.kind === 'task' ? '🗓️' : '⏰'} ${esc(s.title)}</b>
      <small>${esc(s.whenText)} → ${esc(toName(s.deliver))}${s.kind === 'task' ? ' · ' + esc(agName(s.agent)) : ''}${s.enabled && s.next ? ' · ' + nextTxt(s.next) : ''}${s.lastStatus === 'error' ? ' · <span class="warn-t">last run failed: ' + esc(s.lastError || '') + '</span>' : s.lastStatus === 'skipped' ? ' · last one skipped (Mac was off)' : ''}</small>
      <span class="ag-sch-p">${esc((s.prompt || '').slice(0, 200))}</span></div>
      <div class="row wrap"><button class="tog ${s.enabled ? 'is-on' : ''}" data-schon="${esc(s.id)}">${s.enabled ? 'On' : 'Off'}</button>
      <button class="btn btn--s" data-schrun="${esc(s.id)}">Run now</button><button class="btn btn--s" data-schedit="${esc(s.id)}">Edit</button><button class="btn btn--s btn--danger" data-schdel="${esc(s.id)}">Delete</button></div></div>`;
  const form = f ? `<div class="ag-schform" id="sch-form">
      <div class="grid2"><label class="f"><span class="f-l">Type</span><select id="sch-kind"><option value="reminder" ${f.kind !== 'task' ? 'selected' : ''}>Reminder (sends this text)</option><option value="task" ${f.kind === 'task' ? 'selected' : ''}>Job (an agent works it out and texts the answer)</option></select></label>
      <label class="f"><span class="f-l">Title</span><input id="sch-title" value="${esc(f.title || '')}" placeholder="Morning brief"></label></div>
      <label class="f f--wide"><span class="f-l">Message (reminder) or what the agent should do (job)</span><textarea id="sch-msg" rows="3" placeholder="Take the bins out  ·  or: weather, today’s calendar and the next trains, in a few lines">${esc(f.prompt || '')}</textarea></label>
      <div class="grid2"><label class="f"><span class="f-l">Repeat</span><select id="sch-rep">${[['once', 'Once'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekends', 'Weekends'], ['weekly', 'On these days…']].map(([v, l]) => `<option value="${v}" ${f.repeat === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f"><span class="f-l">Time</span><input id="sch-time" type="time" value="${esc(f.time || '07:30')}"></label></div>
      <div class="grid2"><label class="f"><span class="f-l">Date (for once)</span><input id="sch-date" type="date" value="${esc(f.date || '')}"></label>
      <label class="f"><span class="f-l">Send to</span><select id="sch-to">${P.map(p => [p.id, p.name]).concat([['house', 'House (texts both + frame)'], ['both', 'JD & Georgia'], ['frame', 'The wall frame'], ['none', 'Nobody (just log it)']]).map(([v, l]) => `<option value="${esc(v)}" ${f.to === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label></div>
      <div class="f-l">Days (for “On these days…”)</div>
      <div class="chips">${DAYN.map((n, i) => `<label class="chip ${(f.days || []).includes(i) ? 'is-on' : ''}"><input type="checkbox" data-schday="${i}" ${(f.days || []).includes(i) ? 'checked' : ''} style="display:none">${n}</label>`).join('')}</div>
      <label class="f"><span class="f-l">Agent that does the job (jobs only)</span><select id="sch-agent">${AGS.agents.map(a => `<option value="${esc(a.id)}" ${f.agent === a.id ? 'selected' : ''}>${esc(a.icon + ' ' + a.name)}${a.enabled ? '' : ' (off)'}</option>`).join('')}</select></label>
      <div class="row wrap" style="margin-top:10px"><button class="btn btn--solid" data-schsave>Save</button><button class="btn" data-schcancel>Cancel</button></div></div>` : '';
  return `<section class="block" id="ag-sched"><div class="block-h"><h2 class="serif">Reminders &amp; scheduled jobs</h2>${f ? '' : '<button class="btn btn--s btn--solid" data-schnew>+ New</button>'}</div>
    <p class="intro small">Reminders text a message at a set time. Jobs run an agent (for example a morning brief) and text you its answer. You can also set them by text: “remind me at 6 to call mom”, “every Sunday at 7pm text us the week ahead”. Texts go through iMessage, so it needs to be set up.</p>
    ${form}<div class="ag-schs">${L.map(row).join('') || '<p class="muted">None yet.</p>'}</div></section>`;
}
function agEditor(a) {
  const tools = new Set(a.tools || []), can = new Set(a.can || []), P = (AGS.settings && AGS.settings.plex) || {};
  return `<section class="block" id="ag-editor"><div class="block-h"><h2 class="serif">${a.id ? 'Edit ' + esc(a.name) : 'New agent'}</h2></div>
    <div class="grid2"><label class="f"><span class="f-l">Name</span><input id="ag-name" value="${esc(a.name || '')}" placeholder="Garden"></label>
    <label class="f"><span class="f-l">Icon (emoji)</span><input id="ag-icon" value="${esc(a.icon || '🤖')}" maxlength="4"></label></div>
    <label class="f f--wide"><span class="f-l">Job (one line, other agents see this)</span><input id="ag-role" value="${esc(a.role || '')}" placeholder="Keeps track of watering and plant care"></label>
    <label class="f f--wide"><span class="f-l">Instructions</span><textarea id="ag-instr" rows="6" placeholder="How it should work, what to check, what to avoid…">${esc(a.instructions || '')}</textarea></label>
    <div class="grid2"><label class="f"><span class="f-l">Model</span><select id="ag-model">${(AGS.models || []).map(([v, l]) => `<option value="${v}" ${a.model === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <label class="f"><span class="f-l">Reports to</span><select id="ag-parent"><option value="">Nobody (top level)</option>${AGS.agents.filter(x => x.id !== a.id).map(x => `<option value="${esc(x.id)}" ${a.parent === x.id ? 'selected' : ''}>${esc(x.icon + ' ' + x.name)}</option>`).join('')}</select></label></div>
    <label class="f f--check"><input type="checkbox" id="ag-imsg" ${(a.channels || []).includes('imessage') ? 'checked' : ''}><span class="f-l">Answers iMessage (only one agent can)</span></label>
    <label class="f f--check"><input type="checkbox" id="ag-on" ${a.enabled !== false ? 'checked' : ''}><span class="f-l">Switched on</span></label>
    <div class="f-l" style="margin-top:10px">Tools</div>
    ${AGS.catalog.map(g => `<details ${g.tools.some(t => tools.has(t.name)) ? 'open' : ''}><summary>${esc(g.group)} (${/Memory/.test(g.group) ? g.tools.length : g.tools.filter(t => tools.has(t.name)).length}/${g.tools.length})</summary><div class="ag-tools">${g.tools.map(t => `<label class="ag-tool"><input type="checkbox" data-agtool="${esc(t.name)}" ${tools.has(t.name) || /Memory/.test(g.group) ? 'checked' : ''} ${/Memory/.test(g.group) ? 'disabled' : ''}><span><b>${esc(t.name)}</b><small>${esc(t.description)}</small></span></label>`).join('')}</div></details>`).join('')}
    <div class="f-l" style="margin-top:10px">Can hand work to</div>
    <div class="chips">${AGS.agents.filter(x => x.id !== a.id).map(x => `<label class="chip ${can.has(x.id) ? 'is-on' : ''}"><input type="checkbox" data-agcan="${esc(x.id)}" ${can.has(x.id) ? 'checked' : ''} style="display:none">${esc(x.icon + ' ' + x.name)}</label>`).join('')}</div>
    ${a.id === 'plex' ? `<div class="f-l" style="margin-top:12px">Plex folders on the Mac (e.g. a NAS share under /Volumes)</div>
      <label class="f f--wide"><span class="f-l">Movies folder Plex watches</span><input id="pl-movies" value="${esc(P.moviesPath || '')}" placeholder="/Volumes/Media/Movies"></label>
      <label class="f f--wide"><span class="f-l">Inbox (drop movies you own here to be filed)</span><input id="pl-inbox" value="${esc(P.inboxPath || '')}" placeholder="/Volumes/Media/Inbox"></label>
      ${AGS.plexConnected ? '' : '<p class="intro small">Plex itself isn’t connected yet: add it in Admin → Settings → Plex.</p>'}` : ''}
    <div class="row wrap" style="margin-top:12px"><button class="btn btn--solid" data-agsave>Save</button><button class="btn" data-agcancel>Cancel</button>${a.id && !a.builtin ? '<button class="btn btn--danger" data-agdel>Delete</button>' : ''}</div>
  </section>`;
}
function agChat(id) {
  const a = AGS.agents.find(x => x.id === id); if (!a) return '';
  const log = agUI.logs[id] || [];
  return `<section class="block" id="ag-chat"><div class="block-h"><h2 class="serif">Chat with ${esc(a.icon + ' ' + a.name)}</h2><button class="btn btn--s" data-agclear>New chat</button></div>
    <div class="ag-log">${log.map(m => `<div class="ag-msg ag-msg--${m.role}">${esc(m.text)}${m.steps && m.steps.length ? `<small>used ${m.steps.map(s => esc(s.tool)).join(', ')}</small>` : ''}</div>`).join('') || '<p class="muted small">Ask it something, or give it a job.</p>'}
    ${agUI.busy ? '<div class="ag-msg ag-msg--agent"><i>thinking…</i></div>' : ''}</div>
    <div class="row"><input id="ag-q" placeholder="Message ${esc(a.name)}" autocomplete="off"><button class="btn btn--solid" data-agsend ${agUI.busy ? 'disabled' : ''}>Send</button></div></section>`;
}
function agMemory() {
  const M = AGS.memory || [];
  return `<section class="block"><div class="block-h"><h2 class="serif">Shared memory</h2><span class="muted">${M.length}</span></div>
    <p class="intro small">Facts every agent sees. Agents add to it with “remember”; you can too. Also saved as ~/HomeHQ/data/agents/CONTEXT.md.</p>
    <div class="row"><input id="ag-mem" placeholder="Georgia prefers oat milk"><button class="btn" data-agmemadd>Add</button></div>
    <ul class="status">${M.slice(0, 60).map(m => `<li><b>${esc(agName(m.by) || m.by)}</b><span>${esc(m.text)} <button class="linkbtn small" data-agmemdel="${esc(m.id)}">remove</button></span></li>`).join('') || '<li><span class="muted">Nothing yet.</span></li>'}</ul></section>`;
}
function agActivity() {
  const R = AGS.runs || [], byParent = {};
  R.forEach(r => { (byParent[r.parent || ''] = byParent[r.parent || ''] || []).push(r); });
  const row = (r, depth) => `<div class="ag-run ${r.status}" style="margin-left:${depth * 18}px"><button class="ag-run-h" data-agrun="${esc(r.id)}"><span>${esc(agName(r.agent))}</span><small>${esc(r.channel)}${r.who ? ' · ' + esc(person(r.who).name) : ''} · ${r.status === 'running' ? 'working…' : ago(r.at)}${r.ms ? ' · ' + (r.ms / 1000).toFixed(1) + 's' : ''}</small></button>
    <div class="ag-run-io"><span>“${esc((r.input || '').slice(0, 140))}”</span>${r.output || r.error ? `<b>→ ${esc((r.output || r.error || '').slice(0, 220))}</b>` : ''}</div>
    ${agUI.open[r.id] ? `<ol class="ag-steps">${(r.steps || []).map(s => `<li><b>${esc(s.tool)}</b> <code>${esc(s.input || '')}</code><br><small>${esc(s.result || '…')}</small></li>`).join('') || '<li class="muted">No tools used.</li>'}</ol>` : (r.steps || []).length ? `<small class="muted">${r.steps.length} step${r.steps.length > 1 ? 's' : ''}: ${r.steps.map(s => esc(s.tool)).join(', ')} · tap to expand</small>` : ''}
    ${(byParent[r.id] || []).map(c => row(c, depth + 1)).join('')}</div>`;
  return `<section class="block"><div class="block-h"><h2 class="serif">Activity</h2><span class="muted">live</span></div>
    <div class="ag-runs">${(byParent[''] || []).slice(0, 40).map(r => row(r, 0)).join('') || '<p class="muted">Nothing yet. Chat with an agent or text the house.</p>'}</div></section>`;
}
function agentRunEvent(run) {
  if (!AGS) return;
  const i = AGS.runs.findIndex(r => r.id === run.id);
  if (i >= 0) AGS.runs[i] = run; else AGS.runs.unshift(run);
  if (section === 'agents') rerenderSoon();
}
let askUI = { q: '', a: '', busy: false };
function assistant() {
  const A = cfg.assistant || { allow: [], status: {}, models: [] }, st = A.status || {}, ps = S.people || [];
  const handleFor = pid => ((A.allow || []).find(x => x.person === pid) || {}).handle || '';
  const live = st.state === 'listening' && A.enabled;
  const step = (n, done, title, body) => `<section class="block"><div class="block-h"><h2 class="serif">${n}. ${title}</h2><span class="muted">${done ? '✓ done' : ''}</span></div>${body}</section>`;
  return `<section class="block"><div class="block-h"><h2 class="serif">Text your house</h2><span class="muted">${live ? 'listening' : A.enabled ? (st.state === 'error' ? 'needs attention' : 'starting') : 'off'}</span></div>
      <p class="intro">Text the Mac mini’s iMessage from your phone: ask what’s on the shopping list, send a photo of something you’re out of, “turn the lamp warm white”, “next BART?”, “play some jazz”, or any question. It answers using Claude.</p>
      ${st.state === 'error' ? `<p class="warn">${esc(st.error || '')}</p>` : ''}${st.lastError ? `<p class="warn small">Last problem: ${esc(st.lastError)}</p>` : ''}
      ${A.usage && A.usage.messages ? `<p class="intro small">${A.usage.messages} messages answered since the last restart.</p>` : ''}
    </section>` +
    step(1, A.hasKey, 'Claude API key', `<p class="intro">The assistant uses Claude through the Claude API, which is billed separately from a Claude subscription (pay as you go). Typical texts cost about a cent each on Sonnet, a fraction of that on Haiku.</p>
      <ol class="steps"><li>Go to <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com → API keys</a>, sign in, add a few dollars of credit under Billing.</li><li>Create a key, copy it, paste it here.</li></ol>
      <div class="row"><input id="ai-key" type="password" autocomplete="new-password" data-1p-ignore data-lpignore="true" placeholder="${A.hasKey ? '•••••••• (saved)' : 'sk-ant-…'}"><button class="btn btn--solid" data-aikey>Save</button></div>
      <label class="f" style="margin-top:10px"><span class="f-l">Model</span><select id="ai-model">${(A.models || []).map(([v, l]) => `<option value="${v}" ${A.model === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`) +
    step(2, (A.allow || []).length > 0, 'Who can text it', `<p class="intro">Only these numbers or Apple ID emails get answers. Everyone else is ignored.</p>
      ${ps.map(p => `<label class="f"><span class="f-l">${esc(p.name)}’s iMessage (phone or email)</span><input data-aiallow="${esc(p.id)}" inputmode="tel" value="${esc(handleFor(p.id))}" placeholder="+1 510 555 0123"></label>`).join('')}
      <button class="btn btn--solid" data-aiallowsave>Save</button>`) +
    step(3, st.state === 'listening', 'Let Home HQ read Messages', `<p class="intro">macOS keeps Messages private, so give the Home HQ engine permission once, on the Mac mini itself:</p>
      <ol class="steps"><li>Open <b>System Settings → Privacy &amp; Security → Full Disk Access</b>.</li><li>Click <b>+</b>, press <b>⌘ Shift G</b>, paste the path below, press Return, then <b>Open</b>. Make sure its switch is on.</li><li>Tap <b>Restart Home HQ</b> here.</li></ol>
      <div class="row"><code class="token sel">${esc(st.node || '~/HomeHQ/node/bin/node')}</code></div>
      <div class="row wrap" style="margin-top:8px"><button class="btn" data-restart>Restart Home HQ</button></div>
      <p class="intro small">The first reply also makes macOS ask whether Home HQ may control Messages. Click <b>OK</b> on the Mac.</p>`) +
    step(4, live, 'Turn it on', `<label class="f f--check"><input type="checkbox" data-aion ${A.enabled ? 'checked' : ''}><span class="f-l">Answer texts</span></label>
      <div class="row wrap">${ps.filter(p => handleFor(p.id)).map(p => `<button class="btn btn--s" data-aitest="${esc(handleFor(p.id))}">Send ${esc(p.name)} a hello</button>`).join('')}</div>`) +
    `<section class="block"><div class="block-h"><h2 class="serif">Try it here</h2></div>
      <p class="intro small">Talks to the same assistant without iMessage, handy for testing.</p>
      <div class="row"><input id="ai-q" placeholder="What’s on the shopping list?" value="${esc(askUI.q)}"><button class="btn btn--solid" data-aiask ${askUI.busy ? 'disabled' : ''}>${askUI.busy ? '…' : 'Ask'}</button></div>
      ${askUI.a ? `<pre class="code" style="white-space:pre-wrap">${esc(askUI.a)}</pre>` : ''}
    </section>`;
}
let tvUI = { scan: null, pair: null, busy: '' };
function goveeBlock() {
  const G = cfg.govee || { set: false, status: {} }, lights = (S.devices || []).filter(d => d.source === 'govee');
  return `<section class="block"><div class="block-h"><h2 class="serif">Govee lights</h2><span class="muted">${G.set ? (G.status && G.status.ok === false ? 'problem' : lights.length + (lights.length === 1 ? ' light' : ' lights')) : 'off'}</span></div>
      <p class="intro">Controls everything in your Govee Home app (on/off, brightness, colour, whites and Govee scenes), including lights that aren’t in Apple Home.</p>
      ${G.set ? '' : `<ol class="steps"><li>Open the <b>Govee Home</b> app → <b>Profile</b> → ⚙️ <b>Settings</b> → <b>Apply for API Key</b>.</li><li>Govee emails you the key. Paste it below and tap Save. Your lights appear on the frame and phones straight away.</li></ol>`}
      ${G.status && G.status.ok === false ? `<p class="warn">${esc(G.status.error || 'Govee didn’t answer')}</p>` : ''}
      ${lights.length ? '<ul class="status">' + lights.map(d => `<li><b>${esc(d.name)}</b> ${d.online === false ? 'offline' : d.on ? 'on · ' + (d.level || 100) + '%' : 'off'}</li>`).join('') + '</ul>' : ''}
      <div class="row"><input id="gv-key" type="password" autocomplete="new-password" data-1p-ignore data-lpignore="true" placeholder="${G.set ? '•••••••• (saved)' : 'Govee API key'}"><button class="btn btn--solid" data-gvsave>Save</button></div>
      ${G.set ? '<div class="row wrap" style="margin-top:8px"><button class="btn btn--s" data-gvfind>Look for new lights</button><button class="btn btn--s" data-gvoff>Remove key</button></div>' : ''}
      ${G.set ? '<p class="intro small">Rename a light or move it to another room in Devices below.</p>' : ''}
    </section>`;
}
function elgatoBlock() {
  const E = cfg.elgato || { hosts: [], lights: [] }, lights = (S.devices || []).filter(d => d.source === 'elgato');
  return `<section class="block"><div class="block-h"><h2 class="serif">Elgato Key Lights</h2><span class="muted">${lights.length ? lights.length + (lights.length === 1 ? ' light' : ' lights') : E.busy ? 'searching…' : 'none found'}</span></div>
      <p class="intro">Found automatically on your Wi-Fi (no account needed): on/off, brightness and warm-to-cool white, in the <b>Free Roam</b> section. Set them up on Wi-Fi with Elgato’s Control Center app first.</p>
      ${E.error && !lights.length ? `<p class="warn small">${esc(E.error)}</p>` : ''}
      ${lights.length ? '<ul class="status">' + lights.map(d => `<li><b>${esc(d.name)}</b><span>${d.online === false ? 'offline' : d.on ? 'on · ' + (d.level || 100) + '% · ' + (d.kelvin || '') + 'K' : 'off'} <span class="muted small">${esc((d.el && d.el.host) || '')}</span></span></li>`).join('') + '</ul>' : ''}
      <div class="row wrap"><button class="btn btn--s btn--solid" data-elfind>Look for Key Lights</button></div>
      <p class="intro small" style="margin-top:10px">Not found? Add one by its IP address (shown in Control Center → the light’s settings):</p>
      <div class="row"><input id="el-ip" placeholder="192.168.0.50" autocomplete="off"><button class="btn" data-eladd>Add</button></div>
      ${(E.hosts || []).length ? '<p class="intro small">Added by IP: ' + E.hosts.map(h => `${esc(h)} <button class="linkbtn small" data-elrm="${esc(h)}">remove</button>`).join(' · ') + '</p>' : ''}
      <p class="intro small">Rename a light or move it to another room in Devices below.</p>
    </section>`;
}
function camerasBlock() {
  const st = cfg.cameraSetup || { state: 'missing' }, L = cfg.cameraList || [];
  const ready = st.state === 'ready';
  return `<section class="block" id="cams"><div class="block-h"><h2 class="serif">Cameras</h2><span class="muted">${L.length ? L.length + (L.length === 1 ? ' camera' : ' cameras') : 'none'}</span></div>
      <p class="intro">Live video from Tapo (and other RTSP) cameras on your Wi-Fi, on the frame’s Home tab and the phone app’s Home screen. The Mac reads the camera directly; only home screens and signed-in phones can watch.</p>
      ${ready ? '' : `<div class="row wrap"><button class="btn btn--solid" data-camsetup ${st.state === 'installing' ? 'disabled' : ''}>${st.state === 'installing' ? esc(st.step || 'Setting up…') : 'Set up video (one-time, ~45 MB)'}</button></div>
        ${st.error ? `<p class="warn small">${esc(st.error)}</p>` : '<p class="intro small">Downloads ffmpeg, the video tool the Mac uses to read the camera (checked against its published checksum).</p>'}`}
      ${L.length ? '<ul class="status">' + L.map(c => `<li><b>${esc(c.name)}</b><span>${esc(c.host)} · ${c.quality === 'hd' ? 'HD' : 'Standard'} <button class="linkbtn small" data-camrm="${esc(c.id)}">remove</button></span></li>`).join('') + '</ul>' : ''}
      ${ready ? `<details ${L.length ? '' : 'open'}><summary class="f-l" style="cursor:pointer">Add a camera</summary>
        <ol class="steps"><li>In the <b>Tapo</b> app: tap the camera → ⚙︎ → <b>Advanced Settings</b> → <b>Camera Account</b>, and create a user name and password (this is separate from your TP-Link login).</li>
        <li>Still in its settings, open <b>Device Info</b> and note the <b>IP address</b>. (Reserving that address in your router stops it changing.)</li></ol>
        <div class="grid2"><label class="f"><span class="f-l">Name</span><input id="cam-name" placeholder="Front door" maxlength="30"></label>
        <label class="f"><span class="f-l">IP address</span><input id="cam-host" placeholder="192.168.0.60" autocomplete="off"></label></div>
        <div class="grid2"><label class="f"><span class="f-l">Camera Account user name</span><input id="cam-user" autocomplete="off" data-1p-ignore data-lpignore="true"></label>
        <label class="f"><span class="f-l">Camera Account password</span><input id="cam-pass" type="password" autocomplete="new-password" data-1p-ignore data-lpignore="true"></label></div>
        <label class="f"><span class="f-l">Live quality</span><select id="cam-q"><option value="sd">Standard (smooth on the frame)</option><option value="hd">HD (sharper, more for the frame to handle)</option></select></label>
        <div class="row" style="margin-top:8px"><button class="btn btn--solid" data-camadd>Test &amp; add</button></div></details>` : ''}
    </section>`;
}
function tvBlock() {
  const T = cfg.tv || { setup: { state: 'missing' } }, live = S.tv || {}, st = T.setup || {};
  let body = '';
  if (st.state === 'missing') body = `<p class="intro">The Mac mini can work your Apple TV like the Siri remote: wake and sleep it, arrows and select, play/pause, volume, open apps, and show what’s playing.</p>
      <p class="intro small">Setup downloads a private copy of Python and the open-source <a href="https://pyatv.dev" target="_blank" rel="noopener">pyatv</a> remote (about 60 MB) into ~/HomeHQ/data. Nothing else on the Mac changes.</p>
      <button class="btn btn--solid" data-tvinstall>Set up Apple TV control</button>`;
  else if (st.state === 'installing') body = `<p class="intro"><b>Setting up…</b> ${esc(st.step || '')}</p><p class="intro small">This takes a minute or two. You can leave this page.</p>`;
  else if (st.state === 'error') body = `<p class="warn">${esc(st.error || 'Setup failed')}</p><button class="btn btn--solid" data-tvinstall>Try again</button>`;
  else if (!T.paired) {
    const P = tvUI.pair;
    if (P && P.needsPin) body = `<p class="intro"><b>Step ${P.protocol === 'AirPlay' ? '2' : '1'} of 2.</b> A code is showing on your TV. Type it here:</p>
      <div class="row"><input id="tv-pin" inputmode="numeric" maxlength="8" placeholder="Code on the TV" autocomplete="one-time-code"><button class="btn btn--solid" data-tvpin>Pair</button></div>
      <button class="btn btn--ghost" data-tvcancel>Cancel</button>`;
    else body = `<p class="intro">Make sure the Apple TV is on, then find it on your Wi-Fi. Pairing asks for two short codes shown on the TV (one for the remote, one for what’s playing).</p>
      <button class="btn btn--solid" data-tvscan ${tvUI.busy ? 'disabled' : ''}>${tvUI.busy === 'scan' ? 'Looking…' : 'Find Apple TVs'}</button>
      ${tvUI.scan ? (tvUI.scan.length ? '<div class="items">' + tvUI.scan.map(x => `<div class="item"><div class="item-h"><span class="item-sum"><b>${esc(x.name)}</b><small>${esc(x.model || 'Apple TV')} · ${esc(x.address)}</small></span><button class="btn btn--s btn--solid" data-tvpair="${esc(x.id)}" data-name="${esc(x.name)}">Pair</button></div></div>`).join('') + '</div>'
        : '<p class="warn">No Apple TV found. Check it’s on and on the same Wi-Fi as the Mac mini.</p>') : ''}`;
  } else body = `<ul class="status"><li><b>${esc(T.name || 'Apple TV')}</b> ${live.connected ? 'connected' + (live.power ? ' · ' + (live.power === 'on' ? 'awake' : 'asleep') : '') : esc(live.error || 'connecting…')}</li>
      ${live.app ? `<li><b>App</b> ${esc(live.app.name || '')}</li>` : ''}${live.playing && live.playing.title ? `<li><b>Playing</b> ${esc(live.playing.title)}${live.playing.artist ? ' · ' + esc(live.playing.artist) : ''}</li>` : ''}</ul>
      <div class="row wrap"><button class="btn btn--s" data-tvreconnect>Reconnect</button><button class="btn btn--s btn--danger" data-tvforget>Unpair</button></div>`;
  return `<section class="block"><div class="block-h"><h2 class="serif">Apple TV</h2><span class="muted">${T.paired ? (live.connected ? 'on' : 'offline') : st.state === 'ready' ? 'not paired' : 'off'}</span></div>${body}</section>`;
}
function home() {
  const linked = (S.devices || []).filter(d => d.shortcut).length;
  const C = S.climate || {};
  if (cfg.tv && cfg.tv.setup && cfg.tv.setup.state === 'installing') setTimeout(async () => { if (section !== 'home') return; cfg = await call('/api/admin/config'); rerenderSoon(); }, 3000);
  return goveeBlock() + elgatoBlock() + camerasBlock() + tvBlock() + `<section class="block guide">
      <div class="block-h"><h2 class="serif">How HomeKit control works</h2><span class="muted">${linked}/${(S.devices || []).length} linked</span></div>
      <ol>
        <li>On the Mac mini, open <b>Shortcuts</b> and make one shortcut per light (e.g. “Kitchen Pendants”). Its first action receives <b>Text</b> input.</li>
        <li>Add <b>If</b> <i>Shortcut Input</i> <b>is</b> 0 → <b>Control Home</b>: turn the light off. <b>Otherwise</b> → <b>Control Home</b>: set brightness to <i>Shortcut Input</i>.</li>
        <li>Locks get <code>lock</code>/<code>unlock</code>, garages <code>open</code>/<code>close</code>, blinds 0–100, scenes their id. A scene shortcut can just run a Home scene.</li>
        <li>Type the shortcut’s exact name below and press <b>Test</b>. The dashboard runs it every time that device changes, from the frame, this page, or iMessage.</li>
      </ol>
      ${cfg.isMac ? '' : '<p class="warn">This server isn’t running on a Mac, so shortcuts are logged but not run.</p>'}
    </section>` +
    listHTML('devices', { intro: 'Tap the pill to switch a device. Tap the name to rename it, move it, or link it to a Shortcut.' }) +
    listHTML('scenes') + listHTML('rooms') +
    `<section class="block"><div class="block-h"><h2 class="serif">Climate</h2></div>
      <div class="grid2"><label class="f"><span class="f-l">Inside now °</span><input type="number" step="0.5" data-clim="current" value="${C.current ?? ''}"></label>
      <label class="f"><span class="f-l">Set to °</span><input type="number" step="0.5" data-clim="set" value="${C.set ?? ''}"></label>
      <label class="f"><span class="f-l">Humidity %</span><input type="number" data-clim="humidity" value="${C.humidity ?? ''}"></label>
      <label class="f"><span class="f-l">Mode</span><select data-clim="mode">${['heat', 'cool', 'auto', 'off'].map(m => `<option ${C.mode === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label></div>
      <label class="f f--wide"><span class="f-l">Thermostat Shortcut (gets “heat 21.5”)</span><span class="row"><input data-setting="climateShortcut" list="shortcut-list" value="${esc(S.settings.climateShortcut || '')}"></span></label>
    </section>`;
}
function settings() {
  const st = S.settings || {}, P = cfg.plex, TT = cfg.tomtom || { set: false, status: {} };
  return `<section class="block"><div class="block-h"><h2 class="serif">Dashboard</h2></div>
      <label class="f f--wide"><span class="f-l">Name</span><input data-setting="title" value="${esc(st.title || 'Home HQ')}"></label>
      <div class="f f--wide"><span class="f-l">Tabs on the frame</span><div class="chips">${VIEWS.map(([v, l]) => `<button class="chip ${(st.hiddenViews || []).includes(v) ? '' : 'is-on'}" data-view="${v}">${l}</button>`).join('')}</div></div>
    </section>
    <section class="block"><div class="block-h"><h2 class="serif">Home address</h2></div>
      <p class="intro">${st.address ? '<b>' + esc(st.address) + '</b><br>' : ''}Used for the weather, the Map tab, and walking/driving times to BART.</p>
      ${S.commute && S.commute.stations ? '<ul class="status">' + S.commute.stations.map(x => `<li><b>${esc(x.name.replace('El Cerrito ', ''))}</b> walk ${x.walk ? x.walk.min + ' min · ' + x.walk.mi + ' mi' : '–'} · drive ${x.drive ? x.drive.min + ' min · ' + x.drive.mi + ' mi' + (x.drive.live ? ' (live traffic)' : '') : '–'}</li>`).join('') + '</ul>' : ''}
      <div class="row"><input id="addr-q" placeholder="Street address, city" value=""><button class="btn" data-addr>Search</button></div>
      <div id="addr-res" class="chips"></div>
      <label class="f"><span class="f-l">Units</span><select data-setting="units"><option value="fahrenheit" ${st.units !== 'celsius' ? 'selected' : ''}>°F</option><option value="celsius" ${st.units === 'celsius' ? 'selected' : ''}>°C</option></select></label>
    </section>
    <section class="block"><div class="block-h"><h2 class="serif">Live traffic</h2><span class="muted">${TT.set ? (TT.status.ok === false ? 'problem' : 'on') : 'off'}</span></div>
      <p class="intro">A free TomTom key adds current traffic to the BART drive times, and lets the Map tab show traffic on the roads and along your route. The key stays on the Mac mini.</p>
      <ol class="steps"><li>Sign up free at <a href="https://developer.tomtom.com" target="_blank" rel="noopener">developer.tomtom.com</a>.</li><li>Open <b>Dashboard → Keys</b> and copy the key it made for you.</li><li>Paste it below and tap Save.</li></ol>
      ${TT.status && TT.status.ok === false ? `<p class="warn">${esc(TT.status.error || 'TomTom didn’t answer')}</p>` : ''}
      <div class="row"><input id="tt-key" type="password" autocomplete="new-password" data-1p-ignore data-lpignore="true" placeholder="${TT.set ? '•••••••• (saved)' : 'TomTom API key'}"><button class="btn btn--solid" data-ttsave>Save</button>${TT.set ? '<button class="btn" data-ttoff>Remove</button>' : ''}</div>
    </section>
    <section class="block"><div class="block-h"><h2 class="serif">Plex</h2><span class="muted">${P.status.ok ? 'connected' : 'off'}</span></div>
      <p class="intro">Shows what’s playing on the Home tab, and lets you (or the agent) rescan libraries. Your Plex token: Plex Web → any item → ⋯ → Get Info → View XML, copy <code>X-Plex-Token</code> from the address bar.</p>
      <label class="f f--wide"><span class="f-l">Server address</span><input id="plex-url" placeholder="http://192.168.1.20:32400" value="${esc(P.url)}"></label>
      <label class="f f--wide"><span class="f-l">Token ${P.hasToken ? '(saved)' : ''}</span><input id="plex-token" type="password" placeholder="${P.hasToken ? '••••••••' : 'X-Plex-Token'}"></label>
      <div class="row wrap"><button class="btn btn--solid" data-plexsave>Save + test</button><button class="btn" data-plexscan>Scan all libraries</button></div>
      <div id="plex-out" class="muted"></div>
    </section>
    <section class="block"><div class="block-h"><h2 class="serif">Security</h2></div>
      <div class="row"><input id="newpin" type="password" inputmode="numeric" placeholder="New admin PIN (4–12 digits)"><button class="btn" data-pin>Change PIN</button></div>
      <p class="intro">Agent / iMessage access token. Anything holding it can control the house, so keep it on the Mac mini.</p>
      <div class="row"><code class="token" id="token">${esc(cfg.apiToken)}</code><button class="btn btn--s" data-copy>Copy</button><button class="btn btn--s" data-rotate>New token</button></div>
      <pre class="code">curl -s -H "Authorization: Bearer $HOMEHQ_TOKEN" http://localhost:${cfg.port}/api/agent/summary</pre>
      <div class="row wrap"><button class="btn" data-logoutall>Sign out every device (${cfg.sessions})</button><button class="btn" data-logout>Sign out here</button></div>
    </section>
    <section class="block"><div class="block-h"><h2 class="serif">Data</h2></div>
      <div class="row wrap"><a class="btn" href="/api/admin/export">Download backup</a>
      <button class="btn btn--danger" data-reset="clear">Start fresh (clear demo)</button><button class="btn" data-reset="demo">Restore demo household</button></div>
      <p class="intro">The Mac mini also keeps a daily copy for three weeks in <code>~/HomeHQ/data/backups</code>.</p>
      <details><summary>Edit raw data</summary>
        <div class="row"><select id="raw-key">${Object.keys(S).sort().map(k => `<option>${k}</option>`).join('')}</select><button class="btn btn--s" data-rawload>Load</button><button class="btn btn--s btn--solid" data-rawsave>Save</button></div>
        <textarea id="raw" rows="14" spellcheck="false"></textarea>
      </details>
    </section>
    <section class="block"><div class="block-h"><h2 class="serif">Recent Shortcut runs</h2></div>
      <ul class="status">${cfg.shortcutLog.map(l => `<li><b>${l.ok ? '✓' : '✕'} ${esc(l.name)}</b> ${esc(l.input)} · ${new Date(l.at).toLocaleTimeString()}${l.error ? ' · ' + esc(l.error) : ''}</li>`).join('') || '<li class="muted">None yet</li>'}</ul>
    </section>`;
}
function music() {
  const sp = cfg.spotify, M = S.music || {};
  return `<section class="block"><div class="block-h"><h2 class="serif">Spotify</h2><span class="muted">${sp.connected ? 'connected' : 'off'}</span></div>
    ${sp.connected ? `<p class="intro">${M.title ? 'Now playing <b>' + esc(M.title) + '</b> · ' + esc(M.artist) + ' on ' + esc((M.device || {}).name || '?') : 'Connected. Nothing playing right now.'}</p>
      <p class="intro">${(M.devices || []).length ? 'Speakers Spotify can see: ' + M.devices.map(d => esc(d.name)).join(', ') : 'No speakers visible yet. Open Spotify on a speaker, phone or the Mac mini.'}</p>
      ${sp.status.ok ? '' : '<p class="warn">' + esc(sp.status.error || '') + '</p>'}
      <div class="row wrap"><a class="btn" href="/api/spotify/login">Reconnect</a><button class="btn btn--danger" data-spoff>Disconnect</button></div>`
    : `<ol class="steps">
        <li>Go to <a href="https://developer.spotify.com/dashboard" target="_blank">developer.spotify.com/dashboard</a>, sign in, and click <b>Create app</b>.</li>
        <li>Name it “Home HQ”. For <b>Redirect URI</b> paste:<br><code class="sel">${esc(sp.redirect)}</code></li>
        <li>Tick <b>Web API</b>, agree, save. Open the app's <b>Settings</b> and copy the <b>Client ID</b> and <b>Client secret</b> below.</li>
        <li>Press <b>Connect Spotify</b> and allow access. Playback control needs Spotify Premium.</li>
      </ol>
      ${/^http:\/\/(?!127\.0\.0\.1)/.test(sp.redirect) ? '<p class="warn">Spotify only accepts https addresses. Open this page at <b>https://admin.sabadorks.com</b> (or http://127.0.0.1:' + cfg.port + ' on the Mac mini) to connect.</p>' : ''}
      <label class="f f--wide"><span class="f-l">Client ID</span><input id="sp-id" value="${esc(sp.clientId)}" autocomplete="off"></label>
      <label class="f f--wide"><span class="f-l">Client secret ${sp.hasSecret ? '(saved)' : ''}</span><input id="sp-secret" type="password" placeholder="${sp.hasSecret ? '••••••••' : ''}" autocomplete="off"></label>
      <div class="row wrap"><button class="btn btn--solid" data-spsave>Save + Connect Spotify</button></div>`}
  </section>`;
}
let showPast = false; const moreKeys = {};
const RENDER = { overview, family, calendar, chores, shopping, photos, music, home, assistant, agents, costs, settings };

// ------------------------------------------------------------------ shell
function render() {
  deferred = false;
  const y = window.scrollY;
  $('#app').className = '';
  $('#app').innerHTML = `
    <header class="top"><a class="brand serif" href="#overview">${esc((S.settings && S.settings.title) || 'Home HQ')} <i>admin</i></a>
      <a class="btn btn--s" href="${DASH}" target="_blank">Dashboard ↗</a></header>
    <nav class="tabs">${SECTIONS.map(([k, l]) => `<a href="#${k}" class="${k === section ? 'is-on' : ''}">${l}</a>`).join('')}</nav>
    <main class="main">${RENDER[section]()}</main>
    <datalist id="shortcut-list">${shortcuts.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
    <div id="flash" class="flash"></div>`;
  window.scrollTo(0, y);
}
function rerenderSoon() {
  const a = document.activeElement;
  if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && $('#app').contains(a)) { deferred = true; return; }
  render();
}
document.addEventListener('focusout', () => setTimeout(() => { if (deferred) rerenderSoon(); }, 300));

function itemAt(el) { const it = el.closest('.item'); return it ? { key: it.dataset.key, i: +it.dataset.i, x: S[it.dataset.key][+it.dataset.i] } : null; }

document.addEventListener('input', e => {
  const t = e.target;
  if (t.matches('[data-ssv]')) { t.nextElementSibling.textContent = +t.value ? t.value + '%' : 'Off'; }
});
document.addEventListener('change', async e => {
  const t = e.target, ctx = itemAt(t);
  if (t.dataset && (t.dataset.agcan || t.dataset.schday)) { t.parentNode.classList.toggle('is-on', t.checked); return; }
  if (t.dataset && t.dataset.calwho) { try { cfg.calendars = await call('/api/admin/calendars/update', { method: 'POST', body: { id: t.dataset.calwho, person: t.value } }); flash('Saved'); } catch (e2) { flash(e2.message, true); } return; }
  if (t.id === 'ai-model') { await call('/api/admin/assistant', { method: 'POST', body: { model: t.value } }); flash('Model saved'); return; }
  if (t.hasAttribute && t.hasAttribute('data-aion')) {
    try { const r = await call('/api/admin/assistant', { method: 'POST', body: { enabled: t.checked } }); flash(t.checked ? (r.status && r.status.state === 'listening' ? 'Listening for texts' : 'On · see the steps above') : 'Off'); } catch (e2) { flash(e2.message, true); }
    cfg = await call('/api/admin/config'); return render();
  }
  if (ctx && t.dataset.k) {
    const f = SCHEMAS[ctx.key].fields.find(x => x.k === t.dataset.k);
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (f.type === 'number') v = t.value === '' ? undefined : +t.value;
    if (t.dataset.t === 'dt') v = new Date(ctx.x.allDay ? t.value + 'T00:00' : t.value).toISOString();
    if (v === undefined || v === '') delete ctx.x[t.dataset.k]; else ctx.x[t.dataset.k] = v;
    if (ctx.key === 'events' && t.dataset.k === 'allDay' && v) {
      const s = new Date(ctx.x.start); s.setHours(0, 0, 0, 0); ctx.x.start = s.toISOString();
      const en = new Date(ctx.x.end); en.setHours(0, 0, 0, 0); if (en <= s) en.setDate(s.getDate() + 1); ctx.x.end = en.toISOString();
    }
    if (SCHEMAS[ctx.key].onChange) SCHEMAS[ctx.key].onChange(ctx.x, t.dataset.k);
    save(ctx.key);
    if (['allDay', 'type', 'color', 'start'].includes(t.dataset.k)) render();
    else { const sumEl = t.closest('.item').querySelector('.item-sum'); if (sumEl) sumEl.innerHTML = SCHEMAS[ctx.key].sum(ctx.x); }
    return;
  }
  if (ctx && (t.dataset.ss || t.dataset.ssv)) {
    const did = t.dataset.ss || t.dataset.ssv, row = t.closest('.ss-row'), on = $('[data-ss]', row).checked, range = $('[data-ssv]', row);
    range.disabled = !on;
    ctx.x.set = ctx.x.set || {};
    if (on) ctx.x.set[did] = +range.value; else delete ctx.x.set[did];
    row.querySelector('output').textContent = on ? (+range.value ? range.value + '%' : 'Off') : '—';
    return save('scenes');
  }
  if (t.dataset.qdone != null) { const it = itemAt(t); it.x.done = t.checked; save(it.key); return render(); }
  if (t.dataset.stars) { S.stars[t.dataset.stars] = +t.value; return save('stars'); }
  if (t.dataset.clim) { S.climate[t.dataset.clim] = t.dataset.clim === 'mode' ? t.value : +t.value; return save('climate'); }
  if (t.dataset.setting) { S.settings[t.dataset.setting] = t.value; await call('/api/admin/config', { method: 'POST', body: { settings: { [t.dataset.setting]: t.value } } }); flash('Saved'); return; }
  if (t.dataset.pmeta != null) { S.photos[+t.dataset.pmeta][t.dataset.pk] = t.value; return save('photos'); }
  if (t.id === 'up-files') return upload(t.files);
});

document.addEventListener('click', async e => {
  const t = e.target.closest('button, a'); if (!t) return;
  const d = t.dataset;
  try {
    if (d.open) { openItem = openItem === d.open ? null : d.open; return render(); }
    if (d.add) {
      const x = SCHEMAS[d.add].add();
      S[d.add] = (S[d.add] || []).concat([x]); openItem = d.add + ':' + x.id;
      if (SCHEMAS[d.add].onChange) SCHEMAS[d.add].onChange(x, 'add');
      save(d.add, true); render();
      const el = $('.item.is-open input'); if (el) { el.focus(); el.select(); }
      return;
    }
    if (d.del != null) {
      const ctx = itemAt(t);
      if (!confirm('Delete “' + (ctx.x.name || ctx.x.title) + '”?')) return;
      S[ctx.key].splice(ctx.i, 1); openItem = null; save(ctx.key, true); return render();
    }
    if (d.more) { moreKeys[d.more] = true; return render(); }
    if (d.past != null) { showPast = !showPast; return render(); }
    if (d.clearpast != null) {
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const n = S.events.filter(x => new Date(x.end) < now).length;
      if (!confirm('Delete ' + n + ' past events?')) return;
      S.events = S.events.filter(x => new Date(x.end) >= now); save('events', true); return render();
    }
    if (d.pid) {
      const ctx = itemAt(t); const list = ctx.x.people || [];
      ctx.x.people = list.includes(d.pid) ? list.filter(x => x !== d.pid) : list.concat([d.pid]);
      if (!ctx.x.people.length) ctx.x.people = [d.pid];
      t.classList.toggle('is-on', ctx.x.people.includes(d.pid)); return save('events');
    }
    if (d.test) {
      const ctx = itemAt(t), inp = t.parentNode.querySelector('input');
      const x = ctx.x, val = ctx.key === 'scenes' ? x.id : x.type === 'light' ? (x.on ? x.level : 0) : x.type === 'lock' ? (x.locked ? 'lock' : 'unlock') : x.type === 'garage' ? (x.state === 'closed' ? 'close' : 'open') : x.pos;
      t.textContent = '…';
      const r = await call('/api/admin/shortcut-test', { method: 'POST', body: { name: inp.value, input: val } });
      t.textContent = r.ok ? 'Worked ✓' : 'Failed';
      if (!r.ok) flash(r.error || 'Shortcut failed', true);
      return;
    }
    if (d.dtog) {
      const x = S.devices.find(y => y.id === d.dtog);
      if (x.type === 'light') { x.on = !x.on; x.level = x.level || 100; }
      if (x.type === 'lock') { if (x.locked && !confirm('Unlock ' + x.name + '?')) return; x.locked = !x.locked; }
      if (x.type === 'blind') x.pos = x.pos ? 0 : 100;
      if (x.type === 'garage') { if (!confirm((x.state === 'closed' ? 'Open ' : 'Close ') + x.name + '?')) return; x.state = x.state === 'closed' ? 'open' : 'closed'; }
      save('devices', true); return render();
    }
    if (d.alloff != null) { S.devices.forEach(x => { if (x.type === 'light') x.on = false; }); save('devices', true); return render(); }
    if (d.scene) { await call('/api/agent/scene', { method: 'POST', body: { scene: d.scene } }); flash('Scene on'); return; }
    if (d.announce != null) { const v = $('#announce').value.trim(); if (!v) return; await call('/api/agent/announce', { method: 'POST', body: { text: v } }); $('#announce').value = ''; return flash('Shown on the frame'); }
    if (d.resetchores != null) { S.chores.forEach(c => { c.done = false; delete c.doneBy; }); save('chores', true); return render(); }
    if (d.quickadd != null) return quickAdd();
    if (d.cleardone != null) { S.groceries = S.groceries.filter(g => !g.done); save('groceries', true); return render(); }
    if (d.pfav) { const p = S.photos[+d.pfav]; p.fav = !p.fav; save('photos', true); return render(); }
    if (d.pdel) { if (!confirm('Delete this photo?')) return; await call('/api/admin/photos/' + encodeURIComponent(d.pdel), { method: 'DELETE' }); return reload(); }
    if (d.nodemo != null) { S.photos = S.photos.filter(p => p.src); save('photos', true); return render(); }
    if (d.view) {
      const h = S.settings.hiddenViews || []; const v = d.view;
      S.settings.hiddenViews = h.includes(v) ? h.filter(x => x !== v) : h.concat([v]);
      if (S.settings.hiddenViews.length >= VIEWS.length) S.settings.hiddenViews = [];
      await call('/api/admin/config', { method: 'POST', body: { settings: { hiddenViews: S.settings.hiddenViews } } }); return render();
    }
    if (d.addr != null) {
      $('#addr-res').innerHTML = '<span class="muted">Searching…</span>';
      const res = await call('/api/admin/address-search?q=' + encodeURIComponent($('#addr-q').value));
      $('#addr-res').innerHTML = res.map((r, i) => `<button class="chip" data-addrpick="${i}">${esc(r.label)}</button>`).join('') || '<span class="muted">No matches. Try adding the city.</span>';
      $('#addr-res')._res = res; return;
    }
    if (d.addrpick) {
      const r = $('#addr-res')._res[+d.addrpick];
      flash('Saving and working out BART times…');
      await call('/api/admin/address', { method: 'POST', body: { label: r.label, lat: r.lat, lon: r.lon } });
      flash('Address saved'); return reload();
    }
    if (d.icloud != null) {
      const v = $('#icloud-url').value.trim();
      flash('Syncing album… this can take a minute');
      const r = await call('/api/admin/icloud', { method: 'POST', body: { url: /^https?:/.test(v) ? v : undefined, sync: true } }).catch(e => ({ error: e.message }));
      if (r && r.error) flash(r.error, true); else flash(r.ok ? 'Synced ' + r.count + ' photos' : (r.error || 'Done'));
      return reload();
    }
    if (d.icloudoff != null) { if (!confirm('Unlink the shared album? Its photos leave the frame.')) return; await call('/api/admin/icloud', { method: 'POST', body: { url: '' } }); return reload(); }
    if (d.spsave != null) {
      await call('/api/admin/spotify', { method: 'POST', body: { clientId: $('#sp-id').value, clientSecret: $('#sp-secret').value } });
      location.href = '/api/spotify/login'; return;
    }
    if (d.spoff != null) { if (!confirm('Disconnect Spotify?')) return; await call('/api/admin/spotify', { method: 'POST', body: { disconnect: true } }); return reload(); }
    if (d.geo != null) {
      const res = await call('/api/admin/geocode?q=' + encodeURIComponent($('#geo-q').value));
      $('#geo-res').innerHTML = res.map((r, i) => `<button class="chip" data-geopick="${i}">${esc(r.name)}</button>`).join('') || '<span class="muted">No matches</span>';
      $('#geo-res')._res = res; return;
    }
    if (d.geopick) {
      const r = $('#geo-res')._res[+d.geopick];
      await call('/api/admin/config', { method: 'POST', body: { settings: { lat: r.lat, lon: r.lon, place: r.name.split(',')[0] } } });
      await call('/api/admin/weather/refresh', { method: 'POST' }); flash('Weather set'); return reload();
    }
    if (d.agnew != null || d.agsub) { agUI.edit = { name: '', icon: '🤖', role: '', instructions: '', model: 'claude-haiku-5-5', parent: d.agsub || null, tools: [], can: [], enabled: true, channels: [] }; render(); document.getElementById('ag-editor').scrollIntoView({ behavior: 'smooth' }); return; }
    if (d.agedit) { agUI.edit = JSON.parse(JSON.stringify(AGS.agents.find(a => a.id === d.agedit))); render(); document.getElementById('ag-editor').scrollIntoView({ behavior: 'smooth' }); return; }
    if (d.agcancel != null) { agUI.edit = null; return render(); }
    if (d.agsave != null) {
      const e = agUI.edit, agent = Object.assign({}, e, {
        name: $('#ag-name').value.trim(), icon: $('#ag-icon').value.trim(), role: $('#ag-role').value.trim(), instructions: $('#ag-instr').value,
        model: $('#ag-model').value, parent: $('#ag-parent').value || null, enabled: $('#ag-on').checked,
        channels: $('#ag-imsg').checked ? ['imessage'] : [],
        tools: [...document.querySelectorAll('[data-agtool]:not([disabled])')].filter(i => i.checked).map(i => i.dataset.agtool),
        can: [...document.querySelectorAll('[data-agcan]')].filter(i => i.checked).map(i => i.dataset.agcan)
      });
      if (!agent.name) return flash('Give it a name', true);
      try {
        await call('/api/admin/agents/save', { method: 'POST', body: { agent } });
        if (e.id === 'plex' && $('#pl-movies')) await call('/api/admin/agents/settings', { method: 'POST', body: { plex: { moviesPath: $('#pl-movies').value, inboxPath: $('#pl-inbox').value } } });
        agUI.edit = null; flash('Saved'); AGS = null; return loadAgents();
      } catch (e2) { return flash(e2.message, true); }
    }
    if (d.agdel != null) { if (!confirm('Delete ' + agUI.edit.name + '?')) return; try { await call('/api/admin/agents/delete', { method: 'POST', body: { id: agUI.edit.id } }); agUI.edit = null; AGS = null; return loadAgents(); } catch (e2) { return flash(e2.message, true); } }
    if (d.agchat) { agUI.chat = d.agchat; render(); const el = document.getElementById('ag-chat'); if (el) el.scrollIntoView({ behavior: 'smooth' }); setTimeout(() => { const i = $('#ag-q'); if (i) i.focus(); }, 300); return; }
    if (d.agclear != null) { agUI.logs[agUI.chat] = []; await call('/api/admin/agents/clear-chat', { method: 'POST', body: { id: agUI.chat } }); return render(); }
    if (d.agsend != null) {
      const q = $('#ag-q').value.trim(); if (!q) return;
      const id = agUI.chat, log = agUI.logs[id] = agUI.logs[id] || [];
      log.push({ role: 'you', text: q }); agUI.busy = true; render();
      try { const r = await call('/api/admin/agents/chat', { method: 'POST', body: { id, text: q } }); log.push({ role: 'agent', text: r.output, steps: r.run && r.run.steps }); }
      catch (e2) { log.push({ role: 'agent', text: 'Error: ' + e2.message }); }
      agUI.busy = false; render(); setTimeout(() => { const i = $('#ag-q'); if (i) i.focus(); }, 50); return;
    }
    if (d.agmemadd != null) { const v = $('#ag-mem').value.trim(); if (!v) return; await call('/api/admin/agents/memory', { method: 'POST', body: { text: v } }); AGS = null; return loadAgents(); }
    if (d.agmemdel) { await call('/api/admin/agents/memory', { method: 'POST', body: { delete: d.agmemdel } }); AGS = null; return loadAgents(); }
    if (d.agrun) { agUI.open[d.agrun] = !agUI.open[d.agrun]; return render(); }
    if (d.cstreload != null) { CST = null; return loadCosts(); }
    if (d.cstbudget != null) { try { await call('/api/admin/costs', { method: 'POST', body: { budget: +$('#cs-budget').value || 0 } }); flash('Saved'); CST = null; return loadCosts(); } catch (e2) { return flash(e2.message, true); } }
    if (d.cstprices != null) {
      const prices = { web_search: +$('#cs-ws').value };
      document.querySelectorAll('[data-cstin]').forEach(i => { prices[i.dataset.cstin] = { in: +i.value, out: +$('[data-cstout="' + i.dataset.cstin + '"]').value }; });
      try { await call('/api/admin/costs', { method: 'POST', body: { prices } }); flash('Prices saved'); CST = null; return loadCosts(); } catch (e2) { return flash(e2.message, true); }
    }
    if (d.cstreset != null) { await call('/api/admin/costs', { method: 'POST', body: { resetPrices: true } }); flash('Back to default prices'); CST = null; return loadCosts(); }
    if (d.caladd != null) {
      const url = $('#cal-url').value.trim(), name = $('#cal-name').value.trim(), person = $('#cal-person').value;
      if (!url) return flash('Paste the calendar link first', true);
      calUI.busy = true; calUI.person = person; render();
      try { const r = await call('/api/admin/calendars/add', { method: 'POST', body: { url, name: name || 'Calendar', person } }); cfg.calendars = r.list; flash('Connected · ' + r.count + ' events'); }
      catch (e2) { flash(e2.message, true); }
      calUI.busy = false; return render();
    }
    if (d.calsync != null) { flash('Syncing…'); try { cfg.calendars = await call('/api/admin/calendars/sync', { method: 'POST', body: {} }); flash('Synced'); } catch (e2) { flash(e2.message, true); } return render(); }
    if (d.caldel) { if (!confirm('Disconnect this calendar? Its events disappear from the frame.')) return; cfg.calendars = await call('/api/admin/calendars/remove', { method: 'POST', body: { id: d.caldel } }); return render(); }
    if (d.schnew != null) { agUI.sched = { kind: 'reminder', repeat: 'once', time: '', to: 'jd', agent: 'home', days: [] }; render(); const el = document.getElementById('sch-form'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (d.schcancel != null) { agUI.sched = null; return render(); }
    if (d.schedit) {
      const s = AGS.schedules.find(x => x.id === d.schedit); if (!s) return;
      const w = s.when || {}, at = w.at ? new Date(w.at) : null, p2 = n => String(n).padStart(2, '0');
      const days = w.days || [], rep = w.type === 'once' ? 'once' : w.type === 'daily' ? 'daily' : days.join() === '1,2,3,4,5' ? 'weekdays' : days.join() === '0,6' ? 'weekends' : 'weekly';
      agUI.sched = { id: s.id, kind: s.kind, title: s.title, prompt: s.prompt, repeat: rep, days, to: s.deliver, agent: s.agent, enabled: s.enabled,
        time: at ? p2(at.getHours()) + ':' + p2(at.getMinutes()) : w.time, date: at ? at.getFullYear() + '-' + p2(at.getMonth() + 1) + '-' + p2(at.getDate()) : '' };
      render(); const el = document.getElementById('sch-form'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
    }
    if (d.schsave != null) {
      const f = agUI.sched, body = { id: f.id, kind: $('#sch-kind').value, title: $('#sch-title').value.trim(), message: $('#sch-msg').value.trim(), repeat: $('#sch-rep').value,
        time: $('#sch-time').value, date: $('#sch-date').value || undefined, to: $('#sch-to').value, agent: $('#sch-agent').value, enabled: f.id ? f.enabled : true,
        days: [...document.querySelectorAll('[data-schday]')].filter(i => i.checked).map(i => +i.dataset.schday) };
      if (!body.message) return flash('Write the message or the job first', true);
      try { await call('/api/admin/agents/schedule', { method: 'POST', body }); agUI.sched = null; flash('Saved'); AGS = null; return loadAgents(); } catch (e2) { return flash(e2.message, true); }
    }
    if (d.schon) { const s = AGS.schedules.find(x => x.id === d.schon); try { await call('/api/admin/agents/schedule', { method: 'POST', body: { id: d.schon, enabled: !(s && s.enabled) } }); AGS = null; return loadAgents(); } catch (e2) { return flash(e2.message, true); } }
    if (d.schdel) { if (!confirm('Delete this reminder/job?')) return; await call('/api/admin/agents/schedule-delete', { method: 'POST', body: { id: d.schdel } }); AGS = null; return loadAgents(); }
    if (d.schrun) {
      flash('Running…');
      try { const r = await call('/api/admin/agents/schedule-run', { method: 'POST', body: { id: d.schrun } }); flash(r.ok ? 'Done — sent' : (r.error || 'Failed'), !r.ok); } catch (e2) { flash(e2.message, true); }
      AGS = null; return loadAgents();
    }
    if (d.aikey != null) {
      const k = $('#ai-key').value.trim(); if (!k) return flash('Paste the key first', true);
      flash('Checking with Claude…');
      try { await call('/api/admin/assistant', { method: 'POST', body: { apiKey: k, model: $('#ai-model').value } }); flash('Key works'); } catch (e2) { flash(e2.message, true); }
      cfg = await call('/api/admin/config'); return render();
    }
    if (d.aiallowsave != null) {
      const allow = [...document.querySelectorAll('[data-aiallow]')].map(i => ({ person: i.dataset.aiallow, handle: i.value.trim() })).filter(x => x.handle);
      await call('/api/admin/assistant', { method: 'POST', body: { allow } }); flash('Saved'); cfg = await call('/api/admin/config'); return render();
    }
    if (d.aitest) { try { await call('/api/admin/assistant/test-send', { method: 'POST', body: { handle: d.aitest } }); flash('Sent'); } catch (e2) { flash(e2.message, true); } return; }
    if (d.restart != null) { flash('Restarting…'); await call('/api/admin/restart', { method: 'POST' }).catch(() => {}); setTimeout(async () => { try { cfg = await call('/api/admin/config'); render(); flash('Restarted'); } catch {} }, 6000); return; }
    if (d.aiask != null) {
      askUI.q = $('#ai-q').value.trim(); if (!askUI.q) return;
      askUI.busy = true; askUI.a = ''; render();
      try { askUI.a = (await call('/api/admin/assistant/ask', { method: 'POST', body: { text: askUI.q } })).reply; } catch (e2) { askUI.a = 'Error: ' + e2.message; }
      askUI.busy = false; return render();
    }
    if (d.gvsave != null) {
      const key = $('#gv-key').value.trim(); if (!key) return flash('Paste your Govee key first', true);
      flash('Checking with Govee…');
      try { const r = await call('/api/admin/govee', { method: 'POST', body: { key } }); flash(r.lights ? 'Found ' + r.lights + (r.lights === 1 ? ' light' : ' lights') : 'Key saved · no lights found yet'); }
      catch (e2) { flash(e2.message, true); }
      cfg = await call('/api/admin/config'); return reload();
    }
    if (d.camsetup != null) {
      try { await call('/api/admin/cameras', { method: 'POST', body: { install: true } }); flash('Downloading the video tool…'); } catch (e2) { flash(e2.message, true); }
      const poll = setInterval(async () => { const c = await call('/api/admin/config').catch(() => null); if (!c) return; cfg.cameraSetup = c.cameraSetup; if (section === 'home') rerenderSoon(); if (c.cameraSetup.state !== 'installing') { clearInterval(poll); flash(c.cameraSetup.state === 'ready' ? 'Video tool ready' : (c.cameraSetup.error || 'Setup failed'), c.cameraSetup.state !== 'ready'); } }, 3000);
      return reload();
    }
    if (d.camadd != null) {
      const body = { name: $('#cam-name').value.trim() || 'Camera', host: $('#cam-host').value.trim(), user: $('#cam-user').value.trim(), pass: $('#cam-pass').value, quality: $('#cam-q').value };
      if (!body.host || !body.user || !body.pass) return flash('Fill in the IP address and the Camera Account', true);
      flash('Checking the camera…');
      try { await call('/api/admin/cameras', { method: 'POST', body: { add: body } }); flash('Camera added'); } catch (e2) { return flash(e2.message, true); }
      return reload();
    }
    if (d.camrm) { if (!confirm('Remove this camera?')) return; await call('/api/admin/cameras', { method: 'POST', body: { remove: d.camrm } }); return reload(); }
    if (d.elfind != null) { flash('Looking for Key Lights…'); try { const r = await call('/api/admin/elgato', { method: 'POST', body: {} }); flash(r.found ? 'Found ' + r.found + (r.found === 1 ? ' Key Light' : ' Key Lights') : (r.error || 'None found'), !r.found); } catch (e2) { flash(e2.message, true); } return reload(); }
    if (d.eladd != null) { const ip = $('#el-ip').value.trim(); if (!ip) return flash('Type the light’s IP address', true); try { const r = await call('/api/admin/elgato', { method: 'POST', body: { add: ip } }); flash(r.found ? 'Found ' + r.found + ' Key Light' + (r.found === 1 ? '' : 's') : 'Saved, but it didn’t answer', !r.found); } catch (e2) { flash(e2.message, true); } return reload(); }
    if (d.elrm) { await call('/api/admin/elgato', { method: 'POST', body: { remove: d.elrm } }); return reload(); }
    if (d.gvfind != null) { try { const r = await call('/api/admin/govee/refresh', { method: 'POST' }); flash(r.lights + ' Govee lights'); } catch (e2) { flash(e2.message, true); } return reload(); }
    if (d.gvoff != null) { if (!confirm('Remove the Govee key? Govee lights disappear from the dashboard.')) return; await call('/api/admin/govee', { method: 'POST', body: { clear: true } }); flash('Govee removed'); return reload(); }
    if (d.tvinstall != null) { await call('/api/admin/tv/install', { method: 'POST' }); cfg = await call('/api/admin/config'); return render(); }
    if (d.tvscan != null) {
      tvUI.busy = 'scan'; render();
      try { tvUI.scan = (await call('/api/admin/tv/scan', { method: 'POST' })).filter(x => (x.services || []).some(v => v.protocol === 'Companion')); } catch (e2) { flash(e2.message, true); tvUI.scan = null; }
      tvUI.busy = ''; return render();
    }
    if (d.tvpair) {
      tvUI.target = { id: d.tvpair, name: d.name };
      flash('Look at the TV…');
      try {
        const r = await call('/api/admin/tv/pair', { method: 'POST', body: tvUI.target });
        if (r.done) { tvUI = { scan: null, pair: null, busy: '' }; flash('Apple TV paired'); cfg = await call('/api/admin/config'); return render(); }
        tvUI.pair = r; render(); setTimeout(() => { const i = $('#tv-pin'); if (i) i.focus(); }, 50); return;
      } catch (e2) { flash(e2.message, true); return; }
    }
    if (d.tvpin != null) {
      const pin = $('#tv-pin').value.trim(); if (!pin) return flash('Type the code from the TV', true);
      try {
        await call('/api/admin/tv/pin', { method: 'POST', body: { pin } });
        // Next protocol (AirPlay) needs its own code; the server says when everything is done.
        const r = await call('/api/admin/tv/pair', { method: 'POST', body: tvUI.target });
        if (r.done) { tvUI = { scan: null, pair: null, busy: '' }; flash('Apple TV paired'); cfg = await call('/api/admin/config'); return render(); }
        tvUI.pair = r; flash('Done · now one more code'); render(); setTimeout(() => { const i = $('#tv-pin'); if (i) i.focus(); }, 50); return;
      } catch (e2) { flash(e2.message, true); return; }
    }
    if (d.tvcancel != null) { await call('/api/admin/tv/cancel', { method: 'POST' }).catch(() => {}); tvUI.pair = null; return render(); }
    if (d.tvreconnect != null) { await call('/api/admin/tv/reconnect', { method: 'POST' }); return flash('Reconnecting…'); }
    if (d.tvforget != null) { if (!confirm('Unpair the Apple TV?')) return; await call('/api/admin/tv/forget', { method: 'POST' }); cfg = await call('/api/admin/config'); return render(); }
    if (d.ttsave != null) {
      const key = $('#tt-key').value.trim(); if (!key) return flash('Paste your TomTom key first', true);
      flash('Checking the key…');
      try { await call('/api/admin/tomtom', { method: 'POST', body: { key } }); flash('Live traffic is on'); }
      catch (e) { flash(e.message, true); }
      cfg = await call('/api/admin/config'); return render();
    }
    if (d.ttoff != null) { await call('/api/admin/tomtom', { method: 'POST', body: { clear: true } }); flash('Live traffic off'); cfg = await call('/api/admin/config'); return render(); }
    if (d.plexsave != null) {
      const body = { plex: { url: $('#plex-url').value.trim() } }; const tok = $('#plex-token').value.trim(); if (tok) body.plex.token = tok;
      await call('/api/admin/config', { method: 'POST', body });
      $('#plex-out').textContent = 'Testing…';
      const r = await call('/api/admin/plex/test');
      $('#plex-out').innerHTML = r.ok ? 'Connected. Libraries: ' + r.libraries.map(l => `<button class="chip" data-plexlib="${esc(l.key)}">Scan ${esc(l.title)}</button>`).join(' ') : 'Couldn’t connect: ' + esc(r.error);
      cfg = await call('/api/admin/config'); return;
    }
    if (d.plexscan != null || d.plexlib) { const r = await call('/api/admin/plex/scan', { method: 'POST', body: { key: d.plexlib } }); return flash(r.ok ? 'Scan started' : r.error, !r.ok); }
    if (d.pin != null) { await call('/api/admin/config', { method: 'POST', body: { newPin: $('#newpin').value } }); $('#newpin').value = ''; return flash('PIN changed'); }
    if (d.copy != null) { await navigator.clipboard.writeText(cfg.apiToken); return flash('Copied'); }
    if (d.rotate != null) { if (!confirm('Make a new token? Anything using the old one (Hermes) must be updated.')) return; await call('/api/admin/config', { method: 'POST', body: { rotateToken: true } }); cfg = await call('/api/admin/config'); return render(); }
    if (d.logoutall != null) { await call('/api/admin/config', { method: 'POST', body: { logoutAll: true } }); return renderLogin(); }
    if (d.logout != null) { await call('/api/logout', { method: 'POST' }); return renderLogin(); }
    if (d.reset) {
      const msg = d.reset === 'demo' ? 'Replace everything with the demo household?' : 'Clear the demo family, events, chores, shopping and demo photos? Rooms, devices and scenes stay so you can rename them.';
      if (!confirm(msg)) return;
      await call('/api/admin/reset', { method: 'POST', body: { mode: d.reset } }); flash('Done'); return reload();
    }
    if (d.rawload != null) { $('#raw').value = JSON.stringify(S[$('#raw-key').value], null, 2); return; }
    if (d.rawsave != null) { const k = $('#raw-key').value; S[k] = JSON.parse($('#raw').value); save(k, true); return; }
  } catch (err) { if (err.message !== 'login') flash(err.message, true); }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'quickadd') quickAdd(); if (e.key === 'Enter' && e.target.id === 'announce') $('[data-announce]').click(); if (e.key === 'Enter' && e.target.id === 'geo-q') $('[data-geo]').click(); if (e.key === 'Enter' && e.target.id === 'addr-q') $('[data-addr]').click(); });

function quickAdd() {
  const inp = $('#quickadd'), name = inp.value.trim(); if (!name) return;
  const cat = (S.catalog || []).find(c => c[0].toLowerCase() === name.toLowerCase());
  S.groceries.push({ id: rid('g'), name: cat ? cat[0] : name[0].toUpperCase() + name.slice(1), cat: cat ? cat[1] : 'Other', qty: 1, store: '', done: false, note: '' });
  save('groceries', true); render(); $('#quickadd').focus();
}

async function upload(files) {
  const prog = $('#up-prog'), from = $('#up-from').value, place = $('#up-place').value;
  let n = 0;
  for (const file of files) {
    prog.textContent = 'Uploading ' + (++n) + ' of ' + files.length + '…';
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
      const max = 2000, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const d = new Date(file.lastModified || Date.now());
      await call('/api/admin/photos', { method: 'POST', body: { dataUrl: c.toDataURL('image/jpeg', 0.85), o: c.height > c.width ? 'p' : 'l', from, place, date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) } });
      URL.revokeObjectURL(img.src);
    } catch (err) { flash('Couldn’t add ' + file.name, true); }
  }
  prog.textContent = '';
  reload();
}

// ------------------------------------------------------------------ boot / login
function renderLogin(msg) {
  $('#app').className = 'login';
  $('#app').innerHTML = `<form class="login-card" id="login"><h1 class="serif">Home HQ <i>admin</i></h1>
    <p class="muted">${esc(msg || 'Enter your admin PIN.')}</p>
    <input id="pin" type="password" inputmode="numeric" autocomplete="current-password" placeholder="PIN" autofocus>
    <button class="btn btn--solid">Sign in</button>
    <p class="muted small">First time? The PIN is in <code>~/HomeHQ/data/FIRST-RUN-PIN.txt</code> on the Mac mini.</p></form>`;
  $('#login').onsubmit = async ev => {
    ev.preventDefault();
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HQ': '1' }, body: JSON.stringify({ pin: $('#pin').value }) });
    if (r.ok) boot(); else { const j = await r.json().catch(() => ({})); renderLogin(j.error || 'Wrong PIN'); }
  };
}
async function reload() {
  const j = await call('/api/state'); S = j.state; rev = j.rev;
  cfg = await call('/api/admin/config');
  render();
}
let es = null;
async function boot() {
  try {
    const me = await call('/api/me');
    if (!me.admin) return renderLogin();
    await reload();
    call('/api/admin/shortcuts').then(r => { shortcuts = r.shortcuts; const dl = $('#shortcut-list'); if (dl) dl.innerHTML = shortcuts.map(s => `<option value="${esc(s)}">`).join(''); }).catch(() => {});
    if (!es) {
      es = new EventSource('/api/events');
      es.onmessage = m => {
        const msg = JSON.parse(m.data);
        if (msg.type === 'hello' && msg.rev > rev) reload().catch(() => {});
        if (msg.type === 'patch') { rev = Math.max(rev, msg.rev); if (msg.client === CLIENT) return; Object.assign(S, msg.patch); if (section !== 'agents') rerenderSoon(); }
        if (msg.type === 'agent-run') agentRunEvent(msg.run);
        if (msg.type === 'patch' && msg.patch && msg.patch.costs && section === 'costs') loadCosts();
        if (msg.type === 'agent-schedules' && AGS && section === 'agents' && !agUI.sched) loadAgents();
      };
    }
  } catch (e) { if (e.message !== 'login') $('#app').textContent = 'Can’t reach the Home HQ server: ' + e.message; }
}
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (RENDER[h]) { section = h; openItem = null; window.scrollTo(0, 0); if (S) render(); } });
if (RENDER[location.hash.slice(1)]) section = location.hash.slice(1);
boot();

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target && e.target.id === 'ag-q') { e.preventDefault(); const b = document.querySelector('[data-agsend]'); if (b && !b.disabled) b.click(); }
  if (e.key === 'Enter' && e.target && e.target.id === 'ai-q') { e.preventDefault(); const b = document.querySelector('[data-aiask]'); if (b && !b.disabled) b.click(); }
});
