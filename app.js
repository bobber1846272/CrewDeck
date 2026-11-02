/* Terugbelsysteem · TheNextGroep BV — webapp (geen externe bibliotheken) */
'use strict';

const $app = document.getElementById('app');
const RIGHT_LABELS = {
  create: 'Verzoeken en taken aanmaken',
  assign: 'Toewijzen aan collega’s',
  viewAll: 'Alles zien (alle verzoeken en taken, teambord, cijfers, logboek)',
  deleteItems: 'Verzoeken en taken verwijderen',
  manageUsers: 'Gebruikers beheren'
};
const ROLE_LABELS = { medewerker: 'Medewerker', teamleider: 'Teamleider', beheerder: 'Beheerder' };
const CATEGORIES = ['Offerte / zakelijk', 'Bestelling', 'Retour', 'Technisch', 'Klacht', 'Overig'];
const REPEATS = { none: 'Niet herhalen', werkdag: 'Elke werkdag', dag: 'Elke dag', week: 'Elke week' };
const QUICK_NOTES = ['Voicemail ingesproken', 'In gesprek', 'Belt zelf terug', 'Na 15:00 bellen', 'Mail gestuurd', 'Verkeerd nummer'];

const S = {
  me: null, loginError: null,
  counts: { mine: 0, pool: 0, tasks: 0 },
  seen: null, // ids die al bekend waren (voor meldingen)
  colleagues: [],
  cbTab: 'mine', cbList: [], cbSel: null, cbQ: '', cbResults: null,
  tView: 'mine', tasks: [], tWho: 'ALL', showArchive: false, searchOpen: false, q: '', results: null,
  team: null, stats: null, statDays: 7, log: null, logUser: '', logQ: '',
  users: [], roleDefaults: {}, uSel: null, uNew: false, shownCode: null,
  F: null, T: null, edit: null, dup: null
};

// ---------- hulpjes ----------
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function initials(name) {
  const p = String(name || '?').trim().split(/\s+/);
  return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : (p[0][1] || ''))).toUpperCase();
}
const COLORS = ['#3B4563', '#0F766E', '#1D4ED8', '#7A2E8E', '#9A3412', '#166534', '#9F1239', '#334155'];
function colorFor(id) { return COLORS[(Number(id) || 0) % COLORS.length]; }
function avatar(id, name, cls) {
  return '<span class="avatar ' + (cls || '') + '" style="background:' + colorFor(id) + '" title="' + esc(name) + '">' + esc(initials(name)) + '</span>';
}
function pad(n) { return String(n).padStart(2, '0'); }
function toLocalInput(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function defaultDue(hours) {
  const d = new Date(Date.now() + hours * 3600000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return toLocalInput(d);
}
const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function sameDay(a, b) { return a.toDateString() === b.toDateString(); }
function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return '';
  const now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return 'vandaag ' + hm(d);
  if (sameDay(d, y)) return 'gisteren ' + hm(d);
  return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + hm(d);
}
function humanMin(min) {
  if (min == null) return '–';
  if (min < 60) return Math.round(min) + ' min';
  const h = min / 60;
  if (h < 24) return (h < 10 ? h.toFixed(1).replace('.', ',') : Math.round(h)) + ' uur';
  const d = Math.floor(h / 24);
  return d + ' dag' + (d > 1 ? 'en' : '');
}
function dueBadge(v, kind) {
  if (!v) return '<span class="badge">' + (kind === 'bel' ? 'Geen tijd' : 'Geen deadline') + '</span>';
  const d = new Date(v);
  if (isNaN(d)) return '';
  const diff = Math.round((d - Date.now()) / 60000);
  const now = new Date();
  const tm = new Date(now); tm.setDate(now.getDate() + 1);
  if (diff < 0) return '<span class="badge red">Te laat · ' + humanMin(-diff) + '</span>';
  if (diff <= 60) return '<span class="badge orange">' + (kind === 'bel' ? 'Bel vóór ' : 'Vóór ') + hm(d) + '</span>';
  if (sameDay(d, now)) return '<span class="badge green">Vandaag ' + hm(d) + '</span>';
  if (sameDay(d, tm)) return '<span class="badge">Morgen ' + hm(d) + '</span>';
  return '<span class="badge">' + DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + hm(d) + '</span>';
}
function isLate(v) { return v && new Date(v) < new Date(); }
function within(v, min) { if (!v) return false; const diff = (new Date(v) - Date.now()) / 60000; return diff >= 0 && diff <= min; }
function cbTitle(c) { return c.type === 'particulier' ? c.name : c.company; }
function canEditCb(c) { return S.me.rights.viewAll || c.createdBy === S.me.id || c.assignee === S.me.id; }
function canEditTask(t) { return S.me.rights.viewAll || t.createdBy === S.me.id; }

let toastTimer;
function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3600);
}

async function api(path, method, body) {
  const opt = { method: method || 'GET', headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch(path, opt);
  let data = {};
  try { data = await res.json(); } catch (e) { /* leeg */ }
  if (res.status === 401 && path !== '/api/login') { S.me = null; S.seen = null; render(); throw new Error(data.error || 'Niet ingelogd'); }
  if (!res.ok) throw new Error(data.error || 'Er ging iets mis.');
  return data;
}

const ICON = {
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  box: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/></svg>',
  edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/></svg>',
  trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  repeat: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
  lock: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  bell: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>',
  pin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  alert: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B42318" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;margin-top:1px"><circle cx="12" cy="12" r="10"/><path d="M12 7v6M12 16.5v.5"/></svg>',
  warn: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B54708" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;margin-top:1px"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/></svg>',
  check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#067647" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none"><path d="M5 12l5 5L20 7"/></svg>',
  spark: '<svg width="20" height="20" viewBox="0 0 24 24" role="img" aria-label="Spark Apps logo"><path d="M12 1.5C12.9 8.6 15.4 11.1 22.5 12C15.4 12.9 12.9 15.4 12 22.5C11.1 15.4 8.6 12.9 1.5 12C8.6 11.1 11.1 8.6 12 1.5Z" fill="#FDBA74"/></svg>'
};

// ---------- meldingen ----------
const prefs = (() => { try { return JSON.parse(localStorage.getItem('tbs-prefs') || '{}'); } catch (e) { return {}; } })();
function savePrefs() { try { localStorage.setItem('tbs-prefs', JSON.stringify(prefs)); } catch (e) { /* */ } }
if (prefs.sound === undefined) prefs.sound = true;
let audioCtx = null;
function unlockAudio() {
  if (audioCtx) return;
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
}
document.addEventListener('pointerdown', unlockAudio, { once: true });
function beep() {
  if (!prefs.sound || !audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    [[880, 0], [1175, 0.16]].forEach(([f, d]) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.25);
      o.connect(g).connect(audioCtx.destination); o.start(t + d); o.stop(t + d + 0.3);
    });
  } catch (e) { /* */ }
}
const canSysNotify = () => 'Notification' in window && window.isSecureContext;
function notify(title, body) {
  beep();
  toast(title + (body ? ': ' + body : ''));
  if (canSysNotify() && Notification.permission === 'granted' && document.hidden) {
    try { new Notification(title, { body, tag: 'tbs-' + Date.now() }); } catch (e) { /* */ }
  }
}
let flashTimer = null;
function updateTitle() {
  const n = S.counts.mine + S.counts.tasks;
  document.title = (n ? '(' + n + ') ' : '') + 'Terugbelsysteem · TheNextGroep BV';
}

// ---------- routes ----------
const ROUTES = ['terugbellen', 'verzoek', 'taken', 'taak', 'team', 'cijfers', 'logboek', 'gebruikers'];
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  return ROUTES.includes(h) ? h : 'terugbellen';
}
function go(r) { if (location.hash === '#/' + r) onRoute(); else location.hash = '#/' + r; }
window.addEventListener('hashchange', onRoute);

async function onRoute() {
  if (!S.me) return render();
  const r = route();
  try {
    if (r === 'gebruikers' && !S.me.rights.manageUsers) return go('terugbellen');
    if (['team', 'cijfers', 'logboek'].includes(r) && !S.me.rights.viewAll) return go('terugbellen');
    if (r === 'verzoek' || r === 'taak') {
      await loadColleagues();
      const edit = S.edit; S.edit = null; S.dup = null;
      if (r === 'verzoek') {
        S.F = newCallbackForm();
        if (edit && edit.kind === 'cb') {
          const c = (await api('/api/callbacks/' + edit.id)).callback;
          Object.assign(S.F, { editId: c.id, type: c.type, company: c.company || '', contact: c.contact || '', name: c.name || '', phone: c.phone || '',
            email: c.email || '', order: c.order || '', category: c.category, priority: c.priority, dueAt: c.dueAt || '', note: c.note || '',
            assign: c.assignee === S.me.id ? 'me' : (c.assignee ? 'colleague' : 'pool'), colleague: c.assignee && c.assignee !== S.me.id ? String(c.assignee) : '' });
        }
      } else {
        S.T = newTaskForm();
        if (edit && edit.kind === 'task') {
          const t = (await api('/api/tasks/' + edit.id)).task;
          const sel = {}; t.assignees.forEach(a => { sel[a.id] = true; });
          Object.assign(S.T, { editId: t.id, title: t.title, desc: t.desc || '', dueAt: t.dueAt || '', priority: t.priority, sel, mode: t.mode, repeat: t.repeat || 'none' });
        }
      }
    }
    await loadRoute();
  } catch (e) { toast(e.message, true); }
  S.quiet = false;
  render();
  window.scrollTo(0, 0);
}

