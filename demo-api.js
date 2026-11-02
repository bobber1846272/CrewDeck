/* DEMO-versie van het Terugbelsysteem
 * Doet alsof er een server is: alle /api/-verzoeken worden in de browser afgehandeld door
 * dezelfde kern (core.js) als de echte versie, en opgeslagen in localStorage.
 * Alleen nepgegevens. Niet gebruiken voor echte klanten.
 */
'use strict';
(function () {
  const KEY = 'tbs-demo-db-v2';
  const SKEY = 'tbs-demo-session';
  const RD = TBSCore.ROLE_DEFAULTS;

  // ---------- nepgegevens ----------
  function local(minFromNow) {
    const d = new Date(Date.now() + minFromNow * 60000);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  const ago = min => new Date(Date.now() - min * 60000).toISOString();
  const DAY = 1440;

  function seed() {
    const users = [
      { id: 1, name: 'Admin', code: '1234', role: 'beheerder', isAdmin: true, active: true, rights: Object.assign({}, RD.beheerder) },
      { id: 2, name: 'Lisa', code: '1111', role: 'teamleider', active: true, rights: Object.assign({}, RD.teamleider) },
      { id: 3, name: 'Kevin', code: '2222', role: 'medewerker', active: true, rights: Object.assign({}, RD.medewerker) },
      { id: 4, name: 'Mark', code: '3333', role: 'medewerker', active: true, rights: Object.assign({}, RD.medewerker) },
      { id: 5, name: 'Sanne', code: '4444', role: 'beheerder', active: true, rights: Object.assign({}, RD.beheerder) },
      { id: 6, name: 'Daan', code: '5555', role: 'medewerker', active: false, rights: Object.assign({}, RD.medewerker) }
    ];
    const cb = o => Object.assign({ type: 'zakelijk', name: '', company: '', contact: '', email: '', category: 'Overig', priority: 'normaal', note: '', status: 'open', attempts: [] }, o);
    const callbacks = [
      cb({ id: 101, company: 'Beeldwerk Media BV', contact: 'Fleur de Vries', phone: '06 12 34 56 78', order: '482913', category: 'Offerte / zakelijk', priority: 'hoog', dueAt: local(-25), note: 'Wil een offerte voor een beamer + motorscherm in de vergaderzaal. Liefst vóór de lunch.', assignee: 3, createdBy: 2, createdAt: ago(180), attempts: [{ at: ago(60), by: 3, text: 'Niet bereikt · Voicemail ingesproken' }] }),
      cb({ id: 102, type: 'particulier', name: 'Peter Jansen', phone: '06 98 76 54 32', order: '483120', category: 'Bestelling', dueAt: local(35), note: 'Vraagt wanneer zijn beamer geleverd wordt.', assignee: 3, createdBy: 3, createdAt: ago(90) }),
      cb({ id: 103, company: 'Basisschool De Regenboog', contact: 'Meester Bos', phone: '030 123 45 67', order: '479001', category: 'Technisch', dueAt: local(50), note: 'Projector in lokaal 4 geeft geen beeld meer.', assignee: 3, createdBy: 2, createdAt: ago(45) }),
      cb({ id: 104, type: 'particulier', name: 'Yasmin El Amrani', phone: '06 11 22 33 44', email: 'yasmin@voorbeeld.nl', order: '483377', category: 'Retour', dueAt: local(240), note: 'Wil scherm retourneren, verkeerde maat.', assignee: 2, createdBy: 4, createdAt: ago(30) }),
      cb({ id: 105, company: 'Kantoorpand Utrecht CS', contact: 'Ilse Meijer', phone: '030 765 43 21', order: '480555', category: 'Klacht', priority: 'hoog', dueAt: local(-90), note: 'Montage was later dan afgesproken, wil teruggebeld worden door teamleider.', assignee: 2, createdBy: 3, createdAt: ago(300), attempts: [{ at: ago(200), by: 2, text: 'Niet bereikt' }, { at: ago(120), by: 2, text: 'Niet bereikt · In gesprek' }, { at: ago(100), by: 2, text: 'Niet bereikt' }] }),
      cb({ id: 106, type: 'particulier', name: 'Henk de Groot', phone: '06 55 66 77 88', order: '483401', category: 'Bestelling', dueAt: local(15), note: 'Wil bezorgadres wijzigen.', assignee: null, createdBy: 4, createdAt: ago(20) }),
      cb({ id: 107, company: 'Sportcafé De Kantine', contact: 'Rob', phone: '0348 12 34 56', order: '481777', category: 'Offerte / zakelijk', dueAt: local(DAY + 120), note: 'Wil groot scherm voor voetbalavonden.', assignee: null, createdBy: 2, createdAt: ago(10) }),
      cb({ id: 108, type: 'particulier', name: 'Emma Visser', phone: '06 44 33 22 11', order: '482002', category: 'Technisch', dueAt: local(-30), note: 'Afstandsbediening werkt niet.', assignee: 4, createdBy: 3, createdAt: ago(120) }),
      cb({ id: 109, company: 'Hotel Aan de Vaart', contact: 'Mevr. Kok', phone: '030 222 33 44', order: '478800', category: 'Offerte / zakelijk', dueAt: local(-300), assignee: 3, createdBy: 3, createdAt: ago(600), status: 'done', doneAt: ago(240), doneBy: 3, attempts: [{ at: ago(240), by: 3, text: 'Afgerond: Mail gestuurd met offerte' }] }),
      cb({ id: 110, type: 'particulier', name: 'Tom Bakker', phone: '06 77 88 99 00', order: '482500', category: 'Retour', dueAt: local(-200), assignee: 4, createdBy: 2, createdAt: ago(400), status: 'done', doneAt: ago(150), doneBy: 4 })
    ];
    // wat geschiedenis voor de cijfers (afgeronde verzoeken van de afgelopen weken)
    const names = ['Jan de Boer', 'Sophie Mulder', 'Bram Smit', 'Lotte Hendriks', 'Ahmed Yilmaz', 'Noah de Wit', 'Eva Dekker', 'Ruben Vos', 'Mila Peters', 'Daan Kuipers', 'Zoë Brouwer', 'Sem Willems'];
    const bizz = ['Fitness Centrum Fit', 'Gemeente IJsselstein', 'Kerkgemeenschap Noord', 'Escape Room Utrecht', 'Bouwbedrijf Rijnstaal', 'Tandartspraktijk Smile'];
    const cats = ['Bestelling', 'Bestelling', 'Retour', 'Technisch', 'Offerte / zakelijk', 'Klacht', 'Bestelling', 'Technisch'];
    let n = 200;
    for (let d = 1; d <= 34; d++) {
      const perDay = (d % 7 === 0 || d % 7 === 6) ? 1 : 2 + (d % 3);
      for (let i = 0; i < perDay; i++) {
        n++;
        const biz = (n % 4 === 0);
        const created = d * DAY + 60 * (9 + i * 2);
        const took = 30 + ((n * 37) % 300);
        const due = created - 120;
        const by = [2, 3, 4, 3, 4][n % 5];
        callbacks.push(cb({
          id: n, type: biz ? 'zakelijk' : 'particulier', company: biz ? bizz[n % bizz.length] : '', name: biz ? '' : names[n % names.length],
          contact: biz ? names[(n + 3) % names.length] : '', phone: '06 ' + String(10000000 + n * 7919).slice(0, 8), order: String(470000 + n * 13),
          category: cats[n % cats.length], dueAt: local(-due), assignee: by, createdBy: [2, 3, 4][n % 3], createdAt: ago(created),
          status: 'done', doneAt: ago(created - took), doneBy: by,
          attempts: n % 3 === 0 ? [{ at: ago(created - took / 2), by, text: 'Niet bereikt · Voicemail ingesproken' }] : []
        }));
      }
    }
    const tk = o => Object.assign({ desc: '', priority: 'normaal', mode: 'een', repeat: 'none', doneBy: {}, archivedBy: {} }, o);
    const tasks = [
      tk({ id: 301, title: 'Showroom opruimen voor sluiting', desc: 'Demo-beamers uit, kabels oprollen, schermen omhoog.', dueAt: local(200), assignees: [3, 4, 2], mode: 'een', repeat: 'werkdag', createdBy: 2, createdAt: ago(60) }),
      tk({ id: 302, title: 'Nieuwe prijslijst doorlezen', desc: 'Iedereen moet dit gelezen hebben voor vrijdag.', dueAt: local(3 * DAY), assignees: [2, 3, 4, 5], mode: 'iedereen', doneBy: { 2: ago(30), 5: ago(20) }, createdBy: 2, createdAt: ago(1000) }),
      tk({ id: 303, title: 'Retour verwerken', desc: 'Ordernummer 482913 · controleren en terugboeken.', dueAt: local(120), assignees: [3], createdBy: 2, createdAt: ago(100) }),
      tk({ id: 304, title: 'Offerte Beeldwerk Media opstellen', desc: 'Samen met Lisa, zij levert de prijzen aan.', dueAt: local(DAY), priority: 'hoog', assignees: [3, 2], mode: 'iedereen', createdBy: 2, createdAt: ago(80) }),
      tk({ id: 305, title: 'Kassa tellen', dueAt: local(-60), assignees: [3], doneBy: { 3: ago(50) }, createdBy: 2, createdAt: ago(500) }),
      tk({ id: 306, title: 'Etalage omzetten naar winteractie', dueAt: local(-DAY), assignees: [3, 4], doneBy: { 4: ago(1400) }, archivedBy: { 3: true }, createdBy: 2, createdAt: ago(3000) }),
      tk({ id: 307, title: 'Voorraad HDMI-kabels tellen', desc: 'Ook de 10 meter kabels in het magazijn.', dueAt: local(2 * DAY), assignees: [4], repeat: 'week', createdBy: 2, createdAt: ago(200) }),
      tk({ id: 308, title: 'Facturen oktober controleren', dueAt: local(-600), priority: 'hoog', assignees: [2], createdBy: 5, createdAt: ago(2000) }),
      tk({ id: 309, title: 'Demo-beamer klaarzetten in showroom', desc: 'Voor klantbezoek Basisschool De Regenboog.', dueAt: local(DAY + 60), assignees: [4], createdBy: 3, createdAt: ago(40) }),
      tk({ id: 310, title: 'Prijslijst Optoma bijwerken in webshop', dueAt: local(-DAY), assignees: [5], doneBy: { 5: ago(1300) }, createdBy: 2, createdAt: ago(3000) })
    ];
    const L = (min, by, action, text) => ({ id: 0, at: ago(min), by, action, text, ref: null });
    const log = [
      L(3000, 1, 'systeem', 'Demo gestart met nepgegevens'),
      L(300, 3, 'verzoek-nieuw', 'Verzoek aangemaakt: Kantoorpand Utrecht CS (order 480555) → Lisa'),
      L(240, 3, 'verzoek-afgerond', 'Teruggebeld en afgerond: Hotel Aan de Vaart · Mail gestuurd met offerte'),
      L(200, 2, 'verzoek-poging', 'Belpoging bij Kantoorpand Utrecht CS: Niet bereikt'),
      L(180, 2, 'verzoek-nieuw', 'Verzoek aangemaakt: Beeldwerk Media BV (order 482913) → Kevin'),
      L(150, 4, 'verzoek-afgerond', 'Teruggebeld en afgerond: Tom Bakker'),
      L(120, 2, 'verzoek-poging', 'Belpoging bij Kantoorpand Utrecht CS: Niet bereikt · In gesprek'),
      L(100, 2, 'verzoek-poging', 'Belpoging bij Kantoorpand Utrecht CS: Niet bereikt'),
      L(90, 3, 'verzoek-nieuw', 'Verzoek aangemaakt: Peter Jansen (order 483120) → Kevin'),
      L(80, 2, 'taak-nieuw', 'Taak aangemaakt: Offerte Beeldwerk Media opstellen → Kevin, Lisa'),
      L(60, 3, 'verzoek-poging', 'Belpoging bij Beeldwerk Media BV: Niet bereikt · Voicemail ingesproken'),
      L(60, 2, 'taak-nieuw', 'Taak aangemaakt: Showroom opruimen voor sluiting → Kevin, Mark, Lisa (elke werkdag)'),
      L(50, 3, 'taak-afgevinkt', 'Afgevinkt: Kassa tellen'),
      L(45, 2, 'verzoek-nieuw', 'Verzoek aangemaakt: Basisschool De Regenboog (order 479001) → Kevin'),
      L(30, 4, 'verzoek-nieuw', 'Verzoek aangemaakt: Yasmin El Amrani (order 483377) → Lisa'),
      L(20, 4, 'verzoek-nieuw', 'Verzoek aangemaakt: Henk de Groot (order 483401) → open pool'),
      L(10, 2, 'verzoek-nieuw', 'Verzoek aangemaakt: Sportcafé De Kantine (order 481777) → open pool')
    ];
    log.forEach((l, i) => { l.id = 9000 + i; });
    return { version: 2, nextId: 10000, users, callbacks, tasks, log };
  }

  // ---------- opslag & kern ----------
  let db, core;
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* vol of geblokkeerd */ } }
  function load() {
    let fresh = null;
    try { fresh = JSON.parse(localStorage.getItem(KEY)); } catch (e) { fresh = null; }
    if (!fresh || !fresh.users) { fresh = seed(); }
    db = fresh;
    core = TBSCore.createApi({
      db, save,
      setCode: (u, code) => { u.code = code; },
      makeCode: () => String(100000 + Math.floor(Math.random() * 900000)),
      revokeSessions: () => {}
    });
    save();
  }
  const sessionUserId = () => { try { return Number(sessionStorage.getItem(SKEY)) || null; } catch (e) { return null; } };
  const setSession = id => { try { if (id) sessionStorage.setItem(SKEY, String(id)); else sessionStorage.removeItem(SKEY); } catch (e) { /* */ } };
  const failures = {};

  function handle(method, url, body) {
    const p = url.pathname;
    if (p === '/api/login' && method === 'POST') {
      const key = String(body.name || '').trim().toLowerCase();
      const f = failures[key];
      if (f && f.until > Date.now()) return { status: 429, data: { error: 'Te vaak een verkeerde code. Probeer het over ' + Math.ceil((f.until - Date.now()) / 60000) + ' minuut/minuten opnieuw.' } };
      const u = db.users.find(x => x.name.toLowerCase() === key);
      if (!u || !u.active || String(body.code || '').trim() !== u.code) {
        const cur = failures[key] || { count: 0, until: 0 };
        cur.count++; if (cur.count >= 5) { cur.until = Date.now() + 5 * 60000; cur.count = 0; }
        failures[key] = cur;
        return { status: 401, data: { error: 'Naam of code klopt niet.' } };
      }
      delete failures[key];
      setSession(u.id);
      return { status: 200, data: { user: core.publicUser(u) } };
    }
    const me = db.users.find(u => u.id === sessionUserId());
    if (!me || !me.active) { setSession(null); return { status: 401, data: { error: 'Niet ingelogd' } }; }
    if (p === '/api/logout') { setSession(null); return { status: 200, data: { ok: true } }; }
    return core.handle(me, method, p, url.searchParams, body);
  }

  load();
  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, opt) {
    const raw = typeof input === 'string' ? input : input.url;
    const url = new URL(raw, location.origin);
    const at = url.pathname.indexOf('/api/');
    if (at === -1) return realFetch(input, opt);
    url.pathname = url.pathname.slice(at);
    const method = (opt && opt.method) || 'GET';
    let body = {};
    try { body = opt && opt.body ? JSON.parse(opt.body) : {}; } catch (e) { body = {}; }
    load(); // andere tabbladen kunnen iets veranderd hebben
    const r = handle(method, url, body);
    return new Promise(res => setTimeout(() => res(new Response(JSON.stringify(r.data), { status: r.status, headers: { 'Content-Type': 'application/json' } })), 60));
  };

  // ---------- demobalk ----------
  function bar() {
    const el = document.createElement('div');
    el.className = 'demo-bar';
    el.innerHTML =
      '<span><strong>DEMO</strong> · alleen nepgegevens, wordt bewaard in deze browser.</span>' +
      '<span class="demo-accounts">Log in als: ' +
      db.users.filter(u => u.active).map(u => '<button type="button" data-demo-login="' + u.name + '" data-code="' + u.code + '">' + u.name +
        ' <small>' + (u.isAdmin ? 'admin' : u.role) + ' · ' + u.code + '</small></button>').join('') + '</span>' +
      '<button type="button" class="demo-reset">Demo resetten</button>';
    document.body.prepend(el);
    el.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.classList.contains('demo-reset')) {
        if (!confirm('Alle demogegevens terugzetten naar het begin?')) return;
        localStorage.removeItem(KEY); setSession(null); location.hash = ''; location.reload();
        return;
      }
      if (b.dataset.demoLogin) {
        setSession(null);
        await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: b.dataset.demoLogin, code: b.dataset.code }) });
        location.hash = '#/terugbellen';
        location.reload();
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bar); else bar();
})();
