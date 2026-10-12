// Home HQ server: serves the dashboard, keeps the household state on disk, pushes live updates
// to every open screen, and bridges to HomeKit (via Shortcuts), Plex and the weather.
// Zero dependencies: Node 18+ only.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createIntegrations } from './integrations.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = +(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
// Serve the Vite build when there is one; otherwise serve the source directly (it is plain ES
// modules, so no build step is needed on the Mac mini).
const BUILT = path.join(ROOT, 'dist');
const DIST = path.resolve(process.env.HOMEHQ_DIST || (fs.existsSync(path.join(BUILT, 'index.html')) ? BUILT : ROOT));
const FROM_SOURCE = DIST === ROOT;
const SOURCE_OK = /^\/(index\.html|admin\.html|js\/[\w\/.-]+\.js|css\/[\w\/.-]+\.css)$/;
const DATA = path.resolve(process.env.HOMEHQ_DATA || path.join(ROOT, 'data'));
const PHOTOS = path.join(DATA, 'photos');
const BACKUPS = path.join(DATA, 'backups');
const STATE_FILE = path.join(DATA, 'state.json');
const SECRETS_FILE = path.join(DATA, 'secrets.json');
const IS_MAC = process.platform === 'darwin';

for (const d of [DATA, PHOTOS, BACKUPS]) fs.mkdirSync(d, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ------------------------------------------------------------------ state keys
// Keys the wall display / any screen on the home network may change (day-to-day use).
const OPEN_KEYS = ['display', 'notes', 'games', 'chores', 'stars', 'week', 'groceries', 'events', 'devices', 'climate'];
// Keys only an admin (or the agent token) may change.
const LIVE_KEYS = ['bart', 'music'];   // refreshed constantly by the server, not saved
const ADMIN_KEYS = ['commute', 'bart', 'music', 'people', 'family', 'routines', 'stores', 'catOrder', 'catalog', 'usuals', 'rooms',
  'scenes', 'cameras', 'photos', 'agents', 'media', 'weather', 'settings'];
const ALL_KEYS = OPEN_KEYS.concat(ADMIN_KEYS);
const DEVICE_STATE_FIELDS = ['on', 'level', 'pos', 'locked', 'state'];

// ------------------------------------------------------------------ demo seed
function demoState() {
  const file = [path.join(ROOT, 'js', 'data.js'), path.join(HERE, 'demo-data.js')].find(f => fs.existsSync(f));
  if (!file) throw new Error('No demo data found');
  const ctx = { window: {}, Date, Object, Math };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx);
  const D = ctx.window.DATA;
  const out = {};
  for (const k of ALL_KEYS) if (D[k] !== undefined) out[k] = JSON.parse(JSON.stringify(D[k]));
  out.settings = defaultSettings();
  return out;
}
function defaultSettings() {
  return { title: 'Steinnheimer & Armada Home', units: 'fahrenheit', place: '', address: '', lat: null, lon: null, demo: true, hiddenViews: [], schema: 4 };
}
const HOUSEHOLD = [
  { id: 'jd', name: 'JD', color: '#6E8069', rgb: '110 128 105', ink: '#FFFFFF', home: true, status: 'Home' },
  { id: 'georgia', name: 'Georgia', color: '#A8644A', rgb: '168 100 74', ink: '#FFFFFF', home: true, status: 'Home' }
];
function blankState() {
  // Everything empty except generic helpers (routines, aisle order, the grocery catalogue).
  const s = demoState();
  Object.assign(s, {
    people: HOUSEHOLD.map(p => Object.assign({}, p)), notes: [], games: {}, events: [], chores: [], groceries: [], photos: [], stars: {}, week: {}, agents: [],
    rooms: [], devices: [], scenes: [], cameras: [],
    stores: [{ id: 'store', name: 'Groceries' }],
    climate: { enabled: false, current: 20, set: 20, mode: 'off', humidity: 0, outside: null },
    media: { source: 'none', room: '', title: '', artist: '', playing: false },
    weather: { t: [], c: [], p: [], live: false },
    music: { connected: false }, bart: null, commute: null
  });
  s.catOrder = { all: s.catOrder.all, store: s.catOrder.all.slice() };
  s.settings = Object.assign(defaultSettings(), { demo: false, hiddenViews: ['calendar', 'tasks', 'agents'] });
  return s;
}

// ------------------------------------------------------------------ persistence
let state, rev = 0, saveTimer = null, lastBackupDay = '';
try {
  const disk = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  state = disk.state; rev = disk.rev || 0;
  log('Loaded state rev', rev);
} catch {
  state = demoState();
  log('No saved state yet: seeded with the demo household. Edit or clear it from /admin.');
  saveSoon();
}
const savedSchema = (state.settings && state.settings.schema) || 1;
state.settings = Object.assign(defaultSettings(), state.settings || {});
if (savedSchema < 2) {
  // v2: the dashboard no longer ships with a pretend family. Keep real uploads and settings.
  const keepPhotos = (state.photos || []).filter(x => x.src);
  const keep = { title: state.settings.title, units: state.settings.units, place: state.settings.place, lat: state.settings.lat, lon: state.settings.lon, address: state.settings.address || '' };
  if (state.settings.demo !== false) { state = blankState(); state.photos = keepPhotos; }
  state.settings = Object.assign(defaultSettings(), state.settings, keep, { schema: 2, demo: false, hiddenViews: ['calendar', 'tasks', 'agents'] });
  log('Updated saved data to schema 2 (demo household removed)');
  saveSoon();
}
if (savedSchema < 3) {
  // v3: the household is JD and Georgia; notes and games.
  if (!(state.people || []).some(p => p.id === 'jd' || p.id === 'georgia')) state.people = HOUSEHOLD.map(p => Object.assign({}, p));
  state.notes = state.notes || []; state.games = state.games || {};
  if (!state.settings.title || state.settings.title === 'Home HQ') state.settings.title = 'Steinnheimer & Armada Home';
  state.settings.schema = 3;
  log('Updated saved data to schema 3 (JD + Georgia, notes, games)');
  saveSoon();
}
if (savedSchema < 4) {
  // v4: earth-tone redesign. Recolor JD and Georgia unless someone already picked their own color.
  const old = { jd: '#2D5BFF', georgia: '#E4007C' };
  (state.people || []).forEach(p => {
    const h = HOUSEHOLD.find(x => x.id === p.id);
    if (h && (p.color || '').toUpperCase() === old[p.id]) { p.color = h.color; p.rgb = h.rgb; p.ink = h.ink; }
  });
  state.settings.schema = 4;
  log('Updated saved data to schema 4 (earth-tone colors)');
  saveSoon();
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}
function save() {
  const persist = Object.assign({}, state); LIVE_KEYS.forEach(k => delete persist[k]);
  const json = JSON.stringify({ rev, savedAt: new Date().toISOString(), state: persist }, null, 1);
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, STATE_FILE);
  const day = new Date().toISOString().slice(0, 10);
  if (day !== lastBackupDay) {
    lastBackupDay = day;
    fs.writeFileSync(path.join(BACKUPS, 'state-' + day + '.json'), json);
    const old = fs.readdirSync(BACKUPS).filter(f => f.startsWith('state-')).sort().slice(0, -21);
    old.forEach(f => fs.unlinkSync(path.join(BACKUPS, f)));
  }
}

