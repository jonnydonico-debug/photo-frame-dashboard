# Home HQ (Mac mini)

This folder runs the Steinheimer & Armada family dashboard for JD and Georgia: a wall frame,
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
  `/api/state` with only the keys they changed. Server-only live keys: `bart`, `music`, `tv`, `costs`, `reminders`.
- Recipes: `recipes` state key; agent tools in `app/server/recipes.mjs`; photos in `data/recipes/`.
- New state keys must be added to `KEYS` in `app/js/sync.js` and the key lists at the top of
  `server.mjs` (OPEN_KEYS = writable from home screens, ADMIN_KEYS = admin only).
- Look: always dark — charcoal tiles on near-black, olive-gold and terracotta accents, serif
  headings (`app/css/theme.css` for the frame, `app/css/app.css` for the phone). Night mode is an
  SVG filter on the frame that turns everything red (it keeps lightness; no inversion).

## Working rules
- Check JavaScript before finishing: `node/bin/node --check <file>`.
- Keep edits minimal and in the existing style; no new dependencies.
- **Log every change in `CHANGES.md`** (date, files, what and why). The same code also lives in
  GitHub (jonnydonico-debug/photo-frame-dashboard, branch `home-hq-live`) and other updates are
  copied in from there, so unlogged edits here can be overwritten.
- If the server doesn't come back after an edit, read the end of `logs/server.log`.

## When to ask first
JD often drives this session from his phone (Remote Control), in short messages, and wants things
done without a confirmation round for every edit.
- **Clear, small requests:** just do them, then say briefly what changed and which screen(s)
  (frame, admin, phone app) it affects.
- **Ask first** (restate the plan, list the files, wait for a "yes") when:
  - the request is ambiguous (which tab, wording, colours, who sees it): ask instead of guessing;
  - it's a big change (a new feature, a redesign, many files);
  - it's risky: deleting or rewriting household data in `data/`, changing agent behaviour or what
    the iMessage agent can do, or anything with an effect outside this Mac (texting people,
    pushing to GitHub, controlling devices in the house beyond a quick read-only check).
