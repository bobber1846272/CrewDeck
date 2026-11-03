/* Crewdeck Beheer — het beheerpaneel voor alle bedrijven (los van de bedrijfsapp).
 * Aanvragen verwerken, bedrijven aanmaken en beheren, beheerders en een logboek.
 * Praat met de database via public.cd_admin_* en met de logindienst (edge function "crewdeck", acties admin-*).
 */
'use strict';

const CFG = window.CREWDECK_CONFIG || {};
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { storageKey: 'crewdeck-admin-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});
const $app = document.getElementById('app');
const SITE = (CFG.siteUrl || (location.origin + location.pathname.replace(/admin\.html$/, ''))).replace(/\/?$/, '/');

const A = {
  ready: false, data: null, screen: 'login', err: null, busy: false,
  tab: 'aanvragen', reqFilter: 'nieuw', q: '',
  create: null, created: null, rejectFor: null, blockFor: null, editOrg: null, orgSel: null, codeFor: null, addAdmin: false
};

// ---------- hulpjes ----------
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
function fmt(v, withTime) {
  if (!v) return '–';
  const d = new Date(v); if (isNaN(d)) return '–';
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + (withTime ? ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : '');
}
function ago(v) {
  if (!v) return 'nooit';
  const m = Math.round((Date.now() - new Date(v)) / 60000);
  if (m < 2) return 'net';
  if (m < 60) return m + ' min geleden';
  const h = Math.round(m / 60); if (h < 24) return h + ' uur geleden';
  const d = Math.round(h / 24); if (d < 31) return d + (d === 1 ? ' dag' : ' dagen') + ' geleden';
  return fmt(v);
}
function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(b\.?v\.?|v\.?o\.?f\.?|holding|groep)\b/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || '';
}
const LOGO = '<svg width="32" height="32" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#15233A"/><rect x="14" y="16" width="36" height="8" rx="4" fill="#2DD4BF"/><rect x="14" y="28" width="28" height="8" rx="4" fill="#5EEAD4" opacity=".85"/><rect x="14" y="40" width="20" height="8" rx="4" fill="#99F6E4" opacity=".7"/></svg>';
let toastTimer;
function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 3800);
}

// ---------- verbinding ----------
async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args || {});
  if (error) {
    if (error.code === '42501' || error.code === 'PGRST301' || /JWT/i.test(error.message)) { await logout('Je bent uitgelogd. Log opnieuw in.'); }
    throw new Error(String(error.message || 'Er ging iets mis.').replace(/^.*?ERROR:\s*/, ''));
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
  let data = {}; try { data = await res.json(); } catch (e) { /* leeg */ }
  if (!res.ok) throw new Error(data.error || 'Er ging iets mis.');
  return data;
}
async function load() {
  A.data = await rpc('cd_admin_overview');
}
async function logout(msg) {
  try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* */ }
  A.data = null; A.screen = 'login'; A.err = msg || null; render();
}

