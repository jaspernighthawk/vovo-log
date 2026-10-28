# Vovo Log — how it works

For whoever has to maintain this later (probably you, probably at 2am).

## The shape of it

```
 iPhone (Safari, home-screen app)              Google
 ┌──────────────────────────────┐              ┌──────────────────────────────┐
 │ web/index.html + app.js      │   POST /exec │ Apps Script (script/Code.gs) │
 │  ├ localStorage              │ ───────────▶ │   doPost → appends to Log    │
 │  │   vovo.config (who, url…) │              │   doGet  → last N rows JSON  │
 │  │   vovo.outbox (unsent)    │ ◀─────────── │                              │
 │  │   vovo.rows   (cache)     │   GET /exec  │ Google Sheet                 │
 │  └ sw.js caches the shell    │              │   Log tab (append-only)      │
 └──────────────────────────────┘              │   Dashboard tab (formulas)   │
                                               └──────────────────────────────┘
```

Three independent pieces. Each can be replaced without touching the others as long as the JSON contract below holds.

## The contract

**Entry** (one log row, as JSON):

| field       | example                      | notes                                                        |
|-------------|------------------------------|--------------------------------------------------------------|
| `id`        | `"3b1f…"`                    | UUID made on the phone. The backend ignores a repeated id.   |
| `timestamp` | `"2026-10-28T21:15:00.000Z"` | ISO 8601, UTC. The Sheet shows it in the Sheet's timezone.   |
| `type`      | `cath` `temp` `med` `comment`| anything else is rejected                                    |
| `value`     | `17` / `98.6` / `"Macrobid"` | number for cath/temp, text otherwise                         |
| `who`       | `"Jasper"`                   | the name entered in Settings on that phone                   |
| `note`      | `"entered 2026-10-…"`        | free text; the app uses it to record back-dated entries      |

**POST** `/exec`, body `{"token": "…", "entries": [Entry, …]}` → `{"ok": true, "saved": [ids], "rejected": [{"id", "error"}]}`.
Content-Type is `text/plain` on purpose: a JSON content type would make Safari send a CORS preflight (`OPTIONS`), which Apps Script can't answer.

**GET** `/exec?token=…&n=300` → `{"ok": true, "rows": [Entry, …]}` oldest-first.

Any failure: `{"ok": false, "error": "…"}` with HTTP 200 (Apps Script always answers 200).

## Why the ids matter

Taps must never be lost and never be doubled. A phone with flaky signal may POST, lose the response, and POST again. `doPost` looks at the last 500 ids in the Log (`DEDUPE_WINDOW`) and reports an already-seen id as `saved` without writing it again. That lets the app retry blindly.

`LockService` serialises concurrent POSTs from the two phones so the dedupe check and the append are atomic.

## The phone app, step by step

1. **Boot** (`app.js` bottom): load config/outbox/rows from localStorage, render, register the service worker. No `who` yet → open the setup sheet.
2. **Tap a button** → `openEntry(type)` configures the one shared bottom sheet (title, unit, keyboard type, accent colour, med chips).
3. **Submit** → `submitEntry()` validates, builds an Entry, pushes it to `outbox`, saves, re-renders (the row appears with a hollow dot = pending), then calls `sync()`.
4. **`sync()`** POSTs the whole non-rejected outbox, removes whatever the server reports saved, keeps and marks rejected ones (shown struck-through, with a red status line), then GETs the latest rows and re-renders. It also runs on `online`, on returning to the app (`visibilitychange`), and from the menu.
5. **Render** merges `rows` (server truth) with `outbox` (local, pending), sorted by timestamp, grouped by day. Cath bars are scaled to the largest cath volume on screen (minimum scale 60 mL so an ordinary day isn't all full-width bars). Temperature colours: green < 100.0, orange < 101.0, red ≥ 101.0 (`TEMP_WARM`, `TEMP_HOT`).

The "setup code" is just `vovo1.` + base64 of `{url, token, sheetUrl}` — a way to move the secret between phones without typing it.

## The service worker

`sw.js` caches the shell (HTML, CSS, JS, icons) so the app opens offline. It serves from cache first and refreshes in the background, so **a code change is seen on the second launch after deploy**, and only if `CACHE` in `sw.js` was bumped (otherwise iOS may keep the old files indefinitely). Backend requests are cross-origin and bypass the worker entirely.

There is no Background Sync API on iOS; the queue is flushed when the app is opened or regains connectivity while open.

## The backend

`Code.gs` is the whole backend. Things to know:

- The token lives in **Script Properties** (`Project Settings → Script Properties`), set by `setup()`. It is never in the code or the repo. To rotate it: change the property, then enter the new one on both phones.
- Deployed "Execute as me, anyone can access" means the script runs with the owner's Google permissions regardless of who calls it — the token is the only gate. Keep it out of screenshots.
- Apps Script answers POSTs with a 302 redirect to a `googleusercontent.com` URL. `fetch` follows it; `curl` needs `-L`.
- `doGet` returns at most `MAX_ROWS_RETURNED` (2000) rows; `n` defaults to 300.
- Redeploying: edits to the code don't go live until you create a **new version** of the deployment.

## The Sheet

`Log` is sacred: only `doPost` writes, and humans only ever fix values or delete rows. Columns:

`timestamp | type | value | who | note | id`

`Dashboard` is free-form. Starting formulas (A1 of Dashboard):

```
=QUERY(Log!A:F, "select A, C where B = 'cath' order by A desc limit 20", 1)
```
```
=QUERY(Log!A:F, "select A, C where B = 'temp' order by A desc limit 50", 1)
```

Chart those ranges (Insert → Chart; horizontal bar for cath, line for temp). The 🌈 → "View chart" link opens the Dashboard tab directly in the Sheets app via the `#gid=` in the URL.

For the doctor: File → Download → PDF of the Dashboard tab, or a filtered CSV of `Log`.

## Roadmap (from the original brief)

- [x] 1–4: Sheet, backend, app, offline queue
- [ ] 5: import six months of history from text files (write rows straight into `Log`, give them ids like `import-<n>`)
- [ ] 6: Dashboard formulas and charts
- [ ] 7: in-app charts from `doGet` (the tape already renders bars; a proper chart could go above the buttons)
- [ ] 8: date-range PDF export for the doctor
