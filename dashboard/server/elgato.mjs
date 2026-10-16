// Elgato Key Lights (MK.2 and friends) over the home network — no account or cloud.
// Each light runs a small web server on port 9123 (GET/PUT /elgato/lights). The Mac finds them
// with Bonjour (`dns-sd`, built into macOS); lights can also be added by IP in Admin.
// They show up as devices in the "Free Roam" section with on/off, brightness and colour
// temperature, and are re-read every 15 s so changes from Elgato's own app show too.
import { spawn } from 'node:child_process';
import dns from 'node:dns/promises';

const IS_MAC = process.platform === 'darwin';
const ROOM = { id: 'freeroam', name: 'Free Roam' };
const KELVIN = [2900, 7000]; // what the Key Light can do (API 344..143)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const toApiTemp = k => clamp(Math.round(1e6 / clamp(k, KELVIN[0], KELVIN[1])), 143, 344);
const toKelvin = t => Math.round(1e6 / t / 50) * 50;

function run(cmd, args, ms, onLine) {
  return new Promise(resolve => {
    let p; try { p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return resolve(); }
    let buf = '';
    p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (onLine(l) === true) p.kill(); } });
    p.on('error', () => resolve()); p.on('close', () => resolve());
    setTimeout(() => p.kill(), ms);
  });
}

