---
name: home-hq
description: Control the house and the family dashboard on the Mac mini - lights and scenes (HomeKit), locks, the shopping list, calendar events, chores, who's home, Plex library scans, and messages on the picture frame. Use for any request about the home, lights, groceries, the family calendar, or the dashboard.
---

# Home HQ

The family dashboard and smart-home bridge run on this Mac mini at http://localhost:8787.
Use the `~/HomeHQ/bin/homehq` command for everything. It prints JSON.

## Look before acting

Run `~/HomeHQ/bin/homehq summary` first when you need names. It lists today's remaining events,
which lights are on, unlocked doors, the shopping list, Plex, and the exact device and scene names.

## Commands

| Ask | Command |
| --- | --- |
| "movie time", "goodnight" | `homehq scene movie` · `homehq scene goodnight` (also dinner, morning, away) |
| "kitchen lights to 40%" | `homehq light "pendants" 40` (name match is loose) |
| "turn off the floor lamp" | `homehq light "floor lamp" off` |
| "everything off" | `homehq lights-off` |
| "lock the front door" | `homehq lock "front door"` |
| "add milk and eggs" | `homehq add milk` then `homehq add eggs` (one item per call) |
| "got the bananas" | `homehq got bananas` |
| "dentist Thursday 3pm for Claudia" | `homehq event "Dentist" 2026-10-15T15:00:00-07:00 60 Claudia` |
| "Buzzsaw did homework" | `homehq chore-done "Homework" Buzzsaw` |
| "I'm heading out" | `homehq away Jonny "Out"` · back: `homehq here Jonny` |
| "tell the kids dinner's ready" | `homehq say Dinner's ready!` (shows on the frame) |
| "rescan Plex" | `homehq plex-scan` |

## Rules

- Unlocking a door or opening the garage: confirm with the person first, every time.
- Times are America/Los_Angeles. Always send an ISO time with the offset for events.
- Reply in one short line after acting ("Movie scene on. 7 lights changed.").
- The admin page for anything else is http://localhost:8787/admin. Do not edit `~/HomeHQ/data` by hand.
- Never send the API token or anything from `~/HomeHQ/data` in a message.
