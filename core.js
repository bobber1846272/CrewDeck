/* Terugbelsysteem · gedeelde kern
 * Alle regels van het systeem (wie mag wat, opslaan, zoeken, cijfers, logboek).
 * Wordt gebruikt door de echte server (Node) én door de demo in de browser.
 * Inloggen en codes regelt de omgeving zelf; deze kern krijgt de ingelogde gebruiker mee.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TBSCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RIGHTS = ['create', 'assign', 'viewAll', 'deleteItems', 'manageUsers'];
  const ROLE_DEFAULTS = {
    medewerker: { create: true, assign: true, viewAll: false, deleteItems: false, manageUsers: false },
    teamleider: { create: true, assign: true, viewAll: true, deleteItems: false, manageUsers: false },
    beheerder: { create: true, assign: true, viewAll: true, deleteItems: true, manageUsers: true }
  };
  const REPEATS = { none: 'Niet herhalen', werkdag: 'Elke werkdag', dag: 'Elke dag', week: 'Elke week' };
  const LOG_MAX = 5000;

  function createApi(env) {
    // env: { db, save(), setCode(user, code), makeCode(), revokeSessions(userId, exceptCurrent) }
    const db = env.db;
    if (!db.log) db.log = [];
    db.tasks.forEach(t => { if (!t.repeat) t.repeat = 'none'; });

    const nowIso = () => new Date().toISOString();
    const newId = () => db.nextId++;
    const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 300);
    const userById = id => db.users.find(u => u.id === id);
    const nameOf = id => { const u = userById(id); return u ? u.name : 'Onbekend'; };
    const effectiveRights = u => {
      const r = {};
      RIGHTS.forEach(k => { r[k] = u.isAdmin ? true : !!(u.rights && u.rights[k]); });
      return r;
    };
    const publicUser = u => ({ id: u.id, name: u.name, role: u.role, isAdmin: !!u.isAdmin, active: u.active, rights: effectiveRights(u) });
    const cbTitle = c => c.type === 'particulier' ? c.name : c.company;
    const phoneKey = p => String(p || '').replace(/\D/g, '').slice(-9);
    const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const prio = p => ['hoog', 'normaal', 'laag'].includes(p) ? p : 'normaal';

    function log(me, action, text, ref) {
      db.log.push({ id: newId(), at: nowIso(), by: me ? me.id : null, action, text, ref: ref || null });
      if (db.log.length > LOG_MAX) db.log.splice(0, db.log.length - LOG_MAX);
    }

    function taskIsDone(t) {
      const ids = Object.keys(t.doneBy || {}).map(Number);
      return t.mode === 'iedereen' ? t.assignees.every(a => ids.includes(a)) : ids.length > 0;
    }
    function openLoad(uid) {
      return db.callbacks.filter(c => c.status === 'open' && c.assignee === uid).length +
        db.tasks.filter(t => t.assignees.includes(uid) && !(t.doneBy || {})[uid] && !taskIsDone(t)).length;
    }

    const viewCallback = c => Object.assign({}, c, {
      assigneeName: c.assignee ? nameOf(c.assignee) : null,
      createdByName: nameOf(c.createdBy),
      doneByName: c.doneBy ? nameOf(c.doneBy) : null,
      attempts: (c.attempts || []).map(a => Object.assign({}, a, { byName: nameOf(a.by) }))
    });
    function viewTask(t, me) {
      const doneBy = t.doneBy || {};
      return {
        id: t.id, title: t.title, desc: t.desc, dueAt: t.dueAt, priority: t.priority, mode: t.mode, repeat: t.repeat || 'none',
        createdAt: t.createdAt, createdBy: t.createdBy, createdByName: nameOf(t.createdBy),
        assignees: t.assignees.map(id => ({ id, name: nameOf(id), done: !!doneBy[id] })),
        doneCount: t.assignees.filter(id => doneBy[id]).length,
        done: taskIsDone(t), mineDone: !!doneBy[me.id], isMine: t.assignees.includes(me.id),
        archived: !!(t.archivedBy || {})[me.id]
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

    // ---------- terugkerende taken ----------
    function pad(n) { return String(n).padStart(2, '0'); }
    function toLocal(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
    function nextDue(dueAt, repeat) {
      const d = new Date(dueAt);
      if (isNaN(d)) return null;
      const step = () => {
        if (repeat === 'week') d.setDate(d.getDate() + 7);
        else {
          d.setDate(d.getDate() + 1);
          if (repeat === 'werkdag') while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
        }
      };
      step();
      const now = new Date();
      let guard = 0;
      while (d < now && guard++ < 400) step();
      return toLocal(d);
    }
    function spawnNext(t, me) {
      if (!t.repeat || t.repeat === 'none' || t.spawned || !t.dueAt) return;
      const due = nextDue(t.dueAt, t.repeat);
      if (!due) return;
      const n = {
        id: newId(), title: t.title, desc: t.desc, dueAt: due, priority: t.priority, assignees: t.assignees.slice(),
        mode: t.mode, repeat: t.repeat, doneBy: {}, archivedBy: {}, createdBy: t.createdBy, createdAt: nowIso(), repeatOf: t.id
      };
      t.spawned = n.id;
      db.tasks.push(n);
      log(me, 'taak-herhaling', 'Herhaling klaargezet: ' + t.title + ' (' + REPEATS[t.repeat].toLowerCase() + ')', { kind: 'task', id: n.id });
    }

    // ---------- zoeken ----------
    function searchTasks(q) {
      const words = norm(q).split(/[^a-z0-9]+/).filter(w => w.length >= 3);
      if (!words.length) return [];
      const out = [];
      for (const t of db.tasks) {
        if (t.repeatOf && !taskIsDone(t) && db.tasks.some(x => x.id === t.repeatOf && !taskIsDone(x))) continue;
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
    function searchCallbacks(q) {
      q = clean(q, 100);
      const digits = q.replace(/\D/g, '');
      const words = norm(q).split(/[^a-z0-9]+/).filter(Boolean);
      if (q.length < 2) return [];
      const out = db.callbacks.filter(c => {
        if (digits.length >= 3) {
          if (String(c.order).replace(/\D/g, '').includes(digits)) return true;
          if (String(c.phone).replace(/\D/g, '').includes(digits)) return true;
          if (phoneKey(c.phone) && phoneKey(c.phone) === phoneKey(digits)) return true;
        }
        if (norm(c.order).includes(norm(q))) return true;
        const hay = norm([c.name, c.company, c.contact, c.email].join(' '));
        return words.length && words.every(w => hay.includes(w));
      });
      out.sort((a, b) => (a.status === b.status ? (b.createdAt || '').localeCompare(a.createdAt || '') : a.status === 'open' ? -1 : 1));
      return out.slice(0, 40).map(viewCallback);
    }
    function duplicates(order, phone, exclude) {
      const o = norm(clean(order, 60));
      const pk = phoneKey(phone);
      return db.callbacks.filter(c => c.status === 'open' && c.id !== exclude && (
        (o && norm(c.order) === o) || (pk.length >= 6 && phoneKey(c.phone) === pk)
      )).map(c => ({
        id: c.id, title: cbTitle(c), order: c.order, phone: c.phone, dueAt: c.dueAt,
        assigneeName: c.assignee ? nameOf(c.assignee) : null,
        sameOrder: !!o && norm(c.order) === o, samePhone: pk.length >= 6 && phoneKey(c.phone) === pk
      }));
    }

    // ---------- cijfers ----------
    function stats(days) {
      days = [7, 30, 90].includes(days) ? days : 7;
      const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - (days - 1));
      const inRange = iso => iso && new Date(iso) >= from;
      const created = db.callbacks.filter(c => inRange(c.createdAt));
      const done = db.callbacks.filter(c => c.status === 'done' && inRange(c.doneAt));
      const mins = c => Math.max(0, (new Date(c.doneAt) - new Date(c.createdAt)) / 60000);
      const late = done.filter(c => c.dueAt && new Date(c.doneAt) > new Date(c.dueAt));
      const avg = arr => arr.length ? Math.round(arr.reduce((a, c) => a + mins(c), 0) / arr.length) : null;
      const openNow = db.callbacks.filter(c => c.status === 'open');
      const perDay = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(from); d.setDate(from.getDate() + i);
        const same = iso => { if (!iso) return false; const x = new Date(iso); return x.toDateString() === d.toDateString(); };
        perDay.push({ date: toLocal(d).slice(0, 10), created: created.filter(c => same(c.createdAt)).length, done: done.filter(c => same(c.doneAt)).length });
      }
      const people = db.users.filter(u => u.active || done.some(c => c.doneBy === u.id)).map(u => {
        const mine = done.filter(c => c.doneBy === u.id);
        const attempts = db.callbacks.reduce((n, c) => n + (c.attempts || []).filter(a => a.by === u.id && inRange(a.at) && !/^Afgerond/.test(a.text)).length, 0);
        const tasksDone = db.tasks.filter(t => (t.doneBy || {})[u.id] && inRange(t.doneBy[u.id])).length;
        return { id: u.id, name: u.name, done: mine.length, avgMin: avg(mine), late: mine.filter(c => late.includes(c)).length, attempts, tasksDone, openNow: openLoad(u.id) };
      }).filter(p => p.done || p.attempts || p.tasksDone || p.openNow).sort((a, b) => b.done - a.done);
      const cats = {};
      created.forEach(c => { cats[c.category] = (cats[c.category] || 0) + 1; });
      return {
        days, from: from.toISOString(),
        totals: {
          created: created.length, done: done.length, avgMin: avg(done), latePct: done.length ? Math.round(late.length / done.length * 100) : null,
          openNow: openNow.length, lateNow: openNow.filter(c => c.dueAt && new Date(c.dueAt) < new Date()).length,
          poolNow: openNow.filter(c => !c.assignee).length
        },
        perDay, people,
        categories: Object.keys(cats).map(k => ({ name: k, count: cats[k] })).sort((a, b) => b.count - a.count)
      };
    }

    // ---------- verzoek bewerken / aanmaken ----------
    function fillCallback(c, body) {
      c.type = body.type === 'particulier' ? 'particulier' : 'zakelijk';
      c.name = clean(body.name, 120); c.company = clean(body.company, 120); c.contact = clean(body.contact, 120);
      c.phone = clean(body.phone, 40); c.email = clean(body.email, 120); c.order = clean(body.order, 60);
      c.category = clean(body.category, 60) || 'Overig'; c.priority = prio(body.priority);
      c.dueAt = clean(body.dueAt, 30); c.note = clean(body.note, 2000);
      const missing = [];
      if (c.type === 'zakelijk' && !c.company) missing.push('bedrijfsnaam');
      if (c.type === 'particulier' && !c.name) missing.push('naam');
      if (!c.phone) missing.push('telefoonnummer');
      if (!c.order) missing.push('ordernummer');
      return missing;
    }
    function fillTask(t, body, me, rights) {
      t.title = clean(body.title, 160); t.desc = clean(body.desc, 2000); t.dueAt = clean(body.dueAt, 30);
      t.priority = prio(body.priority); t.mode = body.mode === 'iedereen' ? 'iedereen' : 'een';
      t.repeat = REPEATS[body.repeat] ? body.repeat : 'none';
      let as = Array.isArray(body.assignees) ? [...new Set(body.assignees.map(Number))] : [];
      as = as.filter(id => { const u = userById(id); return u && u.active; });
      t.assignees = as;
      const missing = [];
      if (!t.title) missing.push('titel');
      if (!as.length) missing.push('voor wie');
      if (t.repeat !== 'none' && !t.dueAt) missing.push('deadline (nodig om te herhalen)');
      if (missing.length) return { error: 'Niet alle verplichte velden zijn ingevuld: ' + missing.join(', ') + '.' };
      if (!rights.assign && as.some(id => id !== me.id)) return { error: 'Je mag alleen taken voor jezelf maken.', status: 403 };
      return {};
    }
    const canEditCb = (c, me, rights) => rights.viewAll || c.createdBy === me.id || c.assignee === me.id;
    const canEditTask = (t, me, rights) => rights.viewAll || t.createdBy === me.id;

    // ---------- router ----------
    function handle(me, method, p, params, body) {
      const R = (status, data) => ({ status, data });
      const E = (status, msg) => R(status, { error: msg });
      const rights = effectiveRights(me);
      body = body || {};
      let m;

      if (p === '/api/me') return R(200, { user: publicUser(me) });
      if (p === '/api/colleagues') return R(200, { users: db.users.filter(u => u.active).map(u => ({ id: u.id, name: u.name, open: openLoad(u.id) })) });

      // ----- terugbelverzoeken -----
      if (p === '/api/callbacks' && method === 'GET') {
        const scope = params.get('scope') || 'mine';
        let list;
        if (scope === 'mine') list = db.callbacks.filter(c => c.status === 'open' && c.assignee === me.id);
        else if (scope === 'pool') list = db.callbacks.filter(c => c.status === 'open' && !c.assignee);
        else if (scope === 'done') list = db.callbacks.filter(c => c.status === 'done' && (rights.viewAll || c.assignee === me.id || c.doneBy === me.id || c.createdBy === me.id));
        else if (scope === 'all') { if (!rights.viewAll) return E(403, 'Je hebt geen recht om alle verzoeken te zien.'); list = db.callbacks.filter(c => c.status === 'open'); }
        else return E(400, 'Onbekend overzicht');
        list = list.slice().sort((a, b) => scope === 'done' ? (b.doneAt || '').localeCompare(a.doneAt || '') : (a.dueAt || '9999').localeCompare(b.dueAt || '9999'));
        if (scope === 'done') list = list.slice(0, 100);
        return R(200, { callbacks: list.map(viewCallback) });
      }
      if (p === '/api/callbacks/search') return R(200, { results: searchCallbacks(params.get('q')) });
      if (p === '/api/callbacks/check') return R(200, { duplicates: duplicates(params.get('order'), params.get('phone'), Number(params.get('exclude')) || null) });

      if (p === '/api/callbacks' && method === 'POST') {
        if (!rights.create) return E(403, 'Je hebt geen recht om verzoeken aan te maken.');
        const c = { id: 0, assignee: null, createdBy: me.id, createdAt: nowIso(), status: 'open', attempts: [] };
        const missing = fillCallback(c, body);
        if (missing.length) return E(400, 'Niet alle verplichte velden zijn ingevuld: ' + missing.join(', ') + '.');
        const a = resolveAssignee(body.assignee, me, rights);
        if (a.error) return E(400, a.error);
        c.id = newId(); c.assignee = a.id;
        db.callbacks.push(c);
        log(me, 'verzoek-nieuw', 'Verzoek aangemaakt: ' + cbTitle(c) + ' (order ' + c.order + ') → ' + (c.assignee ? nameOf(c.assignee) : 'open pool'), { kind: 'cb', id: c.id });
        env.save();
        return R(200, { callback: viewCallback(c) });
      }
      m = p.match(/^\/api\/callbacks\/(\d+)$/);
      if (m && method === 'GET') {
        const c = db.callbacks.find(x => x.id === +m[1]);
        if (!c) return E(404, 'Verzoek niet gevonden');
        return R(200, { callback: viewCallback(c), canEdit: canEditCb(c, me, rights) });
      }
      m = p.match(/^\/api\/callbacks\/(\d+)\/(update|delete|attempt|done|reopen|assign|claim)$/);
      if (m && method === 'POST') {
        const c = db.callbacks.find(x => x.id === +m[1]);
        if (!c) return E(404, 'Verzoek niet gevonden');
        const act = m[2];
        const title = cbTitle(c);
        if (act === 'delete') {
          if (!rights.deleteItems) return E(403, 'Je hebt geen recht om verzoeken te verwijderen.');
          db.callbacks.splice(db.callbacks.indexOf(c), 1);
          log(me, 'verzoek-verwijderd', 'Verzoek verwijderd: ' + title + ' (order ' + c.order + ')', null);
          env.save();
          return R(200, { ok: true });
        }
        if (act === 'update') {
          if (!canEditCb(c, me, rights)) return E(403, 'Je mag dit verzoek niet bewerken.');
          const copy = Object.assign({}, c);
          const missing = fillCallback(copy, body);
          if (missing.length) return E(400, 'Niet alle verplichte velden zijn ingevuld: ' + missing.join(', ') + '.');
          let assignNote = '';
          if (body.assignee !== undefined) {
            const a = resolveAssignee(body.assignee, me, rights);
            if (a.error) return E(400, a.error);
            if (a.id !== c.assignee) assignNote = ' · toegewezen aan ' + (a.id ? nameOf(a.id) : 'open pool');
            copy.assignee = a.id;
          }
          const changed = ['name', 'company', 'contact', 'phone', 'email', 'order', 'category', 'priority', 'dueAt', 'note', 'type'].filter(k => String(copy[k] || '') !== String(c[k] || ''));
          Object.assign(c, copy, { updatedAt: nowIso() });
          log(me, 'verzoek-bewerkt', 'Verzoek bewerkt: ' + cbTitle(c) + (changed.length ? ' (' + changed.map(k => FIELD[k] || k).join(', ') + ')' : '') + assignNote, { kind: 'cb', id: c.id });
          env.save();
          return R(200, { callback: viewCallback(c) });
        }
        if (!(c.assignee === me.id || c.createdBy === me.id || !c.assignee || rights.viewAll)) return E(403, 'Dit verzoek is niet van jou.');
        if (act === 'attempt') {
          const text = clean(body.text, 500) || 'Niet bereikt';
          c.attempts.push({ at: nowIso(), by: me.id, text });
          log(me, 'verzoek-poging', 'Belpoging bij ' + title + ': ' + text, { kind: 'cb', id: c.id });
        } else if (act === 'done') {
          c.status = 'done'; c.doneAt = nowIso(); c.doneBy = me.id;
          const t = clean(body.text, 500);
          if (t) c.attempts.push({ at: nowIso(), by: me.id, text: 'Afgerond: ' + t });
          log(me, 'verzoek-afgerond', 'Teruggebeld en afgerond: ' + title + (t ? ' · ' + t : ''), { kind: 'cb', id: c.id });
        } else if (act === 'reopen') {
          c.status = 'open'; delete c.doneAt; delete c.doneBy;
          log(me, 'verzoek-heropend', 'Verzoek weer opengezet: ' + title, { kind: 'cb', id: c.id });
        } else if (act === 'claim') {
          if (c.assignee) return E(409, 'Dit verzoek is al opgepakt door ' + nameOf(c.assignee) + '.');
          c.assignee = me.id;
          log(me, 'verzoek-opgepakt', 'Uit de pool opgepakt: ' + title, { kind: 'cb', id: c.id });
        } else if (act === 'assign') {
          const a = resolveAssignee(body.assignee, me, rights);
          if (a.error) return E(400, a.error);
          if (a.id !== c.assignee) {
            c.assignee = a.id;
            log(me, 'verzoek-toegewezen', title + ' toegewezen aan ' + (a.id ? nameOf(a.id) : 'open pool'), { kind: 'cb', id: c.id });
          }
        }
        env.save();
        return R(200, { callback: viewCallback(c) });
      }

      // ----- taken -----
      if (p === '/api/tasks' && method === 'GET') {
        const scope = params.get('scope') || 'mine';
        let list;
        if (scope === 'mine') list = db.tasks.filter(t => t.assignees.includes(me.id));
        else if (scope === 'all') { if (!rights.viewAll) return E(403, 'Je hebt geen recht om alle taken te zien.'); list = db.tasks.slice(); }
        else return E(400, 'Onbekend overzicht');
        list.sort((a, b) => (a.dueAt || '9999').localeCompare(b.dueAt || '9999'));
        return R(200, { tasks: list.map(t => viewTask(t, me)) });
      }
      if (p === '/api/tasks/search') return R(200, { results: searchTasks(params.get('q')) });
      if (p === '/api/tasks' && method === 'POST') {
        if (!rights.create) return E(403, 'Je hebt geen recht om taken aan te maken.');
        const t = { id: 0, doneBy: {}, archivedBy: {}, createdBy: me.id, createdAt: nowIso() };
        const res = fillTask(t, body, me, rights);
        if (res.error) return E(res.status || 400, res.error);
        t.id = newId();
        db.tasks.push(t);
        log(me, 'taak-nieuw', 'Taak aangemaakt: ' + t.title + ' → ' + t.assignees.map(nameOf).join(', ') + (t.repeat !== 'none' ? ' (' + REPEATS[t.repeat].toLowerCase() + ')' : ''), { kind: 'task', id: t.id });
        env.save();
        return R(200, { task: viewTask(t, me) });
      }
      m = p.match(/^\/api\/tasks\/(\d+)$/);
      if (m && method === 'GET') {
        const t = db.tasks.find(x => x.id === +m[1]);
        if (!t) return E(404, 'Taak niet gevonden');
        return R(200, { task: viewTask(t, me), canEdit: canEditTask(t, me, rights) });
      }
      m = p.match(/^\/api\/tasks\/(\d+)\/(update|delete|toggle|archive)$/);
      if (m && method === 'POST') {
        const t = db.tasks.find(x => x.id === +m[1]);
        if (!t) return E(404, 'Taak niet gevonden');
        t.doneBy = t.doneBy || {}; t.archivedBy = t.archivedBy || {};
        const act = m[2];
        if (act === 'delete') {
          if (!rights.deleteItems) return E(403, 'Je hebt geen recht om taken te verwijderen.');
          db.tasks.splice(db.tasks.indexOf(t), 1);
          log(me, 'taak-verwijderd', 'Taak verwijderd: ' + t.title, null);
          env.save();
          return R(200, { ok: true });
        }
        if (act === 'update') {
          if (!canEditTask(t, me, rights)) return E(403, 'Alleen wie de taak gemaakt heeft (of een teamleider) mag hem bewerken.');
          const copy = Object.assign({}, t);
          const res = fillTask(copy, body, me, rights);
          if (res.error) return E(res.status || 400, res.error);
          Object.keys(copy.doneBy).forEach(id => { if (!copy.assignees.includes(+id)) delete copy.doneBy[id]; });
          Object.assign(t, copy, { updatedAt: nowIso() });
          log(me, 'taak-bewerkt', 'Taak bewerkt: ' + t.title, { kind: 'task', id: t.id });
          if (taskIsDone(t)) spawnNext(t, me);
          env.save();
          return R(200, { task: viewTask(t, me) });
        }
        if (!t.assignees.includes(me.id)) return E(403, 'Deze taak staat niet op jouw naam.');
        if (act === 'toggle') {
          if (t.doneBy[me.id]) {
            delete t.doneBy[me.id];
            log(me, 'taak-heropend', 'Taak weer open: ' + t.title, { kind: 'task', id: t.id });
          } else {
            t.doneBy[me.id] = nowIso();
            log(me, 'taak-afgevinkt', 'Afgevinkt: ' + t.title + (taskIsDone(t) ? '' : ' (wacht op anderen)'), { kind: 'task', id: t.id });
            if (taskIsDone(t)) spawnNext(t, me);
          }
        } else if (body.archived) {
          if (!taskIsDone(t) && !t.doneBy[me.id]) return E(400, 'Alleen afgeronde taken kun je archiveren.');
          t.archivedBy[me.id] = true;
        } else delete t.archivedBy[me.id];
        env.save();
        return R(200, { task: viewTask(t, me) });
      }

      // ----- teambord / cijfers / logboek -----
      if (p === '/api/team') {
        if (!rights.viewAll) return E(403, 'Je hebt geen recht om het teambord te zien.');
        const open = db.callbacks.filter(c => c.status === 'open').sort((a, b) => (a.dueAt || '9999').localeCompare(b.dueAt || '9999'));
        const tasks = db.tasks.filter(t => !taskIsDone(t));
        const col = (u) => ({
          user: u ? { id: u.id, name: u.name } : null,
          callbacks: open.filter(c => (u ? c.assignee === u.id : !c.assignee)).map(viewCallback),
          tasks: u ? tasks.filter(t => t.assignees.includes(u.id) && !t.doneBy[u.id]).sort((a, b) => (a.dueAt || '9999').localeCompare(b.dueAt || '9999')).map(t => viewTask(t, me)) : []
        });
        const users = db.users.filter(u => u.active && (!u.isAdmin || open.some(c => c.assignee === u.id) || tasks.some(t => t.assignees.includes(u.id))));
        return R(200, { columns: [col(null)].concat(users.sort((a, b) => a.name.localeCompare(b.name)).map(col)) });
      }
      if (p === '/api/stats') {
        if (!rights.viewAll) return E(403, 'Je hebt geen recht om de cijfers te zien.');
        return R(200, stats(Number(params.get('days')) || 7));
      }
      if (p === '/api/log') {
        if (!rights.viewAll) return E(403, 'Je hebt geen recht om het logboek te zien.');
        const uid = Number(params.get('user')) || null;
        const q = norm(params.get('q') || '');
        let list = db.log.slice().reverse();
        if (uid) list = list.filter(l => l.by === uid);
        if (q) list = list.filter(l => norm(l.text).includes(q));
        return R(200, { entries: list.slice(0, 300).map(l => Object.assign({}, l, { byName: l.by ? nameOf(l.by) : 'Systeem' })), total: list.length });
      }

      // ----- beheer -----
      if (p.startsWith('/api/admin/')) {
        if (!rights.manageUsers) return E(403, 'Je hebt geen recht om gebruikers te beheren.');
        if (p === '/api/admin/users' && method === 'GET') return R(200, { users: db.users.map(publicUser), rightsList: RIGHTS, roleDefaults: ROLE_DEFAULTS });
        if (p === '/api/admin/users' && method === 'POST') {
          const name = clean(body.name, 60);
          if (!name) return E(400, 'Vul een naam in.');
          if (db.users.some(u => u.name.toLowerCase() === name.toLowerCase())) return E(400, 'Er bestaat al iemand met deze naam. Gebruik bijvoorbeeld ook een achternaam.');
          const role = ROLE_DEFAULTS[body.role] ? body.role : 'medewerker';
          const u = { id: newId(), name, role, isAdmin: false, active: true, rights: Object.assign({}, ROLE_DEFAULTS[role]), createdAt: nowIso() };
          if (body.rights) RIGHTS.forEach(k => { u.rights[k] = !!body.rights[k]; });
          if (!me.isAdmin && u.rights.manageUsers) return E(403, 'Alleen de Admin kan beheerders aanmaken.');
          const code = env.makeCode();
          env.setCode(u, code);
          db.users.push(u);
          log(me, 'gebruiker-nieuw', 'Gebruiker aangemaakt: ' + u.name + ' (' + role + ')', null);
          env.save();
          return R(200, { user: publicUser(u), code });
        }
        m = p.match(/^\/api\/admin\/users\/(\d+)(\/reset-code)?$/);
        if (m && method === 'POST') {
          const u = userById(+m[1]);
          if (!u) return E(404, 'Gebruiker niet gevonden');
          if (m[2]) {
            if (u.isAdmin && !me.isAdmin) return E(403, 'Alleen de Admin kan de Admin-code wijzigen.');
            let code = clean(body.code, 20);
            if (code && !/^\d{4,12}$/.test(code)) return E(400, 'Een code bestaat uit 4 tot 12 cijfers.');
            if (!code) code = env.makeCode();
            env.setCode(u, code);
            env.revokeSessions(u.id, true);
            log(me, 'gebruiker-code', 'Nieuwe code ingesteld voor ' + u.name, null);
            env.save();
            return R(200, { code });
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
          if (body.active !== undefined) {
            if (u.id === me.id && !body.active) return E(400, 'Je kunt jezelf niet deactiveren.');
            u.active = !!body.active;
            if (!u.active) env.revokeSessions(u.id, false);
          }
          log(me, 'gebruiker-bewerkt', 'Gebruiker bijgewerkt: ' + u.name + (u.active ? '' : ' (gedeactiveerd)'), null);
          env.save();
          return R(200, { user: publicUser(u) });
        }
      }
      return E(404, 'Onbekend adres');
    }

    const FIELD = { name: 'naam', company: 'bedrijfsnaam', contact: 'contactpersoon', phone: 'telefoon', email: 'e-mail', order: 'ordernummer', category: 'categorie', priority: 'prioriteit', dueAt: 'bel vóór', note: 'notitie', type: 'soort klant' };

    return { handle, publicUser, effectiveRights, log };
  }

  return { createApi, RIGHTS, ROLE_DEFAULTS, REPEATS };
});