export function createElgato({ getState, commit, secrets, saveSecrets, log }) {
  const cfg = () => (secrets.elgato = secrets.elgato || { hosts: [] });
  let status = { found: 0, checked: null, error: '', busy: false };
  const lastSet = {}; // id -> time of our last change (don't let a poll undo it)

  const base = h => 'http://' + (h.includes(':') ? h : h + ':9123') + '/elgato/';
  async function req(host, path, body) {
    const r = await fetch(base(host) + path, { method: body ? 'PUT' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error('Key Light said ' + r.status);
    return r.json();
  }

  // ---------------------------------------------------------------- finding lights (Bonjour)
  async function browse() {
    if (!IS_MAC) return [];
    const names = new Set();
    await run('/usr/bin/dns-sd', ['-B', '_elg._tcp', 'local.'], 4000, l => { const m = /\sAdd\s+\d+\s+\d+\s+\S+\s+_elg\._tcp\.\s+(.+?)\s*$/.exec(l); if (m) names.add(m[1]); });
    const hosts = [];
    for (const n of names) {
      let host = null;
      await run('/usr/bin/dns-sd', ['-L', n, '_elg._tcp', 'local.'], 3000, l => { const m = /reached at (\S+?)\.?:(\d+)/.exec(l); if (m) { host = m[1] + ':' + m[2]; return true; } });
      if (!host) continue;
      // Store the IP (faster and steadier than .local lookups); keep the name if lookup fails
      const [h, port] = host.split(':');
      try { const a = await dns.lookup(h, { family: 4 }); hosts.push(a.address + ':' + port); } catch { hosts.push(host); }
    }
    return hosts;
  }

  function devices() { return (getState().devices || []).filter(d => d.source === 'elgato'); }
  function ensureRoom(rooms) { return rooms.some(r => r.id === ROOM.id) ? rooms : rooms.concat([ROOM]); }

  async function discover() {
    if (status.busy) return status;
    status.busy = true;
    try {
      const found = await browse();
      const hosts = [...new Set(found.concat(cfg().hosts || []).concat(devices().map(d => d.el && d.el.host).filter(Boolean)))];
      const seen = [];
      for (const host of hosts) {
        try {
          const [info, st] = await Promise.all([req(host, 'accessory-info'), req(host, 'lights')]);
          seen.push({ host, info, light: (st.lights || [])[0] || {} });
        } catch (e) { /* not reachable right now */ }
      }
      let list = (getState().devices || []).slice(), changed = false, n = devices().length;
      for (const s of seen) {
        const id = 'el-' + String(s.info.serialNumber || s.host).replace(/[^\w]/g, '').toLowerCase();
        const L = s.light, fields = { on: !!L.on, level: L.brightness || 100, kelvin: L.temperature ? toKelvin(L.temperature) : null, online: true, el: { host: s.host, model: s.info.productName || 'Key Light' } };
        const i = list.findIndex(d => d.id === id);
        if (i < 0) {
          n++;
          list.push(Object.assign({ id, name: s.info.displayName || 'Key Light ' + n, type: 'light', room: ROOM.id, source: 'elgato', caps: { kelvin: KELVIN } }, fields));
          changed = true;
        } else if (JSON.stringify(Object.assign({}, list[i], fields)) !== JSON.stringify(list[i])) { list[i] = Object.assign({}, list[i], fields); changed = true; }
      }
      // Lights that didn't answer are shown as offline (not removed)
      list = list.map(d => d.source === 'elgato' && !seen.some(s => d.el && s.host === d.el.host) && d.online !== false ? (changed = true, Object.assign({}, d, { online: false })) : d);
      const rooms = devices().length || seen.length ? ensureRoom(getState().rooms || []) : getState().rooms;
      if (changed || rooms !== getState().rooms) commit({ devices: list, rooms }, 'server');
      status = { found: seen.length, checked: new Date().toISOString(), error: seen.length ? '' : (IS_MAC ? 'No Key Lights answered. Are they on the same Wi-Fi as the Mac mini?' : 'Searching only works on the Mac'), busy: false };
    } catch (e) { status = Object.assign(status, { error: e.message, busy: false }); log('elgato:', e.message); }
    status.busy = false;
    return status;
  }

  // ---------------------------------------------------------------- reading + setting
  async function poll() {
    const list = devices(); if (!list.length) return;
    let all = (getState().devices || []).slice(), changed = false;
    for (const d of list) {
      if (Date.now() - (lastSet[d.id] || 0) < 6000) continue;
      try {
        const L = ((await req(d.el.host, 'lights')).lights || [])[0] || {};
        const next = { on: !!L.on, level: L.brightness || d.level, kelvin: L.temperature ? toKelvin(L.temperature) : d.kelvin, online: true };
        if (Object.keys(next).some(k => next[k] !== d[k])) { all = all.map(x => x.id === d.id ? Object.assign({}, x, next) : x); changed = true; }
      } catch { if (d.online !== false) { all = all.map(x => x.id === d.id ? Object.assign({}, x, { online: false }) : x); changed = true; } }
    }
    if (changed) commit({ devices: all }, 'server');
  }
  // Called when a screen, scene or agent changed one of these lights
  async function apply(d) {
    if (!d.el || !d.el.host) return;
    lastSet[d.id] = Date.now();
    const light = { on: d.on ? 1 : 0 };
    if (d.level) light.brightness = clamp(Math.round(d.level), 3, 100);
    if (d.kelvin) light.temperature = toApiTemp(d.kelvin);
    try { await req(d.el.host, 'lights', { numberOfLights: 1, lights: [light] }); }
    catch (e) { log('elgato', d.name + ':', e.name === 'TimeoutError' ? 'no answer' : e.message); }
  }

  function addHost(host) {
    host = String(host || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^[\w.-]+(:\d+)?$/.test(host)) throw Object.assign(new Error('Enter the light’s IP address, e.g. 192.168.0.50'), { status: 400 });
    const c = cfg(); if (!c.hosts.includes(host)) c.hosts.push(host); saveSecrets();
    return discover();
  }
  function removeHost(host) { const c = cfg(); c.hosts = c.hosts.filter(h => h !== host); saveSecrets(); }

  let t1 = null, t2 = null;
  function start() {
    clearInterval(t1); clearInterval(t2);
    setTimeout(discover, 3000);
    t1 = setInterval(poll, 15000);
    t2 = setInterval(discover, 10 * 60000);
  }
  return { start, discover, apply, addHost, removeHost, status: () => Object.assign({ hosts: cfg().hosts, lights: devices().map(d => ({ name: d.name, host: d.el && d.el.host, online: d.online !== false })) }, status) };
}
