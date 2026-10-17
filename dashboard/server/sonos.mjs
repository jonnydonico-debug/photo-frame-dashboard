// Local Sonos control (UPnP on port 1400). Spotify won't take play/pause/skip for a Sonos it
// lists as "restricted", so those commands go straight to the speaker on the home network.
import dgram from 'node:dgram';

const SOAP = {
  transport: { path: '/MediaRenderer/AVTransport/Control', urn: 'urn:schemas-upnp-org:service:AVTransport:1' },
  rendering: { path: '/MediaRenderer/RenderingControl/Control', urn: 'urn:schemas-upnp-org:service:RenderingControl:1' },
  topology: { path: '/ZoneGroupTopology/Control', urn: 'urn:schemas-upnp-org:service:ZoneGroupTopology:1' },
  content: { path: '/MediaServer/ContentDirectory/Control', urn: 'urn:schemas-upnp-org:service:ContentDirectory:1' }
};

function escapeXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function unescapeXml(s) { return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }

const okAt = new Map();   // host -> last time it answered
async function soap(host, svc, action, args, ms = 5000) {
  const s = SOAP[svc];
  const body = '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>' +
    '<u:' + action + ' xmlns:u="' + s.urn + '">' + Object.entries(args || {}).map(([k, v]) => '<' + k + '>' + v + '</' + k + '>').join('') + '</u:' + action + '></s:Body></s:Envelope>';
  const r = await fetch('http://' + host + ':1400' + s.path, {
    method: 'POST', body, signal: AbortSignal.timeout(ms),
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: '"' + s.urn + '#' + action + '"' }
  });
  const t = await r.text();
  okAt.set(host, Date.now());
  if (!r.ok) {
    const code = (t.match(/<errorCode>(\d+)<\/errorCode>/) || [])[1];
    throw new Error('Sonos said no (' + action + (code ? ' ' + code : '') + ')');
  }
  return t;
}
// A network failure (speaker unreachable / moved), as opposed to the speaker answering "no"
const netErr = e => !/said no/.test(e && e.message || '');

function discover(timeout = 2500) {
  return new Promise(resolve => {
    const found = new Set();
    let sock;
    try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch { return resolve([]); }
    const msg = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: urn:schemas-upnp-org:device:ZonePlayer:1\r\n\r\n');
    sock.on('message', (m, rinfo) => { if (/Sonos/i.test(m.toString()) || /ZonePlayer/i.test(m.toString())) found.add(rinfo.address); });
    sock.on('error', () => {});
    sock.bind(() => {
      try { sock.setBroadcast(true); } catch {}
      for (let i = 0; i < 3; i++) setTimeout(() => sock.send(msg, 1900, '239.255.255.250', () => {}), i * 300);
    });
    setTimeout(() => { try { sock.close(); } catch {} resolve([...found]); }, timeout);
  });
}

