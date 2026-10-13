// Govee lights through Govee's cloud API (the same lights as the Govee Home app).
// Lights show up as ordinary dashboard devices (type 'light', source 'govee') so the frame, the
// phone app and iMessage all control them the same way. The API key stays on the Mac mini.
import crypto from 'node:crypto';

const BASE = process.env.HOMEHQ_GOVEE_BASE || 'https://openapi.api.govee.com/router/api/v1'; // override only for tests
const CAP = {
  power: ['devices.capabilities.on_off', 'powerSwitch'],
  brightness: ['devices.capabilities.range', 'brightness'],
  color: ['devices.capabilities.color_setting', 'colorRgb'],
  kelvin: ['devices.capabilities.color_setting', 'colorTemperatureK'],
  scene: ['devices.capabilities.dynamic_scene', 'lightScene']
};
const POLL_MS = 90000;          // Govee allows 10,000 calls a day per account; 90 s keeps a few lights well under
const QUIET_MS = 20000;         // after a change, ignore the cloud's (briefly stale) state for that light

export function createGovee({ getState, commit, secrets, saveSecrets, log }) {
  let status = { ok: null };
  let timer = null, discoverTimer = null;
  const touched = new Map();     // device id -> last time we sent it a command
  const sceneCache = new Map();  // device id -> { at, options }
  const queue = new Map();       // device id -> promise chain (one command at a time per light)

  async function api(path, body) {
    const key = secrets.goveeKey;
    if (!key) throw Object.assign(new Error('Add your Govee API key in Admin → Lights & Home'), { status: 400 });
    const r = await fetch(BASE + path, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: Object.assign({ 'Govee-API-Key': key }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    let j = null; try { j = await r.json(); } catch {}
    const code = j && j.code != null ? +j.code : r.status;
    if (r.status === 401 || r.status === 403 || code === 401 || code === 403) throw Object.assign(new Error('Govee didn’t accept that API key'), { status: 403 });
    if (r.status === 429 || code === 429) throw Object.assign(new Error('Govee says slow down · try again in a minute'), { status: 429 });
    if (!r.ok || code !== 200) throw Object.assign(new Error('Govee error ' + code + (j && j.msg ? ': ' + j.msg : '')), { status: 409 });
    return j;
  }
  const rid = () => crypto.randomUUID();
  const devId = mac => 'gv-' + String(mac).replace(/[^0-9a-z]/gi, '').toLowerCase();
  const hex = n => '#' + (Math.max(0, Math.min(0xFFFFFF, n | 0))).toString(16).padStart(6, '0').toUpperCase();
  const capOf = (caps, k) => (caps || []).find(c => c.type === CAP[k][0] && c.instance === CAP[k][1]);

  // ---------------------------------------------------------------- discovery
  async function discover() {
    const j = await api('/user/devices');
    const lights = (j.data || []).filter(d => d && d.type === 'devices.types.light');
    const S = getState();
    let devices = (S.devices || []).slice(), rooms = (S.rooms || []).slice(), changed = false;
    if (lights.length && !rooms.length) { rooms.push({ id: 'living', name: 'Living Room' }); changed = true; }
    for (const L of lights) {
      const id = devId(L.device), b = capOf(L.capabilities, 'brightness'), k = capOf(L.capabilities, 'kelvin');
      const gv = {
        sku: L.sku, device: L.device,
        bright: b && b.parameters && b.parameters.range ? [b.parameters.range.min, b.parameters.range.max] : [1, 100],
        color: !!capOf(L.capabilities, 'color'),
        kelvin: k && k.parameters && k.parameters.range ? [k.parameters.range.min, k.parameters.range.max] : null,
        scenes: true  // scene lists come from /device/scenes
      };
      const i = devices.findIndex(d => d.id === id);
      if (i < 0) { devices.push({ id, room: rooms[0].id, type: 'light', name: L.deviceName || L.sku, on: false, level: 100, source: 'govee', gv }); changed = true; }
      else if (JSON.stringify(devices[i].gv) !== JSON.stringify(gv) || devices[i].source !== 'govee') { devices[i] = Object.assign({}, devices[i], { source: 'govee', gv }); changed = true; }
    }
    if (changed) commit({ devices, rooms }, 'server');
    status = { ok: true, lights: lights.length, checked: new Date().toISOString() };
    return lights.length;
  }

  // ---------------------------------------------------------------- state
  async function readState(d) {
    const j = await api('/device/state', { requestId: rid(), payload: { sku: d.gv.sku, device: d.gv.device } });
    const caps = (j.payload && j.payload.capabilities) || [];
    const val = inst => { const c = caps.find(x => x.instance === inst); return c && c.state ? c.state.value : undefined; };
    const out = {};
    const online = val('online'); if (online !== undefined) out.online = online !== false;
    const p = val('powerSwitch'); if (p !== undefined) out.on = !!+p;
    const br = val('brightness'); if (typeof br === 'number' && br > 0) out.level = Math.round(br);
    const c = val('colorRgb'); if (typeof c === 'number' && c > 0) out.color = hex(c);
    const kv = val('colorTemperatureK'); if (typeof kv === 'number' && kv > 0) out.kelvin = kv;
    return out;
  }
  async function poll() {
    if (!secrets.goveeKey) return;
    const S = getState();
    const mine = (S.devices || []).filter(d => d.source === 'govee' && d.gv);
    if (!mine.length) return;
    let devices = null;
    for (const d of mine) {
      if (Date.now() - (touched.get(d.id) || 0) < QUIET_MS) continue;
      try {
        const st = await readState(d);
        const cur = (getState().devices || []).find(x => x.id === d.id); if (!cur) continue;
        const diff = Object.keys(st).filter(k => cur[k] !== st[k]);
        if (diff.length) { devices = devices || (getState().devices || []).slice(); const i = devices.findIndex(x => x.id === d.id); devices[i] = Object.assign({}, devices[i], st); }
        status = { ok: true, lights: mine.length, checked: new Date().toISOString() };
      } catch (e) { status = { ok: false, error: e.message, checked: new Date().toISOString() }; if (e.status === 403) break; }
    }
    if (devices) commit({ devices }, 'server');
  }

  // ---------------------------------------------------------------- control
  function send(d, kind, value) {
    return api('/device/control', { requestId: rid(), payload: { sku: d.gv.sku, device: d.gv.device, capability: { type: CAP[kind][0], instance: CAP[kind][1], value } } });
  }
  // Called whenever a Govee light's state changes on any screen. Sends only what changed.
  function apply(d, old) {
    if (!d || d.source !== 'govee' || !d.gv || !secrets.goveeKey) return;
    touched.set(d.id, Date.now());
    const steps = [];
    const lo = d.gv.bright ? d.gv.bright[0] : 1, hi = d.gv.bright ? d.gv.bright[1] : 100;
    if (d.on && d.color && d.color !== (old && old.color) && d.gv.color) steps.push(['color', parseInt(d.color.slice(1), 16)]);
    else if (d.on && d.kelvin && d.kelvin !== (old && old.kelvin) && d.gv.kelvin) steps.push(['kelvin', Math.max(d.gv.kelvin[0], Math.min(d.gv.kelvin[1], Math.round(d.kelvin)))]);
    if (d.on && d.level && d.level !== (old && old.level)) steps.push(['brightness', Math.max(lo, Math.min(hi, Math.round(d.level)))]);
    if (!old || !!d.on !== !!old.on) steps.unshift(['power', d.on ? 1 : 0]);
    if (!steps.length) return;
    const prev = queue.get(d.id) || Promise.resolve();
    const run = prev.then(async () => {
      for (const [k, v] of steps) {
        try { await send(d, k, v); }
        catch (e) { status = { ok: false, error: e.message, checked: new Date().toISOString() }; log('govee:', d.name, k, e.message); break; }
      }
      touched.set(d.id, Date.now());
    });
    queue.set(d.id, run.catch(() => {}));
    return run;
  }
  async function scenes(id) {
    const d = (getState().devices || []).find(x => x.id === id && x.source === 'govee');
    if (!d) throw Object.assign(new Error('Not a Govee light'), { status: 404 });
    const hit = sceneCache.get(id);
    if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.options;
    const j = await api('/device/scenes', { requestId: rid(), payload: { sku: d.gv.sku, device: d.gv.device } });
    const options = [];
    for (const c of (j.payload && j.payload.capabilities) || []) for (const o of (c.parameters && c.parameters.options) || []) if (o && o.name) options.push({ name: o.name, value: o.value });
    sceneCache.set(id, { at: Date.now(), options });
    return options;
  }
  async function playScene(id, name) {
    const d = (getState().devices || []).find(x => x.id === id && x.source === 'govee');
    if (!d) throw Object.assign(new Error('Not a Govee light'), { status: 404 });
    const opt = (await scenes(id)).find(o => o.name === name);
    if (!opt) throw Object.assign(new Error('That scene isn’t available on this light'), { status: 404 });
    touched.set(id, Date.now());
    await send(d, 'scene', opt.value);
    const devices = (getState().devices || []).map(x => x.id === id ? Object.assign({}, x, { on: true, scene: name }) : x);
    commit({ devices }, 'server');
    return { ok: true };
  }

  async function setKey(key) {
    secrets.goveeKey = String(key || '').trim(); saveSecrets();
    clearInterval(timer); clearInterval(discoverTimer); status = { ok: null };
    if (!secrets.goveeKey) {
      // Forget the Govee lights (they can't be controlled any more)
      const S = getState();
      commit({ devices: (S.devices || []).filter(d => d.source !== 'govee') }, 'admin');
      return { ok: true, lights: 0 };
    }
    try { const n = await discover(); start(); return { ok: true, lights: n }; }
    catch (e) { if (e.status === 403) { secrets.goveeKey = ''; saveSecrets(); } status = { ok: false, error: e.message }; throw e; }
  }
  function start() {
    clearInterval(timer);
    if (!secrets.goveeKey) return;
    discover().then(poll).catch(e => { status = { ok: false, error: e.message }; log('govee:', e.message); });
    timer = setInterval(() => poll().catch(() => {}), POLL_MS);
    // New lights added in the Govee app show up within a few hours
    clearInterval(discoverTimer);
    discoverTimer = setInterval(() => discover().catch(() => {}), 6 * 3600e3);
  }

  return { start, apply, scenes, playScene, setKey, discover, status: () => ({ set: !!secrets.goveeKey, status }) };
}
