#!/usr/bin/env python3
"""Apple TV remote for Home HQ, built on pyatv (https://pyatv.dev).

The Node server starts this once and talks to it over stdin/stdout, one JSON object per line.
  request:  {"id": 7, "cmd": "key", "args": {"name": "select"}}
  reply:    {"id": 7, "ok": true, "result": ...}   or   {"id": 7, "ok": false, "error": "..."}
  event:    {"event": "state", "data": {...}}       (sent whenever power or what's playing changes)

Pairing credentials are kept by pyatv's FileStorage in the path given as argv[1].
"""
import asyncio
import json
import sys
import traceback

import pyatv
from pyatv import exceptions
from pyatv.const import DeviceState, InputAction, PairingRequirement, PowerState, Protocol
from pyatv.storage.file_storage import FileStorage

PAIR_PROTOCOLS = [Protocol.Companion, Protocol.AirPlay]
KEYS = {
    'up', 'down', 'left', 'right', 'select', 'menu', 'home', 'top_menu',
    'play_pause', 'play', 'pause', 'next', 'previous', 'volume_up', 'volume_down',
    'skip_forward', 'skip_backward', 'channel_up', 'channel_down',
}


def out(obj):
    sys.stdout.write(json.dumps(obj, default=str) + '\n')
    sys.stdout.flush()


