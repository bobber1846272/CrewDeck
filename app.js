/* Terugbelsysteem · TheNextGroep BV — webapp (geen externe bibliotheken) */
'use strict';

const $app = document.getElementById('app');
const RIGHT_LABELS = {
  create: 'Verzoeken en taken aanmaken',
  assign: 'Toewijzen aan collega’s',
  viewAll: 'Alle verzoeken en taken zien',
  manageUsers: 'Gebruikers beheren'
};
const ROLE_LABELS = { medewerker: 'Medewerker', teamleider: 'Teamleider', beheerder: 'Beheerder' };
const CATEGORIES = ['Offerte / zakelijk', 'Bestelling', 'Retour', 'Technisch', 'Klacht', 'Overig'];

const S = {
  me: null,
  loginError: null,
  counts: { mine: 0, pool: 0, tasks: 0 },
  colleagues: [],
  // terugbellen
  cbTab: 'mine', cbList: [], cbSel: null,
  // taken
  tView: 'mine', tasks: [], tWho: 'ALL', showArchive: false, searchOpen: false, q: '', results: null,
  // beheer
  users: [], roleDefaults: {}, uSel: null, uNew: false, shownCode: null,
  // formulieren
  F: null, T: null
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
function toLocalInput(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
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
  if (min < 60) return min + ' min';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' uur';
  return Math.floor(h / 24) + ' dag' + (h >= 48 ? 'en' : '');
}
// kind: 'bel' (terugbellen) of 'taak'
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

let toastTimer;
function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3200);
}

async function api(path, method, body) {
  const opt = { method: method || 'GET', headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch(path, opt);
  let data = {};
  try { data = await res.json(); } catch (e) { /* leeg */ }
  if (res.status === 401 && path !== '/api/login') {
    S.me = null; render();
    throw new Error(data.error || 'Niet ingelogd');
  }
  if (!res.ok) throw new Error(data.error || 'Er ging iets mis.');
  return data;
}

const ICON = {
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  box: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/></svg>',
  lock: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  pin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  alert: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B42318" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;margin-top:1px"><circle cx="12" cy="12" r="10"/><path d="M12 7v6M12 16.5v.5"/></svg>',
  check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#067647" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none"><path d="M5 12l5 5L20 7"/></svg>',
  spark: '<svg width="20" height="20" viewBox="0 0 24 24" role="img" aria-label="Spark Apps logo"><path d="M12 1.5C12.9 8.6 15.4 11.1 22.5 12C15.4 12.9 12.9 15.4 12 22.5C11.1 15.4 8.6 12.9 1.5 12C8.6 11.1 11.1 8.6 12 1.5Z" fill="#FDBA74"/></svg>'
};

// ---------- routes ----------
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  return ['terugbellen', 'verzoek', 'taken', 'taak', 'gebruikers'].includes(h) ? h : 'terugbellen';
}
function go(r) {
  if (location.hash === '#/' + r) { onRoute(); } else { location.hash = '#/' + r; }
}
window.addEventListener('hashchange', onRoute);

async function onRoute() {
  if (!S.me) return render();
  const r = route();
  try {
    if (r === 'gebruikers' && !S.me.rights.manageUsers) return go('terugbellen');
    if (r === 'verzoek' || r === 'taak') {
      await loadColleagues();
      if (r === 'verzoek') S.F = newCallbackForm();
      else S.T = newTaskForm();
    }
    await loadRoute();
  } catch (e) { toast(e.message, true); }
  render();
  window.scrollTo(0, 0);
}