export function createSonos({ log }) {
  let rooms = [];          // [{ name, uuid, host, coordinatorHost, coordinatorName, groupNames }]
  let lastScan = 0, scanning = null, status = { ok: false, note: 'Not scanned yet' };

  async function scan() {
    if (scanning) return scanning;
    scanning = (async () => {
      try {
        const t0 = Date.now();
        // Discovery replies are UDP and sometimes get lost: also ask the speakers we already know.
        const known = [...new Set(rooms.map(r => r.host))];
        let hosts = await discover();
        hosts = [...new Set(hosts.concat(known))];
        if (!hosts.length) { status = { ok: false, note: 'No Sonos speakers found on the network' }; log('sonos: no speakers answered the network search'); return rooms; }
        let xml = null;
        for (const h of hosts) { try { xml = unescapeXml(await soap(h, 'topology', 'GetZoneGroupState', {}, 4000)); break; } catch {} }
        if (!xml) { status = { ok: false, error: 'Sonos speakers found but none answered' }; log('sonos: found', hosts.join(', '), 'but none answered'); return rooms; }
        const out = [];
        for (const g of xml.match(/<ZoneGroup [\s\S]*?<\/ZoneGroup>/g) || []) {
          const coord = (g.match(/Coordinator="([^"]+)"/) || [])[1];
          const members = [...g.matchAll(/<ZoneGroupMember ([^>]*?)\/?>/g)].map(m => {
            const a = m[1];
            const get = k => (a.match(new RegExp(k + '="([^"]*)"')) || [])[1];
            return { uuid: get('UUID'), name: get('ZoneName'), host: (get('Location') || '').replace(/^https?:\/\/([^:/]+).*$/, '$1'), invisible: get('Invisible') === '1' };
          }).filter(m => m.name && m.host && !m.invisible);
          const c = members.find(m => m.uuid === coord) || members[0];
          if (!c) continue;
          members.forEach(m => out.push({ name: m.name, uuid: m.uuid, host: m.host, coordinatorHost: c.host, coordinatorName: c.name, groupNames: members.map(x => x.name) }));
        }
        const sig = r => r.map(x => x.name + '@' + x.host + '>' + x.coordinatorHost).sort().join(' ');
        if (sig(out) !== sig(rooms)) log('sonos: ' + (out.map(r => r.name + ' at ' + r.host + (r.coordinatorHost !== r.host ? ' (grouped with ' + r.coordinatorName + ')' : '')).join(', ') || 'no rooms') + ' · found in ' + (Date.now() - t0) + ' ms');
        rooms = out; lastScan = Date.now();
        status = { ok: true, rooms: rooms.map(r => r.name) };
      } catch (e) { status = { ok: false, error: e.message }; log('sonos:', e.message); }
      return rooms;
    })().finally(() => { scanning = null; });
    return scanning;
  }

  // Spotify calls a Sonos room "Living Room" or sometimes "Living Room Sonos"
  async function find(name) {
    if (!name) return null;
    if (!rooms.length || Date.now() - lastScan > 10 * 60000) await scan();
    const n = String(name).toLowerCase().replace(/\s*sonos\s*/g, ' ').trim();
    return rooms.find(r => r.name.toLowerCase() === n) || rooms.find(r => n.includes(r.name.toLowerCase()) || r.name.toLowerCase().includes(n)) || null;
  }

  // Make sure the speaker is there before sending it something. If it hasn't been heard from in a
  // minute, ping it (twice); if it doesn't answer, search the network again (it may have a new
  // address or have been regrouped) and use what's found.
  async function relocate(room, why) {
    const t0 = Date.now();
    lastScan = 0; await scan();
    const r = await find(room.name);
    log('sonos:', room.name, why, '→', r ? 'found at ' + r.coordinatorHost + ' (' + (Date.now() - t0) + ' ms)' : 'not found on the network');
    if (!r) throw new Error(room.name + ' isn’t answering on the network. Check it’s powered and on Wi-Fi.');
    return r;
  }
  async function reach(room) {
    const h = room.coordinatorHost;
    if (Date.now() - (okAt.get(h) || 0) < 60000) return room;
    for (let i = 0; i < 2; i++) {
      try { await soap(h, 'transport', 'GetTransportInfo', { InstanceID: 0 }, 2500); return room; }
      catch (e) { if (!netErr(e)) return room; }
    }
    return relocate(room, 'didn’t answer a ping');
  }
  // Run op(room) on a speaker that's awake; on a network failure, find it again and retry once.
  async function withRoom(room, op) {
    room = await reach(room);
    try { return await op(room); }
    catch (e) {
      if (!netErr(e)) throw e;
      room = await relocate(room, 'dropped a command (' + e.message + ')');
      return op(room);
    }
  }
  function command(room, action, value) { return withRoom(room, r => command1(r, action, value)); }
  async function command1(room, action, value) {
    const h = room.coordinatorHost;
    switch (action) {
      case 'play': return soap(h, 'transport', 'Play', { InstanceID: 0, Speed: 1 });
      case 'pause': return soap(h, 'transport', 'Pause', { InstanceID: 0 });
      case 'next': return soap(h, 'transport', 'Next', { InstanceID: 0 });
      case 'prev': return soap(h, 'transport', 'Previous', { InstanceID: 0 });
      case 'volume': return soap(room.host, 'rendering', 'SetVolume', { InstanceID: 0, Channel: 'Master', DesiredVolume: Math.max(0, Math.min(100, Math.round(+value))) });
      default: throw new Error('That isn’t supported on Sonos');
    }
  }

  // What the room is set to play from: 'tv' (TV/HDMI sound), 'queue' (its own queue), 'stream'
  // (a Spotify Connect / AirPlay session run from a phone), 'linein', or 'none'.
  async function source(room) {
    const x = await soap(room.coordinatorHost, 'transport', 'GetMediaInfo', { InstanceID: 0 }).catch(() => '');
    const u = unescapeXml(tag(x, 'CurrentURI'));
    const kind = !u ? 'none' : /x-sonos-htastream/i.test(u) ? 'tv' : /x-rincon-queue/i.test(u) ? 'queue' : /x-rincon-stream|x-rincon-mp3radio/i.test(u) ? 'linein' : 'stream';
    return { kind, uri: u };
  }
  function seek(room, ms) { return withRoom(room, r => seek1(r, ms)); }
  async function seek1(room, ms) {
    const t = Math.max(0, Math.round(ms / 1000)), hh = Math.floor(t / 3600), mm = Math.floor(t / 60) % 60, ss = t % 60;
    const target = hh + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    return soap(room.coordinatorHost, 'transport', 'Seek', { InstanceID: 0, Unit: 'REL_TIME', Target: target });
  }

  // ---------------------------------------------------------------- play Spotify on a Sonos room
  // Sonos plays Spotify itself (through the Spotify account linked in the Sonos app). We need that
  // account's numbers (sid/sn) and region descriptor, which we read from a Sonos favourite or from
  // whatever Spotify track the room last played.
  let account = null, lastSeen = [], lastRaw = null;
  async function spotifyAccount(room) {
    if (account) return account;
    const found = [];
    try {
      const fav = unescapeXml(unescapeXml(await soap(room.coordinatorHost, 'content', 'Browse', { ObjectID: 'FV:2', BrowseFlag: 'BrowseDirectChildren', Filter: '*', StartingIndex: 0, RequestedCount: 100, SortCriteria: '' })));
      found.push(fav);
    } catch {}
    try { found.push(unescapeXml(unescapeXml(await soap(room.coordinatorHost, 'transport', 'GetPositionInfo', { InstanceID: 0 })))); } catch {}
    try { found.push(unescapeXml(unescapeXml(await soap(room.coordinatorHost, 'transport', 'GetMediaInfo', { InstanceID: 0 })))); } catch {}
    const all = found.join('\n');
    // Look at each favourite / track entry that is clearly Spotify and take its numbers and region tag.
    const chunks = all.split(/<item |<container /).filter(c => /spotify(%3a|:)/i.test(c));
    lastRaw = { chunks: chunks.slice(0, 3).map(c => c.slice(0, 900)), pos: (found[1] || '').match(/<TrackURI>[^<]*<\/TrackURI>/) && (found[1] || '').match(/<TrackURI>[^<]*<\/TrackURI>/)[0], media: (found[2] || '').match(/<CurrentURI>[^<]*<\/CurrentURI>/) && (found[2] || '').match(/<CurrentURI>[^<]*<\/CurrentURI>/)[0], favCount: (found[0] || '').split('<item ').length - 1 };
    lastSeen = chunks.map(c => ((c.match(/sid=(\d+)[^"<\s]*?sn=(\d+)/i) || []).slice(1).join('/') + ' ' + ((c.match(/SA_RINCON\d+_X_#Svc\d+/) || [])[0] || '?'))).slice(0, 8);
    for (const c of chunks.concat([all])) {
      const m = c.match(/sid=(\d+)[^"<\s]*?sn=(\d+)/i);
      const d = c.match(/(SA_RINCON\d+_X_#Svc\d+-[0-9a-f]+-Token)/i);
      if (m && (d || c === all)) { account = { sid: m[1], sn: m[2], desc: d ? d[1] : 'SA_RINCON3079_X_#Svc3079-0-Token' }; break; }
    }
    return account || { sid: '12', sn: '1', desc: 'SA_RINCON3079_X_#Svc3079-0-Token', guessed: true };
  }
  function didl(id, cls, desc) {
    return '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">' +
      '<item id="' + id + '" restricted="true"><dc:title></dc:title><upnp:class>' + cls + '</upnp:class>' +
      '<desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">' + desc + '</desc></item></DIDL-Lite>';
  }
  function enqueueArgs(uri, acc) {
    const enc = encodeURIComponent(uri);
    if (/:track:/.test(uri)) return { u: 'x-sonos-spotify:' + enc + '?sid=' + acc.sid + '&flags=8224&sn=' + acc.sn, m: didl('00032020' + enc, 'object.item.audioItem.musicTrack', acc.desc) };
    if (/:album:/.test(uri)) return { u: 'x-rincon-cpcontainer:1004206c' + enc + '?sid=' + acc.sid + '&flags=8300&sn=' + acc.sn, m: didl('1004206c' + enc, 'object.container.album.musicAlbum', acc.desc) };
    if (/:playlist:/.test(uri)) return { u: 'x-rincon-cpcontainer:1006206c' + enc + '?sid=' + acc.sid + '&flags=8300&sn=' + acc.sn, m: didl('1006206c' + enc, 'object.container.playlistContainer', acc.desc) };
    throw new Error('Sonos can’t play that kind of item');
  }
  // The Beam only accepts single Spotify songs (bare URI, no metadata). Albums and playlists are
  // expanded to their songs first. tracks: list of spotify:track: URIs; startAt: 0-based index.
  function playSpotify(room, tracks, startAt) { return withRoom(room, r => playSpotify1(r, tracks, startAt)); }
  async function playSpotify1(room, tracks, startAt) {
    const acc = await spotifyAccount(room);
    const h = room.coordinatorHost;
    const coord = rooms.find(r => r.host === h) || room;
    const list = (Array.isArray(tracks) ? tracks : [tracks]).filter(u => /:track:/.test(u)).slice(0, 100);
    if (!list.length) throw new Error('Nothing playable here');
    startAt = Math.max(0, Math.min(list.length - 1, +startAt || 0));
    const add = uri => soap(h, 'transport', 'AddURIToQueue', { InstanceID: 0, EnqueuedURI: escapeXml('x-sonos-spotify:' + encodeURIComponent(uri) + '?sid=' + acc.sid + '&flags=8224&sn=' + acc.sn), EnqueuedURIMetaData: '', DesiredFirstTrackNumberEnqueued: 0, EnqueueAsNext: 0 });
    await soap(h, 'transport', 'RemoveAllTracksFromQueue', { InstanceID: 0 });
    // Queue the chosen song first and start it, then add the rest in the background.
    const ordered = list.slice(startAt).concat(list.slice(0, startAt));
    await add(ordered[0]);
    await soap(h, 'transport', 'SetAVTransportURI', { InstanceID: 0, CurrentURI: 'x-rincon-queue:' + coord.uuid + '#0', CurrentURIMetaData: '' });
    await soap(h, 'transport', 'Play', { InstanceID: 0, Speed: 1 });
    (async () => { for (const u of ordered.slice(1)) { try { await add(u); } catch (e) { log('sonos queue:', e.message); } } })();
    return { ok: true, queued: ordered.length };
  }
  // What the room is playing, straight from the speaker
  function tag(x, t) { const m = x.match(new RegExp('<' + t + '[^>]*>([\\s\\S]*?)</' + t + '>')); return m ? unescapeXml(m[1]) : ''; }
  function secs(t) { const p = String(t || '0:0:0').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : 0; }
  let lostAt = 0;
  async function nowPlaying(room) {
    try { return await nowPlaying1(room); }
    catch (e) {
      // Speaker gone quiet: look for it again in the background (at most every 30 s)
      if (netErr(e) && Date.now() - lostAt > 30000) { lostAt = Date.now(); lastScan = 0; scan().catch(() => {}); }
      throw e;
    }
  }
  async function nowPlaying1(room) {
    const h = room.coordinatorHost;
    const [pos, tr, vol] = await Promise.all([
      soap(h, 'transport', 'GetPositionInfo', { InstanceID: 0 }), soap(h, 'transport', 'GetTransportInfo', { InstanceID: 0 }),
      soap(room.host, 'rendering', 'GetVolume', { InstanceID: 0, Channel: 'Master' }).catch(() => '')]);
    const meta = unescapeXml(tag(pos, 'TrackMetaData'));
    let art = tag(meta, 'upnp:albumArtURI');
    if (art && art.startsWith('/')) art = '/api/music/art?h=' + encodeURIComponent(h) + '&p=' + encodeURIComponent(art);
    const uri = unescapeXml(tag(pos, 'TrackURI'));
    const sp = decodeURIComponent((uri.match(/spotify(%3a|:)track(%3a|:)([A-Za-z0-9]+)/i) || [])[3] || '');
    return {
      playing: /^(PLAYING|TRANSITIONING)$/.test(tag(tr, 'CurrentTransportState')), title: tag(meta, 'dc:title'), artist: tag(meta, 'dc:creator'), album: tag(meta, 'upnp:album'),
      art, progress: secs(tag(pos, 'RelTime')) * 1000, duration: secs(tag(pos, 'TrackDuration')) * 1000,
      uri: sp ? 'spotify:track:' + sp : '', volume: +tag(vol, 'CurrentVolume') || 0
    };
  }
  async function art(h, p) {
    if (!rooms.some(r => r.host === h || r.coordinatorHost === h)) throw new Error('Unknown speaker');
    return fetch('http://' + h + ':1400' + p, { signal: AbortSignal.timeout(5000) });
  }
  async function debug() {
    await scan();
    const out = { status, rooms: rooms.map(r => ({ name: r.name, coordinator: r.coordinatorName, group: r.groupNames })) };
    const r = rooms[0];
    if (r) { account = null; out.account = await spotifyAccount(r); out.seen = lastSeen; out.raw = lastRaw; }
    return out;
  }

  // Try queueing one Spotify item several ways (queue only; current playback isn't touched).
  async function probe(uri) {
    await scan();
    const room = rooms[0]; if (!room) return { error: 'no rooms' };
    const h = room.coordinatorHost, acc = await spotifyAccount(room);
    const kind = (uri.match(/:(track|album|playlist):/) || [])[1];
    const enc = encodeURIComponent(uri);
    const ids = { track: ['00032020' + enc, 'object.item.audioItem.musicTrack'], album: ['1004206c' + enc, 'object.container.album.musicAlbum'], playlist: ['1006206c' + enc, 'object.container.playlistContainer'] }[kind];
    const descs = ['SA_RINCON3079_X_#Svc3079-0-Token', 'SA_RINCON2311_X_#Svc2311-0-Token', acc.desc, ''];
    const uris = kind === 'track'
      ? ['x-sonos-spotify:' + enc + '?sid=12&flags=8224&sn=' + acc.sn, 'x-sonos-spotify:' + uri + '?sid=12&flags=0&sn=' + acc.sn, 'x-sonos-spotify:' + enc + '?sid=12&flags=8232&sn=' + acc.sn]
      : ['x-rincon-cpcontainer:' + ids[0] + '?sid=12&flags=8300&sn=' + acc.sn, 'x-rincon-cpcontainer:' + ids[0] + '?sid=12&flags=10860&sn=' + acc.sn, 'x-rincon-cpcontainer:' + ids[0] + '?sid=12&flags=0&sn=' + acc.sn, 'x-rincon-cpcontainer:' + ids[0] + '?sid=12&flags=8236&sn=' + acc.sn];
    const out = [];
    for (const u of uris) for (const d of descs) {
      const meta = d ? didl(ids[0], ids[1], d) : '';
      try {
        const r = await soap(h, 'transport', 'AddURIToQueue', { InstanceID: 0, EnqueuedURI: escapeXml(u), EnqueuedURIMetaData: escapeXml(meta), DesiredFirstTrackNumberEnqueued: 0, EnqueueAsNext: 0 });
        out.push({ ok: true, u, d, n: (r.match(/<NumTracksAdded>(\d+)/) || [])[1] });
      } catch (e) { out.push({ ok: false, u: u.slice(0, 60), d, e: e.message }); }
    }
    try { await soap(h, 'transport', 'RemoveAllTracksFromQueue', { InstanceID: 0 }); } catch {}
    return { acc, results: out };
  }
  return { scan, find, command, source, seek, playSpotify, nowPlaying, art, debug, probe, status: () => status, rooms: () => rooms };
}