class Remote:
    def __init__(self, loop, storage_path):
        self.loop = loop
        self.storage = FileStorage(storage_path, loop)
        self.atv = None
        self.device_id = None
        self.pairing = None
        self.pairing_conf = None
        self.playing = None
        self.power = None

    # ------------------------------------------------------------ helpers
    async def find(self, identifier=None, timeout=6):
        confs = await pyatv.scan(self.loop, timeout=timeout, identifier=identifier, storage=self.storage)
        return confs

    @staticmethod
    def describe(conf):
        services = []
        for s in conf.services:
            services.append({
                'protocol': s.protocol.name,
                'pairing': s.pairing.name if s.pairing else None,
                'paired': bool(s.credentials),
            })
        model = ''
        try:
            model = conf.device_info.model_str
        except Exception:  # noqa: BLE001
            pass
        return {'name': conf.name, 'id': conf.identifier, 'address': str(conf.address), 'model': model, 'services': services}

    def snapshot(self):
        p = self.playing
        play = None
        if p is not None:
            state = p.device_state
            play = {
                'title': p.title, 'artist': p.artist, 'album': p.album,
                'state': state.name.lower() if state else None,
                'playing': state == DeviceState.Playing,
                'position': p.position, 'total': p.total_time,
            }
        app = None
        vol = None
        if self.atv:
            try:
                a = self.atv.metadata.app
                if a:
                    app = {'name': a.name, 'id': a.identifier}
            except Exception:  # noqa: BLE001
                pass
            try:
                vol = self.atv.audio.volume
            except Exception:  # noqa: BLE001
                pass
        return {
            'connected': self.atv is not None, 'device': self.device_id,
            'power': self.power, 'playing': play, 'app': app, 'volume': vol,
        }

    def emit(self):
        out({'event': 'state', 'data': self.snapshot()})

    # ------------------------------------------------------------ pyatv listeners
    def playstatus_update(self, _updater, playstatus):
        self.playing = playstatus
        self.emit()

    def playstatus_error(self, _updater, exception):
        out({'event': 'log', 'data': 'push error: %s' % exception})

    def powerstate_update(self, _old, new):
        self.power = 'on' if new == PowerState.On else 'off' if new == PowerState.Off else None
        self.emit()

    def connection_lost(self, exception):
        out({'event': 'log', 'data': 'connection lost: %s' % exception})
        self.atv = None
        self.emit()

    def connection_closed(self):
        self.atv = None
        self.emit()

    # ------------------------------------------------------------ commands
    async def cmd_scan(self, args):
        await self.storage.load()
        return [self.describe(c) for c in await self.find(timeout=int(args.get('timeout', 6)))]

    async def cmd_pair_begin(self, args):
        """Start pairing one protocol. The Apple TV shows a 4-digit code."""
        await self.storage.load()
        confs = await self.find(identifier=args['id'])
        if not confs:
            raise RuntimeError('Apple TV not found on the network')
        conf = confs[0]
        # Next protocol that needs pairing (or the one asked for)
        wanted = [Protocol[args['protocol']]] if args.get('protocol') else PAIR_PROTOCOLS
        todo = None
        for proto in wanted:
            s = conf.get_service(proto)
            if s is None or s.credentials:
                continue
            if s.pairing in (PairingRequirement.Unsupported, PairingRequirement.NotNeeded):
                continue
            if s.pairing == PairingRequirement.Disabled:
                raise RuntimeError('Pairing is turned off on the Apple TV. Open Settings → AirPlay and HomeKit → Allow Access and choose "Anyone on the Same Network".')
            todo = proto
            break
        if todo is None:
            return {'done': True}
        if self.pairing:
            try:
                await self.pairing.close()
            except Exception:  # noqa: BLE001
                pass
        self.pairing = await pyatv.pair(conf, todo, self.loop, storage=self.storage, name='Home HQ')
        self.pairing_conf = conf
        await self.pairing.begin()
        return {'done': False, 'protocol': todo.name, 'needsPin': self.pairing.device_provides_pin}

    async def cmd_pair_pin(self, args):
        if not self.pairing:
            raise RuntimeError('Start pairing first')
        self.pairing.pin(str(args['pin']).strip())
        try:
            await self.pairing.finish()
        finally:
            ok = self.pairing.has_paired
            try:
                await self.pairing.close()
            except Exception:  # noqa: BLE001
                pass
            self.pairing = None
        if not ok:
            raise RuntimeError('That code didn’t work. Try again.')
        await self.storage.save()
        return {'paired': True}

    async def cmd_pair_cancel(self, _args):
        if self.pairing:
            try:
                await self.pairing.close()
            except Exception:  # noqa: BLE001
                pass
        self.pairing = None
        return {}

    async def cmd_connect(self, args):
        await self.storage.load()
        if self.atv:
            self.atv.close()
            self.atv = None
        confs = await self.find(identifier=args['id'])
        if not confs:
            raise RuntimeError('Apple TV not found on the network (is it on Wi-Fi?)')
        atv = await pyatv.connect(confs[0], self.loop, storage=self.storage)
        self.atv = atv
        self.device_id = args['id']
        atv.listener = self
        try:
            atv.push_updater.listener = self
            atv.push_updater.start()
        except Exception as e:  # noqa: BLE001
            out({'event': 'log', 'data': 'no push updates: %s' % e})
        try:
            atv.power.listener = self
            ps = atv.power.power_state
            self.power = 'on' if ps == PowerState.On else 'off' if ps == PowerState.Off else None
        except Exception:  # noqa: BLE001
            self.power = None
        try:
            self.playing = await atv.metadata.playing()
        except Exception:  # noqa: BLE001
            self.playing = None
        self.emit()
        return self.snapshot()

    def need(self):
        if not self.atv:
            raise RuntimeError('Not connected to the Apple TV')
        return self.atv

    async def cmd_key(self, args):
        name = args.get('name')
        if name not in KEYS:
            raise RuntimeError('Unknown button')
        atv = self.need()
        hold = args.get('hold')
        if name in ('volume_up', 'volume_down'):
            try:
                await getattr(atv.audio, name)()
                return {}
            except exceptions.NotSupportedError:
                pass
        fn = getattr(atv.remote_control, name)
        if hold and name in ('up', 'down', 'left', 'right', 'select', 'menu', 'home'):
            await fn(action=InputAction.Hold)
        elif name == 'home' and args.get('double'):
            await fn(action=InputAction.DoubleTap)
        else:
            await fn()
        return {}

    async def cmd_power(self, args):
        atv = self.need()
        if args.get('on'):
            await atv.power.turn_on()
            self.power = 'on'
        else:
            await atv.power.turn_off()
            self.power = 'off'
        self.emit()
        return {}

    async def cmd_volume(self, args):
        atv = self.need()
        await atv.audio.set_volume(max(0.0, min(100.0, float(args['level']))))
        return {}

    async def cmd_apps(self, _args):
        atv = self.need()
        apps = await atv.apps.app_list()
        return sorted([{'name': a.name, 'id': a.identifier} for a in apps if a.name], key=lambda a: a['name'].lower())

    async def cmd_launch(self, args):
        await self.need().apps.launch_app(args['id'])
        return {}

    async def cmd_status(self, _args):
        return self.snapshot()

    async def cmd_forget(self, args):
        """Remove saved pairing for a device."""
        await self.storage.load()
        confs = await self.find(identifier=args['id'], timeout=4)
        if self.atv:
            self.atv.close()
            self.atv = None
        if confs:
            settings = await self.storage.get_settings(confs[0])
            await self.storage.remove_settings(settings)
            await self.storage.save()
        return {}


async def main():
    loop = asyncio.get_running_loop()
    remote = Remote(loop, sys.argv[1] if len(sys.argv) > 1 else 'pyatv.conf')
    reader = asyncio.StreamReader()
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
    out({'event': 'ready', 'data': {'pyatv': pyatv.const.__version__}})

    async def handle(msg):
        rid = msg.get('id')
        try:
            fn = getattr(remote, 'cmd_' + str(msg.get('cmd')), None)
            if fn is None:
                raise RuntimeError('unknown command')
            result = await fn(msg.get('args') or {})
            out({'id': rid, 'ok': True, 'result': result})
        except Exception as e:  # noqa: BLE001
            text = str(e) or e.__class__.__name__
            out({'id': rid, 'ok': False, 'error': text})
            out({'event': 'log', 'data': traceback.format_exc(limit=3)})

    while True:
        line = await reader.readline()
        if not line:
            break
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        loop.create_task(handle(msg))


if __name__ == '__main__':
    asyncio.run(main())
