We’re going to build a small web app that will be really useful to my family, allowing us to visualize trends in function and making it easier to capture key information throughout the day. It should also, ultimately, have an elegance and elan that will increase our joy in the relentless gathering of this information. It’s going to be great!

# Vovo Care Log

A two-person daily-care logging tool. Used only by me and my partner. Records
events (medicine given, body temperature, catheterization volume) to an
append-only "tape" that we view on our phones and periodically share with a
doctor.

## Architecture (decided)

- **Source of truth:** one Google Sheet, shared with both partners' Google accounts.
  - `Log` tab: raw append-only rows. Columns: `timestamp`, `type`, `value`, `who`,
    `note`. Never edited or deleted by hand.
  - `Dashboard` tab: formula-driven views (QUERY pulling latest N rows) with
    Sheets charts, e.g. horizontal bar chart of the last 20 cath volumes,
    line chart of temperature.
- **Backend:** Google Apps Script bound to the Sheet, deployed as a web app
  running as me, access "anyone with the link".
  - `doPost`: appends one row to `Log`.
  - `doGet`: returns latest rows as JSON for in-app charts.
  - Both check a shared secret token in the request; reject otherwise.
- **Frontend:** static web app (plain HTML/CSS/JS, no framework needed), hosted
  on GitHub Pages, added to the iOS home screen on both phones.
  - See the mockup in our folder: VovoLogMockup.png
  - Four big buttons: Cath Volume (label: mL), Temp (label: °F), Medicine (label: med), and Comment (label: other). Each opens a one-field sheet that asks for further information, then asks whether to stamp the current time on submit or to enter a custom time.
  - Remembers which partner this device belongs to (`who`).
  - Offline queue in localStorage + service worker; retries POST when online.
  - A dropdown menu in the upper right corner (icon: the rainbow emoji) that we can press in order to access further choices. These may include a log-only view (AKA, hide the buttons), a "View chart on Google Sheets" button linking to the Sheet's Dashboard tab (`https://docs.google.com/spreadsheets/d/<id>/edit#gid=<dashboard-gid>`) which opens in the Google Sheets app on iOS, and possibly some testing features for debugging. (We don’t need to be too precious about adding items here, as only the developer and his spouse will be using it.)
  - Later, we are planning to render charts in-app from `doGet` JSON. For now we can leave that part of the app window blank. (See design drawing.)
- **No native iOS app, no Apple developer account, no Mac app** (for now).

## Principles

- Append-only. Corrections will be handled manually inside Google Sheets.
- The CSV/PDF the doctor sees is the real deliverable; design columns for that first.
- Taps must always succeed, even with no signal.
- Medical data: keep the Sheet private, keep the secret token out of the repo
  (config file in `.gitignore`), don't publish charts to the web.

## Build order

1. Create the Sheet with `Log` and `Dashboard` tabs and column headers.
2. Apps Script with `doPost` (+ token check). Deploy. Test with `curl`.
3. Web app, online-only. Deploy to GitHub Pages. Install on both phones.
4. Offline queue + service worker.
5. Upload, parse, and add previous six months’ worth of data from text files. 
6. Dashboard tab formulas and charts; add the "View chart" button.
7. `doGet` + in-app chart.
8. Doctor export: date-range PDF of the Dashboard tab.

## Repo layout (proposed by Claude)

```
/web        index.html, app.js, sw.js, style.css, config.example.js
/script     Code.gs (Apps Script; paste into the Sheet's script editor, or push with clasp)
README.md   setup steps for a fresh phone
GUIDE.md    a detailed explanation of how the various pieces are working together, for future maintenance 
```