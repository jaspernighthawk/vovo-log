# Vovo Log

A two-person care log. Big buttons on the phone → rows in a private Google Sheet.

```
web/      the phone app (static; GitHub Pages)
script/   Code.gs — Apps Script backend bound to the Sheet
dev/      mock backend for working on the app locally
GUIDE.md  how the pieces fit together, for future maintenance
```

## One-time setup

### 1. The Sheet

1. Create a Google Sheet called **Vovo Log**. Share it with your partner's Google account (Editor).
2. **Extensions → Apps Script.** Delete the sample code, paste in [script/Code.gs](script/Code.gs), save.
3. In the script editor, choose the function **`setup`** in the toolbar and press **Run**. Approve the permissions prompt (it's your own script asking to edit your own Sheet).
4. Open **View → Logs** (or the Execution log). Copy the **token** and the **Dashboard link** it printed — you'll paste them into the app.

`setup` creates the `Log` tab (columns `timestamp, type, value, who, note, id`), the empty `Dashboard` tab, and a random token stored in Script Properties. It's safe to run again; it never touches existing rows.

### 2. Deploy the backend

1. In the script editor: **Deploy → New deployment**. Type: **Web app**.
2. *Execute as:* **Me**. *Who has access:* **Anyone**. Deploy.
3. Copy the **Web app URL** (ends in `/exec`).

Test from the Mac (replace the URL and token):

```bash
curl -L -s -H 'Content-Type: text/plain' -d '{"token":"TOKEN","entries":[{"id":"curl-1","timestamp":"2026-10-28T14:15:00Z","type":"cath","value":17,"who":"curl","note":"test"}]}' 'https://script.google.com/macros/s/XXX/exec'
```

```bash
curl -L -s 'https://script.google.com/macros/s/XXX/exec?token=TOKEN&n=5'
```

Both should answer `{"ok":true,…}`. Delete the test row from the Sheet afterwards.

> After you change `Code.gs` later: **Deploy → Manage deployments → ✎ → Version: New version → Deploy.** The URL stays the same.

### 3. Publish the app

1. Put this folder in a GitHub repo (private is fine — Pages still works on private repos for Pro/Team, otherwise make it public: it contains no secrets).
2. Repo **Settings → Pages → Source: GitHub Actions.** The workflow in `.github/workflows/pages.yml` publishes `web/` on every push to `main`.
3. The app lives at `https://<you>.github.io/<repo>/`.

### 4. Each phone

1. Open the Pages URL in **Safari**. Share → **Add to Home Screen**.
2. Open it from the home screen. The setup sheet appears: enter your name, the `/exec` URL, the token, and the Dashboard link. Save. You should see "Connected".
3. **Second phone:** on the first phone, 🌈 → **Copy setup code for the other phone**, send it by iMessage, and paste it into the *Setup code* field on the second phone. Only the name is left to type.

Settings can be changed later via 🌈 → Settings.

## Daily use

- Tap **mL**, **°F**, **med**, or **other**; type; **Log now**. "Different time…" lets you back-date an entry (the original entry time is kept in `note`).
- Entries appear instantly with a small hollow dot while they're waiting to reach the Sheet. No signal is fine — they're queued on the phone and sent when a connection returns or the app is reopened.
- 🌈 menu: hide the buttons (log-only), open the Dashboard in the Sheets app, force a sync, test the connection.

## Fixing mistakes

Edit the row in the `Log` tab of the Sheet (fix the value, or delete the row). The phones pick it up on the next sync. Nothing in the app edits or deletes rows.

## Working on the app

```bash
node dev/mock-server.mjs --seed
```

Then open http://localhost:8787, and in Settings use URL `http://localhost:8787/exec` with token `test`. The mock keeps rows in memory only.

When you change anything in `web/`, bump `CACHE` in [web/sw.js](web/sw.js) so phones refresh their cached copy.