// ---------- schermen: inrichten en inloggen ----------
function shell(inner) {
  return '<div class="login"><section class="login-brand"><div><span class="logo">' + LOGO + 'Crewdeck</span></div>' +
    '<div><h1>Crewdeck Beheer</h1><p>Aanvragen verwerken, bedrijven aanmaken en alles in de gaten houden.</p></div>' +
    '<div class="spark"><span>Een product van <strong>Spark Apps</strong></span></div></section>' +
    '<section class="login-main">' + inner + '</section></div>';
}
const errBox = () => A.err ? '<div class="alert error" role="alert"><span>' + esc(A.err) + '</span></div>' : '';
function viewLogin() {
  return shell('<form class="login-card" data-form="login" novalidate>' +
    '<div><h2>Inloggen</h2><p class="muted" style="margin:6px 0 0;font-size:14px">Alleen voor beheerders van Crewdeck.</p></div>' + errBox() +
    '<div class="field"><label for="a-name">Naam</label><input class="input" id="a-name" name="name" autocomplete="username" required></div>' +
    '<div class="field"><label for="a-pw">Wachtwoord</label><input class="input" id="a-pw" name="password" type="password" autocomplete="current-password" required></div>' +
    '<button class="btn primary" type="submit">Inloggen</button>' +
    '<p class="switch">Eerste keer? <a href="#" data-act="to-setup">Inrichten met installatiecode</a></p></form>');
}
function viewSetup() {
  return shell('<form class="login-card" data-form="setup" novalidate>' +
    '<div><h2>Beheer inrichten</h2><p class="muted" style="margin:6px 0 0;font-size:14px">Maak het eerste beheerdersaccount aan met de installatiecode. De code werkt één keer.</p></div>' + errBox() +
    '<div class="field"><label for="s-code">Installatiecode</label><input class="input" id="s-code" name="setupCode" autocapitalize="characters" spellcheck="false" autocomplete="off" placeholder="XXXX-XXXX-XXXX-XXXX" required></div>' +
    '<div class="field"><label for="s-name">Jouw naam</label><input class="input" id="s-name" name="name" autocomplete="username" required></div>' +
    '<div class="field"><label for="s-pw">Wachtwoord</label><input class="input" id="s-pw" name="password" type="password" autocomplete="new-password" minlength="10" required aria-describedby="s-pw-h">' +
      '<span class="small muted" id="s-pw-h">Minstens 10 tekens. Hiermee kun je alle bedrijven beheren, dus kies een sterk wachtwoord.</span></div>' +
    '<button class="btn primary" type="submit">Account aanmaken</button>' +
    '<p class="switch"><a href="#" data-act="to-login">Terug naar inloggen</a></p></form>');
}

// ---------- paneel ----------
function viewPanel() {
  const d = A.data;
  const open = d.requests.filter(r => r.status === 'nieuw').length;
  const tabs = [['aanvragen', 'Aanvragen', open], ['bedrijven', 'Bedrijven', d.orgs.length], ['beheerders', 'Beheerders', 0], ['logboek', 'Logboek', 0]];
  const body = { aanvragen: viewRequests, bedrijven: viewOrgs, beheerders: viewAdmins, logboek: viewLog }[A.tab]();
  return '<div class="adm">' +
    '<header class="adm-top"><div class="adm-brand">' + LOGO + '<div><strong>Crewdeck</strong> <span>Beheer</span></div></div>' +
      '<div class="adm-me"><span>' + esc(d.me.name) + '</span><button class="btn small ghost" data-act="logout">Uitloggen</button></div></header>' +
    '<main class="adm-main">' +
      '<div class="stats">' +
        stat('Nieuwe aanvragen', open) + stat('Bedrijven', d.orgs.length) +
        stat('Medewerkers', d.orgs.reduce((n, o) => n + (o.members || 0), 0)) + stat('Geblokkeerd', d.orgs.filter(o => o.blocked).length) + '</div>' +
      '<div class="adm-bar"><div class="seg" role="tablist">' + tabs.map(t => '<button role="tab" aria-selected="' + (A.tab === t[0]) + '" class="' + (A.tab === t[0] ? 'on' : '') + '" data-act="tab" data-id="' + t[0] + '">' +
        t[1] + (t[2] ? '<span class="cnt">' + t[2] + '</span>' : '') + '</button>').join('') + '</div>' +
        '<button class="btn primary" data-act="new-org">+ Bedrijf aanmaken</button></div>' +
      (A.created ? viewCreated() : '') + (A.create ? viewCreateForm() : '') + body +
    '</main></div>';
}
const stat = (label, n) => '<div class="stat"><span>' + label + '</span><strong>' + n + '</strong></div>';

