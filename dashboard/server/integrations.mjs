// Outside services for Home HQ: BART departures, walking/driving times, address search,
// the iCloud shared album, and Spotify. Each one only runs once it has been set up in Admin.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createSonos } from './sonos.mjs';

const UA = 'HomeHQ/1.0 (family dashboard on a home Mac mini)';
const j = async (url, opts = {}) => {
  const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(opts.timeout || 10000) }, opts, { headers: Object.assign({ 'User-Agent': UA }, opts.headers || {}) }));
  if (!r.ok) { const e = new Error(url.split('?')[0] + ' returned ' + r.status); e.status = r.status; e.body = await r.text().catch(() => ''); throw e; }
  return r.json();
};

export function createIntegrations(ctx) {
  const { getState, commit, secrets, saveSecrets, log, dataDir, photosDir } = ctx;
  const S = () => getState();
  const sonos = createSonos({ log });

  // ---------------------------------------------------------------- places + routing (OpenStreetMap)
  const BART_STATIONS = [
    { code: 'PLZA', name: 'El Cerrito Plaza', lat: 37.902632, lon: -122.298904 },
    { code: 'DELN', name: 'El Cerrito del Norte', lat: 37.925086, lon: -122.316794 }
  ];
  let lastGeo = 0;
  async function geocode(q, near) {
    // Nominatim asks for at most one request a second.
    const wait = 1100 - (Date.now() - lastGeo); if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastGeo = Date.now();
    let url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=' + encodeURIComponent(q);
    if (near && near.lat != null) {
      const d = 0.6; url += '&viewbox=' + [near.lon - d, near.lat + d, near.lon + d, near.lat - d].join(',');
    }
    const res = await j(url, { headers: { 'Accept-Language': 'en' } });
    return res.map(x => ({ name: x.name || x.display_name.split(',')[0], label: x.display_name, lat: +x.lat, lon: +x.lon }));
  }
  const MI = 1609.344;
  async function route(from, to, mode) {
    const base = mode === 'walk' ? 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/' : 'https://router.project-osrm.org/route/v1/driving/';
    const url = base + from.lon + ',' + from.lat + ';' + to.lon + ',' + to.lat + '?overview=simplified&geometries=geojson';
    const r = await j(url, { timeout: 12000 });
    const rt = r.routes && r.routes[0];
    if (!rt) throw new Error('No route');
    return { min: Math.max(1, Math.round(rt.duration / 60)), mi: Math.round(rt.distance / MI * 10) / 10, line: rt.geometry.coordinates.map(c => [c[1], c[0]]) };
  }
  // ---------------------------------------------------------------- TomTom: live-traffic driving + traffic map tiles
  // Optional. With a key (Admin → Settings) drive times include current traffic, and the Map tab can
  // show traffic on the roads and along the route. The key never leaves the Mac mini.
  let ttStatus = { ok: null };
  async function ttRoute(from, to) {
    const key = secrets.tomtomKey;
    const url = 'https://api.tomtom.com/routing/1/calculateRoute/' + from.lat + ',' + from.lon + ':' + to.lat + ',' + to.lon +
      '/json?key=' + encodeURIComponent(key) + '&traffic=true&travelMode=car&routeType=fastest&departAt=now&sectionType=traffic&computeTravelTimeFor=all';
    try {
      const r = await j(url, { timeout: 12000 });
      const rt = r.routes && r.routes[0];
      if (!rt) throw new Error('No route');
      const sm = rt.summary, pts = [].concat(...rt.legs.map(l => l.points)).map(p => [p.latitude, p.longitude]);
      const traffic = (rt.sections || []).filter(x => x.sectionType === 'TRAFFIC').map(x => ({
        from: x.startPointIndex, to: x.endPointIndex, mag: x.magnitudeOfDelay || 0, kind: x.simpleCategory || 'JAM',
        delay: Math.round((x.delayInSeconds || 0) / 60)
      }));
      ttStatus = { ok: true, checked: new Date().toISOString() };
      return { min: Math.max(1, Math.round(sm.travelTimeInSeconds / 60)), mi: Math.round(sm.lengthInMeters / MI * 10) / 10, line: pts,
        delay: Math.round((sm.trafficDelayInSeconds || 0) / 60), usual: sm.noTrafficTravelTimeInSeconds ? Math.max(1, Math.round(sm.noTrafficTravelTimeInSeconds / 60)) : null,
        traffic, live: true };
    } catch (e) {
      const bad = e.status === 403 || e.status === 401;
      ttStatus = { ok: false, error: bad ? 'TomTom rejected the key' : e.message, checked: new Date().toISOString() };
      throw e;
    }
  }
  async function driveRoute(from, to) {
    if (secrets.tomtomKey) { try { return await ttRoute(from, to); } catch (e) { log('tomtom:', ttStatus.error); } }
    return route(from, to, 'drive');
  }
  const tileCache = new Map();
  async function trafficTile(z, x, y) {
    if (!secrets.tomtomKey) throw Object.assign(new Error('No TomTom key'), { status: 404 });
    if (![z, x, y].every(n => Number.isInteger(n) && n >= 0) || z > 22) throw Object.assign(new Error('Bad tile'), { status: 400 });
    const k = z + '/' + x + '/' + y, hit = tileCache.get(k);
    if (hit && Date.now() - hit.at < 120000) return hit.buf; // traffic changes every couple of minutes
    const r = await fetch('https://api.tomtom.com/traffic/map/4/tile/flow/relative0/' + k + '.png?tileSize=256&key=' + encodeURIComponent(secrets.tomtomKey), { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw Object.assign(new Error('TomTom tile ' + r.status), { status: r.status === 403 ? 403 : 409 });
    const buf = Buffer.from(await r.arrayBuffer());
    if (tileCache.size > 400) tileCache.clear();
    tileCache.set(k, { at: Date.now(), buf });
    return buf;
  }
  async function setTomtomKey(key) {
    secrets.tomtomKey = String(key || '').trim(); saveSecrets();
    ttStatus = { ok: null };
    if (secrets.tomtomKey) {
      const st = S().settings || {};
      const from = st.lat != null ? { lat: st.lat, lon: st.lon } : BART_STATIONS[0], to = BART_STATIONS[1];
      try { await ttRoute(from, to); } catch (e) { if (/rejected/.test(ttStatus.error || '')) { secrets.tomtomKey = ''; saveSecrets(); } return ttStatus; }
    }
    commit({ settings: Object.assign({}, S().settings, { traffic: !!secrets.tomtomKey && ttStatus.ok !== false }) }, 'server');
    refreshCommute().catch(() => {});
    return ttStatus;
  }

  async function routeBoth(from, to) {
    const [walk, drive] = await Promise.all([route(from, to, 'walk').catch(e => ({ error: e.message })), driveRoute(from, to).catch(e => ({ error: e.message }))]);
    return { walk, drive };
  }
  async function refreshCommute() {
    const st = S().settings || {};
    if (st.lat == null) return;
    const home = { lat: st.lat, lon: st.lon };
    const stations = [], prev = S().commute || {}, same = prev.from === (st.address || st.place);
    for (const s of BART_STATIONS) {
      const r = await routeBoth(home, s);
      // If a lookup fails, keep the last good time for that station rather than blanking it.
      const old = same && (prev.stations || []).find(x => x.code === s.code) || {};
      stations.push(Object.assign({}, s, {
        walk: r.walk.error ? old.walk || null : { min: r.walk.min, mi: r.walk.mi },
        drive: r.drive.error ? old.drive || null : { min: r.drive.min, mi: r.drive.mi, delay: r.drive.delay || 0, live: !!r.drive.live }
      }));
    }
    commit({ commute: { from: st.address || st.place, stations, updated: new Date().toISOString() } }, 'server');
  }

  // ---------------------------------------------------------------- BART departures (legacy API, public key)
  let bartTimer = null;
  async function refreshBart() {
    const key = secrets.bartKey || 'MW9S-E7SL-26DU-VV8V';
    const out = { updated: new Date().toISOString(), stations: [] };
    try {
      for (const s of BART_STATIONS) {
        const r = await j('https://api.bart.gov/api/etd.aspx?cmd=etd&json=y&key=' + key + '&orig=' + s.code);
        const stn = (r.root && r.root.station && r.root.station[0]) || {};
        const lines = (stn.etd || []).map(e => ({
          dest: e.destination, abbr: e.abbreviation,
          color: (e.estimate[0] && e.estimate[0].hexcolor) || '#888888',
          dir: e.estimate[0] && e.estimate[0].direction,
          mins: e.estimate.map(x => x.minutes === 'Leaving' ? 0 : +x.minutes).filter(n => !isNaN(n)),
          cars: e.estimate[0] && +e.estimate[0].length,
          delay: e.estimate.some(x => +x.delay > 0)
        })).sort((a, b) => (a.mins[0] ?? 99) - (b.mins[0] ?? 99));
        out.stations.push({ code: s.code, name: s.name, lines });
      }
      const msg = await j('https://api.bart.gov/api/bsa.aspx?cmd=bsa&json=y&key=' + key).catch(() => null);
      const adv = msg && msg.root && msg.root.bsa && msg.root.bsa[0];
      out.advisory = adv && adv.description && adv.description['#cdata-section'] && !/No delays reported/i.test(adv.description['#cdata-section']) ? adv.description['#cdata-section'] : '';
    } catch (e) { out.error = 'BART times unavailable'; log('bart:', e.message); }
    commit({ bart: out }, 'server');
  }
  function startBart() { refreshBart(); clearInterval(bartTimer); bartTimer = setInterval(refreshBart, 30000); }

  // ---------------------------------------------------------------- iCloud shared album (public website link)
  const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  function albumToken(link) {
    const s = String(link || '');
    const m = s.match(/#([A-Za-z0-9]{10,})/) || s.match(/sharedalbum\/(?:#)?([AB][A-Za-z0-9]{10,})/);
    return m ? m[1] : null;
  }
  // New-style links (2025+): https://photos.icloud.com/shared/album/<key> — a CloudKit share.
  function ckKey(link) { const m = String(link || '').match(/photos\.icloud\.com\/shared\/album\/([A-Za-z0-9_-]{10,})/); return m ? m[1] : null; }
  // Other share links (share.icloud.com, apple.co) don't show the album token, so
  // follow the link the way a browser would and pick the token out of where it lands.
  async function resolveAlbumLink(link) {
    let url = String(link || '').trim();
    if (ckKey(url)) return 'ck:' + ckKey(url);
    if (albumToken(url)) return albumToken(url);
    if (!/^https:\/\/[^/]*(icloud\.com|apple\.co)\b/i.test(url)) return null;
    for (let i = 0; i < 6; i++) {
      const r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' }, signal: AbortSignal.timeout(15000) });
      const loc = r.headers.get('location');
      if (loc) { url = new URL(loc, url).toString(); if (ckKey(url)) return 'ck:' + ckKey(url); if (albumToken(url)) return albumToken(url); continue; }
      const html = await r.text();
      const m = html.match(/sharedalbum\/#([A-Za-z0-9]{10,})/) || html.match(/["'#](B[0-9A-Za-z]{14})["']/);
      return m ? m[1] : null;
    }
    return null;
  }
  function albumBase(token) {
    const part = token[0] === 'A' ? B62.indexOf(token[1]) : B62.indexOf(token[1]) * 62 + B62.indexOf(token[2]);
    return 'https://p' + String(part).padStart(2, '0') + '-sharedstreams.icloud.com/' + token + '/sharedstreams/';
  }
  async function icloudPost(base, endpoint, body, token) {
    const r = await fetch(base + endpoint, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain', 'User-Agent': UA, Origin: 'https://www.icloud.com' }, signal: AbortSignal.timeout(20000) });
    if (r.status === 330) {
      const host = (await r.json())['X-Apple-MMe-Host'];
      return icloudPost('https://' + host + '/' + token + '/sharedstreams/', endpoint, body, token);
    }
    if (!r.ok) throw new Error('iCloud returned ' + r.status + (r.status === 404 ? ' (is Public Website turned on?)' : ''));
    return { json: await r.json(), base };
  }
  const CK_HEADERS = { 'Content-Type': 'text/plain', 'User-Agent': UA, Origin: 'https://photos.icloud.com', Referer: 'https://photos.icloud.com/' };
  async function ckAlbum(key) {
    const res = (await j('https://ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/public/records/resolve?remapEnums=true&getCurrentSyncToken=true&sharing_url_key=' + key,
      { method: 'POST', headers: CK_HEADERS, body: JSON.stringify({ shortGUIDs: [{ value: key }] }), timeout: 20000 })).results[0];
    if (!res || !res.anonymousPublicAccess) throw new Error('This album isn’t shared publicly (turn on Public Link / “Anyone with the link”)');
    const ap = res.anonymousPublicAccess;
    const title = res.share && res.share.fields && res.share.fields['cloudkit.title'] ? res.share.fields['cloudkit.title'].value : 'Shared album';
    const q = ap.databasePartition.replace(/:443$/, '') + '/database/1/com.apple.photos.cloud/production/shared/records/query?remapEnums=true&getCurrentSyncToken=true&sharing_url_key=' + key + '&publicAccessAuthToken=' + encodeURIComponent(ap.token);
    const masters = {}, assets = [], seen = new Set();
    for (let rank = 0, page = 0; page < 50; page++) {
      const r = await j(q, { method: 'POST', headers: CK_HEADERS, timeout: 30000, body: JSON.stringify({
        query: { recordType: 'CPLAssetAndMasterByAddedDate', filterBy: [
          { fieldName: 'direction', comparator: 'EQUALS', fieldValue: { type: 'STRING', value: 'DESCENDING' } },
          { fieldName: 'startRank', comparator: 'EQUALS', fieldValue: { type: 'INT64', value: rank } }] },
        zoneID: res.zoneID, resultsLimit: 200 }) });
      const recs = r.records || [];
      let n = 0, fresh = 0;
      for (const x of recs) {
        if (x.recordType === 'CPLMaster') masters[x.recordName] = x.fields;
        if (x.recordType === 'CPLAsset') { n++; if (!seen.has(x.recordName)) { seen.add(x.recordName); assets.push(x.fields); fresh++; } }
      }
      // Past the end the server can repeat the last page, so stop when nothing new arrives.
      if (!n || !fresh) break;
      rank += n;
      if (assets.length >= 1000) break;
    }
    const items = [], done = new Set();
    for (const a of assets) {
      const ref = a.masterRef && a.masterRef.value && a.masterRef.value.recordName, m = masters[ref];
      if (!m || !m.resJPEGMedRes || done.has(ref)) continue;
      done.add(ref);
      const type = m.itemType ? m.itemType.value : '';
      if (/movie|mpeg|video/i.test(type)) continue;
      let w = m.resJPEGMedWidth ? m.resJPEGMedWidth.value : 0, h = m.resJPEGMedHeight ? m.resJPEGMedHeight.value : 0;
      const o = a.orientation ? a.orientation.value : 1;
      if (o >= 5 && o <= 8) { const t = w; w = h; h = t; }
      items.push({ id: ref.replace(/[^A-Za-z0-9]/g, ''), url: m.resJPEGMedRes.value.downloadURL.replace('${f}', 'photo.jpg'), w, h,
        date: new Date((a.assetDate && a.assetDate.value) || (m.originalCreationDate && m.originalCreationDate.value) || Date.now()) });
    }
    return { title, items };
  }
  let albumStatus = { ok: false, note: 'Not set up' }, albumBusy = false;
  async function syncAlbum() {
    const token = secrets.icloudAlbumToken || albumToken(secrets.icloudAlbum);
    if (!token || albumBusy) return albumStatus;
    albumBusy = true;
    const dir = path.join(photosDir, 'icloud');
    fs.mkdirSync(dir, { recursive: true });
    try {
      if (token.startsWith('ck:')) {
        const album = await ckAlbum(token.slice(3));
        const have = new Set(fs.readdirSync(dir));
        for (const it of album.items) {
          if (have.has(it.id + '.jpg')) continue;
          const r = await fetch(it.url, { signal: AbortSignal.timeout(30000) });
          if (r.ok) await fsp.writeFile(path.join(dir, it.id + '.jpg'), Buffer.from(await r.arrayBuffer()));
        }
        const keep = new Set(album.items.map(x => x.id + '.jpg'));
        for (const f of fs.readdirSync(dir)) if (!keep.has(f)) fs.rmSync(path.join(dir, f), { force: true });
        const own = (S().photos || []).filter(x => x.src && !x.icloud);
        const old = Object.fromEntries((S().photos || []).filter(x => x.icloud).map(x => [x.id, x]));
        const list = album.items.filter(x => fs.existsSync(path.join(dir, x.id + '.jpg'))).map(x => {
          const id = 'ic-' + x.id;
          return { id, icloud: true, src: '/photos/icloud/' + x.id + '.jpg', o: x.h > x.w ? 'p' : 'l', date: x.date.toISOString().slice(0, 10),
            place: '', from: 'family', tag: x.date.toISOString().slice(0, 10), fav: !!(old[id] && old[id].fav) };
        });
        commit({ photos: own.concat(list) }, 'server');
        albumStatus = { ok: true, name: album.title, count: list.length, checked: new Date().toISOString() };
        albumBusy = false;
        return albumStatus;
      }
      const first = await icloudPost(albumBase(token), 'webstream', { streamCtag: null }, token);
      const stream = first.json, base = first.base;
      const items = (stream.photos || []).filter(p => p.mediaAssetType !== 'video');
      // Pick the largest still image up to ~2000px per photo.
      const picks = items.map(p => {
        const ds = Object.values(p.derivatives || {}).filter(d => d.checksum && +d.width > 0)
          .sort((a, b) => (+b.width) - (+a.width));
        const d = ds.find(x => +x.width <= 2100 && +x.height <= 2100) || ds[ds.length - 1];
        return d ? { p, d } : null;
      }).filter(Boolean);
      const have = new Set(fs.readdirSync(dir));
      const need = picks.filter(x => !have.has(x.p.photoGuid + '.jpg'));
      for (let i = 0; i < need.length; i += 25) {
        const batch = need.slice(i, i + 25);
        const urls = (await icloudPost(base, 'webasseturls', { photoGuids: batch.map(x => x.p.photoGuid) }, token)).json.items || {};
        for (const { p, d } of batch) {
          const u = urls[d.checksum]; if (!u) continue;
          const r = await fetch('https://' + u.url_location + u.url_path, { signal: AbortSignal.timeout(30000) });
          if (r.ok) await fsp.writeFile(path.join(dir, p.photoGuid + '.jpg'), Buffer.from(await r.arrayBuffer()));
        }
      }
      // Drop files for photos that were removed from the album.
      const keep = new Set(picks.map(x => x.p.photoGuid + '.jpg'));
      for (const f of fs.readdirSync(dir)) if (!keep.has(f)) fs.rmSync(path.join(dir, f), { force: true });
      const own = (S().photos || []).filter(x => x.src && !x.src.startsWith('/photos/icloud/'));
      const old = Object.fromEntries((S().photos || []).filter(x => x.icloud).map(x => [x.id, x]));
      const album = picks.filter(x => fs.existsSync(path.join(dir, x.p.photoGuid + '.jpg'))).map(({ p, d }) => {
        const dt = new Date(p.dateCreated || p.batchDateCreated || Date.now());
        const id = 'ic-' + p.photoGuid;
        return { id, icloud: true, src: '/photos/icloud/' + p.photoGuid + '.jpg', o: +d.height > +d.width ? 'p' : 'l',
          date: dt.toISOString().slice(0, 10), place: p.caption || stream.streamName || 'Shared album', from: 'family',
          tag: (p.batchGuid || id), fav: !!(old[id] && old[id].fav) };
      });
      commit({ photos: own.concat(album) }, 'server');
      albumStatus = { ok: true, name: stream.streamName, count: album.length, checked: new Date().toISOString() };
    } catch (e) { albumStatus = { ok: false, error: e.message, checked: new Date().toISOString() }; log('icloud:', e.message); }
    albumBusy = false;
    return albumStatus;
  }

  // ---------------------------------------------------------------- Spotify
  const SP = () => (secrets.spotify = secrets.spotify || {});
  const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private user-read-recently-played user-library-read';
  let spState = { connected: false }, spStatus = { ok: false, note: 'Not set up' };
  function spotifyAuthUrl(redirect) {
    const sp = SP(); sp.oauthState = crypto.randomBytes(12).toString('hex'); sp.redirect = redirect; saveSecrets();
    return 'https://accounts.spotify.com/authorize?' + new URLSearchParams({ response_type: 'code', client_id: sp.clientId, scope: SCOPES, redirect_uri: redirect, state: sp.oauthState });
  }
  async function spotifyToken(params) {
    const sp = SP();
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST', body: new URLSearchParams(params), signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(sp.clientId + ':' + sp.clientSecret).toString('base64') }
    });
    const t = await r.json();
    if (!r.ok) throw new Error(t.error_description || t.error || 'Spotify token error');
    sp.accessToken = t.access_token; sp.exp = Date.now() + (t.expires_in - 60) * 1000;
    if (t.refresh_token) sp.refreshToken = t.refresh_token;
    saveSecrets();
  }
  async function spotifyCallback(code, state) {
    const sp = SP();
    if (!state || state !== sp.oauthState) throw new Error('Sign-in expired. Try Connect Spotify again.');
    await spotifyToken({ grant_type: 'authorization_code', code, redirect_uri: sp.redirect });
    delete sp.oauthState; saveSecrets();
    startSpotify();
  }
  async function sp(method, p, body) {
    const s = SP();
    if (!s.refreshToken) throw new Error('Spotify is not connected');
    if (!s.accessToken || Date.now() > s.exp) await spotifyToken({ grant_type: 'refresh_token', refresh_token: s.refreshToken });
    const r = await fetch('https://api.spotify.com/v1' + p, {
      method, signal: AbortSignal.timeout(10000),
      headers: Object.assign({ Authorization: 'Bearer ' + s.accessToken }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    if (r.status === 204 || r.status === 202) return null;
    const t = await r.text(); let js = null; try { js = t ? JSON.parse(t) : null; } catch {}
    if (!r.ok) {
      const msg = (js && js.error && (js.error.message || js.error.reason)) || ('Spotify ' + r.status);
      throw Object.assign(new Error(/premium/i.test(msg) || (js && js.error && js.error.reason === 'PREMIUM_REQUIRED') ? 'Spotify Premium is needed to control playback' : msg), { status: r.status });
    }
    return js;
  }
  const img = (images, w) => { if (!images || !images.length) return ''; const s = images.slice().sort((a, b) => (a.width || 0) - (b.width || 0)); return (s.find(i => (i.width || 0) >= w) || s[s.length - 1]).url; };
  let devicesAt = 0, devices = [], npFail = 0;
  const metaCache = new Map();
  async function trackMeta(uri) {
    if (metaCache.has(uri)) return metaCache.get(uri);
    const id = (uri.match(/^spotify:track:([A-Za-z0-9]+)$/) || [])[1];
    if (!id) return null;
    try {
      const t = await sp('GET', '/tracks/' + id);
      const m = t && t.name ? { name: t.name, artists: t.artists || [], album: { name: (t.album && t.album.name) || '', images: (t.album && t.album.images) || [] }, uri, duration_ms: t.duration_ms } : null;
      if (metaCache.size > 500) metaCache.clear();
      metaCache.set(uri, m);
      return m;
    } catch (e) { log('spotify track lookup:', e.message); return null; }
  }
  async function refreshSpotify() {
    if (!SP().refreshToken) return;
    try {
      let p = await sp('GET', '/me/player?additional_types=episode');
      // Music queued on the Sonos (not a Spotify Connect session) is invisible to Spotify: ask the speaker.
      const t = secrets.musicTarget;
      const ask = room => sonos.nowPlaying(room).then(n => { if (npFail) log('sonos: answering again'); npFail = 0; return n; })
        .catch(e => { if (!npFail++) log('sonos now playing:', e.message, '(looking for it again)'); return null; });
      if (p && p.item && p.device && (p.device.is_restricted || !p.device.id)) {
        // Spotify's report for a Sonos lags behind (and goes stale after the dashboard pauses or
        // skips the speaker directly), so play/pause and position come from the speaker itself.
        const room = await sonos.find(p.device.name).catch(() => null);
        const n = room ? await ask(room) : null;
        if (n) { p.is_playing = n.playing; if (n.duration) p.progress_ms = n.progress; }
      } else if (t && t.sonos && !(p && p.item && p.is_playing)) {
        const room = await sonos.find(t.name).catch(() => null);
        const n = room ? await ask(room) : null;
        // Songs the dashboard queues carry no metadata (the Beam rejects it), so the speaker only
        // knows the Spotify track id. Fill in title/artist/art from Spotify.
        const m = n && n.uri && (!n.title || !n.art || /^(x-sonos|spotify)/i.test(n.title)) ? await trackMeta(n.uri) : null;
        if (n && (n.title || m)) p = { is_playing: n.playing, progress_ms: n.progress, shuffle_state: false, repeat_state: 'off', context: null,
          device: { id: null, name: room.name, type: 'Speaker', volume_percent: n.volume, is_restricted: true },
          item: m && (!n.title || /^(x-sonos|spotify)/i.test(n.title))
            ? Object.assign({}, m, { duration_ms: n.duration || m.duration_ms })
            : { name: n.title, artists: [{ name: n.artist }], album: { name: n.album, images: n.art ? [{ url: n.art, width: 300 }] : (m ? m.album.images : []) }, uri: n.uri, duration_ms: n.duration } };
      }
      if (Date.now() - devicesAt > 30000) { devices = ((await sp('GET', '/me/player/devices')) || {}).devices || []; devicesAt = Date.now(); }
      const it = p && p.item;
      const next = {
        connected: true, playing: !!(p && p.is_playing),
        title: it ? it.name : '', artist: it ? (it.artists ? it.artists.map(a => a.name).join(', ') : (it.show && it.show.name) || '') : '',
        album: it && it.album ? it.album.name : '', art: it ? img((it.album && it.album.images) || it.images, 300) : '',
        uri: it ? it.uri : '', progress: p ? p.progress_ms : 0, duration: it ? it.duration_ms : 0, at: Date.now(),
        shuffle: !!(p && p.shuffle_state), repeat: p ? p.repeat_state : 'off',
        device: p && p.device ? { id: p.device.id, name: p.device.name, type: p.device.type, volume: p.device.volume_percent, restricted: !!p.device.is_restricted || !p.device.id } : null,
        context: p && p.context ? p.context.uri : '',
        devices: speakerList(p && p.device),
        target: secrets.musicTarget || null
      };
      spStatus = { ok: true, checked: new Date().toISOString() };
      const cmp = o => JSON.stringify(Object.assign({}, o, { progress: 0, at: 0 }));
      // Push when something visible changed, and every 30 s to keep progress bars honest.
      if (cmp(next) !== cmp(spState) || Date.now() - (spState.at || 0) > 30000) { spState = next; commit({ music: next }, 'server'); }
    } catch (e) { spStatus = { ok: false, error: e.message, checked: new Date().toISOString() }; if (e.status !== 429) log('spotify:', e.message); }
  }
  // Speakers = Spotify Connect devices + every Sonos room found on the network (Spotify only lists
  // a Sonos while it's already playing, and won't let apps start music on it).
  function speakerList(current) {
    const sonosRooms = [...new Set(sonos.rooms().map(r => r.name))];
    const isSonos = name => sonosRooms.some(n => String(name).toLowerCase().replace(/\s*sonos\s*/g, ' ').trim() === n.toLowerCase());
    const curName = current && current.name;
    const list = devices.filter(d => !(d.is_restricted && isSonos(d.name)))
      .map(d => ({ id: d.id, name: d.name, type: d.type, active: d.is_active, volume: d.volume_percent, restricted: d.is_restricted }));
    const t = secrets.musicTarget;
    sonosRooms.forEach(n => list.push({ id: 'sonos:' + n, name: n, type: 'Sonos', sonos: true,
      active: !!(curName && isSonos(curName) && curName.toLowerCase().includes(n.toLowerCase())) || !!(t && t.id === 'sonos:' + n && !(current && current.id && !current.is_restricted && !isSonos(curName))) }));
    return list;
  }
  let spTimer = null, sonosTimer = null;
  function startSpotify() {
    if (!SP().refreshToken) return;
    sonos.scan().then(refreshSpotify);
    clearInterval(spTimer); spTimer = setInterval(refreshSpotify, 5000);
    clearInterval(sonosTimer); sonosTimer = setInterval(() => sonos.scan(), 10 * 60000);
  }
  async function sonosRoomFor() {
    const cur = spState.device, t = secrets.musicTarget;
    if (cur && cur.restricted) return sonos.find(cur.name);
    // Chosen Sonos as the speaker, and Spotify isn't actively playing somewhere else
    if (t && t.sonos && !(cur && cur.id && spState.playing)) return sonos.find(t.name);
    return null;
  }
  async function spotifyCommand(b) {
    // Spotify refuses remote control of "restricted" speakers (Sonos). Talk to the Sonos directly.
    const cur = spState.device;
    // Pick a speaker
    if (b.action === 'transfer') {
      if (String(b.device).startsWith('sonos:')) {
        const name = b.device.slice(6), room = await sonos.find(name);
        if (!room) throw new Error(name + ' isn’t answering on the network');
        secrets.musicTarget = { id: b.device, name, sonos: true }; saveSecrets();
        // Bring whatever is playing on Spotify over to the Sonos
        if (spState.playing && cur && cur.id && !cur.restricted && (spState.context || spState.uri)) {
          const list = /:(album|playlist):/.test(spState.context) ? await trackList({ uri: spState.context }).catch(() => [spState.uri]) : [spState.uri];
          await sonos.playSpotify(room, list, Math.max(0, list.indexOf(spState.uri)));
          await sp('PUT', '/me/player/pause').catch(() => {});
        }
        setTimeout(refreshSpotify, 1200);
        return { ok: true, via: 'sonos' };
      }
      secrets.musicTarget = { id: b.device, name: b.name || '', sonos: false }; saveSecrets();
      const room = cur && cur.restricted ? await sonos.find(cur.name) : null;
      if (room) await sonos.command(room, 'pause').catch(() => {});
    }
    // Start something on a Sonos
    if (b.action === 'play' && (b.uri || b.uris)) {
      const room = await sonosRoomFor();
      if (room) {
        const r = await sonos.playSpotify(room, await trackList(b), +b.offset || 0);
        if (cur && cur.id && !cur.restricted && spState.playing) await sp('PUT', '/me/player/pause').catch(() => {});
        setTimeout(refreshSpotify, 1500);
        return Object.assign({ via: 'sonos' }, r);
      }
    }
    if (!b.uri && !b.uris && ['play', 'pause', 'next', 'prev', 'volume'].includes(b.action) && (cur && cur.restricted || (!cur || !cur.id) && secrets.musicTarget && secrets.musicTarget.sonos)) {
      const room = await sonosRoomFor();
      if (!room) throw new Error((cur ? cur.name : 'That speaker') + ' isn’t answering on the network');
      try { await sonos.command(room, b.action, b.volume); }
      catch (e) {
        // 701 = "nothing to resume": the song was started from the Spotify app and that session has
        // ended (or the Sonos is on TV sound). Load the same song (and its album/playlist) straight
        // onto the Sonos instead, picking up where it was, or the next/previous song.
        if (!/said no/.test(e.message) || b.action === 'volume') throw e;
        if (b.action === 'pause') return { ok: true, via: 'sonos', note: 'already stopped' };
        await resumeOnSonos(room, b.action, e);
      }
      if (b.action === 'play' || b.action === 'pause') { spState = Object.assign({}, spState, { playing: b.action === 'play', at: Date.now() }); commit({ music: spState }, 'server'); }
      setTimeout(refreshSpotify, 900);
      return { ok: true, via: 'sonos' };
    }
    const dev = b.device ? '?device_id=' + encodeURIComponent(b.device) : '';
    switch (b.action) {
      case 'play': {
        let body;
        if (b.uris) body = { uris: b.uris.slice(0, 100), offset: { position: +b.offset || 0 } };
        else if (b.uri && /:track:/.test(b.uri)) body = { uris: [b.uri] };
        else if (b.uri) body = Object.assign({ context_uri: b.uri }, b.offset != null && !/:artist:/.test(b.uri) ? { offset: { position: +b.offset } } : {});
        const t = secrets.musicTarget;
        const devq = dev || (body && (!cur || !cur.id) && t && !t.sonos ? '?device_id=' + encodeURIComponent(t.id) : '');
        await sp('PUT', '/me/player/play' + devq, body);
        break;
      }
      case 'pause': await sp('PUT', '/me/player/pause'); break;
      case 'next': await sp('POST', '/me/player/next'); break;
      case 'prev': await sp('POST', '/me/player/previous'); break;
      case 'volume': await sp('PUT', '/me/player/volume?volume_percent=' + Math.max(0, Math.min(100, Math.round(+b.volume)))); break;
      case 'shuffle': await sp('PUT', '/me/player/shuffle?state=' + (b.on ? 'true' : 'false')); break;
      case 'transfer': await sp('PUT', '/me/player', { device_ids: [b.device], play: !!spState.playing || b.play === true }); devicesAt = 0; break;
      default: throw new Error('Unknown music action');
    }
    setTimeout(refreshSpotify, 400);
    return { ok: true };
  }
  let libCache = { at: 0, data: null };
  async function spotifyLibrary() {
    if (libCache.data && Date.now() - libCache.at < 10 * 60000) return libCache.data;
    const [me, pl, recent] = await Promise.all([sp('GET', '/me'), sp('GET', '/me/playlists?limit=50'), sp('GET', '/me/player/recently-played?limit=30').catch(() => null)]);
    // Only playlists you made (or collaborate on): Spotify won't share the songs in anyone else's.
    const mine = ((pl && pl.items) || []).filter(p => p && (p.collaborative || (p.owner && me && p.owner.id === me.id)));
    const seen = new Set(), recents = [];
    for (const r of (recent && recent.items) || []) {
      const c = r.context;
      if (c && (c.type === 'playlist' || c.type === 'album') && !seen.has(c.uri)) { seen.add(c.uri); recents.push(c.uri); }
    }
    const data = {
      playlists: [{ uri: 'liked', name: 'Liked Songs', by: 'Your library', art: '', liked: true }].concat(mine.map(p => ({ uri: p.uri, name: p.name, by: p.owner && p.owner.display_name, art: img(p.images, 300), tracks: p.tracks && p.tracks.total }))),
      recentTracks: ((recent && recent.items) || []).slice(0, 12).map(r => ({ uri: r.track.uri, name: r.track.name, by: r.track.artists.map(a => a.name).join(', '), art: img(r.track.album.images, 120) }))
        .filter((t, i, a) => a.findIndex(x => x.uri === t.uri) === i).slice(0, 8)
    };
    libCache = { at: Date.now(), data };
    return data;
  }
  // Songs to queue on a Sonos for a play request
  async function resumeOnSonos(room, action, err) {
    const uri = spState.uri, ctx = spState.context, pos = spState.progress || 0;
    if (!uri || !/:track:/.test(uri)) {
      const src = await sonos.source(room).catch(() => ({}));
      throw new Error(src.kind === 'tv' ? 'The Sonos is playing TV sound right now. Pick a song or playlist in Music to switch it.' : 'Nothing to resume on the Sonos. Pick a song or playlist in Music.');
    }
    let list = [uri];
    if (/:(album|playlist):/.test(ctx || '')) list = await trackList({ uri: ctx }).catch(() => [uri]);
    let i = Math.max(0, list.indexOf(uri));
    if (action === 'next') i = Math.min(list.length - 1, i + 1);
    if (action === 'prev') i = pos > 5000 ? i : Math.max(0, i - 1);
    await sonos.playSpotify(room, list, i);
    // Pick up mid-song on Play (best effort; the speaker needs a moment to start)
    if (action === 'play' && list[i] === uri && pos > 5000) setTimeout(() => sonos.seek(room, pos).catch(() => {}), 1500);
    log('music: Sonos had nothing to', action, '(' + err.message + '), so the song was loaded onto it again');
  }
  async function trackList(b) {
    if (b.uris) return b.uris;
    if (/:track:/.test(b.uri)) return [b.uri];
    const it = await spotifyItems(b.uri);
    const list = (it.tracks || []).map(x => x.uri);
    if (!list.length) throw new Error('Spotify won’t share the songs in this playlist, so it can’t be sent to the Sonos. Play it from the Spotify app instead.');
    return list;
  }
  // Open an album / playlist / artist / Liked Songs to see its tracks
  async function spotifyItems(uri) {
    const t = x => ({ uri: x.uri, name: x.name, by: (x.artists || []).map(a => a.name).join(', '), ms: x.duration_ms, art: x.album ? img(x.album.images, 120) : '' });
    if (uri === 'liked') {
      const r = await sp('GET', '/me/tracks?limit=50');
      const tracks = ((r && r.items) || []).map(i => i.track).filter(Boolean).map(t);
      return { kind: 'liked', name: 'Liked Songs', by: tracks.length + ' recent songs', art: '', tracks, playAs: 'uris' };
    }
    const [, kind, id] = String(uri).match(/^spotify:(playlist|album|artist):([A-Za-z0-9]+)$/) || [];
    if (!kind) throw new Error('Can’t open that');
    if (kind === 'album') {
      const a = await sp('GET', '/albums/' + id);
      const art = img(a.images, 300);
      return { kind, uri, name: a.name, by: a.artists.map(x => x.name).join(', ') + ' · ' + String(a.release_date || '').slice(0, 4), art,
        tracks: a.tracks.items.map(x => Object.assign(t(x), { art: '' })), playAs: 'context' };
    }
    if (kind === 'playlist') {
      // Spotify renamed playlist "tracks" to "items" in 2025; handle both.
      const p = await sp('GET', '/playlists/' + id);
      let rows = (p.items && p.items.items) || (p.tracks && p.tracks.items) || [];
      if (!rows.length) {
        const r = await sp('GET', '/playlists/' + id + '/items?limit=100').catch(() => sp('GET', '/playlists/' + id + '/tracks?limit=100').catch(() => null));
        rows = (r && r.items) || [];
      }
      const total = (p.items && p.items.total) || (p.tracks && p.tracks.total) || rows.length;
      return { kind, uri, name: p.name, by: (p.owner && p.owner.display_name || '') + ' · ' + total + ' songs', art: img(p.images, 300),
        tracks: rows.map(i => i.item || i.track).filter(x => x && x.uri && /:track:/.test(x.uri)).map(t), playAs: 'context' };
    }
    const [a, top, albums] = await Promise.all([sp('GET', '/artists/' + id), sp('GET', '/artists/' + id + '/top-tracks?market=from_token').catch(() => null),
      sp('GET', '/artists/' + id + '/albums?include_groups=album,single&limit=12').catch(() => null)]);
    return { kind, uri, name: a.name, by: 'Artist', art: img(a.images, 300), tracks: ((top && top.tracks) || []).map(t), playAs: 'uris',
      albums: ((albums && albums.items) || []).map(x => ({ uri: x.uri, name: x.name, by: String(x.release_date || '').slice(0, 4), art: img(x.images, 300) })) };
  }
  async function spotifySearch(q) {
    const r = await sp('GET', '/search?type=track,playlist,album,artist&limit=6&q=' + encodeURIComponent(q));
    const pick = (list, f) => ((list && list.items) || []).filter(Boolean).map(f);
    return {
      tracks: pick(r.tracks, t => ({ uri: t.uri, name: t.name, by: t.artists.map(a => a.name).join(', '), art: img(t.album.images, 120) })),
      playlists: pick(r.playlists, p => ({ uri: p.uri, name: p.name, by: p.owner && p.owner.display_name, art: img(p.images, 300) })),
      albums: pick(r.albums, a => ({ uri: a.uri, name: a.name, by: a.artists.map(x => x.name).join(', '), art: img(a.images, 300) })),
      artists: pick(r.artists, a => ({ uri: a.uri, name: a.name, by: 'Artist', art: img(a.images, 300) }))
    };
  }

  // ---------------------------------------------------------------- start
  function start() {
    startBart();
    refreshCommute().catch(e => log('commute:', e.message));
    setInterval(() => refreshCommute().catch(e => log('commute:', e.message)), 10 * 60e3); // every 10 min
    syncAlbum(); setInterval(syncAlbum, 20 * 60000);
    startSpotify();
  }

  return {
    start, geocode, routeBoth, refreshCommute, trafficTile, setTomtomKey, tomtomStatus: () => ({ set: !!secrets.tomtomKey, status: ttStatus }), refreshBart, syncAlbum, albumStatus: () => albumStatus, albumToken, resolveAlbumLink,
    // For the server log: what the music controls are aimed at right now
    musicDebug: () => { const d = spState.device; const t = secrets.musicTarget; return 'playing ' + (d ? d.name + (d.restricted ? ' (Sonos/restricted)' : '') : 'nowhere') + ' · picked ' + (t ? t.name + (t.sonos ? ' (Sonos)' : '') : 'none') + ' · sonos rooms ' + (sonos.rooms().map(r => r.name).join('/') || 'none') + ' · ' + (spState.playing ? 'playing' : 'paused') + (spState.title ? ' "' + String(spState.title).slice(0, 40) + '"' : ''); },
    sonos, spotifyAuthUrl, spotifyCallback, spotifyCommand, spotifyLibrary, spotifySearch, spotifyItems, spotifyStatus: () => spStatus,
    spotifyDisconnect() { secrets.spotify = { clientId: SP().clientId, clientSecret: SP().clientSecret }; saveSecrets(); clearInterval(spTimer); spState = { connected: false }; commit({ music: { connected: false } }, 'server'); },
    BART_STATIONS
  };
}