async function loadRoute() {
  const r = route();
  const jobs = [loadCounts()];
  if (r === 'terugbellen') jobs.push(loadCallbacks(), loadColleagues());
  if (r === 'taken') jobs.push(loadTasks());
  if (r === 'team') jobs.push(loadTeam());
  if (r === 'cijfers') jobs.push(loadStats());
  if (r === 'logboek') jobs.push(loadLog(), loadColleagues());
  if (r === 'gebruikers') jobs.push(loadUsers());
  await Promise.all(jobs);
}
async function loadCounts() {
  const [a, b, c] = await Promise.all([api('/api/callbacks?scope=mine'), api('/api/callbacks?scope=pool'), api('/api/tasks?scope=mine')]);
  const openTasks = c.tasks.filter(t => !t.done && !t.mineDone);
  S.counts = { mine: a.callbacks.length, pool: b.callbacks.length, tasks: openTasks.length };
  // meldingen voor nieuw toegewezen werk
  const ids = { cb: a.callbacks.map(x => x.id), task: openTasks.map(x => x.id) };
  if (S.seen && !S.quiet) {
    const newCb = a.callbacks.filter(x => !S.seen.cb.includes(x.id) && x.createdBy !== S.me.id);
    const newTk = openTasks.filter(x => !S.seen.task.includes(x.id) && x.createdBy !== S.me.id);
    if (newCb.length) notify(newCb.length === 1 ? 'Nieuw terugbelverzoek voor jou' : newCb.length + ' nieuwe terugbelverzoeken', newCb.map(cbTitle).join(', '));
    if (newTk.length) notify(newTk.length === 1 ? 'Nieuwe taak voor jou' : newTk.length + ' nieuwe taken', newTk.map(t => t.title).join(', '));
  }
  S.seen = { cb: [...new Set([...(S.seen ? S.seen.cb : []), ...ids.cb])], task: [...new Set([...(S.seen ? S.seen.task : []), ...ids.task])] };
  updateTitle();
}
async function loadColleagues() { S.colleagues = (await api('/api/colleagues')).users; }
async function loadCallbacks() {
  if (S.cbTab === 'all' && !S.me.rights.viewAll) S.cbTab = 'mine';
  S.cbList = (await api('/api/callbacks?scope=' + S.cbTab)).callbacks;
  if (S.cbQ.trim().length >= 2) S.cbResults = (await api('/api/callbacks/search?q=' + encodeURIComponent(S.cbQ.trim()))).results;
  const list = S.cbResults && S.cbQ.trim().length >= 2 ? S.cbResults : S.cbList;
  if (!list.some(c => c.id === S.cbSel)) S.cbSel = list.length ? list[0].id : null;
}
async function loadTasks() {
  if (S.tView === 'all' && !S.me.rights.viewAll) S.tView = 'mine';
  S.tasks = (await api('/api/tasks?scope=' + S.tView)).tasks;
}
async function loadTeam() { S.team = (await api('/api/team')).columns; }
async function loadStats() { S.stats = await api('/api/stats?days=' + S.statDays); }
async function loadLog() {
  const q = new URLSearchParams();
  if (S.logUser) q.set('user', S.logUser);
  if (S.logQ.trim()) q.set('q', S.logQ.trim());
  S.log = await api('/api/log?' + q.toString());
}
async function loadUsers() { const d = await api('/api/admin/users'); S.users = d.users; S.roleDefaults = d.roleDefaults; }

// ---------- render ----------
function render() {
  if (!S.me) { document.title = 'Terugbelsysteem · TheNextGroep BV'; $app.innerHTML = viewLogin(); return; }
  const r = route();
  const views = { terugbellen: viewCallbacks, verzoek: viewCallbackForm, taken: viewTasks, taak: viewTaskForm, team: viewTeam, cijfers: viewStats, logboek: viewLog, gebruikers: viewUsers };
  $app.innerHTML = '<div class="shell">' + viewNav(r) + '<main class="main' + (r === 'team' ? ' wide' : '') + '">' + views[r]() + '</main></div>';
  updateTitle();
}
// opnieuw tekenen zonder de cursor in een zoekveld kwijt te raken
function renderKeepFocus() {
  const a = document.activeElement;
  const id = a && a.id;
  const pos = a && typeof a.selectionStart === 'number' ? a.selectionStart : null;
  render();
  if (id) {
    const el = document.getElementById(id);
    if (el) { el.focus(); if (pos != null) try { el.setSelectionRange(pos, pos); } catch (e) { /* */ } }
  }
}

function viewLogin() {
  return '<div class="login">' +
    '<section class="login-brand">' +
      '<div><div class="brand-name">TheNextGroep <span>BV</span></div><div class="brand-sub">Advies &amp; Ondersteuning</div></div>' +
      '<div><h1>Elke klant teruggebeld. Elke taak een eigenaar.</h1><p>Terugbelverzoeken en taken op één plek, verdeeld over het team.</p></div>' +
      '<div class="spark">' + ICON.spark + '<span>Onderdeel van de <strong>Spark Apps</strong> groep</span></div>' +
    '</section>' +
    '<section class="login-main">' +
      '<form class="login-card" data-form="login" novalidate>' +
        '<div><h2>Inloggen</h2><p class="muted" style="margin:6px 0 0;font-size:14px">Met je naam en persoonlijke code.</p></div>' +
        (S.loginError ? '<div class="alert error" role="alert">' + ICON.alert + '<span>' + esc(S.loginError) + '</span></div>' : '') +
        '<div class="field"><label for="l-name">Naam</label><input class="input" id="l-name" name="name" autocomplete="username" required></div>' +
        '<div class="field"><label for="l-code">Unieke code</label><input class="input" id="l-code" name="code" type="password" inputmode="numeric" autocomplete="current-password" required style="letter-spacing:.2em"></div>' +
        '<button class="btn primary" type="submit">Inloggen</button>' +
        '<div class="hint-box">' + ICON.pin + '<span>Alleen bereikbaar op het netwerk op locatie</span></div>' +
        '<p class="muted small" style="margin:0;text-align:center">Code vergeten? Vraag het aan een beheerder.</p>' +
      '</form>' +
    '</section></div>';
}

function viewNav(r) {
  const active = to => r === to || (to === 'terugbellen' && r === 'verzoek') || (to === 'taken' && r === 'taak');
  const link = (to, label, count) => '<a href="#/' + to + '" class="' + (active(to) ? 'active' : '') + '"' + (active(to) ? ' aria-current="page"' : '') + '><span>' + label + '</span>' +
    (count ? '<span class="nav-count">' + count + '</span>' : '') + '</a>';
  const R = S.me.rights;
  let notifBtn = '';
  if (canSysNotify() && Notification.permission === 'default') notifBtn = '<button class="link-btn" data-act="notif-allow">Pop-upmeldingen aanzetten</button>';
  return '<nav class="nav" aria-label="Hoofdmenu">' +
    '<div class="nav-brand"><div class="brand-name">TheNextGroep <span>BV</span></div><div class="brand-sub">Terugbelsysteem</div></div>' +
    '<div class="nav-links">' +
      link('terugbellen', 'Terugbellen', S.counts.mine) +
      link('taken', 'Mijn taken', S.counts.tasks) +
      (R.viewAll ? '<span class="nav-sep">Teamleiding</span>' + link('team', 'Teambord') + link('cijfers', 'Cijfers') + link('logboek', 'Logboek') : '') +
      (R.manageUsers ? link('gebruikers', 'Gebruikers &amp; rechten') : '') +
    '</div>' +
    '<div class="nav-user"><div class="nav-user-row">' + avatar(S.me.id, S.me.name) +
      '<div><strong style="font-size:13px">' + esc(S.me.name) + '</strong><small>' + (S.me.isAdmin ? 'Hoofdbeheerder' : esc(ROLE_LABELS[S.me.role] || '')) + '</small></div></div>' +
      '<button class="link-btn" data-act="sound" aria-pressed="' + !!prefs.sound + '">' + ICON.bell + ' Geluid bij nieuw werk: ' + (prefs.sound ? 'aan' : 'uit') + '</button>' +
      notifBtn +
      '<button class="link-btn" data-act="logout">Uitloggen</button></div>' +
  '</nav>';
}

