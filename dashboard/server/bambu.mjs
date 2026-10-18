// Bambu Lab printers (P1S, P1P, X1, A1) on the home network, read-only.
// Status: the printer's local MQTT broker (TLS, port 8883, user "bblp", password = the LAN access
// code on the printer's screen). It sends a full report when asked ("pushall") and then changes.
// Camera (P1 / A1): JPEG frames over TLS on port 6000, same access code. Served to the screens as
// MJPEG like the Tapo cameras; needs "LAN Only Liveview" turned on in the printer's settings.
// Access codes stay in secrets.json; screens get the status only.
import tls from 'node:tls';
import crypto from 'node:crypto';

const STAGES = {
  1: 'Auto bed leveling', 2: 'Heating the bed', 3: 'Vibration compensation', 4: 'Changing filament', 5: 'Paused',
  6: 'Paused: filament ran out', 7: 'Heating the nozzle', 8: 'Calibrating extrusion', 9: 'Scanning the bed',
  10: 'Checking the first layer', 11: 'Identifying the build plate', 12: 'Calibrating the lidar', 13: 'Homing',
  14: 'Cleaning the nozzle', 15: 'Checking nozzle temperature', 16: 'Paused', 17: 'Paused: front cover fell off',
  18: 'Calibrating the lidar', 19: 'Calibrating flow', 20: 'Paused: nozzle temperature problem', 21: 'Paused: bed temperature problem',
  22: 'Unloading filament', 23: 'Paused', 24: 'Loading filament', 25: 'Calibrating motor noise', 26: 'Paused: AMS lost',
  27: 'Paused: heatbreak fan too slow', 28: 'Paused: chamber temperature problem', 29: 'Cooling the chamber', 30: 'Paused by G-code',
  32: 'Paused: filament wrapped the nozzle', 33: 'Paused: cutter error', 34: 'Paused: first layer problem', 35: 'Paused: nozzle clog'
};
const STATE_TEXT = { IDLE: 'Idle', PREPARE: 'Getting ready', RUNNING: 'Printing', PAUSE: 'Paused', FINISH: 'Finished', FAILED: 'Failed', SLICING: 'Slicing' };

// ------------------------------------------------------------------ tiny MQTT 3.1.1 client (QoS 0)
const str = s => { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); return Buffer.concat([l, b]); };
function packet(type, body) {
  const len = []; let n = body.length;
  do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; len.push(d); } while (n > 0);
  return Buffer.concat([Buffer.from([type]), Buffer.from(len), body]);
}
function mqtt({ host, user, pass, onConnect, onMessage, onClose }) {
  const sock = tls.connect({ host, port: 8883, rejectUnauthorized: false, timeout: 10000 }); // printer uses Bambu's own CA
  let buf = Buffer.alloc(0), ping = null, closed = false;
  const close = why => { if (closed) return; closed = true; clearInterval(ping); try { sock.destroy(); } catch {} onClose(why); };
  sock.on('secureConnect', () => {
    const vh = Buffer.concat([str('MQTT'), Buffer.from([4, 0xC2, 0, 60])]);
    sock.write(packet(0x10, Buffer.concat([vh, str('homehq-' + crypto.randomBytes(3).toString('hex')), str(user), str(pass)])));
  });
  sock.on('timeout', () => close('The printer didn’t answer at that address'));
  sock.on('error', e => close(/ECONNREFUSED/.test(e.code) ? 'The printer refused the connection (is it on, and is that its IP?)' : /EHOSTUNREACH|ENETUNREACH|ETIMEDOUT/.test(e.code) ? 'The printer didn’t answer at that address' : e.message));
  sock.on('close', () => close('Connection closed'));
  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      let mult = 1, len = 0, i = 1, byte;
      do { if (i >= buf.length) return; byte = buf[i++]; len += (byte & 127) * mult; mult *= 128; } while (byte & 128);
      if (buf.length < i + len) return;
      const type = buf[0] >> 4, flags = buf[0] & 15, body = buf.subarray(i, i + len);
      buf = buf.subarray(i + len);
      if (type === 2) { // CONNACK
        const rc = body[1];
        if (rc !== 0) return close(rc === 4 || rc === 5 ? 'The printer refused the access code (check it on the printer: Settings → WLAN/Network)' : 'The printer refused the connection (code ' + rc + ')');
        sock.setTimeout(0);
        ping = setInterval(() => { try { sock.write(Buffer.from([0xC0, 0])); } catch {} }, 30000);
        onConnect({
          subscribe: topic => sock.write(packet(0x82, Buffer.concat([Buffer.from([0, 1]), str(topic), Buffer.from([0])]))),
          publish: (topic, msg) => sock.write(packet(0x30, Buffer.concat([str(topic), Buffer.from(msg)])))
        });
      } else if (type === 3) { // PUBLISH
        const tl = body.readUInt16BE(0); let off = 2 + tl; if ((flags >> 1) & 3) off += 2;
        onMessage(body.subarray(2, 2 + tl).toString(), body.subarray(off));
      }
    }
  });
  return { close: () => close('closed') };
}