// ------------------------------------------------------------------ secrets + auth
let secrets = {};
try { secrets = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8')); } catch {}
function saveSecrets() { fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 1), { mode: 0o600 }); }
function hashPin(pin, salt) { return crypto.scryptSync(String(pin), salt, 32).toString('hex'); }
function setPin(pin) { const salt = crypto.randomBytes(16).toString('hex'); secrets.pinSalt = salt; secrets.pinHash = hashPin(pin, salt); }
if (!secrets.pinHash) {
  const pin = process.env.HOMEHQ_PIN || String(crypto.randomInt(100000, 999999));
  setPin(pin);
  fs.writeFileSync(path.join(DATA, 'FIRST-RUN-PIN.txt'), 'Home HQ admin PIN: ' + pin + '\nChange it in Admin → Settings, then delete this file.\n', { mode: 0o600 });
  log('Admin PIN created. It is in', path.join(DATA, 'FIRST-RUN-PIN.txt'));
}
if (!secrets.apiToken) secrets.apiToken = crypto.randomBytes(24).toString('base64url');
secrets.sessions = secrets.sessions || {};
secrets.plex = secrets.plex || { url: '', token: '' };
saveSecrets();

function pinOk(pin) {
  const a = Buffer.from(hashPin(pin, secrets.pinSalt), 'hex'), b = Buffer.from(secrets.pinHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const fails = new Map(); // ip -> {n, until}
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return out;
}
function isAdmin(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const t = Buffer.from(auth.slice(7)), k = Buffer.from(secrets.apiToken);
    if (t.length === k.length && crypto.timingSafeEqual(t, k)) return true;
  }
  const sid = cookies(req).hq_admin;
  const s = sid && secrets.sessions[sid];
  return !!(s && s.exp > Date.now());
}
function clientIp(req) { return (req.socket.remoteAddress || '').replace(/^::ffff:/, ''); }
// Requests that came in through Cloudflare (Tunnel) are from the internet, even though they reach
// us on localhost. They need an admin login to change anything.
function viaInternet(req) { return !!(req.headers['cf-connecting-ip'] || req.headers['cf-ray'] || req.headers['x-forwarded-for']); }
// Cloudflare Access adds this after someone signs in (or a home-IP bypass rule lets the frame through).
// Treat those like the home network: day-to-day changes allowed, admin still needs the PIN.
function viaAccess(req) { return viaInternet(req) && !!req.headers['cf-access-jwt-assertion']; }
// The house's own public address(es), learned from Cloudflare. A request through the tunnel from
// that address is the frame (or a phone) on the home Wi-Fi, so it gets the same rights as the LAN.
let publicIps = [];
async function learnPublicIp() {
  const found = [];
  for (const host of ['https://1.1.1.1/cdn-cgi/trace', 'https://[2606:4700:4700::1111]/cdn-cgi/trace']) {
    try { const t = await (await fetch(host, { signal: AbortSignal.timeout(5000) })).text(); const m = t.match(/^ip=(.+)$/m); if (m) found.push(m[1].trim()); } catch {}
  }
  if (found.length) publicIps = found;
}
function sameHome(ip) {
  if (!ip) return false;
  return publicIps.some(h => h === ip || (h.includes(':') && ip.includes(':') && h.split(':').slice(0, 4).join(':') === ip.split(':').slice(0, 4).join(':')));
}
function fromHomeViaTunnel(req) { return viaInternet(req) && sameHome(String(req.headers['cf-connecting-ip'] || '')); }
learnPublicIp(); setInterval(learnPublicIp, 30 * 60000);
const isAdminHost = req => /^admin\./i.test(String(req.headers.host || ''));
// Home network, Tailscale (100.64/10) or this machine.
function isPrivate(ip) {
  if (ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  const m = ip.match(/^100\.(\d+)\./); if (m && +m[1] >= 64 && +m[1] <= 127) return true;
  return /^(fc|fd|fe80)/i.test(ip);
}

// ------------------------------------------------------------------ live updates (SSE)
const streams = new Set();
function broadcast(msg) {
  const data = 'data: ' + JSON.stringify(msg) + '\n\n';
  for (const res of streams) res.write(data);
}
setInterval(() => { for (const res of streams) res.write(': ping\n\n'); }, 25000);

function commit(patch, client) {
  Object.assign(state, patch);
  rev++;
  saveSoon();
  broadcast({ type: 'patch', rev, patch, client: client || null });
  return rev;
}

const X = createIntegrations({ getState: () => state, commit, secrets, saveSecrets: () => saveSecrets(), log, dataDir: DATA, photosDir: PHOTOS });

// ------------------------------------------------------------------ HomeKit via Shortcuts
// Each device / scene can name a Shortcut. We run it with a text input:
//   light → 0-100 (0 = off) · blind → 0-100 · lock → "lock"/"unlock" · garage → "open"/"close"
//   scene → scene id · climate → "<mode> <set>"
const shortcutLog = [];
let shortcutChain = Promise.resolve();
function runShortcut(name, input) {
  if (!name) return Promise.resolve({ ok: false, error: 'No shortcut name' });
  const entry = { at: new Date().toISOString(), name, input: String(input ?? '') };
  shortcutLog.unshift(entry); shortcutLog.length = Math.min(shortcutLog.length, 50);
  shortcutChain = shortcutChain.then(() => new Promise(resolve => {
    if (!IS_MAC) { entry.ok = false; entry.error = 'Shortcuts only runs on macOS'; log('[shortcut skipped]', name, input); return resolve(entry); }
    const tmp = path.join(os.tmpdir(), 'hq-' + crypto.randomBytes(6).toString('hex') + '.txt');
    fs.writeFileSync(tmp, String(input ?? ''));
    const p = spawn('/usr/bin/shortcuts', ['run', name, '-i', tmp], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    const kill = setTimeout(() => p.kill('SIGKILL'), 30000);
    p.on('close', code => {
      clearTimeout(kill); fs.rm(tmp, () => {});
      entry.ok = code === 0; if (code !== 0) entry.error = err.trim() || 'exit ' + code;
      log('[shortcut]', name, input, entry.ok ? 'ok' : entry.error);
      resolve(entry);
    });
    p.on('error', e => { clearTimeout(kill); entry.ok = false; entry.error = e.message; resolve(entry); });
  }));
  return shortcutChain.then(() => entry);
}
function listShortcuts() {
  return new Promise(resolve => {
    if (!IS_MAC) return resolve([]);
    const p = spawn('/usr/bin/shortcuts', ['list'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = ''; p.stdout.on('data', d => { out += d; });
    p.on('close', () => resolve(out.split('\n').map(s => s.trim()).filter(Boolean).sort()));
    p.on('error', () => resolve([]));
  });
}
function deviceInput(d, old) {
  if (d.type === 'light') return d.on ? (d.level || 100) : 0;
  if (d.type === 'blind') return d.pos;
  if (d.type === 'lock') return d.locked ? 'lock' : 'unlock';
  if (d.type === 'garage') {
    if (d.state === 'opening' || (d.state === 'open' && !/ing$/.test(old.state || ''))) return 'open';
    if (d.state === 'closing' || (d.state === 'closed' && !/ing$/.test(old.state || ''))) return 'close';
    return null;
  }
  return null;
}
function fireDeviceShortcuts(oldList, newList) {
  const byId = Object.fromEntries((oldList || []).map(d => [d.id, d]));
  for (const d of newList || []) {
    const o = byId[d.id];
    if (!o || !d.shortcut) continue;
    if (!DEVICE_STATE_FIELDS.some(f => o[f] !== d[f])) continue;
    const input = deviceInput(d, o);
    if (input !== null) runShortcut(d.shortcut, input);
  }
}
function applySceneServer(id) {
  const s = (state.scenes || []).find(x => x.id === id || x.name.toLowerCase() === String(id).toLowerCase());
  if (!s) return null;
  const before = JSON.parse(JSON.stringify(state.devices));
  const devices = JSON.parse(JSON.stringify(state.devices));
  for (const [k, v] of Object.entries(s.set || {})) {
    const d = devices.find(x => x.id === k); if (!d) continue;
    if (d.type === 'blind') d.pos = v; else if (v === 0) d.on = false; else { d.on = true; d.level = v; }
  }
  if (s.id === 'away' || s.id === 'night' || s.lockAll) devices.forEach(d => { if (d.type === 'lock') d.locked = true; });
  if (s.shortcut) runShortcut(s.shortcut, s.id); else fireDeviceShortcuts(before, devices);
  commit({ devices }, 'server');
  return s;
}

// ------------------------------------------------------------------ weather (Open-Meteo, no key)
function wxIcon(code, day) {
  if (code === 0) return day ? 'sun' : 'moon';
  if (code === 1 || code === 2) return day ? 'partly' : 'moon';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) return 'rain';
  return 'cloud';
}
async function refreshWeather() {
  const S = state.settings;
  if (S.lat == null || S.lon == null) return;
  const unit = S.units === 'celsius' ? 'celsius' : 'fahrenheit';
  const wind = unit === 'celsius' ? 'kmh' : 'mph';
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + S.lat + '&longitude=' + S.lon +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m' +
    '&hourly=temperature_2m,precipitation_probability,weather_code,is_day' +
    '&daily=temperature_2m_max,temperature_2m_min&forecast_days=2&timezone=auto' +
    '&temperature_unit=' + unit + '&wind_speed_unit=' + wind;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    const H = j.hourly, today = j.daily.time[0];
    const idx = H.time.map((t, i) => [t, i]).filter(([t]) => t.startsWith(today)).map(([, i]) => i).slice(0, 24);
    const weather = {
      hi: Math.round(j.daily.temperature_2m_max[0]), lo: Math.round(j.daily.temperature_2m_min[0]),
      feels: Math.round(j.current.apparent_temperature), humidity: Math.round(j.current.relative_humidity_2m),
      wind: Math.round(j.current.wind_speed_10m),
      t: idx.map(i => Math.round(H.temperature_2m[i])),
      c: idx.map(i => wxIcon(H.weather_code[i], H.is_day[i])),
      p: idx.map(i => H.precipitation_probability[i] || 0),
      live: true, place: S.place, updated: new Date().toISOString()
    };
    const climate = Object.assign({}, state.climate, { outside: Math.round(j.current.temperature_2m) });
    commit({ weather, climate }, 'server');
  } catch (e) { log('weather failed:', e.message); }
}
setInterval(refreshWeather, 20 * 60000);

// ------------------------------------------------------------------ Plex
async function plex(pathname, opts = {}) {
  const P = secrets.plex;
  if (!P.url || !P.token) throw new Error('Plex is not set up');
  const u = new URL(pathname, P.url);
  u.searchParams.set('X-Plex-Token', P.token);
  const r = await fetch(u, { method: opts.method || 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('Plex returned ' + r.status);
  return opts.raw ? r : (r.headers.get('content-type') || '').includes('json') ? r.json() : r.text();
}
let plexStatus = { ok: false, error: 'Not set up' };
async function refreshPlex() {
  if (!secrets.plex.url || !secrets.plex.token) return;
  try {
    const j = await plex('/status/sessions');
    const list = (j.MediaContainer && j.MediaContainer.Metadata) || [];
    const m = list.find(x => x.Player && x.Player.state === 'playing') || list[0];
    const media = m ? {
      source: 'plex', room: (m.Player && m.Player.title) || 'Plex',
      title: m.type === 'episode' ? m.title : m.title,
      artist: m.type === 'episode' ? m.grandparentTitle + ' · S' + m.parentIndex + 'E' + m.index : (m.grandparentTitle || m.parentTitle || (m.year ? String(m.year) : '')),
      playing: !!(m.Player && m.Player.state === 'playing'),
      user: m.User && m.User.title, streams: list.length,
      art: '/plex-art?path=' + encodeURIComponent(m.grandparentThumb || m.thumb || m.art || ''), volume: 0
    } : { source: 'plex', room: 'Plex', title: 'Nothing playing', artist: 'Plex is idle', playing: false, art: '', streams: 0, volume: 0 };
    plexStatus = { ok: true, streams: list.length, checked: new Date().toISOString() };
    if (JSON.stringify(media) !== JSON.stringify(state.media)) commit({ media }, 'server');
  } catch (e) { plexStatus = { ok: false, error: e.message, checked: new Date().toISOString() }; }
}
setInterval(refreshPlex, 15000);

// ------------------------------------------------------------------ HTTP helpers
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain' };
function send(res, code, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, Object.assign({ 'Content-Type': isObj ? 'application/json' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' }, headers));
  res.end(isObj ? JSON.stringify(body) : body);
}
function readBody(req, limit = 30e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(Object.assign(new Error('Bad JSON'), { code: 400 })); }
    });
    req.on('error', reject);
  });
}
async function serveFile(res, file, cache) {
  try {
    const st = await fsp.stat(file);
    if (!st.isFile()) return false;
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size,
      'Cache-Control': cache || 'no-cache' });
    fs.createReadStream(file).pipe(res);
    return true;
  } catch { return false; }
}
const BUILD = (() => {
  const h = crypto.createHash('sha1');
  const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else h.update(p + fs.statSync(p).mtimeMs); } };
  try { ['js', 'css'].forEach(d => walk(path.join(ROOT, d))); } catch {}
  return h.digest('hex').slice(0, 10);
})();
async function servePage(res, name) {
  let html = await fsp.readFile(path.join(ROOT, name), 'utf8');
  html = html.replace(/(href|src)="\/?((?:css|js)\/[^"]+)"/g, (m, a, p) => a + '="/v/' + BUILD + '/' + p + '"');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' });
  res.end(html);
}
function safeJoin(base, rel) {
  const p = path.resolve(base, '.' + path.posix.normalize('/' + rel));
  return p.startsWith(base) ? p : null;
}
const id = p => p + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
function findDevice(q) {
  q = String(q || '').toLowerCase();
  return (state.devices || []).find(d => d.id.toLowerCase() === q) || (state.devices || []).find(d => d.name.toLowerCase() === q) ||
    (state.devices || []).find(d => d.name.toLowerCase().includes(q));
}
function personId(q) {
  q = String(q || '').toLowerCase();
  const p = (state.people || []).find(x => x.id === q || x.name.toLowerCase() === q);
  return p ? p.id : null;
}

