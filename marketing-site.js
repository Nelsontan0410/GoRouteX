// Marketing presentation only. Account, checkout and route logic stay in the app.
(() => {
  const product = window.RoutePlannerProduct;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  if (product) {
    const basic = product.getPlanLimits('basic');
    document.querySelectorAll('[data-basic-limit]').forEach(el => { el.textContent = basic[el.dataset.basicLimit]; });
    // Paid prices are loaded from the server's configured Stripe catalog.
    const copy = {
      basic: { label:'The everyday starting point', price:'Free', unit:'', annual:'No subscription needed', description:'For small daily runs and personal trips.', cta:'Start Free', href:'login.html?mode=signup&next=app.html' },
      goplan: { label:'More room for your business', price:'Price unavailable', unit:'', annual:'Monthly billing', description:'More capacity, with your plans backed up in the cloud.', cta:'View Go Plan', href:'login.html?mode=signup&next=app.html%3Fpage%3Daccount' },
      proplan: { label:'For a busier working day', price:'Price unavailable', unit:'', annual:'Monthly or annual billing', description:'Higher limits and advanced WhatsApp workflow tools.', cta:'Upgrade to Pro', href:'login.html?mode=signup&next=app.html%3Fpage%3Daccount' }
    };
    const cards = document.getElementById('pricingPlanCards');
    if (cards) cards.innerHTML = product.PLAN_ORDER.map(key => {
      const plan = product.PLAN_DEFINITIONS[key], limits = product.getPlanLimits(key), item = copy[key];
      const features = [product.formatLimitValue(limits.maxSavedStops,'saved stops'),product.formatLimitValue(limits.maxSavedRoutesPerDay,limits.maxSavedRoutesPerDay===1?'saved route/day':'saved routes/day'),product.formatLimitValue(limits.maxStopsPerRoute,'stops/route'),product.getStorageModeForPlan(key)==='indexeddb'?'Storage on this device':'Cloud sync and backup','WhatsApp ETA sharing'];
      return `<article class="pricing-card${key==='goplan'?' featured':''}"><span class="pricing-label">${escapeHtml(item.label)}</span><h3>${escapeHtml(plan.name)}</h3><div class="price-tag"><strong data-plan-price="${key}">${escapeHtml(item.price)}</strong><span data-plan-unit="${key}">${escapeHtml(item.unit)}</span></div><p class="annual-note" data-plan-annual="${key}">${escapeHtml(item.annual)}</p><p class="pricing-copy">${escapeHtml(item.description)}</p><ul class="pricing-list">${features.map(text=>`<li>${escapeHtml(text)}</li>`).join('')}</ul><a class="button-primary" href="${escapeHtml(item.href)}">${escapeHtml(item.cta)}</a></article>`;
    }).join('');
    if (cards) fetch('/.netlify/functions/billing-catalog')
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        const catalog = result?.catalog;
        if (!catalog?.configured || !Array.isArray(catalog.offers)) return;
        const offers = catalog.offers.flat();
        const amountText = (amount) => new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' }).format(amount);
        for (const key of ['goplan', 'proplan']) {
          const monthly = offers.find((offer) => offer.plan === key && offer.interval === 'month' && offer.currency === 'SGD' && offer.available);
          if (!monthly || !Number.isFinite(Number(monthly.amount)) || Number(monthly.amount) <= 0) continue;
          const price = cards.querySelector(`[data-plan-price="${key}"]`);
          const unit = cards.querySelector(`[data-plan-unit="${key}"]`);
          if (price) price.textContent = amountText(monthly.amount);
          if (unit) unit.textContent = 'per month';
          if (key === 'proplan') {
            const annual = offers.find((offer) => offer.plan === key && offer.interval === 'year' && offer.currency === 'SGD' && offer.available);
            const note = cards.querySelector(`[data-plan-annual="${key}"]`);
            if (note) note.textContent = annual && Number(annual.amount) > 0 ? `Or ${amountText(annual.amount)} per year` : 'Monthly billing';
          }
        }
      })
      .catch(() => {});
    const rows = [
      ['Saved stops',key=>product.formatLimitValue(product.getPlanLimits(key).maxSavedStops,'saved stops')],
      ['Saved routes/day',key=>{const count=product.getPlanLimits(key).maxSavedRoutesPerDay;return product.formatLimitValue(count,count===1?'saved route/day':'saved routes/day');}],
      ['Stops per route',key=>product.formatLimitValue(product.getPlanLimits(key).maxStopsPerRoute,'stops/route')],
      ['Selectable stops',key=>product.formatLimitValue(product.getPlanLimits(key).maxSelectableStops,'selectable stops')],
      ['Storage',key=>product.getStorageModeForPlan(key)==='indexeddb'?'Device-only':'Cloud sync'],
      ['WhatsApp ETA / unable visit',key=>product.canUseFeature('whatsappEta',key)?'Included':'Not included'],
      ['CSV import',key=>product.canUseFeature('csvImport',key)?'Included':'Not included'],
      ['Advanced WhatsApp tools',key=>product.canUseFeature('advancedWhatsappTools',key)?'Included':'Not included'],
      ['Driver GPS tracking',()=>'Coming Soon'],['Proof of Delivery',()=>'Coming Soon']
    ];
    const table = document.getElementById('pricingComparisonTable');
    if (table) table.innerHTML = `<table class="pricing-comparison-table"><caption class="sr-only">GoRouteX plan features</caption><thead><tr><th scope="col">Feature</th>${product.PLAN_ORDER.map(key=>`<th scope="col">${escapeHtml(product.PLAN_DEFINITIONS[key].shortName)}</th>`).join('')}</tr></thead><tbody>${rows.map(([label,getValue])=>`<tr><th scope="row">${escapeHtml(label)}</th>${product.PLAN_ORDER.map(key=>`<td>${escapeHtml(getValue(key))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  const menu = document.getElementById('menuToggle'), nav = document.getElementById('siteNav');
  const close = () => { nav?.classList.remove('is-open'); menu?.setAttribute('aria-expanded','false'); };
  menu?.addEventListener('click',()=>menu.setAttribute('aria-expanded',String(nav.classList.toggle('is-open'))));
  nav?.querySelectorAll('a').forEach(link=>link.addEventListener('click',close));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&nav?.classList.contains('is-open')){close();menu.focus();}});
  document.addEventListener('click',event=>{if(!event.target.closest('.site-header'))close();});
  window.matchMedia('(min-width:981px)').addEventListener('change',close);
})();
