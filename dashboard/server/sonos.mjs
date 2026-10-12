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

async function soap(host, svc, action, args) {
  const s = SOAP[svc];
  const body = '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>' +
    '<u:' + action + ' xmlns:u="' + s.urn + '">' + Object.entries(args || {}).map(([k, v]) => '<' + k + '>' + v + '</' + k + '>').join('') + '</u:' + action + '></s:Body></s:Envelope>';
  const r = await fetch('http://' + host + ':1400' + s.path, {
    method: 'POST', body, signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: '"' + s.urn + '#' + action + '"' }
  });
  const t = await r.text();
  if (!r.ok) {
    const code = (t.match(/<errorCode>(\d+)<\/errorCode>/) || [])[1];
    throw new Error('Sonos said no (' + action + (code ? ' ' + code : '') + ')');
  }
  return t;
}

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
        const hosts = await discover();
        if (!hosts.length) { status = { ok: false, note: 'No Sonos speakers found on the network' }; rooms = []; return rooms; }
        const xml = unescapeXml(await soap(hosts[0], 'topology', 'GetZoneGroupState', {}));
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

  async function command(room, action, value) {
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

  // ---------------------------------------------------------------- play Spotify on a Sonos room
  // Sonos plays Spotify itself (through the Spotify account linked in the Sonos app). We need that
  // account's numbers (sid/sn) and region descriptor, which we read from a Sonos favourite or from
  // whatever Spotify track the room last played.
  let account = null, lastSeen = [];
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
  // items: a context URI (album/playlist) or a list of track URIs; startAt: 0-based track index
  async function playSpotify(room, items, startAt) {
    const acc = await spotifyAccount(room);
    const h = room.coordinatorHost;
    const coord = rooms.find(r => r.host === h) || room;
    const list = Array.isArray(items) ? items : [items];
    await soap(h, 'transport', 'RemoveAllTracksFromQueue', { InstanceID: 0 });
    // Region tags differ by account; try the one we found, then the usual US/EU Spotify ones.
    const descs = [...new Set([acc.desc, 'SA_RINCON3079_X_#Svc3079-0-Token', 'SA_RINCON2311_X_#Svc2311-0-Token'])];
    let added = 0, lastErr = null;
    for (const uri of list.slice(0, 50)) {
      for (const desc of descs) {
        const a = enqueueArgs(uri, Object.assign({}, acc, { desc }));
        try {
          await soap(h, 'transport', 'AddURIToQueue', { InstanceID: 0, EnqueuedURI: escapeXml(a.u), EnqueuedURIMetaData: escapeXml(a.m), DesiredFirstTrackNumberEnqueued: 0, EnqueueAsNext: 0 });
          if (desc !== acc.desc) { acc.desc = desc; account = acc; descs.unshift(desc); }
          added++; lastErr = null; break;
        } catch (e) { lastErr = e; }
      }
    }
    if (!added) throw new Error('The Sonos wouldn’t take that from Spotify' + (lastErr ? ' (' + lastErr.message + ')' : ''));
    await soap(h, 'transport', 'SetAVTransportURI', { InstanceID: 0, CurrentURI: 'x-rincon-queue:' + coord.uuid + '#0', CurrentURIMetaData: '' });
    if (startAt > 0) { try { await soap(h, 'transport', 'Seek', { InstanceID: 0, Unit: 'TRACK_NR', Target: startAt + 1 }); } catch {} }
    await soap(h, 'transport', 'Play', { InstanceID: 0, Speed: 1 });
    return { ok: true, account: acc.guessed ? 'guessed' : 'found' };
  }
  async function debug() {
    await scan();
    const out = { status, rooms: rooms.map(r => ({ name: r.name, coordinator: r.coordinatorName, group: r.groupNames })) };
    const r = rooms[0];
    if (r) { account = null; out.account = await spotifyAccount(r); out.seen = lastSeen; }
    return out;
  }

  return { scan, find, command, playSpotify, debug, status: () => status, rooms: () => rooms };
}
