// iMessage bridge for the household assistant (macOS only).
// Reads new messages from the Messages database (~/Library/Messages/chat.db, read-only) and
// replies through the Messages app. Only texts from the handles listed in Admin are answered;
// everything else is ignored. Needs two one-time Mac permissions:
//   - Full Disk Access for the Node binary that runs Home HQ (to read chat.db)
//   - Automation: allow it to control Messages (asked the first time it sends)
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const DB = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');
const IS_MAC = process.platform === 'darwin';

function run(cmd, args, input, timeout) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    const t = setTimeout(() => p.kill('SIGKILL'), timeout || 20000);
    p.on('error', e => { clearTimeout(t); reject(e); });
    p.on('close', code => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error((err || out).trim() || cmd + ' exited ' + code)); });
    if (input != null) p.stdin.end(input); else p.stdin.end();
  });
}

// Newer macOS keeps message text inside an archived NSAttributedString ("attributedBody").
export function textFromAttributedBody(hex) {
  if (!hex) return '';
  const b = Buffer.from(hex, 'hex');
  let i = b.indexOf(Buffer.from('NSString'));
  if (i < 0) return '';
  i = b.indexOf(0x2b, i + 8); // '+' marks the start of the string payload
  if (i < 0) return '';
  i++;
  let len = b[i++];
  if (len === 0x81) { len = b.readUInt16LE(i); i += 2; }
  else if (len === 0x82) { len = b.readUInt32LE(i); i += 4; }
  return b.slice(i, i + len).toString('utf8');
}
// Phone numbers compare on their last 10 digits; emails case-insensitively.
export function normHandle(h) {
  h = String(h || '').trim().toLowerCase();
  if (h.includes('@')) return h;
  const d = h.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : d;
}

