/**
 * Vovo Log — Apps Script backend.
 *
 * Bound to the Vovo Log Google Sheet. Deployed as a web app
 * (Execute as: me, Who has access: Anyone). Every request must carry the
 * shared secret token, which lives in Script Properties (never in this file).
 *
 *   doPost  — append one or more entries to the Log tab.
 *   doGet   — return the latest rows of the Log tab as JSON.
 *   setup() — run once by hand from the script editor to create the tabs
 *             and generate the token.
 */

const LOG_SHEET = 'Log';
const DASHBOARD_SHEET = 'Dashboard';
const HEADERS = ['timestamp', 'type', 'value', 'who', 'note', 'id'];
const TYPES = ['cath', 'temp', 'med', 'comment'];
const NUMERIC_TYPES = ['cath', 'temp'];
const DEDUPE_WINDOW = 500; // how many recent ids to check against retried uploads
const MAX_ROWS_RETURNED = 2000;

/** Run once from the script editor. Safe to run again. */
function setup() {
  const ss = SpreadsheetApp.getActive();

  let log = ss.getSheetByName(LOG_SHEET);
  if (!log) {
    const blank = ss.getSheets().find((s) => s.getLastRow() === 0 && s.getName() !== DASHBOARD_SHEET);
    log = blank ? blank.setName(LOG_SHEET) : ss.insertSheet(LOG_SHEET);
  }
  log.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  log.setFrozenRows(1);
  log.getRange('A2:A').setNumberFormat('yyyy-mm-dd hh:mm');
  log.getRange('C2:C').setHorizontalAlignment('left');

  if (!ss.getSheetByName(DASHBOARD_SHEET)) ss.insertSheet(DASHBOARD_SHEET);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', Utilities.getUuid());

  const dashboard = ss.getSheetByName(DASHBOARD_SHEET);
  Logger.log('Token (paste into the app on each phone): %s', props.getProperty('TOKEN'));
  Logger.log('Dashboard link: %s#gid=%s', ss.getUrl(), String(dashboard.getSheetId()));
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Request body is not JSON' });
  }
  if (!tokenOk_(body.token)) return json_({ ok: false, error: 'Unauthorized' });

  const entries = Array.isArray(body.entries) ? body.entries : [body];
  const saved = [];
  const rejected = [];

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const log = logSheet_();
    const seen = recentIds_(log);
    const rows = [];

    entries.forEach((entry) => {
      const id = String(entry.id || '');
      if (id && seen.has(id)) {
        saved.push(id); // a retry of something we already have
        return;
      }
      const result = toRow_(entry);
      if (result.error) {
        rejected.push({ id: id, error: result.error });
        return;
      }
      rows.push(result.row);
      saved.push(id);
      seen.add(id);
    });

    if (rows.length) {
      log.getRange(log.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
    }
  } finally {
    lock.releaseLock();
  }

  return json_({ ok: true, saved: saved, rejected: rejected });
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (!tokenOk_(params.token)) return json_({ ok: false, error: 'Unauthorized' });

  const n = Math.min(Math.max(parseInt(params.n, 10) || 300, 0), MAX_ROWS_RETURNED);
  const log = logSheet_();
  const last = log.getLastRow();
  if (last < 2 || n === 0) return json_({ ok: true, rows: [] });

  const first = Math.max(2, last - n + 1);
  const values = log.getRange(first, 1, last - first + 1, HEADERS.length).getValues();
  const rows = values
    .filter((r) => r[0] !== '' && r[1] !== '')
    .map((r, i) => ({
      timestamp: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
      type: String(r[1]),
      value: r[2],
      who: String(r[3]),
      note: String(r[4]),
      id: String(r[5] || 'row-' + (first + i)),
    }));

  return json_({ ok: true, rows: rows });
}

function toRow_(entry) {
  const type = String(entry.type || '');
  if (TYPES.indexOf(type) === -1) return { error: 'Unknown type: ' + type };

  const timestamp = new Date(entry.timestamp);
  if (isNaN(timestamp.getTime())) return { error: 'Bad timestamp' };

  let value = entry.value;
  if (NUMERIC_TYPES.indexOf(type) !== -1) {
    value = Number(value);
    if (!isFinite(value)) return { error: 'Value must be a number' };
  } else {
    value = String(value == null ? '' : value).trim();
    if (!value) return { error: 'Value is empty' };
  }

  return {
    row: [timestamp, type, value, String(entry.who || ''), String(entry.note || ''), String(entry.id || '')],
  };
}

function recentIds_(log) {
  const last = log.getLastRow();
  if (last < 2) return new Set();
  const first = Math.max(2, last - DEDUPE_WINDOW + 1);
  const ids = log.getRange(first, HEADERS.indexOf('id') + 1, last - first + 1, 1).getValues();
  return new Set(ids.map((r) => String(r[0])).filter(Boolean));
}

function tokenOk_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  return Boolean(expected) && token === expected;
}

function logSheet_() {
  const log = SpreadsheetApp.getActive().getSheetByName(LOG_SHEET);
  if (!log) throw new Error('No "' + LOG_SHEET + '" tab. Run setup() first.');
  return log;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