function viewRequests() {
  const all = A.data.requests;
  const list = all.filter(r => A.reqFilter === 'alle' ? true : A.reqFilter === 'nieuw' ? r.status === 'nieuw' : r.status !== 'nieuw');
  let h = '<div class="tabs-inline">' + [['nieuw', 'Nieuw'], ['verwerkt', 'Verwerkt'], ['alle', 'Alle']].map(f =>
    '<button class="btn small' + (A.reqFilter === f[0] ? ' on' : '') + '" data-act="req-filter" data-id="' + f[0] + '">' + f[1] + '</button>').join('') + '</div>';
  if (!list.length) return h + '<div class="empty">' + (A.reqFilter === 'nieuw' ? 'Geen nieuwe aanvragen. Bedrijven vragen Crewdeck aan via <a href="' + esc(SITE) + '#/registreren" target="_blank" rel="noopener">het aanvraagformulier</a>.' : 'Nog niets hier.') + '</div>';
  return h + '<div class="adm-list">' + list.map(r => {
    const badge = r.status === 'nieuw' ? '<span class="badge orange">Nieuw</span>' : r.status === 'goedgekeurd' ? '<span class="badge green">Aangemaakt' + (r.orgSlug ? ' · ' + esc(r.orgSlug) : '') + '</span>' : '<span class="badge red">Afgewezen</span>';
    let x = '<article class="card adm-req"><div class="item-top"><div><div class="item-title">' + esc(r.company) + '</div>' +
      '<div class="item-meta">Aangevraagd ' + fmt(r.createdAt, true) + (r.handledBy ? ' · verwerkt door ' + esc(r.handledBy) + ' op ' + fmt(r.handledAt) : '') + '</div></div>' + badge + '</div>' +
      '<dl class="dl"><div><dt>Contactpersoon</dt><dd>' + esc(r.contactName) + '</dd></div><div><dt>E-mail</dt><dd><a href="mailto:' + esc(r.email) + '">' + esc(r.email) + '</a></dd></div>' +
      '<div><dt>Telefoon</dt><dd>' + (r.phone ? '<a href="tel:' + esc(r.phone) + '">' + esc(r.phone) + '</a>' : '–') + '</dd></div><div><dt>Medewerkers</dt><dd>' + esc(r.employees || '–') + '</dd></div>' +
      (r.message ? '<div class="full"><dt>Toelichting</dt><dd>' + esc(r.message) + '</dd></div>' : '') +
      (r.rejectReason ? '<div class="full"><dt>Reden afwijzing</dt><dd>' + esc(r.rejectReason) + '</dd></div>' : '') + '</dl>';
    if (r.status === 'nieuw') {
      if (A.rejectFor === r.id) {
        x += '<form class="box" data-form="reject" data-id="' + r.id + '"><div class="field"><label for="rj-' + r.id + '">Reden (alleen voor jezelf)</label>' +
          '<input class="input" id="rj-' + r.id + '" name="reason" placeholder="Bijv. geen bedrijf, dubbele aanvraag"></div>' +
          '<div class="row"><button class="btn danger" type="submit">Afwijzen</button><button class="btn ghost" type="button" data-act="reject-cancel">Annuleren</button></div></form>';
      } else {
        x += '<div class="row"><button class="btn primary" data-act="req-create" data-id="' + r.id + '">Bedrijf aanmaken</button>' +
          '<button class="btn" data-act="reject" data-id="' + r.id + '">Afwijzen</button></div>';
      }
    } else {
      x += '<div class="row"><button class="btn small ghost" data-act="req-delete" data-id="' + r.id + '">Verwijderen uit lijst</button></div>';
    }
    return x + '</article>';
  }).join('') + '</div>';
}

