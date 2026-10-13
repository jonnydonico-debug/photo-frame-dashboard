// Apple TV remote through pyatv (Python). One-time setup from Admin downloads a private copy of
// Python + pyatv into ~/HomeHQ/data/tv (nothing system-wide), then pairs with the TV using the
// code it shows on screen. After that the dashboard can wake/sleep it, use the remote buttons,
// change volume, open apps and see what's playing.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const PBS = 'https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest';

export function createAppleTV({ dataDir, here, commit, secrets, saveSecrets, log }) {
  const DIR = path.join(dataDir, 'tv');
  const VENV = path.join(DIR, 'venv');
  const VPY = path.join(VENV, 'bin', 'python3');
  const STORE = path.join(DIR, 'pyatv.conf');
  const HELPER = process.env.HOMEHQ_TV_HELPER || path.join(here, 'tv_helper.py'); // override only for tests
  let setup = { state: fs.existsSync(VPY) ? 'ready' : 'missing', step: '', error: '' };
  let helper = null, ready = null, seq = 0, retry = null, retryMs = 30000;
  const waiting = new Map();
  let tv = { connected: false };
  let appsCache = null;
  let pairing = null; // { id, protocol }

  const push = () => commit({ tv: Object.assign({ paired: !!(secrets.tv && secrets.tv.id), name: secrets.tv && secrets.tv.name }, tv) }, 'server');
  const err = (msg, status) => Object.assign(new Error(msg), { status: status || 409 });

  // ---------------------------------------------------------------- one-time install
  function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, Object.assign({ stdio: ['ignore', 'pipe', 'pipe'] }, opts));
      let outTxt = '';
      p.stdout.on('data', d => { outTxt = (outTxt + d).slice(-4000); });
      p.stderr.on('data', d => { outTxt = (outTxt + d).slice(-4000); });
      const kill = setTimeout(() => p.kill('SIGKILL'), opts.timeout || 600000);
      p.on('error', e => { clearTimeout(kill); reject(e); });
      p.on('close', code => { clearTimeout(kill); code === 0 ? resolve(outTxt) : reject(new Error(outTxt.trim().split('\n').slice(-3).join(' ') || cmd + ' failed')); });
    });
  }
  function systemPython() {
    // A Python already on the Mac, if it's new enough (pyatv needs 3.9+). Never call the
    // /usr/bin/python3 stub unless the Command Line Tools are installed (it pops up an installer).
    const cands = ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/Library/Frameworks/Python.framework/Versions/Current/bin/python3'];
    if (fs.existsSync('/Library/Developer/CommandLineTools/usr/bin/python3')) cands.push('/Library/Developer/CommandLineTools/usr/bin/python3');
    return cands.filter(p => fs.existsSync(p));
  }
  async function okVersion(py) {
    try { const v = await run(py, ['-c', 'import sys;print("%d.%d" % sys.version_info[:2])'], { timeout: 15000 }); const [a, b] = v.trim().split('.').map(Number); return a === 3 && b >= 9 && b <= 13; }
    catch { return false; }
  }
  async function downloadPython() {
    const arch = os.arch() === 'arm64' ? 'aarch64' : 'x86_64';
    setup.step = 'Finding a Python build';
    const rel = await (await fetch(PBS, { headers: { 'User-Agent': 'HomeHQ', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) })).json();
    const re = new RegExp('^cpython-3\\.12\\.\\d+\\+\\d+-' + arch + '-apple-darwin-install_only\\.tar\\.gz$');
    const asset = (rel.assets || []).find(a => re.test(a.name));
    if (!asset) throw new Error('No Python download found for this Mac');
    const sums = (rel.assets || []).find(a => a.name === 'SHA256SUMS');
    setup.step = 'Downloading Python (about 20 MB)';
    const buf = Buffer.from(await (await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(300000) })).arrayBuffer());
    if (sums) {
      const txt = await (await fetch(sums.browser_download_url, { signal: AbortSignal.timeout(30000) })).text();
      const line = txt.split('\n').find(l => l.trim().endsWith(asset.name));
      const want = line && line.trim().split(/\s+/)[0];
      const got = crypto.createHash('sha256').update(buf).digest('hex');
      if (want && want !== got) throw new Error('Python download didn’t match its checksum');
    }
    await fsp.mkdir(DIR, { recursive: true });
    const tgz = path.join(DIR, 'python.tar.gz');
    await fsp.writeFile(tgz, buf);
    setup.step = 'Unpacking Python';
    await fsp.rm(path.join(DIR, 'python'), { recursive: true, force: true });
    await run('/usr/bin/tar', ['-xzf', tgz, '-C', DIR]);
    await fsp.rm(tgz, { force: true });
    return path.join(DIR, 'python', 'bin', 'python3');
  }
  async function install() {
    if (setup.state === 'installing') return setup;
    setup = { state: 'installing', step: 'Checking for Python', error: '' };
    (async () => {
      try {
        await fsp.mkdir(DIR, { recursive: true });
        let py = null;
        for (const c of systemPython()) if (await okVersion(c)) { py = c; break; }
        if (!py) py = await downloadPython();
        setup.step = 'Setting up';
        await fsp.rm(VENV, { recursive: true, force: true });
        await run(py, ['-m', 'venv', VENV], { timeout: 120000 });
        setup.step = 'Installing the Apple TV remote (pyatv)';
        await run(path.join(VENV, 'bin', 'pip'), ['install', '--disable-pip-version-check', '-q', 'pyatv>=0.14,<1'], { timeout: 900000 });
        setup = { state: 'ready', step: '', error: '' };
        log('appletv: pyatv installed');
        startHelper();
      } catch (e) {
        setup = { state: 'error', step: '', error: e.message };
        log('appletv setup:', e.message);
      }
    })();
    return setup;
  }

  // ---------------------------------------------------------------- the helper process
  function startHelper() {
    if (helper || !fs.existsSync(VPY)) return;
    fs.mkdirSync(DIR, { recursive: true });
    helper = spawn(VPY, [HELPER, STORE], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let resolveReady;
    ready = new Promise(r => { resolveReady = r; });
    helper.stdout.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.event === 'ready') { resolveReady(); onReady(); }
        else if (m.event === 'state') onState(m.data);
        else if (m.event === 'log') { if (process.env.HOMEHQ_DEBUG) log('appletv:', m.data); }
        else if (m.id != null && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); clearTimeout(w.t); m.ok ? w.resolve(m.result) : w.reject(err(m.error)); }
      }
    });
    helper.stderr.on('data', d => { if (process.env.HOMEHQ_DEBUG) log('appletv stderr:', String(d).trim()); });
    helper.on('close', code => {
      helper = null; tv = { connected: false }; push();
      for (const w of waiting.values()) { clearTimeout(w.t); w.reject(err('Apple TV helper stopped')); }
      waiting.clear();
      if (code !== 0) log('appletv: helper exited', code);
      if (setup.state === 'ready') setTimeout(startHelper, 15000);
    });
  }
  async function call(cmd, args, timeout) {
    if (!helper) { if (setup.state !== 'ready') throw err('Set up the Apple TV in Admin → Lights & Home first', 400); startHelper(); }
    await ready;
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { waiting.delete(id); reject(err('The Apple TV didn’t answer')); }, timeout || 20000);
      waiting.set(id, { resolve, reject, t });
      helper.stdin.write(JSON.stringify({ id, cmd, args: args || {} }) + '\n');
    });
  }
  function onReady() { if (secrets.tv && secrets.tv.id) connect(); }
  function onState(s) {
    tv = Object.assign({}, tv, s);
    if (!s.connected && secrets.tv && secrets.tv.id) scheduleRetry();
    push();
  }
  function scheduleRetry() {
    clearTimeout(retry);
    retry = setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 5 * 60000);
  }
  async function connect() {
    clearTimeout(retry);
    if (!secrets.tv || !secrets.tv.id) return;
    try { const s = await call('connect', { id: secrets.tv.id }, 30000); tv = Object.assign({}, tv, s); retryMs = 30000; push(); }
    catch (e) { tv = { connected: false, error: e.message }; push(); scheduleRetry(); }
  }

  // ---------------------------------------------------------------- routes
  async function route(req, res, p, m, url, readBody, send) {
    const sub = p.replace(/^\/api\/home\/tv\/?/, '');
    if (sub === '' && m === 'GET') return send(res, 200, status());
    const b = m === 'POST' ? await readBody(req) : {};
    if (sub === 'key' && m === 'POST') { await call('key', { name: b.name, hold: !!b.hold, double: !!b.double }); return send(res, 200, { ok: true }); }
    if (sub === 'power' && m === 'POST') { await call('power', { on: !!b.on }, 30000); return send(res, 200, { ok: true }); }
    if (sub === 'volume' && m === 'POST') { await call('volume', { level: +b.level }); return send(res, 200, { ok: true }); }
    if (sub === 'apps') {
      if (!appsCache || Date.now() - appsCache.at > 10 * 60000) appsCache = { at: Date.now(), list: await call('apps', {}, 20000) };
      return send(res, 200, appsCache.list);
    }
    if (sub === 'launch' && m === 'POST') { await call('launch', { id: String(b.id || '') }); return send(res, 200, { ok: true }); }
    return send(res, 404, { error: 'Not found' });
  }
  async function admin(sub, req, res, readBody, send) {
    const b = req.method === 'POST' ? await readBody(req) : {};
    if (sub === 'install') return send(res, 200, await install());
    if (sub === 'scan') return send(res, 200, await call('scan', { timeout: 6 }, 20000));
    if (sub === 'pair') {
      // Pairs Companion (remote, apps, power) then AirPlay (what's playing, volume): two codes.
      const r = await call('pair_begin', { id: String(b.id || '') }, 30000);
      if (r.done) {
        secrets.tv = { id: String(b.id), name: String(b.name || 'Apple TV') }; saveSecrets();
        pairing = null; connect();
        return send(res, 200, { done: true });
      }
      pairing = { id: String(b.id), name: String(b.name || 'Apple TV'), protocol: r.protocol };
      return send(res, 200, r);
    }
    if (sub === 'pin') {
      if (!pairing) return send(res, 400, { error: 'Start pairing first' });
      await call('pair_pin', { pin: String(b.pin || '') }, 30000);
      return send(res, 200, { ok: true, paired: pairing.protocol });
    }
    if (sub === 'cancel') { pairing = null; await call('pair_cancel', {}).catch(() => {}); return send(res, 200, { ok: true }); }
    if (sub === 'forget') {
      if (secrets.tv && secrets.tv.id) await call('forget', { id: secrets.tv.id }, 20000).catch(() => {});
      secrets.tv = null; saveSecrets(); tv = { connected: false }; appsCache = null; push();
      return send(res, 200, { ok: true });
    }
    if (sub === 'reconnect') { connect(); return send(res, 200, { ok: true }); }
    return send(res, 404, { error: 'Not found' });
  }
  function status() {
    return Object.assign({ setup, paired: !!(secrets.tv && secrets.tv.id), name: secrets.tv && secrets.tv.name, pairing: pairing && pairing.protocol }, tv);
  }

  function start() { if (setup.state === 'ready') startHelper(); else push(); }
  return { start, route, admin, status, install };
}
