/* Vovo Log — phone app.
 *
 * State lives in localStorage:
 *   vovo.config   { who, url, token, sheetUrl, logOnly }
 *   vovo.outbox   entries not yet confirmed by the backend
 *   vovo.rows     latest rows fetched from the backend (display cache)
 *
 * Every tap writes to the outbox first and renders immediately; sync() then
 * POSTs the outbox whenever we're online. Entries carry a client-generated id
 * so a retried POST never produces a duplicate row.
 */

(() => {
  'use strict';

  const TYPES = {
    cath: { title: 'Cath volume', unit: 'mL', inputmode: 'numeric', numeric: true, accent: 'var(--cath)' },
    temp: { title: 'Temperature', unit: '°F', inputmode: 'decimal', numeric: true, accent: 'var(--temp)' },
    med: { title: 'Medicine', unit: '', inputmode: 'text', numeric: false, accent: 'var(--med)' },
    comment: { title: 'Note', unit: '', inputmode: 'text', numeric: false, accent: 'var(--comment)' },
  };
  const TEMP_WARM = 100.0; // °F — orange from here
  const TEMP_HOT = 101.0; // °F — red from here
  const FETCH_ROWS = 300;
  const KEYS = { config: 'vovo.config', outbox: 'vovo.outbox', rows: 'vovo.rows' };

  // ---------- storage ----------

  const load = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  };
  const save = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { console.warn('save failed', err); }
  };

  let config = Object.assign({ who: '', url: '', token: '', sheetUrl: '', logOnly: false }, load(KEYS.config, {}));
  let outbox = load(KEYS.outbox, []);
  let rows = load(KEYS.rows, []);

  // ---------- elements ----------

  const $ = (id) => document.getElementById(id);
  const el = {
    status: $('status'), menuBtn: $('menuBtn'), menu: $('menu'), sheetLink: $('sheetLink'),
    tape: $('tape'), pad: $('pad'), scrim: $('scrim'), toast: $('toast'),
    entrySheet: $('entrySheet'), entryTitle: $('entryTitle'), entryValue: $('entryValue'),
    entryUnit: $('entryUnit'), chips: $('chips'), timeField: $('timeField'), entryTime: $('entryTime'),
    entryError: $('entryError'), submitBtn: $('submitBtn'), timeToggle: $('timeToggle'),
    setupSheet: $('setupSheet'), setupCode: $('setupCode'), setupWho: $('setupWho'), setupUrl: $('setupUrl'),
    setupToken: $('setupToken'), setupSheetUrl: $('setupSheetUrl'), setupError: $('setupError'),
  };

  // ---------- rendering ----------

  const pad2 = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  function dayLabel(d) {
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (dayKey(d) === dayKey(today)) return 'Today';
    if (dayKey(d) === dayKey(yesterday)) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function timeLabel(d) {
    let h = d.getHours();
    const ampm = h < 12 ? 'a' : 'p';
    h = h % 12 || 12;
    return `${h}:${pad2(d.getMinutes())}<small>${ampm}</small>`;
  }

  function tempClass(v) {
    return v >= TEMP_HOT ? 'hot' : v >= TEMP_WARM ? 'warm' : 'ok';
  }

  function allEntries() {
    const pendingIds = new Set(outbox.map((e) => e.id));
    const merged = rows.filter((r) => !pendingIds.has(r.id)).map((r) => ({ ...r, state: 'saved' }));
    outbox.forEach((e) => merged.push({ ...e, state: e.rejected ? 'rejected' : 'pending' }));
    merged.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return merged;
  }

  function render(freshId) {
    const entries = allEntries();
    const tape = el.tape;
    const stuckToBottom = tape.scrollHeight - tape.scrollTop - tape.clientHeight < 40;
    tape.innerHTML = '';

    if (!entries.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = config.url ? 'Nothing logged yet.' : 'Open 🌈 → Settings to connect this phone.';
      tape.appendChild(p);
      return;
    }

    const cathMax = Math.max(60, ...entries.filter((e) => e.type === 'cath').map((e) => Number(e.value) || 0));
    let lastDay = '';

    entries.forEach((e) => {
      const d = new Date(e.timestamp);
      const key = dayKey(d);
      if (key !== lastDay) {
        const h = document.createElement('div');
        h.className = 'day';
        h.textContent = dayLabel(d);
        tape.appendChild(h);
        lastDay = key;
      }

      const row = document.createElement('div');
      row.className = `row ${e.type} ${e.state}` + (e.id === freshId ? ' fresh' : '');
      row.title = e.note ? e.note : '';

      const text = document.createElement('span');
      text.className = 'text';

      if (e.type === 'cath') {
        text.innerHTML = `${timeLabel(d)} - ${Number(e.value)}<small>ml</small>`;
        const bar = document.createElement('span');
        bar.className = 'bar';
        bar.style.setProperty('--w', Math.min(1, Number(e.value) / cathMax));
        row.append(text, bar);
      } else if (e.type === 'temp') {
        row.classList.add(tempClass(Number(e.value)));
        text.innerHTML = `${timeLabel(d)} - ${Number(e.value).toFixed(1)}`;
        row.append(text);
      } else if (e.type === 'med') {
        text.innerHTML = `${timeLabel(d)} <span class="name"></span>`;
        text.querySelector('.name').textContent = e.value;
        row.append(text);
      } else {
        text.innerHTML = `${timeLabel(d)} `;
        text.append(document.createTextNode(e.value));
        row.append(text);
      }

      if (e.who && e.who !== config.who) {
        const who = document.createElement('span');
        who.className = 'who';
        who.textContent = e.who;
        row.append(who);
      }
      tape.appendChild(row);
    });

    if (stuckToBottom || freshId) tape.scrollTop = tape.scrollHeight;
  }

  function renderStatus(extra) {
    const pending = outbox.filter((e) => !e.rejected).length;
    const rejected = outbox.filter((e) => e.rejected).length;
    let text = extra || '';
    let cls = '';
    if (!navigator.onLine) { text = pending ? `Offline · ${pending} waiting` : 'Offline'; cls = 'warn'; }
    else if (pending) { text = `${pending} waiting to send`; cls = 'warn'; }
    if (rejected) { text = `${rejected} rejected by server`; cls = 'bad'; }
    el.status.textContent = text;
    el.status.className = `status ${cls}`;
  }

  let toastTimer;
  function toast(msg, ms = 2200) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
  }

  // ---------- network ----------

  let syncing = false;

  async function post(entries) {
    // text/plain keeps the browser from sending a CORS preflight, which Apps Script can't answer.
    const res = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: config.token, entries }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function fetchRows(n = FETCH_ROWS) {
    const u = new URL(config.url);
    u.searchParams.set('token', config.token);
    u.searchParams.set('n', n);
    const res = await fetch(u, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Server error');
    return data.rows;
  }

  async function sync({ pull = true, quiet = true } = {}) {
    if (syncing || !config.url || !config.token) return;
    if (!navigator.onLine) { renderStatus(); return; }
    syncing = true;
    try {
      const toSend = outbox.filter((e) => !e.rejected);
      if (toSend.length) {
        const data = await post(toSend);
        if (!data.ok) throw new Error(data.error || 'Server error');
        const saved = new Set(data.saved || []);
        const rejected = new Map((data.rejected || []).map((r) => [r.id, r.error]));
        outbox = outbox.filter((e) => !saved.has(e.id) || rejected.has(e.id));
        outbox.forEach((e) => { if (rejected.has(e.id)) e.rejected = rejected.get(e.id); });
        save(KEYS.outbox, outbox);
        if (rejected.size) toast(`Server rejected ${rejected.size}: ${[...rejected.values()][0]}`, 4000);
      }
      if (pull) {
        rows = await fetchRows();
        save(KEYS.rows, rows);
      }
      render();
      renderStatus();
      if (!quiet) toast('Synced');
    } catch (err) {
      console.warn('sync failed', err);
      renderStatus(`Couldn’t reach the Sheet · ${outbox.length || ''}`.trim());
      if (!quiet) toast(`Sync failed: ${err.message}`, 4000);
    } finally {
      syncing = false;
    }
  }

  // ---------- entry sheet ----------

  let currentType = null;
  let customTime = false;

  function localDatetimeValue(d) {
    return `${dayKey(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function recentMeds() {
    const seen = [];
    allEntries().slice().reverse().forEach((e) => {
      if (e.type === 'med' && e.value && !seen.includes(e.value)) seen.push(e.value);
    });
    return seen.slice(0, 6);
  }

  function openEntry(type) {
    const t = TYPES[type];
    currentType = type;
    customTime = false;
    el.entryTitle.textContent = t.title;
    el.entryUnit.textContent = t.unit;
    el.entryValue.value = '';
    el.entryValue.inputMode = t.inputmode;
    el.entryValue.className = t.numeric ? '' : 'text';
    el.entryValue.autocapitalize = type === 'comment' ? 'sentences' : 'words';
    el.entryError.textContent = '';
    el.entrySheet.style.setProperty('--accent', t.accent);
    el.submitBtn.textContent = 'Log now';
    el.timeToggle.textContent = 'Different time…';
    el.timeField.hidden = true;
    el.entryTime.value = localDatetimeValue(new Date());

    el.chips.innerHTML = '';
    if (type === 'med') {
      recentMeds().forEach((name) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = name;
        b.addEventListener('click', () => { el.entryValue.value = name; submitEntry(); });
        el.chips.appendChild(b);
      });
    }

    el.scrim.hidden = false;
    el.entrySheet.hidden = false;
    setTimeout(() => el.entryValue.focus(), 50);
  }

  function closeSheets() {
    el.entrySheet.hidden = true;
    el.setupSheet.hidden = true;
    el.scrim.hidden = true;
    currentType = null;
    document.activeElement?.blur?.();
  }

  function submitEntry() {
    const t = TYPES[currentType];
    let value = el.entryValue.value.trim();
    if (t.numeric) {
      value = Number(value.replace(',', '.'));
      if (!isFinite(value)) { el.entryError.textContent = 'Enter a number.'; return; }
      if (currentType === 'temp' && (value < 90 || value > 110)) { el.entryError.textContent = 'That doesn’t look like °F.'; return; }
      if (currentType === 'cath' && (value < 0 || value > 2000)) { el.entryError.textContent = 'That doesn’t look like mL.'; return; }
    } else if (!value) {
      el.entryError.textContent = 'Type something first.';
      return;
    }

    let when = new Date();
    if (customTime) {
      when = new Date(el.entryTime.value);
      if (isNaN(when.getTime())) { el.entryError.textContent = 'Pick a time.'; return; }
    }

    const entry = {
      id: (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2)),
      timestamp: when.toISOString(),
      type: currentType,
      value,
      who: config.who,
      note: customTime ? 'entered ' + new Date().toISOString() : '',
    };
    outbox.push(entry);
    save(KEYS.outbox, outbox);
    closeSheets();
    render(entry.id);
    renderStatus();
    if (navigator.vibrate) navigator.vibrate(10);
    sync();
  }

  // ---------- setup sheet ----------

  function setupCodeFor(cfg) {
    return 'vovo1.' + btoa(unescape(encodeURIComponent(JSON.stringify({ url: cfg.url, token: cfg.token, sheetUrl: cfg.sheetUrl }))));
  }

  function parseSetupCode(code) {
    const m = /^vovo1\.(.+)$/.exec(code.trim());
    if (!m) return null;
    try { return JSON.parse(decodeURIComponent(escape(atob(m[1])))); } catch { return null; }
  }

  function openSetup() {
    el.setupCode.value = '';
    el.setupWho.value = config.who;
    el.setupUrl.value = config.url;
    el.setupToken.value = config.token;
    el.setupSheetUrl.value = config.sheetUrl;
    el.setupError.textContent = '';
    el.scrim.hidden = false;
    el.setupSheet.hidden = false;
    setTimeout(() => (config.who ? el.setupCode : el.setupWho).focus(), 50);
  }

  function applyConfig() {
    el.sheetLink.href = config.sheetUrl || '#';
    el.sheetLink.setAttribute('aria-disabled', config.sheetUrl ? 'false' : 'true');
    document.body.classList.toggle('log-only', Boolean(config.logOnly));
    el.menu.querySelector('[data-action="log-only"]').textContent = config.logOnly ? 'Show buttons' : 'Log only';
  }

  // ---------- menu ----------

  function toggleMenu(open) {
    const show = open ?? el.menu.hidden;
    el.menu.hidden = !show;
    el.menuBtn.setAttribute('aria-expanded', String(show));
  }

  const actions = {
    'log-only': () => { config.logOnly = !config.logOnly; save(KEYS.config, config); applyConfig(); },
    sync: () => sync({ quiet: false }),
    settings: openSetup,
    'copy-setup': async () => {
      if (!config.url) return toast('Set this phone up first.');
      try { await navigator.clipboard.writeText(setupCodeFor(config)); toast('Setup code copied — paste it on the other phone.'); }
      catch { prompt('Copy this setup code:', setupCodeFor(config)); }
    },
    test: async () => {
      if (!config.url) return toast('Set this phone up first.');
      toast('Testing…');
      try { const r = await fetchRows(1); toast(`Connected ✓ (${r.length ? 'last row ' + new Date(r[r.length - 1].timestamp).toLocaleString() : 'log is empty'})`, 3500); }
      catch (err) { toast(`Failed: ${err.message}`, 4000); }
    },
  };

  // ---------- wiring ----------

  el.menuBtn.addEventListener('click', (ev) => { ev.stopPropagation(); toggleMenu(); });
  el.menu.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-action]');
    toggleMenu(false);
    if (btn) actions[btn.dataset.action]();
  });
  document.addEventListener('click', (ev) => { if (!el.menu.hidden && !el.menu.contains(ev.target)) toggleMenu(false); });

  el.pad.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-type]');
    if (!btn) return;
    if (!config.who) { openSetup(); return; }
    openEntry(btn.dataset.type);
  });

  el.scrim.addEventListener('click', closeSheets);
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeSheets));
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeSheets(); });

  el.entrySheet.addEventListener('submit', (ev) => { ev.preventDefault(); submitEntry(); });
  el.timeToggle.addEventListener('click', () => {
    customTime = !customTime;
    el.timeField.hidden = !customTime;
    el.submitBtn.textContent = customTime ? 'Log at that time' : 'Log now';
    el.timeToggle.textContent = customTime ? 'Use the current time instead' : 'Different time…';
    if (customTime) { el.entryTime.value = localDatetimeValue(new Date()); el.entryTime.focus(); }
  });

  el.setupCode.addEventListener('input', () => {
    const parsed = parseSetupCode(el.setupCode.value);
    if (!parsed) return;
    el.setupUrl.value = parsed.url || '';
    el.setupToken.value = parsed.token || '';
    el.setupSheetUrl.value = parsed.sheetUrl || '';
    el.setupError.textContent = '';
    el.setupWho.focus();
  });

  el.setupSheet.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const who = el.setupWho.value.trim();
    const url = el.setupUrl.value.trim();
    const token = el.setupToken.value.trim();
    if (!who) { el.setupError.textContent = 'Enter your name.'; return; }
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url)) {
      el.setupError.textContent = 'The URL should end in /exec.'; return;
    }
    if (!token) { el.setupError.textContent = 'Enter the token.'; return; }
    config = { ...config, who, url, token, sheetUrl: el.setupSheetUrl.value.trim() };
    save(KEYS.config, config);
    applyConfig();
    closeSheets();
    render();
    toast(`Hi ${who}. Checking the connection…`);
    sync({ quiet: false });
  });

  window.addEventListener('online', () => { renderStatus(); sync(); });
  window.addEventListener('offline', renderStatus);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });

  // Keep bottom sheets above the iOS keyboard.
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const onResize = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--keyboard', kb + 'px');
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('sw', err));
  }

  // ---------- go ----------

  applyConfig();
  render();
  renderStatus();
  if (!config.who) openSetup(); else sync();
})();