export function createBambu({ secrets, saveSecrets, commit, log, notify, announce }) {
  const list = () => (secrets.printers = secrets.printers || []);
  const get = id => list().find(p => p.id === id);
  const conns = new Map();   // id -> { client, raw, status, retry, lastPush, publishT }
  const hubs = new Map();    // id -> camera hub

  // ---------------------------------------------------------------- status
  function view(p) {
    const c = conns.get(p.id) || {}, r = c.raw || {};
    const st = r.gcode_state || '', active = /^(PREPARE|RUNNING|PAUSE|SLICING)$/.test(st);
    const stage = STAGES[+r.stg_cur] || '';
    const mins = +r.mc_remaining_time || 0;
    const err = +r.print_error || 0;
    return {
      id: p.id, name: p.name, model: p.model || 'P1S', online: !!c.online, error: c.online ? '' : (c.error || 'Connecting…'),
      state: st, stateText: STATE_TEXT[st] || (st ? st.charAt(0) + st.slice(1).toLowerCase() : c.online ? 'Idle' : 'Offline'),
      active, printing: st === 'RUNNING', paused: st === 'PAUSE',
      stage: active && stage && !(st === 'RUNNING' && +r.stg_cur === 0) ? stage : '',
      file: String(r.subtask_name || r.gcode_file || '').replace(/\.(gcode|3mf)$/i, '').slice(0, 60),
      percent: Math.max(0, Math.min(100, +r.mc_percent || 0)), mins, eta: active && mins ? Date.now() + mins * 60000 : 0,
      layer: +r.layer_num || 0, layers: +r.total_layer_num || 0,
      nozzle: Math.round(+r.nozzle_temper || 0), nozzleTarget: Math.round(+r.nozzle_target_temper || 0),
      bed: Math.round(+r.bed_temper || 0), bedTarget: Math.round(+r.bed_target_temper || 0),
      chamber: r.chamber_temper != null ? Math.round(+r.chamber_temper) : null,
      problem: err ? 'Printer error ' + err.toString(16).toUpperCase() : '',
      camera: true, endedAt: c.endedAt || 0, at: Date.now()
    };
  }
  let pubT = null, lastSig = '';
  function publish(now) {
    clearTimeout(pubT);
    const go = () => {
      const out = list().map(view);
      const sig = JSON.stringify(out.map(o => Object.assign({}, o, { at: 0, eta: 0, nozzle: Math.round(o.nozzle / 3), bed: Math.round(o.bed / 3) })));
      if (sig === lastSig && !now) return;
      lastSig = sig; commit({ printers: out }, 'server');
    };
    if (now) go(); else pubT = setTimeout(go, 3000);
  }
  // Tell people when a print ends
  function ended(p, from, to, r) {
    const c = conns.get(p.id);
    c.endedAt = Date.now();
    const file = String(r.subtask_name || '').replace(/\.(gcode|3mf)$/i, '') || 'The print';
    const text = to === 'FINISH' ? '🖨️ ' + file + ' finished on the ' + p.name + '.' : '🖨️ ' + file + ' failed on the ' + p.name + (+r.print_error ? ' (error ' + (+r.print_error).toString(16).toUpperCase() + ')' : '') + '.';
    log('printer:', text);
    announce && announce(text);
    const who = p.notify || 'jd';
    if (who !== 'none' && notify) (who === 'both' ? ['jd', 'georgia'] : [who]).forEach(x => notify(x, text).catch(() => {}));
  }
  function connect(p) {
    const old = conns.get(p.id);
    const c = { raw: old ? old.raw : {}, online: false, error: '', retry: old ? old.retry : 0, endedAt: old ? old.endedAt : 0 };
    conns.set(p.id, c);
    c.client = mqtt({
      host: p.host, user: 'bblp', pass: p.code,
      onConnect: m => {
        c.online = true; c.error = ''; c.retry = 0; c.m = m;
        m.subscribe('device/' + p.serial + '/report');
        const push = () => m.publish('device/' + p.serial + '/request', JSON.stringify({ pushing: { sequence_id: String(Date.now() % 1e6), command: 'pushall' } }));
        push(); c.pushT = setInterval(push, 5 * 60000); // P1 printers only send changes; refresh the whole picture now and then
        log('printer:', p.name, 'connected');
        publish(true);
      },
      onMessage: (topic, payload) => {
        let j; try { j = JSON.parse(payload.toString()); } catch { return; }
        if (!j.print) return;
        const before = c.raw.gcode_state;
        Object.assign(c.raw, j.print);
        const now = c.raw.gcode_state;
        if (before && now !== before && /^(RUNNING|PAUSE|PREPARE)$/.test(before) && /^(FINISH|FAILED)$/.test(now)) ended(p, before, now, c.raw);
        if (now !== before) publish(true); else publish();
      },
      onClose: why => {
        clearInterval(c.pushT);
        if (conns.get(p.id) !== c) return;
        const was = c.online; c.online = false; c.error = why;
        if (was || !c.retry) log('printer:', p.name, '—', why);
        publish(true);
        if (c.stopped) return;
        c.retry++;
        c.retryT = setTimeout(() => { if (conns.get(p.id) === c && !c.stopped) connect(p); }, Math.min(60000, 3000 * c.retry));
      }
    });
  }
  function disconnect(id) {
    const c = conns.get(id); if (!c) return;
    c.stopped = true; clearTimeout(c.retryT); clearInterval(c.pushT); c.client && c.client.close(); conns.delete(id);
  }

  // ---------------------------------------------------------------- camera (port 6000)
  function camStream(p, onFrame, onEnd) {
    const sock = tls.connect({ host: p.host, port: 6000, rejectUnauthorized: false, timeout: 10000 });
    let buf = Buffer.alloc(0), ended = false;
    const end = why => { if (ended) return; ended = true; try { sock.destroy(); } catch {} onEnd(why); };
    sock.on('secureConnect', () => {
      const a = Buffer.alloc(80);
      a.writeUInt32LE(0x40, 0); a.writeUInt32LE(0x3000, 4);
      a.write('bblp', 16, 32, 'ascii'); a.write(String(p.code), 48, 32, 'ascii');
      sock.write(a);
    });
    sock.on('timeout', () => end('The printer camera didn’t answer. Turn on “LAN Only Liveview” in the printer’s settings.'));
    sock.on('error', e => end(/ECONNREFUSED/.test(e.code) ? 'The printer camera is off. Turn on “LAN Only Liveview” in the printer’s settings.' : e.message));
    sock.on('close', () => end('Camera closed'));
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 16) {
        const size = buf.readUInt32LE(0);
        if (size <= 0 || size > 5e6) return end('The camera sent something unexpected');
        if (buf.length < 16 + size) break;
        const jpg = buf.subarray(16, 16 + size); buf = buf.subarray(16 + size);
        if (jpg[0] === 0xff && jpg[1] === 0xd8) { sock.setTimeout(0); onFrame(Buffer.from(jpg)); }
      }
    });
    return { stop: () => end('stopped') };
  }
  function hubFor(p) {
    let h = hubs.get(p.id);
    if (h && h.cam) return h;
    h = h || { clients: new Set(), waiters: [], last: null, lastAt: 0, error: '' };
    hubs.set(p.id, h);
    h.cam = camStream(p, f => {
      h.last = f; h.lastAt = Date.now(); h.error = '';
      h.waiters.splice(0).forEach(w => w.ok(f));
      const head = '--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ' + f.length + '\r\n\r\n';
      for (const res of h.clients) { if (res.writableLength > 1.5e6) continue; res.write(head); res.write(f); res.write('\r\n'); }
    }, why => {
      h.cam = null; h.error = why;
      h.waiters.splice(0).forEach(w => w.no(new Error(why)));
      if (h.clients.size) setTimeout(() => { if (h.clients.size && !h.cam) hubFor(p); }, 5000);
    });
    idle(h);
    return h;
  }
  // Close the camera 20 s after the last viewer / snapshot
  function idle(h) { clearTimeout(h.stopT); h.stopT = setTimeout(() => { if (!h.clients.size && h.cam) { h.cam.stop(); h.cam = null; } }, 20000); }
  function snapshot(id) {
    const p = get(id); if (!p) return Promise.reject(Object.assign(new Error('No such printer'), { status: 404 }));
    const h = hubs.get(id);
    if (h && h.last && Date.now() - h.lastAt < 10000) return Promise.resolve(h.last);
    return new Promise((ok, no) => {
      const hh = hubFor(p); idle(hh);
      hh.waiters.push({ ok, no });
      setTimeout(() => no(new Error(hh.error || 'No picture from the printer camera')), 15000);
    });
  }
  function live(req, res, id) {
    const p = get(id); if (!p) { res.writeHead(404); return res.end(); }
    const h = hubFor(p);
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    if (h.last && Date.now() - h.lastAt < 5000) { res.write('--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ' + h.last.length + '\r\n\r\n'); res.write(h.last); res.write('\r\n'); }
    h.clients.add(res); clearTimeout(h.stopT);
    const bye = () => { h.clients.delete(res); if (!h.clients.size) idle(h); };
    req.on('close', bye); res.on('error', bye);
  }

  // ---------------------------------------------------------------- setup (Admin)
  function adminList() { return list().map(p => Object.assign({ host: p.host, serial: p.serial, notify: p.notify || 'jd' }, view(p))); }
  // Check the address/serial/code work before saving: connect and wait for a report
  function test(p) {
    return new Promise((ok, no) => {
      let done = false, cl = null;
      const fin = (e, v) => { if (done) return; done = true; clearTimeout(t); try { cl && cl.close(); } catch {} e ? no(e) : ok(v); };
      const t = setTimeout(() => fin(new Error('Connected, but the printer sent no status. Check the serial number (Settings → Device on the printer).')), 12000);
      cl = mqtt({ host: p.host, user: 'bblp', pass: p.code,
        onConnect: m => { m.subscribe('device/' + p.serial + '/report'); m.publish('device/' + p.serial + '/request', JSON.stringify({ pushing: { sequence_id: '1', command: 'pushall' } })); },
        onMessage: (tp, pl) => { try { const j = JSON.parse(pl.toString()); if (j.print) fin(null, j.print); } catch {} },
        onClose: why => fin(new Error(why)) });
    });
  }
  async function add(b) {
    const host = String(b.host || '').trim().replace(/^\w+:\/\//, '').replace(/[/:].*$/, '');
    const serial = String(b.serial || '').trim().toUpperCase().replace(/\s+/g, '');
    const code = String(b.code || '').trim();
    if (!/^[\w.-]+$/.test(host)) throw Object.assign(new Error('Enter the printer’s IP address, e.g. 192.168.0.70'), { status: 400 });
    if (!/^[0-9A-Z]{8,20}$/.test(serial)) throw Object.assign(new Error('Enter the printer’s serial number (Settings → Device on the printer, or Bambu Handy → printer → Settings)'), { status: 400 });
    if (!/^\w{6,12}$/.test(code)) throw Object.assign(new Error('Enter the 8-character LAN access code from the printer’s screen'), { status: 400 });
    const p = { id: 'pr-' + crypto.randomBytes(3).toString('hex'), name: String(b.name || '3D printer').trim().slice(0, 30) || '3D printer', model: String(b.model || 'P1S').slice(0, 10), host, serial, code, notify: ['jd', 'georgia', 'both', 'none'].includes(b.notify) ? b.notify : 'jd' };
    try { await test(p); } catch (e) { throw Object.assign(new Error(e.message), { status: 400 }); }
    list().push(p); saveSecrets(); connect(p); publish(true);
    return { id: p.id };
  }
  function remove(id) {
    disconnect(id);
    const h = hubs.get(id); if (h) { h.cam && h.cam.stop(); h.clients.forEach(r => r.end()); hubs.delete(id); }
    secrets.printers = list().filter(p => p.id !== id); saveSecrets(); publish(true);
  }
  function update(id, b) {
    const p = get(id); if (!p) return;
    if (b.name) p.name = String(b.name).trim().slice(0, 30);
    if (['jd', 'georgia', 'both', 'none'].includes(b.notify)) p.notify = b.notify;
    saveSecrets(); publish(true);
  }
  function start() { list().forEach(connect); publish(true); }

  return { start, list: adminList, add, remove, update, snapshot, live, status: id => { const p = get(id); return p ? view(p) : null; } };
}
