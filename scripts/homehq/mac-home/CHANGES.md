# Changes made on the Mac mini

Newest first. Claude Code (or you) adds an entry for every edit made directly on the Mac.

## 2026-10-16 — (from GitHub) Lock-screen video: light enough for the frame tablet
The frame (Android 6 "YS01", WebView 106) played the 1280x800 scene for ~1 h, then its hardware
decoder failed (PIPELINE_ERROR_DECODE), the screen froze and the app crashed.
- `app/public/lock/henley-*.{mp4,webm,jpg}`: re-encoded at the art's own pixel grid (6x6 px blocks
  → 288x180, stored 2x at 576x360; MP4 is H.264 Constrained Baseline). ~5x less decoding.
- `app/css/views/ambient.css`: `image-rendering: pixelated` so it scales up crisp.
- `app/js/views/ambient.js`: decoder released while unlocked, a fresh decoder every 20 min, and on a
  decode error: retry → other format → still picture until the next lock. Reports "video-playing"
  once per load (with the size) instead of every loop.
- Scene URLs carry `?v=2` (ambient.js `VER`, settings.js thumbnail) so the tablet and Cloudflare
  fetch the new files instead of cached 1280x800 copies. Bump it whenever the files change.

## 2026-10-16 — (from GitHub) Lock-screen video fixes + screens reload after updates
- `app/js/views/ambient.js`: the "allow video" step now runs on a finished tap (touchend/click);
  Android doesn't count a touch-down, so the scene stayed a still picture. Plays WebM (VP9) where
  MP4 (H.264) isn't supported, and switches format once if a video fails. Reports problems
  (play blocked, video error) and successful playback to the server log ("lockscreen: …").
