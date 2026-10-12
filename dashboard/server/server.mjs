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
const OPEN_KEYS = ['chores', 'stars', 'week', 'groceries', 'events', 'devices', 'climate'];
// Keys only an admin (or the agent token) may change.
const ADMIN_KEYS = ['people', 'family', 'routines', 'stores', 'catOrder', 'catalog', 'usuals', 'rooms',
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
  return { title: 'Home HQ', units: 'fahrenheit', place: '', lat: null, lon: null, demo: true, hiddenViews: [] };
}
function blankState() {
  const s = demoState();
  s.events = []; s.chores = []; s.groceries = []; s.photos = [];
  s.stars = {}; s.week = {};
  s.people = [{ id: 'me', name: 'Me', color: '#2D5BFF', rgb: '45 91 255', ink: '#FFFFFF', home: true, status: 'Home' }];
  s.settings = Object.assign(defaultSettings(), s.settings || {}, { demo: false });
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
state.settings = Object.assign(defaultSettings(), state.settings || {});

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}
function save() {
  const json = JSON.stringify({ rev, savedAt: new Date().toISOString(), state }, null, 1);
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
  res.writeHead(code, Object.assign({ 'Content-Type': isObj ? 'application/json' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
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
  const p = url.pathname, m = req.method, admin = isAdmin(req), ip = clientIp(req), home = isPrivate(ip) && !viaInternet(req);
  const needAdmin = () => { if (!admin) { send(res, 401, { error: 'Admin login required' }); return true; } return false; };
  if (m !== 'GET' && m !== 'HEAD' && !admin && req.headers['x-hq'] !== '1') return send(res, 403, { error: 'Missing X-HQ header' });

  if (p === '/api/state' && m === 'GET') return send(res, 200, { rev, state });
  if (p === '/api/me') return send(res, 200, { admin, home, demoBuild: FROM_SOURCE });
  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\ndata: ' + JSON.stringify({ type: 'hello', rev }) + '\n\n');
    streams.add(res);
    req.on('close', () => streams.delete(res));
    return;
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
        clean.devices = state.devices.map(d => {
          const n = incoming[d.id]; if (!n) return d;
          const out = Object.assign({}, d); DEVICE_STATE_FIELDS.forEach(f => { if (f in n) out[f] = n[f]; }); return out;
        });
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
    if (sub === 'geocode' && m === 'GET') {
      const q = url.searchParams.get('q') || '';
      try {
        const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=6&name=' + encodeURIComponent(q), { signal: AbortSignal.timeout(8000) });
        const j = await r.json();
        return send(res, 200, (j.results || []).map(x => ({ name: [x.name, x.admin1, x.country_code].filter(Boolean).join(', '), lat: x.latitude, lon: x.longitude })));
      } catch (e) { return send(res, 502, { error: e.message }); }
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

server.listen(PORT, HOST, () => {
  const addrs = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
  log('Home HQ running');
  log('  Dashboard:  http://' + os.hostname().replace(/\.local$/, '') + '.local:' + PORT + '/');
  addrs.forEach(a => log('              http://' + a + ':' + PORT + '/'));
  log('  Admin:      /admin');
  refreshWeather(); refreshPlex();
});
