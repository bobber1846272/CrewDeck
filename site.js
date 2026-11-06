/* CrewHarbor · website: pakketten laden, prijs uitrekenen, aanvraag versturen */
(function () {
  'use strict';
  const CFG = window.CREWDECK_CONFIG || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = (c, dec) => '€ ' + (c / 100).toLocaleString('nl-NL', { minimumFractionDigits: dec === false && c % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 });

  if (window.CH_LOGO) { $('logo').innerHTML = window.CH_LOGO(30); $('logo2').innerHTML = window.CH_LOGO(28); }

  // reserve-pakketten als de server even niet bereikbaar is
  let PLANS = [
    { id: 'start', name: 'Start', tagline: 'Voor kleine teams die overzicht willen.', priceCents: 350, minCents: 1900, highlights: ['Terugbelverzoeken en taken', 'Uren, in- en uitklokken en prikklok', 'Rooster, verlof en beschikbaarheid', 'Kennisbank en documenten', 'Meldingen per mail', 'Tot 15 medewerkers'], maxMembers: 15 },
    { id: 'team', name: 'Team', tagline: 'Alles voor een groeiend team, met export naar je salarisadministratie.', priceCents: 495, minCents: 3900, highlights: ['Alles uit Start', 'Salarisexport (Excel, Nmbrs, Loket.nl, AFAS)', 'Koppeling met 3CX-telefonie', 'Onbeperkt medewerkers'], popular: true },
    { id: 'bedrijf', name: 'Bedrijf', tagline: 'Voor bedrijven met meerdere vestigingen.', priceCents: 695, minCents: 7900, highlights: ['Alles uit Team', 'Meerdere vestigingen met eigen rooster en prikklok', 'Hulp bij het overstappen', 'Ook op een eigen server mogelijk'] }
  ];
  let chosen = new URLSearchParams(location.search).get('pakket') || 'team';

  function api(action, body) {
    return fetch(CFG.supabaseUrl + '/functions/v1/crewdeck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: 'Bearer ' + CFG.supabaseKey },
      body: JSON.stringify(Object.assign({ action }, body || {}))
    }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Er ging iets mis. Probeer het opnieuw.'); return j; });
  }

  function renderPlans() {
    const n = Number($('calc-n').value) || 1;
    $('calc-out').value = n >= 100 ? '100+' : n;
    $('plans').innerHTML = PLANS.map(p => {
      const fits = !p.maxMembers || n <= p.maxMembers;
      const month = Math.max(p.minCents || 0, p.priceCents * n);
      return '<article class="plan' + (p.popular ? ' pop' : '') + '">' + (p.popular ? '<span class="tag">Meest gekozen</span>' : '') +
        '<div><h3>' + esc(p.name) + '</h3><p class="tagline">' + esc(p.tagline) + '</p></div>' +
        '<div class="price"><strong>' + eur(p.priceCents) + '</strong><span>per medewerker per maand</span></div>' +
        '<div class="est">' + (fits ? 'Voor ' + n + ' medewerker' + (n === 1 ? '' : 's') + ': <strong>' + eur(month) + '</strong> per maand' + (p.minCents && month === p.minCents ? ' (minimum)' : '')
          : 'Voor maximaal ' + p.maxMembers + ' medewerkers') + '</div>' +
        '<ul>' + (p.highlights || []).map(h => '<li>' + esc(h) + '</li>').join('') + '</ul>' +
        '<a class="btn ' + (p.popular ? 'primary' : 'outline') + '" href="#aanvragen" data-plan="' + esc(p.id) + '">Kies ' + esc(p.name) + '</a></article>';
    }).join('');
    const sel = $('a-plan');
    sel.innerHTML = PLANS.map(p => '<option value="' + esc(p.id) + '"' + (p.id === chosen ? ' selected' : '') + '>' + esc(p.name) + ' (' + eur(p.priceCents) + ' p.p.)</option>').join('') +
      '<option value=""' + (!PLANS.some(p => p.id === chosen) ? ' selected' : '') + '>Weet ik nog niet</option>';
  }
  $('calc-n').addEventListener('input', renderPlans);
  $('plans').addEventListener('click', e => { const a = e.target.closest('[data-plan]'); if (a) { chosen = a.dataset.plan; renderPlans(); setTimeout(() => $('a-company').focus(), 400); } });
  $('a-plan').addEventListener('change', e => { chosen = e.target.value; });
  renderPlans();
  if (CFG.supabaseUrl) api('plans').then(d => { if (d.plans && d.plans.length) { PLANS = d.plans; renderPlans(); } }).catch(() => { /* reserve blijft staan */ });

  // aanvraag
  const form = $('ask'), msg = $('ask-msg');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const v = k => form.elements[k].value.trim();
    const miss = [];
    if (v('company').length < 2) miss.push('bedrijfsnaam');
    if (v('contactName').length < 2) miss.push('je naam');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v('email'))) miss.push('een geldig e-mailadres');
    if (miss.length) { msg.innerHTML = '<div class="alert error" role="alert">Vul nog in: ' + esc(miss.join(', ')) + '.</div>'; return; }
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Versturen…';
    try {
      await api('request', { company: v('company'), contactName: v('contactName'), email: v('email').toLowerCase(), phone: v('phone'), employees: v('employees'),
        plan: v('plan'), message: v('message'), website: form.elements.website.value });
      form.innerHTML = '<div class="done" role="status"><h3>Bedankt, ' + esc(v('contactName').split(' ')[0]) + '!</h3><p>We hebben je aanvraag ontvangen. Zodra ' + esc(v('company')) +
        ' klaarstaat, krijg je op <strong>' + esc(v('email')) + '</strong> een mail om je wachtwoord te kiezen.</p><p class="fine">Niets ontvangen binnen twee werkdagen? Kijk ook in je spammap.</p></div>';
    } catch (err) {
      msg.innerHTML = '<div class="alert error" role="alert">' + esc(err.message) + '</div>';
      btn.disabled = false; btn.textContent = 'Aanvragen';
    }
  });
})();