- `app/public/lock/henley-{day,night}.webm` (new): VP9 copies of the scenes.
- `app/js/sync.js` + `app/server/server.mjs` (build id in the event stream's hello): screens reload
  themselves when the Mac runs newer code, once nobody has touched them for 45 s (or when locked).
- `app/server/server.mjs`: `POST /api/home/lockdiag` (logs, throttled) and the .webm file type.

## 2026-10-16 — (from GitHub) Warm ↔ cool slider for lights
- Frame `app/js/views/control.js` + `app/css/views/control.css`, phone `app/js/app/home.js` +
  `app/css/app.css`: lights with whites (Key Lights, Govee) get a colour-temperature slider with a
  warm-to-cool gradient and the current Kelvin; the presets stay underneath and move the slider.
  The frame sheet's on/off button now updates when a change turns the light on.

## 2026-10-16 — (from GitHub) Elgato Key Lights in a "Free Roam" section
- `app/server/elgato.mjs` (new): finds Key Lights on the Wi-Fi with Bonjour (`dns-sd -B _elg._tcp`)
  or by IP (Admin), reads/sets them over their local API (port 9123, `/elgato/lights`): on/off,
  brightness 3–100, colour temperature 2900–7000 K. Polls every 15 s, re-searches every 10 min.
  Devices are `source: 'elgato'`, `el.host`, `caps.kelvin`, in room `freeroam` ("Free Roam").
- `app/server/server.mjs`: wiring, device changes routed to the lights, `POST /api/admin/elgato`
  (search / add or remove an IP).
- `app/server/assistant.mjs`: `light_set` can target several lights ("key lights", a room like
  "office" or "free roam", "office light bars"); `lights` lists each light's room.
- Frame `app/js/views/control.js`, phone `app/js/app/home.js`: Key Lights get the light sheet
  (brightness + whites, no colours/scenes). Admin `app/js/admin.js`: "Elgato Key Lights" block in
  Lights & Home.

## 2026-10-16 — (from GitHub) Office and Bedroom rooms
- `app/server/server.mjs`: schema 9 adds Office and Bedroom rooms; the RGBIC TV Light Bars that
  were on (`gv-3ee9f49fad5594ab`, the pair in the office) move to Office. The other pair stays in
  Living Room. Bedroom is empty for now.
- Frame Home tab (`app/js/views/control.js`, `app/css/views/control.css`) and phone Home screen
  (`app/js/app/home.js`, `app/css/app.css`): empty rooms show "No devices yet" instead of
  nothing.

## 2026-10-15 — (from GitHub) Lock screen: Henley Gate scenes, follows night mode by itself
Deployed from the GitHub copy (which now includes all the Mac-side changes above).
- Fix: while locked, the lock screen now switches to its night look at the night-mode start time
  and back in the morning on its own (it used to wait for a tap). `app/js/app.js` (lockMode, syncLock).
- Lock screen wallpaper: Henley Gate pixel-art videos, day and night (`app/public/lock/henley-*.mp4`
  + poster .jpg, 1280x800), with a pixel clock, date, weather and next event in the sky.
  `app/js/views/ambient.js`, `app/css/views/ambient.css`, Silkscreen font in `app/index.html`.
- Frame Settings → new "Lock screen" card: wallpaper (Henley Gate / Photos), at night (night
  scene / red clock), show (clock + weather + next event / just the clock), clock style (pixel /
  classic). Saved in `display.lock`. `app/js/views/settings.js`, `app/css/views/settings.css`,
  `app/server/server.mjs` (accepts display.lock; static files support byte ranges for video).

## 2026-10-15 — Phone: To-do tab with Mine / House
JD couldn't find to-dos or reminders on the phone (they were under More) and wants a personal list
per person plus a house list.
- `app/app.html`: new **To-do** bottom tab (between Shopping and Notes).
- `app/js/app/reminders.js`: the screen is now the To-do tab with a **Mine | House** switch.
  Mine = this phone's person (App.me(): JD or Georgia, set at sign-in / Settings), House = shared.
  Shows that list's to-dos and its texted reminders; + To-do / Reminder add to the list showing.
  The choice is remembered on the phone.
- `app/js/app/more.js`: Reminders removed from More (it's a tab now).
- `app/js/app/today.js`: Today's to-do card shows only your items + the house's, with "All to-dos".
- `app/css/app.css`: small styles.

## 2026-10-15 — CLAUDE.md: ask only when it matters
JD asked to stop the "say yes before every edit" step. `CLAUDE.md`: "Confirm before changing
anything" replaced by "When to ask first" (just do clear, small requests; still ask for ambiguous,
big or risky ones: data deletion, agent behaviour, texting, GitHub, device control). Also updated
the Look notes (dark theme, red night filter) and listed the newer live keys and recipes.

## 2026-10-15 — Spelling: Steinheimer
JD: the family name is spelled "Steinheimer" (was "Steinnheimer").
- `app/server/server.mjs`: default title fixed (2 places) and a schema 8 migration that corrects
  the saved house title (`settings.title`) on start-up. Saved data now reads
  "Steinheimer & Armada Home".
- `app/public/app.webmanifest`: installed phone app name.
- `CLAUDE.md`: project notes.
- Also added to JD's to-do list on the dashboard (not code): the Sonos fix (Play/Skip on the TV
  input → "Sonos said no") and tab reordering, both tabled for later.

## 2026-10-14 — Recipes (frame tab, phone screen, saved by texting the agent)
JD wants to save recipes by texting the iMessage agent a recipe or a photo of one, see them on
the dashboard, and have them properly stored.
- **Storage:** new saved state key `recipes` (OPEN key, so screens can edit; in the daily backups;
  live-synced). Each recipe: `id, title, servings, prepMin, cookMin, ingredients[{item, amount,
  note, section}], steps[], tags[], source, notes, by, at, via (photo|text|phone), photo, edited`.
  The photo a recipe came from is kept in `data/recipes/<id>.jpg` and served (home network or
  signed in) at `/api/home/recipes/photo/<id>.jpg`. Orphaned photos are swept a minute after start.
  Schema 7 migration adds `recipes: []` and makes sure the tab isn't hidden.
