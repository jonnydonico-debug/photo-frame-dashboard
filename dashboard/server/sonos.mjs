// Local Sonos control (UPnP on port 1400). Spotify won't take play/pause/skip for a Sonos it
// lists as "restricted", so those commands go straight to the speaker on the home network.
import dgram from 'node:dgram';

const SOAP = {
  transport: { path: '/MediaRenderer/AVTransport/Control', urn: 'urn:schemas-upnp-org:service:AVTransport:1' },
  rendering: { path: '/MediaRenderer/RenderingControl/Control', urn: 'urn:schemas-upnp-org:service:RenderingControl:1' },
  topology: { path: '/ZoneGroupTopology/Control', urn: 'urn:schemas-upnp-org:service:ZoneGroupTopology:1' }
};

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

  return { scan, find, command, status: () => status, rooms: () => rooms };
}