async function loadRoute() {
  const r = route();
  const jobs = [loadCounts()];
  if (r === 'terugbellen') jobs.push(loadCallbacks(), loadColleagues());
  if (r === 'taken') jobs.push(loadTasks());
  if (r === 'gebruikers') jobs.push(loadUsers());
  await Promise.all(jobs);
}
async function loadCounts() {
  const [a, b, c] = await Promise.all([
    api('/api/callbacks?scope=mine'), api('/api/callbacks?scope=pool'), api('/api/tasks?scope=mine')
  ]);
  S.counts = { mine: a.callbacks.length, pool: b.callbacks.length, tasks: c.tasks.filter(t => !t.done && !t.mineDone).length };
}
async function loadColleagues() {
  S.colleagues = (await api('/api/colleagues')).users;
}
async function loadCallbacks() {
  if (S.cbTab === 'all' && !S.me.rights.viewAll) S.cbTab = 'mine';
  S.cbList = (await api('/api/callbacks?scope=' + S.cbTab)).callbacks;
  if (!S.cbList.some(c => c.id === S.cbSel)) S.cbSel = S.cbList.length ? S.cbList[0].id : null;
}
async function loadTasks() {
  if (S.tView === 'all' && !S.me.rights.viewAll) S.tView = 'mine';
  S.tasks = (await api('/api/tasks?scope=' + S.tView)).tasks;
}
async function loadUsers() {
  const d = await api('/api/admin/users');
  S.users = d.users; S.roleDefaults = d.roleDefaults;
}

// ---------- render ----------
function render() {
  if (!S.me) { $app.innerHTML = viewLogin(); return; }
  const r = route();
  let main = '';
  if (r === 'terugbellen') main = viewCallbacks();
  else if (r === 'verzoek') main = viewCallbackForm();
  else if (r === 'taken') main = viewTasks();
  else if (r === 'taak') main = viewTaskForm();
  else if (r === 'gebruikers') main = viewUsers();
  $app.innerHTML = '<div class="shell">' + viewNav(r) + '<main class="main">' + main + '</main></div>';
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
  const link = (to, label, count) =>
    '<a href="#/' + to + '" class="' + (r === to || (to === 'terugbellen' && r === 'verzoek') || (to === 'taken' && r === 'taak') ? 'active' : '') + '">' +
    '<span>' + label + '</span>' + (count ? '<span class="nav-count">' + count + '</span>' : '') + '</a>';
  return '<nav class="nav" aria-label="Hoofdmenu">' +
    '<div class="nav-brand"><div class="brand-name">TheNextGroep <span>BV</span></div><div class="brand-sub">Terugbelsysteem</div></div>' +
    '<div class="nav-links">' +
      link('terugbellen', 'Terugbellen', S.counts.mine) +
      link('taken', 'Mijn taken', S.counts.tasks) +
      (S.me.rights.manageUsers ? link('gebruikers', 'Gebruikers &amp; rechten') : '') +
    '</div>' +
    '<div class="nav-user"><div class="nav-user-row">' + avatar(S.me.id, S.me.name) +
      '<div><strong style="font-size:13px">' + esc(S.me.name) + '</strong><small>' + (S.me.isAdmin ? 'Hoofdbeheerder' : esc(ROLE_LABELS[S.me.role] || '')) + '</small></div></div>' +
      '<button class="link-btn" data-act="logout">Uitloggen</button></div>' +
  '</nav>';
}

