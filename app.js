/* Crewdeck — webapp
 * Praat met de database via gecontroleerde functies (public.cd_*) en met de logindienst (edge function "crewdeck").
 * Geen externe bibliotheken behalve de meegeleverde Supabase-client (vendor/supabase.js).
 */
'use strict';

const CFG = window.CREWDECK_CONFIG || {};
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { storageKey: 'crewdeck-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});
const $app = document.getElementById('app');

const PERM_GROUPS = [
  ['Terugbellen', [['callbacks.create', 'Verzoeken aanmaken'], ['callbacks.assign', 'Toewijzen aan collega’s'], ['callbacks.view_all', 'Alle verzoeken zien'],
    ['callbacks.edit_all', 'Alle verzoeken bewerken'], ['callbacks.delete', 'Verzoeken verwijderen']]],
  ['Taken', [['tasks.create', 'Taken aanmaken'], ['tasks.assign', 'Taken aan anderen geven'], ['tasks.view_all', 'Alle taken zien'],
    ['tasks.edit_all', 'Alle taken bewerken'], ['tasks.delete', 'Taken verwijderen']]],
  ['Uren', [['hours.view_all', 'Uren van iedereen zien'], ['hours.approve', 'Uren goedkeuren'], ['hours.plan', 'Rooster plannen']]],
  ['Kennis & documenten', [['kb.edit', 'Kennisbank bewerken'], ['docs.upload', 'Documenten uploaden'], ['docs.manage', 'Mappen en documenten beheren']]],
  ['Teamleiding', [['team.board', 'Teambord'], ['reports.view', 'Cijfers'], ['audit.view', 'Logboek']]],
  ['Beheer', [['members.manage', 'Medewerkers beheren'], ['roles.manage', 'Rollen en rechten beheren'], ['org.manage', 'Bedrijfsinstellingen']]]
];
const REPEATS = { none: 'Niet herhalen', werkdag: 'Elke werkdag', dag: 'Elke dag', week: 'Elke week' };
const TIMEZONES = ['Europe/Amsterdam', 'Europe/Brussels', 'Europe/Berlin', 'Europe/London', 'Europe/Paris', 'America/Paramaribo', 'America/Curacao', 'Asia/Jakarta'];

const S = {
  me: null, org: null, perms: new Set(), roleName: '',
  authError: null, regInfo: null,
  counts: { mine: 0, pool: 0, tasks: 0 }, myCbs: [], poolCbs: [], myTasks: [], weekStats: null,
  seen: null, quiet: false, colleagues: [],
  cbTab: 'mine', cbList: [], cbSel: null, cbQ: '', cbResults: null,
  tView: 'mine', tasks: [], tWho: 'ALL', showArchive: false, searchOpen: false, q: '', results: null,
  team: null, stats: null, statDays: 7, log: null, logUser: '', logQ: '',
  members: [], roles: null, mSel: null, mNew: false, shownCode: null, rSel: null, rNew: false,
  F: null, T: null, edit: null, dup: null,
  nowWeek: null, running: null, pendingCount: 0,
  hours: null, hWeek: null, hMember: null, hKeep: false, hEdit: null,
  roster: null, rosterWeek: null, shiftEdit: null,
  pending: null, pOff: {}, rejectFor: null,
  report: null, repPeriod: 'maand', repFrom: null, repTo: null,
  kb: null, kbQ: '', kbCat: '', kbSel: null, kbArticle: null, kbEdit: null,
  docs: null, docFolder: null, folderEdit: null, uploading: null
};
const can = p => S.perms.has(p);
const same = (a, b) => a != null && b != null && String(a) === String(b);

// ---------- hulpjes ----------
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function initials(name) {
  const p = String(name || '?').trim().split(/\s+/);
  return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : (p[0][1] || ''))).toUpperCase();
}
const COLORS = ['#334155', '#0F766E', '#1D4ED8', '#7A2E8E', '#9A3412', '#166534', '#9F1239', '#0E7490'];
function colorFor(id) { let h = 0; String(id).split('').forEach(c => { h = (h * 31 + c.charCodeAt(0)) >>> 0; }); return COLORS[h % COLORS.length]; }
function avatar(id, name, cls) { return '<span class="avatar ' + (cls || '') + '" style="background:' + colorFor(id) + '" title="' + esc(name) + '">' + esc(initials(name)) + '</span>'; }
function pad(n) { return String(n).padStart(2, '0'); }
function toLocalInput(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function isoToInput(v) { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : toLocalInput(d); }
function inputToIso(v) { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d.toISOString(); }
function defaultDue(hours) { const d = new Date(Date.now() + hours * 3600000); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0); return toLocalInput(d); }
const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const DAYS_FULL = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function sameDay(a, b) { return a.toDateString() === b.toDateString(); }
function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v); if (isNaN(d)) return '';
  const now = new Date(); const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return 'vandaag ' + hm(d);
  if (sameDay(d, y)) return 'gisteren ' + hm(d);
  return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + (d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : '') + ' ' + hm(d);
}
function humanMin(min) {
  if (min == null) return '–';
  if (min < 60) return Math.round(min) + ' min';
  const h = min / 60;
  if (h < 24) return (h < 10 ? h.toFixed(1).replace('.', ',') : Math.round(h)) + ' uur';
  const d = Math.floor(h / 24); return d + ' dag' + (d > 1 ? 'en' : '');
}
function dueBadge(v, kind) {
  if (!v) return '<span class="badge">' + (kind === 'bel' ? 'Geen tijd' : 'Geen deadline') + '</span>';
  const d = new Date(v); if (isNaN(d)) return '';
  const diff = Math.round((d - Date.now()) / 60000);
  const now = new Date(); const tm = new Date(now); tm.setDate(now.getDate() + 1);
  if (diff < 0) return '<span class="badge red">Te laat · ' + humanMin(-diff) + '</span>';
  if (diff <= 60) return '<span class="badge orange">' + (kind === 'bel' ? 'Bel vóór ' : 'Vóór ') + hm(d) + '</span>';
  if (sameDay(d, now)) return '<span class="badge green">Vandaag ' + hm(d) + '</span>';
  if (sameDay(d, tm)) return '<span class="badge">Morgen ' + hm(d) + '</span>';
  return '<span class="badge">' + DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + hm(d) + '</span>';
}
function isLate(v) { return v && new Date(v) < new Date(); }
function within(v, min) { if (!v) return false; const diff = (new Date(v) - Date.now()) / 60000; return diff >= 0 && diff <= min; }
function cbTitle(c) { return c.type === 'particulier' ? c.name : c.company; }
function canEditCb(c) { return can('callbacks.edit_all') || same(c.createdBy, S.me.id) || same(c.assignee, S.me.id); }
function canEditTask(t) { return can('tasks.edit_all') || same(t.createdBy, S.me.id); }
const settings = () => (S.org && S.org.settings) || {};

let toastTimer;
function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 3800);
}