function viewCreateForm() {
  const c = A.create;
  return '<form class="card adm-create" data-form="create" novalidate><div class="item-top"><h2 style="margin:0">' + (c.requestId ? 'Bedrijf aanmaken uit aanvraag' : 'Bedrijf aanmaken') + '</h2>' +
      '<button class="btn small ghost" type="button" data-act="create-cancel">Annuleren</button></div>' +
    (c.err ? '<div class="alert error" role="alert"><span>' + esc(c.err) + '</span></div>' : '') +
    '<div class="fields2">' +
      '<div class="field"><label for="c-org">Bedrijfsnaam</label><input class="input" id="c-org" name="orgName" value="' + esc(c.orgName) + '" required></div>' +
      '<div class="field"><label for="c-slug">Bedrijfscode</label><input class="input" id="c-slug" name="slug" value="' + esc(c.slug) + '" autocapitalize="none" spellcheck="false" required aria-describedby="c-slug-h">' +
        '<span class="small muted" id="c-slug-h">Hiermee logt het team in. 3 tot 30 tekens: kleine letters, cijfers en -</span></div>' +
      '<div class="field"><label for="c-owner">Naam van de eigenaar</label><input class="input" id="c-owner" name="ownerName" value="' + esc(c.ownerName) + '" required aria-describedby="c-owner-h">' +
        '<span class="small muted" id="c-owner-h">Waarmee de eigenaar inlogt. Hij krijgt alle rechten.</span></div>' +
      '<div class="field"><label for="c-cname">Contactpersoon</label><input class="input" id="c-cname" name="contactName" value="' + esc(c.contactName) + '"></div>' +
      '<div class="field"><label for="c-mail">E-mail contactpersoon</label><input class="input" id="c-mail" name="contactEmail" type="email" value="' + esc(c.contactEmail) + '"></div>' +
      '<div class="field"><label for="c-tel">Telefoon</label><input class="input" id="c-tel" name="contactPhone" type="tel" value="' + esc(c.contactPhone) + '"></div>' +
    '</div><p class="small muted" style="margin:0">De eigenaar krijgt een code van 8 cijfers. Die zie je hierna één keer; daarna kan de eigenaar hem zelf wijzigen bij Instellingen.</p>' +
    '<div class="row"><button class="btn primary" type="submit"' + (A.busy ? ' disabled' : '') + '>' + (A.busy ? 'Bezig…' : 'Aanmaken') + '</button></div></form>';
}
function loginMessage(r, isNewCode) {
  const greet = r.contactName ? 'Hoi ' + r.contactName.split(/\s+/)[0] + ',' : 'Hoi,';
  return greet + '\n\n' + (isNewCode ? 'Hierbij een nieuwe code om in te loggen bij Crewdeck.' : 'Je Crewdeck-account staat klaar! Hiermee log je in:') + '\n\n' +
    'Website: ' + SITE + '\nBedrijfscode: ' + r.slug + '\nNaam: ' + r.ownerName + '\nCode: ' + r.code + '\n\n' +
    'Na het inloggen kun je je code wijzigen bij Instellingen en je team toevoegen bij Mensen.' +
    (isNewCode ? '' : ' Je collega’s loggen in met dezelfde bedrijfscode en hun eigen naam en code.') +
    '\n\nDe Android-app vind je in de Sparkapps store.\n\nGroet,\n' + (A.data ? A.data.me.name : '');
}
function viewCreated() {
  const r = A.created;
  return '<section class="card adm-done"><div class="item-top"><h2 style="margin:0">' + (r.isNewCode ? 'Nieuwe code voor ' : 'Klaar: ') + esc(r.orgName) + '</h2>' +
      '<button class="btn small ghost" data-act="created-close">Sluiten</button></div>' +
    '<div class="alert warn"><span>Deze code zie je maar één keer. Stuur hem nu door; daarna is hij niet meer op te vragen (wel een nieuwe te maken).</span></div>' +
    '<dl class="kv"><dt>Bedrijfscode</dt><dd>' + esc(r.slug) + '</dd><dt>Naam eigenaar</dt><dd>' + esc(r.ownerName) + '</dd><dt>Code</dt><dd class="code-big">' + esc(r.code) + '</dd></dl>' +
    '<div class="field"><label for="msg">Bericht om te versturen</label><textarea class="input" id="msg" rows="12" readonly>' + esc(loginMessage(r, r.isNewCode)) + '</textarea></div>' +
    '<div class="row"><button class="btn primary" data-act="copy-msg">Bericht kopiëren</button>' +
      (r.contactEmail ? '<a class="btn" href="mailto:' + esc(r.contactEmail) + '?subject=' + encodeURIComponent('Je Crewdeck-account') + '&body=' + encodeURIComponent(loginMessage(r, r.isNewCode)) + '">Openen in e-mail</a>' : '') + '</div></section>';
}

