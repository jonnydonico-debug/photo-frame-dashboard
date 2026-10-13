# Home HQ (Mac mini)

This folder runs the Steinnheimer & Armada family dashboard for JD and Georgia: a wall frame,
a phone app, an admin page, and a team of Claude agents that answer iMessage.

@data/agents/CONTEXT.md

## Layout
- `app/` – the live app. **Editing anything here restarts the server** (a file watcher exits the
  process ~1.5 s after a change and launchd starts it again). Make small, finished edits.
  - `app/server/server.mjs` – HTTP server, state, routes, admin API. Port 8787.
  - `app/server/integrations.mjs` (BART, routes/traffic, iCloud album, Spotify), `sonos.mjs`,
    `govee.mjs`, `appletv.mjs` + `tv_helper.py` (pyatv), `agents.mjs` (agent team), `assistant.mjs`
    (household tools + Claude API), `imessage.mjs` (Messages bridge), `plextools.mjs`.
  - `app/index.html` + `app/js/` + `app/css/` – the 1280×800 wall frame (no build step; plain JS,
    must run on Android WebView 106: no CSS nesting, no `color-mix`).
  - `app/app.html` + `app/js/app/` + `app/css/app.css` – the phone app (app.sabadorks.com).
  - `app/admin.html` + `app/js/admin.js` + `app/css/admin.css` – admin (admin.sabadorks.com).
- `data/` – household data. `state.json` is the shared state (shopping list, notes, devices…),
  `agents/` holds agent definitions, shared memory, run log and CONTEXT.md, `backups/` daily copies.
  **Never read, print or change `data/secrets.json`** (PIN hash, API keys, tokens).
- `logs/server.log` – server log. `node/bin/node` – the Node that runs the server.

## How things fit
- One JSON state object, live-synced to every screen over SSE (`/api/events`); screens PATCH
  `/api/state` with only the keys they changed. Server-only live keys: `bart`, `music`, `tv`.
- New state keys must be added to `KEYS` in `app/js/sync.js` and the key lists at the top of
  `server.mjs` (OPEN_KEYS = writable from home screens, ADMIN_KEYS = admin only).
- Look: earth tones, Apple-like (`app/css/theme.css`, `app/css/app.css`). Night mode is an SVG
  colour filter on the frame.

## Working rules
- Check JavaScript before finishing: `node/bin/node --check <file>`.
- Keep edits minimal and in the existing style; no new dependencies.
- **Log every change in `CHANGES.md`** (date, files, what and why). The same code also lives in
  GitHub (jonnydonico-debug/photo-frame-dashboard, branch `home-hq-live`) and other updates are
  copied in from there, so unlogged edits here can be overwritten.
- If the server doesn't come back after an edit, read the end of `logs/server.log`.

## Confirm before changing anything
JD often drives this session from his phone (Remote Control), in short messages. Before editing
any file, every time:
1. Restate the request in plain words: what will change, which screen(s) (frame, admin, phone
   app), and what it will look like or do when it's done.
2. Ask about anything ambiguous (which tab, wording, colours, who sees it) instead of guessing.
3. List the files you plan to touch, then wait for a clear "yes" before making changes.
If the request changes during the conversation, confirm again before continuing.