// ----- terugbellen -----
function viewCallbacks() {
  const searching = S.cbQ.trim().length >= 2;
  const L = searching ? (S.cbResults || []) : S.cbList;
  const tabs = [['mine', 'Mijn verzoeken', S.counts.mine], ['pool', 'Open pool', S.counts.pool]];
  if (S.me.rights.viewAll) tabs.push(['all', 'Alle open', null]);
  tabs.push(['done', 'Afgerond', null]);
  let html = '<header class="page-head"><div><h1>Terugbellen</h1><p>' + DAYS[new Date().getDay()] + ' ' + new Date().getDate() + ' ' + MONTHS[new Date().getMonth()] + ' · gesorteerd op urgentie</p></div>' +
    '<div class="actions">' + (S.me.rights.create ? '<a class="btn primary" href="#/verzoek">' + ICON.plus + 'Nieuw verzoek</a>' : '') + '</div></header>';

  html += '<div class="search soft"><label class="sr-only" for="cb-q">Klant zoeken</label>' + ICON.search +
    '<input id="cb-q" type="search" data-in="cbq" value="' + esc(S.cbQ) + '" placeholder="Klant zoeken op naam, bedrijf, ordernummer of telefoon…" autocomplete="off">' +
    (S.cbQ ? '<button class="icon-btn small" data-act="cb-clearq" aria-label="Zoekopdracht wissen">' + ICON.x + '</button>' : '') + '</div>';

  if (searching) {
    html += '<div class="section-title"><h2>Zoekresultaten · ' + L.length + '</h2><span class="small muted">Open en afgeronde verzoeken van iedereen</span></div>';
  } else {
    if (S.cbTab === 'mine') {
      html += '<div class="stats">' +
        stat('Te laat', L.filter(c => isLate(c.dueAt)).length, 'var(--red)') +
        stat('Binnen 1 uur', L.filter(c => within(c.dueAt, 60)).length, 'var(--orange)') +
        stat('Open bij jou', L.length) + stat('In de open pool', S.counts.pool, 'var(--blue)') + '</div>';
    }
    html += '<div class="seg" role="group" aria-label="Overzicht">' + tabs.map(t =>
      '<button data-act="cb-tab" data-v="' + t[0] + '" class="' + (S.cbTab === t[0] ? 'on' : '') + '" aria-pressed="' + (S.cbTab === t[0]) + '">' + t[1] +
      (t[2] != null ? '<span class="cnt">' + t[2] + '</span>' : '') + '</button>').join('') + '</div>';
  }
  if (!L.length) {
    const msg = searching ? 'Geen verzoeken gevonden voor “' + esc(S.cbQ) + '”.' : { mine: 'Je hebt geen open terugbelverzoeken. Lekker bezig!', pool: 'De open pool is leeg.', all: 'Er staan geen open verzoeken.', done: 'Nog niets afgerond.' }[S.cbTab];
    return html + '<div class="empty">' + msg + '</div>';
  }
  html += '<div class="split"><div class="list">' + L.map(c => {
    const showWho = searching || S.cbTab !== 'mine';
    const who = showWho ? (c.assigneeName ? 'Bij ' + c.assigneeName : 'In de open pool') : '';
    const tries = (c.attempts || []).filter(a => !/^Afgerond/.test(a.text)).length;
    const meta = [who, c.status === 'done' ? '' : (tries ? 'Poging ' + tries : 'Nog niet gebeld'), 'door ' + c.createdByName].filter(Boolean).join(' · ');
    const badge = c.status === 'done' ? '<span class="badge green">Afgerond ' + esc(fmtDate(c.doneAt)) + '</span>' : dueBadge(c.dueAt, 'bel');
    return '<button class="item' + (c.id === S.cbSel ? ' sel' : '') + '" data-act="cb-sel" data-id="' + c.id + '">' +
      '<span class="item-top">' + badge + '<span class="item-meta">' + esc(c.category) + (c.priority === 'hoog' ? ' · <strong style="color:var(--red)">Hoog</strong>' : '') + '</span></span>' +
      '<span class="item-title">' + esc(cbTitle(c)) + '</span>' +
      '<span class="item-sub">' + (c.contact ? 't.a.v. ' + esc(c.contact) + ' · ' : '') + 'Order ' + esc(c.order) + ' · ' + esc(c.phone) + '</span>' +
      '<span class="item-meta">' + esc(meta) + '</span></button>';
  }).join('') + '</div>';
  const sel = L.find(c => c.id === S.cbSel);
  html += '<aside class="detail card">' + (sel ? viewCallbackDetail(sel) : '') + '</aside></div>';
  return html;
}
function stat(label, n, color) {
  return '<div class="stat"><span>' + label + '</span><strong' + (color ? ' style="color:' + color + '"' : '') + '>' + n + '</strong></div>';
}
function dd(label, val) { return '<div><dt>' + label + '</dt><dd>' + esc(val) + '</dd></div>'; }
function viewCallbackDetail(c) {
  const isDone = c.status === 'done';
  const tries = (c.attempts || []).filter(a => !/^Afgerond/.test(a.text)).length;
  const canEdit = canEditCb(c);
  let h = '<div style="display:flex;flex-direction:column;gap:18px">' +
    '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><div style="margin-bottom:6px">' +
    (isDone ? '<span class="badge green">Afgerond door ' + esc(c.doneByName) + '</span>' : dueBadge(c.dueAt, 'bel')) +
    (c.priority === 'hoog' ? ' <span class="badge red">Hoge prioriteit</span>' : '') + '</div>' +
    '<h2 style="margin:0;font-size:22px">' + esc(cbTitle(c)) + '</h2></div>' +
    (canEdit ? '<button class="btn small" data-act="cb-edit" data-id="' + c.id + '">' + ICON.edit + 'Bewerken</button>' : '') + '</div>' +
    '<dl class="dl">' +
      (c.type === 'zakelijk' ? dd('Contactpersoon', c.contact || '–') : dd('Soort', 'Particulier')) +
      '<div><dt>Telefoon</dt><dd><a href="tel:' + esc(String(c.phone).replace(/[^\d+]/g, '')) + '">' + esc(c.phone) + '</a></dd></div>' +
      dd('Ordernummer', c.order) + dd('Categorie', c.category) +
      (c.email ? '<div class="full"><dt>E-mail</dt><dd><a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a></dd></div>' : '') +
      dd('Toegewezen aan', c.assigneeName || 'Open pool') + dd('Aangemaakt', fmtDate(c.createdAt) + ' door ' + c.createdByName) +
      (c.note ? '<div class="full"><dt>Reden / notitie</dt><dd>' + esc(c.note) + '</dd></div>' : '') +
    '</dl>';
  if (c.attempts && c.attempts.length) {
    h += '<div class="detail-section"><span class="legend">Belpogingen &amp; notities</span><div class="attempts">' +
      c.attempts.map(a => '<div><time>' + esc(fmtDate(a.at)) + '</time><span>' + esc(a.text) + ' <span class="muted">· ' + esc(a.byName) + '</span></span></div>').join('') + '</div></div>';
  }
  if (!isDone && tries >= 3) h += '<div class="alert info"><span><strong>3x niet bereikt</strong>Stuur de klant een mail of sms, of zet het verzoek terug in de pool.</span></div>';
  if (isDone) return h + '<div class="detail-section"><button class="btn" data-act="cb-reopen" data-id="' + c.id + '">Weer openzetten</button></div></div>';
  if (!c.assigneeName) h += '<div class="detail-section"><button class="btn primary" data-act="cb-claim" data-id="' + c.id + '">Pak ik op</button></div>';
  h += '<div class="detail-section">' +
    '<label class="legend" for="cb-note">Notitie bij dit gesprek <small>(optioneel)</small></label>' +
    '<div class="chips" role="group" aria-label="Snelnotities">' + QUICK_NOTES.map(q => '<button type="button" class="chip quick" data-act="cb-quick" data-v="' + esc(q) + '">' + esc(q) + '</button>').join('') + '</div>' +
    '<input class="input" id="cb-note" placeholder="Typ een notitie of kies hierboven">' +
    '<div class="grid2"><button class="btn green" data-act="cb-done" data-id="' + c.id + '">Gebeld, afgerond</button>' +
    '<button class="btn" data-act="cb-attempt" data-id="' + c.id + '">Niet bereikt</button></div></div>';
  if (S.me.rights.assign) {
    h += '<div class="detail-section"><label class="legend" for="cb-assign">Toewijzen aan collega</label><div class="row">' +
      '<select class="input" id="cb-assign">' +
      S.colleagues.map(u => '<option value="' + u.id + '"' + (u.id === c.assignee ? ' selected' : '') + '>' + esc(u.id === S.me.id ? 'Ikzelf' : u.name) + ' (' + u.open + ' open)</option>').join('') +
      '<option value="pool"' + (!c.assignee ? ' selected' : '') + '>Terug naar open pool</option></select>' +
      '<button class="btn dark" data-act="cb-assign" data-id="' + c.id + '">Wijs toe</button></div></div>';
  } else if (c.assignee === S.me.id) {
    h += '<div class="detail-section"><button class="btn" data-act="cb-topool" data-id="' + c.id + '">Terug naar open pool</button></div>';
  }
  return h + '</div>';
}