function viewOrgs() {
  const q = A.q.trim().toLowerCase();
  const list = A.data.orgs.filter(o => !q || [o.name, o.slug, o.owner, o.contactName, o.contactEmail].some(v => String(v || '').toLowerCase().includes(q)));
  let h = '<div class="field" style="max-width:360px"><label class="sr-only" for="o-q">Zoeken</label><input class="input" id="o-q" data-inp="q" type="search" placeholder="Zoek op naam, code of contact" value="' + esc(A.q) + '"></div>';
  if (!A.data.orgs.length) return h + '<div class="empty">Nog geen bedrijven. Maak er een aan of verwerk een aanvraag.</div>';
  if (!list.length) return h + '<div class="empty">Niets gevonden.</div>';
  return h + '<div class="adm-list">' + list.map(o => {
    const sel = A.orgSel === o.id;
    let x = '<article class="card adm-org' + (o.blocked ? ' blocked' : '') + '"><div class="item-top"><div><div class="item-title">' + esc(o.name) + ' <span class="muted" style="font-weight:400">· ' + esc(o.slug) + '</span></div>' +
      '<div class="item-meta">Eigenaar ' + esc(o.owner || '–') + ' · ' + o.members + ' actief · ' + (o.kiosks ? o.kiosks + ' prikklok' + (o.kiosks > 1 ? 'ken' : '') + ' · ' : '') + 'laatst actief ' + ago(o.lastActive) + '</div></div>' +
      '<div class="row">' + (o.blocked ? '<span class="badge red">Geblokkeerd</span>' : '<span class="badge green">Actief</span>') +
        '<button class="btn small" data-act="org-open" data-id="' + o.id + '" aria-expanded="' + sel + '">' + (sel ? 'Inklappen' : 'Beheren') + '</button></div></div>';
    if (sel) {
      if (A.editOrg === o.id) {
        x += '<form class="box" data-form="org-edit" data-id="' + o.id + '"><div class="fields2">' +
          '<div class="field"><label for="e-name">Bedrijfsnaam</label><input class="input" id="e-name" name="name" value="' + esc(o.name) + '"></div>' +
          '<div class="field"><label for="e-cn">Contactpersoon</label><input class="input" id="e-cn" name="contactName" value="' + esc(o.contactName || '') + '"></div>' +
          '<div class="field"><label for="e-ce">E-mail</label><input class="input" id="e-ce" name="contactEmail" type="email" value="' + esc(o.contactEmail || '') + '"></div>' +
          '<div class="field"><label for="e-cp">Telefoon</label><input class="input" id="e-cp" name="contactPhone" type="tel" value="' + esc(o.contactPhone || '') + '"></div></div>' +
          '<div class="field"><label for="e-notes">Notities (alleen zichtbaar in Beheer)</label><textarea class="input" id="e-notes" name="notes" rows="3">' + esc(o.notes || '') + '</textarea></div>' +
          '<div class="row"><button class="btn primary" type="submit">Opslaan</button><button class="btn ghost" type="button" data-act="org-edit-cancel">Annuleren</button></div></form>';
      } else {
        x += '<dl class="dl"><div><dt>Contactpersoon</dt><dd>' + esc(o.contactName || '–') + '</dd></div>' +
          '<div><dt>E-mail</dt><dd>' + (o.contactEmail ? '<a href="mailto:' + esc(o.contactEmail) + '">' + esc(o.contactEmail) + '</a>' : '–') + '</dd></div>' +
          '<div><dt>Telefoon</dt><dd>' + esc(o.contactPhone || '–') + '</dd></div><div><dt>Aangemaakt</dt><dd>' + fmt(o.createdAt) + (o.createdVia ? ' · ' + esc(o.createdVia) : '') + '</dd></div>' +
          (o.notes ? '<div class="full"><dt>Notities</dt><dd>' + esc(o.notes) + '</dd></div>' : '') +
          (o.blocked && o.blockedReason ? '<div class="full"><dt>Reden blokkade</dt><dd>' + esc(o.blockedReason) + '</dd></div>' : '') + '</dl>';
        if (A.blockFor === o.id) {
          x += '<form class="box" data-form="block" data-id="' + o.id + '"><p style="margin:0">Niemand van <strong>' + esc(o.name) + '</strong> kan nog inloggen of klokken tot je het bedrijf weer vrijgeeft. Er wordt niets verwijderd.</p>' +
            '<div class="field"><label for="b-r">Reden</label><input class="input" id="b-r" name="reason" placeholder="Bijv. niet betaald, op verzoek"></div>' +
            '<div class="row"><button class="btn danger" type="submit">Blokkeren</button><button class="btn ghost" type="button" data-act="block-cancel">Annuleren</button></div></form>';
        } else if (A.codeFor === o.id) {
          x += '<div class="box"><p style="margin:0">De eigenaar (<strong>' + esc(o.owner || '–') + '</strong>) krijgt een nieuwe code. De oude code werkt dan niet meer.</p>' +
            '<div class="row"><button class="btn dark" data-act="owner-code-go" data-id="' + o.id + '"' + (A.busy ? ' disabled' : '') + '>Nieuwe code maken</button><button class="btn ghost" data-act="owner-code-cancel">Annuleren</button></div></div>';
        } else {
          x += '<div class="row"><button class="btn" data-act="org-edit" data-id="' + o.id + '">Gegevens wijzigen</button>' +
            '<button class="btn" data-act="owner-code" data-id="' + o.id + '">Nieuwe code eigenaar</button>' +
            (o.blocked ? '<button class="btn green" data-act="unblock" data-id="' + o.id + '">Vrijgeven</button>' : '<button class="btn danger" data-act="block" data-id="' + o.id + '">Blokkeren</button>') + '</div>';
        }
      }
    }
    return x + '</article>';
  }).join('') + '</div>';
}

