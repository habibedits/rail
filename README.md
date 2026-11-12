# Rail

A docked macOS side panel: claude.ai + Notion (Space 1, "Work") and Fireflies (Space 2, "Meetings").
Built from the PRD "Side Panel App PRD — Claude + Notion + Fireflies".

**Status:** M1–M4, M7 and M8 done: docked shell, spaces (Claude ⌃1, Notion ⌃2, Meetings ⌃3, Slack ⌃4, Calendar ⌃5, Focus ⌃6; Focus always last) + swipe, Fireflies Meetings panel, Slack, Calendar, Focus. Claude and Notion were one split "Work" space until 2026-11-12. Open: M5 Send to Notion, Send to Slack, M6 polish.

## Run

```bash
npm install
npm run dev
```

`npm run dev` rebuilds the main process, starts Vite for Rail's own UI, and launches Electron.
UI changes (`src/renderer`) hot-reload. Changes to `src/main` or `src/preload` need a restart (Ctrl+C, then `npm run dev`).

`npm start` runs a production build without Vite.

## Install as an app

```bash
npm run install-app
```

This builds `Rail.app`, copies it to `/Applications` and opens it. Quit the dev copy first (both share one login store, so only one runs at a time).
The installed app opens at login by default; untick **Rail menu → Open at Login** to stop that. Re-run `npm run install-app` after code changes.
Your Claude/Notion logins and settings carry over, because the dev and installed copies use the same `~/Library/Application Support/Rail`.

### On another Mac

Needs an Apple Silicon Mac with [Node.js](https://nodejs.org) 20 or later and Git.

```bash
git clone https://github.com/<you>/rail.git
cd rail
npm install
npm run install-app
```

Logins, the Fireflies key, Notion Calendar access and Focus history live on each Mac, not in the repo, so sign in again there (or use **Rail menu → Import Logins from Arc…**). The app isn't code-signed, so if macOS blocks it the first time, right-click Rail in Applications and choose **Open**.

To pick up later changes on that Mac: `git pull && npm install && npm run install-app`.

## Using it

| What | How |
| --- | --- |
| Show / hide Rail | `Ctrl+`` ` (global), or the hide button in the top strip |
| Switch space | Two-finger horizontal swipe, `Ctrl+Option+←/→`, `Ctrl+1` / `Ctrl+2` / `Ctrl+3`, or click a dot |
| Resize Claude/Notion split | Drag the Notion header bar; double-click it to reset to 60/40 |
| Give one pane full height | The ⌃ / ⌄ buttons at the right of the Notion header |
| Claude actions | Back, reload, new chat, open in browser (top strip) |
| Notion navigation | Back / forward, and click the page title for your 15 most recent pages (Notion header) |
| Notion actions | Reload, open in browser; Notion home and "open in Notion app" are in the page-title menu |
| Stay on top | Pin button in the top strip |
| Calendar | Space 4: today from every account connected in Notion Calendar (via Notion's MCP server), in your Mac's time zone. Day grid with a color per calendar; a dropdown ("6 of 35 ▾") picks which calendars show, grouped by account. Drag an event to move it, + or double-click a slot to add one, Notes opens (or makes) the event's Notion meeting note in the Notion pane; Transcribe / Join & transcribe also starts Notion's browser transcription there (your mic only). RSVP Yes/No/Maybe on invites. New events default to the work account's calendar. Nudge 5 min before each meeting (and at start if it has a video link); the dot shows a countdown (`12m`, `now`). Connect once: approve Rail in Notion in your browser |
| Focus | Space 6 (⌃6, always last): Pomodoro timer (25/5/15 by default, long break every 4; change under Timer settings). The timer runs in the main process, so it keeps going in other spaces and notifies when a session or break ends. Finished focus sessions fill a GitHub-style grid (last 21 weeks) with today / week / streak counts; stored in Rail's userData `focus.json`. Below it: Sudoku (generated locally, easy/medium/hard, pencil marks) and chess puzzles from Lichess's public puzzle API |
| Notion links | `notion://` links (e.g. Notion Calendar → Open meeting note) open in Rail's Notion pane. Toggle: Rail menu → Open Notion Links in Rail |
| Slack | Space 4 (loads the first time you open it). Silent in Rail: no notifications and no alert sounds (huddle audio and clips you click still play). Unread count shows on its dot only |

**Signing in:** Google blocks its sign-in inside embedded browsers, so the "Continue with Google" buttons won't work in Rail. Either:

- **Rail menu → Import Logins from Arc…** copies your Claude, Notion and Slack login cookies from Arc (Default and numbered profiles). macOS asks to allow access to "Arc Safe Storage" in the Keychain; click Allow. Re-run it if a login expires or you log out in Arc.
- Or sign in with your email address and the code Claude/Notion send you. It's the same account as your Google sign-in.

Settings (width %, split, pin, last Notion page) are in `~/Library/Application Support/Rail/config.json`.
Logins live in the Electron session partitions `persist:claude` and `persist:notion`.

## Layout of the code

- `src/main/main.ts`: window, docking, layout, spaces, link handling, IPC
- `src/main/config.ts`: non-secret settings
- `src/preload/swipe.ts`: wheel-delta swipe detection (PRD §5)
- `src/preload/web.ts`: preload for claude.ai and Notion (swipe only, exposes nothing)
- `src/preload/shell.ts`: preload for Rail's own UI (adds the `window.rail` bridge)
- `src/renderer/`: React UI for the top strip, the divider bar and the Meetings space

## Debugging

`RAIL_DEBUG_PORT=9339 npm run dev` opens a Chrome DevTools port (listed at `http://localhost:9339/json`). Leave it off normally.
