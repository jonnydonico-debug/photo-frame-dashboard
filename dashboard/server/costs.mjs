// Claude API cost tracking. Every call Home HQ makes to the Claude API is logged with its token
// counts (as reported by the API in each response) and priced from the table below, which can be
// edited in Admin → Costs if Anthropic changes prices. The real bill is in the Anthropic Console;
// this is a close estimate of what Home HQ itself spent with your key.
// Stored as one JSON line per call in ~/HomeHQ/data/usage/YYYY-MM.jsonl.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

// US dollars per million tokens. Cache writes cost 1.25× input, cache reads 0.1× input.
export const DEFAULT_PRICES = {
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-haiku-5-5': { in: 0.10, out: 0.50 },
  web_search: 10 / 1000 // per search
};
const LABEL = m => /haiku/.test(m) ? 'Haiku' : /opus/.test(m) ? 'Opus' : /sonnet/.test(m) ? 'Sonnet' : m;
const pad = n => String(n).padStart(2, '0');
const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const monthKey = t => dayKey(t).slice(0, 7);

export function createCosts({ dataDir, log, commit, notify, agentName }) {
  const DIR = path.join(dataDir, 'usage');
  fs.mkdirSync(DIR, { recursive: true });
  const CFG = path.join(DIR, 'settings.json');
  let cfg = { prices: {}, budget: 0, alerted: {} };
  try { cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(CFG, 'utf8'))); } catch {}
  const saveCfg = () => fsp.writeFile(CFG, JSON.stringify(cfg, null, 1)).catch(e => log('costs save', e.message));
  const prices = () => {
    const p = JSON.parse(JSON.stringify(DEFAULT_PRICES));
    for (const [k, v] of Object.entries(cfg.prices || {})) p[k] = typeof v === 'object' ? Object.assign({}, p[k], v) : v;
    return p;
  };

  // Load every month's log (small: a busy month is well under a megabyte)
  let records = [];
  for (const f of fs.readdirSync(DIR).filter(f => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort()) {
    for (const line of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch {}
    }
  }

  function price(r, P) {
    const p = P[r.model] || P['claude-sonnet-5-5'];
    return ((r.in || 0) * p.in + (r.cw || 0) * p.in * 1.25 + (r.cr || 0) * p.in * 0.1 + (r.out || 0) * p.out) / 1e6 + (r.ws || 0) * (P.web_search || 0);
  }

  // Called by callClaude after every successful response
  function record(model, usage, tag) {
    if (!usage) return;
    const r = {
      t: Date.now(), model, agent: (tag && tag.agent) || null, ch: (tag && tag.channel) || null,
      in: usage.input_tokens || 0, out: usage.output_tokens || 0,
      cw: usage.cache_creation_input_tokens || 0, cr: usage.cache_read_input_tokens || 0,
      ws: (usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0
    };
    records.push(r);
    fsp.appendFile(path.join(DIR, monthKey(r.t) + '.jsonl'), JSON.stringify(r) + '\n').catch(e => log('costs log', e.message));
    publishSoon();
    checkBudget();
  }

  function summary() {
    const P = prices(), now = Date.now(), today = dayKey(now), month = monthKey(now);
    const lm = new Date(now); lm.setDate(1); lm.setMonth(lm.getMonth() - 1);
    const lastMonth = monthKey(lm.getTime());
    const weekAgo = now - 7 * 864e5;
    const empty = () => ({ cost: 0, calls: 0, searches: 0, inTok: 0, outTok: 0 });
    const add = (o, r, c) => { o.cost += c; o.calls++; o.searches += r.ws || 0; o.inTok += (r.in || 0) + (r.cw || 0) + (r.cr || 0); o.outTok += r.out || 0; };
    const T = { today: empty(), week: empty(), month: empty(), lastMonth: empty(), all: empty() };
    const days = {}, byAgent = {}, byModel = {}, byChannel = {};
    for (const r of records) {
      const c = price(r, P), d = dayKey(r.t), m = d.slice(0, 7);
      add(T.all, r, c);
      if (d === today) add(T.today, r, c);
      if (r.t >= weekAgo) add(T.week, r, c);
      if (m === lastMonth) add(T.lastMonth, r, c);
      if (r.t >= now - 30 * 864e5) { days[d] = days[d] || empty(); add(days[d], r, c); }
      if (m !== month) continue;
      add(T.month, r, c);
      const a = r.agent || (r.ch === 'setup' ? 'setup' : 'other');
      add(byAgent[a] = byAgent[a] || empty(), r, c);
      add(byModel[r.model] = byModel[r.model] || empty(), r, c);
      const ch = !r.ch ? 'other' : /^from /.test(r.ch) ? 'hand-offs' : r.ch;
      add(byChannel[ch] = byChannel[ch] || empty(), r, c);
    }
    // The last 30 days, oldest first, with empty days filled in
    const series = [];
    for (let i = 29; i >= 0; i--) { const d = dayKey(now - i * 864e5); series.push(Object.assign({ date: d }, days[d] || empty())); }
    // Rough month-end forecast from the last 7 days' pace
    const dt = new Date(now), dim = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
    const forecast = T.month.cost + (T.week.cost / 7) * (dim - dt.getDate());
    const rows = (o, name) => Object.entries(o).map(([k, v]) => Object.assign({ id: k, name: name(k) }, v)).sort((a, b) => b.cost - a.cost);
    return {
      updated: now, since: records.length ? records[0].t : null, budget: cfg.budget || 0, forecast,
      today: T.today, week: T.week, month: T.month, lastMonth: T.lastMonth, all: T.all, days: series,
      byAgent: rows(byAgent, k => k === 'setup' ? 'Key checks' : k === 'other' ? 'Other' : agentName(k)),
      byModel: rows(byModel, LABEL), byChannel: rows(byChannel, k => ({ imessage: 'iMessage', admin: 'Admin chat', schedule: 'Scheduled jobs', 'hand-offs': 'Agent hand-offs', setup: 'Key checks' })[k] || k),
      prices: P
    };
  }
  function recent(n) {
    const P = prices();
    return records.slice(-n).reverse().map(r => Object.assign({}, r, { cost: price(r, P), agentName: r.agent ? agentName(r.agent) : null, label: LABEL(r.model) }));
  }

  let pubTimer = null;
  function publish() { commit({ costs: summary() }, 'server'); }
  function publishSoon() { clearTimeout(pubTimer); pubTimer = setTimeout(publish, 1500); }

  // Text JD once a month when spending passes 80% and 100% of the budget
  function checkBudget() {
    if (!cfg.budget) return;
    const s = summary(), m = monthKey(Date.now()), al = cfg.alerted[m] = cfg.alerted[m] || {};
    for (const lvl of [1, 0.8]) {
      if (s.month.cost >= cfg.budget * lvl && !al[lvl]) {
        al[lvl] = true; if (lvl === 1) al[0.8] = true;
        saveCfg();
        notify('jd', (lvl === 1 ? 'Heads up: Home HQ has used its whole ' : 'Heads up: Home HQ has used 80% of its ') + '$' + cfg.budget.toFixed(2) + ' Claude budget this month ($' + s.month.cost.toFixed(2) + ' so far). Details in Admin → Costs.');
        break;
      }
    }
    for (const k of Object.keys(cfg.alerted)) if (k < m) delete cfg.alerted[k];
  }

  function setConfig(b) {
    if (b.budget !== undefined) { const v = +b.budget; cfg.budget = v > 0 && v < 100000 ? Math.round(v * 100) / 100 : 0; cfg.alerted = {}; }
    if (b.prices && typeof b.prices === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(b.prices)) {
        if (k === 'web_search') { const n = +v; if (n >= 0 && n < 1) out.web_search = n; continue; }
        if (!/^claude-[a-z0-9.-]+$/.test(k) || !v) continue;
        const i = +v.in, o = +v.out;
        if (i >= 0 && o >= 0 && i < 1000 && o < 1000) out[k] = { in: i, out: o };
      }
      cfg.prices = out;
    }
    if (b.resetPrices) cfg.prices = {};
    saveCfg(); publish(); checkBudget();
    return summary();
  }

  return { record, summary, recent, setConfig, publish, defaults: DEFAULT_PRICES };
}
