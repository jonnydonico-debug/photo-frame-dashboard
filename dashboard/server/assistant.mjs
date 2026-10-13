// Household tools the agents can be given: shopping list, notes, lights, music, Apple TV, BART and
// weather summary, frame messages. They act only on the dashboard's own data and devices.
import crypto from 'node:crypto';

const API = process.env.HOMEHQ_CLAUDE_API || 'https://api.anthropic.com/v1/messages'; // override only for tests
export const MODELS = [['claude-sonnet-5-5', 'Claude Sonnet 5.5 (best at photos, about 1¢ a message)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (cheapest, fine for simple texts)']];

export function createHouseTools(ctx) {
  const { getState, commit, devices: D, spotify, tv, govee, announce } = ctx;
  const S = () => getState();
  const id = p => p + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

  // ---------------------------------------------------------------- helpers over household data
  function categorize(name) {
    const n = name.toLowerCase(), C = S().catalog || [];
    const hit = C.find(c => c[0].toLowerCase() === n) || C.find(c => { const a = c[0].toLowerCase(); return a.includes(n) || n.includes(a); });
    return hit ? hit[1] : 'Other';
  }
  const open = () => (S().groceries || []).filter(g => !g.done);
  const findItem = (q, list) => { q = String(q || '').toLowerCase().trim(); return list.find(g => g.name.toLowerCase() === q) || list.find(g => g.name.toLowerCase().includes(q) || q.includes(g.name.toLowerCase())); };
  const findDevice = q => { q = String(q || '').toLowerCase().trim(); const L = S().devices || []; return L.find(d => d.name.toLowerCase() === q) || L.find(d => d.name.toLowerCase().includes(q) || q.includes(d.name.toLowerCase())); };
  const hhmm = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  function summary() {
    const st = S(), W = st.weather, h = new Date().getHours();
    const B = st.bart || {}, C = st.commute || {}, M = st.music || {}, T = st.tv || {};
    return {
      now: new Date().toString(),
      weather: W && W.t ? { now: W.t[h] + '°', feels: W.feels, hi: W.hi, lo: W.lo, rainChanceNow: W.p[h] + '%', nextHours: W.t.slice(h, h + 6).map((t, i) => ((h + i) % 12 || 12) + (h + i >= 12 ? 'pm ' : 'am ') + t + '°, rain ' + W.p[h + i] + '%') } : 'not set up',
      bart: (B.stations || []).map(s => {
        const c = (C.stations || []).find(x => x.code === s.code) || {};
        return { station: s.name, walkMin: c.walk && c.walk.min, driveMin: c.drive && c.drive.min, trafficDelayMin: c.drive && c.drive.delay, trains: (s.lines || []).map(l => l.dest + ': ' + l.mins.slice(0, 3).join(', ') + ' min') };
      }),
      bartAdvisory: B.advisory || null,
      shoppingList: open().map(g => g.name + (g.qty > 1 ? ' x' + g.qty : '') + (g.note ? ' (' + g.note + ')' : '')),
      pinnedNotes: (st.notes || []).filter(n => n.pinned && !n.done).map(n => n.text),
      lightsOn: (st.devices || []).filter(d => d.type === 'light' && d.on).map(d => d.name + ' ' + (d.level || 100) + '%'),
      music: M.connected ? (M.title ? (M.playing ? 'playing ' : 'paused ') + M.title + ' by ' + M.artist + (M.device ? ' on ' + M.device.name : '') : 'nothing playing') : 'Spotify not connected',
      appleTv: T.paired ? (T.connected ? (T.power === 'off' ? 'asleep' : (T.playing && T.playing.title ? 'playing ' + T.playing.title : 'on') + (T.app ? ' in ' + T.app.name : '')) : 'not connected') : 'not set up'
    };
  }

  // ---------------------------------------------------------------- tools
  const TOOLS = [
    { name: 'home_summary', description: 'Everything at a glance: time, weather, BART departures with walk/drive minutes, shopping list, pinned notes, lights that are on, music and Apple TV.', input_schema: { type: 'object', properties: {} } },
    { name: 'shopping_list', description: 'The shared shopping list (items still to buy).', input_schema: { type: 'object', properties: {} } },
    { name: 'shopping_add', description: 'Add items to the shopping list. Use a short generic product name a shopper would recognise, with brand or size in the note.', input_schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, qty: { type: 'integer', minimum: 1 }, note: { type: 'string' } }, required: ['name'] } } }, required: ['items'] } },
    { name: 'shopping_check_off', description: 'Mark items as bought (they move to the "got it" section).', input_schema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'] } },
    { name: 'shopping_remove', description: 'Delete items from the shopping list entirely.', input_schema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'] } },
    { name: 'notes_list', description: 'All sticky notes on the frame, newest first.', input_schema: { type: 'object', properties: {} } },
    { name: 'note_add', description: 'Put a sticky note on the frame.', input_schema: { type: 'object', properties: { text: { type: 'string' }, pinned: { type: 'boolean' } }, required: ['text'] } },
    { name: 'note_done', description: 'Mark a note done (matches by text).', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
    { name: 'lights', description: 'List lights and other devices with their state.', input_schema: { type: 'object', properties: {} } },
    { name: 'light_set', description: 'Change a light. Name can be partial ("lamp", "light bars"), or "all". Colour is #RRGGBB, kelvin is 2200-6500 for whites.', input_schema: { type: 'object', properties: { name: { type: 'string' }, on: { type: 'boolean' }, level: { type: 'integer', minimum: 1, maximum: 100 }, color: { type: 'string' }, kelvin: { type: 'integer' } }, required: ['name'] } },
    { name: 'light_scene', description: 'Play one of a Govee light’s built-in scenes (e.g. "Sunset"). Leave scene empty to list them.', input_schema: { type: 'object', properties: { light: { type: 'string' }, scene: { type: 'string' } }, required: ['light'] } },
    { name: 'music', description: 'Control music: play, pause, next, previous, volume (0-100), or search and play something on the current speaker.', input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['play', 'pause', 'next', 'previous', 'volume', 'search_and_play'] }, volume: { type: 'integer' }, query: { type: 'string' } }, required: ['action'] } },
    { name: 'apple_tv', description: 'Control the Apple TV: power on/off, a remote button, or open an app by name.', input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['power_on', 'power_off', 'button', 'open_app', 'list_apps'] }, button: { type: 'string', enum: ['up', 'down', 'left', 'right', 'select', 'menu', 'home', 'play_pause', 'next', 'previous', 'volume_up', 'volume_down'] }, app: { type: 'string' } }, required: ['action'] } },
    { name: 'frame_message', description: 'Show a short message full-screen on the wall frame (e.g. "Dinner’s ready!").', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }
  ];

  async function runTool(name, a, who) {
    const st = S();
    switch (name) {
      case 'home_summary': return summary();
      case 'shopping_list': return open().map(g => ({ name: g.name, qty: g.qty, note: g.note || undefined }));
      case 'shopping_add': {
        let list = (st.groceries || []).slice(); const added = [];
        for (const it of (a.items || []).slice(0, 30)) {
          const nm = String(it.name || '').trim().slice(0, 60); if (!nm) continue;
          const have = findItem(nm, list.filter(g => !g.done));
          if (have && have.name.toLowerCase() === nm.toLowerCase()) { list = list.map(g => g === have ? Object.assign({}, g, { qty: (g.qty || 1) + (it.qty || 1) }) : g); added.push(nm + ' (now x' + ((have.qty || 1) + (it.qty || 1)) + ')'); continue; }
          const hit = (st.catalog || []).find(c => c[0].toLowerCase() === nm.toLowerCase());
          list.push({ id: id('g'), name: hit ? hit[0] : nm.replace(/^./, c => c.toUpperCase()), cat: hit ? hit[1] : categorize(nm), qty: it.qty || 1, store: ((st.stores || [])[0] || {}).id || 'store', done: false, note: String(it.note || '').slice(0, 80), by: who });
          added.push(nm);
        }
        commit({ groceries: list }, 'assistant');
        return { added };
      }
      case 'shopping_check_off': case 'shopping_remove': {
        let list = (st.groceries || []).slice(); const done = [], missing = [];
        for (const n of a.names || []) {
          const g = findItem(n, list.filter(x => !x.done));
          if (!g) { missing.push(n); continue; }
          list = name === 'shopping_remove' ? list.filter(x => x !== g) : list.map(x => x === g ? Object.assign({}, x, { done: true }) : x);
          done.push(g.name);
        }
        commit({ groceries: list }, 'assistant');
        return { done, notOnList: missing };
      }
      case 'notes_list': return (st.notes || []).slice().sort((x, y) => y.at - x.at).slice(0, 30).map(n => ({ text: n.text, by: n.by, pinned: !!n.pinned, done: !!n.done, when: new Date(n.at).toLocaleString('en-US') }));
      case 'note_add': {
        const n = { id: id('n'), text: String(a.text || '').slice(0, 500), by: who || 'jd', at: Date.now(), pinned: !!a.pinned };
        commit({ notes: (st.notes || []).concat([n]) }, 'assistant');
        return { ok: true };
      }
      case 'note_done': {
        const q = String(a.text || '').toLowerCase(); const notes = (st.notes || []).slice();
        const n = notes.find(x => x.text.toLowerCase().includes(q)); if (!n) return { error: 'No note like that' };
        commit({ notes: notes.map(x => x === n ? Object.assign({}, x, { done: true }) : x) }, 'assistant');
        return { ok: true, note: n.text };
      }
      case 'lights': return (st.devices || []).map(d => ({ name: d.name, type: d.type, on: d.on, level: d.level, color: d.color, kelvin: d.kelvin, locked: d.locked, state: d.state, online: d.online }));
      case 'light_set': {
        const all = /^(all|every|everything)/i.test(a.name || '');
        const targets = all ? (st.devices || []).filter(d => d.type === 'light') : [findDevice(a.name)].filter(Boolean);
        if (!targets.length) return { error: 'No light called ' + a.name, lights: (st.devices || []).filter(d => d.type === 'light').map(d => d.name) };
        const patch = {};
        if (a.on != null) patch.on = !!a.on;
        if (a.level) { patch.level = a.level; patch.on = true; }
        if (a.color && /^#[0-9a-f]{6}$/i.test(a.color)) { patch.color = a.color.toUpperCase(); patch.kelvin = null; patch.on = true; }
        if (a.kelvin) { patch.kelvin = a.kelvin; patch.color = null; patch.on = true; }
        const before = st.devices || [];
        const after = before.map(d => targets.includes(d) ? Object.assign({}, d, patch) : d);
        D.apply(before, after);
        commit({ devices: after }, 'assistant');
        return { changed: targets.map(d => d.name), linked: targets.map(d => d.source === 'govee' || !!d.shortcut) };
      }
      case 'light_scene': {
        const d = findDevice(a.light); if (!d || d.source !== 'govee') return { error: 'Scenes only work on Govee lights' };
        if (!a.scene) return { scenes: (await govee.scenes(d.id)).map(o => o.name).slice(0, 60) };
        const list = await govee.scenes(d.id), q = a.scene.toLowerCase();
        const o = list.find(x => x.name.toLowerCase() === q) || list.find(x => x.name.toLowerCase().includes(q));
        if (!o) return { error: 'No scene like that', some: list.slice(0, 20).map(x => x.name) };
        await govee.playScene(d.id, o.name); return { ok: true, scene: o.name, light: d.name };
      }
      case 'music': {
        if (a.action === 'search_and_play') {
          const r = await spotify.search(String(a.query || ''));
          const pick = (r.playlists || [])[0] && /playlist|mix|radio|vibe|jazz|chill|focus|dinner|party/i.test(a.query || '') ? r.playlists[0] : (r.tracks || [])[0] || (r.albums || [])[0] || (r.playlists || [])[0];
          if (!pick) return { error: 'Nothing found on Spotify for ' + a.query };
          await spotify.command(/:track:/.test(pick.uri) ? { action: 'play', uris: [pick.uri] } : { action: 'play', uri: pick.uri });
          return { playing: pick.name, by: pick.by };
        }
        if (a.action === 'volume') { await spotify.command({ action: 'volume', volume: a.volume }); return { ok: true }; }
        await spotify.command({ action: a.action === 'previous' ? 'prev' : a.action });
        return { ok: true };
      }
      case 'apple_tv': {
        if (a.action === 'power_on' || a.action === 'power_off') { await tv.cmd('power', { on: a.action === 'power_on' }, 30000); return { ok: true }; }
        if (a.action === 'button') { await tv.cmd('key', { name: a.button }); return { ok: true }; }
        const apps = await tv.cmd('apps', {}, 20000);
        if (a.action === 'list_apps') return apps.map(x => x.name);
        const q = String(a.app || '').toLowerCase();
        const app = apps.find(x => x.name.toLowerCase() === q) || apps.find(x => x.name.toLowerCase().includes(q));
        if (!app) return { error: 'No app called ' + a.app };
        await tv.cmd('launch', { id: app.id }); return { opened: app.name };
      }
      case 'frame_message': announce(String(a.text || '').slice(0, 200)); return { ok: true };
    }
    return { error: 'Unknown tool' };
  }

  return { defs: TOOLS, run: runTool, summary };
}

// ---------------------------------------------------------------- Claude API
const usage = { calls: 0, inTok: 0, outTok: 0, since: new Date().toISOString() };
export function claudeUsage() { return usage; }
export async function callClaude(secrets, body) {
  const key = secrets.assistant && secrets.assistant.apiKey;
  if (!key) throw Object.assign(new Error('No Claude API key set (Admin → iMessage)'), { status: 400 });
  const r = await fetch(API, { method: 'POST', signal: AbortSignal.timeout(120000), headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || 'Claude API error ' + r.status), { status: r.status });
  usage.calls++;
  if (j.usage) { usage.inTok += j.usage.input_tokens || 0; usage.outTok += j.usage.output_tokens || 0; }
  return j;
}
export async function testKey(secrets, model) {
  const j = await callClaude(secrets, { model: model || MODELS[0][0], max_tokens: 20, messages: [{ role: 'user', content: 'Reply with just: ok' }] });
  return (j.content || []).map(c => c.text || '').join('').trim();
}
