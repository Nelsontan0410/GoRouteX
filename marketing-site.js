// Marketing presentation only. Product limits, authentication and billing remain in their existing modules.
(() => {
  const product = window.RoutePlannerProduct;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const cards = document.getElementById('pricingPlanCards');

  if (product) {
    const basic = product.getPlanLimits('basic');
    document.querySelectorAll('[data-basic-limit]').forEach(element => { element.textContent = basic[element.dataset.basicLimit]; });
    const copy = {
      basic: { label:'Free to start', price:'Free', annual:'No subscription needed', description:'A free starting point for everyday route planning. Your saved stops and routes stay on this device.', cta:'Start free', href:'login.html?mode=signup&next=app.html' },
      goplan: { label:'Cloud-backed planning', price:'Loading price…', annual:'Monthly billing', description:'More daily planning capacity, with cloud sync to keep your work available across devices.', cta:'View GoPlan', href:'login.html?mode=signup&next=app.html%3Fpage%3Daccount' },
      proplan: { label:'More daily capacity', price:'Loading price…', annual:'Monthly or annual billing', description:'Higher saved-stop and daily-route limits for a busier operation.', cta:'View ProPlan', href:'login.html?mode=signup&next=app.html%3Fpage%3Daccount' }
    };
    if (cards) {
      cards.innerHTML = product.PLAN_ORDER.map(key => {
        const plan = product.PLAN_DEFINITIONS[key], limits = product.getPlanLimits(key), item = copy[key];
        const features = [
          product.formatLimitValue(limits.maxSavedStops, 'saved stops'),
          product.formatLimitValue(limits.maxSavedRoutesPerDay, limits.maxSavedRoutesPerDay === 1 ? 'saved route/day' : 'saved routes/day'),
          product.formatLimitValue(limits.maxStopsPerRoute, 'stops/route'),
          product.getStorageModeForPlan(key) === 'indexeddb' ? 'Storage on this device' : 'Cloud sync and backup',
          'WhatsApp ETA sharing'
        ];
        return `<article class="pricing-card${key === 'basic' ? ' featured' : ''}"><span class="pricing-label">${escapeHtml(item.label)}</span><h3>${escapeHtml(plan.name)}</h3><div class="price-tag"><strong class="${key === 'basic' ? '' : 'price-unavailable'}" data-plan-price="${key}" aria-live="polite">${escapeHtml(item.price)}</strong><span data-plan-unit="${key}"></span></div><p class="annual-note" data-plan-annual="${key}">${escapeHtml(item.annual)}</p><p class="pricing-copy">${escapeHtml(item.description)}</p><ul class="pricing-list">${features.map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ul><a class="button-primary" href="${escapeHtml(item.href)}">${escapeHtml(item.cta)}</a></article>`;
      }).join('');

      // Exactly one existing public catalog request. No checkout, Stripe API, retry or account access.
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      const unavailable = () => {
        cards.querySelectorAll('[data-plan-price]').forEach(element => {
          if (element.dataset.planPrice !== 'basic' && element.textContent === 'Loading price…') element.textContent = 'Price unavailable';
        });
      };
      fetch('/.netlify/functions/billing-catalog', { signal:controller.signal })
        .then(response => response.ok ? response.json() : null)
        .then(result => {
          const catalog = result?.catalog;
          if (!catalog?.configured || !Array.isArray(catalog.offers)) return;
          const offers = catalog.offers.flat();
          const amountText = amount => new Intl.NumberFormat('en-SG', { style:'currency', currency:'SGD' }).format(amount);
          for (const key of ['goplan', 'proplan']) {
            const monthly = offers.find(offer => offer.plan === key && offer.interval === 'month' && offer.currency === 'SGD' && offer.available);
            if (!monthly || !Number.isFinite(Number(monthly.amount)) || Number(monthly.amount) <= 0) continue;
            const price = cards.querySelector(`[data-plan-price="${key}"]`);
            const unit = cards.querySelector(`[data-plan-unit="${key}"]`);
            if (price) { price.textContent = amountText(monthly.amount); price.classList.remove('price-unavailable'); }
            if (unit) unit.textContent = 'per month';
            if (key === 'proplan') {
              const annual = offers.find(offer => offer.plan === key && offer.interval === 'year' && offer.currency === 'SGD' && offer.available);
              const note = cards.querySelector(`[data-plan-annual="${key}"]`);
              if (note) note.textContent = annual && Number(annual.amount) > 0 ? `Or ${amountText(annual.amount)} per year` : 'Monthly billing';
            }
          }
        })
        .catch(() => {})
        .finally(() => { window.clearTimeout(timeout); unavailable(); });
      window.addEventListener('pagehide', () => { window.clearTimeout(timeout); controller.abort(); }, { once:true });
    }

    const rows = [
      ['Saved stops', key => product.formatLimitValue(product.getPlanLimits(key).maxSavedStops, 'saved stops')],
      ['Saved routes/day', key => { const count = product.getPlanLimits(key).maxSavedRoutesPerDay; return product.formatLimitValue(count, count === 1 ? 'saved route/day' : 'saved routes/day'); }],
      ['Stops per route', key => product.formatLimitValue(product.getPlanLimits(key).maxStopsPerRoute, 'stops/route')],
      ['Selectable stops', key => product.formatLimitValue(product.getPlanLimits(key).maxSelectableStops, 'selectable stops')],
      ['Storage', key => product.getStorageModeForPlan(key) === 'indexeddb' ? 'Device-only' : 'Cloud sync'],
      ['WhatsApp ETA / unable visit', key => product.canUseFeature('whatsappEta', key) ? 'Included' : 'Not included'],
      // Order intake and Saved Stops import have different gates. Do not advertise an unverified tier assignment.
      ['Advanced WhatsApp tools', key => product.canUseFeature('advancedWhatsappTools', key) ? 'Included' : 'Not included'],
      ['Driver GPS tracking', () => 'Coming Soon'],
      ['Proof of Delivery', () => 'Coming Soon']
    ];
    const table = document.getElementById('pricingComparisonTable');
    if (table) table.innerHTML = `<table class="pricing-comparison-table"><caption class="sr-only">GoRouteX plan features</caption><thead><tr><th scope="col">Feature</th>${product.PLAN_ORDER.map(key => `<th scope="col">${escapeHtml(product.PLAN_DEFINITIONS[key].shortName)}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, getValue]) => `<tr><th scope="row">${escapeHtml(label)}</th>${product.PLAN_ORDER.map(key => `<td>${escapeHtml(getValue(key))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  const menu = document.getElementById('menuToggle'), nav = document.getElementById('siteNav');
  const closeMenu = () => { nav?.classList.remove('is-open'); menu?.setAttribute('aria-expanded', 'false'); };
  menu?.addEventListener('click', () => { if (nav) menu.setAttribute('aria-expanded', String(nav.classList.toggle('is-open'))); });
  nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && nav?.classList.contains('is-open')) { closeMenu(); menu?.focus(); } });
  document.addEventListener('click', event => { if (!event.target.closest('.site-header')) closeMenu(); });
  window.matchMedia('(min-width:981px)').addEventListener('change', closeMenu);

  const example = document.getElementById('routeExample');
  const replay = document.getElementById('replayRoute');
  const stage = document.getElementById('demoStageLabel');
  if (!example || !replay || !stage) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion:reduce)');
  let completionTimer;
  let observer;
  let played = false;
  const finish = () => {
    window.clearTimeout(completionTimer);
    example.classList.remove('is-playing');
    stage.textContent = 'Route ready. You’re ready.';
    replay.disabled = false;
    replay.removeAttribute('aria-busy');
  };
  const play = () => {
    finish();
    if (reducedMotion.matches || document.hidden) return;
    played = true;
    // Reset a short, finite SVG sequence. The example never invokes the application route engine.
    void example.offsetWidth;
    stage.textContent = 'A clear order for your stops.';
    example.classList.add('is-playing');
    replay.disabled = true;
    replay.setAttribute('aria-busy', 'true');
    completionTimer = window.setTimeout(finish, 1850);
  };
  replay.hidden = reducedMotion.matches;
  replay.addEventListener('click', play);
  reducedMotion.addEventListener('change', () => { finish(); replay.hidden = reducedMotion.matches; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) finish(); });
  if (!reducedMotion.matches && 'IntersectionObserver' in window) {
    observer = new IntersectionObserver(entries => {
      const entry = entries[0];
      if (entry.isIntersecting && !played) { play(); }
      if (!entry.isIntersecting && example.classList.contains('is-playing')) finish();
      if (played && !example.classList.contains('is-playing')) observer.disconnect();
    }, { threshold:.3 });
    observer.observe(example);
  }
  window.addEventListener('pagehide', () => { finish(); observer?.disconnect(); }, { once:true });
})();