// ---------- verbinding ----------
function cleanErr(m) { return String(m || 'Er ging iets mis.').replace(/^.*?ERROR:\s*/, ''); }
async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args || {});
  if (error) {
    if (error.code === '28000' || error.code === 'PGRST301' || /JWT expired|invalid JWT/i.test(error.message)) {
      await loggedOut('Je sessie is verlopen of je account is gedeactiveerd. Log opnieuw in.');
    }
    throw new Error(cleanErr(error.message));
  }
  return data;
}
async function svc(action, body) {
  const { data: { session } } = await sb.auth.getSession();
  let res;
  try {
    res = await fetch(CFG.supabaseUrl + '/functions/v1/crewdeck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: 'Bearer ' + (session ? session.access_token : CFG.supabaseKey) },
      body: JSON.stringify(Object.assign({ action }, body || {}))
    });
  } catch (e) { throw new Error('Geen verbinding met de server.'); }
  let data = {};
  try { data = await res.json(); } catch (e) { /* leeg */ }
  if (!res.ok) throw new Error(data.error || 'Er ging iets mis.');
  return data;
}
async function loggedOut(msg) {
  try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* */ }
  S.me = null; S.seen = null; S.perms = new Set(); S.authError = msg || null;
  if (!['login', 'registreren'].includes(route())) location.hash = '#/login';
  render();
}
async function loadSession() {
  const s = await rpc('cd_session');
  S.me = s.member; S.org = s.org; S.perms = new Set(s.perms); S.roleName = s.member.roleName;
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
  shield: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/></svg>',
  alert: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B42318" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;margin-top:1px"><circle cx="12" cy="12" r="10"/><path d="M12 7v6M12 16.5v.5"/></svg>',
  warn: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B54708" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;margin-top:1px"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/></svg>',
  check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#067647" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none"><path d="M5 12l5 5L20 7"/></svg>',
  left: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  chev: '<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  download: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  upload: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20V9M7 14l5-5 5 5M5 4h14"/></svg>',
  pin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px"><path d="M12 17v5M8 3h8l-1 6 3 4H6l3-4z"/></svg>',
  file: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/></svg>',
  folder: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  tick: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>'
};
const NI = (() => {
  const i = d => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  return {
    overzicht: i('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
    terugbellen: i('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'),
    taken: i('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m8 12 3 3 5-6"/>'),
    uren: i('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    rooster: i('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    goedkeuren: i('<path d="M20 6 9 17l-5-5"/>'),
    urenoverzicht: i('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    kennisbank: i('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M9 7h6"/>'),
    documenten: i('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    team: i('<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>'),
    cijfers: i('<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>'),
    logboek: i('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
    mensen: i('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a6 6 0 0 0-4-5.6"/>'),
    rollen: i('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>'),
    instellingen: i('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>')
  };
})();
const LOGO = size => '<span class="logo"><svg width="' + size + '" height="' + size + '" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#15233A"/><rect x="14" y="16" width="36" height="8" rx="4" fill="#2DD4BF"/><rect x="14" y="28" width="28" height="8" rx="4" fill="#5EEAD4" opacity=".85"/><rect x="14" y="40" width="20" height="8" rx="4" fill="#99F6E4" opacity=".7"/></svg>Crewdeck</span>';

// ---------- meldingen ----------
const prefs = (() => { try { return JSON.parse(localStorage.getItem('crewdeck-prefs') || '{}'); } catch (e) { return {}; } })();
function savePrefs() { try { localStorage.setItem('crewdeck-prefs', JSON.stringify(prefs)); } catch (e) { /* */ } }
if (prefs.sound === undefined) prefs.sound = true;
let audioCtx = null;
function unlockAudio() { if (audioCtx) return; try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; } }
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
  beep(); toast(title + (body ? ': ' + body : ''));
  if (canSysNotify() && Notification.permission === 'granted' && document.hidden) { try { new Notification(title, { body, icon: 'icon.svg' }); } catch (e) { /* */ } }
}
function updateTitle() {
  const n = S.counts.mine + S.counts.tasks;
  document.title = (n ? '(' + n + ') ' : '') + 'Crewdeck' + (S.org ? ' · ' + S.org.name : '');
}

// ---------- routes ----------
const ROUTES = ['overzicht', 'terugbellen', 'verzoek', 'taken', 'taak', 'uren', 'rooster', 'goedkeuren', 'urenoverzicht', 'kennisbank', 'documenten',
  'team', 'cijfers', 'logboek', 'mensen', 'rollen', 'instellingen', 'login', 'registreren'];
const ROUTE_PERM = { team: 'team.board', cijfers: 'reports.view', logboek: 'audit.view', instellingen: null, goedkeuren: 'hours.approve', urenoverzicht: 'hours.view_all',
  mensen: ['members.manage', 'roles.manage'], rollen: ['members.manage', 'roles.manage'] };
function route() { const h = location.hash.replace(/^#\/?/, ''); return ROUTES.includes(h) ? h : (S.me ? 'overzicht' : 'login'); }
function go(r) { if (location.hash === '#/' + r) onRoute(); else location.hash = '#/' + r; }
window.addEventListener('hashchange', onRoute);
function allowed(r) {
  const p = ROUTE_PERM[r];
  if (!p) return true;
  return Array.isArray(p) ? p.some(can) : can(p);
}

async function onRoute() {
  const r = route();
  if (!S.me) {
    if (r === 'registreren' && !S.regInfo) { try { S.regInfo = await svc('register-info'); } catch (e) { S.regInfo = { open: false }; } }
    if (r !== 'login' && r !== 'registreren') { location.hash = '#/login'; return; }
    render(); return;
  }
  if (r === 'login' || r === 'registreren') { go('overzicht'); return; }
  if (!allowed(r)) { go('overzicht'); return; }
  if (r === 'uren' && !S.hKeep) { S.hMember = null; }
  S.hKeep = false;
  if (r !== 'uren') S.hEdit = null;
  if (r !== 'rooster') S.shiftEdit = null;
  if (r !== 'documenten') S.folderEdit = null;
  try {
    if (r === 'verzoek' || r === 'taak') {
      await loadColleagues();
      const edit = S.edit; S.edit = null; S.dup = null;
      if (r === 'verzoek') {
        S.F = newCallbackForm();
        if (edit && edit.kind === 'cb') {
          const c = await rpc('cd_callback_get', { p_id: edit.id });
          Object.assign(S.F, { editId: c.id, type: c.type, company: c.company || '', contact: c.contact || '', name: c.name || '', phone: c.phone || '',
            email: c.email || '', order: c.order || '', category: c.category, priority: c.priority, dueAt: isoToInput(c.dueAt), note: c.note || '',
            assign: same(c.assignee, S.me.id) ? 'me' : (c.assignee ? 'colleague' : 'pool'), colleague: c.assignee && !same(c.assignee, S.me.id) ? String(c.assignee) : '' });
        }
      } else {
        S.T = newTaskForm();
        if (edit && edit.kind === 'task') {
          const t = await rpc('cd_task_get', { p_id: edit.id });
          const sel = {}; t.assignees.forEach(a => { sel[a.id] = true; });
          Object.assign(S.T, { editId: t.id, title: t.title, desc: t.desc || '', dueAt: isoToInput(t.dueAt), priority: t.priority, sel, mode: t.mode, repeat: t.repeat || 'none' });
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
  if (r === 'overzicht' && can('reports.view')) jobs.push(rpc('cd_stats', { p_days: 7 }).then(s => { S.weekStats = s; }));
  if (r === 'terugbellen') jobs.push(loadCallbacks(), loadColleagues());
  if (r === 'taken') jobs.push(loadTasks());
  if (r === 'team') jobs.push(rpc('cd_team_board').then(d => { S.team = d; }));
  if (r === 'cijfers') jobs.push(rpc('cd_stats', { p_days: S.statDays }).then(d => { S.stats = d; }));
  if (r === 'logboek') jobs.push(loadLog(), loadColleagues());
  if (r === 'mensen' || r === 'rollen') jobs.push(loadPeople());
  if (r === 'uren') jobs.push(loadHours());
  if (r === 'rooster') jobs.push(rpc('cd_roster', { p_week: S.rosterWeek || ymd(new Date()) }).then(d => { S.roster = d; S.rosterWeek = d.weekStart; }));
  if (r === 'goedkeuren') jobs.push(rpc('cd_hours_pending').then(d => { S.pending = d; }));
  if (r === 'urenoverzicht') jobs.push(loadReport());
  if (r === 'kennisbank') jobs.push(loadKb());
  if (r === 'documenten') jobs.push(loadDocs());
  await Promise.all(jobs);
}
async function loadCounts() {
  const [a, b, c, w, p] = await Promise.all([rpc('cd_callbacks', { p_scope: 'mine' }), rpc('cd_callbacks', { p_scope: 'pool' }), rpc('cd_tasks', { p_scope: 'mine' }),
    rpc('cd_hours_week', { p_member: null, p_week: null }), can('hours.approve') ? rpc('cd_hours_pending') : Promise.resolve([])]);
  S.nowWeek = w; S.running = w.running; S.pendingCount = p.length;
  const openTasks = c.filter(t => !t.done && !t.mineDone && !t.archived);
  S.myCbs = a; S.poolCbs = b; S.myTasks = c;
  S.counts = { mine: a.length, pool: b.length, tasks: openTasks.length };
  if (S.seen && !S.quiet) {
    const newCb = a.filter(x => !S.seen.cb.includes(x.id) && !same(x.createdBy, S.me.id));
    const newTk = openTasks.filter(x => !S.seen.task.includes(x.id) && !same(x.createdBy, S.me.id));
    if (newCb.length) notify(newCb.length === 1 ? 'Nieuw terugbelverzoek voor jou' : newCb.length + ' nieuwe terugbelverzoeken', newCb.map(cbTitle).join(', '));
    if (newTk.length) notify(newTk.length === 1 ? 'Nieuwe taak voor jou' : newTk.length + ' nieuwe taken', newTk.map(t => t.title).join(', '));
  }
  S.seen = { cb: [...new Set([...(S.seen ? S.seen.cb : []), ...a.map(x => x.id)])], task: [...new Set([...(S.seen ? S.seen.task : []), ...openTasks.map(x => x.id)])] };
  updateTitle();
}
async function loadColleagues() { S.colleagues = await rpc('cd_colleagues'); }
async function loadCallbacks() {
  if (S.cbTab === 'all' && !can('callbacks.view_all')) S.cbTab = 'mine';
  S.cbList = await rpc('cd_callbacks', { p_scope: S.cbTab });
  if (S.cbQ.trim().length >= 2) S.cbResults = await rpc('cd_callback_search', { p_q: S.cbQ.trim() });
  const list = S.cbResults && S.cbQ.trim().length >= 2 ? S.cbResults : S.cbList;
  if (!list.some(c => same(c.id, S.cbSel))) S.cbSel = list.length ? list[0].id : null;
}
async function loadTasks() {
  if (S.tView === 'all' && !can('tasks.view_all')) S.tView = 'mine';
  S.tasks = await rpc('cd_tasks', { p_scope: S.tView });
}
async function loadLog() { S.log = await rpc('cd_audit', { p_member: S.logUser || null, p_q: S.logQ.trim() || null }); }
async function loadPeople() {
  const [m, r] = await Promise.all([rpc('cd_members'), rpc('cd_roles')]);
  S.members = m; S.roles = r;
}

// ---------- render ----------
function render() {
  const r = route();
  if (!S.me) {
    document.title = 'Crewdeck';
    $app.innerHTML = r === 'registreren' ? viewRegister() : viewLogin();
    return;
  }
  const views = { overzicht: viewHome, terugbellen: viewCallbacks, verzoek: viewCallbackForm, taken: viewTasks, taak: viewTaskForm, team: viewTeam,
    cijfers: viewStats, logboek: viewLog, mensen: viewMembers, rollen: viewRoles, instellingen: viewSettings,
    uren: viewHours, rooster: viewRoster, goedkeuren: viewApprove, urenoverzicht: viewReport, kennisbank: viewKb, documenten: viewDocs };
  $app.innerHTML = '<div class="shell">' + viewNav(r) + '<main class="main' + (r === 'team' || r === 'rooster' ? ' wide' : '') + '" id="main">' + (views[r] || viewHome)() + '</main></div>';
  updateTitle();
}
function renderKeepFocus() {
  const a = document.activeElement; const id = a && a.id;
  const pos = a && typeof a.selectionStart === 'number' ? a.selectionStart : null;
  render();
  if (id) { const el = document.getElementById(id); if (el) { el.focus(); if (pos != null) try { el.setSelectionRange(pos, pos); } catch (e) { /* */ } } }
}

// ----- inloggen & registreren -----
function brandPanel(title, sub) {
  return '<section class="login-brand">' +
    '<div>' + LOGO(36) + '</div>' +
    '<div><h1>' + title + '</h1><p>' + sub + '</p>' +
    '<ul class="feature-list">' +
      ['Terugbelverzoeken en taken op één plek', 'Uren, in- en uitklokken en roosters', 'Kennisbank en documenten met rechten per map', 'Rollen, teambord, cijfers en een volledig logboek']
        .map(t => '<li>' + ICON.tick + '<span>' + t + '</span></li>').join('') + '</ul></div>' +
    '<div class="spark"><span>Een product van <strong>Spark Apps</strong></span></div></section>';
}
function viewLogin() {
  const last = (() => { try { return localStorage.getItem('crewdeck-company') || ''; } catch (e) { return ''; } })();
  return '<div class="login">' + brandPanel('Al het werk van je team. Eén dek.', 'Inloggen met je bedrijfscode, naam en persoonlijke code.') +
    '<section class="login-main"><form class="login-card" data-form="login" novalidate>' +
      '<div><h2>Inloggen</h2><p class="muted" style="margin:6px 0 0;font-size:14px">Je bedrijfscode en code krijg je van je beheerder.</p></div>' +
      (S.authError ? '<div class="alert error" role="alert">' + ICON.alert + '<span>' + esc(S.authError) + '</span></div>' : '') +
      '<div class="field"><label for="l-company">Bedrijfscode</label><input class="input" id="l-company" name="company" autocomplete="organization" autocapitalize="none" spellcheck="false" value="' + esc(last) + '" required></div>' +
      '<div class="field"><label for="l-name">Naam</label><input class="input" id="l-name" name="name" autocomplete="username" required></div>' +
      '<div class="field"><label for="l-code">Code</label><input class="input code-input" id="l-code" name="code" type="password" inputmode="numeric" autocomplete="current-password" required></div>' +
      '<button class="btn primary" type="submit" id="l-submit">Inloggen</button>' +
      '<p class="switch">Nieuw bij Crewdeck? <a href="#/registreren">Registreer je bedrijf</a></p>' +
    '</form></section></div>';
}
function viewRegister() {
  const info = S.regInfo || { open: false };
  let form;
  if (!info.open) {
    form = '<div class="login-card"><h2>Registreren</h2><div class="alert info"><span>Op deze server kunnen geen nieuwe bedrijven worden aangemaakt. Vraag je beheerder om een account.</span></div>' +
      '<p class="switch"><a href="#/login">Terug naar inloggen</a></p></div>';
  } else {
    form = '<form class="login-card" data-form="register" novalidate style="max-width:460px">' +
      '<div><h2>' + (info.firstSetup ? 'Crewdeck inrichten' : 'Bedrijf registreren') + '</h2><p class="muted" style="margin:6px 0 0;font-size:14px">Je wordt eigenaar van het account en hebt altijd alle rechten.</p></div>' +
      (S.authError ? '<div class="alert error" role="alert">' + ICON.alert + '<span>' + esc(S.authError) + '</span></div>' : '') +
      '<div class="field"><label for="r-org">Bedrijfsnaam</label><input class="input" id="r-org" name="orgName" autocomplete="organization" required></div>' +
      '<div class="field"><label for="r-slug">Bedrijfscode</label><input class="input" id="r-slug" name="slug" autocapitalize="none" spellcheck="false" pattern="[a-z0-9][a-z0-9-]{2,29}" required aria-describedby="r-slug-h">' +
        '<span class="small muted" id="r-slug-h">Hiermee logt je team in. 3 tot 30 tekens: kleine letters, cijfers en -</span></div>' +
      '<div class="field"><label for="r-name">Jouw naam</label><input class="input" id="r-name" name="ownerName" autocomplete="name" required></div>' +
      '<div class="field"><label for="r-code">Kies een code</label><input class="input code-input" id="r-code" name="code" type="password" inputmode="numeric" autocomplete="new-password" required aria-describedby="r-code-h">' +
        '<span class="small muted" id="r-code-h">6 tot 12 cijfers. Bewaar hem goed.</span></div>' +
      '<div class="honeypot" aria-hidden="true"><label for="r-web">Website</label><input id="r-web" name="website" tabindex="-1" autocomplete="off"></div>' +
      '<button class="btn primary" type="submit" id="r-submit">' + (info.firstSetup ? 'Inrichten' : 'Bedrijf aanmaken') + '</button>' +
      '<p class="switch">Al een account? <a href="#/login">Inloggen</a></p></form>';
  }
  return '<div class="login">' + brandPanel('Begin vandaag met Crewdeck.', 'In één minuut staat je bedrijf klaar. Daarna voeg je je team toe.') + '<section class="login-main">' + form + '</section></div>';
}

// ----- navigatie (groepen die je kunt in- en uitklappen) -----
function navGroups() {
  const G = [
    { id: 'werk', label: 'Werk', items: [['overzicht', 'Overzicht'], ['terugbellen', 'Terugbellen', S.counts.mine], ['taken', 'Taken', S.counts.tasks]] },
    { id: 'uren', label: 'Uren', items: [['uren', 'Mijn uren', 0, S.running ? 'live' : ''], ['rooster', 'Rooster'],
      can('hours.approve') ? ['goedkeuren', 'Goedkeuren', S.pendingCount] : null, can('hours.view_all') ? ['urenoverzicht', 'Urenoverzicht'] : null] },
    { id: 'kennis', label: 'Kennis', items: [['kennisbank', 'Kennisbank'], ['documenten', 'Documenten']] },
    { id: 'leiding', label: 'Teamleiding', items: [can('team.board') ? ['team', 'Teambord'] : null, can('reports.view') ? ['cijfers', 'Cijfers'] : null, can('audit.view') ? ['logboek', 'Logboek'] : null] },
    { id: 'beheer', label: 'Beheer', items: [can('members.manage') || can('roles.manage') ? ['mensen', 'Mensen'] : null,
      can('members.manage') || can('roles.manage') ? ['rollen', 'Rollen & rechten'] : null, ['instellingen', 'Instellingen']] }
  ];
  G.forEach(g => { g.items = g.items.filter(Boolean); });
  return G.filter(g => g.items.length);
}
function viewNav(r) {
  const cur = r === 'verzoek' ? 'terugbellen' : r === 'taak' ? 'taken' : r;
  const closed = prefs.navClosed || {};
  const link = ([to, label, count, flag]) => '<a href="#/' + to + '" class="' + (cur === to ? 'active' : '') + '"' + (cur === to ? ' aria-current="page"' : '') + '>' +
    '<span class="nav-label">' + NI[to] + '<span>' + esc(label) + '</span></span>' +
    (flag === 'live' ? '<span class="live-dot" title="Je bent ingeklokt"></span>' : count ? '<span class="nav-count">' + count + '</span>' : '') + '</a>';
  const groups = navGroups().map(g => {
    const hasActive = g.items.some(i => i[0] === cur);
    const open = hasActive || !closed[g.id];
    const sum = g.items.reduce((a, i) => a + (i[2] || 0), 0);
    return '<div class="nav-group' + (open ? ' open' : '') + '">' +
      '<button class="nav-group-btn" data-act="nav-group" data-v="' + g.id + '" aria-expanded="' + open + '" aria-controls="ng-' + g.id + '"' + (hasActive ? ' data-locked="1"' : '') + '>' +
        '<span>' + g.label + '</span><span class="nav-group-end">' + (!open && sum ? '<span class="nav-count">' + sum + '</span>' : '') + ICON.chev + '</span></button>' +
      '<div class="nav-group-items" id="ng-' + g.id + '">' + g.items.map(link).join('') + '</div></div>';
  }).join('');
  return '<nav class="nav" aria-label="Hoofdmenu">' +
    '<div class="nav-top"><div class="nav-brand">' + LOGO(26) + '<div class="nav-org">' + esc(S.org.name) + '</div></div>' +
    '<button class="menu-btn" data-act="menu" aria-expanded="false" aria-controls="nav-links">Menu</button></div>' +
    '<div class="nav-links" id="nav-links">' + groups + '</div>' +
    '<div class="nav-user">' +
      (S.running ? '<a class="nav-clock" href="#/uren">' + '<span class="live-dot"></span>Ingeklokt sinds ' + esc(S.running.start) + '</a>' : '') +
      '<div class="nav-user-row">' + avatar(S.me.id, S.me.name) +
      '<div><strong style="font-size:13px">' + esc(S.me.name) + '</strong><small>' + esc(S.roleName) + '</small></div></div>' +
      '<button class="link-btn" data-act="sound" aria-pressed="' + !!prefs.sound + '">' + ICON.bell + ' Geluid bij nieuw werk: ' + (prefs.sound ? 'aan' : 'uit') + '</button>' +
      (canSysNotify() && Notification.permission === 'default' ? '<button class="link-btn" data-act="notif-allow">Pop-upmeldingen aanzetten</button>' : '') +
      '<button class="link-btn" data-act="logout">Uitloggen</button></div></nav>';
}

// ----- overzicht -----
function viewHome() {
  const h = new Date().getHours();
  const groet = h < 12 ? 'Goedemorgen' : h < 18 ? 'Goedemiddag' : 'Goedenavond';
  const late = S.myCbs.filter(c => isLate(c.dueAt)).length;
  const openTasks = S.myTasks.filter(t => !t.done && !t.mineDone && !t.archived);
  let html = '<header class="page-head"><div class="hello"><h1>' + groet + ', ' + esc(S.me.name.split(' ')[0]) + '</h1>' +
    '<p>' + DAYS_FULL[new Date().getDay()] + ' ' + new Date().getDate() + ' ' + MONTHS[new Date().getMonth()] + ' · ' + esc(S.org.name) + '</p></div>' +
    '<div class="actions">' + (can('callbacks.create') ? '<a class="btn" href="#/verzoek">' + ICON.plus + 'Terugbelverzoek</a>' : '') +
    (can('tasks.create') ? '<a class="btn primary" href="#/taak">' + ICON.plus + 'Taak</a>' : '') + '</div></header>';
  html += '<div class="stats">' + stat('Mijn verzoeken', S.counts.mine) + stat('Daarvan te laat', late, late ? 'var(--red)' : null) +
    stat('Mijn open taken', S.counts.tasks) + stat('In de open pool', S.counts.pool, 'var(--blue)') + '</div>';
  const row = (href, title, badge) => '<a class="mini-row" href="' + href + '"><span>' + esc(title) + '</span>' + badge + '</a>';
  html += '<div class="cards">';
  html += homeHoursCard();
  html += '<section class="card"><h2>Eerst terugbellen</h2>' + (S.myCbs.length ? '<div class="mini-list">' +
    S.myCbs.slice(0, 5).map(c => row('#/terugbellen', cbTitle(c), dueBadge(c.dueAt, 'bel'))).join('') + '</div>' : '<p class="muted small">Geen open verzoeken. Lekker bezig!</p>') +
    '<p style="margin:12px 0 0"><a class="more" href="#/terugbellen">Alle verzoeken</a></p></section>';
  html += '<section class="card"><h2>Mijn taken</h2>' + (openTasks.length ? '<div class="mini-list">' +
    openTasks.slice(0, 5).map(t => row('#/taken', t.title, dueBadge(t.dueAt, 'taak'))).join('') + '</div>' : '<p class="muted small">Niets meer te doen.</p>') +
    '<p style="margin:12px 0 0"><a class="more" href="#/taken">Alle taken</a></p></section>';
  if (S.poolCbs.length) {
    html += '<section class="card"><h2>Open pool</h2><div class="mini-list">' + S.poolCbs.slice(0, 5).map(c => row('#/terugbellen', cbTitle(c), dueBadge(c.dueAt, 'bel'))).join('') +
      '</div><p style="margin:12px 0 0"><a class="more" href="#/terugbellen" data-act="go-pool">Bekijk en pak op</a></p></section>';
  }
  if (S.weekStats) {
    const T = S.weekStats.totals;
    html += '<section class="card"><h2>Team deze week</h2><dl class="kv"><dt>Binnengekomen</dt><dd>' + T.created + '</dd><dt>Afgerond</dt><dd>' + T.done + '</dd>' +
      '<dt>Gem. tot teruggebeld</dt><dd>' + humanMin(T.avgMin) + '</dd><dt>Nu te laat</dt><dd' + (T.lateNow ? ' style="color:var(--red)"' : '') + '>' + T.lateNow + '</dd></dl>' +
      '<p style="margin:12px 0 0"><a class="more" href="#/cijfers">Alle cijfers</a></p></section>';
  }
  html += '</div>';
  if (S.counts.mine === 0 && S.counts.tasks === 0 && S.counts.pool === 0 && (can('members.manage'))) {
    html += '<section class="card"><h2>Aan de slag</h2><p class="muted" style="margin:0 0 12px">Voeg je collega’s toe en geef ze een rol. Daarna kunnen jullie verzoeken en taken aan elkaar geven.</p>' +
      '<a class="btn primary" href="#/mensen">Mensen toevoegen</a></section>';
  }
  return html;
}

// ----- terugbellen -----
function stat(label, n, color) { return '<div class="stat"><span>' + label + '</span><strong' + (color ? ' style="color:' + color + '"' : '') + '>' + n + '</strong></div>'; }
function dd(label, val) { return '<div><dt>' + label + '</dt><dd>' + esc(val) + '</dd></div>'; }
function viewCallbacks() {
  const searching = S.cbQ.trim().length >= 2;
  const L = searching ? (S.cbResults || []) : S.cbList;
  const tabs = [['mine', 'Mijn verzoeken', S.counts.mine], ['pool', 'Open pool', S.counts.pool]];
  if (can('callbacks.view_all')) tabs.push(['all', 'Alle open', null]);
  tabs.push(['done', 'Afgerond', null]);
  let html = '<header class="page-head"><div><h1>Terugbellen</h1><p>Gesorteerd op urgentie</p></div>' +
    '<div class="actions">' + (can('callbacks.create') ? '<a class="btn primary" href="#/verzoek">' + ICON.plus + 'Nieuw verzoek</a>' : '') + '</div></header>';
  html += '<div class="search soft"><label class="sr-only" for="cb-q">Klant zoeken</label>' + ICON.search +
    '<input id="cb-q" type="search" data-in="cbq" value="' + esc(S.cbQ) + '" placeholder="Klant zoeken op naam, bedrijf, ordernummer of telefoon…" autocomplete="off">' +
    (S.cbQ ? '<button class="icon-btn small" data-act="cb-clearq" aria-label="Zoekopdracht wissen">' + ICON.x + '</button>' : '') + '</div>';
  if (searching) {
    html += '<div class="section-title"><h2>Zoekresultaten · ' + L.length + '</h2><span class="small muted">Open en afgeronde verzoeken van iedereen</span></div>';
  } else {
    if (S.cbTab === 'mine') html += '<div class="stats">' + stat('Te laat', L.filter(c => isLate(c.dueAt)).length, 'var(--red)') +
      stat('Binnen 1 uur', L.filter(c => within(c.dueAt, 60)).length, 'var(--orange)') + stat('Open bij jou', L.length) + stat('In de open pool', S.counts.pool, 'var(--blue)') + '</div>';
    html += '<div class="seg" role="group" aria-label="Overzicht">' + tabs.map(t => '<button data-act="cb-tab" data-v="' + t[0] + '" class="' + (S.cbTab === t[0] ? 'on' : '') + '" aria-pressed="' + (S.cbTab === t[0]) + '">' + t[1] +
      (t[2] != null ? '<span class="cnt">' + t[2] + '</span>' : '') + '</button>').join('') + '</div>';
  }
  if (!L.length) {
    const msg = searching ? 'Geen verzoeken gevonden voor “' + esc(S.cbQ) + '”.' : { mine: 'Je hebt geen open terugbelverzoeken. Lekker bezig!', pool: 'De open pool is leeg.', all: 'Er staan geen open verzoeken.', done: 'Nog niets afgerond.' }[S.cbTab];
    return html + '<div class="empty">' + msg + '</div>';
  }
  html += '<div class="split"><div class="list">' + L.map(c => {
    const who = (searching || S.cbTab !== 'mine') ? (c.assigneeName ? 'Bij ' + c.assigneeName : 'In de open pool') : '';
    const tries = (c.attempts || []).filter(a => !/^Afgerond/.test(a.text)).length;
    const meta = [who, c.status === 'done' ? '' : (tries ? 'Poging ' + tries : 'Nog niet gebeld'), 'door ' + c.createdByName].filter(Boolean).join(' · ');
    const badge = c.status === 'done' ? '<span class="badge green">Afgerond ' + esc(fmtDate(c.doneAt)) + '</span>' : dueBadge(c.dueAt, 'bel');
    return '<button class="item' + (same(c.id, S.cbSel) ? ' sel' : '') + '" data-act="cb-sel" data-id="' + c.id + '">' +
      '<span class="item-top">' + badge + '<span class="item-meta">' + esc(c.category) + (c.priority === 'hoog' ? ' · <strong style="color:var(--red)">Hoog</strong>' : '') + '</span></span>' +
      '<span class="item-title">' + esc(cbTitle(c)) + '</span>' +
      '<span class="item-sub">' + (c.contact ? 't.a.v. ' + esc(c.contact) + ' · ' : '') + 'Order ' + esc(c.order) + ' · ' + esc(c.phone) + '</span>' +
      '<span class="item-meta">' + esc(meta) + '</span></button>';
  }).join('') + '</div>';
  const sel = L.find(c => same(c.id, S.cbSel));
  return html + '<aside class="detail card">' + (sel ? viewCallbackDetail(sel) : '') + '</aside></div>';
}
function viewCallbackDetail(c) {
  const isDone = c.status === 'done';
  const tries = (c.attempts || []).filter(a => !/^Afgerond/.test(a.text)).length;
  let h = '<div style="display:flex;flex-direction:column;gap:18px">' +
    '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><div style="margin-bottom:6px">' +
    (isDone ? '<span class="badge green">Afgerond door ' + esc(c.doneByName) + '</span>' : dueBadge(c.dueAt, 'bel')) +
    (c.priority === 'hoog' ? ' <span class="badge red">Hoge prioriteit</span>' : '') + '</div><h2 style="margin:0;font-size:22px">' + esc(cbTitle(c)) + '</h2></div>' +
    (canEditCb(c) ? '<button class="btn small" data-act="cb-edit" data-id="' + c.id + '">' + ICON.edit + 'Bewerken</button>' : '') + '</div>' +
    '<dl class="dl">' + (c.type === 'zakelijk' ? dd('Contactpersoon', c.contact || '–') : dd('Soort', 'Particulier')) +
      '<div><dt>Telefoon</dt><dd><a href="tel:' + esc(String(c.phone).replace(/[^\d+]/g, '')) + '">' + esc(c.phone) + '</a></dd></div>' +
      dd('Ordernummer', c.order) + dd('Categorie', c.category) +
      (c.email ? '<div class="full"><dt>E-mail</dt><dd><a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a></dd></div>' : '') +
      dd('Toegewezen aan', c.assigneeName || 'Open pool') + dd('Aangemaakt', fmtDate(c.createdAt) + ' door ' + c.createdByName) +
      (c.note ? '<div class="full"><dt>Reden / notitie</dt><dd>' + esc(c.note) + '</dd></div>' : '') + '</dl>';
  if (c.attempts && c.attempts.length) {
    h += '<div class="detail-section"><span class="legend">Belpogingen &amp; notities</span><div class="attempts">' +
      c.attempts.map(a => '<div><time>' + esc(fmtDate(a.at)) + '</time><span>' + esc(a.text) + ' <span class="muted">· ' + esc(a.byName) + '</span></span></div>').join('') + '</div></div>';
  }
  if (!isDone && tries >= 3) h += '<div class="alert info"><span><strong>3x niet bereikt</strong>Stuur de klant een mail of sms, of zet het verzoek terug in de pool.</span></div>';
  if (isDone) return h + '<div class="detail-section"><button class="btn" data-act="cb-reopen" data-id="' + c.id + '">Weer openzetten</button></div></div>';
  if (!c.assignee) h += '<div class="detail-section"><button class="btn primary" data-act="cb-claim" data-id="' + c.id + '">Pak ik op</button></div>';
  const quick = settings().quick_notes || [];
  h += '<div class="detail-section"><label class="legend" for="cb-note">Notitie bij dit gesprek <small>(optioneel)</small></label>' +
    (quick.length ? '<div class="chips" role="group" aria-label="Snelnotities">' + quick.map(q => '<button type="button" class="chip quick" data-act="cb-quick" data-v="' + esc(q) + '">' + esc(q) + '</button>').join('') + '</div>' : '') +
    '<input class="input" id="cb-note" placeholder="Typ een notitie of kies hierboven">' +
    '<div class="grid2"><button class="btn green" data-act="cb-done" data-id="' + c.id + '">Gebeld, afgerond</button><button class="btn" data-act="cb-attempt" data-id="' + c.id + '">Niet bereikt</button></div></div>';
  if (can('callbacks.assign')) {
    h += '<div class="detail-section"><label class="legend" for="cb-assign">Toewijzen aan collega</label><div class="row"><select class="input" id="cb-assign">' +
      S.colleagues.map(u => '<option value="' + u.id + '"' + (same(u.id, c.assignee) ? ' selected' : '') + '>' + esc(same(u.id, S.me.id) ? 'Ikzelf' : u.name) + ' (' + u.open + ' open)</option>').join('') +
      '<option value="pool"' + (!c.assignee ? ' selected' : '') + '>Terug naar open pool</option></select><button class="btn dark" data-act="cb-assign" data-id="' + c.id + '">Wijs toe</button></div></div>';
  } else if (same(c.assignee, S.me.id)) {
    h += '<div class="detail-section"><button class="btn" data-act="cb-topool" data-id="' + c.id + '">Terug naar open pool</button></div>';
  }
  return h + '</div>';
}

// ----- verzoek (nieuw / bewerken) -----
function newCallbackForm() {
  const cats = settings().categories || ['Overig'];
  return { editId: null, type: 'zakelijk', company: '', contact: '', name: '', phone: '', email: '', order: '', category: cats[0], priority: 'normaal',
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
    S.dup.map(d => esc(d.title) + ' · order ' + esc(d.order) + ' · ' + (d.assigneeName ? 'bij ' + esc(d.assigneeName) : 'in de open pool') + (d.dueAt ? ' · bel vóór ' + esc(fmtDate(d.dueAt)) : '') +
      ' <span class="small">(zelfde ' + [d.sameOrder ? 'ordernummer' : '', d.samePhone ? 'telefoonnummer' : ''].filter(Boolean).join(' en ') + ')</span>').join('<br>') +
    '<br><span class="small">Check eerst of je dit verzoek nog nodig hebt, zodat de klant niet twee keer gebeld wordt.</span></span></div>';
}
function viewCallbackForm() {
  const F = S.F; const edit = !!F.editId;
  const errors = cbMissing(F); const errList = Object.keys(errors);
  const names = { company: 'bedrijfsnaam', name: 'naam', phone: 'telefoonnummer', order: 'ordernummer', colleague: 'collega' };
  const cats = settings().categories || [];
  const catList = cats.includes(F.category) ? cats : [F.category].concat(cats);
  let h = '<div class="card form" style="align-self:center"><div><h1 style="margin:0;font-size:26px">' + (edit ? 'Verzoek bewerken' : 'Nieuw terugbelverzoek') + '</h1>' +
    '<p class="muted" style="margin:4px 0 0;font-size:14px">' + (edit ? 'Pas aan wat er niet klopt. Wijzigingen komen in het logboek.' : 'Vul in tijdens of direct na het gesprek.') + ' Velden met * zijn verplicht.</p></div>';
  if (F.tried && errList.length) h += '<div class="alert error" role="alert">' + ICON.alert + '<span><strong>Niet alle verplichte velden zijn ingevuld</strong>Vul nog in: ' + errList.map(k => names[k]).join(', ') + '.</span></div>';
  else if (F.serverError) h += '<div class="alert error" role="alert">' + ICON.alert + '<span>' + esc(F.serverError) + '</span></div>';
  h += '<div class="field"><span class="legend">Soort klant *</span><div class="row">' +
    '<button type="button" class="btn' + (F.type === 'particulier' ? ' on' : '') + '" data-act="f-type" data-v="particulier" aria-pressed="' + (F.type === 'particulier') + '">Particulier</button>' +
    '<button type="button" class="btn' + (F.type === 'zakelijk' ? ' on' : '') + '" data-act="f-type" data-v="zakelijk" aria-pressed="' + (F.type === 'zakelijk') + '">Zakelijk</button></div></div>';
  h += '<div class="fields2">' + (F.type === 'zakelijk'
      ? inputField('f-company', 'Bedrijfsnaam', F, 'company', { req: 1, errors, ph: 'Bijv. Beeldwerk Media BV' }) + inputField('f-contact', 'Contactpersoon', F, 'contact', { ph: 'optioneel' })
      : inputField('f-name', 'Naam', F, 'name', { req: 1, errors, ph: 'Voor- en achternaam', span: 1 })) +
    inputField('f-phone', 'Telefoonnummer', F, 'phone', { req: 1, errors, type: 'tel', ph: '06 …' }) + inputField('f-order', 'Ordernummer', F, 'order', { req: 1, errors, ph: 'Bijv. 123456' }) +
    '<div class="span2" id="dup">' + viewDup() + '</div>' + inputField('f-email', 'E-mail', F, 'email', { type: 'email', ph: 'optioneel', span: 1 }) + '</div>';
  h += '<div class="fields3"><div class="field"><label for="f-cat">Categorie</label><select class="input" id="f-cat" data-f="category">' + catList.map(c => '<option' + (F.category === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select></div>' +
    '<div class="field"><label for="f-prio">Prioriteit</label><select class="input" id="f-prio" data-f="priority">' + ['normaal', 'hoog', 'laag'].map(p => '<option value="' + p + '"' + (F.priority === p ? ' selected' : '') + '>' + p[0].toUpperCase() + p.slice(1) + '</option>').join('') + '</select></div>' +
    '<div class="field"><label for="f-due">Bel vóór</label><input class="input" id="f-due" type="datetime-local" data-f="dueAt" value="' + esc(F.dueAt) + '"></div></div>';
  h += '<div class="field"><label for="f-note">Reden / notitie</label><textarea class="input" id="f-note" data-f="note" rows="3" placeholder="Waar gaat het over?">' + esc(F.note) + '</textarea></div>';
  const ca = can('callbacks.assign');
  const opt = (v, label) => '<button type="button" class="btn' + (F.assign === v ? ' on' : '') + '" data-act="f-assign" data-v="' + v + '" aria-pressed="' + (F.assign === v) + '">' + label + '</button>';
  h += '<fieldset class="box' + (F.tried && errors.colleague ? ' bad' : '') + '" style="margin:0"><legend class="legend" style="padding:0 6px">Wie belt terug?</legend><div class="row">' +
    opt('me', 'Ikzelf') + (ca ? opt('colleague', 'Collega') : '') + opt('pool', 'Open pool') + (ca && !edit ? opt('auto', 'Automatisch verdelen') : '') + '</div>';
  if (F.assign === 'colleague') {
    h += '<div class="field"><label for="f-coll">Collega</label><select class="input' + (F.tried && errors.colleague ? ' bad' : '') + '" id="f-coll" data-f="colleague"><option value="">Kies een collega…</option>' +
      S.colleagues.filter(u => !same(u.id, S.me.id)).map(u => '<option value="' + u.id + '"' + (same(F.colleague, u.id) ? ' selected' : '') + '>' + esc(u.name) + ' (' + u.open + ' open)</option>').join('') + '</select></div>';
  }
  if (F.assign === 'auto') h += '<p class="muted small" style="margin:0">Gaat naar de collega met de minste openstaande verzoeken en taken.</p>';
  h += '</fieldset><div class="form-foot">' + (edit && can('callbacks.delete') ? '<button class="btn danger" data-act="f-delete" style="margin-right:auto">' + ICON.trash + 'Verwijderen</button>' : '') +
    '<a class="btn" href="#/terugbellen">Annuleren</a><button class="btn primary" data-act="f-save"' + (F.saving ? ' disabled' : '') + '>' + (edit ? 'Wijzigingen opslaan' : 'Verzoek opslaan') + '</button></div></div>';
  return h;
}

// ----- taken -----
function viewTasks() {
  const all = S.tView === 'all';
  let h = '<header class="page-head" style="max-width:920px"><div><h1>' + (all ? 'Alle taken' : 'Mijn taken') + '</h1><p>' +
    (all ? 'Alle taken van het team.' : 'Wat je nog moet doen, ook taken die je met collega’s deelt.') + '</p></div>' +
    '<div class="actions"><button class="btn' + (S.searchOpen ? ' on' : '') + '" data-act="t-search" aria-expanded="' + S.searchOpen + '">' + ICON.search + 'Bestaat deze taak al?</button>' +
    (can('tasks.create') ? '<a class="btn primary" href="#/taak">' + ICON.plus + 'Nieuwe taak</a>' : '') + '</div></header>';
  if (can('tasks.view_all')) h += '<div class="seg" role="group" aria-label="Weergave"><button data-act="t-view" data-v="mine" class="' + (!all ? 'on' : '') + '" aria-pressed="' + !all + '">Mijn taken</button>' +
    '<button data-act="t-view" data-v="all" class="' + (all ? 'on' : '') + '" aria-pressed="' + all + '">Alle taken</button></div>';
  if (S.searchOpen) h += viewSearch();
  return h + (all ? viewAllTasks() : viewMyTasks());
}
function viewSearch() {
  return '<section class="card stack" style="gap:14px;padding:20px" aria-label="Controleer of een taak al bestaat">' +
    '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><h2 style="margin:0;font-size:16px">Controleer of deze taak al bestaat</h2>' +
    '<p class="muted" style="margin:2px 0 0;font-size:13px">Zoekt in alle taken van het team, ook die van anderen en wat al af is.</p></div>' +
    '<button class="icon-btn" data-act="t-search" aria-label="Sluiten">' + ICON.x + '</button></div>' +
    '<label class="sr-only" for="t-q">Zoek in alle taken</label><div class="search">' + ICON.search + '<input id="t-q" type="search" data-in="q" value="' + esc(S.q) + '" placeholder="Bijv. retour 482913, prijslijst, showroom…" autocomplete="off"></div>' +
    '<div id="search-results">' + viewResults() + '</div></section>';
}
function viewResults() {
  if (S.results == null) return '<p class="muted small" style="margin:0">Typ minstens 3 letters. Je hoeft niet de precieze woorden te gebruiken.</p>';
  if (!S.results.length) return '<div class="alert ok" style="justify-content:space-between;flex-wrap:wrap"><span style="display:flex;gap:10px;align-items:center">' + ICON.check +
    '<span><strong style="display:inline">Niets gevonden.</strong> Deze taak bestaat nog niet.</span></span>' + (can('tasks.create') ? '<a class="btn green" href="#/taak">Nu aanmaken</a>' : '') + '</div>';
  return '<div class="stack" style="gap:8px"><span class="small" style="font-weight:600;color:var(--orange)">Let op: ' + S.results.length + ' ' + (S.results.length === 1 ? 'taak lijkt' : 'taken lijken') + ' hierop. Check deze eerst.</span>' +
    S.results.map(r => '<div class="result"><div style="flex:1 1 280px;min-width:0;display:flex;flex-direction:column;gap:4px">' +
      '<div class="row" style="align-items:center"><span class="badge ' + (r.strong ? 'red' : 'orange') + '">' + (r.strong ? 'Sterke match' : 'Lijkt erop') + '</span><span class="item-title" style="font-size:15px">' + esc(r.title) + '</span></div>' +
      '<span class="item-sub">' + esc(r.desc || 'Geen omschrijving') + '</span></div>' +
      '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px"><span class="badge ' + (r.done ? 'green' : 'blue') + '">' + (r.done ? 'Afgerond' : 'Open') + (r.dueAt ? ' · ' + esc(fmtDate(r.dueAt)) : '') + '</span>' +
      '<span class="small muted">Voor ' + esc((r.assignees || []).join(', ')) + '</span></div></div>').join('') + '</div>';
}
function peopleStack(t) { return '<span class="people">' + t.assignees.map(a => avatar(a.id, a.name, 'sm')).join('') + '</span>'; }
function taskMeta(t) {
  const by = same(t.createdBy, S.me.id) ? 'door jou' : 'van ' + t.createdByName;
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
  h += open.length ? open.map(t => '<article class="task"><input type="checkbox" data-act="t-toggle" data-id="' + t.id + '" aria-label="' + esc(t.title) + ' afvinken">' +
    '<div class="task-body"><div class="item-top"><span class="item-title">' + esc(t.title) + (t.priority === 'hoog' ? ' <span class="badge red">Hoog</span>' : '') + '</span>' + dueBadge(t.dueAt, 'taak') + '</div>' +
    (t.desc ? '<span class="item-sub" style="white-space:pre-wrap">' + esc(t.desc) + '</span>' : '') +
    '<div class="row" style="align-items:center;gap:12px">' + peopleStack(t) + '<span class="item-meta" style="padding-left:6px;flex:1">' + taskMeta(t) + '</span>' + editBtn(t) + '</div></div></article>').join('')
    : '<div class="empty">Niets meer te doen. Top!</div>';
  h += '</section><section class="stack"><div class="section-title"><h2>Afgerond · ' + done.length + '</h2>' + (done.length ? '<button class="btn small" data-act="t-archive-all">' + ICON.box + 'Alles archiveren</button>' : '') + '</div>';
  h += done.map(t => {
    const meta = (!t.done && t.mineDone) ? 'Jij klaar · wacht op anderen (' + t.doneCount + '/' + t.assignees.length + ')' : t.mineDone ? 'Afgerond' : 'Afgerond door ' + t.assignees.filter(a => a.done).map(a => a.name).join(', ');
    return '<article class="task done"><input type="checkbox" checked data-act="t-toggle" data-id="' + t.id + '"' + (t.mineDone ? '' : ' disabled') + ' aria-label="' + esc(t.title) + ' weer openzetten">' +
      '<span class="item-title" style="flex:1 1 200px;min-width:0">' + esc(t.title) + '</span><span class="item-meta">' + esc(meta) + '</span>' +
      '<button class="btn small ghost" data-act="t-archive" data-id="' + t.id + '">' + ICON.box + 'Archiveren</button></article>';
  }).join('');
  h += '</section><section class="stack"><button class="btn ghost" style="align-self:flex-start" data-act="t-archive-toggle" aria-expanded="' + S.showArchive + '">' + ICON.box + (S.showArchive ? 'Archief verbergen' : 'Archief bekijken') + ' (' + arch.length + ')</button>';
  if (S.showArchive) h += arch.length ? arch.map(t => '<article class="task archived"><span style="flex:1 1 200px;min-width:0;color:var(--muted)">' + esc(t.title) + '</span><span class="item-meta">Gearchiveerd</span>' +
    '<button class="btn small" data-act="t-restore" data-id="' + t.id + '">Terugzetten</button></article>').join('') : '<p class="muted small" style="margin:0">Het archief is leeg. Archiveer afgeronde taken om je lijst opgeruimd te houden.</p>';
  return h + '</section>';
}
function viewAllTasks() {
  const people = {};
  S.tasks.forEach(t => t.assignees.forEach(a => { people[a.id] = a.name; }));
  const filtered = S.tasks.filter(t => S.tWho === 'ALL' || t.assignees.some(a => same(a.id, S.tWho)));
  const open = filtered.filter(t => !t.done); const done = filtered.filter(t => t.done);
  let h = '<section class="stack" style="gap:14px"><div class="chips"><span class="muted small">Toon van:</span><button class="chip' + (S.tWho === 'ALL' ? ' on' : '') + '" data-act="t-who" data-v="ALL">Iedereen</button>' +
    Object.keys(people).sort((a, b) => people[a].localeCompare(people[b])).map(id => '<button class="chip' + (same(S.tWho, id) ? ' on' : '') + '" data-act="t-who" data-v="' + id + '">' + esc(same(id, S.me.id) ? 'Jij' : people[id]) + '</button>').join('') + '</div>';
  h += '<div class="section-title"><h2>Open · ' + open.length + '</h2></div>';
  h += open.length ? open.map(t => '<article class="task" style="align-items:center;flex-wrap:wrap">' + peopleStack(t) +
    '<div class="task-body" style="flex:1 1 260px;padding-left:6px"><span class="item-title" style="font-size:15px">' + esc(t.title) + '</span>' +
    '<span class="item-meta">Voor ' + esc(t.assignees.map(a => same(a.id, S.me.id) ? 'jij' : a.name).join(', ')) + (t.assignees.length > 1 && t.mode === 'iedereen' ? ' · ' + t.doneCount + '/' + t.assignees.length + ' klaar' : '') +
    ' · van ' + esc(t.createdByName) + (t.repeat && t.repeat !== 'none' ? ' · <span class="repeat">' + ICON.repeat + ' ' + esc(REPEATS[t.repeat]) + '</span>' : '') + '</span></div>' +
    dueBadge(t.dueAt, 'taak') + editBtn(t) + '</article>').join('') : '<div class="empty">Geen open taken.</div>';
  h += '<div class="section-title" style="margin-top:8px"><h2>Afgerond · ' + done.length + '</h2></div>';
  h += done.map(t => '<article class="task done"><span class="item-title" style="flex:1 1 260px;min-width:0">' + esc(t.title) + '</span><span class="item-meta">Voor ' + esc(t.assignees.map(a => a.name).join(', ')) + '</span></article>').join('');
  return h + '</section>';
}

// ----- taak (nieuw / bewerken) -----
function newTaskForm() {
  return { editId: null, title: '', desc: '', dueAt: '', priority: 'normaal', sel: can('tasks.assign') ? {} : { [S.me.id]: true }, mode: 'een', repeat: 'none', tried: false, serverError: null, similar: null, saving: false };
}
function taskErrors(T) {
  const e = {};
  if (!T.title.trim()) e.title = 'Geef de taak een titel';
  if (!Object.keys(T.sel).some(k => T.sel[k])) e.people = 'Kies minstens één persoon';
  if (T.repeat !== 'none' && !T.dueAt) e.dueAt = 'Kies een deadline, dan weet Crewdeck wanneer de herhaling moet komen';
  return e;
}
function viewTaskForm() {
  const T = S.T; const edit = !!T.editId;
  const chosen = Object.keys(T.sel).filter(k => T.sel[k]);
  const errors = taskErrors(T); const errNames = { title: 'titel', people: 'voor wie', dueAt: 'deadline' };
  let h = '<div class="card form" style="align-self:center"><div><h1 style="margin:0;font-size:26px">' + (edit ? 'Taak bewerken' : 'Nieuwe taak') + '</h1><p class="muted" style="margin:4px 0 0;font-size:14px">' +
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
  const ca = can('tasks.assign'); const pErr = T.tried && errors.people;
  const list = ca ? S.colleagues : S.colleagues.filter(u => same(u.id, S.me.id));
  const allOn = ca && list.length && list.every(u => T.sel[u.id]);
  h += '<fieldset class="box' + (pErr ? ' bad' : '') + '" style="margin:0"><legend class="legend" style="padding:0 6px">Voor wie? *' + (ca ? ' <small>(meerdere mogelijk)</small>' : '') + '</legend><div class="row">' +
    list.slice().sort((a, b) => (same(b.id, S.me.id) ? 1 : 0) - (same(a.id, S.me.id) ? 1 : 0)).map(u => '<button type="button" class="person-chip' + (T.sel[u.id] ? ' on' : '') + '" data-act="t-person" data-id="' + u.id + '" aria-pressed="' + !!T.sel[u.id] + '">' +
      avatar(u.id, u.name) + esc(same(u.id, S.me.id) ? 'Ikzelf' : u.name) + ' · ' + u.open + ' open</button>').join('') +
    (ca ? '<button type="button" class="chip" style="border-style:dashed;min-height:44px" data-act="t-allpeople">' + (allOn ? 'Niemand' : 'Hele team') + '</button>' : '') + '</div>' + (pErr ? '<span class="err-text">' + errors.people + '</span>' : '');
  if (chosen.length > 1) h += '<div style="display:flex;flex-direction:column;gap:8px;padding-top:12px;border-top:1px solid var(--line)"><span class="legend">Wanneer is de taak klaar?</span><div class="mode-choice">' +
    '<button type="button" class="' + (T.mode === 'een' ? 'on' : '') + '" data-act="t-mode" data-v="een" aria-pressed="' + (T.mode === 'een') + '"><strong>Zodra één persoon afvinkt</strong><small>Wie het eerst kan, pakt het op</small></button>' +
    '<button type="button" class="' + (T.mode === 'iedereen' ? 'on' : '') + '" data-act="t-mode" data-v="iedereen" aria-pressed="' + (T.mode === 'iedereen') + '"><strong>Pas als iedereen afvinkt</strong><small>Bijv. iets wat iedereen moet lezen</small></button></div></div>';
  h += '</fieldset><div class="form-foot">' + (edit && can('tasks.delete') ? '<button class="btn danger" data-act="t-delete" style="margin-right:auto">' + ICON.trash + 'Verwijderen</button>' : '') +
    '<a class="btn" href="#/taken">Annuleren</a><button class="btn primary" data-act="t-save"' + (T.saving ? ' disabled' : '') + '>' + (edit ? 'Wijzigingen opslaan' : 'Taak aanmaken') + '</button></div></div>';
  return h;
}
function viewSimilar() {
  const T = S.T;
  if (!T || !T.similar || !T.similar.length) return '';
  const open = T.similar.filter(r => !r.done && !same(r.id, T.editId)).slice(0, 3);
  if (!open.length) return '';
  return '<div class="alert info" style="margin-top:6px"><span><strong>Lijkt op een bestaande taak</strong>' + open.map(r => esc(r.title) + ' <span class="small">(voor ' + esc((r.assignees || []).join(', ')) + ')</span>').join('<br>') + '</span></div>';
}

// ----- teambord -----
function viewTeam() {
  const cols = S.team || [];
  let h = '<header class="page-head"><div><h1>Teambord</h1><p>Wat er bij wie open staat.' + (can('callbacks.assign') ? ' Sleep een terugbelverzoek naar een andere kolom om het te verplaatsen.' : '') + '</p></div>' +
    '<div class="actions"><button class="btn" data-act="team-refresh">Verversen</button></div></header>';
  const totLate = cols.reduce((n, c) => n + c.callbacks.filter(x => isLate(x.dueAt)).length, 0);
  h += '<div class="stats">' + stat('Open verzoeken', cols.reduce((n, c) => n + c.callbacks.length, 0)) + stat('Te laat', totLate, 'var(--red)') +
    stat('In de open pool', cols[0] ? cols[0].callbacks.length : 0, 'var(--blue)') + stat('Open taken', cols.reduce((n, c) => n + c.tasks.length, 0)) + '</div>';
  const drag = can('callbacks.assign');
  h += '<div class="board" role="list">' + cols.map(col => {
    const key = col.user ? String(col.user.id) : 'pool';
    const late = col.callbacks.filter(x => isLate(x.dueAt)).length; const load = col.callbacks.length + col.tasks.length;
    return '<section class="col" role="listitem" data-drop="' + key + '" aria-label="' + esc(col.user ? col.user.name : 'Open pool') + '">' +
      '<header class="col-head">' + (col.user ? avatar(col.user.id, col.user.name) : '<span class="avatar" style="background:#1D4ED8">P</span>') +
      '<div style="flex:1;min-width:0"><strong>' + esc(col.user ? (same(col.user.id, S.me.id) ? col.user.name + ' (jij)' : col.user.name) : 'Open pool') + '</strong>' +
      '<small>' + col.callbacks.length + ' verzoek' + (col.callbacks.length === 1 ? '' : 'en') + (col.user ? ' · ' + col.tasks.length + ' ' + (col.tasks.length === 1 ? 'taak' : 'taken') : '') + '</small></div>' +
      (late ? '<span class="badge red">' + late + ' te laat</span>' : (col.user && load >= 8 ? '<span class="badge orange">Druk</span>' : '')) + '</header><div class="col-body">' +
      (col.callbacks.length ? col.callbacks.map(c => '<article class="mini"' + (drag ? ' draggable="true" data-drag="' + c.id + '"' : '') + ' tabindex="0" data-act="team-open" data-id="' + c.id + '" aria-label="' + esc(cbTitle(c)) + '">' +
        '<div class="item-top">' + dueBadge(c.dueAt, 'bel') + (c.priority === 'hoog' ? '<span class="badge red">Hoog</span>' : '') + '</div>' +
        '<strong>' + esc(cbTitle(c)) + '</strong><span class="small muted">Order ' + esc(c.order) + ' · ' + esc(c.category) + '</span></article>').join('') : '<p class="small muted" style="margin:4px 2px">Geen open verzoeken</p>') +
      (col.tasks.length ? '<div class="col-tasks"><span class="small" style="font-weight:600;color:var(--ink-2)">Taken</span>' + col.tasks.map(t => '<div class="mini-task"><span>' + esc(t.title) + '</span>' + (t.dueAt ? dueBadge(t.dueAt, 'taak') : '') + '</div>').join('') + '</div>' : '') +
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
  h += '<div class="stats">' + stat('Verzoeken binnengekomen', T.created) + stat('Afgerond', T.done, 'var(--green)') + stat('Gemiddeld tot teruggebeld', humanMin(T.avgMin)) +
    stat('Te laat afgerond', T.latePct == null ? '–' : T.latePct + '%', T.latePct > 20 ? 'var(--red)' : null) + '</div>';
  h += '<div class="stats">' + stat('Nu open', T.openNow) + stat('Nu te laat', T.lateNow, 'var(--red)') + stat('Nu in de pool', T.poolNow, 'var(--blue)') + '<div class="stat" aria-hidden="true" style="visibility:hidden"></div></div>';
  const max = Math.max(1, ...s.perDay.map(d => Math.max(d.created, d.done)));
  const every = s.days > 30 ? 7 : (s.days > 7 ? 3 : 1);
  h += '<section class="card"><div class="section-title" style="margin-bottom:12px"><h2>Per dag</h2><span class="legend-row"><span class="dot blue"></span>Binnengekomen <span class="dot green"></span>Afgerond</span></div>' +
    '<div class="chart" role="img" aria-label="Verzoeken per dag: binnengekomen en afgerond">' + s.perDay.map((d, i) => {
      const dt = new Date(d.date + 'T12:00');
      return '<div class="bar-group" title="' + esc(DAYS[dt.getDay()] + ' ' + dt.getDate() + ' ' + MONTHS[dt.getMonth()] + ': ' + d.created + ' binnen, ' + d.done + ' afgerond') + '">' +
        '<div class="bars"><span class="bar blue" style="height:' + (d.created / max * 100) + '%"></span><span class="bar green" style="height:' + (d.done / max * 100) + '%"></span></div>' +
        '<span class="bar-label">' + (i % every === 0 ? dt.getDate() + ' ' + MONTHS[dt.getMonth()] : '') + '</span></div>';
    }).join('') + '</div></section>';
  h += '<div class="split" style="align-items:stretch"><section class="card" style="flex:2 1 460px;min-width:0"><h2>Per collega</h2>' +
    (s.people.length ? '<div class="table-wrap" style="border:0"><table><thead><tr><th>Naam</th><th>Afgerond</th><th>Gem. tijd</th><th>Te laat</th><th>Belpogingen</th><th>Taken af</th><th>Nu open</th></tr></thead><tbody>' +
      s.people.map(p => '<tr><td class="pad"><strong>' + esc(p.name) + '</strong></td><td class="pad">' + p.done + '</td><td class="pad">' + humanMin(p.avgMin) + '</td><td class="pad">' + (p.late ? '<span style="color:var(--red)">' + p.late + '</span>' : 0) +
        '</td><td class="pad">' + p.attempts + '</td><td class="pad">' + p.tasksDone + '</td><td class="pad">' + p.openNow + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted small">Nog geen gegevens in deze periode.</p>') + '</section>';
  const cmax = Math.max(1, ...s.categories.map(c => c.count));
  h += '<section class="card" style="flex:1 1 260px;min-width:0"><h2>Per categorie</h2>' + (s.categories.length ? s.categories.map(c => '<div class="hbar"><span>' + esc(c.name) + '</span><span class="hbar-track"><span style="width:' + (c.count / cmax * 100) + '%"></span></span><strong>' + c.count + '</strong></div>').join('')
    : '<p class="muted small">Nog geen verzoeken in deze periode.</p>') + '</section></div>';
  return h;
}

// ----- logboek -----
const LOG_LABEL = { 'verzoek-nieuw': ['Nieuw', 'blue'], 'verzoek-bewerkt': ['Bewerkt', ''], 'verzoek-verwijderd': ['Verwijderd', 'red'], 'verzoek-poging': ['Belpoging', ''], 'verzoek-afgerond': ['Afgerond', 'green'],
  'verzoek-heropend': ['Heropend', 'orange'], 'verzoek-opgepakt': ['Opgepakt', 'blue'], 'verzoek-toegewezen': ['Toegewezen', 'blue'], 'taak-nieuw': ['Nieuwe taak', 'blue'], 'taak-bewerkt': ['Taak bewerkt', ''],
  'taak-verwijderd': ['Taak verwijderd', 'red'], 'taak-afgevinkt': ['Afgevinkt', 'green'], 'taak-heropend': ['Taak open', 'orange'], 'taak-herhaling': ['Herhaling', ''],
  'medewerker-nieuw': ['Medewerker', 'dark'], 'medewerker-bewerkt': ['Medewerker', 'dark'], 'medewerker-code': ['Code', 'dark'], 'rol-nieuw': ['Rol', 'dark'], 'rol-bewerkt': ['Rol', 'dark'],
  'rol-verwijderd': ['Rol', 'red'], 'bedrijf-nieuw': ['Bedrijf', 'dark'], 'bedrijf-bewerkt': ['Bedrijf', 'dark'],
  'uren-ingediend': ['Uren ingediend', 'blue'], 'uren-goedgekeurd': ['Uren goed', 'green'], 'uren-afgekeurd': ['Uren afgekeurd', 'red'], 'uren-heropend': ['Uren terug', 'orange'],
  'rooster': ['Rooster', ''], 'kennisbank': ['Kennisbank', ''], 'documenten': ['Documenten', ''] };
function viewLog() {
  const L = S.log;
  let h = '<header class="page-head"><div><h1>Logboek</h1><p>Wie wat heeft aangemaakt, gewijzigd, toegewezen of afgerond.</p></div></header>' +
    '<div class="row" style="max-width:920px"><label class="sr-only" for="log-user">Persoon</label><select class="input" id="log-user" data-in="loguser" style="flex:0 1 220px"><option value="">Iedereen</option>' +
    S.colleagues.map(u => '<option value="' + u.id + '"' + (same(S.logUser, u.id) ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('') + '</select>' +
    '<label class="sr-only" for="log-q">Zoeken in logboek</label><input class="input" id="log-q" type="search" data-in="logq" value="' + esc(S.logQ) + '" placeholder="Zoek, bijv. een klantnaam of ordernummer" autocomplete="off"></div>';
  if (!L) return h;
  if (!L.entries.length) return h + '<div class="empty">Niets gevonden.</div>';
  let lastDay = '';
  h += '<div class="card log" style="max-width:920px;padding:8px 0">' + L.entries.map(e => {
    const d = new Date(e.at);
    const day = sameDay(d, new Date()) ? 'Vandaag' : DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    const head = day !== lastDay ? '<div class="log-day">' + day + '</div>' : ''; lastDay = day;
    const lab = LOG_LABEL[e.action] || [e.action, ''];
    return head + '<div class="log-row"><time>' + hm(d) + '</time><span class="badge ' + lab[1] + '">' + esc(lab[0]) + '</span><span class="log-text">' + esc(e.text) + '</span><span class="small muted">' + esc(e.byName) + '</span></div>';
  }).join('') + '</div>' + (L.total > L.entries.length ? '<p class="small muted">De laatste ' + L.entries.length + ' van ' + L.total + ' regels. Zoek of filter om verder terug te kijken.</p>' : '');
  return h;
}

// ----- mensen -----
function codeAlert() {
  if (!S.shownCode) return '';
  return '<div class="alert info" role="status" style="justify-content:space-between;flex-wrap:wrap;align-items:center"><span><strong>' + (S.shownCode.own ? 'Je nieuwe code' : 'Inloggegevens voor ' + esc(S.shownCode.name)) + '</strong>' +
    (S.shownCode.own ? 'Gebruik deze code voortaan om in te loggen.' : 'Bedrijfscode <strong style="display:inline">' + esc(S.org.slug) + '</strong>, naam <strong style="display:inline">' + esc(S.shownCode.name) + '</strong>. Deze code wordt maar één keer getoond.') + '</span>' +
    '<span class="code-big">' + esc(S.shownCode.code) + '</span><button class="btn small" data-act="hidecode">Ik heb hem genoteerd</button></div>';
}
function viewMembers() {
  const mm = can('members.manage');
  let h = '<header class="page-head"><div><h1>Mensen</h1><p>Iedereen logt in met de bedrijfscode <strong>' + esc(S.org.slug) + '</strong>, zijn naam en een persoonlijke code.</p></div>' +
    (mm ? '<div class="actions"><button class="btn primary" data-act="m-new">' + ICON.plus + 'Medewerker toevoegen</button></div>' : '') + '</header>' + codeAlert();
  h += '<div class="split"><div class="list"><div class="table-wrap"><table><thead><tr><th>Naam</th><th>Rol</th><th>Contract</th><th>Status</th><th>Laatst ingelogd</th></tr></thead><tbody>' +
    S.members.map(u => {
      const cell = c => '<td><button class="rowbtn" data-act="m-sel" data-id="' + u.id + '">' + c + '</button></td>';
      return '<tr class="' + (u.isOwner ? 'admin ' : '') + (same(S.mSel, u.id) && !S.mNew ? 'sel' : '') + '">' +
        cell('<span style="display:inline-flex;gap:8px;align-items:center;font-weight:600">' + (u.isOwner ? ICON.lock : '') + esc(u.name) + (same(u.id, S.me.id) ? ' <span class="small muted">(jij)</span>' : '') + '</span>') +
        cell(u.isOwner ? '<span class="badge dark">Eigenaar</span>' : esc(u.roleName)) +
        cell('<span class="small">' + esc(contractShort(u)) + '</span>') +
        cell(u.active ? '<span class="small" style="color:var(--green)">Actief</span>' : '<span class="small muted">Gedeactiveerd</span>') +
        cell('<span class="small muted">' + (u.lastLogin ? esc(fmtDate(u.lastLogin)) : 'Nog nooit') + '</span>') + '</tr>';
    }).join('') + '</tbody></table></div></div><aside class="detail card">' + viewMemberPanel() + '</aside></div>';
  return h;
}
function roleOptions(selected) {
  return (S.roles ? S.roles.roles : []).filter(r => !r.isOwner && (r.canAssign || same(r.id, selected)))
    .map(r => '<option value="' + r.id + '"' + (same(r.id, selected) ? ' selected' : '') + (r.canAssign ? '' : ' disabled') + '>' + esc(r.name) + '</option>').join('');
}
function permSummary(roleId) {
  const r = S.roles && S.roles.roles.find(x => same(x.id, roleId));
  if (!r) return '';
  return '<div class="small muted">' + esc(r.description || '') + '</div><div class="chips" style="margin-top:6px">' +
    PERM_GROUPS.flatMap(g => g[1]).filter(p => r.permissions.includes(p[0])).map(p => '<span class="badge">' + esc(p[1]) + '</span>').join('') + '</div>';
}
function viewMemberPanel() {
  if (S.mNew) {
    const first = (S.roles.roles.find(r => r.name === 'Medewerker' && r.canAssign) || S.roles.roles.find(r => !r.isOwner && r.canAssign) || {}).id;
    const sel = S.mNewRole || first;
    return '<div class="stack" style="gap:16px"><div><span class="small muted">Nieuwe medewerker</span><h2 style="margin:0;font-size:22px">Medewerker toevoegen</h2></div>' +
      '<div class="field"><label for="m-name">Naam *</label><input class="input" id="m-name" placeholder="Bijv. Lisa of Lisa de Jong" autocomplete="off"><span class="small muted">Hiermee logt diegene in. Moet uniek zijn binnen je bedrijf.</span></div>' +
      '<div class="field"><label for="m-role">Rol</label><select class="input" id="m-role" data-act-change="m-role-new">' + roleOptions(sel) + '</select>' + permSummary(sel) + '</div>' +
      '<div class="detail-section"><button class="btn dark" data-act="m-create">Aanmaken en code maken</button><button class="btn ghost" data-act="m-cancel">Annuleren</button></div>' +
      '<p class="small muted" style="margin:0">Crewdeck maakt een persoonlijke code van 6 cijfers. Die zie je één keer.</p></div>';
  }
  const u = S.members.find(x => same(x.id, S.mSel));
  if (!u) return '<p class="muted" style="margin:0">Kies iemand in de lijst om de gegevens te bekijken of aan te passen.</p>';
  const self = same(u.id, S.me.id);
  if (u.isOwner && !self) {
    return '<div class="stack" style="gap:12px"><div><span class="small muted">Eigenaar</span><h2 style="margin:0;font-size:22px;display:flex;gap:8px;align-items:center">' + ICON.lock + esc(u.name) + '</h2></div>' +
      '<p class="small muted" style="margin:0">De eigenaar heeft altijd alle rechten. Niemand anders kan dit account aanpassen of deactiveren.</p></div>';
  }
  if (!u.canManage && !self) {
    return '<div class="stack" style="gap:12px"><div><span class="small muted">' + esc(u.roleName) + '</span><h2 style="margin:0;font-size:22px">' + esc(u.name) + '</h2></div>' + permSummary(u.roleId) +
      '<dl class="kv"><dt>Contract</dt><dd>' + esc(contractText(u)) + '</dd></dl>' +
      '<p class="small muted" style="margin:0">' + (can('members.manage') ? 'Deze medewerker heeft meer rechten dan jij; dat kun je niet aanpassen.' : 'Je kunt medewerkers bekijken maar niet aanpassen.') + '</p></div>';
  }
  return '<div class="stack" style="gap:16px"><div><span class="small muted">' + (self ? 'Je eigen account' : 'Bewerken') + '</span><h2 style="margin:0;font-size:22px">' + esc(u.name) + '</h2></div>' +
    '<div class="field"><label for="m-name">Naam</label><input class="input" id="m-name" value="' + esc(u.name) + '"></div>' +
    (self ? '<dl class="kv"><dt>Rol</dt><dd>' + esc(u.roleName) + '</dd></dl>' :
      '<div class="field"><label for="m-role">Rol</label><select class="input" id="m-role" data-act-change="m-role-edit">' + roleOptions(u.roleId) + '</select><div id="m-perms">' + permSummary(u.roleId) + '</div></div>' +
      '<label class="check"><input type="checkbox" id="m-active"' + (u.active ? ' checked' : '') + '> Account actief (kan inloggen)</label>') +
    (!self || S.me.isOwner ? contractFields(u) : '<dl class="kv"><dt>Contract</dt><dd>' + esc(contractText(u)) + '</dd></dl>') +
    '<div class="detail-section"><button class="btn dark" data-act="m-save" data-id="' + u.id + '">Opslaan</button>' +
    (self ? '' : '<button class="btn" data-act="m-reset" data-id="' + u.id + '">Nieuwe code maken</button>') + '</div>' +
    (self ? '<p class="small muted" style="margin:0">Je eigen code wijzig je bij Instellingen.</p>' : '') + '</div>';
}

// ----- rollen -----
function viewRoles() {
  const R = S.roles;
  if (!R) return '';
  const rm = can('roles.manage');
  let h = '<header class="page-head"><div><h1>Rollen &amp; rechten</h1><p>Elke medewerker heeft één rol. Een rol bepaalt wat iemand mag.</p></div>' +
    (rm ? '<div class="actions"><button class="btn primary" data-act="r-new">' + ICON.plus + 'Nieuwe rol</button></div>' : '') + '</header>';
  h += '<div class="split"><div class="list" style="flex:1 1 300px"><div class="role-list">' + R.roles.map(r => '<button class="role-item' + (same(S.rSel, r.id) && !S.rNew ? ' sel' : '') + '" data-act="r-sel" data-id="' + r.id + '">' +
    '<span><strong>' + esc(r.name) + '</strong><small>' + esc(r.description || '') + '</small></span>' +
    '<span class="badge' + (r.isOwner ? ' dark' : '') + '">' + (r.isOwner ? 'Alles' : r.members + ' ' + (r.members === 1 ? 'persoon' : 'personen')) + '</span></button>').join('') + '</div></div>' +
    '<aside class="detail card" style="flex:2 1 460px">' + viewRolePanel() + '</aside></div>';
  return h;
}
function viewRolePanel() {
  const R = S.roles;
  const r = S.rNew ? { id: null, name: '', description: '', permissions: [], canEdit: true, isOwner: false, members: 0 } : R.roles.find(x => same(x.id, S.rSel));
  if (!r) return '<p class="muted" style="margin:0">Kies een rol om de rechten te bekijken' + (can('roles.manage') ? ' of aan te passen' : '') + '.</p>';
  const editable = r.canEdit && can('roles.manage');
  const mine = new Set(R.mine);
  let h = '<div class="stack" style="gap:16px">';
  if (editable) {
    h += '<div class="fields2"><div class="field"><label for="r-name">Naam</label><input class="input" id="r-name" value="' + esc(r.name) + '" maxlength="40"></div>' +
      '<div class="field"><label for="r-desc">Omschrijving</label><input class="input" id="r-desc" value="' + esc(r.description || '') + '" maxlength="200"></div></div>';
  } else {
    h += '<div><span class="small muted">' + (r.isOwner ? 'Vaste rol' : 'Alleen bekijken') + '</span><h2 style="margin:0;font-size:22px;display:flex;gap:8px;align-items:center">' + (r.isOwner ? ICON.lock : '') + esc(r.name) + '</h2>' +
      '<p class="small muted" style="margin:4px 0 0">' + esc(r.isOwner ? 'De eigenaar heeft altijd alle rechten. Deze rol kan niet worden aangepast of verwijderd.' : (r.description || '')) + '</p></div>';
  }
  h += '<div class="perm-grid">' + PERM_GROUPS.map(g => '<fieldset class="perm-group"><legend class="sr-only">' + g[0] + '</legend><h3>' + g[0] + '</h3>' +
    g[1].map(p => {
      const dis = !editable || (!S.me.isOwner && !mine.has(p[0]));
      return '<label class="check"><input type="checkbox" data-perm="' + p[0] + '"' + (r.permissions.includes(p[0]) ? ' checked' : '') + (dis ? ' disabled' : '') + '> ' + p[1] + '</label>';
    }).join('') + '</fieldset>').join('') + '</div>';
  if (editable) {
    h += (!S.me.isOwner ? '<p class="small muted" style="margin:0">' + ICON.shield + ' Je kunt alleen rechten geven die je zelf ook hebt.</p>' : '') +
      '<div class="form-foot">' + (r.id && !r.members ? '<button class="btn danger" data-act="r-delete" data-id="' + r.id + '" style="margin-right:auto">' + ICON.trash + 'Verwijderen</button>' : '') +
      (S.rNew ? '<button class="btn" data-act="r-cancel">Annuleren</button>' : '') + '<button class="btn primary" data-act="r-save"' + (r.id ? ' data-id="' + r.id + '"' : '') + '>' + (S.rNew ? 'Rol aanmaken' : 'Opslaan') + '</button></div>';
    if (r.id && r.members) h += '<p class="small muted" style="margin:0">' + r.members + ' ' + (r.members === 1 ? 'persoon heeft' : 'personen hebben') + ' deze rol. Wijzigingen gelden direct voor hen.</p>';
  }
  return h + '</div>';
}

// ----- instellingen -----
function viewSettings() {
  const s = settings();
  let h = '<header class="page-head"><div><h1>Instellingen</h1><p>Je eigen account' + (can('org.manage') ? ' en de instellingen van ' + esc(S.org.name) : '') + '.</p></div></header>' + codeAlert();
  h += '<div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">';
  h += '<section class="card stack" style="gap:14px"><h2>Mijn account</h2><dl class="kv"><dt>Naam</dt><dd>' + esc(S.me.name) + '</dd><dt>Rol</dt><dd>' + esc(S.roleName) + '</dd><dt>Bedrijfscode</dt><dd>' + esc(S.org.slug) + '</dd></dl>' +
    '<div class="field"><label for="s-code">Nieuwe code</label><input class="input code-input" id="s-code" type="password" inputmode="numeric" autocomplete="new-password" placeholder="6 tot 12 cijfers"></div>' +
    '<div class="field"><label for="s-code2">Herhaal nieuwe code</label><input class="input code-input" id="s-code2" type="password" inputmode="numeric" autocomplete="new-password"></div>' +
    '<div><button class="btn dark" data-act="s-owncode">Code wijzigen</button></div></section>';
  if (can('org.manage')) {
    const tz = s.timezone || 'Europe/Amsterdam';
    h += '<section class="card stack" style="gap:14px"><h2>Bedrijf</h2>' +
      '<div class="field"><label for="o-name">Bedrijfsnaam</label><input class="input" id="o-name" value="' + esc(S.org.name) + '"></div>' +
      '<dl class="kv"><dt>Bedrijfscode</dt><dd>' + esc(S.org.slug) + '</dd></dl>' +
      '<div class="field"><label for="o-tz">Tijdzone</label><select class="input" id="o-tz">' + (TIMEZONES.includes(tz) ? TIMEZONES : [tz].concat(TIMEZONES)).map(z => '<option' + (z === tz ? ' selected' : '') + '>' + z + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="o-cats">Categorieën voor terugbelverzoeken</label><textarea class="input" id="o-cats" rows="6" aria-describedby="o-cats-h">' + esc((s.categories || []).join('\n')) + '</textarea><span class="small muted" id="o-cats-h">Eén per regel.</span></div>' +
      '<div class="field"><label for="o-notes">Snelnotities</label><textarea class="input" id="o-notes" rows="6" aria-describedby="o-notes-h">' + esc((s.quick_notes || []).join('\n')) + '</textarea><span class="small muted" id="o-notes-h">Eén per regel. Deze knoppen staan bij elk terugbelverzoek.</span></div>' +
      '<div><button class="btn primary" data-act="o-save">Opslaan</button></div></section>';
  }
  return h + '</div>';
}

// ======================================================================
// Uren, rooster, goedkeuren, urenoverzicht
// ======================================================================
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function pd(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d, 12); }
function addDays(s, n) { const d = pd(s); d.setDate(d.getDate() + n); return ymd(d); }
function mondayOf(s) { const d = pd(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); }
function today() { return ymd(new Date()); }
function weekNo(s) {
  const d = pd(s); const t = new Date(d); t.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}
function fmtHM(min) { min = Math.round(min || 0); const neg = min < 0; min = Math.abs(min); return (neg ? '-' : '') + Math.floor(min / 60) + ':' + pad(min % 60); }
function dayShort(s) { const d = pd(s); return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; }
function dayLong(s) { const d = pd(s); const t = DAYS_FULL[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; return t.charAt(0).toUpperCase() + t.slice(1); }
function weekLabel(mon) {
  const a = pd(mon), b = pd(addDays(mon, 6));
  return 'Week ' + weekNo(mon) + ' · ' + a.getDate() + (a.getMonth() !== b.getMonth() ? ' ' + MONTHS[a.getMonth()] : '') + ' – ' + b.getDate() + ' ' + MONTHS[b.getMonth()] +
    (b.getFullYear() !== new Date().getFullYear() ? ' ' + b.getFullYear() : '');
}
function spanMin(start, end) {
  const [a, b] = [start, end].map(t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; });
  return ((b - a) + 1440) % 1440;
}
function contractText(u) {
  if (!u) return '';
  if (u.contractType === 'flex') return 'Flex (0-uren)';
  return Number(u.contractHours) > 0 ? 'Vast, ' + String(Number(u.contractHours)).replace('.', ',') + ' uur per week' : 'Vast, uren nog niet ingevuld';
}
function contractShort(u) { return u.contractType === 'flex' ? 'Flex' : (Number(u.contractHours) > 0 ? String(Number(u.contractHours)).replace('.', ',') + ' u/week' : 'Vast'); }
function contractFields(u) {
  const flex = u.contractType === 'flex';
  return '<fieldset class="box" style="margin:0"><legend class="legend" style="padding:0 4px">Contract</legend>' +
    '<div class="fields2"><div class="field"><label for="m-ctype">Soort</label><select class="input" id="m-ctype" data-act-change="m-ctype">' +
      '<option value="vast"' + (!flex ? ' selected' : '') + '>Vast contract</option><option value="flex"' + (flex ? ' selected' : '') + '>Flex / 0-uren</option></select></div>' +
    '<div class="field"><label for="m-chours">Uren per week</label><input class="input" id="m-chours" inputmode="decimal" value="' + (flex ? '' : esc(String(Number(u.contractHours) || '').replace('.', ','))) + '"' + (flex ? ' disabled placeholder="Niet van toepassing"' : ' placeholder="Bijv. 32"') + '></div></div>' +
    '<span class="small muted">Wordt gebruikt bij Mijn uren en het urenoverzicht om gewerkte uren naast het contract te zetten.</span></fieldset>';
}
const H_STATUS = { open: ['Bezig', 'blue'], concept: ['Concept', ''], ingediend: ['Ingediend', 'orange'], goedgekeurd: ['Goedgekeurd', 'green'], afgekeurd: ['Afgekeurd', 'red'] };
function hBadge(st) { const b = H_STATUS[st] || [st, '']; return '<span class="badge ' + b[1] + '">' + b[0] + '</span>'; }
function weekNav(act, mon) {
  const cur = mondayOf(today());
  return '<div class="weeknav"><button class="icon-btn" data-act="' + act + '" data-v="' + addDays(mon, -7) + '" aria-label="Vorige week">' + ICON.left + '</button>' +
    '<strong>' + weekLabel(mon) + '</strong>' +
    '<button class="icon-btn" data-act="' + act + '" data-v="' + addDays(mon, 7) + '" aria-label="Volgende week">' + ICON.right + '</button>' +
    (mon !== cur ? '<button class="btn small ghost" data-act="' + act + '" data-v="' + cur + '">Naar deze week</button>' : '') + '</div>';
}
function runningSince(e) { if (!e) return 0; const d = new Date(e.date + 'T' + e.start + ':00'); return Math.max(0, Math.round((Date.now() - d) / 60000)); }

async function loadHours() {
  const H = await rpc('cd_hours_week', { p_member: S.hMember || null, p_week: S.hWeek || null });
  S.hours = H; S.hWeek = H.weekStart;
}

function homeHoursCard() {
  const W = S.nowWeek; if (!W) return '';
  const ct = W.member.contractType, ch = Number(W.member.contractHours) * 60;
  const todayShifts = W.shifts.filter(s => s.date === W.today);
  let h = '<section class="card"><h2>Mijn uren</h2>';
  h += S.running ? '<div class="clock-mini"><span class="live-dot"></span><span>Ingeklokt sinds <strong>' + esc(S.running.start) + '</strong></span></div>' : '';
  h += '<dl class="kv"><dt>Deze week</dt><dd>' + fmtHM(W.totalMin) + (ct === 'vast' && ch ? ' van ' + fmtHM(ch) : '') + '</dd>' +
    '<dt>Vandaag ingepland</dt><dd>' + (todayShifts.length ? todayShifts.map(s => esc(s.start + '–' + s.end)).join(', ') : '<span class="muted" style="font-weight:400">Niet ingepland</span>') + '</dd></dl>';
  h += '<div class="row" style="margin-top:14px">' + (S.running ? '<button class="btn dark small" data-act="clock-out">Uitklokken</button>' : '<button class="btn primary small" data-act="clock-in">Inklokken</button>') +
    '<a class="btn small ghost" href="#/uren">Naar mijn uren</a></div></section>';
  if (can('hours.approve') && S.pendingCount) {
    h += '<section class="card"><h2>Uren goedkeuren</h2><p class="muted small" style="margin:0 0 12px">' + S.pendingCount + (S.pendingCount === 1 ? ' regel wacht' : ' regels wachten') + ' op jouw beoordeling.</p>' +
      '<a class="btn small" href="#/goedkeuren">Beoordelen</a></section>';
  }
  return h;
}

function clockCard() {
  const R = S.running;
  return '<section class="card clock' + (R ? ' on' : '') + '"><div class="clock-text">' +
    (R ? '<span class="small">' + '<span class="live-dot"></span> Ingeklokt sinds ' + esc(R.start) + (R.date !== today() ? ' (' + esc(dayShort(R.date)) + ')' : '') + '</span><strong id="clock-elapsed" data-date="' + esc(R.date) + '" data-start="' + esc(R.start) + '">' + fmtHM(runningSince(R)) + '</strong>'
      : '<span class="small muted">Je bent niet ingeklokt</span><strong>Begin je dienst</strong>') + '</div>' +
    (R ? '<button class="btn dark" data-act="clock-out">Uitklokken</button>' : '<button class="btn primary" data-act="clock-in">Inklokken</button>') + '</section>';
}

function entryForm() {
  const E = S.hEdit;
  return '<div class="entry-form" role="group" aria-label="Uren invullen">' +
    '<div class="fields4"><div class="field"><label for="h-date">Datum</label><input class="input" type="date" id="h-date" data-h="date" value="' + esc(E.date) + '" max="' + addDays(today(), 1) + '"></div>' +
    '<div class="field"><label for="h-start">Begin</label><input class="input" type="time" id="h-start" data-h="start" value="' + esc(E.start) + '"></div>' +
    '<div class="field"><label for="h-end">Eind</label><input class="input" type="time" id="h-end" data-h="end" value="' + esc(E.end) + '"></div>' +
    '<div class="field"><label for="h-break">Pauze (min)</label><input class="input" type="number" min="0" max="600" step="5" id="h-break" data-h="breakMin" value="' + esc(E.breakMin) + '"></div></div>' +
    '<div class="field"><label for="h-note">Notitie <span class="muted" style="font-weight:400">(optioneel)</span></label><input class="input" id="h-note" data-h="note" maxlength="300" value="' + esc(E.note) + '" placeholder="Bijv. inventarisatie magazijn"></div>' +
    (E.start && E.end && E.start !== E.end ? '<p class="small muted" style="margin:0">Totaal: <strong>' + fmtHM(Math.max(0, spanMin(E.start, E.end) - (Number(E.breakMin) || 0))) + '</strong>' + (E.end < E.start ? ' (loopt door na middernacht)' : '') + '</p>' : '') +
    '<div class="form-foot" style="justify-content:flex-start"><button class="btn primary small" data-act="h-save">Opslaan</button><button class="btn small ghost" data-act="h-cancel">Annuleren</button></div></div>';
}
function entryRow(e, self) {
  if (S.hEdit && same(S.hEdit.id, e.id)) return entryForm();
  const editable = self && ['concept', 'afgekeurd'].includes(e.status);
  return '<div class="entry' + (e.status === 'afgekeurd' ? ' bad' : '') + '"><div class="entry-main">' +
    '<span class="entry-time">' + esc(e.start) + ' – ' + (e.end ? esc(e.end) : 'nu') + '</span>' +
    (e.breakMin ? '<span class="small muted">' + e.breakMin + ' min pauze</span>' : '') +
    (e.note ? '<span class="small entry-note">' + esc(e.note) + '</span>' : '') + '</div>' +
    '<div class="entry-side"><strong>' + (e.minutes == null ? fmtHM(runningSince(e)) : fmtHM(e.minutes)) + '</strong>' + hBadge(e.status) +
    (editable ? '<button class="icon-btn small" data-act="h-edit" data-id="' + e.id + '" aria-label="Bewerken">' + ICON.edit + '</button><button class="icon-btn small" data-act="h-del" data-id="' + e.id + '" aria-label="Verwijderen">' + ICON.trash + '</button>' : '') +
    (!self && e.status === 'goedgekeurd' && can('hours.approve') ? '<button class="btn small ghost" data-act="h-reopen" data-id="' + e.id + '">Terugzetten</button>' : '') + '</div>' +
    (e.status === 'afgekeurd' && e.rejectReason ? '<div class="entry-reason">Afgekeurd door ' + esc(e.reviewedByName || 'teamleider') + ': ' + esc(e.rejectReason) + '</div>' : '') + '</div>';
}

function viewHours() {
  const H = S.hours; if (!H) return '';
  const self = same(H.member.id, S.me.id);
  const mon = H.weekStart;
  const ct = H.member.contractType, ch = Number(H.member.contractHours) * 60;
  const planned = H.shifts.reduce((a, s) => a + spanMin(s.start, s.end), 0);
  let h = '<header class="page-head"><div><h1>' + (self ? 'Mijn uren' : 'Uren van ' + esc(H.member.name)) + '</h1><p>' +
    (self ? 'Klok in en uit, of vul je uren achteraf in. Klopt je week? Dien hem in.' : esc(contractText(H.member)) + '. Je bekijkt deze uren alleen.') + '</p></div>' +
    (!self ? '<div class="actions"><button class="btn" data-act="h-me">' + ICON.left + 'Mijn eigen uren</button></div>' : '') + '</header>';
  h += weekNav('h-week', mon);
  if (self && mon === mondayOf(today())) h += clockCard();
  const diff = H.totalMin - ch;
  h += '<div class="stats">' + stat('Gewerkt', fmtHM(H.totalMin)) + stat('Ingepland', fmtHM(planned)) +
    stat('Contract', ct === 'flex' ? 'Flex' : (ch ? fmtHM(ch) : '–')) +
    stat(ct === 'flex' || !ch ? 'Verschil' : (diff >= 0 ? 'Boven contract' : 'Nog te gaan'), ct === 'flex' || !ch ? '–' : fmtHM(Math.abs(diff)), ct === 'vast' && ch && diff > 0 ? 'var(--orange)' : null) + '</div>';
  if (ct === 'vast' && ch) h += '<div class="progress" role="progressbar" aria-label="Gewerkt van contract" aria-valuemin="0" aria-valuemax="' + ch + '" aria-valuenow="' + H.totalMin + '"><span style="width:' + Math.min(100, H.totalMin / ch * 100) + '%"></span></div>';
  h += '<div class="days">' + [0, 1, 2, 3, 4, 5, 6].map(i => {
    const d = addDays(mon, i);
    const es = H.entries.filter(e => e.date === d);
    const ss = H.shifts.filter(s => s.date === d);
    const tot = es.reduce((a, e) => a + (e.minutes || 0), 0);
    const adding = S.hEdit && !S.hEdit.id && S.hEdit.date === d;
    return '<section class="day' + (d === H.today ? ' today' : '') + '"><div class="day-head"><div class="day-name"><strong>' + esc(dayLong(d)) + '</strong>' +
      (d === H.today ? '<span class="badge blue">Vandaag</span>' : '') +
      (ss.length ? '<span class="small muted">Ingepland ' + ss.map(s => esc(s.start + '–' + s.end) + (s.note ? ' (' + esc(s.note) + ')' : '')).join(', ') + '</span>' : '') + '</div>' +
      '<span class="day-total">' + (tot ? fmtHM(tot) : '') + '</span></div>' +
      es.map(e => entryRow(e, self)).join('') + (adding ? entryForm() : '') +
      (self && !adding && d <= addDays(H.today, 1) ? '<button class="add-line" data-act="h-add" data-v="' + d + '">' + ICON.plus + 'Uren toevoegen</button>' : '') + '</section>';
  }).join('') + '</div>';
  if (self) {
    const todo = H.entries.filter(e => ['concept', 'afgekeurd'].includes(e.status));
    const sent = H.entries.filter(e => e.status === 'ingediend').length;
    if (todo.length) {
      h += '<section class="card submit-bar"><div><strong>' + todo.length + (todo.length === 1 ? ' regel' : ' regels') + ' nog niet ingediend · ' + fmtHM(todo.reduce((a, e) => a + (e.minutes || 0), 0)) + '</strong>' +
        '<p class="small muted" style="margin:2px 0 0">Na indienen kan je teamleider de uren goedkeuren. Daarna kun je ze niet meer wijzigen.</p></div>' +
        '<button class="btn primary" data-act="h-submit">Week indienen</button></section>';
    } else if (sent) {
      h += '<div class="alert info">' + '<span>Deze week is ingediend en wacht op goedkeuring.</span></div>';
    }
  }
  return h;
}

function viewRoster() {
  const R = S.roster; if (!R) return '';
  const mon = R.weekStart; const days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(mon, i));
  let h = '<header class="page-head"><div><h1>Rooster</h1><p>Wie wanneer werkt.' + (R.canPlan ? ' Klik op + in een vak om een dienst in te plannen, of op een dienst om hem te wijzigen.' : '') + '</p></div></header>';
  h += weekNav('ro-week', mon);
  if (S.shiftEdit) {
    const E = S.shiftEdit;
    h += '<section class="card stack" style="gap:14px;max-width:none"><h2 style="margin:0">' + (E.id ? 'Dienst wijzigen' : 'Dienst inplannen') + '</h2>' +
      '<div class="fields4"><div class="field"><label for="sh-member">Medewerker</label><select class="input" id="sh-member" data-sh="memberId">' +
        R.people.map(p => '<option value="' + p.id + '"' + (same(p.id, E.memberId) ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="sh-date">Datum</label><input class="input" type="date" id="sh-date" data-sh="date" value="' + esc(E.date) + '"></div>' +
      '<div class="field"><label for="sh-start">Begin</label><input class="input" type="time" id="sh-start" data-sh="start" value="' + esc(E.start) + '"></div>' +
      '<div class="field"><label for="sh-end">Eind</label><input class="input" type="time" id="sh-end" data-sh="end" value="' + esc(E.end) + '"></div></div>' +
      '<div class="field"><label for="sh-note">Notitie <span class="muted" style="font-weight:400">(optioneel, bijv. balie of magazijn)</span></label><input class="input" id="sh-note" data-sh="note" maxlength="120" value="' + esc(E.note) + '"></div>' +
      '<div class="form-foot">' + (E.id ? '<button class="btn danger small" data-act="sh-del" data-id="' + E.id + '" style="margin-right:auto">' + ICON.trash + 'Verwijderen</button>' : '') +
      '<button class="btn small ghost" data-act="sh-cancel">Annuleren</button><button class="btn primary small" data-act="sh-save">' + (E.id ? 'Opslaan' : 'Inplannen') + '</button></div></section>';
  }
  if (!R.people.length) return h + '<div class="empty">Nog geen actieve medewerkers.</div>';
  h += '<div class="table-wrap"><table class="roster"><thead><tr><th>Medewerker</th>' + days.map(d => '<th class="' + (d === today() ? 'is-today' : '') + '">' + esc(dayShort(d)) + '</th>').join('') + '<th>Totaal</th></tr></thead><tbody>' +
    R.people.map(p => {
      const mine = R.shifts.filter(s => same(s.memberId, p.id));
      const tot = mine.reduce((a, s) => a + spanMin(s.start, s.end), 0);
      const ch = p.contractType === 'vast' ? Number(p.contractHours) * 60 : 0;
      return '<tr class="' + (same(p.id, S.me.id) ? 'me' : '') + '"><td class="pad"><strong>' + esc(p.name) + '</strong><div class="small muted">' + esc(contractShort(p)) + '</div></td>' +
        days.map(d => '<td class="rc' + (d === today() ? ' is-today' : '') + '">' + mine.filter(s => s.date === d).map(s => R.canPlan
          ? '<button class="shift" data-act="sh-edit" data-id="' + s.id + '" title="' + esc(s.note || '') + '">' + esc(s.start + '–' + s.end) + (s.note ? '<small>' + esc(s.note) + '</small>' : '') + '</button>'
          : '<span class="shift">' + esc(s.start + '–' + s.end) + (s.note ? '<small>' + esc(s.note) + '</small>' : '') + '</span>').join('') +
          (R.canPlan ? '<button class="cell-add" data-act="sh-new" data-id="' + p.id + '" data-v="' + d + '" aria-label="Dienst inplannen voor ' + esc(p.name) + ' op ' + esc(dayShort(d)) + '">+</button>' : '') + '</td>').join('') +
        '<td class="pad"><strong>' + fmtHM(tot) + '</strong>' + (ch ? '<div class="small muted">van ' + fmtHM(ch) + '</div>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  return h;
}

function pendingGroups() {
  const G = []; const by = {};
  (S.pending || []).forEach(e => {
    const k = e.memberId + '|' + e.weekStart;
    if (!by[k]) { by[k] = { key: k, memberId: e.memberId, name: e.memberName, week: e.weekStart, entries: [] }; G.push(by[k]); }
    by[k].entries.push(e);
  });
  return G;
}
function viewApprove() {
  const G = pendingGroups();
  let h = '<header class="page-head"><div><h1>Uren goedkeuren</h1><p>Ingediende uren van het team. Vink uit wat je niet wilt meenemen. Je eigen uren keurt iemand anders goed.</p></div></header>';
  if (!S.pending) return h;
  if (!G.length) return h + '<div class="empty-state card"><strong>Alles is beoordeeld</strong>Er wachten geen ingediende uren.</div>';
  h += G.map(g => {
    const on = g.entries.filter(e => !S.pOff[e.id]);
    const total = on.reduce((a, e) => a + (e.minutes || 0), 0);
    return '<section class="card approve"><div class="section-title"><div style="display:flex;gap:10px;align-items:center">' + avatar(g.memberId, g.name) +
      '<div><strong>' + esc(g.name) + '</strong><div class="small muted">' + weekLabel(g.week) + '</div></div></div>' +
      '<button class="btn small ghost" data-act="p-view" data-id="' + g.memberId + '" data-v="' + g.week + '">Hele week bekijken</button></div>' +
      '<div class="table-wrap" style="border:0;margin-top:8px"><table><thead><tr><th style="width:44px"><span class="sr-only">Meenemen</span></th><th>Dag</th><th>Tijd</th><th>Pauze</th><th>Uren</th><th>Notitie</th></tr></thead><tbody>' +
      g.entries.map(e => '<tr><td class="pad"><input type="checkbox" data-psel="' + e.id + '"' + (S.pOff[e.id] ? '' : ' checked') + ' aria-label="' + esc(dayShort(e.date)) + ' meenemen"></td>' +
        '<td class="pad">' + esc(dayShort(e.date)) + '</td><td class="pad">' + esc(e.start + ' – ' + e.end) + '</td><td class="pad">' + (e.breakMin ? e.breakMin + ' min' : '–') + '</td>' +
        '<td class="pad"><strong>' + fmtHM(e.minutes) + '</strong></td><td class="pad small">' + esc(e.note || '') + '</td></tr>').join('') + '</tbody></table></div>' +
      (S.rejectFor === g.key
        ? '<div class="reject-box"><div class="field"><label for="rej-reason">Waarom keur je ' + (on.length === 1 ? 'deze regel' : 'deze ' + on.length + ' regels') + ' af?</label><input class="input" id="rej-reason" maxlength="300" placeholder="Bijv. pauze ontbreekt op dinsdag"></div>' +
          '<div class="form-foot"><button class="btn small ghost" data-act="p-reject-cancel">Annuleren</button><button class="btn small danger" data-act="p-reject" data-v="' + g.key + '">Afkeuren</button></div></div>'
        : '<div class="form-foot" style="margin-top:12px;align-items:center"><span class="small muted" style="margin-right:auto">Geselecteerd: <strong>' + on.length + '</strong> · ' + fmtHM(total) + ' uur</span>' +
          '<button class="btn small" data-act="p-reject-open" data-v="' + g.key + '"' + (on.length ? '' : ' disabled') + '>Afkeuren…</button>' +
          '<button class="btn small primary" data-act="p-approve" data-v="' + g.key + '"' + (on.length ? '' : ' disabled') + '>Goedkeuren</button></div>') + '</section>';
  }).join('');
  return h;
}

function periodRange(key) {
  const t = pd(today());
  if (key === 'week') { const m = mondayOf(today()); return [m, addDays(m, 6)]; }
  if (key === 'vorigeweek') { const m = addDays(mondayOf(today()), -7); return [m, addDays(m, 6)]; }
  if (key === 'maand') return [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(new Date(t.getFullYear(), t.getMonth() + 1, 0))];
  if (key === 'vorigemaand') return [ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymd(new Date(t.getFullYear(), t.getMonth(), 0))];
  return [S.repFrom || today(), S.repTo || today()];
}
async function loadReport() {
  const [f, t] = periodRange(S.repPeriod);
  S.repFrom = f; S.repTo = t;
  S.report = await rpc('cd_hours_report', { p_from: f, p_to: t });
}
function viewReport() {
  const R = S.report;
  const periods = [['week', 'Deze week'], ['vorigeweek', 'Vorige week'], ['maand', 'Deze maand'], ['vorigemaand', 'Vorige maand'], ['eigen', 'Zelf kiezen']];
  let h = '<header class="page-head"><div><h1>Urenoverzicht</h1><p>Gewerkte uren per medewerker, naast het contract. Klik op iemand voor de details.</p></div>' +
    '<div class="actions"><button class="btn" data-act="rep-csv"' + (R && R.entries.length ? '' : ' disabled') + '>' + ICON.download + 'Exporteren (CSV)</button></div></header>';
  h += '<div class="seg" role="group" aria-label="Periode">' + periods.map(p => '<button data-act="rep-period" data-v="' + p[0] + '" class="' + (S.repPeriod === p[0] ? 'on' : '') + '" aria-pressed="' + (S.repPeriod === p[0]) + '">' + p[1] + '</button>').join('') + '</div>';
  if (S.repPeriod === 'eigen') {
    h += '<div class="row" style="align-items:flex-end;max-width:620px"><div class="field" style="flex:1 1 160px"><label for="rep-from">Van</label><input class="input" type="date" id="rep-from" value="' + esc(S.repFrom || '') + '"></div>' +
      '<div class="field" style="flex:1 1 160px"><label for="rep-to">Tot en met</label><input class="input" type="date" id="rep-to" value="' + esc(S.repTo || '') + '"></div>' +
      '<button class="btn dark" data-act="rep-custom">Toon</button></div>';
  }
  if (!R) return h;
  const sum = k => R.people.reduce((a, p) => a + (p[k] || 0), 0);
  h += '<p class="small muted" style="margin:0">' + esc(dayShort(R.from)) + ' t/m ' + esc(dayShort(R.to)) + ' · ' + R.workdays + ' werkdagen</p>';
  h += '<div class="stats">' + stat('Goedgekeurd', fmtHM(sum('approvedMin')), 'var(--green)') + stat('Ingediend, wacht', fmtHM(sum('submittedMin')), 'var(--orange)') +
    stat('Nog niet ingediend', fmtHM(sum('conceptMin'))) + stat('Medewerkers', R.people.length) + '</div>';
  h += '<div class="table-wrap"><table><thead><tr><th>Naam</th><th>Contract</th><th>Verwacht</th><th>Goedgekeurd</th><th>Ingediend</th><th>Niet ingediend</th><th>Verschil</th></tr></thead><tbody>' +
    R.people.map(p => {
      const worked = p.approvedMin + p.submittedMin;
      const diff = p.expectedMin == null ? null : worked - p.expectedMin;
      const cell = c => '<td><button class="rowbtn" data-act="p-view" data-id="' + p.id + '" data-v="' + mondayOf(R.from) + '">' + c + '</button></td>';
      return '<tr>' + cell('<strong>' + esc(p.name) + '</strong>' + (p.active ? '' : ' <span class="small muted">(gedeactiveerd)</span>')) + cell('<span class="small">' + esc(contractShort(p)) + '</span>') +
        cell(p.expectedMin == null ? '–' : fmtHM(p.expectedMin)) + cell('<strong>' + fmtHM(p.approvedMin) + '</strong>') + cell(p.submittedMin ? fmtHM(p.submittedMin) : '–') +
        cell(p.conceptMin ? fmtHM(p.conceptMin) : '–') +
        cell(diff == null || !p.expectedMin ? '–' : '<span style="color:' + (diff < 0 ? 'var(--red)' : 'var(--green)') + '">' + (diff > 0 ? '+' : '') + fmtHM(diff) + '</span>') + '</tr>';
    }).join('') + '</tbody></table></div>' +
    '<p class="small muted" style="margin:0">Verwacht = contracturen × werkdagen ÷ 5. Feestdagen en verlof tellen hier nog niet mee. Verschil = goedgekeurd + ingediend − verwacht.</p>';
  return h;
}
function exportCsv() {
  const R = S.report; if (!R) return;
  const q = v => { const s = String(v == null ? '' : v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [['Naam', 'Datum', 'Begin', 'Eind', 'Pauze (min)', 'Uren', 'Status', 'Notitie']]
    .concat(R.entries.map(e => [e.memberName, e.date, e.start, e.end, e.breakMin, ((e.minutes || 0) / 60).toFixed(2).replace('.', ','), (H_STATUS[e.status] || [e.status])[0], e.note]));
  const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'uren-' + R.from + '-tm-' + R.to + '.csv';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ======================================================================
// Kennisbank
// ======================================================================
function md(src) {
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  let out = '', list = null, para = [];
  const flushP = () => { if (para.length) { out += '<p>' + para.map(inline).join('<br>') + '</p>'; para = []; } };
  const flushL = () => { if (list) { out += '</' + list + '>'; list = null; } };
  String(src || '').replace(/\r/g, '').split('\n').forEach(raw => {
    const l = raw.replace(/\s+$/, ''); let m;
    if (!l.trim()) { flushP(); flushL(); return; }
    if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { flushP(); flushL(); const n = m[1].length + 1; out += '<h' + n + '>' + inline(m[2]) + '</h' + n + '>'; return; }
    if ((m = l.match(/^\s*[-*]\s+(.*)$/))) { flushP(); if (list !== 'ul') { flushL(); out += '<ul>'; list = 'ul'; } out += '<li>' + inline(m[1]) + '</li>'; return; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { flushP(); if (list !== 'ol') { flushL(); out += '<ol>'; list = 'ol'; } out += '<li>' + inline(m[1]) + '</li>'; return; }
    flushL(); para.push(l);
  });
  flushP(); flushL();
  return out;
}
async function loadKb() {
  S.kb = await rpc('cd_kb_list', { p_q: S.kbQ.trim() || null, p_cat: S.kbCat || null });
  if (S.kbSel) { try { S.kbArticle = await rpc('cd_kb_get', { p_id: S.kbSel }); } catch (e) { S.kbSel = null; S.kbArticle = null; } }
}
function kbPanel() {
  const K = S.kb;
  if (S.kbEdit) {
    const E = S.kbEdit;
    return '<div class="stack" style="gap:14px;max-width:none"><div><span class="small muted">' + (E.id ? 'Artikel bewerken' : 'Nieuw artikel') + '</span></div>' +
      '<div class="field"><label for="kb-title">Titel *</label><input class="input" id="kb-title" data-kb="title" maxlength="160" value="' + esc(E.title) + '" placeholder="Bijv. Een retour verwerken"></div>' +
      '<div class="field"><label for="kb-cat">Categorie</label><input class="input" id="kb-cat" data-kb="category" maxlength="40" list="kb-cats" value="' + esc(E.category) + '" placeholder="Bijv. Klantenservice">' +
        '<datalist id="kb-cats">' + K.categories.map(c => '<option value="' + esc(c) + '">').join('') + '</datalist></div>' +
      '<div class="field"><label for="kb-body">Tekst</label><textarea class="input" id="kb-body" data-kb="body" rows="16" aria-describedby="kb-help">' + esc(E.body) + '</textarea>' +
        '<span class="small muted" id="kb-help">Opmaak: # Kop · ## Tussenkop · **vet** · regels die met - beginnen worden een lijst · 1. genummerde stappen · links worden vanzelf klikbaar.</span></div>' +
      '<label class="check"><input type="checkbox" id="kb-pin" data-kb-pin' + (E.pinned ? ' checked' : '') + '> Vastzetten bovenaan</label>' +
      '<div class="form-foot"><button class="btn ghost" data-act="kb-cancel">Annuleren</button><button class="btn primary" data-act="kb-save">' + (E.id ? 'Opslaan' : 'Publiceren') + '</button></div></div>';
  }
  const A = S.kbArticle;
  if (!A) return '<div class="empty-state"><strong>Kies een artikel</strong>Of zoek op een woord, bijvoorbeeld "retour" of "wachtwoord".</div>';
  return '<article class="stack" style="gap:12px;max-width:none"><div>' + (A.category ? '<span class="badge">' + esc(A.category) + '</span> ' : '') + (A.pinned ? '<span class="badge blue">' + ICON.pin + ' Vast</span>' : '') +
    '<h2 class="kb-title">' + esc(A.title) + '</h2><p class="small muted" style="margin:0">Bijgewerkt ' + esc(fmtDate(A.updatedAt)) + ' door ' + esc(A.updatedByName || 'onbekend') + '</p></div>' +
    '<div class="prose">' + (A.body.trim() ? md(A.body) : '<p class="muted">Dit artikel is nog leeg.</p>') + '</div>' +
    (A.canEdit ? '<div class="detail-section" style="flex-direction:row;flex-wrap:wrap"><button class="btn small" data-act="kb-edit">' + ICON.edit + 'Bewerken</button><button class="btn small danger" data-act="kb-del">' + ICON.trash + 'Verwijderen</button></div>' : '') + '</article>';
}
function viewKb() {
  const K = S.kb; if (!K) return '';
  let h = '<header class="page-head"><div><h1>Kennisbank</h1><p>Werkinstructies, afspraken en antwoorden op vaste vragen. Voor iedereen in ' + esc(S.org.name) + '.</p></div>' +
    (K.canEdit ? '<div class="actions"><button class="btn primary" data-act="kb-new">' + ICON.plus + 'Nieuw artikel</button></div>' : '') + '</header>';
  h += '<div class="search soft">' + ICON.search + '<label class="sr-only" for="kb-q">Zoeken in de kennisbank</label><input id="kb-q" type="search" data-in="kbq" value="' + esc(S.kbQ) + '" placeholder="Zoek in titels en tekst" autocomplete="off"></div>';
  if (K.categories.length) {
    h += '<div class="chips">' + [['', 'Alles']].concat(K.categories.map(c => [c, c])).map(c => '<button class="chip' + (S.kbCat === c[0] ? ' on' : '') + '" data-act="kb-cat" data-v="' + esc(c[0]) + '" aria-pressed="' + (S.kbCat === c[0]) + '">' + esc(c[1]) + '</button>').join('') + '</div>';
  }
  if (!K.articles.length && !S.kbQ && !S.kbCat && !S.kbEdit) {
    return h + '<div class="empty-state card"><strong>Nog geen artikelen</strong>' + (K.canEdit ? 'Schrijf het eerste, bijvoorbeeld hoe jullie een retour afhandelen of wie je belt bij storing.' : 'Zodra je teamleider iets schrijft, staat het hier.') + '</div>';
  }
  h += '<div class="split"><div class="list">' + (K.articles.length ? K.articles.map(a => '<button class="item' + (same(a.id, S.kbSel) && !S.kbEdit ? ' sel' : '') + '" data-act="kb-sel" data-id="' + a.id + '">' +
    '<span class="item-top"><span class="item-title">' + (a.pinned ? ICON.pin + ' ' : '') + esc(a.title) + '</span>' + (a.category ? '<span class="badge">' + esc(a.category) + '</span>' : '') + '</span>' +
    (a.excerpt.trim() ? '<span class="item-sub">' + esc(a.excerpt.trim()) + (a.excerpt.length >= 180 ? '…' : '') + '</span>' : '') +
    '<span class="item-meta">Bijgewerkt ' + esc(fmtDate(a.updatedAt)) + ' · ' + esc(a.updatedByName || '') + '</span></button>').join('') : '<div class="empty">Niets gevonden.</div>') +
    '</div><aside class="detail card" style="flex:2 1 460px">' + kbPanel() + '</aside></div>';
  return h;
}

// ======================================================================
// Documenten
// ======================================================================
async function loadDocs() {
  try { S.docs = await rpc('cd_docs', { p_folder: S.docFolder || null }); }
  catch (e) { if (S.docFolder) { S.docFolder = null; S.docs = await rpc('cd_docs', { p_folder: null }); toast(e.message, true); } else throw e; }
}
function fmtSize(b) { if (b < 1024) return b + ' B'; if (b < 1048576) return Math.round(b / 1024) + ' KB'; return (b / 1048576).toFixed(1).replace('.', ',') + ' MB'; }
function extOf(n) { const m = String(n).match(/\.([A-Za-z0-9]+)$/); return m ? m[1].toUpperCase().slice(0, 4) : 'BESTAND'; }
function folderForm() {
  const E = S.folderEdit; const D = S.docs;
  return '<section class="card stack" style="gap:14px"><h2 style="margin:0">' + (E.id ? 'Map bewerken' : 'Nieuwe map') + '</h2>' +
    '<div class="field"><label for="fo-name">Naam</label><input class="input" id="fo-name" data-fo="name" maxlength="60" value="' + esc(E.name) + '" placeholder="Bijv. Handboeken"></div>' +
    '<fieldset class="perm-group"><legend class="legend" style="padding:0 4px">Wie mag deze map zien?</legend>' +
      D.roles.map(r => '<label class="check"><input type="checkbox" data-fo-role="' + r.id + '"' + (E.roleIds.some(x => same(x, r.id)) ? ' checked' : '') + '> ' + esc(r.name) + '</label>').join('') +
      '<span class="small muted">Niets aangevinkt = iedereen. De eigenaar en mensen met het recht "Mappen en documenten beheren" zien altijd alles.</span></fieldset>' +
    '<div class="form-foot">' + (E.id ? '<button class="btn danger small" data-act="fo-del" style="margin-right:auto">' + ICON.trash + 'Map verwijderen</button>' : '') +
      '<button class="btn small ghost" data-act="fo-cancel">Annuleren</button><button class="btn primary small" data-act="fo-save">' + (E.id ? 'Opslaan' : 'Map maken') + '</button></div></section>';
}
function viewDocs() {
  const D = S.docs; if (!D) return '';
  const F = D.folder;
  const access = f => f.roleIds.length ? 'Alleen ' + f.roleNames.join(', ') : 'Iedereen';
  let h = '<header class="page-head"><div>' + (F ? '<nav class="crumbs" aria-label="Kruimelpad"><a href="#/documenten" data-act="doc-folder" data-v="">Documenten</a> / </nav>' : '') +
    '<h1>' + (F ? esc(F.name) : 'Documenten') + '</h1><p>' + (F ? 'Zichtbaar voor: ' + esc(access(D.folders.find(x => same(x.id, F.id)) || { roleIds: F.roleIds, roleNames: [] })) : 'Handboeken, formulieren en afspraken. Per map bepaal je wie erbij kan.') + '</p></div>' +
    '<div class="actions">' + (F && D.canManage ? '<button class="btn" data-act="fo-edit" data-id="' + F.id + '">' + ICON.edit + 'Map bewerken</button>' : '') +
    (!F && D.canManage ? '<button class="btn" data-act="fo-new">' + ICON.plus + 'Nieuwe map</button>' : '') +
    (D.canUpload ? '<label class="btn primary upload-btn">' + ICON.upload + 'Uploaden<input type="file" multiple data-in="upload" class="sr-only"></label>' : '') + '</div></header>';
  if (S.uploading) h += '<div class="alert info" role="status"><span>' + esc(S.uploading) + '</span></div>';
  if (S.folderEdit) h += folderForm();
  if (!F) {
    h += '<div class="folders">' + D.folders.map(f => '<button class="folder" data-act="doc-folder" data-v="' + f.id + '">' + ICON.folder +
      '<span><strong>' + esc(f.name) + '</strong><small>' + f.count + (f.count === 1 ? ' document' : ' documenten') + ' · ' + esc(access(f)) + '</small></span></button>').join('') + '</div>';
  }
  h += '<section class="stack" style="gap:8px;max-width:none"><div class="section-title"><h2>' + (F ? 'In deze map' : 'Algemeen') + '</h2>' + (!F ? '<span class="small muted">Voor iedereen zichtbaar</span>' : '') + '</div>';
  if (!D.docs.length) {
    h += '<div class="empty">' + (D.canUpload ? 'Nog geen documenten. Klik op Uploaden om er een toe te voegen (maximaal 20 MB per bestand).' : 'Nog geen documenten.') + '</div>';
  } else {
    h += '<div class="doc-list">' + D.docs.map(d => '<div class="doc"><span class="doc-ext">' + esc(extOf(d.name)) + '</span>' +
      '<div class="doc-main"><strong>' + esc(d.name) + '</strong><span class="small muted">' + fmtSize(d.size) + ' · ' + esc(d.uploadedByName || '') + ' · ' + esc(fmtDate(d.createdAt)) + '</span></div>' +
      '<div class="doc-act"><button class="btn small" data-act="doc-dl" data-id="' + d.id + '">' + ICON.download + 'Downloaden</button>' +
      (d.canDelete ? '<button class="icon-btn small" data-act="doc-del" data-id="' + d.id + '" aria-label="' + esc(d.name) + ' verwijderen">' + ICON.trash + '</button>' : '') + '</div></div>').join('') + '</div>';
  }
  return h + '</section>';
}
async function uploadFiles(files) {
  const D = S.docs; const folder = D && D.folder ? D.folder.id : null;
  let ok = 0; const fails = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    S.uploading = 'Bezig met uploaden (' + (i + 1) + ' van ' + files.length + '): ' + f.name; render();
    let prep = null;
    try {
      prep = await rpc('cd_doc_prepare', { p_folder: folder, p_name: f.name, p_size: f.size, p_mime: f.type || '' });
      const { error } = await sb.storage.from('crewdeck').upload(prep.path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
      if (error) throw new Error('Uploaden mislukt: ' + error.message);
      await rpc('cd_doc_confirm', { p_id: prep.id });
      ok++;
    } catch (e) {
      fails.push(f.name + ': ' + e.message);
      if (prep) { try { await rpc('cd_doc_delete', { p_id: prep.id }); } catch (err) { /* */ } }
    }
  }
  S.uploading = null;
  await loadDocs(); render();
  if (fails.length) toast((ok ? ok + ' geüpload, ' + fails.length + ' niet. ' : '') + fails.join(' · '), true); else toast(ok === 1 ? 'Document geüpload.' : ok + ' documenten geüpload.');
}

// ---------- formulieren inloggen / registreren ----------
$app.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault(); unlockAudio();
  const btn = f.querySelector('button[type=submit]');
  if (btn) btn.disabled = true;
  try {
    if (f.dataset.form === 'login') {
      const company = f.elements.company.value.trim().toLowerCase(), name = f.elements.name.value.trim(), code = f.elements.code.value.trim();
      if (!company || !name || !code) throw new Error('Vul je bedrijfscode, naam en code in.');
      const d = await svc('login', { company, name, code });
      await sb.auth.setSession(d.session);
      try { localStorage.setItem('crewdeck-company', company); } catch (err) { /* */ }
    } else {
      const v = k => (f.elements[k] ? f.elements[k].value.trim() : '');
      const d = await svc('register', { orgName: v('orgName'), slug: v('slug').toLowerCase(), ownerName: v('ownerName'), code: v('code'), website: v('website') });
      if (d.session) await sb.auth.setSession(d.session);
      try { localStorage.setItem('crewdeck-company', d.slug); } catch (err) { /* */ }
      toast('Welkom bij Crewdeck! Je bedrijf staat klaar.');
    }
    await loadSession();
    S.authError = null; S.seen = null;
    location.hash = '#/overzicht'; await onRoute();
  } catch (err) {
    S.authError = err.message;
    const vals = {}; [...f.elements].forEach(el => { if (el.id && el.type !== 'password') vals[el.id] = el.value; });
    render();
    Object.keys(vals).forEach(id => { const el = document.getElementById(id); if (el) el.value = vals[id]; });
    const c = document.querySelector('input[type=password]'); if (c) c.focus();
  }
});

// ---------- invoer ----------
let searchTimer, similarTimer, dupTimer, cbqTimer, logTimer;
$app.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.f && S.F) { S.F[el.dataset.f] = el.value; S.F.serverError = null; if (el.dataset.f === 'order' || el.dataset.f === 'phone') checkDup(); return; }
  if (el.dataset.t && S.T) { S.T[el.dataset.t] = el.value; S.T.serverError = null; if (el.dataset.t === 'title') checkSimilar(); return; }
  if (el.dataset.in === 'q') { S.q = el.value; runSearch(); }
  if (el.dataset.in === 'cbq') {
    S.cbQ = el.value; clearTimeout(cbqTimer);
    cbqTimer = setTimeout(async () => {
      try {
        S.cbResults = S.cbQ.trim().length >= 2 ? await rpc('cd_callback_search', { p_q: S.cbQ.trim() }) : null;
        const list = S.cbResults || S.cbList;
        if (!list.some(c => same(c.id, S.cbSel))) S.cbSel = list.length ? list[0].id : null;
        renderKeepFocus();
      } catch (err) { toast(err.message, true); }
    }, 250);
  }
  if (el.dataset.h && S.hEdit) {
    S.hEdit[el.dataset.h] = el.value;
    if (['start', 'end', 'breakMin'].includes(el.dataset.h)) { const box = el.closest('.entry-form'); if (box) { const p = box.querySelector('p.small'); const E = S.hEdit;
      const txt = E.start && E.end && E.start !== E.end ? 'Totaal: <strong>' + fmtHM(Math.max(0, spanMin(E.start, E.end) - (Number(E.breakMin) || 0))) + '</strong>' + (E.end < E.start ? ' (loopt door na middernacht)' : '') : '';
      if (p) p.innerHTML = txt; else if (txt) box.querySelector('.form-foot').insertAdjacentHTML('beforebegin', '<p class="small muted" style="margin:0">' + txt + '</p>'); } }
    return;
  }
  if (el.dataset.sh && S.shiftEdit) { S.shiftEdit[el.dataset.sh] = el.value; return; }
  if (el.dataset.kb && S.kbEdit) { S.kbEdit[el.dataset.kb] = el.value; return; }
  if (el.dataset.fo && S.folderEdit) { S.folderEdit.name = el.value; return; }
  if (el.dataset.in === 'kbq') { S.kbQ = el.value; clearTimeout(logTimer); logTimer = setTimeout(async () => { try { await loadKb(); renderKeepFocus(); } catch (err) { toast(err.message, true); } }, 300); }
  if (el.dataset.in === 'logq') { S.logQ = el.value; clearTimeout(logTimer); logTimer = setTimeout(async () => { try { await loadLog(); renderKeepFocus(); } catch (err) { toast(err.message, true); } }, 300); }
});
$app.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.f && S.F) { S.F[el.dataset.f] = el.value; if (el.dataset.f === 'colleague') render(); }
  if (el.dataset.t && S.T) { S.T[el.dataset.t] = el.value; if (el.dataset.rerender) render(); }
  if (el.dataset.in === 'loguser') { S.logUser = el.value; try { await loadLog(); render(); } catch (err) { toast(err.message, true); } }
  if (el.dataset.actChange === 'm-role-new') { const n = document.getElementById('m-name').value; S.mNewRole = el.value; render(); document.getElementById('m-name').value = n; }
  if (el.dataset.sh && S.shiftEdit) S.shiftEdit[el.dataset.sh] = el.value;
  if (el.dataset.h && S.hEdit) S.hEdit[el.dataset.h] = el.value;
  if (el.dataset.kbPin !== undefined && S.kbEdit) S.kbEdit.pinned = el.checked;
  if (el.dataset.foRole && S.folderEdit) { const id = el.dataset.foRole; S.folderEdit.roleIds = S.folderEdit.roleIds.filter(x => !same(x, id)); if (el.checked) S.folderEdit.roleIds.push(id); }
  if (el.dataset.psel) { if (el.checked) delete S.pOff[el.dataset.psel]; else S.pOff[el.dataset.psel] = true; render(); }
  if (el.dataset.in === 'upload' && el.files && el.files.length) { const files = [...el.files]; el.value = ''; uploadFiles(files); }
  if (el.dataset.actChange === 'm-ctype') { const hrs = document.getElementById('m-chours'); if (hrs) { hrs.disabled = el.value === 'flex'; hrs.placeholder = el.value === 'flex' ? 'Niet van toepassing' : 'Bijv. 32'; if (el.value === 'flex') hrs.value = ''; } }
  if (el.dataset.actChange === 'm-role-edit') { const box = document.getElementById('m-perms'); if (box) box.innerHTML = permSummary(el.value); }
});
function runSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = S.q.trim();
    if (!q.split(/[^0-9A-Za-zÀ-ÿ]+/).some(w => w.length >= 3)) S.results = null;
    else { try { S.results = await rpc('cd_task_search', { p_q: q }); } catch (err) { toast(err.message, true); } }
    const box = document.getElementById('search-results'); if (box) box.innerHTML = viewResults();
  }, 250);
}
function checkSimilar() {
  clearTimeout(similarTimer);
  similarTimer = setTimeout(async () => {
    if (!S.T) return;
    const q = S.T.title.trim();
    if (q.length < 3) S.T.similar = null; else { try { S.T.similar = await rpc('cd_task_search', { p_q: q }); } catch (err) { /* stil */ } }
    const box = document.getElementById('similar'); if (box) box.innerHTML = viewSimilar();
  }, 400);
}
function checkDup() {
  clearTimeout(dupTimer);
  dupTimer = setTimeout(async () => {
    if (!S.F) return;
    try { S.dup = await rpc('cd_callback_check', { p_order: S.F.order, p_phone: S.F.phone, p_exclude: S.F.editId || null }); } catch (err) { S.dup = null; }
    const box = document.getElementById('dup'); if (box) box.innerHTML = viewDup();
  }, 400);
}

// ---------- slepen op het teambord ----------
let dragId = null;
$app.addEventListener('dragstart', e => {
  const card = e.target.closest('[data-drag]'); if (!card) return;
  dragId = Number(card.dataset.drag); e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', String(dragId)); } catch (err) { /* */ }
  card.classList.add('dragging');
});
$app.addEventListener('dragend', e => {
  const card = e.target.closest('[data-drag]'); if (card) card.classList.remove('dragging');
  document.querySelectorAll('.col.over').forEach(c => c.classList.remove('over')); dragId = null;
});
$app.addEventListener('dragover', e => {
  const col = e.target.closest('[data-drop]'); if (!col || dragId == null) return;
  e.preventDefault();
  document.querySelectorAll('.col.over').forEach(c => { if (c !== col) c.classList.remove('over'); });
  col.classList.add('over');
});
$app.addEventListener('drop', async e => {
  const col = e.target.closest('[data-drop]'); if (!col || dragId == null) return;
  e.preventDefault();
  const id = dragId; dragId = null; col.classList.remove('over');
  const target = col.dataset.drop;
  const from = (S.team || []).find(c => c.callbacks.some(x => same(x.id, id)));
  if (from && (from.user ? String(from.user.id) : 'pool') === target) return;
  try {
    await rpc('cd_callback_action', { p_id: id, p_action: 'assign', p_text: null, p_assignee: target });
    const col2 = S.team.find(c => c.user && same(c.user.id, target));
    toast('Verplaatst naar ' + (target === 'pool' ? 'de open pool' : col2.user.name) + '.');
    S.quiet = true;
    try { await loadRoute(); } finally { S.quiet = false; }
    render();
  } catch (err) { toast(err.message, true); }
});
$app.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches && e.target.matches('.mini[data-act="team-open"]')) e.target.click(); });

// ---------- knoppen ----------
const linesOf = id => document.getElementById(id).value.split('\n').map(s => s.trim()).filter(Boolean);
$app.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const raw = el.dataset.id;
  const num = raw != null ? Number(raw) : null;
  try {
    switch (act) {
      case 'logout': await sb.auth.signOut(); S.me = null; S.seen = null; S.authError = null; location.hash = '#/login'; render(); return;
      case 'sound': prefs.sound = !prefs.sound; savePrefs(); unlockAudio(); if (prefs.sound) beep(); render(); return;
      case 'notif-allow': await Notification.requestPermission(); render(); return;
      case 'go-pool': S.cbTab = 'pool'; return;
      case 'hidecode': S.shownCode = null; render(); return;
      case 'nav-group': {
        if (el.dataset.locked) return;
        const g = el.closest('.nav-group'); const open = g.classList.toggle('open');
        el.setAttribute('aria-expanded', String(open));
        prefs.navClosed = prefs.navClosed || {}; if (open) delete prefs.navClosed[el.dataset.v]; else prefs.navClosed[el.dataset.v] = true; savePrefs();
        return;
      }
      case 'menu': { const nav = el.closest('.nav'); const open = nav.classList.toggle('open'); el.setAttribute('aria-expanded', String(open)); el.textContent = open ? 'Sluiten' : 'Menu'; return; }

      case 'cb-tab': S.cbTab = el.dataset.v; S.cbSel = null; await loadCallbacks(); render(); return;
      case 'cb-sel': S.cbSel = num; render(); return;
      case 'cb-clearq': S.cbQ = ''; S.cbResults = null; S.cbSel = null; await loadCallbacks(); render(); return;
      case 'cb-edit': S.edit = { kind: 'cb', id: num }; go('verzoek'); return;
      case 'cb-quick': {
        const inp = document.getElementById('cb-note'); const v = el.dataset.v;
        inp.value = inp.value.trim() ? (inp.value.includes(v) ? inp.value : inp.value.trim() + ' · ' + v) : v; inp.focus(); return;
      }
      case 'cb-claim': await rpc('cd_callback_action', { p_id: num, p_action: 'claim' }); toast('Opgepakt. Het staat nu in jouw lijst.'); break;
      case 'cb-reopen': await rpc('cd_callback_action', { p_id: num, p_action: 'reopen' }); toast('Weer opengezet.'); break;
      case 'cb-done': await rpc('cd_callback_action', { p_id: num, p_action: 'done', p_text: (document.getElementById('cb-note') || {}).value || '' }); toast('Afgerond. Goed gedaan!'); break;
      case 'cb-attempt': {
        const note = (document.getElementById('cb-note') || {}).value || '';
        await rpc('cd_callback_action', { p_id: num, p_action: 'attempt', p_text: note ? 'Niet bereikt · ' + note : 'Niet bereikt' }); toast('Belpoging genoteerd.'); break;
      }
      case 'cb-assign': {
        const v = document.getElementById('cb-assign').value;
        await rpc('cd_callback_action', { p_id: num, p_action: 'assign', p_assignee: v }); toast(v === 'pool' ? 'Terug in de open pool.' : 'Toegewezen.'); break;
      }
      case 'cb-topool': await rpc('cd_callback_action', { p_id: num, p_action: 'assign', p_assignee: 'pool' }); toast('Terug in de open pool.'); break;

      case 'f-type': S.F.type = el.dataset.v; render(); return;
      case 'f-assign': S.F.assign = el.dataset.v; render(); return;
      case 'f-delete':
        if (!confirm('Dit verzoek definitief verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;
        await rpc('cd_callback_delete', { p_id: S.F.editId }); toast('Verzoek verwijderd.'); S.cbSel = null; go('terugbellen'); return;
      case 'f-save': {
        const F = S.F; F.tried = true;
        if (Object.keys(cbMissing(F)).length) { render(); window.scrollTo(0, 0); return; }
        F.saving = true; render();
        const body = { type: F.type, company: F.company, contact: F.contact, name: F.name, phone: F.phone, email: F.email, order: F.order, category: F.category,
          priority: F.priority, dueAt: inputToIso(F.dueAt), note: F.note, assignee: F.assign === 'colleague' ? F.colleague : F.assign };
        try {
          const c = await rpc('cd_callback_save', { p_id: F.editId || null, p: body });
          toast(F.editId ? 'Wijzigingen opgeslagen.' : (c.assigneeName ? 'Verzoek opgeslagen voor ' + (same(c.assignee, S.me.id) ? 'jou' : c.assigneeName) + '.' : 'Verzoek in de open pool gezet.'));
          S.cbQ = ''; S.cbResults = null;
          S.cbTab = same(c.assignee, S.me.id) ? 'mine' : (c.assignee ? (can('callbacks.view_all') ? 'all' : 'mine') : 'pool');
          S.cbSel = c.id; S.quiet = true; go('terugbellen');
        } catch (err) { F.saving = false; F.serverError = err.message; F.tried = false; render(); window.scrollTo(0, 0); }
        return;
      }

      case 't-view': S.tView = el.dataset.v; S.tWho = 'ALL'; await loadTasks(); render(); return;
      case 't-who': S.tWho = el.dataset.v; render(); return;
      case 't-search': S.searchOpen = !S.searchOpen; S.q = ''; S.results = null; render(); if (S.searchOpen) document.getElementById('t-q').focus(); return;
      case 't-edit': S.edit = { kind: 'task', id: num }; go('taak'); return;
      case 't-toggle': await rpc('cd_task_action', { p_id: num, p_action: 'toggle' }); break;
      case 't-archive': await rpc('cd_task_action', { p_id: num, p_action: 'archive' }); toast('Gearchiveerd.'); break;
      case 't-restore': await rpc('cd_task_action', { p_id: num, p_action: 'restore' }); toast('Teruggezet.'); break;
      case 't-archive-all': {
        const ids = S.tasks.filter(t => !t.archived && (t.done || t.mineDone)).map(t => t.id);
        for (const tid of ids) await rpc('cd_task_action', { p_id: tid, p_action: 'archive' });
        toast(ids.length === 1 ? '1 taak gearchiveerd.' : ids.length + ' taken gearchiveerd.'); break;
      }
      case 't-archive-toggle': S.showArchive = !S.showArchive; render(); return;
      case 't-person': S.T.sel[raw] = !S.T.sel[raw]; render(); return;
      case 't-allpeople': {
        const allOn = S.colleagues.every(u => S.T.sel[u.id]);
        S.T.sel = {}; if (!allOn) S.colleagues.forEach(u => { S.T.sel[u.id] = true; });
        render(); return;
      }
      case 't-mode': S.T.mode = el.dataset.v; render(); return;
      case 't-delete':
        if (!confirm('Deze taak definitief verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;
        await rpc('cd_task_delete', { p_id: S.T.editId }); toast('Taak verwijderd.'); go('taken'); return;
      case 't-save': {
        const T = S.T; T.tried = true;
        if (Object.keys(taskErrors(T)).length) { render(); window.scrollTo(0, 0); return; }
        const chosen = Object.keys(T.sel).filter(k => T.sel[k]);
        T.saving = true; render();
        try {
          await rpc('cd_task_save', { p_id: T.editId || null, p: { title: T.title, desc: T.desc, dueAt: inputToIso(T.dueAt), priority: T.priority, assignees: chosen, mode: T.mode, repeat: T.repeat } });
          toast(T.editId ? 'Wijzigingen opgeslagen.' : 'Taak aangemaakt.');
          if (!T.editId) S.tView = chosen.some(id => same(id, S.me.id)) || !can('tasks.view_all') ? 'mine' : 'all';
          S.quiet = true; go('taken');
        } catch (err) { T.saving = false; T.serverError = err.message; T.tried = false; render(); window.scrollTo(0, 0); }
        return;
      }

      case 'team-refresh': await loadRoute(); render(); toast('Bijgewerkt.'); return;
      case 'team-open': S.cbTab = can('callbacks.view_all') ? 'all' : 'mine'; S.cbQ = ''; S.cbResults = null; S.cbSel = num; go('terugbellen'); return;
      case 'stat-days': S.statDays = Number(el.dataset.v); S.stats = await rpc('cd_stats', { p_days: S.statDays }); render(); return;

      // uren
      case 'clock-in': await rpc('cd_hours_clock', { p_action: 'in' }); toast('Ingeklokt. Fijne dienst!'); break;
      case 'clock-out': { const e2 = await rpc('cd_hours_clock', { p_action: 'out' }); toast('Uitgeklokt: ' + fmtHM(e2.minutes) + ' gewerkt. Vergeet je pauze niet in te vullen.'); break; }
      case 'h-week': S.hWeek = el.dataset.v; S.hEdit = null; await loadHours(); render(); return;
      case 'h-me': S.hMember = null; S.hEdit = null; await loadHours(); render(); return;
      case 'h-add': {
        const d = el.dataset.v; const sh = S.hours.shifts.find(x => x.date === d);
        S.hEdit = { id: null, date: d, start: sh ? sh.start : '', end: sh ? sh.end : '', breakMin: sh && spanMin(sh.start, sh.end) > 330 ? 30 : 0, note: '' };
        render(); const f = document.getElementById(sh ? 'h-break' : 'h-start'); if (f) f.focus(); return;
      }
      case 'h-edit': { const e2 = S.hours.entries.find(x => same(x.id, raw)); S.hEdit = { id: e2.id, date: e2.date, start: e2.start, end: e2.end || '', breakMin: e2.breakMin, note: e2.note || '' }; render(); return; }
      case 'h-cancel': S.hEdit = null; render(); return;
      case 'h-save': {
        const E = S.hEdit;
        if (!E.date || !E.start || !E.end) { toast('Vul een datum, begintijd en eindtijd in.', true); return; }
        const saved = await rpc('cd_hours_save', { p_id: E.id || null, p: { date: E.date, start: E.start, end: E.end, breakMin: Number(E.breakMin) || 0, note: E.note } });
        toast((E.id ? 'Aangepast: ' : 'Opgeslagen: ') + fmtHM(saved.minutes) + ' uur.');
        S.hEdit = null; if (mondayOf(E.date) !== S.hWeek) S.hWeek = mondayOf(E.date); break;
      }
      case 'h-del': if (!confirm('Deze uren verwijderen?')) return; await rpc('cd_hours_delete', { p_id: num }); toast('Verwijderd.'); break;
      case 'h-submit': {
        if (S.running && mondayOf(S.running.date) === S.hWeek && !confirm('Je bent nog ingeklokt. De lopende dienst wordt niet meegenomen. Toch indienen?')) return;
        const d = await rpc('cd_hours_submit', { p_week: S.hWeek }); toast('Ingediend: ' + fmtHM(d.minutes) + ' uur in ' + d.count + (d.count === 1 ? ' regel.' : ' regels.')); break;
      }
      case 'h-reopen': if (!confirm('Deze goedgekeurde uren terugzetten naar concept? De medewerker kan ze dan weer aanpassen.')) return; await rpc('cd_hours_reopen', { p_id: num }); toast('Teruggezet naar concept.'); break;

      // rooster
      case 'ro-week': S.rosterWeek = el.dataset.v; S.shiftEdit = null; break;
      case 'sh-new': {
        const prev = S.shiftEdit;
        S.shiftEdit = { id: null, memberId: raw, date: el.dataset.v, start: prev && !prev.id ? prev.start : '09:00', end: prev && !prev.id ? prev.end : '17:00', note: prev && !prev.id ? prev.note : '' };
        render(); window.scrollTo(0, 0); return;
      }
      case 'sh-edit': { const s2 = S.roster.shifts.find(x => same(x.id, raw)); S.shiftEdit = Object.assign({}, s2, { memberId: s2.memberId, note: s2.note || '' }); render(); window.scrollTo(0, 0); return; }
      case 'sh-cancel': S.shiftEdit = null; render(); return;
      case 'sh-save': {
        const E = S.shiftEdit;
        await rpc('cd_shift_save', { p_id: E.id || null, p: { memberId: E.memberId, date: E.date, start: E.start, end: E.end, note: E.note } });
        toast(E.id ? 'Dienst gewijzigd.' : 'Dienst ingepland.');
        if (E.id) S.shiftEdit = null; else S.shiftEdit = Object.assign({}, E, { date: addDays(E.date, 1) <= addDays(S.rosterWeek, 6) ? addDays(E.date, 1) : E.date });
        break;
      }
      case 'sh-del': if (!confirm('Deze dienst verwijderen?')) return; await rpc('cd_shift_delete', { p_id: num }); S.shiftEdit = null; toast('Dienst verwijderd.'); break;

      // goedkeuren
      case 'p-view': S.hMember = raw; S.hWeek = el.dataset.v; S.hKeep = true; go('uren'); return;
      case 'p-reject-open': S.rejectFor = el.dataset.v; render(); { const f = document.getElementById('rej-reason'); if (f) f.focus(); } return;
      case 'p-reject-cancel': S.rejectFor = null; render(); return;
      case 'p-approve': case 'p-reject': {
        const g = pendingGroups().find(x => x.key === el.dataset.v); if (!g) return;
        const ids = g.entries.filter(e2 => !S.pOff[e2.id]).map(e2 => e2.id);
        const reason = act === 'p-reject' ? (document.getElementById('rej-reason') || {}).value || '' : null;
        if (act === 'p-reject' && !reason.trim()) { toast('Geef een reden op, dan weet ' + g.name + ' wat er moet worden aangepast.', true); return; }
        const d = await rpc('cd_hours_review', { p_ids: ids, p_approve: act === 'p-approve', p_reason: reason });
        toast((act === 'p-approve' ? 'Goedgekeurd: ' : 'Afgekeurd: ') + d.count + (d.count === 1 ? ' regel van ' : ' regels van ') + g.name + '.');
        S.rejectFor = null; break;
      }

      // urenoverzicht
      case 'rep-period': S.repPeriod = el.dataset.v; if (S.repPeriod === 'eigen') { render(); return; } break;
      case 'rep-custom': {
        const f = document.getElementById('rep-from').value, t = document.getElementById('rep-to').value;
        if (!f || !t) { toast('Kies een begin- en einddatum.', true); return; }
        S.repFrom = f; S.repTo = t; break;
      }
      case 'rep-csv': exportCsv(); return;

      // kennisbank
      case 'kb-cat': S.kbCat = el.dataset.v; break;
      case 'kb-sel': S.kbSel = num; S.kbEdit = null; S.kbArticle = await rpc('cd_kb_get', { p_id: num }); render(); if (window.innerWidth < 900) { const d = document.querySelector('.detail'); if (d) d.scrollIntoView({ behavior: 'smooth' }); } return;
      case 'kb-new': S.kbEdit = { id: null, title: '', category: S.kbCat || '', body: '', pinned: false }; render(); document.getElementById('kb-title').focus(); return;
      case 'kb-edit': { const A = S.kbArticle; S.kbEdit = { id: A.id, title: A.title, category: A.category, body: A.body, pinned: A.pinned }; render(); return; }
      case 'kb-cancel': S.kbEdit = null; render(); return;
      case 'kb-save': {
        const E = S.kbEdit;
        if (E.title.trim().length < 2) { toast('Geef het artikel een titel.', true); return; }
        const a = await rpc('cd_kb_save', { p_id: E.id || null, p: { title: E.title, category: E.category, body: E.body, pinned: !!E.pinned } });
        toast(E.id ? 'Artikel opgeslagen.' : 'Artikel gepubliceerd.'); S.kbEdit = null; S.kbSel = a.id; break;
      }
      case 'kb-del': if (!confirm('Dit artikel verwijderen? Dit kan niet ongedaan worden gemaakt.')) return; await rpc('cd_kb_delete', { p_id: S.kbSel }); S.kbSel = null; S.kbArticle = null; toast('Artikel verwijderd.'); break;

      // documenten
      case 'doc-folder': e.preventDefault(); S.docFolder = el.dataset.v || null; S.folderEdit = null; await loadDocs(); render(); window.scrollTo(0, 0); return;
      case 'doc-dl': {
        const d = S.docs.docs.find(x => same(x.id, raw));
        const { data, error } = await sb.storage.from('crewdeck').createSignedUrl(d.path, 120, { download: d.name });
        if (error || !data) throw new Error('Downloaden lukt niet: ' + (error ? error.message : 'onbekende fout'));
        const a = document.createElement('a'); a.href = data.signedUrl; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); return;
      }
      case 'doc-del': {
        const d = S.docs.docs.find(x => same(x.id, raw));
        if (!confirm('"' + d.name + '" verwijderen?')) return;
        const r2 = await rpc('cd_doc_delete', { p_id: raw });
        try { await sb.storage.from('crewdeck').remove([r2.path]); } catch (err) { /* het bestand is al onzichtbaar */ }
        toast('Document verwijderd.'); break;
      }
      case 'fo-new': S.folderEdit = { id: null, name: '', roleIds: [] }; render(); document.getElementById('fo-name').focus(); return;
      case 'fo-edit': { const F = S.docs.folder; S.folderEdit = { id: F.id, name: F.name, roleIds: (F.roleIds || []).slice() }; render(); return; }
      case 'fo-cancel': S.folderEdit = null; render(); return;
      case 'fo-save': {
        const E = S.folderEdit;
        if (!E.name.trim()) { toast('Geef de map een naam.', true); return; }
        const f = await rpc('cd_folder_save', { p_id: E.id || null, p: { name: E.name, roleIds: E.roleIds } });
        toast(E.id ? 'Map opgeslagen.' : 'Map gemaakt.'); S.folderEdit = null; S.docFolder = f.id; break;
      }
      case 'fo-del': {
        if (!confirm('Deze map verwijderen? Dat kan alleen als hij leeg is.')) return;
        await rpc('cd_folder_delete', { p_id: S.folderEdit.id }); S.folderEdit = null; S.docFolder = null; toast('Map verwijderd.'); break;
      }

      // mensen
      case 'm-sel': S.mSel = raw; S.mNew = false; render(); return;
      case 'm-new': S.mNew = true; S.mNewRole = null; render(); document.getElementById('m-name').focus(); return;
      case 'm-cancel': S.mNew = false; render(); return;
      case 'm-create': {
        const name = document.getElementById('m-name').value.trim();
        const roleId = document.getElementById('m-role').value;
        if (name.length < 2) { toast('Vul een naam in van minstens 2 tekens.', true); return; }
        el.disabled = true;
        const d = await svc('member-create', { name, roleId });
        S.shownCode = { name: d.member.name, code: d.code }; S.mNew = false; S.mSel = d.member.id;
        await loadPeople(); render(); window.scrollTo(0, 0); return;
      }
      case 'm-save': {
        const p = { name: document.getElementById('m-name').value };
        const role = document.getElementById('m-role'); const active = document.getElementById('m-active');
        if (role) p.roleId = role.value;
        if (active) p.active = active.checked;
        await rpc('cd_member_update', { p_id: raw, p });
        const ct = document.getElementById('m-ctype');
        if (ct) {
          const u = S.members.find(x => same(x.id, raw));
          const hrs = ct.value === 'flex' ? 0 : Number(String(document.getElementById('m-chours').value).replace(',', '.'));
          if (ct.value === 'vast' && (!isFinite(hrs) || hrs < 0 || hrs > 80)) throw new Error('Vul bij een vast contract 0 tot 80 uur per week in.');
          if (!u || u.contractType !== ct.value || Number(u.contractHours) !== hrs) await rpc('cd_member_contract', { p_id: raw, p_type: ct.value, p_hours: hrs });
        }
        toast('Opgeslagen.');
        if (same(raw, S.me.id)) await loadSession();
        await loadPeople(); render(); return;
      }
      case 'm-reset': {
        const u = S.members.find(x => same(x.id, raw));
        if (!confirm('Nieuwe code maken voor ' + u.name + '? De oude code werkt dan niet meer.')) return;
        const d = await svc('member-code', { memberId: raw });
        S.shownCode = { name: u.name, code: d.code }; render(); window.scrollTo(0, 0); return;
      }

      // rollen
      case 'r-sel': S.rSel = raw; S.rNew = false; render(); return;
      case 'r-new': S.rNew = true; render(); document.getElementById('r-name').focus(); return;
      case 'r-cancel': S.rNew = false; render(); return;
      case 'r-save': {
        const perms = [...document.querySelectorAll('[data-perm]')].filter(c => c.checked).map(c => c.dataset.perm);
        const d = await rpc('cd_role_save', { p_id: raw || null, p: { name: document.getElementById('r-name').value, description: document.getElementById('r-desc').value, permissions: perms } });
        toast(S.rNew ? 'Rol aangemaakt.' : 'Rol opgeslagen.');
        S.rNew = false; S.rSel = d.id; await loadPeople(); await loadSession(); render(); return;
      }
      case 'r-delete': {
        if (!confirm('Deze rol verwijderen?')) return;
        await rpc('cd_role_delete', { p_id: raw }); toast('Rol verwijderd.'); S.rSel = null; await loadPeople(); render(); return;
      }

      // instellingen
      case 's-owncode': {
        const c1 = document.getElementById('s-code').value.trim(), c2 = document.getElementById('s-code2').value.trim();
        if (!/^\d{6,12}$/.test(c1)) { toast('Een code bestaat uit 6 tot 12 cijfers.', true); return; }
        if (c1 !== c2) { toast('De twee codes zijn niet hetzelfde.', true); return; }
        await svc('member-code', { memberId: S.me.id, code: c1 });
        S.shownCode = null; toast('Je nieuwe code is opgeslagen.'); render(); return;
      }
      case 'o-save': {
        const o = await rpc('cd_org_update', { p: { name: document.getElementById('o-name').value, timezone: document.getElementById('o-tz').value,
          categories: linesOf('o-cats'), quick_notes: linesOf('o-notes') } });
        S.org.name = o.name; S.org.settings = o.settings; toast('Instellingen opgeslagen.'); render(); return;
      }
      default: return;
    }
    S.quiet = true;
    try { await loadRoute(); } finally { S.quiet = false; }
    render();
  } catch (err) { toast(err.message, true); if (el.isConnected) el.disabled = false; }
});

// ---------- automatisch verversen (elke 20 seconden) ----------
setInterval(async () => {
  if (!S.me || dragId != null) return;
  const r = route(); const a = document.activeElement;
  const typing = a && /INPUT|TEXTAREA|SELECT/.test(a.tagName);
  try {
    const editing = S.hEdit || S.shiftEdit || S.rejectFor;
    if (['overzicht', 'terugbellen', 'taken', 'team', 'uren', 'goedkeuren', 'rooster'].includes(r) && !typing && !editing && !document.hidden) {
      const y = window.scrollY; await loadRoute(); render(); window.scrollTo(0, y);
    } else {
      await loadCounts();
      const nav = document.querySelector('.nav'); if (nav && !typing) nav.outerHTML = viewNav(r);
    }
  } catch (e) { /* stil */ }
}, 20000);

// lopende klok bijwerken zonder het scherm opnieuw te tekenen
setInterval(() => {
  const el = document.getElementById('clock-elapsed');
  if (el) el.textContent = fmtHM(runningSince({ date: el.dataset.date, start: el.dataset.start }));
}, 15000);

// ---------- start ----------
(async function start() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) await loadSession();
  } catch (e) { S.me = null; try { await sb.auth.signOut({ scope: 'local' }); } catch (err) { /* */ } }
  await onRoute();
})();