// ------------------------------------------------------------------ routes
async function api(req, res, url) {
  const p = url.pathname, m = req.method, admin = isAdmin(req), ip = clientIp(req), home = (isPrivate(ip) && !viaInternet(req)) || viaAccess(req) || fromHomeViaTunnel(req);
  const needAdmin = () => { if (!admin) { send(res, 401, { error: 'Admin login required' }); return true; } return false; };
  if (m !== 'GET' && m !== 'HEAD' && !admin && req.headers['x-hq'] !== '1') return send(res, 403, { error: 'Missing X-HQ header' });

  if (p === '/api/state' && m === 'GET') return send(res, 200, { rev, state });
  if (p === '/api/me') return send(res, 200, { admin, home, demoBuild: FROM_SOURCE, publicIps: admin ? publicIps : undefined });
  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\ndata: ' + JSON.stringify({ type: 'hello', rev }) + '\n\n');
    streams.add(res);
    req.on('close', () => streams.delete(res));
    return;
  }

  // ---------------------------------------------------------------- map + music (home network or admin)
  if (p.startsWith('/api/geo/') || p.startsWith('/api/music')) {
    if (!admin && !home) return send(res, 403, { error: 'Sign in at /admin to use this from outside the house' });
    const st = state.settings;
    if (p === '/api/geo/search') {
      try { return send(res, 200, await X.geocode(url.searchParams.get('q') || '', st.lat != null ? { lat: st.lat, lon: st.lon } : null)); }
      catch (e) { return send(res, 409, { error: e.message }); }
    }
    if (p === '/api/geo/route') {
      if (st.lat == null) return send(res, 400, { error: 'Set your home address in Admin → Settings first' });
      const to = { lat: +url.searchParams.get('lat'), lon: +url.searchParams.get('lon') };
      if (isNaN(to.lat) || isNaN(to.lon)) return send(res, 400, { error: 'lat and lon required' });
      return send(res, 200, Object.assign({ from: { lat: st.lat, lon: st.lon } }, await X.routeBoth({ lat: st.lat, lon: st.lon }, to)));
    }
    try {
      if (p === '/api/music' && m === 'POST') return send(res, 200, await X.spotifyCommand(await readBody(req)));
      if (p === '/api/music/library') return send(res, 200, await X.spotifyLibrary());
      if (p === '/api/music/search') return send(res, 200, await X.spotifySearch(url.searchParams.get('q') || ''));
      if (p === '/api/music/items') return send(res, 200, await X.spotifyItems(url.searchParams.get('uri') || ''));
      if (p === '/api/music/sonos') return send(res, 200, await X.sonos.debug());
      if (p === '/api/music/art') {
        const r = await X.sonos.art(url.searchParams.get('h'), url.searchParams.get('p') || '/');
        res.writeHead(r.ok ? 200 : 404, { 'Content-Type': r.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=3600' });
        return res.end(Buffer.from(await r.arrayBuffer()));
      }
      if (p === '/api/music/sonos-probe') return send(res, 200, await X.sonos.probe(url.searchParams.get('uri') || ''));
    } catch (e) { return send(res, e.status === 401 ? 401 : 409, { error: e.message }); }
    return send(res, 404, { error: 'Not found' });
  }

  // ---------------------------------------------------------------- Spotify sign-in (admin)
  if (p === '/api/spotify/login') {
    if (needAdmin()) return;
    const sp = secrets.spotify || {};
    if (!sp.clientId || !sp.clientSecret) return send(res, 400, 'Add your Spotify Client ID and Secret in Admin → Music first.');
    const redirect = spotifyRedirect(req);
    res.writeHead(302, { Location: X.spotifyAuthUrl(redirect) }); return res.end();
  }
  if (p === '/api/spotify/callback') {
    if (needAdmin()) return;
    try {
      if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error'));
      await X.spotifyCallback(url.searchParams.get('code'), url.searchParams.get('state'));
      res.writeHead(302, { Location: '/admin#music' }); return res.end();
    } catch (e) { return send(res, 400, 'Spotify sign-in failed: ' + e.message + '\n\nGo back to Admin → Music and try again.'); }
  }

  if (p === '/api/state' && m === 'PATCH') {
    const body = await readBody(req);
    const patch = body.patch || {};
    if (!admin && !home) return send(res, 403, { error: 'Sign in at /admin to make changes from outside the house' });
    const clean = {};
    for (const [k, v] of Object.entries(patch)) {
      if (!ALL_KEYS.includes(k)) continue;
      if (!admin && !OPEN_KEYS.includes(k)) continue;
      if (k === 'devices' && !admin) {
        // The wall display may flip device state but not rename/remap devices.
        const incoming = Object.fromEntries((v || []).map(d => [d.id, d]));
        clean.devices = (state.devices || []).map(d => {
          const n = incoming[d.id]; if (!n) return d;
          const out = Object.assign({}, d); DEVICE_STATE_FIELDS.forEach(f => { if (f in n) out[f] = n[f]; }); return out;
        });
      } else if (k === 'display') {
        // Night mode schedule + auto-lock, set from the frame's Settings tab.
        const n = (v && v.night) || {}, hhmm = x => /^([01]\d|2[0-3]):[0-5]\d$/.test(x) ? x : null;
        clean.display = {
          night: { mode: ['auto', 'on', 'off'].includes(n.mode) ? n.mode : 'auto', from: hhmm(n.from) || '21:30', to: hhmm(n.to) || '06:30',
            level: ['dim', 'medium', 'bright'].includes(n.level) ? n.level : 'medium' },
          lockAfter: [0, 60, 120, 300, 600].includes(+(v && v.lockAfter)) ? +v.lockAfter : 120
        };
      } else clean[k] = v;
    }
    if (!Object.keys(clean).length) return send(res, 200, { rev });
    if (clean.devices) {
      const scene = body.scene && (state.scenes || []).find(s => s.id === body.scene);
      if (scene && scene.shortcut) runShortcut(scene.shortcut, scene.id);
      else fireDeviceShortcuts(state.devices, clean.devices);
    }
    if (clean.climate && state.settings.climateShortcut) {
      const a = state.climate || {}, b = clean.climate;
      if (a.set !== b.set || a.mode !== b.mode) runShortcut(state.settings.climateShortcut, b.mode + ' ' + b.set);
    }
    return send(res, 200, { rev: commit(clean, body.client) });
  }

  if (p === '/api/login' && m === 'POST') {
    const f = fails.get(ip);
    if (f && f.n >= 5 && f.until > Date.now()) return send(res, 429, { error: 'Too many tries. Wait a few minutes.' });
    const { pin } = await readBody(req);
    if (!pin || !pinOk(pin)) {
      const n = (f && f.until > Date.now() ? f.n : 0) + 1;
      fails.set(ip, { n, until: Date.now() + 5 * 60000 });
      return send(res, 401, { error: 'Wrong PIN' });
    }
    fails.delete(ip);
    const sid = crypto.randomBytes(24).toString('base64url');
    const now = Date.now();
    for (const [k, s] of Object.entries(secrets.sessions)) if (s.exp < now) delete secrets.sessions[k];
    secrets.sessions[sid] = { exp: now + 60 * 864e5, ip, ua: String(req.headers['user-agent'] || '').slice(0, 80) };
    saveSecrets();
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'hq_admin=' + sid + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + 60 * 86400 });
  }
  if (p === '/api/logout' && m === 'POST') {
    const sid = cookies(req).hq_admin; if (sid) { delete secrets.sessions[sid]; saveSecrets(); }
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'hq_admin=; Path=/; Max-Age=0' });
  }

  // ---------------------------------------------------------------- admin
  if (p.startsWith('/api/admin/')) {
    if (needAdmin()) return;
    const sub = p.slice(11);
    if (sub === 'config' && m === 'GET') {
      return send(res, 200, {
        settings: state.settings, plex: { url: secrets.plex.url, hasToken: !!secrets.plex.token, status: plexStatus },
        icloud: { set: !!secrets.icloudAlbum, status: X.albumStatus() },
        spotify: { clientId: (secrets.spotify || {}).clientId || '', hasSecret: !!(secrets.spotify || {}).clientSecret, connected: !!(secrets.spotify || {}).refreshToken, status: X.spotifyStatus(), redirect: spotifyRedirect(req) },
        apiToken: secrets.apiToken, isMac: IS_MAC, hostname: os.hostname(), port: PORT,
        addresses: Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address),
        shortcutLog, sessions: Object.keys(secrets.sessions).length, rev
      });
    }
    if (sub === 'config' && m === 'POST') {
      const b = await readBody(req);
      if (b.newPin) { if (!/^\d{4,12}$/.test(b.newPin)) return send(res, 400, { error: 'PIN must be 4–12 digits' }); setPin(b.newPin); try { fs.unlinkSync(path.join(DATA, 'FIRST-RUN-PIN.txt')); } catch {} }
      if (b.plex) { if ('url' in b.plex) secrets.plex.url = String(b.plex.url || '').replace(/\/+$/, ''); if (b.plex.token) secrets.plex.token = String(b.plex.token); if (b.plex.clear) secrets.plex = { url: '', token: '' }; refreshPlex(); }
      if (b.rotateToken) secrets.apiToken = crypto.randomBytes(24).toString('base64url');
      if (b.logoutAll) secrets.sessions = {};
      saveSecrets();
      if (b.settings) { commit({ settings: Object.assign({}, state.settings, b.settings) }, 'admin'); refreshWeather(); }
      return send(res, 200, { ok: true });
    }
    if (sub === 'address-search' && m === 'GET') {
      try { return send(res, 200, await X.geocode(url.searchParams.get('q') || '')); } catch (e) { return send(res, 409, { error: e.message }); }
    }
    if (sub === 'address' && m === 'POST') {
      const b = await readBody(req);
      if (typeof b.lat !== 'number' || typeof b.lon !== 'number') return send(res, 400, { error: 'Pick an address from the search results' });
      const city = String(b.label || '').split(',').map(x => x.trim());
      commit({ settings: Object.assign({}, state.settings, { address: String(b.label || '').slice(0, 200), lat: b.lat, lon: b.lon, place: b.place || city[2] || city[1] || city[0] || '' }) }, 'admin');
      await Promise.all([refreshWeather(), X.refreshCommute().catch(e => log('commute:', e.message))]);
      return send(res, 200, { ok: true, commute: state.commute });
    }
    if (sub === 'icloud' && m === 'POST') {
      const b = await readBody(req);
      if (b.sync && !b.url) return send(res, 200, await X.syncAlbum());
      let token = null;
      if (b.url) {
        token = await X.resolveAlbumLink(b.url).catch(() => null);
        if (!token) return send(res, 400, { error: 'Couldn’t open that as a shared album. Use the album’s share link (Public Website), not a link to single photos.' });
      }
      secrets.icloudAlbum = b.url || ''; secrets.icloudAlbumToken = token || ''; saveSecrets();
      if (!b.url) { commit({ photos: (state.photos || []).filter(x => !x.icloud) }, 'admin'); return send(res, 200, { ok: true }); }
      return send(res, 200, await X.syncAlbum());
    }
    if (sub === 'spotify' && m === 'POST') {
      const b = await readBody(req);
      secrets.spotify = secrets.spotify || {};
      if (b.clientId != null) secrets.spotify.clientId = String(b.clientId).trim();
      if (b.clientSecret) secrets.spotify.clientSecret = String(b.clientSecret).trim();
      if (b.disconnect) X.spotifyDisconnect();
      saveSecrets(); return send(res, 200, { ok: true });
    }
    if (sub === 'bart/refresh' && m === 'POST') { await X.refreshBart(); return send(res, 200, state.bart); }
    if (sub === 'geocode' && m === 'GET') {
      const q = url.searchParams.get('q') || '';
      try {
        const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=6&name=' + encodeURIComponent(q), { signal: AbortSignal.timeout(8000) });
        const j = await r.json();
        return send(res, 200, (j.results || []).map(x => ({ name: [x.name, x.admin1, x.country_code].filter(Boolean).join(', '), lat: x.latitude, lon: x.longitude })));
      } catch (e) { return send(res, 409, { error: e.message }); }
    }
    if (sub === 'weather/refresh' && m === 'POST') { await refreshWeather(); return send(res, 200, { weather: state.weather }); }
    if (sub === 'shortcuts' && m === 'GET') return send(res, 200, { isMac: IS_MAC, shortcuts: await listShortcuts() });
    if (sub === 'shortcut-test' && m === 'POST') { const b = await readBody(req); return send(res, 200, await runShortcut(b.name, b.input)); }
    if (sub === 'plex/test' && m === 'GET') {
      try {
        const j = await plex('/library/sections');
        const libs = ((j.MediaContainer && j.MediaContainer.Directory) || []).map(d => ({ key: d.key, title: d.title, type: d.type, scanning: !!d.refreshing }));
        await refreshPlex();
        return send(res, 200, { ok: true, libraries: libs, status: plexStatus });
      } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }
    if (sub === 'plex/scan' && m === 'POST') {
      const b = await readBody(req);
      try { await plex(b.key ? '/library/sections/' + encodeURIComponent(b.key) + '/refresh' : '/library/sections/all/refresh', { raw: true }); return send(res, 200, { ok: true }); }
      catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }
    if (sub === 'photos' && m === 'POST') {
      const b = await readBody(req);
      const mt = /^data:image\/(jpeg|png|webp);base64,/.exec(b.dataUrl || '');
      if (!mt) return send(res, 400, { error: 'Send a JPEG, PNG or WebP image' });
      const pid = id('p'), ext = mt[1] === 'jpeg' ? 'jpg' : mt[1];
      await fsp.writeFile(path.join(PHOTOS, pid + '.' + ext), Buffer.from(b.dataUrl.slice(mt[0].length), 'base64'));
      const photo = { id: pid, src: '/photos/' + pid + '.' + ext, o: b.o === 'p' ? 'p' : 'l', date: /^\d{4}-\d\d-\d\d$/.test(b.date) ? b.date : new Date().toISOString().slice(0, 10),
        place: String(b.place || '').slice(0, 80), from: b.from || 'family', tag: String(b.tag || '').slice(0, 40) || pid, fav: !!b.fav };
      commit({ photos: (state.photos || []).concat([photo]) }, 'admin');
      return send(res, 200, photo);
    }
    if (sub.startsWith('photos/') && m === 'DELETE') {
      const pid = sub.slice(7);
      const ph = (state.photos || []).find(x => x.id === pid || x.seed === pid);
      if (!ph) return send(res, 404, { error: 'Not found' });
      if (ph.src && ph.src.startsWith('/photos/')) fs.rm(path.join(PHOTOS, path.basename(ph.src)), () => {});
      commit({ photos: state.photos.filter(x => x !== ph) }, 'admin');
      return send(res, 200, { ok: true });
    }
    if (sub === 'reset' && m === 'POST') {
      const b = await readBody(req);
      const fresh = b.mode === 'demo' ? demoState() : blankState();
      fresh.settings = Object.assign({}, state.settings, { demo: b.mode === 'demo' });
      if (b.mode !== 'demo') fresh.photos = (state.photos || []).filter(x => x.src);
      commit(fresh, 'admin');
      refreshWeather();
      return send(res, 200, { ok: true, rev });
    }
    if (sub === 'export' && m === 'GET') return send(res, 200, { rev, exportedAt: new Date().toISOString(), state }, { 'Content-Disposition': 'attachment; filename="homehq-' + new Date().toISOString().slice(0, 10) + '.json"' });
    if (sub === 'backups' && m === 'GET') return send(res, 200, fs.readdirSync(BACKUPS).sort().reverse());
    return send(res, 404, { error: 'Unknown admin route' });
  }

  // ---------------------------------------------------------------- agent API (Hermes etc.)
  if (p.startsWith('/api/agent/')) {
    if (needAdmin()) return;
    const sub = p.slice(11), b = m === 'POST' ? await readBody(req) : {};
    if (sub === 'summary') {
      const now = new Date(), end = new Date(now); end.setHours(23, 59, 59);
      const evs = (state.events || []).filter(e => !e.allDay && new Date(e.start) >= now && new Date(e.start) <= end)
        .sort((a, c) => new Date(a.start) - new Date(c.start)).map(e => new Date(e.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' ' + e.title);
      const on = (state.devices || []).filter(d => d.type === 'light' && d.on).map(d => d.name + ' ' + d.level + '%');
      const unlocked = (state.devices || []).filter(d => d.type === 'lock' && !d.locked).map(d => d.name);
      const shop = (state.groceries || []).filter(g => !g.done).map(g => g.name);
      return send(res, 200, {
        rest_of_today: evs, lights_on: on, unlocked, garage: ((state.devices || []).find(d => d.type === 'garage') || {}).state,
        shopping: shop, media: state.media, weather: state.weather && { now: state.weather.t && state.weather.t[now.getHours()], hi: state.weather.hi, lo: state.weather.lo },
        scenes: (state.scenes || []).map(s => s.id + ' (' + s.name + ')'), devices: (state.devices || []).map(d => d.id + ': ' + d.name + ' [' + d.type + ']')
      });
    }
    if (sub === 'scene') { const s = applySceneServer(b.scene); return s ? send(res, 200, { ok: true, scene: s.name }) : send(res, 404, { error: 'No scene ' + b.scene }); }
    if (sub === 'device') {
      const d = findDevice(b.device); if (!d) return send(res, 404, { error: 'No device ' + b.device });
      const devices = state.devices.map(x => x.id === d.id ? Object.assign({}, x, pick(b, DEVICE_STATE_FIELDS)) : x);
      fireDeviceShortcuts(state.devices, devices); commit({ devices }, 'agent');
      return send(res, 200, { ok: true, device: devices.find(x => x.id === d.id) });
    }
    if (sub === 'all-lights-off') {
      const devices = state.devices.map(x => x.type === 'light' ? Object.assign({}, x, { on: false }) : x);
      fireDeviceShortcuts(state.devices, devices); commit({ devices }, 'agent'); return send(res, 200, { ok: true });
    }
    if (sub === 'grocery') {
      if (!b.name) return send(res, 400, { error: 'name required' });
      const hit = (state.catalog || []).find(c => c[0].toLowerCase() === String(b.name).toLowerCase().trim());
      const g = { id: id('g'), name: hit ? hit[0] : String(b.name).trim().replace(/^./, c => c.toUpperCase()), cat: b.cat || (hit ? hit[1] : 'Other'), qty: +b.qty || 1, store: b.store || ((state.stores || [])[0] || {}).id || 'grocer', done: false, note: b.note || '' };
      commit({ groceries: (state.groceries || []).concat([g]) }, 'agent'); return send(res, 200, { ok: true, item: g });
    }
    if (sub === 'grocery-done') {
      const q = String(b.name || '').toLowerCase();
      const groceries = (state.groceries || []).map(g => g.name.toLowerCase() === q ? Object.assign({}, g, { done: true }) : g);
      commit({ groceries }, 'agent'); return send(res, 200, { ok: true });
    }
    if (sub === 'event') {
      const start = new Date(b.start); if (!b.title || isNaN(start)) return send(res, 400, { error: 'title and ISO start required' });
      const people = (b.people || []).map(personId).filter(Boolean);
      const e = { id: id('e'), title: String(b.title), start: start.toISOString(), end: new Date(b.end ? new Date(b.end) : +start + (b.minutes || 60) * 60000).toISOString(),
        people: people.length ? people : (state.people || []).map(x => x.id), allDay: !!b.allDay, loc: b.loc || undefined, notes: b.notes || undefined, travel: b.travel || undefined };
      commit({ events: (state.events || []).concat([e]) }, 'agent'); return send(res, 200, { ok: true, event: e });
    }
    if (sub === 'chore-done') {
      const q = String(b.title || '').toLowerCase(), who = b.who ? personId(b.who) : null;
      let hit = null;
      const chores = (state.chores || []).map(c => { if (!hit && c.title.toLowerCase() === q && (!who || c.who === who)) { hit = c; return Object.assign({}, c, { done: true }); } return c; });
      if (!hit) return send(res, 404, { error: 'No chore ' + b.title });
      commit({ chores }, 'agent'); return send(res, 200, { ok: true });
    }
    if (sub === 'person') {
      const pid = personId(b.person); if (!pid) return send(res, 404, { error: 'No person ' + b.person });
      const people = state.people.map(x => x.id === pid ? Object.assign({}, x, pick(b, ['home', 'status', 'eta'])) : x);
      commit({ people }, 'agent'); return send(res, 200, { ok: true });
    }
    if (sub === 'plex/scan') { try { await plex('/library/sections/all/refresh', { raw: true }); return send(res, 200, { ok: true }); } catch (e) { return send(res, 200, { ok: false, error: e.message }); } }
    if (sub === 'announce') { broadcast({ type: 'announce', text: String(b.text || '').slice(0, 200), icon: b.icon || 'bell' }); return send(res, 200, { ok: true }); }
    return send(res, 404, { error: 'Unknown agent route' });
  }
  return send(res, 404, { error: 'Not found' });
}
// Spotify only accepts https redirect URIs, or http on 127.0.0.1. Use whatever address the admin
// is open on (admin.sabadorks.com through Cloudflare is https).
function spotifyRedirect(req) {
  let proto = 'http';
  try { proto = JSON.parse(req.headers['cf-visitor'] || '{}').scheme || req.headers['x-forwarded-proto'] || 'http'; } catch {}
  let host = String(req.headers.host || 'localhost:' + PORT);
  if (proto === 'http' && /^localhost(:|$)/.test(host)) host = host.replace(/^localhost/, '127.0.0.1');
  return proto + '://' + host + '/api/spotify/callback';
}
function pick(o, keys) { const out = {}; keys.forEach(k => { if (o[k] !== undefined) out[k] = o[k]; }); return out; }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/photos/')) {
      const f = safeJoin(PHOTOS, url.pathname.slice(8));
      if (f && await serveFile(res, f, 'public, max-age=31536000, immutable')) return;
      return send(res, 404, 'Not found');
    }
    if (url.pathname === '/plex-art') {
      const pth = url.searchParams.get('path');
      if (!pth || !pth.startsWith('/')) return send(res, 404, 'No art');
      try {
        const r = await plex('/photo/:/transcode?width=320&height=320&minSize=1&url=' + encodeURIComponent(pth), { raw: true });
        res.writeHead(200, { 'Content-Type': r.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=3600' });
        return res.end(Buffer.from(await r.arrayBuffer()));
      } catch { return send(res, 404, 'No art'); }
    }
    // Pages are never cached; their CSS/JS load from /v/<build>/… so every update reaches the
    // frame right away (Cloudflare otherwise tells browsers to keep files for 4 hours).
    if (FROM_SOURCE) {
      const isAdminPage = (isAdminHost(req) && (url.pathname === '/' || url.pathname === '/index.html')) || url.pathname === '/admin' || url.pathname === '/admin/';
      if (isAdminPage || url.pathname === '/' || url.pathname === '/index.html') return servePage(res, isAdminPage ? 'admin.html' : 'index.html');
      const vm = url.pathname.match(/^\/v\/[\w-]+(\/.*)$/);
      if (vm && SOURCE_OK.test(vm[1]) && await serveFile(res, safeJoin(ROOT, vm[1].slice(1)), 'public, max-age=31536000, immutable')) return;
    }
    if (isAdminHost(req) && (url.pathname === '/' || url.pathname === '/index.html')) { if (await serveFile(res, path.join(DIST, 'admin.html'))) return; }
    if (url.pathname === '/admin' || url.pathname === '/admin/') { if (await serveFile(res, path.join(DIST, 'admin.html'))) return; }
    if (FROM_SOURCE) {
      const rel = url.pathname === '/' ? '/index.html' : url.pathname;
      if (SOURCE_OK.test(rel) && await serveFile(res, safeJoin(ROOT, rel.slice(1)))) return;
      const pub = safeJoin(path.join(ROOT, 'public'), rel.slice(1));
      if (pub && await serveFile(res, pub, 'public, max-age=86400')) return;
      if (!/\.\w+$/.test(rel) && await serveFile(res, path.join(ROOT, 'index.html'))) return;
      return send(res, 404, 'Not found');
    }
    const f = safeJoin(DIST, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    const immutable = url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : null;
    if (f && await serveFile(res, f, immutable)) return;
    if (await serveFile(res, path.join(DIST, 'index.html'))) return;
    send(res, 404, 'Dashboard not built. Run: npm run build');
  } catch (e) {
    log('error', req.method, url.pathname, e.message);
    if (!res.headersSent) send(res, e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.message });
  }
});

// Updating ~/HomeHQ/app restarts the server (launchd's KeepAlive starts it again).
if (process.env.HOMEHQ_DATA) {
  let t = null;
  try {
    fs.watch(ROOT, { recursive: true }, (ev, f) => {
      if (!f || /^data\//.test(f)) return;
      clearTimeout(t); t = setTimeout(() => { log('App files changed: restarting'); if (saveTimer) save(); process.exit(0); }, 1500);
    });
  } catch {}
}

server.listen(PORT, HOST, () => {
  const addrs = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
  log('Home HQ running');
  log('  Dashboard:  http://' + os.hostname().replace(/\.local$/, '') + '.local:' + PORT + '/');
  addrs.forEach(a => log('              http://' + a + ':' + PORT + '/'));
  log('  Admin:      /admin');
  refreshWeather(); refreshPlex(); X.start();
});
