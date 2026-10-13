// Home HQ agents: a small team of Claude agents that share one memory and one activity log.
//  - Each agent has instructions, a model, a set of tools, and the agents it may hand work to
//    (its sub-agents). The front desk agent ("Home") answers iMessage.
//  - Shared memory: facts any agent can save ("Georgia likes oat milk") and every agent sees.
//  - Activity log: every run with its tool calls, linked parent → child when agents delegate.
//  - CONTEXT.md: the same memory + roster + recent activity as a file, so any other tool (or a
//    person) can pick up where the agents left off.
// Everything is stored in ~/HomeHQ/data/agents.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createHouseTools, callClaude, MODELS } from './assistant.mjs';

const HOUSE_TOOLS = ['home_summary', 'shopping_list', 'shopping_add', 'shopping_check_off', 'shopping_remove', 'notes_list', 'note_add', 'note_done',
  'lights', 'light_set', 'light_scene', 'music', 'apple_tv', 'frame_message'];

export const DEFAULT_AGENTS = [
  {
    id: 'home', name: 'Home', icon: '🏠', parent: null, model: 'claude-sonnet-5-5', enabled: true, builtin: true, channels: ['imessage'],
    role: 'Front desk. Answers texts from JD and Georgia and runs the house.',
    instructions: 'Handle everyday requests yourself with your tools. Hand work to a teammate when it fits them better, for example Plex for anything about the movie library. Save lasting preferences and facts with remember.',
    tools: HOUSE_TOOLS.slice(), can: ['plex']
  },
  {
    id: 'plex', name: 'Plex', icon: '🎬', parent: 'home', model: 'claude-haiku-5-5', enabled: false, // off until JD switches it on builtin: true, channels: [],
    role: 'Looks after the Plex movie library.',
    instructions: 'Answer questions about what is in the library and recently added. File movies dropped in the inbox folder under their proper title and year. Find and download public-domain films from the Internet Archive when asked. Do not look for or download copyrighted films from other sources; if asked, say you can only add films they own (via the inbox) or public-domain ones.',
    tools: ['plex_search', 'plex_recent', 'plex_scan', 'archive_search', 'archive_download', 'archive_progress', 'inbox_list', 'inbox_file'], can: []
  }
];

