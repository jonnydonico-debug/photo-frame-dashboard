// Tools for the Plex agent: the library (through the Plex server), public-domain films from the
// Internet Archive's Feature Films collection, and filing movies dropped into an inbox folder.
// Folder paths are set in Admin → Agents → Plex (e.g. a NAS share mounted on the Mac).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const VIDEO = /\.(mkv|mp4|m4v|mov|avi|wmv|ts|webm)$/i;
const safe = s => String(s || '').replace(/[\/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

export function createPlexTools({ plex, plexOk, settings, log }) {
  const paths = () => (settings().plex || {});
  const downloads = new Map(); // identifier -> { done, total, error }

  async function sections() {
    const j = await plex('/library/sections');
    return ((j.MediaContainer && j.MediaContainer.Directory) || []).map(d => ({ key: d.key, title: d.title, type: d.type }));
  }
  function item(m) { return { title: m.title, year: m.year, type: m.type, show: m.grandparentTitle || undefined, added: m.addedAt ? new Date(m.addedAt * 1000).toISOString().slice(0, 10) : undefined, summary: m.summary ? m.summary.slice(0, 160) : undefined }; }
  async function scan() {
    const movies = (await sections()).filter(s => s.type === 'movie');
    for (const s of movies.length ? movies : await sections()) await plex('/library/sections/' + s.key + '/refresh', { raw: true });
    return { scanning: (movies.length ? movies : []).map(s => s.title) };
  }

  async function archiveSearch(q) {
    const query = 'collection:(feature_films) AND mediatype:(movies) AND (title:(' + q + ') OR subject:(' + q + '))';
    const u = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(query) + '&fl[]=identifier&fl[]=title&fl[]=year&fl[]=downloads&sort[]=downloads+desc&rows=10&output=json';
    const j = await (await fetch(u, { signal: AbortSignal.timeout(20000) })).json();
    return ((j.response && j.response.docs) || []).map(d => ({ id: d.identifier, title: d.title, year: d.year, popularity: d.downloads }));
  }
  async function archiveDownload(id, title, year) {
    const P = paths(); if (!P.moviesPath) return { error: 'Set the Plex movies folder in Admin → Agents → Plex first' };
    if (!fs.existsSync(P.moviesPath)) return { error: 'The movies folder isn’t reachable from the Mac (is the NAS share mounted?)' };
    const meta = await (await fetch('https://archive.org/metadata/' + encodeURIComponent(id), { signal: AbortSignal.timeout(20000) })).json();
    if (!meta || !meta.metadata) return { error: 'Not found on the Internet Archive' };
    if (!/feature_films/.test([].concat(meta.metadata.collection || []).join(' '))) return { error: 'Only films from the Feature Films (public domain) collection can be downloaded' };
    const files = (meta.files || []).filter(f => /\.(mp4|mkv|m4v)$/i.test(f.name) && +f.size < 8e9).sort((a, b) => (+b.size) - (+a.size));
    const f = files.find(x => /h\.?264|mpeg4/i.test(x.format || '')) || files[0];
    if (!f) return { error: 'No downloadable video file for that film' };
    const name = safe(title || meta.metadata.title) + (year || meta.metadata.year ? ' (' + (year || String(meta.metadata.year).slice(0, 4)) + ')' : '');
    const dir = path.join(P.moviesPath, name);
    await fsp.mkdir(dir, { recursive: true });
    const dest = path.join(dir, name + path.extname(f.name).toLowerCase());
    const st = { done: 0, total: +f.size, error: null, name };
    downloads.set(id, st);
    (async () => {
      try {
        const r = await fetch('https://archive.org/download/' + encodeURIComponent(id) + '/' + encodeURIComponent(f.name));
        if (!r.ok) throw new Error('Download failed: ' + r.status);
        const src = Readable.fromWeb(r.body); src.on('data', c => { st.done += c.length; });
        await pipeline(src, fs.createWriteStream(dest + '.part'));
        await fsp.rename(dest + '.part', dest);
        st.finished = true;
        if (plexOk()) await scan().catch(() => {});
        log('plex agent: downloaded', name);
      } catch (e) { st.error = e.message; log('plex agent download:', e.message); }
    })();
    return { downloading: name, sizeMB: Math.round(f.size / 1e6), to: dest, note: 'Runs in the background; Plex rescans when it finishes.' };
  }
  async function inboxList() {
    const P = paths(); if (!P.inboxPath) return { error: 'Set the inbox folder in Admin → Agents → Plex first' };
    const out = [];
    async function w(d, depth) { for (const e of await fsp.readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory() && depth < 2) await w(p, depth + 1); else if (VIDEO.test(e.name)) out.push({ file: path.relative(P.inboxPath, p), sizeMB: Math.round((await fsp.stat(p)).size / 1e6) }); } }
    await w(P.inboxPath, 0);
    return out.slice(0, 50);
  }
  async function inboxFile(file, title, year) {
    const P = paths(); if (!P.inboxPath || !P.moviesPath) return { error: 'Set both folders in Admin → Agents → Plex first' };
    const src = path.resolve(P.inboxPath, file);
    if (!src.startsWith(path.resolve(P.inboxPath) + path.sep)) return { error: 'That file isn’t in the inbox' };
    if (!fs.existsSync(src)) return { error: 'No such file in the inbox' };
    const name = safe(title) + (year ? ' (' + year + ')' : '');
    const dir = path.join(P.moviesPath, name);
    await fsp.mkdir(dir, { recursive: true });
    const dest = path.join(dir, name + path.extname(src).toLowerCase());
    try { await fsp.rename(src, dest); } catch (e) { if (e.code !== 'EXDEV') throw e; await fsp.copyFile(src, dest); await fsp.rm(src); }
    if (plexOk()) await scan().catch(() => {});
    return { filed: dest };
  }

  const tools = [
    { name: 'plex_search', description: 'Search the Plex library by title.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    { name: 'plex_recent', description: 'Recently added to Plex.', input_schema: { type: 'object', properties: {} } },
    { name: 'plex_scan', description: 'Ask Plex to rescan the movie libraries.', input_schema: { type: 'object', properties: {} } },
    { name: 'archive_search', description: 'Search public-domain feature films on the Internet Archive.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    { name: 'archive_download', description: 'Download a public-domain film from the Internet Archive into the Plex movies folder. Use the id from archive_search.', input_schema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, year: { type: 'string' } }, required: ['id'] } },
    { name: 'archive_progress', description: 'Progress of Internet Archive downloads.', input_schema: { type: 'object', properties: {} } },
    { name: 'inbox_list', description: 'Video files waiting in the inbox folder (movies the family owns and dropped in to be added).', input_schema: { type: 'object', properties: {} } },
    { name: 'inbox_file', description: 'Move a file from the inbox into the Plex movies folder as "Title (Year)/Title (Year).ext". Work out the real title and year from the file name first.', input_schema: { type: 'object', properties: { file: { type: 'string' }, title: { type: 'string' }, year: { type: 'string' } }, required: ['file', 'title'] } }
  ];
  async function runTool(name, a) {
    switch (name) {
      case 'plex_search': { if (!plexOk()) return { error: 'Plex isn’t connected yet (Admin → Settings → Plex)' }; const j = await plex('/search?query=' + encodeURIComponent(a.query || '')); return ((j.MediaContainer && j.MediaContainer.Metadata) || []).slice(0, 15).map(item); }
      case 'plex_recent': { if (!plexOk()) return { error: 'Plex isn’t connected yet (Admin → Settings → Plex)' }; const j = await plex('/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=15'); return ((j.MediaContainer && j.MediaContainer.Metadata) || []).map(item); }
      case 'plex_scan': if (!plexOk()) return { error: 'Plex isn’t connected yet' }; return scan();
      case 'archive_search': return archiveSearch(String(a.query || ''));
      case 'archive_download': return archiveDownload(String(a.id || ''), a.title, a.year);
      case 'archive_progress': return [...downloads.entries()].map(([k, v]) => ({ id: k, name: v.name, percent: v.total ? Math.round(v.done / v.total * 100) : null, finished: !!v.finished, error: v.error }));
      case 'inbox_list': return inboxList();
      case 'inbox_file': return inboxFile(String(a.file || ''), a.title, a.year);
    }
  }
  return { group: 'Plex', tools, run: runTool };
}
