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
const VIEWS = [['home', 'Today'], ['calendar', 'Calendar'], ['tasks', 'Chores'], ['shopping', 'Shopping'], ['notes', 'Notes'], ['music', 'Music'], ['photos', 'Photos'], ['map', 'Map'], ['games', 'Games'], ['control', 'Home'], ['settings', 'Settings'], ['agents', 'Agents']];

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
    title: 'Shopping list', add: () => ({ id: rid('g'), name: 'New item', cat: 'Other', qty: 1, store: ((S.stores || [])[0] || {}).id, done: false, note: '' }),
    sum: g => `<b class="${g.done ? 'strike' : ''}">${esc(g.name)}${g.qty > 1 ? ' ×' + g.qty : ''}</b><small>${esc(g.cat)} · ${esc(((S.stores || []).find(s => s.id === g.store) || {}).name || '')}${g.note ? ' · ' + esc(g.note) : ''}</small>`,
    fields: [{ k: 'name', label: 'Item' }, { k: 'qty', label: 'Qty', type: 'number' }, { k: 'cat', label: 'Aisle', type: 'select', opts: () => ((S.catOrder || {}).all || []).concat(['Other']).map(c => [c, c]) },
      { k: 'store', label: 'Store', type: 'select', opts: () => (S.stores || []).map(s => [s.id, s.name]) }, { k: 'note', label: 'Note' }, { k: 'done', label: 'Got it', type: 'check' }]
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
  ['photos', 'Photos'], ['music', 'Music'], ['home', 'Lights & Home'], ['assistant', 'iMessage'], ['settings', 'Settings']];

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
function calendar() {
  const from = new Date(); from.setHours(0, 0, 0, 0);
  return listHTML('events', { title: 'Upcoming', filter: e => showPast || new Date(e.end) >= from, sort: (a, b) => new Date(a.start) - new Date(b.start), limit: moreKeys.events ? 0 : 40,
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
  return goveeBlock() + tvBlock() + `<section class="block guide">
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
    </section>` + listHTML('cameras');
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
const RENDER = { overview, family, calendar, chores, shopping, photos, music, home, assistant, settings };

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
  S.groceries.push({ id: rid('g'), name: cat ? cat[0] : name[0].toUpperCase() + name.slice(1), cat: cat ? cat[1] : 'Other', qty: 1, store: ((S.stores || [])[0] || {}).id, done: false, note: '' });
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
        if (msg.type === 'patch') { rev = Math.max(rev, msg.rev); if (msg.client === CLIENT) return; Object.assign(S, msg.patch); rerenderSoon(); }
      };
    }
  } catch (e) { if (e.message !== 'login') $('#app').textContent = 'Can’t reach the Home HQ server: ' + e.message; }
}
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (RENDER[h]) { section = h; openItem = null; window.scrollTo(0, 0); if (S) render(); } });
if (RENDER[location.hash.slice(1)]) section = location.hash.slice(1);
boot();
