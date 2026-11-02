/* DEMO-versie van het Terugbelsysteem
 * Doet alsof er een server is: alle /api/-verzoeken worden hier in de browser afgehandeld
 * en opgeslagen in localStorage. Alleen nepgegevens. Niet gebruiken voor echte klanten.
 */
'use strict';
(function () {
  const KEY = 'tbs-demo-db-v1';
  const SKEY = 'tbs-demo-session';
  const RIGHTS = ['create', 'assign', 'viewAll', 'manageUsers'];
  const ROLE_DEFAULTS = {
    medewerker: { create: true, assign: true, viewAll: false, manageUsers: false },
    teamleider: { create: true, assign: true, viewAll: true, manageUsers: false },
    beheerder: { create: true, assign: true, viewAll: true, manageUsers: true }
  };

  // ---------- nepgegevens ----------
  function local(minFromNow) {
    const d = new Date(Date.now() + minFromNow * 60000);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function ago(min) { return new Date(Date.now() - min * 60000).toISOString(); }

  function seed() {
    const users = [
      { id: 1, name: 'Admin', code: '1234', role: 'beheerder', isAdmin: true, active: true, rights: Object.assign({}, ROLE_DEFAULTS.beheerder) },
      { id: 2, name: 'Lisa', code: '1111', role: 'teamleider', active: true, rights: Object.assign({}, ROLE_DEFAULTS.teamleider) },
      { id: 3, name: 'Kevin', code: '2222', role: 'medewerker', active: true, rights: Object.assign({}, ROLE_DEFAULTS.medewerker) },
      { id: 4, name: 'Mark', code: '3333', role: 'medewerker', active: true, rights: Object.assign({}, ROLE_DEFAULTS.medewerker) },
      { id: 5, name: 'Sanne', code: '4444', role: 'beheerder', active: true, rights: Object.assign({}, ROLE_DEFAULTS.beheerder) },
      { id: 6, name: 'Daan', code: '5555', role: 'medewerker', active: false, rights: Object.assign({}, ROLE_DEFAULTS.medewerker) }
    ];
    const cb = (o) => Object.assign({ type: 'zakelijk', name: '', company: '', contact: '', email: '', category: 'Overig', priority: 'normaal', note: '', status: 'open', attempts: [] }, o);
    const callbacks = [
      cb({ id: 101, company: 'Beeldwerk Media BV', contact: 'Fleur de Vries', phone: '06 12 34 56 78', order: '482913', category: 'Offerte / zakelijk', priority: 'hoog', dueAt: local(-25), note: 'Wil een offerte voor een beamer + motorscherm in de vergaderzaal. Liefst vóór de lunch.', assignee: 3, createdBy: 2, createdAt: ago(180), attempts: [{ at: ago(60), by: 3, text: 'Niet bereikt · voicemail ingesproken' }] }),
      cb({ id: 102, type: 'particulier', name: 'Peter Jansen', phone: '06 98 76 54 32', order: '483120', category: 'Bestelling', dueAt: local(35), note: 'Vraagt wanneer zijn beamer geleverd wordt.', assignee: 3, createdBy: 3, createdAt: ago(90) }),
      cb({ id: 103, company: 'Basisschool De Regenboog', contact: 'Meester Bos', phone: '030 123 45 67', order: '479001', category: 'Technisch', dueAt: local(50), note: 'Projector in lokaal 4 geeft geen beeld meer.', assignee: 3, createdBy: 2, createdAt: ago(45) }),
      cb({ id: 104, type: 'particulier', name: 'Yasmin El Amrani', phone: '06 11 22 33 44', email: 'yasmin@voorbeeld.nl', order: '483377', category: 'Retour', dueAt: local(240), note: 'Wil scherm retourneren, verkeerde maat.', assignee: 2, createdBy: 4, createdAt: ago(30) }),
      cb({ id: 105, company: 'Kantoorpand Utrecht CS', contact: 'Ilse Meijer', phone: '030 765 43 21', order: '480555', category: 'Klacht', priority: 'hoog', dueAt: local(-90), note: 'Montage was later dan afgesproken, wil teruggebeld worden door teamleider.', assignee: 2, createdBy: 3, createdAt: ago(300), attempts: [{ at: ago(200), by: 2, text: 'Niet bereikt' }, { at: ago(120), by: 2, text: 'Niet bereikt · in gesprek' }, { at: ago(100), by: 2, text: 'Niet bereikt' }] }),
      cb({ id: 106, type: 'particulier', name: 'Henk de Groot', phone: '06 55 66 77 88', order: '483401', category: 'Bestelling', dueAt: local(15), note: 'Wil bezorgadres wijzigen.', assignee: null, createdBy: 4, createdAt: ago(20) }),
      cb({ id: 107, company: 'Sportcafé De Kantine', contact: 'Rob', phone: '0348 12 34 56', order: '481777', category: 'Offerte / zakelijk', dueAt: local(1440 + 120), note: 'Wil groot scherm voor voetbalavonden.', assignee: null, createdBy: 2, createdAt: ago(10) }),
      cb({ id: 108, type: 'particulier', name: 'Emma Visser', phone: '06 44 33 22 11', order: '482002', category: 'Technisch', dueAt: local(-30), note: 'Afstandsbediening werkt niet.', assignee: 4, createdBy: 3, createdAt: ago(120) }),
      cb({ id: 109, company: 'Hotel Aan de Vaart', contact: 'Mevr. Kok', phone: '030 222 33 44', order: '478800', category: 'Offerte / zakelijk', dueAt: local(-300), assignee: 3, createdBy: 3, createdAt: ago(600), status: 'done', doneAt: ago(240), doneBy: 3, attempts: [{ at: ago(240), by: 3, text: 'Afgerond: offerte gemaild' }] }),
      cb({ id: 110, type: 'particulier', name: 'Tom Bakker', phone: '06 77 88 99 00', order: '482500', category: 'Retour', dueAt: local(-200), assignee: 4, createdBy: 2, createdAt: ago(400), status: 'done', doneAt: ago(150), doneBy: 4 })
    ];
    const tk = (o) => Object.assign({ desc: '', priority: 'normaal', mode: 'een', doneBy: {}, archivedBy: {} }, o);
    const tasks = [
      tk({ id: 201, title: 'Showroom opruimen voor sluiting', desc: 'Demo-beamers uit, kabels oprollen, schermen omhoog.', dueAt: local(200), assignees: [3, 4, 2], mode: 'een', createdBy: 2, createdAt: ago(60) }),
      tk({ id: 202, title: 'Nieuwe prijslijst doorlezen', desc: 'Iedereen moet dit gelezen hebben voor vrijdag.', dueAt: local(3 * 1440), assignees: [2, 3, 4, 5], mode: 'iedereen', doneBy: { 2: ago(30), 5: ago(20) }, createdBy: 2, createdAt: ago(1000) }),
      tk({ id: 203, title: 'Retour verwerken', desc: 'Ordernummer 482913 · controleren en terugboeken.', dueAt: local(120), assignees: [3], createdBy: 2, createdAt: ago(100) }),
      tk({ id: 204, title: 'Offerte Beeldwerk Media opstellen', desc: 'Samen met Lisa, zij levert de prijzen aan.', dueAt: local(1440), priority: 'hoog', assignees: [3, 2], mode: 'iedereen', createdBy: 2, createdAt: ago(80) }),
      tk({ id: 205, title: 'Kassa tellen', dueAt: local(-60), assignees: [3], doneBy: { 3: ago(50) }, createdBy: 2, createdAt: ago(500) }),
      tk({ id: 206, title: 'Etalage omzetten naar winteractie', dueAt: local(-1440), assignees: [3, 4], doneBy: { 4: ago(1400) }, archivedBy: { 3: true }, createdBy: 2, createdAt: ago(3000) }),
      tk({ id: 207, title: 'Voorraad HDMI-kabels tellen', desc: 'Ook de 10 meter kabels in het magazijn.', dueAt: local(2 * 1440), assignees: [4], createdBy: 2, createdAt: ago(200) }),
      tk({ id: 208, title: 'Facturen oktober controleren', dueAt: local(-600), priority: 'hoog', assignees: [2], createdBy: 5, createdAt: ago(2000) }),
      tk({ id: 209, title: 'Demo-beamer klaarzetten in showroom', desc: 'Voor klantbezoek Basisschool De Regenboog.', dueAt: local(1440 + 60), assignees: [4], createdBy: 3, createdAt: ago(40) }),
      tk({ id: 210, title: 'Prijslijst Optoma bijwerken in webshop', dueAt: local(-1440), assignees: [5], doneBy: { 5: ago(1300) }, createdBy: 2, createdAt: ago(3000) })
    ];
    return { nextId: 1000, users, callbacks, tasks };
  }

  let db;
  function load() {
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
    if (!db || !db.users) { db = seed(); save(); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* vol of geblokkeerd */ } }
  function newId() { return db.nextId++; }
  function nowIso() { return new Date().toISOString(); }
  function sessionUserId() { try { return Number(sessionStorage.getItem(SKEY)) || null; } catch (e) { return null; } }
  function setSession(id) { try { if (id) sessionStorage.setItem(SKEY, String(id)); else sessionStorage.removeItem(SKEY); } catch (e) { /* */ } }

  // ---------- zelfde logica als de echte server ----------
  const effectiveRights = u => u.isAdmin ? { create: true, assign: true, viewAll: true, manageUsers: true } : RIGHTS.reduce((r, k) => (r[k] = !!(u.rights && u.rights[k]), r), {});
  const publicUser = u => ({ id: u.id, name: u.name, role: u.role, isAdmin: !!u.isAdmin, active: u.active, rights: effectiveRights(u) });
  const userById = id => db.users.find(u => u.id === id);
  const nameOf = id => { const u = userById(id); return u ? u.name : 'Onbekend'; };
  const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 300);
  function taskIsDone(t) {
    const ids = Object.keys(t.doneBy || {}).map(Number);
    return t.mode === 'iedereen' ? t.assignees.every(a => ids.includes(a)) : ids.length > 0;
  }
  function openLoad(uid) {
    return db.callbacks.filter(c => c.status === 'open' && c.assignee === uid).length +
      db.tasks.filter(t => t.assignees.includes(uid) && !(t.doneBy || {})[uid] && !taskIsDone(t)).length;
  }
  const viewCallback = c => Object.assign({}, c, {
    assigneeName: c.assignee ? nameOf(c.assignee) : null, createdByName: nameOf(c.createdBy), doneByName: c.doneBy ? nameOf(c.doneBy) : null,
    attempts: (c.attempts || []).map(a => Object.assign({}, a, { byName: nameOf(a.by) }))
  });
  function viewTask(t, me) {
    const doneBy = t.doneBy || {};
    return {
      id: t.id, title: t.title, desc: t.desc, dueAt: t.dueAt, priority: t.priority, mode: t.mode, createdAt: t.createdAt,
      createdBy: t.createdBy, createdByName: nameOf(t.createdBy),
      assignees: t.assignees.map(id => ({ id, name: nameOf(id), done: !!doneBy[id] })),
      doneCount: t.assignees.filter(id => doneBy[id]).length, done: taskIsDone(t), mineDone: !!doneBy[me.id],
      isMine: t.assignees.includes(me.id), archived: !!(t.archivedBy || {})[me.id]
    };
  }
  function resolveAssignee(value, me, rights) {
    if (value === 'pool' || value == null || value === '') return { id: null };
    if (value === 'me') return { id: me.id };
    if (value === 'auto') {
      const act = db.users.filter(u => u.active && !u.isAdmin);
      const pool = act.length ? act : db.users.filter(u => u.active);
      pool.sort((a, b) => openLoad(a.id) - openLoad(b.id));
      return { id: pool[0].id };
    }
    const u = userById(Number(value));
    if (!u || !u.active) return { error: 'Deze collega bestaat niet of is gedeactiveerd.' };
    if (u.id !== me.id && !rights.assign) return { error: 'Je hebt geen recht om aan collega’s toe te wijzen.' };
    return { id: u.id };
  }
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function searchTasks(q) {
    const words = norm(q).split(/[^a-z0-9]+/).filter(w => w.length >= 3);
    if (!words.length) return [];
    const out = [];
    for (const t of db.tasks) {
      const hay = norm(t.title + ' ' + (t.desc || '')).split(/[^a-z0-9]+/);
      let hits = 0;
      for (const w of words) {
        const stem = w.length > 5 ? w.slice(0, 5) : w;
        if (hay.some(h => h.startsWith(stem) || h.includes(w) || (w.startsWith(h) && h.length >= 4))) hits++;
      }
      if (hits) out.push({ score: hits / words.length, strong: hits === words.length, id: t.id, title: t.title, desc: t.desc, dueAt: t.dueAt, done: taskIsDone(t), assignees: t.assignees.map(nameOf) });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 15);
  }
  const failures = {};
  function makeCode() { return String(100000 + Math.floor(Math.random() * 900000)); }

  // ---------- router ----------
  function handle(method, url, body) {
    const p = url.pathname;
    const R = (status, data) => ({ status, data });
    const E = (status, msg) => R(status, { error: msg });

    if (p === '/api/login' && method === 'POST') {
      const key = clean(body.name, 60).toLowerCase();
      const f = failures[key];
      if (f && f.until > Date.now()) return E(429, 'Te vaak een verkeerde code. Probeer het over ' + Math.ceil((f.until - Date.now()) / 60000) + ' minuut/minuten opnieuw.');
      const u = db.users.find(x => x.name.toLowerCase() === key);
      if (!u || !u.active || clean(body.code, 20) !== u.code) {
        const cur = failures[key] || { count: 0, until: 0 };
        cur.count++; if (cur.count >= 5) { cur.until = Date.now() + 5 * 60000; cur.count = 0; }
        failures[key] = cur;
        return E(401, 'Naam of code klopt niet.');
      }
      delete failures[key];
      setSession(u.id);
      return R(200, { user: publicUser(u) });
    }
    const me = userById(sessionUserId());
    if (!me || !me.active) { setSession(null); return E(401, 'Niet ingelogd'); }
    const rights = effectiveRights(me);

    if (p === '/api/logout') { setSession(null); return R(200, { ok: true }); }
    if (p === '/api/me') return R(200, { user: publicUser(me) });
    if (p === '/api/colleagues') return R(200, { users: db.users.filter(u => u.active).map(u => ({ id: u.id, name: u.name, open: openLoad(u.id) })) });

    if (p === '/api/callbacks' && method === 'GET') {
      const scope = url.searchParams.get('scope') || 'mine';
      let list;
      if (scope === 'mine') list = db.callbacks.filter(c => c.status === 'open' && c.assignee === me.id);
      else if (scope === 'pool') list = db.callbacks.filter(c => c.status === 'open' && !c.assignee);
      else if (scope === 'done') list = db.callbacks.filter(c => c.status === 'done' && (rights.viewAll || c.assignee === me.id || c.doneBy === me.id || c.createdBy === me.id));
      else if (scope === 'all') { if (!rights.viewAll) return E(403, 'Je hebt geen recht om alle verzoeken te zien.'); list = db.callbacks.filter(c => c.status === 'open'); }
      else return E(400, 'Onbekend overzicht');
      list = list.slice().sort((a, b) => scope === 'done' ? (b.doneAt || '').localeCompare(a.doneAt || '') : (a.dueAt || '9999').localeCompare(b.dueAt || '9999'));
      return R(200, { callbacks: list.map(viewCallback) });
    }
    if (p === '/api/callbacks' && method === 'POST') {
      if (!rights.create) return E(403, 'Je hebt geen recht om verzoeken aan te maken.');
      const type = body.type === 'particulier' ? 'particulier' : 'zakelijk';
      const c = { id: newId(), type, name: clean(body.name, 120), company: clean(body.company, 120), contact: clean(body.contact, 120), phone: clean(body.phone, 40),
        email: clean(body.email, 120), order: clean(body.order, 60), category: clean(body.category, 60) || 'Overig',
        priority: ['hoog', 'normaal', 'laag'].includes(body.priority) ? body.priority : 'normaal', dueAt: clean(body.dueAt, 30), note: clean(body.note, 2000),
        assignee: null, createdBy: me.id, createdAt: nowIso(), status: 'open', attempts: [] };
      const missing = [];
      if (type === 'zakelijk' && !c.company) missing.push('bedrijfsnaam');
      if (type === 'particulier' && !c.name) missing.push('naam');
      if (!c.phone) missing.push('telefoonnummer');
      if (!c.order) missing.push('ordernummer');
      if (missing.length) return E(400, 'Niet alle verplichte velden zijn ingevuld: ' + missing.join(', ') + '.');
      const a = resolveAssignee(body.assignee, me, rights);
      if (a.error) return E(400, a.error);
      c.assignee = a.id;
      db.callbacks.push(c); save();
      return R(200, { callback: viewCallback(c) });
    }
    let m = p.match(/^\/api\/callbacks\/(\d+)\/(attempt|done|reopen|assign|claim)$/);
    if (m) {
      const c = db.callbacks.find(x => x.id === +m[1]);
      if (!c) return E(404, 'Verzoek niet gevonden');
      if (!(c.assignee === me.id || c.createdBy === me.id || !c.assignee || rights.viewAll)) return E(403, 'Dit verzoek is niet van jou.');
      const act = m[2];
      if (act === 'attempt') c.attempts.push({ at: nowIso(), by: me.id, text: clean(body.text, 500) || 'Niet bereikt' });
      else if (act === 'done') { c.status = 'done'; c.doneAt = nowIso(); c.doneBy = me.id; const t = clean(body.text, 500); if (t) c.attempts.push({ at: nowIso(), by: me.id, text: 'Afgerond: ' + t }); }
      else if (act === 'reopen') { c.status = 'open'; delete c.doneAt; delete c.doneBy; }
      else if (act === 'claim') { if (c.assignee) return E(409, 'Dit verzoek is al opgepakt door ' + nameOf(c.assignee) + '.'); c.assignee = me.id; }
      else if (act === 'assign') { const a = resolveAssignee(body.assignee, me, rights); if (a.error) return E(400, a.error); c.assignee = a.id; }
      save();
      return R(200, { callback: viewCallback(c) });
    }

    if (p === '/api/tasks' && method === 'GET') {
      const scope = url.searchParams.get('scope') || 'mine';
      let list;
      if (scope === 'mine') list = db.tasks.filter(t => t.assignees.includes(me.id));
      else if (scope === 'all') { if (!rights.viewAll) return E(403, 'Je hebt geen recht om alle taken te zien.'); list = db.tasks.slice(); }
      else return E(400, 'Onbekend overzicht');
      list.sort((a, b) => (a.dueAt || '9999').localeCompare(b.dueAt || '9999'));
      return R(200, { tasks: list.map(t => viewTask(t, me)) });
    }
    if (p === '/api/tasks/search') return R(200, { results: searchTasks(url.searchParams.get('q')) });
    if (p === '/api/tasks' && method === 'POST') {
      if (!rights.create) return E(403, 'Je hebt geen recht om taken aan te maken.');
      const title = clean(body.title, 160);
      let as = Array.isArray(body.assignees) ? [...new Set(body.assignees.map(Number))] : [];
      as = as.filter(id => { const u = userById(id); return u && u.active; });
      const missing = [];
      if (!title) missing.push('titel');
      if (!as.length) missing.push('voor wie');
      if (missing.length) return E(400, 'Niet alle verplichte velden zijn ingevuld: ' + missing.join(', ') + '.');
      if (!rights.assign && as.some(id => id !== me.id)) return E(403, 'Je mag alleen taken voor jezelf maken.');
      const t = { id: newId(), title, desc: clean(body.desc, 2000), dueAt: clean(body.dueAt, 30), priority: ['hoog', 'normaal', 'laag'].includes(body.priority) ? body.priority : 'normaal',
        assignees: as, mode: body.mode === 'iedereen' ? 'iedereen' : 'een', doneBy: {}, archivedBy: {}, createdBy: me.id, createdAt: nowIso() };
      db.tasks.push(t); save();
      return R(200, { task: viewTask(t, me) });
    }
    m = p.match(/^\/api\/tasks\/(\d+)\/(toggle|archive)$/);
    if (m) {
      const t = db.tasks.find(x => x.id === +m[1]);
      if (!t) return E(404, 'Taak niet gevonden');
      if (!t.assignees.includes(me.id)) return E(403, 'Deze taak staat niet op jouw naam.');
      if (m[2] === 'toggle') { if (t.doneBy[me.id]) delete t.doneBy[me.id]; else t.doneBy[me.id] = nowIso(); }
      else if (body.archived) { if (!taskIsDone(t) && !t.doneBy[me.id]) return E(400, 'Alleen afgeronde taken kun je archiveren.'); t.archivedBy[me.id] = true; }
      else delete t.archivedBy[me.id];
      save();
      return R(200, { task: viewTask(t, me) });
    }

    if (p.startsWith('/api/admin/')) {
      if (!rights.manageUsers) return E(403, 'Je hebt geen recht om gebruikers te beheren.');
      if (p === '/api/admin/users' && method === 'GET') return R(200, { users: db.users.map(publicUser), rightsList: RIGHTS, roleDefaults: ROLE_DEFAULTS });
      if (p === '/api/admin/users' && method === 'POST') {
        const name = clean(body.name, 60);
        if (!name) return E(400, 'Vul een naam in.');
        if (db.users.some(u => u.name.toLowerCase() === name.toLowerCase())) return E(400, 'Er bestaat al iemand met deze naam. Gebruik bijvoorbeeld ook een achternaam.');
        const role = ROLE_DEFAULTS[body.role] ? body.role : 'medewerker';
        const u = { id: newId(), name, role, isAdmin: false, active: true, rights: Object.assign({}, ROLE_DEFAULTS[role]) };
        if (body.rights) RIGHTS.forEach(k => { u.rights[k] = !!body.rights[k]; });
        if (!me.isAdmin && u.rights.manageUsers) return E(403, 'Alleen de Admin kan beheerders aanmaken.');
        u.code = makeCode();
        db.users.push(u); save();
        return R(200, { user: publicUser(u), code: u.code });
      }
      m = p.match(/^\/api\/admin\/users\/(\d+)(\/reset-code)?$/);
      if (m) {
        const u = userById(+m[1]);
        if (!u) return E(404, 'Gebruiker niet gevonden');
        if (m[2]) {
          if (u.isAdmin && !me.isAdmin) return E(403, 'Alleen de Admin kan de Admin-code wijzigen.');
          let code = clean(body.code, 20);
          if (code && !/^\d{4,12}$/.test(code)) return E(400, 'Een code bestaat uit 4 tot 12 cijfers.');
          u.code = code || makeCode(); save();
          return R(200, { code: u.code });
        }
        if (u.isAdmin) return E(403, 'Het Admin-account heeft altijd alle rechten en kan niet worden aangepast.');
        if (!me.isAdmin && (u.rights.manageUsers || (body.rights && body.rights.manageUsers))) return E(403, 'Alleen de Admin kan beheerders aanpassen.');
        if (body.name !== undefined) {
          const name = clean(body.name, 60);
          if (!name) return E(400, 'Vul een naam in.');
          if (db.users.some(x => x.id !== u.id && x.name.toLowerCase() === name.toLowerCase())) return E(400, 'Er bestaat al iemand met deze naam.');
          u.name = name;
        }
        if (body.role !== undefined && ROLE_DEFAULTS[body.role]) u.role = body.role;
        if (body.rights) RIGHTS.forEach(k => { u.rights[k] = !!body.rights[k]; });
        if (body.active !== undefined) { if (u.id === me.id && !body.active) return E(400, 'Je kunt jezelf niet deactiveren.'); u.active = !!body.active; }
        save();
        return R(200, { user: publicUser(u) });
      }
    }
    return E(404, 'Onbekend adres');
  }

  // ---------- fetch onderscheppen ----------
  load();
  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, opt) {
    const raw = typeof input === 'string' ? input : input.url;
    const url = new URL(raw, location.origin);
    const apiAt = url.pathname.indexOf('/api/');
    if (apiAt === -1) return realFetch(input, opt);
    url.pathname = url.pathname.slice(apiAt);
    const method = (opt && opt.method) || 'GET';
    let body = {};
    try { body = opt && opt.body ? JSON.parse(opt.body) : {}; } catch (e) { body = {}; }
    load();
    const r = handle(method, url, body);
    return new Promise(res => setTimeout(() => res(new Response(JSON.stringify(r.data), { status: r.status, headers: { 'Content-Type': 'application/json' } })), 80));
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