// ----- verzoek (nieuw / bewerken) -----
function newCallbackForm() {
  return { editId: null, type: 'zakelijk', company: '', contact: '', name: '', phone: '', email: '', order: '', category: CATEGORIES[0], priority: 'normaal',
    dueAt: defaultDue(2), note: '', assign: 'me', colleague: '', tried: false, serverError: null, saving: false };
}
function cbMissing(F) {
  const m = {};
  if (F.type === 'zakelijk' && !F.company.trim()) m.company = 'Bedrijfsnaam is verplicht';
  if (F.type === 'particulier' && !F.name.trim()) m.name = 'Naam is verplicht';
  if (!F.phone.trim()) m.phone = 'Telefoonnummer is verplicht';
  if (!F.order.trim()) m.order = 'Ordernummer is verplicht';
  if (F.assign === 'colleague' && !F.colleague) m.colleague = 'Kies een collega';
  return m;
}
function inputField(id, label, F, key, opts) {
  opts = opts || {};
  const err = F.tried && opts.errors && opts.errors[key];
  return '<div class="field' + (opts.span ? ' span2' : '') + '"><label for="' + id + '">' + label + (opts.req ? ' *' : '') + '</label>' +
    '<input class="input' + (err ? ' bad' : '') + '" id="' + id + '" data-f="' + key + '" type="' + (opts.type || 'text') + '" value="' + esc(F[key]) + '" placeholder="' + esc(opts.ph || '') + '"' + (err ? ' aria-invalid="true"' : '') + ' autocomplete="off">' +
    (err ? '<span class="err-text">' + esc(err) + '</span>' : '') + '</div>';
}
function viewDup() {
  if (!S.dup || !S.dup.length) return '';
  return '<div class="alert warn" role="status">' + ICON.warn + '<span><strong>Er staat al een open verzoek voor deze klant</strong>' +
    S.dup.map(d => esc(d.title) + ' · order ' + esc(d.order) + ' · ' + (d.assigneeName ? 'bij ' + esc(d.assigneeName) : 'in de open pool') +
      (d.dueAt ? ' · bel vóór ' + esc(fmtDate(d.dueAt)) : '') + ' <span class="small">(zelfde ' + [d.sameOrder ? 'ordernummer' : '', d.samePhone ? 'telefoonnummer' : ''].filter(Boolean).join(' en ') + ')</span>').join('<br>') +
    '<br><span class="small">Check eerst of je dit verzoek nog nodig hebt, zodat de klant niet twee keer gebeld wordt.</span></span></div>';
}
function viewCallbackForm() {
  const F = S.F;
  const edit = !!F.editId;
  const errors = cbMissing(F);
  const errList = Object.keys(errors);
  const names = { company: 'bedrijfsnaam', name: 'naam', phone: 'telefoonnummer', order: 'ordernummer', colleague: 'collega' };
  let h = '<div class="card form" style="align-self:center">' +
    '<div><h1 style="margin:0;font-size:26px">' + (edit ? 'Verzoek bewerken' : 'Nieuw terugbelverzoek') + '</h1><p class="muted" style="margin:4px 0 0;font-size:14px">' +
    (edit ? 'Pas aan wat er niet klopt. Wijzigingen komen in het logboek.' : 'Vul in tijdens of direct na het gesprek.') + ' Velden met * zijn verplicht.</p></div>';
  if (F.tried && errList.length) h += '<div class="alert error" role="alert">' + ICON.alert + '<span><strong>Niet alle verplichte velden zijn ingevuld</strong>Vul nog in: ' + errList.map(k => names[k]).join(', ') + '.</span></div>';
  else if (F.serverError) h += '<div class="alert error" role="alert">' + ICON.alert + '<span>' + esc(F.serverError) + '</span></div>';
  h += '<div class="field"><span class="legend">Soort klant *</span><div class="row">' +
    '<button type="button" class="btn' + (F.type === 'particulier' ? ' on' : '') + '" data-act="f-type" data-v="particulier" aria-pressed="' + (F.type === 'particulier') + '">Particulier</button>' +
    '<button type="button" class="btn' + (F.type === 'zakelijk' ? ' on' : '') + '" data-act="f-type" data-v="zakelijk" aria-pressed="' + (F.type === 'zakelijk') + '">Zakelijk</button></div></div>';
  h += '<div class="fields2">' +
    (F.type === 'zakelijk'
      ? inputField('f-company', 'Bedrijfsnaam', F, 'company', { req: 1, errors, ph: 'Bijv. Beeldwerk Media BV' }) + inputField('f-contact', 'Contactpersoon', F, 'contact', { ph: 'optioneel' })
      : inputField('f-name', 'Naam', F, 'name', { req: 1, errors, ph: 'Voor- en achternaam', span: 1 })) +
    inputField('f-phone', 'Telefoonnummer', F, 'phone', { req: 1, errors, type: 'tel', ph: '06 …' }) +
    inputField('f-order', 'Ordernummer', F, 'order', { req: 1, errors, ph: 'Bijv. 123456' }) +
    '<div class="span2" id="dup">' + viewDup() + '</div>' +
    inputField('f-email', 'E-mail', F, 'email', { type: 'email', ph: 'optioneel', span: 1 }) +
  '</div>';
  h += '<div class="fields3">' +
    '<div class="field"><label for="f-cat">Categorie</label><select class="input" id="f-cat" data-f="category">' + CATEGORIES.map(c => '<option' + (F.category === c ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></div>' +
    '<div class="field"><label for="f-prio">Prioriteit</label><select class="input" id="f-prio" data-f="priority">' + ['normaal', 'hoog', 'laag'].map(p => '<option value="' + p + '"' + (F.priority === p ? ' selected' : '') + '>' + p[0].toUpperCase() + p.slice(1) + '</option>').join('') + '</select></div>' +
    '<div class="field"><label for="f-due">Bel vóór</label><input class="input" id="f-due" type="datetime-local" data-f="dueAt" value="' + esc(F.dueAt) + '"></div>' +
  '</div>';
  h += '<div class="field"><label for="f-note">Reden / notitie</label><textarea class="input" id="f-note" data-f="note" rows="3" placeholder="Waar gaat het over?">' + esc(F.note) + '</textarea></div>';
  const can = S.me.rights.assign;
  const opt = (v, label) => '<button type="button" class="btn' + (F.assign === v ? ' on' : '') + '" data-act="f-assign" data-v="' + v + '" aria-pressed="' + (F.assign === v) + '">' + label + '</button>';
  h += '<fieldset class="box' + (F.tried && errors.colleague ? ' bad' : '') + '" style="margin:0"><legend class="legend" style="padding:0 6px">Wie belt terug?</legend><div class="row">' +
    opt('me', 'Ikzelf') + (can ? opt('colleague', 'Collega') : '') + opt('pool', 'Open pool') + (can && !edit ? opt('auto', 'Automatisch verdelen') : '') + '</div>';
  if (F.assign === 'colleague') {
    h += '<div class="field"><label for="f-coll">Collega</label><select class="input' + (F.tried && errors.colleague ? ' bad' : '') + '" id="f-coll" data-f="colleague"><option value="">Kies een collega…</option>' +
      S.colleagues.filter(u => u.id !== S.me.id).map(u => '<option value="' + u.id + '"' + (String(F.colleague) === String(u.id) ? ' selected' : '') + '>' + esc(u.name) + ' (' + u.open + ' open)</option>').join('') + '</select></div>';
  }
  if (F.assign === 'auto') h += '<p class="muted small" style="margin:0">Gaat naar de collega met de minste openstaande verzoeken en taken.</p>';
  h += '</fieldset>';
  h += '<div class="form-foot">' +
    (edit && S.me.rights.deleteItems ? '<button class="btn danger" data-act="f-delete" style="margin-right:auto">' + ICON.trash + 'Verwijderen</button>' : '') +
    '<a class="btn" href="#/terugbellen">Annuleren</a><button class="btn primary" data-act="f-save"' + (F.saving ? ' disabled' : '') + '>' + (edit ? 'Wijzigingen opslaan' : 'Verzoek opslaan') + '</button></div></div>';
  return h;
}

// ----- taken -----
function viewTasks() {
  const all = S.tView === 'all';
  let h = '<header class="page-head" style="max-width:920px"><div><h1>' + (all ? 'Alle taken' : 'Mijn taken') + '</h1><p>' +
    (all ? 'Alle taken van het team.' : 'Wat je nog moet doen, ook taken die je met collega’s deelt.') + '</p></div>' +
    '<div class="actions"><button class="btn' + (S.searchOpen ? ' on' : '') + '" data-act="t-search" aria-expanded="' + S.searchOpen + '">' + ICON.search + 'Bestaat deze taak al?</button>' +
    (S.me.rights.create ? '<a class="btn primary" href="#/taak">' + ICON.plus + 'Nieuwe taak</a>' : '') + '</div></header>';
  if (S.me.rights.viewAll) {
    h += '<div class="seg" role="group" aria-label="Weergave">' +
      '<button data-act="t-view" data-v="mine" class="' + (!all ? 'on' : '') + '" aria-pressed="' + !all + '">Mijn taken</button>' +
      '<button data-act="t-view" data-v="all" class="' + (all ? 'on' : '') + '" aria-pressed="' + all + '">Alle taken</button></div>';
  }
  if (S.searchOpen) h += viewSearch();
  return h + (all ? viewAllTasks() : viewMyTasks());
}
function viewSearch() {
  return '<section class="card stack" style="gap:14px;padding:20px" aria-label="Controleer of een taak al bestaat">' +
    '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><h2 style="margin:0;font-size:16px">Controleer of deze taak al bestaat</h2>' +
    '<p class="muted" style="margin:2px 0 0;font-size:13px">Zoekt in alle taken van het team, ook die van anderen en wat al af is.</p></div>' +
    '<button class="icon-btn" data-act="t-search" aria-label="Sluiten">' + ICON.x + '</button></div>' +
    '<label class="sr-only" for="t-q">Zoek in alle taken</label>' +
    '<div class="search">' + ICON.search + '<input id="t-q" type="search" data-in="q" value="' + esc(S.q) + '" placeholder="Bijv. retour 482913, prijslijst, showroom…" autocomplete="off"></div>' +
    '<div id="search-results">' + viewResults() + '</div></section>';
}
function viewResults() {
  if (S.results == null) return '<p class="muted small" style="margin:0">Typ minstens 3 letters. Je hoeft niet de precieze woorden te gebruiken.</p>';
  if (!S.results.length) {
    return '<div class="alert ok" style="justify-content:space-between;flex-wrap:wrap"><span style="display:flex;gap:10px;align-items:center">' + ICON.check +
      '<span><strong style="display:inline">Niets gevonden.</strong> Deze taak bestaat nog niet.</span></span>' +
      (S.me.rights.create ? '<a class="btn green" href="#/taak">Nu aanmaken</a>' : '') + '</div>';
  }
  return '<div class="stack" style="gap:8px"><span class="small" style="font-weight:600;color:var(--orange)">Let op: ' + S.results.length + ' ' + (S.results.length === 1 ? 'taak lijkt' : 'taken lijken') + ' hierop. Check deze eerst.</span>' +
    S.results.map(r => '<div class="result"><div style="flex:1 1 280px;min-width:0;display:flex;flex-direction:column;gap:4px">' +
      '<div class="row" style="align-items:center"><span class="badge ' + (r.strong ? 'red' : 'orange') + '">' + (r.strong ? 'Sterke match' : 'Lijkt erop') + '</span><span class="item-title" style="font-size:15px">' + esc(r.title) + '</span></div>' +
      '<span class="item-sub">' + esc(r.desc || 'Geen omschrijving') + '</span></div>' +
      '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px"><span class="badge ' + (r.done ? 'green' : 'blue') + '">' + (r.done ? 'Afgerond' : 'Open') + (r.dueAt ? ' · ' + esc(fmtDate(r.dueAt)) : '') + '</span>' +
      '<span class="small muted">Voor ' + esc(r.assignees.join(', ')) + '</span></div></div>').join('') + '</div>';
}
function peopleStack(t) { return '<span class="people">' + t.assignees.map(a => avatar(a.id, a.name, 'sm')).join('') + '</span>'; }
function taskMeta(t) {
  const by = t.createdBy === S.me.id ? 'door jou' : 'van ' + t.createdByName;
  const parts = [];
  if (t.assignees.length > 1) parts.push(t.mode === 'een' ? 'Gedeeld · klaar zodra één persoon afvinkt' : 'Iedereen vinkt af · ' + t.doneCount + ' van ' + t.assignees.length + ' klaar');
  parts.push(by);
  return esc(parts.join(' · ')) + (t.repeat && t.repeat !== 'none' ? ' · <span class="repeat">' + ICON.repeat + ' ' + esc(REPEATS[t.repeat]) + '</span>' : '');
}
function editBtn(t) { return canEditTask(t) ? '<button class="btn small ghost" data-act="t-edit" data-id="' + t.id + '" aria-label="' + esc(t.title) + ' bewerken">' + ICON.edit + 'Bewerken</button>' : ''; }
function viewMyTasks() {
  const live = S.tasks.filter(t => !t.archived);
  const open = live.filter(t => !t.done && !t.mineDone);
  const done = live.filter(t => t.done || t.mineDone);
  const arch = S.tasks.filter(t => t.archived);
  let h = '<section class="stack"><div class="section-title"><h2>Te doen · ' + open.length + '</h2></div>';
  h += open.length ? open.map(t =>
    '<article class="task"><input type="checkbox" data-act="t-toggle" data-id="' + t.id + '" aria-label="' + esc(t.title) + ' afvinken">' +
    '<div class="task-body"><div class="item-top"><span class="item-title">' + esc(t.title) + (t.priority === 'hoog' ? ' <span class="badge red">Hoog</span>' : '') + '</span>' + dueBadge(t.dueAt, 'taak') + '</div>' +
    (t.desc ? '<span class="item-sub" style="white-space:pre-wrap">' + esc(t.desc) + '</span>' : '') +
    '<div class="row" style="align-items:center;gap:12px">' + peopleStack(t) + '<span class="item-meta" style="padding-left:6px;flex:1">' + taskMeta(t) + '</span>' + editBtn(t) + '</div></div></article>').join('')
    : '<div class="empty">Niets meer te doen. Top!</div>';
  h += '</section><section class="stack"><div class="section-title"><h2>Afgerond · ' + done.length + '</h2>' +
    (done.length ? '<button class="btn small" data-act="t-archive-all">' + ICON.box + 'Alles archiveren</button>' : '') + '</div>';
  h += done.map(t => {
    let meta;
    if (!t.done && t.mineDone) meta = 'Jij klaar · wacht op anderen (' + t.doneCount + '/' + t.assignees.length + ')';
    else if (t.mineDone) meta = 'Afgerond';
    else meta = 'Afgerond door ' + t.assignees.filter(a => a.done).map(a => a.name).join(', ');
    return '<article class="task done"><input type="checkbox" checked data-act="t-toggle" data-id="' + t.id + '"' + (t.mineDone ? '' : ' disabled') + ' aria-label="' + esc(t.title) + ' weer openzetten">' +
      '<span class="item-title" style="flex:1 1 200px;min-width:0">' + esc(t.title) + '</span><span class="item-meta">' + esc(meta) + '</span>' +
      '<button class="btn small ghost" data-act="t-archive" data-id="' + t.id + '">' + ICON.box + 'Archiveren</button></article>';
  }).join('');
  h += '</section><section class="stack"><button class="btn ghost" style="align-self:flex-start" data-act="t-archive-toggle" aria-expanded="' + S.showArchive + '">' + ICON.box +
    (S.showArchive ? 'Archief verbergen' : 'Archief bekijken') + ' (' + arch.length + ')</button>';
  if (S.showArchive) {
    h += arch.length ? arch.map(t => '<article class="task archived"><span style="flex:1 1 200px;min-width:0;color:var(--muted)">' + esc(t.title) + '</span><span class="item-meta">Gearchiveerd</span>' +
      '<button class="btn small" data-act="t-restore" data-id="' + t.id + '">Terugzetten</button></article>').join('')
      : '<p class="muted small" style="margin:0">Het archief is leeg. Archiveer afgeronde taken om je lijst opgeruimd te houden.</p>';
  }
  return h + '</section>';
}
function viewAllTasks() {
  const people = {};
  S.tasks.forEach(t => t.assignees.forEach(a => { people[a.id] = a.name; }));
  const filtered = S.tasks.filter(t => S.tWho === 'ALL' || t.assignees.some(a => String(a.id) === String(S.tWho)));
  const open = filtered.filter(t => !t.done);
  const done = filtered.filter(t => t.done);
  let h = '<section class="stack" style="gap:14px"><div class="chips"><span class="muted small">Toon van:</span>' +
    '<button class="chip' + (S.tWho === 'ALL' ? ' on' : '') + '" data-act="t-who" data-v="ALL">Iedereen</button>' +
    Object.keys(people).map(id => '<button class="chip' + (String(S.tWho) === id ? ' on' : '') + '" data-act="t-who" data-v="' + id + '">' + esc(+id === S.me.id ? 'Jij' : people[id]) + '</button>').join('') + '</div>';
  h += '<div class="section-title"><h2>Open · ' + open.length + '</h2></div>';
  h += open.length ? open.map(t => '<article class="task" style="align-items:center;flex-wrap:wrap">' + peopleStack(t) +
    '<div class="task-body" style="flex:1 1 260px;padding-left:6px"><span class="item-title" style="font-size:15px">' + esc(t.title) + '</span>' +
    '<span class="item-meta">Voor ' + esc(t.assignees.map(a => a.id === S.me.id ? 'jij' : a.name).join(', ')) +
    (t.assignees.length > 1 && t.mode === 'iedereen' ? ' · ' + t.doneCount + '/' + t.assignees.length + ' klaar' : '') + ' · van ' + esc(t.createdByName) +
    (t.repeat && t.repeat !== 'none' ? ' · <span class="repeat">' + ICON.repeat + ' ' + esc(REPEATS[t.repeat]) + '</span>' : '') + '</span></div>' +
    dueBadge(t.dueAt, 'taak') + editBtn(t) + '</article>').join('') : '<div class="empty">Geen open taken.</div>';
  h += '<div class="section-title" style="margin-top:8px"><h2>Afgerond · ' + done.length + '</h2></div>';
  h += done.map(t => '<article class="task done"><span class="item-title" style="flex:1 1 260px;min-width:0">' + esc(t.title) + '</span>' +
    '<span class="item-meta">Voor ' + esc(t.assignees.map(a => a.name).join(', ')) + '</span></article>').join('');
  return h + '</section>';
}

// ----- taak (nieuw / bewerken) -----
function newTaskForm() {
  return { editId: null, title: '', desc: '', dueAt: '', priority: 'normaal', sel: S.me.rights.assign ? {} : { [S.me.id]: true }, mode: 'een', repeat: 'none',
    tried: false, serverError: null, similar: null, saving: false };
}
function taskErrors(T) {
  const e = {};
  if (!T.title.trim()) e.title = 'Geef de taak een titel';
  if (!Object.keys(T.sel).some(k => T.sel[k])) e.people = 'Kies minstens één persoon';
  if (T.repeat !== 'none' && !T.dueAt) e.dueAt = 'Kies een deadline, dan weet het systeem wanneer de herhaling moet komen';
  return e;
}
function viewTaskForm() {
  const T = S.T;
  const edit = !!T.editId;
  const chosen = Object.keys(T.sel).filter(k => T.sel[k]);
  const errors = taskErrors(T);
  const errNames = { title: 'titel', people: 'voor wie', dueAt: 'deadline' };
  let h = '<div class="card form" style="align-self:center">' +
    '<div><h1 style="margin:0;font-size:26px">' + (edit ? 'Taak bewerken' : 'Nieuwe taak') + '</h1><p class="muted" style="margin:4px 0 0;font-size:14px">' +
    (edit ? 'Pas de taak aan. Wie al had afgevinkt, blijft afgevinkt.' : 'Geef een taak aan jezelf, één collega of meerdere tegelijk.') + ' Velden met * zijn verplicht.</p></div>';
  if (T.tried && Object.keys(errors).length) h += '<div class="alert error" role="alert">' + ICON.alert + '<span><strong>Niet alle verplichte velden zijn ingevuld</strong>Vul nog in: ' + Object.keys(errors).map(k => errNames[k]).join(', ') + '.</span></div>';
  else if (T.serverError) h += '<div class="alert error" role="alert">' + ICON.alert + '<span>' + esc(T.serverError) + '</span></div>';
  const tErr = T.tried && errors.title;
  h += '<div class="field"><label for="t-title">Wat moet er gebeuren? *</label><input class="input' + (tErr ? ' bad' : '') + '" id="t-title" data-t="title" value="' + esc(T.title) + '" placeholder="Bijv. Showroom opruimen voor sluiting" autocomplete="off">' +
    (tErr ? '<span class="err-text">' + errors.title + '</span>' : '') + '<div id="similar">' + viewSimilar() + '</div></div>';
  h += '<div class="field"><label for="t-desc">Omschrijving</label><textarea class="input" id="t-desc" data-t="desc" rows="3" placeholder="optioneel: extra uitleg, ordernummer, waar het ligt…">' + esc(T.desc) + '</textarea></div>';
  const dErr = T.tried && errors.dueAt;
  h += '<div class="fields3"><div class="field"><label for="t-due">Deadline' + (T.repeat !== 'none' ? ' *' : '') + '</label><input class="input' + (dErr ? ' bad' : '') + '" id="t-due" type="datetime-local" data-t="dueAt" value="' + esc(T.dueAt) + '">' +
    (dErr ? '<span class="err-text">' + errors.dueAt + '</span>' : '') + '</div>' +
    '<div class="field"><label for="t-prio">Prioriteit</label><select class="input" id="t-prio" data-t="priority">' + ['normaal', 'hoog', 'laag'].map(p => '<option value="' + p + '"' + (T.priority === p ? ' selected' : '') + '>' + p[0].toUpperCase() + p.slice(1) + '</option>').join('') + '</select></div>' +
    '<div class="field"><label for="t-rep">Herhalen</label><select class="input" id="t-rep" data-t="repeat" data-rerender="1">' + Object.keys(REPEATS).map(k => '<option value="' + k + '"' + (T.repeat === k ? ' selected' : '') + '>' + REPEATS[k] + '</option>').join('') + '</select></div></div>';
  if (T.repeat !== 'none') h += '<p class="small muted" style="margin:-10px 0 0">' + ICON.repeat + ' Zodra de taak klaar is, staat de volgende automatisch klaar voor dezelfde mensen (' + esc(REPEATS[T.repeat].toLowerCase()) + ', zelfde tijd).</p>';
  const can = S.me.rights.assign;
  const pErr = T.tried && errors.people;
  const list = can ? S.colleagues : S.colleagues.filter(u => u.id === S.me.id);
  const allOn = can && list.length && list.every(u => T.sel[u.id]);
  h += '<fieldset class="box' + (pErr ? ' bad' : '') + '" style="margin:0"><legend class="legend" style="padding:0 6px">Voor wie? *' + (can ? ' <small>(meerdere mogelijk)</small>' : '') + '</legend><div class="row">' +
    list.slice().sort((a, b) => (b.id === S.me.id) - (a.id === S.me.id)).map(u =>
      '<button type="button" class="person-chip' + (T.sel[u.id] ? ' on' : '') + '" data-act="t-person" data-id="' + u.id + '" aria-pressed="' + !!T.sel[u.id] + '">' +
      avatar(u.id, u.name) + esc(u.id === S.me.id ? 'Ikzelf' : u.name) + ' · ' + u.open + ' open</button>').join('') +
    (can ? '<button type="button" class="chip" style="border-style:dashed;min-height:44px" data-act="t-allpeople">' + (allOn ? 'Niemand' : 'Hele team') + '</button>' : '') + '</div>' +
    (pErr ? '<span class="err-text">' + errors.people + '</span>' : '');
  if (chosen.length > 1) {
    h += '<div style="display:flex;flex-direction:column;gap:8px;padding-top:12px;border-top:1px solid var(--line)"><span class="legend">Wanneer is de taak klaar?</span><div class="mode-choice">' +
      '<button type="button" class="' + (T.mode === 'een' ? 'on' : '') + '" data-act="t-mode" data-v="een" aria-pressed="' + (T.mode === 'een') + '"><strong>Zodra één persoon afvinkt</strong><small>Wie het eerst kan, pakt het op</small></button>' +
      '<button type="button" class="' + (T.mode === 'iedereen' ? 'on' : '') + '" data-act="t-mode" data-v="iedereen" aria-pressed="' + (T.mode === 'iedereen') + '"><strong>Pas als iedereen afvinkt</strong><small>Bijv. iets wat iedereen moet lezen</small></button></div></div>';
  }
  h += '</fieldset><div class="form-foot">' +
    (edit && S.me.rights.deleteItems ? '<button class="btn danger" data-act="t-delete" style="margin-right:auto">' + ICON.trash + 'Verwijderen</button>' : '') +
    '<a class="btn" href="#/taken">Annuleren</a><button class="btn primary" data-act="t-save"' + (T.saving ? ' disabled' : '') + '>' + (edit ? 'Wijzigingen opslaan' : 'Taak aanmaken') + '</button></div></div>';
  return h;
}
function viewSimilar() {
  const T = S.T;
  if (!T || !T.similar || !T.similar.length) return '';
  const open = T.similar.filter(r => !r.done && r.id !== T.editId).slice(0, 3);
  if (!open.length) return '';
  return '<div class="alert info" style="margin-top:6px"><span><strong>Lijkt op een bestaande taak</strong>' +
    open.map(r => esc(r.title) + ' <span class="small">(voor ' + esc(r.assignees.join(', ')) + ')</span>').join('<br>') + '</span></div>';
}

// ----- teambord -----
function viewTeam() {
  const cols = S.team || [];
  let h = '<header class="page-head"><div><h1>Teambord</h1><p>Wat er bij wie open staat. Sleep een terugbelverzoek naar een andere kolom om het te verplaatsen.</p></div>' +
    '<div class="actions"><button class="btn" data-act="team-refresh">Verversen</button></div></header>';
  const totLate = cols.reduce((n, c) => n + c.callbacks.filter(x => isLate(x.dueAt)).length, 0);
  const totOpen = cols.reduce((n, c) => n + c.callbacks.length, 0);
  h += '<div class="stats">' + stat('Open verzoeken', totOpen) + stat('Te laat', totLate, 'var(--red)') + stat('In de open pool', cols[0] ? cols[0].callbacks.length : 0, 'var(--blue)') +
    stat('Open taken', cols.reduce((n, c) => n + c.tasks.length, 0)) + '</div>';
  h += '<div class="board" role="list">' + cols.map(col => {
    const key = col.user ? String(col.user.id) : 'pool';
    const late = col.callbacks.filter(x => isLate(x.dueAt)).length;
    const load = col.callbacks.length + col.tasks.length;
    return '<section class="col" role="listitem" data-drop="' + key + '" aria-label="' + esc(col.user ? col.user.name : 'Open pool') + '">' +
      '<header class="col-head">' + (col.user ? avatar(col.user.id, col.user.name) : '<span class="avatar" style="background:#1D4ED8">P</span>') +
      '<div style="flex:1;min-width:0"><strong>' + esc(col.user ? (col.user.id === S.me.id ? col.user.name + ' (jij)' : col.user.name) : 'Open pool') + '</strong>' +
      '<small>' + col.callbacks.length + ' verzoek' + (col.callbacks.length === 1 ? '' : 'en') + (col.user ? ' · ' + col.tasks.length + ' taak/taken' : '') + '</small></div>' +
      (late ? '<span class="badge red">' + late + ' te laat</span>' : (col.user && load >= 8 ? '<span class="badge orange">Druk</span>' : '')) + '</header>' +
      '<div class="col-body">' +
      (col.callbacks.length ? col.callbacks.map(c => '<article class="mini" draggable="true" data-drag="' + c.id + '" tabindex="0" data-act="team-open" data-id="' + c.id + '" aria-label="' + esc(cbTitle(c)) + ', sleep naar een kolom of druk Enter om te openen">' +
        '<div class="item-top">' + dueBadge(c.dueAt, 'bel') + (c.priority === 'hoog' ? '<span class="badge red">Hoog</span>' : '') + '</div>' +
        '<strong>' + esc(cbTitle(c)) + '</strong><span class="small muted">Order ' + esc(c.order) + ' · ' + esc(c.category) + '</span></article>').join('')
        : '<p class="small muted" style="margin:4px 2px">Geen open verzoeken</p>') +
      (col.tasks.length ? '<div class="col-tasks"><span class="small" style="font-weight:600;color:var(--ink-2)">Taken</span>' +
        col.tasks.map(t => '<div class="mini-task"><span>' + esc(t.title) + '</span>' + (t.dueAt ? dueBadge(t.dueAt, 'taak') : '') + '</div>').join('') + '</div>' : '') +
      '</div></section>';
  }).join('') + '</div>';
  return h;
}

// ----- cijfers -----
function viewStats() {
  const s = S.stats;
  let h = '<header class="page-head"><div><h1>Cijfers</h1><p>Hoe het team ervoor staat met terugbellen.</p></div></header>' +
    '<div class="seg" role="group" aria-label="Periode">' + [7, 30, 90].map(d => '<button data-act="stat-days" data-v="' + d + '" class="' + (S.statDays === d ? 'on' : '') + '" aria-pressed="' + (S.statDays === d) + '">Laatste ' + d + ' dagen</button>').join('') + '</div>';
  if (!s) return h;
  const T = s.totals;
  h += '<div class="stats">' +
    stat('Verzoeken binnengekomen', T.created) + stat('Afgerond', T.done, 'var(--green)') +
    stat('Gemiddeld tot teruggebeld', humanMin(T.avgMin)) + stat('Te laat afgerond', T.latePct == null ? '–' : T.latePct + '%', T.latePct > 20 ? 'var(--red)' : null) + '</div>';
  h += '<div class="stats">' + stat('Nu open', T.openNow) + stat('Nu te laat', T.lateNow, 'var(--red)') + stat('Nu in de pool', T.poolNow, 'var(--blue)') + '<div class="stat" aria-hidden="true" style="visibility:hidden"></div></div>';
  const max = Math.max(1, ...s.perDay.map(d => Math.max(d.created, d.done)));
  const showEvery = s.days > 30 ? 7 : (s.days > 7 ? 3 : 1);
  h += '<section class="card"><div class="section-title" style="margin-bottom:12px"><h2>Per dag</h2><span class="legend-row"><span class="dot blue"></span>Binnengekomen <span class="dot green"></span>Afgerond</span></div>' +
    '<div class="chart" role="img" aria-label="Verzoeken per dag: binnengekomen en afgerond">' + s.perDay.map((d, i) => {
      const dt = new Date(d.date + 'T12:00');
      return '<div class="bar-group" title="' + esc(DAYS[dt.getDay()] + ' ' + dt.getDate() + ' ' + MONTHS[dt.getMonth()] + ': ' + d.created + ' binnen, ' + d.done + ' afgerond') + '">' +
        '<div class="bars"><span class="bar blue" style="height:' + (d.created / max * 100) + '%"></span><span class="bar green" style="height:' + (d.done / max * 100) + '%"></span></div>' +
        '<span class="bar-label">' + (i % showEvery === 0 ? dt.getDate() + ' ' + MONTHS[dt.getMonth()] : '') + '</span></div>';
    }).join('') + '</div></section>';
  h += '<div class="split" style="align-items:stretch"><section class="card" style="flex:2 1 460px;min-width:0"><h2 style="margin:0 0 12px;font-size:16px">Per collega</h2>' +
    (s.people.length ? '<div class="table-wrap" style="border:0"><table><thead><tr><th>Naam</th><th>Afgerond</th><th>Gem. tijd</th><th>Te laat</th><th>Belpogingen</th><th>Taken af</th><th>Nu open</th></tr></thead><tbody>' +
      s.people.map(p => '<tr><td class="pad"><strong>' + esc(p.name) + '</strong></td><td class="pad">' + p.done + '</td><td class="pad">' + humanMin(p.avgMin) + '</td><td class="pad">' + (p.late ? '<span style="color:var(--red)">' + p.late + '</span>' : 0) +
        '</td><td class="pad">' + p.attempts + '</td><td class="pad">' + p.tasksDone + '</td><td class="pad">' + p.openNow + '</td></tr>').join('') + '</tbody></table></div>'
      : '<p class="muted small">Nog geen gegevens in deze periode.</p>') + '</section>';
  const cmax = Math.max(1, ...s.categories.map(c => c.count));
  h += '<section class="card" style="flex:1 1 260px;min-width:0"><h2 style="margin:0 0 12px;font-size:16px">Per categorie</h2>' +
    (s.categories.length ? s.categories.map(c => '<div class="hbar"><span>' + esc(c.name) + '</span><span class="hbar-track"><span style="width:' + (c.count / cmax * 100) + '%"></span></span><strong>' + c.count + '</strong></div>').join('')
      : '<p class="muted small">Nog geen verzoeken in deze periode.</p>') + '</section></div>';
  return h;
}

// ----- logboek -----
const LOG_LABEL = { 'verzoek-nieuw': ['Nieuw', 'blue'], 'verzoek-bewerkt': ['Bewerkt', ''], 'verzoek-verwijderd': ['Verwijderd', 'red'], 'verzoek-poging': ['Belpoging', ''],
  'verzoek-afgerond': ['Afgerond', 'green'], 'verzoek-heropend': ['Heropend', 'orange'], 'verzoek-opgepakt': ['Opgepakt', 'blue'], 'verzoek-toegewezen': ['Toegewezen', 'blue'],
  'taak-nieuw': ['Nieuwe taak', 'blue'], 'taak-bewerkt': ['Taak bewerkt', ''], 'taak-verwijderd': ['Taak verwijderd', 'red'], 'taak-afgevinkt': ['Afgevinkt', 'green'],
  'taak-heropend': ['Taak open', 'orange'], 'taak-herhaling': ['Herhaling', ''], 'gebruiker-nieuw': ['Gebruiker', 'dark'], 'gebruiker-bewerkt': ['Gebruiker', 'dark'],
  'gebruiker-code': ['Code', 'dark'], 'systeem': ['Systeem', 'dark'] };
function viewLog() {
  const L = S.log;
  let h = '<header class="page-head"><div><h1>Logboek</h1><p>Wie wat heeft aangemaakt, gewijzigd, toegewezen of afgerond.</p></div></header>' +
    '<div class="row" style="max-width:920px"><label class="sr-only" for="log-user">Persoon</label><select class="input" id="log-user" data-in="loguser" style="flex:0 1 220px">' +
    '<option value="">Iedereen</option>' + S.colleagues.map(u => '<option value="' + u.id + '"' + (String(S.logUser) === String(u.id) ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('') + '</select>' +
    '<label class="sr-only" for="log-q">Zoeken in logboek</label><input class="input" id="log-q" type="search" data-in="logq" value="' + esc(S.logQ) + '" placeholder="Zoek, bijv. een klantnaam of ordernummer" autocomplete="off"></div>';
  if (!L) return h;
  if (!L.entries.length) return h + '<div class="empty">Niets gevonden.</div>';
  let lastDay = '';
  h += '<div class="card log" style="max-width:920px;padding:8px 0">' + L.entries.map(e => {
    const d = new Date(e.at);
    const day = sameDay(d, new Date()) ? 'Vandaag' : DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    const head = day !== lastDay ? '<div class="log-day">' + day + '</div>' : '';
    lastDay = day;
    const lab = LOG_LABEL[e.action] || [e.action, ''];
    return head + '<div class="log-row"><time>' + hm(d) + '</time><span class="badge ' + lab[1] + '">' + esc(lab[0]) + '</span><span class="log-text">' + esc(e.text) + '</span><span class="small muted">' + esc(e.byName) + '</span></div>';
  }).join('') + '</div>' + (L.total > L.entries.length ? '<p class="small muted">De laatste ' + L.entries.length + ' van ' + L.total + ' regels. Zoek of filter om verder terug te kijken.</p>' : '');
  return h;
}

// ----- gebruikers -----
function viewUsers() {
  let h = '<header class="page-head"><div><h1>Gebruikers &amp; rechten</h1><p>Iedereen logt in met naam + unieke code. Rechten koppel je per account.</p></div>' +
    '<div class="actions"><button class="btn primary" data-act="u-new">' + ICON.plus + 'Gebruiker toevoegen</button></div></header>';
  if (S.shownCode) {
    h += '<div class="alert info" role="status" style="justify-content:space-between;flex-wrap:wrap"><span><strong>Code voor ' + esc(S.shownCode.name) + '</strong>Geef deze code door. Hij wordt maar één keer getoond.</span>' +
      '<span class="code-big">' + esc(S.shownCode.code) + '</span><button class="btn small" data-act="u-hidecode">Ik heb hem genoteerd</button></div>';
  }
  const users = S.users.slice().sort((a, b) => (b.isAdmin - a.isAdmin) || a.name.localeCompare(b.name));
  h += '<div class="split"><div class="list"><div class="table-wrap"><table><thead><tr><th>Naam</th><th>Rol</th><th>Status</th></tr></thead><tbody>' +
    users.map(u => {
      const cls = (u.isAdmin ? 'admin ' : '') + (S.uSel === u.id && !S.uNew ? 'sel' : '');
      const cell = content => '<td><button class="rowbtn" data-act="u-sel" data-id="' + u.id + '">' + content + '</button></td>';
      return '<tr class="' + cls + '">' +
        cell('<span style="display:inline-flex;gap:8px;align-items:center;font-weight:600">' + (u.isAdmin ? ICON.lock : '') + esc(u.name) + '</span>') +
        cell(u.isAdmin ? '<span class="badge dark">Hoofdbeheerder</span>' : esc(ROLE_LABELS[u.role] || u.role)) +
        cell(u.isAdmin ? '<span class="small">Alle rechten · vast</span>' : (u.active ? '<span class="small" style="color:var(--green)">Actief</span>' : '<span class="small muted">Gedeactiveerd</span>')) + '</tr>';
    }).join('') + '</tbody></table></div></div>';
  return h + '<aside class="detail card">' + viewUserPanel() + '</aside></div>';
}
function rightsBoxes(rights, disabledAll) {
  return Object.keys(RIGHT_LABELS).map(k => {
    const dis = disabledAll || (k === 'manageUsers' && !S.me.isAdmin);
    return '<label class="check"><input type="checkbox" data-right="' + k + '"' + (rights[k] ? ' checked' : '') + (dis ? ' disabled' : '') + '> ' + RIGHT_LABELS[k] +
      (k === 'manageUsers' && !S.me.isAdmin && !disabledAll ? ' <span class="small muted">(alleen Admin)</span>' : '') + '</label>';
  }).join('');
}
function viewUserPanel() {
  if (S.uNew) {
    const role = S.uNewRole || 'medewerker';
    return '<div class="stack" style="gap:18px"><div><span class="small muted">Nieuwe gebruiker</span><h2 style="margin:0;font-size:22px">Gebruiker toevoegen</h2></div>' +
      '<div class="field"><label for="u-name">Naam *</label><input class="input" id="u-name" placeholder="Bijv. Lisa of Lisa de Jong" autocomplete="off"></div>' +
      '<div class="field"><label for="u-role">Rol</label><select class="input" id="u-role" data-act-change="u-role-new">' +
        Object.keys(ROLE_LABELS).filter(r => r !== 'beheerder' || S.me.isAdmin).map(r => '<option value="' + r + '"' + (r === role ? ' selected' : '') + '>' + ROLE_LABELS[r] + '</option>').join('') + '</select></div>' +
      '<fieldset class="box" style="margin:0;background:#fff;border:0;padding:0"><legend class="legend" style="margin-bottom:6px">Rechten</legend>' + rightsBoxes(S.roleDefaults[role] || {}) + '</fieldset>' +
      '<div class="detail-section"><button class="btn dark" data-act="u-create">Aanmaken en code maken</button><button class="btn ghost" data-act="u-cancel">Annuleren</button></div>' +
      '<p class="small muted" style="margin:0">Het systeem maakt een unieke code van 6 cijfers. Die zie je één keer.</p></div>';
  }
  const u = S.users.find(x => x.id === S.uSel);
  if (!u) return '<p class="muted" style="margin:0">Kies een gebruiker in de lijst om rechten aan te passen.</p>';
  if (u.isAdmin) {
    let h = '<div class="stack" style="gap:16px"><div><span class="small muted">Hoofdbeheerder</span><h2 style="margin:0;font-size:22px;display:flex;gap:8px;align-items:center">' + ICON.lock + esc(u.name) + '</h2></div>' +
      '<fieldset class="box" style="margin:0;background:#fff;border:0;padding:0"><legend class="legend" style="margin-bottom:6px">Rechten</legend>' + rightsBoxes(u.rights, true) + '</fieldset>' +
      '<p class="small muted" style="margin:0">Het Admin-account heeft altijd alle rechten. Die kunnen niet worden aangepast, en het account kan niet worden verwijderd of gedeactiveerd.</p>';
    if (S.me.isAdmin) {
      h += '<div class="detail-section"><label class="legend" for="u-owncode">Eigen code wijzigen</label><div class="row">' +
        '<input class="input" id="u-owncode" type="password" inputmode="numeric" placeholder="4 tot 12 cijfers" autocomplete="new-password">' +
        '<button class="btn dark" data-act="u-owncode" data-id="' + u.id + '">Opslaan</button></div></div>';
    }
    return h + '</div>';
  }
  return '<div class="stack" style="gap:18px"><div><span class="small muted">Bewerken</span><h2 style="margin:0;font-size:22px">' + esc(u.name) + '</h2></div>' +
    '<div class="field"><label for="u-name">Naam</label><input class="input" id="u-name" value="' + esc(u.name) + '"></div>' +
    '<div class="field"><label for="u-role">Rol</label><select class="input" id="u-role" data-act-change="u-role-edit">' +
      Object.keys(ROLE_LABELS).filter(r => r !== 'beheerder' || S.me.isAdmin || u.role === 'beheerder').map(r => '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + ROLE_LABELS[r] + '</option>').join('') + '</select></div>' +
    '<fieldset class="box" style="margin:0;background:#fff;border:0;padding:0"><legend class="legend" style="margin-bottom:6px">Rechten</legend>' + rightsBoxes(u.rights) + '</fieldset>' +
    '<label class="check"><input type="checkbox" id="u-active"' + (u.active ? ' checked' : '') + (u.id === S.me.id ? ' disabled' : '') + '> Account actief (kan inloggen)</label>' +
    '<div class="detail-section"><button class="btn dark" data-act="u-save" data-id="' + u.id + '">Opslaan</button>' +
    '<button class="btn" data-act="u-reset" data-id="' + u.id + '">Nieuwe code genereren</button></div></div>';
}

// ---------- acties ----------
$app.addEventListener('submit', async e => {
  const f = e.target.closest('[data-form="login"]');
  if (!f) return;
  e.preventDefault();
  unlockAudio();
  const name = f.elements.name.value.trim();
  const code = f.elements.code.value.trim();
  if (!name || !code) { S.loginError = 'Vul je naam en code in.'; render(); return; }
  try {
    const d = await api('/api/login', 'POST', { name, code });
    S.me = d.user; S.loginError = null; S.seen = null;
    await onRoute();
  } catch (err) {
    S.loginError = err.message; render();
    const n = document.getElementById('l-name'); if (n) n.value = name;
    const c = document.getElementById('l-code'); if (c) c.focus();
  }
});

let searchTimer, similarTimer, dupTimer, cbqTimer, logTimer;
$app.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.f && S.F) {
    S.F[el.dataset.f] = el.value; S.F.serverError = null;
    if (el.dataset.f === 'order' || el.dataset.f === 'phone') checkDup();
    return;
  }
  if (el.dataset.t && S.T) { S.T[el.dataset.t] = el.value; S.T.serverError = null; if (el.dataset.t === 'title') checkSimilar(); return; }
  if (el.dataset.in === 'q') { S.q = el.value; runSearch(); }
  if (el.dataset.in === 'cbq') {
    S.cbQ = el.value;
    clearTimeout(cbqTimer);
    cbqTimer = setTimeout(async () => {
      try {
        if (S.cbQ.trim().length >= 2) S.cbResults = (await api('/api/callbacks/search?q=' + encodeURIComponent(S.cbQ.trim()))).results;
        else S.cbResults = null;
        const list = S.cbResults || S.cbList;
        if (!list.some(c => c.id === S.cbSel)) S.cbSel = list.length ? list[0].id : null;
        renderKeepFocus();
      } catch (err) { toast(err.message, true); }
    }, 250);
  }
  if (el.dataset.in === 'logq') {
    S.logQ = el.value;
    clearTimeout(logTimer);
    logTimer = setTimeout(async () => { try { await loadLog(); renderKeepFocus(); } catch (err) { toast(err.message, true); } }, 300);
  }
});
$app.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.f && S.F) { S.F[el.dataset.f] = el.value; if (el.dataset.f === 'colleague') render(); }
  if (el.dataset.t && S.T) { S.T[el.dataset.t] = el.value; if (el.dataset.rerender) render(); }
  if (el.dataset.in === 'loguser') { S.logUser = el.value; try { await loadLog(); render(); } catch (err) { toast(err.message, true); } }
  const ac = el.dataset.actChange;
  if (ac === 'u-role-new') { S.uNewRole = el.value; keepAndRender(); }
  if (ac === 'u-role-edit') {
    const defs = S.roleDefaults[el.value] || {};
    document.querySelectorAll('[data-right]').forEach(cb => { if (!cb.disabled) cb.checked = !!defs[cb.dataset.right]; });
  }
});
function keepAndRender() {
  const name = document.getElementById('u-name');
  const v = name ? name.value : '';
  render();
  const n2 = document.getElementById('u-name');
  if (n2) n2.value = v;
}
function runSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = S.q.trim();
    if (!q.split(/[^0-9A-Za-zÀ-ÿ]+/).some(w => w.length >= 3)) S.results = null;
    else { try { S.results = (await api('/api/tasks/search?q=' + encodeURIComponent(q))).results; } catch (err) { toast(err.message, true); } }
    const box = document.getElementById('search-results');
    if (box) box.innerHTML = viewResults();
  }, 250);
}
function checkSimilar() {
  clearTimeout(similarTimer);
  similarTimer = setTimeout(async () => {
    if (!S.T) return;
    const q = S.T.title.trim();
    if (q.length < 3) S.T.similar = null;
    else { try { S.T.similar = (await api('/api/tasks/search?q=' + encodeURIComponent(q))).results; } catch (err) { /* stil */ } }
    const box = document.getElementById('similar');
    if (box) box.innerHTML = viewSimilar();
  }, 400);
}
function checkDup() {
  clearTimeout(dupTimer);
  dupTimer = setTimeout(async () => {
    if (!S.F) return;
    const qs = new URLSearchParams({ order: S.F.order, phone: S.F.phone });
    if (S.F.editId) qs.set('exclude', S.F.editId);
    try { S.dup = (await api('/api/callbacks/check?' + qs.toString())).duplicates; } catch (err) { S.dup = null; }
    const box = document.getElementById('dup');
    if (box) box.innerHTML = viewDup();
  }, 400);
}