- `app/server/recipes.mjs` (new): agent tools `recipe_add`, `recipe_list`, `recipe_get`,
  `recipe_update`, `recipe_remove`, `recipe_to_shopping`, plus `POST /api/home/recipes/shop`
  (the screens' "Add to shopping list"). Ingredients go on the list through the same
  `shopping_add` the agent uses (names, dedupe, stores).
- `app/server/agents.mjs`: Home agent gets the recipe tools (agents settings v7 migration). Photos
  texted in a conversation are passed to tools (and remembered for 30 min, so "save that recipe"
  after a photo still keeps the photo). Reply limit raised 1500 → 4000 tokens so a long recipe
  fits in one tool call. Every save shows in the agent run log like other tools.
- `app/server/server.mjs`: `recipes` key, schema 7, recipes module wiring, photo + shop routes.
  The house tool context is shared between the agents and the recipes module.
- Frame: `app/js/views/recipes.js`, `app/css/views/recipes.css` (new) — card grid with photo,
  time, tags, search and tag filter; tap for a big two-column ingredients/steps view (tick off
  ingredients while cooking), photo viewer, "Add to shopping list" with pantry basics unticked.
  `app/index.html` (rail button after Notes), `app/js/main.js`, `app/js/admin.js` (tab toggle).
- Phone: `app/js/app/recipes.js` (new) — list + search, full recipe screen, add/edit (one
  ingredient or step per line), delete with undo, shopping list picker. `main.js`, `more.js`
  (Recipes under Plans), `app/css/app.css`.
- `app/js/sync.js`: `recipes` in KEYS and OPEN.

## 2026-10-14 — Dark redesign (frame + phone) and six new phone sections
JD asked for the look of a reference dashboard screenshot (dark charcoal tiles, olive-gold and
terracotta accents, serif clock), always dark, existing tiles only, and the phone app brought up
to date with the frame.

**Frame (wall dashboard)**
- `app/css/theme.css`: rewritten as an always-dark theme (near-black page, charcoal cards with a
  faint edge, olive-gold `--accent` #CDB66A, terracotta bars, Instrument Serif headings). Overrides
  the light-only colours in the view stylesheets; dark Leaflet map tiles and controls.
- `app/css/views/home.css`, `app/js/views/home.js`: Today rebuilt as a tile grid — clock and
  greeting over the photo slideshow | BART | weather with a temperature bar chart; music | next up
  (next calendar event, else the shopping list) | rain chance on a dry→wet scale; a to-do strip
  (today's chores + open reminders, tap a reminder to tick it). Adds `App.greeting`.
- `app/js/app.js`: night-mode filter no longer inverts lightness (the theme is already dark), the
  browser theme colour is dark, and near-black person colours (the "Family" default #111111) show
  as the gold accent so they don't vanish.
- `app/index.html`, `app/public/manifest.webmanifest`: dark theme colour.

**Phone app**
- `app/css/app.css`, `app/app.html`, `app/public/app.webmanifest`: same dark palette (no more
  light mode), serif headings, Instrument Serif font.
- `app/js/app/today.js`: Today mirrors the frame's tiles (clock over the photo of the day, weather
  with bars + rain, next up, to-dos, BART, music, pinned notes).
- New screens under More: `calendar.js` (two-week agenda, add/delete events), `chores.js`
  (routines, tick off with stars), `reminders.js` (JD/Georgia/House to-dos and texted reminders via
  /api/home/reminders), `map.js` (search, BART pins, drive/walk times with traffic; loads Leaflet on
  first open), `agents.js` (agent team, schedules and recent activity from /api/admin/agents, plus
  AI plan usage when set), `costs.js` (Claude API spend, same numbers as the frame).
- `app/js/app/main.js`, `more.js`: register the screens; More is grouped into Plans / House /
  Agents / Settings. `core.js`: date helpers (`dayStart`, `addDays`, `fmt.rel`, `greeting`) and the
  same near-black colour fix. `app/js/icons.js`: `robot` and `coin` icons.