function viewAdmins() {
  let h = '<section class="card"><div class="item-top"><h2 style="margin:0">Beheerders</h2>' + (A.addAdmin ? '' : '<button class="btn small" data-act="add-admin">+ Beheerder toevoegen</button>') + '</div>' +
    '<p class="small muted">Beheerders kunnen alle bedrijven zien, aanmaken en blokkeren. Ze zien nooit de gegevens binnen een bedrijf.</p>' +
    '<div class="adm-list">' + A.data.admins.map(a => '<div class="result"><strong>' + esc(a.name) + (a.name === A.data.me.name ? ' <span class="badge">jij</span>' : '') + '</strong><span class="small muted">sinds ' + fmt(a.createdAt) + '</span></div>').join('') + '</div>';
  if (A.addAdmin) {
    h += '<form class="box" data-form="admin-add" novalidate style="margin-top:14px">' +
      '<div class="fields2"><div class="field"><label for="n-name">Naam</label><input class="input" id="n-name" name="name" autocomplete="off" required></div>' +
      '<div class="field"><label for="n-pw">Wachtwoord (minstens 10 tekens)</label><input class="input" id="n-pw" name="password" type="password" autocomplete="new-password" minlength="10" required></div></div>' +
      '<div class="row"><button class="btn primary" type="submit">Toevoegen</button><button class="btn ghost" type="button" data-act="add-admin-cancel">Annuleren</button></div></form>';
  }
  return h + '</section>';
}
function viewLog() {
  if (!A.data.log.length) return '<div class="empty">Nog niets gebeurd.</div>';
  return '<section class="card"><h2>Laatste 50 acties</h2><div class="adm-list">' + A.data.log.map(l =>
    '<div class="adm-log"><span class="small muted">' + fmt(l.at, true) + '</span><strong>' + esc(l.admin || 'systeem') + '</strong><span>' + esc(l.text) + '</span></div>').join('') + '</div></section>';
}

