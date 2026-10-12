# Home HQ on the Mac mini

The picture-frame dashboard, now live: it runs on the Mac mini, saves everything, and updates every
screen the moment anything changes, whether the change comes from the frame, your phone, or iMessage.

## Install (one command, in Terminal on the Mac mini)

```sh
bash ~/Documents/HomeHQ-installer/install.sh
```

It downloads Node.js from nodejs.org if needed (no Homebrew or password), copies the app to `~/HomeHQ`, starts it at login,
and prints your addresses and the first admin PIN.

| What | Where |
| --- | --- |
| Dashboard (frame, any browser) | `http://<mac-mini>.local:8787/` |
| Admin (phone / PC) | `http://<mac-mini>.local:8787/admin` |
| First PIN | `~/HomeHQ/data/FIRST-RUN-PIN.txt` (change it in Admin → Settings) |
| Your data + daily backups | `~/HomeHQ/data` |
| Logs | `~/HomeHQ/logs/server.log` |
| Agent / iMessage CLI | `~/HomeHQ/bin/homehq summary` |

Update later: run the same command again with a newer installer. Your data stays.
Stop it: `bash install.sh --uninstall`.

## What the admin panel does

- **Family**: names, colours, home/away, ETA, kids' stars.
- **Calendar / Chores / Shopping**: add, edit, delete; everything shows on the frame instantly.
- **Photos**: upload from your phone's camera roll; they rotate on the frame and screensaver.
- **Lights & Home**: switch devices, build scenes, link each one to a HomeKit Shortcut.
- **Settings**: live weather for your town, Plex, which tabs the frame shows, PIN, agent token, backups,
  "Start fresh" to clear the demo family.

## HomeKit

macOS has no public HomeKit API for scripts, so Home HQ runs **Shortcuts** you make once:
one per light (input 0–100, 0 = off), lock (`lock`/`unlock`), garage (`open`/`close`) or scene.
Type each shortcut's name next to the device in Admin → Lights & Home and press Test.
The Mac mini must stay logged in for Shortcuts to run.

## Plex

Admin → Settings → Plex: your NAS address (`http://192.168.x.x:32400`) and Plex token.
The Home tab then shows what's playing, and you or the agent can rescan libraries.

## Hermes / iMessage

The installer drops a `home-hq` skill into `~/.hermes/skills`. Hermes uses `~/HomeHQ/bin/homehq`
to run scenes, lights, shopping, events, chores and messages on the frame.

## Outside the house (sabadorks.com)

A Cloudflare Tunnel connects the Mac mini to Cloudflare, so nothing on your router is opened.

| Hostname | Goes to | Who gets in |
| --- | --- | --- |
| `admin.sabadorks.com` | Admin panel | Cloudflare Access (your email), then your PIN |
| `frame.sabadorks.com` | The dashboard | Cloudflare Access: your home's internet address, or your email |

Anything arriving through the tunnel without Cloudflare Access can't change anything.
Connect the tunnel (cloudflared is downloaded for you, no password needed):

```sh
bash ~/Documents/HomeHQ-installer/install.sh --tunnel-token <token from Cloudflare>
```