// ----- terugbellen -----
function viewCallbacks() {
  const L = S.cbList;
  const tabs = [['mine', 'Mijn verzoeken', S.counts.mine], ['pool', 'Open pool', S.counts.pool]];
  if (S.me.rights.viewAll) tabs.push(['all', 'Alle open', null]);
  tabs.push(['done', 'Afgerond', null]);
  let html = '<header class="page-head"><div><h1>Terugbellen</h1><p>' + esc(DAYS[new Date().getDay()]) + ' ' + new Date().getDate() + ' ' + MONTHS[new Date().getMonth()] + ' · gesorteerd op urgentie</p></div>' +
    '<div class="actions">' + (S.me.rights.create ? '<a class="btn primary" href="#/verzoek">' + ICON.plus + 'Nieuw verzoek</a>' : '') + '</div></header>';

  if (S.cbTab === 'mine') {
    html += '<div class="stats">' +
      stat('Te laat', L.filter(c => isLate(c.dueAt)).length, 'var(--red)') +
      stat('Binnen 1 uur', L.filter(c => within(c.dueAt, 60)).length, 'var(--orange)') +
      stat('Open bij jou', L.length) +
      stat('In de open pool', S.counts.pool, 'var(--blue)') + '</div>';
  }
  html += '<div class="seg" role="group" aria-label="Overzicht">' + tabs.map(t =>
    '<button data-act="cb-tab" data-v="' + t[0] + '" class="' + (S.cbTab === t[0] ? 'on' : '') + '" aria-pressed="' + (S.cbTab === t[0]) + '">' + t[1] +
    (t[2] != null ? '<span class="cnt">' + t[2] + '</span>' : '') + '</button>').join('') + '</div>';

  if (!L.length) {
    const msg = { mine: 'Je hebt geen open terugbelverzoeken. Lekker bezig!', pool: 'De open pool is leeg.', all: 'Er staan geen open verzoeken.', done: 'Nog niets afgerond.' }[S.cbTab];
    return html + '<div class="empty">' + msg + '</div>';
  }
  html += '<div class="split"><div class="list">' + L.map(c => {
    const who = S.cbTab === 'mine' ? '' : (c.assigneeName ? 'Bij ' + c.assigneeName : 'In de open pool');
    const tries = (c.attempts || []).filter(a => !/^Afgerond/.test(a.text)).length;
    const meta = [who, tries ? 'Poging ' + tries : 'Nog niet gebeld', 'door ' + c.createdByName].filter(Boolean).join(' · ');
    return '<button class="item' + (c.id === S.cbSel ? ' sel' : '') + '" data-act="cb-sel" data-id="' + c.id + '">' +
      '<span class="item-top">' + (S.cbTab === 'done' ? '<span class="badge green">Afgerond ' + esc(fmtDate(c.doneAt)) + '</span>' : dueBadge(c.dueAt, 'bel')) +
      '<span class="item-meta">' + esc(c.category) + (c.priority === 'hoog' ? ' · <strong style="color:var(--red)">Hoog</strong>' : '') + '</span></span>' +
      '<span class="item-title">' + esc(cbTitle(c)) + '</span>' +
      '<span class="item-sub">' + (c.contact ? 't.a.v. ' + esc(c.contact) + ' · ' : '') + 'Order ' + esc(c.order) + '</span>' +
      '<span class="item-meta">' + esc(meta) + '</span></button>';
  }).join('') + '</div>';
  const sel = L.find(c => c.id === S.cbSel);
  html += '<aside class="detail card">' + (sel ? viewCallbackDetail(sel) : '') + '</aside></div>';
  return html;
}
function stat(label, n, color) {
  return '<div class="stat"><span>' + label + '</span><strong' + (color ? ' style="color:' + color + '"' : '') + '>' + n + '</strong></div>';
}
function viewCallbackDetail(c) {
  const isDone = c.status === 'done';
  const tries = (c.attempts || []).filter(a => !/^Afgerond/.test(a.text)).length;
  let h = '<div style="display:flex;flex-direction:column;gap:18px">' +
    '<div><div style="margin-bottom:6px">' + (isDone ? '<span class="badge green">Afgerond door ' + esc(c.doneByName) + '</span>' : dueBadge(c.dueAt, 'bel')) +
    (c.priority === 'hoog' ? ' <span class="badge red">Hoge prioriteit</span>' : '') + '</div>' +
    '<h2 style="margin:0;font-size:22px">' + esc(cbTitle(c)) + '</h2></div>' +
    '<dl class="dl">' +
      (c.type === 'zakelijk' ? dd('Contactpersoon', c.contact || '–') : dd('Soort', 'Particulier')) +
      '<div><dt>Telefoon</dt><dd><a href="tel:' + esc(c.phone.replace(/[^\d+]/g, '')) + '">' + esc(c.phone) + '</a></dd></div>' +
      dd('Ordernummer', c.order) + dd('Categorie', c.category) +
      (c.email ? '<div class="full"><dt>E-mail</dt><dd><a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a></dd></div>' : '') +
      dd('Toegewezen aan', c.assigneeName || 'Open pool') + dd('Aangemaakt', fmtDate(c.createdAt) + ' door ' + c.createdByName) +
      (c.note ? '<div class="full"><dt>Reden / notitie</dt><dd>' + esc(c.note) + '</dd></div>' : '') +
    '</dl>';
  if (c.attempts && c.attempts.length) {
    h += '<div class="detail-section"><span class="legend">Belpogingen &amp; notities</span><div class="attempts">' +
      c.attempts.map(a => '<div><time>' + esc(fmtDate(a.at)) + '</time><span>' + esc(a.text) + ' <span class="muted">· ' + esc(a.byName) + '</span></span></div>').join('') + '</div></div>';
  }
  if (!isDone && tries >= 3) {
    h += '<div class="alert info"><span><strong>3x niet bereikt</strong>Stuur de klant een mail of sms, of zet het verzoek terug in de pool.</span></div>';
  }
  if (isDone) {
    h += '<div class="detail-section"><button class="btn" data-act="cb-reopen" data-id="' + c.id + '">Weer openzetten</button></div>';
    return h + '</div>';
  }
  if (!c.assigneeName) {
    h += '<div class="detail-section"><button class="btn primary" data-act="cb-claim" data-id="' + c.id + '">Pak ik op</button></div>';
  }
  h += '<div class="detail-section">' +
    '<label class="legend" for="cb-note">Notitie bij dit gesprek <small>(optioneel)</small></label>' +
    '<input class="input" id="cb-note" placeholder="Bijv. voicemail ingesproken">' +
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
function dd(label, val) { return '<div><dt>' + label + '</dt><dd>' + esc(val) + '</dd></div>'; }

// ----- nieuw verzoek -----
function newCallbackForm() {
  return { type: 'zakelijk', company: '', contact: '', name: '', phone: '', email: '', order: '', category: CATEGORIES[0], priority: 'normaal',
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
    '<input class="input' + (err ? ' bad' : '') + '" id="' + id + '" data-f="' + key + '" type="' + (opts.type || 'text') + '" value="' + esc(F[key]) + '" placeholder="' + esc(opts.ph || '') + '"' + (err ? ' aria-invalid="true"' : '') + '>' +
    (err ? '<span class="err-text">' + esc(err) + '</span>' : '') + '</div>';
}
function viewCallbackForm() {
  const F = S.F;
  const errors = cbMissing(F);
  const errList = Object.keys(errors);
  const names = { company: 'bedrijfsnaam', name: 'naam', phone: 'telefoonnummer', order: 'ordernummer', colleague: 'collega' };
  let h = '<div class="card form" style="align-self:center">' +
    '<div><h1 style="margin:0;font-size:26px">Nieuw terugbelverzoek</h1><p class="muted" style="margin:4px 0 0;font-size:14px">Vul in tijdens of direct na het gesprek. Velden met * zijn verplicht.</p></div>';
  if (F.tried && errList.length) {
    h += '<div class="alert error" role="alert">' + ICON.alert + '<span><strong>Niet alle verplichte velden zijn ingevuld</strong>Vul nog in: ' + errList.map(k => names[k]).join(', ') + '.</span></div>';
  } else if (F.serverError) {
    h += '<div class="alert error" role="alert">' + ICON.alert + '<span>' + esc(F.serverError) + '</span></div>';
  }
  h += '<div class="field"><span class="legend">Soort klant *</span><div class="row">' +
    '<button type="button" class="btn' + (F.type === 'particulier' ? ' on' : '') + '" data-act="f-type" data-v="particulier" aria-pressed="' + (F.type === 'particulier') + '">Particulier</button>' +
    '<button type="button" class="btn' + (F.type === 'zakelijk' ? ' on' : '') + '" data-act="f-type" data-v="zakelijk" aria-pressed="' + (F.type === 'zakelijk') + '">Zakelijk</button></div></div>';
  h += '<div class="fields2">' +
    (F.type === 'zakelijk'
      ? inputField('f-company', 'Bedrijfsnaam', F, 'company', { req: 1, errors, ph: 'Bijv. Beeldwerk Media BV' }) + inputField('f-contact', 'Contactpersoon', F, 'contact', { ph: 'optioneel' })
      : inputField('f-name', 'Naam', F, 'name', { req: 1, errors, ph: 'Voor- en achternaam', span: 1 })) +
    inputField('f-phone', 'Telefoonnummer', F, 'phone', { req: 1, errors, type: 'tel', ph: '06 …' }) +
    inputField('f-order', 'Ordernummer', F, 'order', { req: 1, errors, ph: 'Bijv. 123456' }) +
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
    opt('me', 'Ikzelf') + (can ? opt('colleague', 'Collega') : '') + opt('pool', 'Open pool') + (can ? opt('auto', 'Automatisch verdelen') : '') + '</div>';
  if (F.assign === 'colleague') {
    h += '<div class="field"><label for="f-coll">Collega</label><select class="input' + (F.tried && errors.colleague ? ' bad' : '') + '" id="f-coll" data-f="colleague"><option value="">Kies een collega…</option>' +
      S.colleagues.filter(u => u.id !== S.me.id).map(u => '<option value="' + u.id + '"' + (String(F.colleague) === String(u.id) ? ' selected' : '') + '>' + esc(u.name) + ' (' + u.open + ' open)</option>').join('') + '</select></div>';
  }
  if (F.assign === 'auto') h += '<p class="muted small" style="margin:0">Gaat naar de collega met de minste openstaande verzoeken en taken.</p>';
  h += '</fieldset>';
  h += '<div class="form-foot"><a class="btn" href="#/terugbellen">Annuleren</a><button class="btn primary" data-act="f-save"' + (F.saving ? ' disabled' : '') + '>Verzoek opslaan</button></div></div>';
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
  let h = '<section class="card stack" style="gap:14px;padding:20px" aria-label="Controleer of een taak al bestaat">' +
    '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><h2 style="margin:0;font-size:16px">Controleer of deze taak al bestaat</h2>' +
    '<p class="muted" style="margin:2px 0 0;font-size:13px">Zoekt in alle taken van het team, ook die van anderen en wat al af is.</p></div>' +
    '<button class="icon-btn" data-act="t-search" aria-label="Sluiten">' + ICON.x + '</button></div>' +
    '<label class="sr-only" for="t-q">Zoek in alle taken</label>' +
    '<div class="search">' + ICON.search + '<input id="t-q" type="search" data-in="q" value="' + esc(S.q) + '" placeholder="Bijv. retour 482913, prijslijst, showroom…" autocomplete="off"></div>' +
    '<div id="search-results">' + viewResults() + '</div></section>';
  return h;
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
function peopleStack(t) {
  return '<span class="people">' + t.assignees.map(a => avatar(a.id, a.name, 'sm')).join('') + '</span>';
}
function taskMeta(t) {
  const others = t.assignees.length > 1;
  const by = t.createdBy === S.me.id ? 'door jou' : 'van ' + t.createdByName;
  if (!others) return by;
  if (t.mode === 'een') return 'Gedeeld · klaar zodra één persoon afvinkt · ' + by;
  return 'Iedereen vinkt af · ' + t.doneCount + ' van ' + t.assignees.length + ' klaar · ' + by;
}
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
    '<div class="row" style="align-items:center;gap:12px">' + peopleStack(t) + '<span class="item-meta" style="padding-left:6px">' + esc(taskMeta(t)) + '</span></div></div></article>').join('')
    : '<div class="empty">Niets meer te doen. Top!</div>';
  h += '</section>';

  h += '<section class="stack"><div class="section-title"><h2>Afgerond · ' + done.length + '</h2>' +
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
  h += '</section>';

  h += '<section class="stack"><button class="btn ghost" style="align-self:flex-start" data-act="t-archive-toggle" aria-expanded="' + S.showArchive + '">' + ICON.box +
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
    (t.assignees.length > 1 && t.mode === 'iedereen' ? ' · ' + t.doneCount + '/' + t.assignees.length + ' klaar' : '') + ' · van ' + esc(t.createdByName) + '</span></div>' +
    dueBadge(t.dueAt, 'taak') + '</article>').join('') : '<div class="empty">Geen open taken.</div>';
  h += '<div class="section-title" style="margin-top:8px"><h2>Afgerond · ' + done.length + '</h2></div>';
  h += done.map(t => '<article class="task done"><span class="item-title" style="flex:1 1 260px;min-width:0">' + esc(t.title) + '</span>' +
    '<span class="item-meta">Voor ' + esc(t.assignees.map(a => a.name).join(', ')) + '</span></article>').join('');
  return h + '</section>';
}