// ---------- tekenen ----------
function render() {
  if (!A.ready) { $app.innerHTML = ''; return; }
  document.title = 'Crewdeck Beheer';
  if (!A.data) { $app.innerHTML = A.screen === 'setup' ? viewSetup() : viewLogin(); return; }
  const y = window.scrollY;
  $app.innerHTML = viewPanel();
  window.scrollTo(0, y);
}
async function refresh() { try { await load(); } catch (e) { toast(e.message, true); } render(); }

// ---------- klikken ----------
$app.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  if (b.tagName === 'A' && b.getAttribute('href') === '#') e.preventDefault();
  const req = () => A.data.requests.find(r => String(r.id) === String(id));
  try {
    switch (act) {
      case 'to-setup': A.screen = 'setup'; A.err = null; render(); break;
      case 'to-login': A.screen = 'login'; A.err = null; render(); break;
      case 'logout': await logout(); break;
      case 'tab': A.tab = id; A.orgSel = null; A.editOrg = null; A.blockFor = null; A.codeFor = null; render(); break;
      case 'req-filter': A.reqFilter = id; render(); break;
      case 'new-org':
        A.create = { requestId: null, orgName: '', slug: '', ownerName: '', contactName: '', contactEmail: '', contactPhone: '' }; A.created = null; render();
        window.scrollTo(0, 0); document.getElementById('c-org').focus(); break;
      case 'req-create': {
        const r = req();
        A.create = { requestId: r.id, orgName: r.company, slug: slugify(r.company), ownerName: r.contactName, contactName: r.contactName, contactEmail: r.email, contactPhone: r.phone || '' };
        A.created = null; render(); window.scrollTo(0, 0); document.getElementById('c-slug').focus(); break;
      }
      case 'create-cancel': A.create = null; render(); break;
      case 'created-close': A.created = null; render(); break;
      case 'copy-msg': {
        const t = document.getElementById('msg');
        try { await navigator.clipboard.writeText(t.value); } catch (err) { t.select(); document.execCommand('copy'); }
        toast('Bericht gekopieerd.'); break;
      }
      case 'reject': A.rejectFor = Number(id); render(); document.getElementById('rj-' + id).focus(); break;
      case 'reject-cancel': A.rejectFor = null; render(); break;
      case 'req-delete': await rpc('cd_admin_request_delete', { p_id: Number(id) }); await refresh(); toast('Aanvraag verwijderd.'); break;
      case 'org-open': A.orgSel = A.orgSel === id ? null : id; A.editOrg = null; A.blockFor = null; A.codeFor = null; render(); break;
      case 'org-edit': A.editOrg = id; render(); break;
      case 'org-edit-cancel': A.editOrg = null; render(); break;
      case 'block': A.blockFor = id; render(); document.getElementById('b-r').focus(); break;
      case 'block-cancel': A.blockFor = null; render(); break;
      case 'unblock': await rpc('cd_admin_org_block', { p_id: id, p_blocked: false }); await refresh(); toast('Bedrijf vrijgegeven. Iedereen kan weer inloggen.'); break;
      case 'owner-code': A.codeFor = id; render(); break;
      case 'owner-code-cancel': A.codeFor = null; render(); break;
      case 'owner-code-go': {
        A.busy = true; render();
        try {
          const o = A.data.orgs.find(x => x.id === id);
          const r = await svc('admin-owner-code', { orgId: id });
          A.created = { isNewCode: true, orgName: r.orgName, slug: r.slug, ownerName: r.ownerName, code: r.code, contactName: o && o.contactName, contactEmail: o && o.contactEmail };
          A.codeFor = null; A.create = null;
        } finally { A.busy = false; }
        await refresh(); window.scrollTo(0, 0); break;
      }
      case 'add-admin': A.addAdmin = true; render(); document.getElementById('n-name').focus(); break;
      case 'add-admin-cancel': A.addAdmin = false; render(); break;
    }
  } catch (err) { toast(err.message, true); render(); }
});
$app.addEventListener('input', e => {
  if (e.target.dataset.inp === 'q') {
    A.q = e.target.value; const pos = e.target.selectionStart; render();
    const el = document.getElementById('o-q'); el.focus(); try { el.setSelectionRange(pos, pos); } catch (err) { /* */ }
  }
  if (e.target.id === 'c-org' && A.create && !A.create.slugTouched) {
    const s = document.getElementById('c-slug'); if (s) s.value = slugify(e.target.value);
  }
  if (e.target.id === 'c-slug' && A.create) A.create.slugTouched = true;
});

