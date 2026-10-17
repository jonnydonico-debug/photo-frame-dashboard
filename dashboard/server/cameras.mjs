// Cameras (Tapo C121 and other RTSP cameras) on the home network.
// The Mac reads each camera's RTSP stream with ffmpeg and serves it to the screens as MJPEG (a
// stream of JPEGs that any browser, including the old frame tablet, shows in a plain <img>).
// One ffmpeg per camera is shared by every viewer and stops when nobody is watching.
// Camera accounts (user/password) live in secrets.json; screens only get id + name.
// ffmpeg: uses one already on the Mac, or downloads a checked static build into data/ffmpeg.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const FF_URL = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64';
const FF_SHA = 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584';
const SIZES = { sd: '640:-2', hd: '1280:-2' };

export function createCameras({ dataDir, secrets, saveSecrets, commit, log }) {
  const DIR = path.join(dataDir, 'ffmpeg'), BIN = path.join(DIR, 'ffmpeg');
  const cams = () => (secrets.cameras = secrets.cameras || []);
  const get = id => cams().find(c => c.id === id);
  let setup = { state: 'unknown', error: '' };
  const hubs = new Map();     // id:quality -> { proc, clients:Set, last, lastAt, stopT, restarts }
  const snaps = new Map();    // id -> { at, buf, pending }

  function ffmpeg() {
    return [process.env.HOMEHQ_FFMPEG, BIN, '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find(p => p && fs.existsSync(p)) || null;
  }
  function status() {
    if (setup.state !== 'installing') setup = ffmpeg() ? { state: 'ready', path: ffmpeg() } : { state: 'missing', error: setup.error };
    return setup;
  }
  async function install() {
    if (ffmpeg()) return status();
    if (setup.state === 'installing') return setup;
    if (process.platform !== 'darwin' || os.arch() !== 'arm64') { setup = { state: 'missing', error: 'Automatic setup needs an Apple Silicon Mac; install ffmpeg with Homebrew instead' }; return setup; }
    setup = { state: 'installing', step: 'Downloading the video tool (about 45 MB)' };
    (async () => {
      try {
        await fsp.mkdir(DIR, { recursive: true });
        const r = await fetch(FF_URL, { signal: AbortSignal.timeout(300000) });
        if (!r.ok) throw new Error('Download failed (' + r.status + ')');
        const buf = Buffer.from(await r.arrayBuffer());
        if (crypto.createHash('sha256').update(buf).digest('hex') !== FF_SHA) throw new Error('The download didn’t match its checksum');
        await fsp.writeFile(BIN + '.part', buf, { mode: 0o755 });
        await fsp.rename(BIN + '.part', BIN);
        setup = { state: 'ready', path: BIN };
        log('cameras: video tool installed');
      } catch (e) { setup = { state: 'missing', error: e.message }; log('cameras: install', e.message); }
    })();
    return setup;
  }

  function rtsp(c, q) {
    const auth = c.user ? encodeURIComponent(c.user) + ':' + encodeURIComponent(c.pass || '') + '@' : '';
    return 'rtsp://' + auth + c.host + ':' + (c.port || 554) + '/' + (q === 'hd' ? (c.hdPath || 'stream1') : (c.sdPath || 'stream2'));
  }
  const explain = msg => /401|Unauthorized/i.test(msg) ? 'The camera refused the account name or password (use the Camera Account set in the Tapo app, not your TP-Link login)'
    : /timed out|Connection refused|No route|Network is unreachable|Host is down/i.test(msg) ? 'The camera didn’t answer at that address. Check its IP in the Tapo app (Device Info).'
    : /404|not found/i.test(msg) ? 'The camera answered but has no stream at that path'
    : msg.split('\n').filter(Boolean).slice(-1)[0] || 'The camera stream failed';

  // ---------------------------------------------------------------- snapshots (tiles)
  function grab(c) {
    return new Promise((resolve, reject) => {
      const ff = ffmpeg(); if (!ff) return reject(new Error('Set up the video tool in Admin → Lights & Home → Cameras first'));
      const p = spawn(ff, ['-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-timeout', '8000000', '-i', rtsp(c, 'sd'), '-frames:v', '1', '-q:v', '5', '-f', 'image2', '-vcodec', 'mjpeg', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const out = []; let err = '';
      p.stdout.on('data', d => out.push(d)); p.stderr.on('data', d => { err += d; });
      const t = setTimeout(() => p.kill('SIGKILL'), 15000);
      p.on('close', code => { clearTimeout(t); const b = Buffer.concat(out); b.length > 1000 ? resolve(b) : reject(new Error(explain(err || 'No picture from the camera'))); });
      p.on('error', e => { clearTimeout(t); reject(e); });
    });
  }
  async function snapshot(id) {
    const c = get(id); if (!c) throw Object.assign(new Error('No such camera'), { status: 404 });
    // A live stream already running has a fresh frame
    for (const [k, h] of hubs) if (k.startsWith(id + ':') && h.last && Date.now() - h.lastAt < 5000) return h.last;
    const s = snaps.get(id) || {};
    if (s.buf && Date.now() - s.at < 15000) return s.buf;
    if (s.pending) return s.pending;
    const pending = grab(c).then(buf => { snaps.set(id, { at: Date.now(), buf }); return buf; }).finally(() => { const x = snaps.get(id); if (x) delete x.pending; });
    snaps.set(id, Object.assign({}, s, { pending }));
    return pending;
  }

  // ---------------------------------------------------------------- live (MJPEG)
  function startHub(key, c, q) {
    const ff = ffmpeg(); if (!ff) return null;
    const h = hubs.get(key) || { clients: new Set(), last: null, lastAt: 0, restarts: 0 };
    hubs.set(key, h);
    const p = spawn(ff, ['-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-timeout', '8000000', '-i', rtsp(c, q),
      '-an', '-vf', 'fps=12,scale=' + SIZES[q], '-q:v', q === 'hd' ? '6' : '5', '-f', 'mjpeg', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    h.proc = p;
    let buf = Buffer.alloc(0), err = '';
    p.stdout.on('data', d => {
      buf = Buffer.concat([buf, d]);
      // Cut complete JPEGs (FFD8 … FFD9) out of the stream
      for (;;) {
        const s = buf.indexOf(Buffer.from([0xff, 0xd8])); if (s < 0) { buf = Buffer.alloc(0); break; }
        const e = buf.indexOf(Buffer.from([0xff, 0xd9]), s + 2); if (e < 0) { if (s > 0) buf = buf.slice(s); break; }
        const frame = buf.slice(s, e + 2); buf = buf.slice(e + 2);
        h.last = frame; h.lastAt = Date.now(); h.restarts = 0;
        const head = '--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ' + frame.length + '\r\n\r\n';
        for (const res of h.clients) {
          if (res.writableLength > 1.5e6) continue; // slow viewer: skip frames rather than pile up
          res.write(head); res.write(frame); res.write('\r\n');
        }
      }
      if (buf.length > 4e6) buf = Buffer.alloc(0);
    });
    p.stderr.on('data', d => { err = (err + d).slice(-2000); });
    p.on('close', () => {
      if (h.proc !== p) return;
      h.proc = null;
      if (!h.clients.size) return;
      h.restarts++;
      if (h.restarts === 1 || h.restarts % 10 === 0) log('cameras:', c.name, explain(err || 'stream ended'));
      setTimeout(() => { if (h.clients.size && !h.proc) startHub(key, c, q); }, Math.min(30000, 2000 * h.restarts));
    });
    return h;
  }
  function live(req, res, id, q) {
    const c = get(id); if (!c) { res.writeHead(404); return res.end(); }
    q = q === 'hd' ? 'hd' : 'sd';
    if (!ffmpeg()) { res.writeHead(409, { 'Content-Type': 'text/plain' }); return res.end('Set up the video tool in Admin first'); }
    const key = id + ':' + q;
    let h = hubs.get(key);
    if (!h || !h.proc) h = startHub(key, c, q);
    clearTimeout(h.stopT);
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    if (h.last && Date.now() - h.lastAt < 3000) { res.write('--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ' + h.last.length + '\r\n\r\n'); res.write(h.last); res.write('\r\n'); }
    h.clients.add(res);
    const bye = () => {
      h.clients.delete(res);
      if (!h.clients.size) { clearTimeout(h.stopT); h.stopT = setTimeout(() => { if (!h.clients.size && h.proc) { h.proc.kill('SIGTERM'); h.proc = null; } }, 15000); }
    };
    req.on('close', bye); res.on('error', bye);
  }

  // ---------------------------------------------------------------- setup (Admin)
  function publish() { commit({ cameras: cams().map(c => ({ id: c.id, name: c.name, live: true })) }, 'server'); }
  function list() { return cams().map(c => ({ id: c.id, name: c.name, host: c.host, user: c.user, quality: c.quality || 'sd', hasPass: !!c.pass })); }
  async function add(b) {
    const host = String(b.host || '').trim().replace(/^rtsp:\/\//, '').replace(/[/:].*$/, '');
    if (!/^[\w.-]+$/.test(host)) throw Object.assign(new Error('Enter the camera’s IP address, e.g. 192.168.0.60'), { status: 400 });
    if (!b.user || !b.pass) throw Object.assign(new Error('Enter the Camera Account name and password from the Tapo app'), { status: 400 });
    const c = { id: 'cam-' + crypto.randomBytes(3).toString('hex'), name: String(b.name || 'Camera').trim().slice(0, 30) || 'Camera', host, user: String(b.user).trim(), pass: String(b.pass), quality: b.quality === 'hd' ? 'hd' : 'sd' };
    if (!ffmpeg()) throw Object.assign(new Error('Set up the video tool first (button above), then add the camera'), { status: 400 });
    // Check it works before saving
    try { await grab(c); } catch (e) { throw Object.assign(new Error(e.message), { status: 400 }); }
    cams().push(c); saveSecrets(); publish();
    return { id: c.id };
  }
  function remove(id) {
    for (const [k, h] of hubs) if (k.startsWith(id + ':')) { if (h.proc) h.proc.kill('SIGTERM'); for (const r of h.clients) r.end(); hubs.delete(k); }
    secrets.cameras = cams().filter(c => c.id !== id); saveSecrets(); publish();
  }
  function rename(id, name) { const c = get(id); if (c && name) { c.name = String(name).trim().slice(0, 30); saveSecrets(); publish(); } }
  function start() { status(); if (cams().length) publish(); }

  return { start, status, install, list, add, remove, rename, snapshot, live, quality: id => (get(id) || {}).quality || 'sd' };
}