// slepen op het teambord
let dragId = null;
$app.addEventListener('dragstart', e => {
  const card = e.target.closest('[data-drag]');
  if (!card) return;
  dragId = Number(card.dataset.drag);
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', String(dragId)); } catch (err) { /* */ }
  card.classList.add('dragging');
});
$app.addEventListener('dragend', e => {
  const card = e.target.closest('[data-drag]');
  if (card) card.classList.remove('dragging');
  document.querySelectorAll('.col.over').forEach(c => c.classList.remove('over'));
  dragId = null;
});
$app.addEventListener('dragover', e => {
  const col = e.target.closest('[data-drop]');
  if (!col || dragId == null) return;
  e.preventDefault();
  document.querySelectorAll('.col.over').forEach(c => { if (c !== col) c.classList.remove('over'); });
  col.classList.add('over');
});
$app.addEventListener('drop', async e => {
  const col = e.target.closest('[data-drop]');
  if (!col || dragId == null) return;
  e.preventDefault();
  const id = dragId; dragId = null;
  col.classList.remove('over');
  const target = col.dataset.drop;
  const from = (S.team || []).find(c => c.callbacks.some(x => x.id === id));
  if (from && (from.user ? String(from.user.id) : 'pool') === target) return;
  try {
    await api('/api/callbacks/' + id + '/assign', 'POST', { assignee: target === 'pool' ? 'pool' : Number(target) });
    const who = target === 'pool' ? 'de open pool' : ((S.team.find(c => c.user && String(c.user.id) === target) || {}).user || {}).name;
    toast('Verplaatst naar ' + who + '.');
    S.quiet = true;
    try { await loadRoute(); } finally { S.quiet = false; }
    render();
  } catch (err) { toast(err.message, true); }
});
$app.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches && e.target.matches('.mini[data-act="team-open"]')) e.target.click();
});