export function createAgents(ctx) {
  const { dataDir, secrets, log, broadcast, getState, extraTools } = ctx;
  const DIR = path.join(dataDir, 'agents');
  fs.mkdirSync(DIR, { recursive: true });
  const F = n => path.join(DIR, n);
  const load = (n, def) => { try { return JSON.parse(fs.readFileSync(F(n), 'utf8')); } catch { return def; } };
  let agents = load('agents.json', null);
  if (!agents) agents = DEFAULT_AGENTS.map(a => Object.assign({}, a));
  // New built-ins added in later versions show up for existing installs too
  for (const d of DEFAULT_AGENTS) if (!agents.some(a => a.id === d.id)) agents.push(Object.assign({}, d));
  let memory = load('memory.json', []);
  let runs = load('runs.json', []);
  let history = load('history.json', {});
  let settings = Object.assign({ plex: { moviesPath: '', inboxPath: '' } }, load('settings.json', {}));
  const timers = {};
  function saveSoon(name, data) {
    clearTimeout(timers[name]);
    timers[name] = setTimeout(() => { fsp.writeFile(F(name), JSON.stringify(data, null, 1)).catch(e => log('agents save', name, e.message)); if (name !== 'history.json') writeContext(); }, 400);
  }
  const saveAgents = () => saveSoon('agents.json', agents), saveMemory = () => saveSoon('memory.json', memory),
    saveRuns = () => saveSoon('runs.json', runs), saveHistory = () => saveSoon('history.json', history), saveSettings = () => saveSoon('settings.json', settings);
  const id = p => p + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
  const get = aid => agents.find(a => a.id === aid);
  const clip = (v, n) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + '…' : s; };

  // ---------------------------------------------------------------- tools
  const house = createHouseTools(ctx.house);
  const memoryTools = [
    { name: 'remember', description: 'Save a lasting fact or preference to the shared memory every agent sees (e.g. "Georgia prefers oat milk", "the light bars are behind the TV").', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
    { name: 'recall', description: 'Search the shared memory.', input_schema: { type: 'object', properties: { query: { type: 'string' } } } },
    { name: 'forget', description: 'Remove a fact from shared memory (matches text).', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }
  ];
  function catalog() {
    const groups = [{ group: 'House', tools: house.defs }, { group: 'Memory (always on)', tools: memoryTools }];
    for (const g of extraTools()) groups.push(g);
    return groups;
  }
  function toolDefs(agent) {
    const all = catalog().flatMap(g => g.tools);
    const defs = all.filter(t => (agent.tools || []).includes(t.name));
    defs.push(...memoryTools.filter(t => !defs.some(d => d.name === t.name)));
    const team = (agent.can || []).map(get).filter(a => a && a.enabled && a.id !== agent.id);
    if (team.length) defs.push({
      name: 'ask_agent', description: 'Hand a task to a teammate and get their answer back. Teammates: ' + team.map(a => a.id + ' (' + a.role + ')').join('; '),
      input_schema: { type: 'object', properties: { agent: { type: 'string', enum: team.map(a => a.id) }, task: { type: 'string', description: 'Everything they need to know, in full sentences.' } }, required: ['agent', 'task'] }
    });
    return defs;
  }
  async function runTool(name, input, c) {
    if (name === 'remember') {
      const text = String(input.text || '').trim().slice(0, 400); if (!text) return { error: 'empty' };
      memory.unshift({ id: id('m'), text, by: c.agent.id, who: c.who || null, at: Date.now() }); memory = memory.slice(0, 300); saveMemory();
      return { saved: text };
    }
    if (name === 'recall') {
      const q = String(input.query || '').toLowerCase().split(/\s+/).filter(Boolean);
      return memory.filter(m => !q.length || q.some(w => m.text.toLowerCase().includes(w))).slice(0, 40).map(m => m.text);
    }
    if (name === 'forget') {
      const q = String(input.text || '').toLowerCase(), hit = memory.find(m => m.text.toLowerCase().includes(q));
      if (!hit) return { error: 'Nothing like that in memory' };
      memory = memory.filter(m => m !== hit); saveMemory(); return { forgot: hit.text };
    }
    if (name === 'ask_agent') {
      if (!(c.agent.can || []).includes(input.agent)) return { error: 'Not on your team' };
      if (c.depth >= 3) return { error: 'Too many hand-offs' };
      const sub = await run(input.agent, { text: String(input.task || ''), who: c.who, channel: 'from ' + c.agent.name, parentRun: c.runId, depth: c.depth + 1 });
      return { from: input.agent, answer: sub.output };
    }
    if (HOUSE_TOOLS.includes(name)) return house.run(name, input, c.who);
    for (const g of extraTools()) if (g.tools.some(t => t.name === name)) return g.run(name, input, c);
    return { error: 'Unknown tool ' + name };
  }

  // ---------------------------------------------------------------- prompt
  function system(agent, c) {
    const st = getState(), title = (st.settings && st.settings.title) || 'Home';
    const person = (st.people || []).find(p => p.id === c.who);
    const team = agents.filter(a => a.enabled).map(a => '- ' + a.icon + ' ' + a.name + ' (' + a.id + '): ' + a.role).join('\n');
    const mem = memory.slice(0, 40).map(m => '- ' + m.text).join('\n') || '(nothing saved yet)';
    const recent = runs.slice(0, 8).filter(r => r.output).map(r => '- ' + new Date(r.at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + ' ' + (get(r.agent) || {}).name + ' (' + r.channel + '): "' + clip(r.input, 80) + '" → ' + clip(r.output, 120)).join('\n');
    const texting = c.channel === 'imessage';
    return `You are ${agent.name}, one of the agents that run ${title}, the home of JD and Georgia in El Cerrito, CA, from their Mac mini.
Your job: ${agent.role}
${agent.instructions || ''}

${person ? 'You are working for ' + person.name + '.' : ''} It is ${new Date().toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.
${texting ? 'You are replying over iMessage: short, warm, plain text. No markdown, no bullet symbols, no headings; use line breaks for lists. Keep most replies under 400 characters.\nWhen they send a photo of a product, packaging, receipt or handwritten list, work out the item(s) and add them to the shopping list with a short generic name (brand/size in the note), then say what you added. If a photo is ambiguous, ask.' : 'Reply concisely in plain text.'}
Use your tools for anything about the house rather than guessing, and never claim to have done something a tool didn't confirm. You can't browse the web.

The team:
${team}

Shared memory (facts any agent saved):
${mem}

Recent team activity:
${recent || '(none yet)'}`;
  }

  // ---------------------------------------------------------------- run an agent
  function publish(r) { broadcast({ type: 'agent-run', run: r }); }
  async function run(agentId, { text, images, who, channel, parentRun, depth, convo }) {
    const agent = get(agentId);
    if (!agent) throw Object.assign(new Error('No agent ' + agentId), { status: 404 });
    if (!agent.enabled) throw Object.assign(new Error(agent.name + ' is switched off'), { status: 409 });
    const r = { id: id('r'), agent: agent.id, parent: parentRun || null, channel: channel || 'admin', who: who || null, input: (text || '') + (images && images.length ? ' [' + images.length + ' photo]' : ''), steps: [], output: '', status: 'running', at: Date.now() };
    runs.unshift(r); runs = runs.slice(0, 400); publish(r);
    const c = { agent, who, channel: r.channel, runId: r.id, depth: depth || 0 };
    const past = convo ? (history[convo] || []).slice(-16) : [];
    const content = [];
    for (const im of (images || []).slice(0, 4)) content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } });
    content.push({ type: 'text', text: text && text.trim() ? text : (images && images.length ? '(sent a photo)' : '(empty)') });
    const messages = past.concat([{ role: 'user', content }]);
    const tools = toolDefs(agent);
    try {
      for (let round = 0; round < 10; round++) {
        const j = await callClaude(secrets, { model: agent.model || MODELS[0][0], max_tokens: 1500, system: system(agent, c), tools, messages });
        messages.push({ role: 'assistant', content: j.content });
        const uses = (j.content || []).filter(x => x.type === 'tool_use');
        const said = (j.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n').trim();
        if (!uses.length || j.stop_reason !== 'tool_use') { r.output = said; break; }
        const results = [];
        for (const u of uses) {
          const step = { tool: u.name, input: clip(u.input, 400), at: Date.now() };
          r.steps.push(step); publish(r);
          let res;
          try { res = await runTool(u.name, u.input || {}, c); } catch (e) { res = { error: e.message }; }
          step.result = clip(res, 600);
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(res).slice(0, 12000) });
        }
        messages.push({ role: 'user', content: results });
      }
      r.status = 'done';
    } catch (e) { r.status = 'error'; r.error = e.message; throw e; }
    finally {
      r.ms = Date.now() - r.at; publish(r); saveRuns();
      if (convo && r.status === 'done') {
        history[convo] = past.concat([{ role: 'user', content: r.input || '(photo)' }, { role: 'assistant', content: r.output || '(done)' }]).slice(-16);
        saveHistory();
      }
    }
    return { output: r.output || 'Done.', run: r };
  }
  const frontDesk = () => agents.find(a => a.enabled && (a.channels || []).includes('imessage')) || get('home');

  // ---------------------------------------------------------------- CONTEXT.md for Claude Code and humans
  function writeContext() {
    const lines = ['# Home HQ team context', '', 'Generated by Home HQ. Shared memory, the agent roster and recent activity, so anyone picking up the work can see where the agents left off.', '',
      '## Agents', ...agents.map(a => `- ${a.icon} **${a.name}** (\`${a.id}\`)${a.parent ? ' — reports to ' + a.parent : ''}${a.enabled ? '' : ' (off)'}: ${a.role}`), '',
      '## Shared memory', ...(memory.length ? memory.slice(0, 80).map(m => `- ${m.text} _(${(get(m.by) || {}).name || m.by}, ${new Date(m.at).toISOString().slice(0, 10)})_`) : ['- (empty)']), '',
      '## Recent activity', ...runs.slice(0, 30).map(r => `- ${new Date(r.at).toISOString().slice(0, 16).replace('T', ' ')} ${(get(r.agent) || {}).name || r.agent} via ${r.channel}: "${clip(r.input, 100)}" → ${clip(r.output || r.error || '', 160)}`)];
    fsp.writeFile(F('CONTEXT.md'), lines.join('\n') + '\n').catch(() => {});
  }
  writeContext();

  // ---------------------------------------------------------------- admin API
  function snapshot() {
    return { agents, catalog: catalog().map(g => ({ group: g.group, tools: g.tools.map(t => ({ name: t.name, description: t.description })) })), memory: memory.slice(0, 200), runs: runs.slice(0, 120), settings, models: MODELS };
  }
  function saveAgent(a) {
    const clean = {
      id: a.id && get(a.id) ? a.id : (String(a.name || 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'agent') + (get(a.id) ? '' : '-' + crypto.randomBytes(2).toString('hex')),
      name: String(a.name || 'New agent').slice(0, 40), icon: String(a.icon || '🤖').slice(0, 4), role: String(a.role || '').slice(0, 300),
      instructions: String(a.instructions || '').slice(0, 6000), model: MODELS.some(m => m[0] === a.model) ? a.model : MODELS[0][0],
      tools: (a.tools || []).map(String).slice(0, 60), can: (a.can || []).map(String).filter(x => x !== a.id).slice(0, 20),
      parent: a.parent && get(a.parent) && a.parent !== a.id ? a.parent : null, enabled: a.enabled !== false,
      channels: (a.channels || []).filter(x => x === 'imessage')
    };
    const existing = a.id && get(a.id);
    if (existing) { clean.id = existing.id; clean.builtin = existing.builtin; Object.assign(existing, clean); }
    else agents.push(clean);
    // Only one agent answers iMessage
    if (clean.channels.includes('imessage')) agents.forEach(x => { if (x.id !== clean.id) x.channels = (x.channels || []).filter(y => y !== 'imessage'); });
    // A sub-agent is automatically on its parent's team
    if (clean.parent) { const p = get(clean.parent); if (p && !(p.can || []).includes(clean.id)) p.can = (p.can || []).concat([clean.id]); }
    saveAgents();
    return existing || clean;
  }
  function deleteAgent(aid) {
    const a = get(aid); if (!a) return;
    if (a.builtin) throw Object.assign(new Error('Built-in agents can be switched off but not deleted'), { status: 400 });
    agents = agents.filter(x => x !== a);
    agents.forEach(x => { x.can = (x.can || []).filter(y => y !== aid); if (x.parent === aid) x.parent = a.parent || null; });
    saveAgents();
  }
  function addMemory(text, by) { memory.unshift({ id: id('m'), text: String(text).slice(0, 400), by: by || 'you', at: Date.now() }); saveMemory(); }
  function deleteMemory(mid) { memory = memory.filter(m => m.id !== mid); saveMemory(); }
  function setSettings(s) { for (const [k, v] of Object.entries(s || {})) if (v !== undefined) settings[k] = v; saveSettings(); return settings; }
  function clearHistory(key) { if (key) delete history[key]; else history = {}; saveHistory(); }

  return { run, frontDesk, snapshot, saveAgent, deleteAgent, addMemory, deleteMemory, settings: () => settings, setSettings, clearHistory, contextFile: F('CONTEXT.md'), get };
}