// ----- nieuwe taak -----
function newTaskForm() {
  return { title: '', desc: '', dueAt: '', priority: 'normaal', sel: S.me.rights.assign ? {} : { [S.me.id]: true }, mode: 'een', tried: false, serverError: null, similar: null, saving: false };
}
function viewTaskForm() {
  const T = S.T;
  const chosen = Object.keys(T.sel).filter(k => T.sel[k]);
  const errors = {};
  if (!T.title.trim()) errors.title = 'Geef de taak een titel';
  if (!chosen.length) errors.people = 'Kies minstens één persoon';
  const errNames = { title: 'titel', people: 'voor wie' };
  let h = '<div class="card form" style="align-self:center">' +
    '<div><h1 style="margin:0;font-size:26px">Nieuwe taak</h1><p class="muted" style="margin:4px 0 0;font-size:14px">Geef een taak aan jezelf, één collega of meerdere tegelijk. Velden met * zijn verplicht.</p></div>';
  if (T.tried && Object.keys(errors).length) {
    h += '<div class="alert error" role="alert">' + ICON.alert + '<span><strong>Niet alle verplichte velden zijn ingevuld</strong>Vul nog in: ' + Object.keys(errors).map(k => errNames[k]).join(', ') + '.</span></div>';
  } else if (T.serverError) {
    h += '<div class="alert error" role="alert">' + ICON.alert + '<span>' + esc(T.serverError) + '</span></div>';
  }
  const tErr = T.tried && errors.title;
  h += '<div class="field"><label for="t-title">Wat moet er gebeuren? *</label><input class="input' + (tErr ? ' bad' : '') + '" id="t-title" data-t="title" value="' + esc(T.title) + '" placeholder="Bijv. Showroom opruimen voor sluiting" autocomplete="off">' +
    (tErr ? '<span class="err-text">' + errors.title + '</span>' : '') + '<div id="similar">' + viewSimilar() + '</div></div>';
  h += '<div class="field"><label for="t-desc">Omschrijving</label><textarea class="input" id="t-desc" data-t="desc" rows="3" placeholder="optioneel: extra uitleg, ordernummer, waar het ligt…">' + esc(T.desc) + '</textarea></div>';
  h += '<div class="fields2"><div class="field"><label for="t-due">Deadline</label><input class="input" id="t-due" type="datetime-local" data-t="dueAt" value="' + esc(T.dueAt) + '"></div>' +
    '<div class="field"><label for="t-prio">Prioriteit</label><select class="input" id="t-prio" data-t="priority">' + ['normaal', 'hoog', 'laag'].map(p => '<option value="' + p + '"' + (T.priority === p ? ' selected' : '') + '>' + p[0].toUpperCase() + p.slice(1) + '</option>').join('') + '</select></div></div>';
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
  h += '</fieldset><div class="form-foot"><a class="btn" href="#/taken">Annuleren</a><button class="btn primary" data-act="t-save"' + (T.saving ? ' disabled' : '') + '>Taak aanmaken</button></div></div>';
  return h;
}
function viewSimilar() {
  const T = S.T;
  if (!T || !T.similar || !T.similar.length) return '';
  const open = T.similar.filter(r => !r.done).slice(0, 3);
  if (!open.length) return '';
  return '<div class="alert info" style="margin-top:6px"><span><strong>Lijkt op een bestaande taak</strong>' +
    open.map(r => esc(r.title) + ' <span class="small">(voor ' + esc(r.assignees.join(', ')) + ')</span>').join('<br>') + '</span></div>';
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
      const cell = (content) => '<td><button class="rowbtn" data-act="u-sel" data-id="' + u.id + '">' + content + '</button></td>';
      return '<tr class="' + cls + '">' +
        cell('<span style="display:inline-flex;gap:8px;align-items:center;font-weight:600">' + (u.isAdmin ? ICON.lock : '') + esc(u.name) + '</span>') +
        cell(u.isAdmin ? '<span class="badge dark">Hoofdbeheerder</span>' : esc(ROLE_LABELS[u.role] || u.role)) +
        cell(u.isAdmin ? '<span class="small">Alle rechten · vast</span>' : (u.active ? '<span class="small" style="color:var(--green)">Actief</span>' : '<span class="small muted">Gedeactiveerd</span>')) +
      '</tr>';
    }).join('') + '</tbody></table></div></div>';
  h += '<aside class="detail card">' + viewUserPanel() + '</aside></div>';
  return h;
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
  const name = f.elements.name.value.trim();
  const code = f.elements.code.value.trim();
  if (!name || !code) { S.loginError = 'Vul je naam en code in.'; render(); return; }
  try {
    const d = await api('/api/login', 'POST', { name, code });
    S.me = d.user; S.loginError = null;
    await onRoute();
  } catch (err) {
    S.loginError = err.message; render();
    const n = document.getElementById('l-name'); if (n) n.value = name;
    const c = document.getElementById('l-code'); if (c) c.focus();
  }
});