$app.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const id = el.dataset.id ? Number(el.dataset.id) : null;
  try {
    switch (act) {
      case 'logout': await api('/api/logout', 'POST', {}); S.me = null; S.seen = null; location.hash = ''; render(); return;
      case 'sound': prefs.sound = !prefs.sound; savePrefs(); unlockAudio(); if (prefs.sound) beep(); render(); return;
      case 'notif-allow': await Notification.requestPermission(); render(); return;

      // terugbellen
      case 'cb-tab': S.cbTab = el.dataset.v; S.cbSel = null; await loadCallbacks(); render(); return;
      case 'cb-sel': S.cbSel = id; render(); return;
      case 'cb-clearq': S.cbQ = ''; S.cbResults = null; S.cbSel = null; await loadCallbacks(); render(); return;
      case 'cb-edit': S.edit = { kind: 'cb', id }; go('verzoek'); return;
      case 'cb-quick': {
        const inp = document.getElementById('cb-note');
        const v = el.dataset.v;
        inp.value = inp.value.trim() ? (inp.value.includes(v) ? inp.value : inp.value.trim() + ' · ' + v) : v;
        inp.focus();
        return;
      }
      case 'cb-claim': await api('/api/callbacks/' + id + '/claim', 'POST', {}); toast('Opgepakt. Het staat nu in jouw lijst.'); break;
      case 'cb-reopen': await api('/api/callbacks/' + id + '/reopen', 'POST', {}); toast('Weer opengezet.'); break;
      case 'cb-done': {
        const note = (document.getElementById('cb-note') || {}).value || '';
        await api('/api/callbacks/' + id + '/done', 'POST', { text: note }); toast('Afgerond. Goed gedaan!'); break;
      }
      case 'cb-attempt': {
        const note = (document.getElementById('cb-note') || {}).value || '';
        await api('/api/callbacks/' + id + '/attempt', 'POST', { text: note ? 'Niet bereikt · ' + note : 'Niet bereikt' }); toast('Belpoging genoteerd.'); break;
      }
      case 'cb-assign': {
        const v = document.getElementById('cb-assign').value;
        await api('/api/callbacks/' + id + '/assign', 'POST', { assignee: v === 'pool' ? 'pool' : Number(v) });
        toast(v === 'pool' ? 'Terug in de open pool.' : 'Toegewezen.'); break;
      }
      case 'cb-topool': await api('/api/callbacks/' + id + '/assign', 'POST', { assignee: 'pool' }); toast('Terug in de open pool.'); break;

      // verzoek-formulier
      case 'f-type': S.F.type = el.dataset.v; render(); return;
      case 'f-assign': S.F.assign = el.dataset.v; render(); return;
      case 'f-delete': {
        if (!confirm('Dit verzoek definitief verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;
        await api('/api/callbacks/' + S.F.editId + '/delete', 'POST', {});
        toast('Verzoek verwijderd.'); S.cbSel = null; go('terugbellen'); return;
      }
      case 'f-save': {
        const F = S.F;
        F.tried = true;
        if (Object.keys(cbMissing(F)).length) { render(); window.scrollTo(0, 0); return; }
        F.saving = true; render();
        const assignee = F.assign === 'colleague' ? Number(F.colleague) : F.assign;
        const body = { type: F.type, company: F.company, contact: F.contact, name: F.name, phone: F.phone, email: F.email, order: F.order,
          category: F.category, priority: F.priority, dueAt: F.dueAt, note: F.note, assignee };
        try {
          const d = F.editId ? await api('/api/callbacks/' + F.editId + '/update', 'POST', body) : await api('/api/callbacks', 'POST', body);
          const c = d.callback;
          toast(F.editId ? 'Wijzigingen opgeslagen.' : (c.assigneeName ? 'Verzoek opgeslagen voor ' + (c.assignee === S.me.id ? 'jou' : c.assigneeName) + '.' : 'Verzoek in de open pool gezet.'));
          S.cbQ = ''; S.cbResults = null;
          S.cbTab = c.assignee === S.me.id ? 'mine' : (c.assignee ? (S.me.rights.viewAll ? 'all' : 'mine') : 'pool');
          S.cbSel = c.id;
          S.quiet = true;
          go('terugbellen');
        } catch (err) { F.saving = false; F.serverError = err.message; F.tried = false; render(); window.scrollTo(0, 0); }
        return;
      }

      // taken
      case 't-view': S.tView = el.dataset.v; S.tWho = 'ALL'; await loadTasks(); render(); return;
      case 't-who': S.tWho = el.dataset.v; render(); return;
      case 't-search': S.searchOpen = !S.searchOpen; S.q = ''; S.results = null; render(); if (S.searchOpen) document.getElementById('t-q').focus(); return;
      case 't-edit': S.edit = { kind: 'task', id }; go('taak'); return;
      case 't-toggle': await api('/api/tasks/' + id + '/toggle', 'POST', {}); break;
      case 't-archive': await api('/api/tasks/' + id + '/archive', 'POST', { archived: true }); toast('Gearchiveerd.'); break;
      case 't-restore': await api('/api/tasks/' + id + '/archive', 'POST', { archived: false }); toast('Teruggezet.'); break;
      case 't-archive-all': {
        const ids = S.tasks.filter(t => !t.archived && (t.done || t.mineDone)).map(t => t.id);
        for (const tid of ids) await api('/api/tasks/' + tid + '/archive', 'POST', { archived: true });
        toast(ids.length + ' taak/taken gearchiveerd.'); break;
      }
      case 't-archive-toggle': S.showArchive = !S.showArchive; render(); return;

      // taak-formulier
      case 't-person': S.T.sel[id] = !S.T.sel[id]; render(); return;
      case 't-allpeople': {
        const allOn = S.colleagues.every(u => S.T.sel[u.id]);
        S.T.sel = {};
        if (!allOn) S.colleagues.forEach(u => { S.T.sel[u.id] = true; });
        render(); return;
      }
      case 't-mode': S.T.mode = el.dataset.v; render(); return;
      case 't-delete': {
        if (!confirm('Deze taak definitief verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;
        await api('/api/tasks/' + S.T.editId + '/delete', 'POST', {});
        toast('Taak verwijderd.'); go('taken'); return;
      }
      case 't-save': {
        const T = S.T;
        T.tried = true;
        if (Object.keys(taskErrors(T)).length) { render(); window.scrollTo(0, 0); return; }
        const chosen = Object.keys(T.sel).filter(k => T.sel[k]).map(Number);
        T.saving = true; render();
        const body = { title: T.title, desc: T.desc, dueAt: T.dueAt, priority: T.priority, assignees: chosen, mode: T.mode, repeat: T.repeat };
        try {
          if (T.editId) await api('/api/tasks/' + T.editId + '/update', 'POST', body);
          else await api('/api/tasks', 'POST', body);
          toast(T.editId ? 'Wijzigingen opgeslagen.' : 'Taak aangemaakt.');
          if (!T.editId) S.tView = chosen.includes(S.me.id) || !S.me.rights.viewAll ? 'mine' : 'all';
          S.quiet = true;
          go('taken');
        } catch (err) { T.saving = false; T.serverError = err.message; T.tried = false; render(); window.scrollTo(0, 0); }
        return;
      }

      // teambord / cijfers
      case 'team-refresh': await loadRoute(); render(); toast('Bijgewerkt.'); return;
      case 'team-open': S.cbTab = 'all'; S.cbQ = ''; S.cbResults = null; S.cbSel = id; go('terugbellen'); return;
      case 'stat-days': S.statDays = Number(el.dataset.v); await loadStats(); render(); return;

      // gebruikers
      case 'u-sel': S.uSel = id; S.uNew = false; render(); return;
      case 'u-new': S.uNew = true; S.uNewRole = 'medewerker'; render(); document.getElementById('u-name').focus(); return;
      case 'u-cancel': S.uNew = false; render(); return;
      case 'u-hidecode': S.shownCode = null; render(); return;
      case 'u-create': {
        const name = document.getElementById('u-name').value.trim();
        if (!name) { toast('Vul een naam in.', true); return; }
        const role = document.getElementById('u-role').value;
        const rights = {};
        document.querySelectorAll('[data-right]').forEach(cb => { rights[cb.dataset.right] = cb.checked; });
        const d = await api('/api/admin/users', 'POST', { name, role, rights });
        S.shownCode = { name: d.user.name, code: d.code };
        S.uNew = false; S.uSel = d.user.id;
        await loadUsers(); render(); window.scrollTo(0, 0); return;
      }
      case 'u-save': {
        const rights = {};
        document.querySelectorAll('[data-right]').forEach(cb => { rights[cb.dataset.right] = cb.checked; });
        const active = document.getElementById('u-active');
        await api('/api/admin/users/' + id, 'POST', { name: document.getElementById('u-name').value, role: document.getElementById('u-role').value, rights, active: active ? active.checked : true });
        toast('Opgeslagen.'); await loadUsers(); render(); return;
      }
      case 'u-reset': {
        const u = S.users.find(x => x.id === id);
        if (!confirm('Nieuwe code maken voor ' + u.name + '? De oude code werkt dan niet meer.')) return;
        const d = await api('/api/admin/users/' + id + '/reset-code', 'POST', {});
        S.shownCode = { name: u.name, code: d.code }; render(); window.scrollTo(0, 0); return;
      }
      case 'u-owncode': {
        const code = document.getElementById('u-owncode').value.trim();
        if (!/^\d{4,12}$/.test(code)) { toast('Een code bestaat uit 4 tot 12 cijfers.', true); return; }
        await api('/api/admin/users/' + id + '/reset-code', 'POST', { code });
        toast('Je nieuwe code is opgeslagen.'); render(); return;
      }
      default: return;
    }
    // eigen actie: geen melding voor werk dat je net zelf hebt gepakt of toegewezen
    S.quiet = true;
    try { await loadRoute(); } finally { S.quiet = false; }
    render();
  } catch (err) { toast(err.message, true); }
});

// ---------- automatisch verversen (elke 20 seconden) ----------
setInterval(async () => {
  if (!S.me || dragId != null) return;
  const r = route();
  const a = document.activeElement;
  const typing = a && /INPUT|TEXTAREA|SELECT/.test(a.tagName);
  try {
    if (['terugbellen', 'taken', 'team'].includes(r) && !typing && !document.hidden) {
      const y = window.scrollY;
      await loadRoute(); render(); window.scrollTo(0, y);
    } else {
      await loadCounts();
      const nav = document.querySelector('.nav');
      if (nav && !typing) nav.outerHTML = viewNav(r);
    }
  } catch (e) { /* stil */ }
}, 20000);

// ---------- start ----------
(async function start() {
  try { S.me = (await api('/api/me')).user; } catch (e) { S.me = null; }
  if (S.me) await onRoute(); else render();
})();