export function createIMessage({ secrets, saveSecrets, log, assistant, people }) {
  let status = { state: 'off' };
  let timer = null, lastRow = 0, busy = false;
  const queue = [];
  const cfg = () => (secrets.assistant = secrets.assistant || {});

  async function sql(q) {
    const out = await run('/usr/bin/sqlite3', ['-readonly', '-json', DB, q], null, 15000);
    return out.trim() ? JSON.parse(out) : [];
  }
  function allowedPerson(handle) {
    const n = normHandle(handle);
    const hit = (cfg().allow || []).find(a => a.handle && normHandle(a.handle) === n);
    return hit ? hit.person || 'jd' : null;
  }

  async function send(handle, text) {
    // Script gets the recipient and text as arguments (never pasted into the script source).
    const script = 'on run argv\n set h to item 1 of argv\n set m to item 2 of argv\n tell application "Messages"\n  set s to 1st account whose service type = iMessage\n  send m to participant h of s\n end tell\nend run';
    await run('/usr/bin/osascript', ['-e', script, handle, text], null, 30000);
  }

  async function attachmentsFor(rowid) {
    const rows = await sql('SELECT a.filename AS f, a.mime_type AS m FROM message_attachment_join j JOIN attachment a ON a.ROWID = j.attachment_id WHERE j.message_id = ' + (+rowid));
    const out = [];
    for (const r of rows) {
      if (!r.f || !/^image\//.test(r.m || 'image/')) continue;
      const file = r.f.replace(/^~/, os.homedir());
      // Photos can still be downloading when the message arrives
      for (let k = 0; k < 20 && !fs.existsSync(file); k++) await new Promise(res => setTimeout(res, 1000));
      if (!fs.existsSync(file)) continue;
      const tmp = path.join(os.tmpdir(), 'hq-img-' + crypto.randomBytes(5).toString('hex') + '.jpg');
      try {
        await run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '-Z', '1568', file, '--out', tmp], null, 30000); // HEIC → JPEG, max 1568 px
        out.push({ media_type: 'image/jpeg', data: (await fsp.readFile(tmp)).toString('base64') });
      } catch (e) { log('imessage: image', e.message); }
      finally { fsp.rm(tmp, { force: true }).catch(() => {}); }
      if (out.length >= 4) break;
    }
    return out;
  }

  async function poll() {
    if (busy) return;
    busy = true;
    try {
      // 1:1 chats only (style 45); messages from them, newer than the last one we saw
      const rows = await sql('SELECT m.ROWID AS id, m.text AS text, hex(m.attributedBody) AS body, m.cache_has_attachments AS att, h.id AS handle ' +
        'FROM message m JOIN handle h ON h.ROWID = m.handle_id JOIN chat_message_join cm ON cm.message_id = m.ROWID JOIN chat c ON c.ROWID = cm.chat_id ' +
        'WHERE m.ROWID > ' + lastRow + ' AND m.is_from_me = 0 AND c.style = 45 AND m.associated_message_type = 0 ORDER BY m.ROWID LIMIT 20');
      status = Object.assign({}, status, { state: 'listening', error: '', checked: new Date().toISOString() });
      for (const r of rows) {
        lastRow = Math.max(lastRow, r.id);
        const who = allowedPerson(r.handle);
        if (!who) continue;
        queue.push({ row: r, who });
      }
      if (rows.length) { cfg().lastRow = lastRow; saveSecrets(); }
    } catch (e) {
      const fda = /unable to open|authorization denied|not permitted|operation not permitted/i.test(e.message);
      status = { state: 'error', needsFullDiskAccess: fda, error: fda ? 'The Mac needs to give Home HQ Full Disk Access to read Messages' : e.message, checked: new Date().toISOString() };
    } finally { busy = false; }
    drain();
  }
  let draining = false;
  async function drain() {
    if (draining) return;
    draining = true;
    while (queue.length) {
      const { row, who } = queue.shift();
      const text = row.text || textFromAttributedBody(row.body);
      try {
        const images = row.att ? await attachmentsFor(row.id) : [];
        if (!text.trim() && !images.length) continue;
        status.last = { at: new Date().toISOString(), from: who };
        const answer = /^\s*(forget|reset|new chat)\s*$/i.test(text) ? (assistant.forget(row.handle), 'Okay, starting fresh.') : await assistant.reply({ text, images, who, handle: normHandle(row.handle) });
        await send(row.handle, answer.slice(0, 1800));
      } catch (e) {
        log('imessage:', e.message);
        status.lastError = e.message;
        const msg = e.status === 401 ? 'My Claude API key isn’t working. Check Admin → iMessage.' : e.status === 429 || e.status === 529 ? 'I’m a bit overloaded, try again in a minute.' : 'Sorry, something went wrong on the Mac mini: ' + e.message.slice(0, 120);
        try { await send(row.handle, msg); } catch (e2) { status.sendError = e2.message; }
      }
    }
    draining = false;
  }

  async function start() {
    clearInterval(timer);
    const c = cfg();
    if (!IS_MAC) { status = { state: 'off', error: 'iMessage only works on a Mac' }; return status; }
    if (!c.enabled || !c.apiKey || !(c.allow || []).some(a => a.handle)) { status = { state: 'off' }; return status; }
    try {
      // Start from now: never answer old messages after a restart or when first turned on
      const top = await sql('SELECT MAX(ROWID) AS m FROM message');
      const maxRow = (top[0] && top[0].m) || 0;
      lastRow = c.lastRow && c.lastRow <= maxRow && maxRow - c.lastRow < 50 ? c.lastRow : maxRow;
      status = { state: 'listening', checked: new Date().toISOString() };
    } catch (e) {
      const fda = /unable to open|authorization denied|not permitted/i.test(e.message);
      status = { state: 'error', needsFullDiskAccess: fda, error: fda ? 'The Mac needs to give Home HQ Full Disk Access to read Messages' : e.message };
    }
    timer = setInterval(poll, 3000);
    return status;
  }
  async function testSend(handle) { await send(handle, 'Hi! This is your home assistant on the Mac mini. Text me anytime: "what’s on the shopping list?", a photo of something we need, "turn the lamp warm white", or "next train?"'); }

  return { start, status: () => Object.assign({ node: process.execPath }, status), testSend, normHandle };
}