// ---------- formulieren ----------
$app.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const v = k => (f.elements[k] ? f.elements[k].value.trim() : '');
  const kind = f.dataset.form, id = f.dataset.id;
  const btn = f.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
  try {
    if (kind === 'login' || kind === 'setup') {
      const d = kind === 'login'
        ? await svc('admin-login', { name: v('name'), password: f.elements.password.value })
        : await svc('admin-setup', { setupCode: v('setupCode'), name: v('name'), password: f.elements.password.value });
      if (!d.session) throw new Error('Inloggen mislukt. Probeer het opnieuw.');
      await sb.auth.setSession(d.session);
      A.err = null; await load(); render();
      if (kind === 'setup') toast('Welkom! Je beheerdersaccount staat klaar.');
      return;
    }
    if (kind === 'create') {
      const p = { requestId: A.create.requestId, orgName: v('orgName'), slug: v('slug').toLowerCase(), ownerName: v('ownerName'), contactName: v('contactName'), contactEmail: v('contactEmail'), contactPhone: v('contactPhone') };
      Object.assign(A.create, p, { err: null }); A.busy = true; render();
      try {
        const r = await svc('admin-create-org', p);
        A.created = Object.assign({ isNewCode: false, contactName: p.contactName, contactEmail: p.contactEmail }, r);
        A.create = null; A.tab = 'bedrijven'; A.orgSel = r.orgId;
      } catch (err) { A.create.err = err.message; }
      A.busy = false; await refresh(); window.scrollTo(0, 0); return;
    }
    if (kind === 'reject') {
      await rpc('cd_admin_request_reject', { p_id: Number(id), p_reason: v('reason') });
      A.rejectFor = null; await refresh(); toast('Aanvraag afgewezen.'); return;
    }
    if (kind === 'block') {
      await rpc('cd_admin_org_block', { p_id: id, p_blocked: true, p_reason: v('reason') });
      A.blockFor = null; await refresh(); toast('Bedrijf geblokkeerd.'); return;
    }
    if (kind === 'org-edit') {
      await rpc('cd_admin_org_update', { p_id: id, p: { name: v('name'), contactName: v('contactName'), contactEmail: v('contactEmail'), contactPhone: v('contactPhone'), notes: v('notes') } });
      A.editOrg = null; await refresh(); toast('Opgeslagen.'); return;
    }
    if (kind === 'admin-add') {
      await svc('admin-add', { name: v('name'), password: f.elements.password.value });
      A.addAdmin = false; await refresh(); toast('Beheerder toegevoegd.'); return;
    }
  } catch (err) {
    if (kind === 'login' || kind === 'setup') {
      A.err = err.message;
      const keep = {}; [...f.elements].forEach(el => { if (el.id && el.type !== 'password') keep[el.id] = el.value; });
      render(); Object.keys(keep).forEach(k => { const el = document.getElementById(k); if (el) el.value = keep[k]; });
      const pw = document.querySelector('input[type=password]'); if (pw) pw.focus();
    } else { toast(err.message, true); if (btn) btn.disabled = false; }
  }
});

// ---------- start ----------
(async function start() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) { try { await load(); } catch (e) { A.data = null; } }
  } catch (e) { /* */ }
  A.ready = true; render();
  setInterval(() => { if (A.data && !document.hidden && !A.create && !A.editOrg && !A.blockFor && !A.rejectFor && !A.addAdmin && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) refresh(); }, 60000);
})();