$app.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.f && S.F) { S.F[el.dataset.f] = el.value; S.F.serverError = null; return; }
  if (el.dataset.t && S.T) {
    S.T[el.dataset.t] = el.value; S.T.serverError = null;
    if (el.dataset.t === 'title') checkSimilar();
    return;
  }
  if (el.dataset.in === 'q') { S.q = el.value; runSearch(); }
});
$app.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.f && S.F) { S.F[el.dataset.f] = el.value; if (el.dataset.f === 'colleague') render(); }
  if (el.dataset.t && S.T) S.T[el.dataset.t] = el.value;
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

let searchTimer, similarTimer;
function runSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = S.q.trim();
    const words = q.split(/[^0-9A-Za-zÀ-ÿ]+/).filter(w => w.length >= 3);
    if (!words.length) S.results = null;
    else {
      try { S.results = (await api('/api/tasks/search?q=' + encodeURIComponent(q))).results; } catch (err) { toast(err.message, true); }
    }
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

$app.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const id = el.dataset.id ? Number(el.dataset.id) : null;
  try {
    switch (act) {
      case 'logout':
        await api('/api/logout', 'POST', {}); S.me = null; location.hash = ''; render(); return;

      // terugbellen
      case 'cb-tab': S.cbTab = el.dataset.v; S.cbSel = null; await loadCallbacks(); render(); return;
      case 'cb-sel': S.cbSel = id; render(); return;
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

      // nieuw verzoek
      case 'f-type': S.F.type = el.dataset.v; render(); return;
      case 'f-assign': S.F.assign = el.dataset.v; render(); return;
      case 'f-save': {
        const F = S.F;
        F.tried = true;
        if (Object.keys(cbMissing(F)).length) { render(); window.scrollTo(0, 0); return; }
        F.saving = true; render();
        const assignee = F.assign === 'colleague' ? Number(F.colleague) : F.assign;
        try {
          const body = { type: F.type, company: F.company, contact: F.contact, name: F.name, phone: F.phone, email: F.email, order: F.order,
            category: F.category, priority: F.priority, dueAt: F.dueAt, note: F.note, assignee };
          const d = await api('/api/callbacks', 'POST', body);
          toast(d.callback.assigneeName ? 'Verzoek opgeslagen voor ' + (d.callback.assignee === S.me.id ? 'jou' : d.callback.assigneeName) + '.' : 'Verzoek in de open pool gezet.');
          S.cbTab = d.callback.assignee === S.me.id ? 'mine' : (d.callback.assignee ? (S.me.rights.viewAll ? 'all' : 'mine') : 'pool');
          S.cbSel = d.callback.id;
          go('terugbellen');
        } catch (err) { F.saving = false; F.serverError = err.message; F.tried = false; render(); window.scrollTo(0, 0); }
        return;
      }

      // taken
      case 't-view': S.tView = el.dataset.v; S.tWho = 'ALL'; await loadTasks(); render(); return;
      case 't-who': S.tWho = el.dataset.v; render(); return;
      case 't-search': S.searchOpen = !S.searchOpen; S.q = ''; S.results = null; render(); if (S.searchOpen) document.getElementById('t-q').focus(); return;
      case 't-toggle': await api('/api/tasks/' + id + '/toggle', 'POST', {}); break;
      case 't-archive': await api('/api/tasks/' + id + '/archive', 'POST', { archived: true }); toast('Gearchiveerd.'); break;
      case 't-restore': await api('/api/tasks/' + id + '/archive', 'POST', { archived: false }); toast('Teruggezet.'); break;
      case 't-archive-all': {
        const ids = S.tasks.filter(t => !t.archived && (t.done || t.mineDone)).map(t => t.id);
        for (const tid of ids) await api('/api/tasks/' + tid + '/archive', 'POST', { archived: true });
        toast(ids.length + ' taak/taken gearchiveerd.'); break;
      }
      case 't-archive-toggle': S.showArchive = !S.showArchive; render(); return;

      // nieuwe taak
      case 't-person': S.T.sel[id] = !S.T.sel[id]; render(); return;
      case 't-allpeople': {
        const allOn = S.colleagues.every(u => S.T.sel[u.id]);
        S.T.sel = {};
        if (!allOn) S.colleagues.forEach(u => { S.T.sel[u.id] = true; });
        render(); return;
      }
      case 't-mode': S.T.mode = el.dataset.v; render(); return;
      case 't-save': {
        const T = S.T;
        T.tried = true;
        const chosen = Object.keys(T.sel).filter(k => T.sel[k]).map(Number);
        if (!T.title.trim() || !chosen.length) { render(); window.scrollTo(0, 0); return; }
        T.saving = true; render();
        try {
          await api('/api/tasks', 'POST', { title: T.title, desc: T.desc, dueAt: T.dueAt, priority: T.priority, assignees: chosen, mode: T.mode });
          toast('Taak aangemaakt.');
          S.tView = chosen.includes(S.me.id) || !S.me.rights.viewAll ? 'mine' : 'all';
          go('taken');
        } catch (err) { T.saving = false; T.serverError = err.message; T.tried = false; render(); window.scrollTo(0, 0); }
        return;
      }

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
        await api('/api/admin/users/' + id, 'POST', {
          name: document.getElementById('u-name').value, role: document.getElementById('u-role').value, rights, active: active ? active.checked : true
        });
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
    // na een wijziging: gegevens opnieuw laden
    await loadRoute(); render();
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------- automatisch verversen ----------
setInterval(async () => {
  if (!S.me || document.hidden) return;
  const r = route();
  if (r !== 'terugbellen' && r !== 'taken') return;
  const a = document.activeElement;
  if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
  try {
    const y = window.scrollY;
    await loadRoute(); render(); window.scrollTo(0, y);
  } catch (e) { /* stil */ }
}, 20000);

// ---------- start ----------
(async function start() {
  try { S.me = (await api('/api/me')).user; } catch (e) { S.me = null; }
  if (S.me) await onRoute(); else render();
})();
