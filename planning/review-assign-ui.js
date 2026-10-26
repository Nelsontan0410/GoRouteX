/**
 * Review & Assign (page-manual-assign): presentation helpers added with the 2026-10 UI refresh.
 * - Status chips: stops selected, restriction codes, route groups (read from the page, never invented).
 * - Responsive list/map views, group tabs, and disclosure of existing stop controls.
 * Read-only towards planning: it only reads the rendered lists and toggles data attributes / classes.
 * Loading this file registers no listeners until the DOM is ready; it makes no data or API requests.
 */
(function (global) {
  let pageRoot = null;
  const $ = (id) => document.getElementById(id) || pageRoot?.querySelector(`#${id}`);
  let activeKey = null;
  let scheduled = false;
  let openCustomer = null;
  let focusBeforeSheet = null;
  // Stop whose quick actions stay visible (after tapping the chevron or after a move).
  let quickCustomer = null;
  let pendingQuickFocus = null;
  const ICONS = {
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
    remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'
  };
  const QUICK_LABELS = { up: 'Move stop up', down: 'Move stop down', remove: 'Remove stop from route' };
  const phone = () => global.matchMedia('(max-width: 980px)').matches;
  const pageNode = () => pageRoot || $('page-manual-assign');
  const defaultNotice = 'Routes generated. Adjust stops or use map detours if needed, then click Confirm Route.';

  // These helpers change only the viewport, never the route or its map overlays.
  function resizeMap(fitStops = false) {
    global.requestAnimationFrame(() => {
      if (typeof mapPage2 === 'undefined' || !mapPage2) return;
      global.MapHandler?.triggerResize(mapPage2);
      if (fitStops && global.GoRouteXRouteOverviewUi?.fit()) return;
      if (fitStops && typeof masterListPreviewMarkers !== 'undefined' && masterListPreviewMarkers.length && typeof fitMapToMarkers === 'function') {
        fitMapToMarkers(mapPage2, masterListPreviewMarkers);
      }
    });
  }

  function setView(view) {
    closeStop();
    pageNode().dataset.raView = view;
    document.querySelectorAll('.ra-view-switch [data-ra-view]').forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.raView === view));
    });
    if (view === 'map') resizeMap(true);
  }

  function closeStop(restoreFocus = true) {
    const currentToggle = pageNode()?.querySelector('.ra-detail-open .ra-stop-toggle');
    openCustomer = null;
    pageNode()?.removeAttribute('data-ra-sheet');
    const shade = $('raSheetShade');
    if (shade) shade.hidden = true;
    pageNode()?.querySelectorAll('#routePanel .ra-detail-open').forEach((slot) => {
      slot.classList.remove('ra-detail-open');
      slot.removeAttribute('role');
      slot.removeAttribute('aria-modal');
      slot.removeAttribute('aria-label');
      slot.querySelector('.ra-stop-toggle')?.setAttribute('aria-expanded', 'false');
    });
    const target = focusBeforeSheet?.isConnected ? focusBeforeSheet : currentToggle;
    if (restoreFocus && target?.isConnected) target.focus({ preventScroll: true });
    focusBeforeSheet = null;
  }

  function presentOpenStop(slot, takeFocus = false) {
    slot.classList.add('ra-detail-open');
    slot.querySelector('.ra-stop-toggle')?.setAttribute('aria-expanded', 'true');
    const modal = phone();
    $('raSheetShade').hidden = !modal;
    if (modal) {
      pageNode().dataset.raSheet = 'open';
      slot.setAttribute('role', 'dialog');
      slot.setAttribute('aria-modal', 'true');
      slot.setAttribute('aria-label', `Stop ${slot.querySelector('.slot-number')?.textContent || ''} details`);
    } else {
      pageNode().removeAttribute('data-ra-sheet');
      slot.removeAttribute('role');
      slot.removeAttribute('aria-modal');
      slot.removeAttribute('aria-label');
    }
    if (takeFocus && modal) slot.querySelector('.ra-close-stop')?.focus({ preventScroll: true });
  }

  function focusStopOnMap(slot) {
    if (typeof mapPage2 === 'undefined' || !mapPage2 || typeof masterListPreviewMarkers === 'undefined') return;
    const marker = masterListPreviewMarkers.find((item) => item.stopId === slot.dataset.customerId);
    const position = marker && global.MapHandler?.getMarkerPosition(marker);
    if (position) global.MapHandler?.panTo(mapPage2, position);
  }

  function openStop(slot) {
    const customer = slot.dataset.customerId;
    if (customer === openCustomer) return closeStop();
    closeStop(false);
    openCustomer = customer;
    focusBeforeSheet = slot.querySelector('.ra-stop-toggle');
    presentOpenStop(slot, true);
    focusStopOnMap(slot);
  }

  function nativeControl(slot, action) {
    return action === 'remove'
      ? slot.querySelector('.slot-remove-btn')
      : slot.querySelector(`.slot-move-btn[data-direction="${action}"]`);
  }

  function buildQuickActions() {
    const quick = document.createElement('div');
    quick.className = 'ra-quick';
    const actions = document.createElement('div');
    actions.className = 'ra-quick-actions';
    actions.setAttribute('role', 'group');
    actions.setAttribute('aria-label', 'Stop actions');
    ['up', 'down', 'remove'].forEach((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ra-quick-btn${action === 'remove' ? ' is-danger' : ''}`;
      button.dataset.raQuickAction = action;
      button.title = QUICK_LABELS[action].replace(' stop', '');
      button.setAttribute('aria-label', QUICK_LABELS[action]);
      button.innerHTML = ICONS[action];
      actions.append(button);
    });
    const chevron = document.createElement('button');
    chevron.type = 'button';
    chevron.className = 'ra-quick-chevron';
    chevron.setAttribute('aria-label', 'Show stop actions');
    chevron.setAttribute('aria-expanded', 'false');
    chevron.innerHTML = ICONS.chevron;
    // row-reverse keeps the chevron at the right edge; the actions open to its left.
    quick.append(chevron, actions);
    quick.addEventListener('dragstart', (event) => { event.preventDefault(); event.stopPropagation(); });
    quick.addEventListener('mousedown', (event) => event.stopPropagation());
    return quick;
  }

  function syncQuickActions(slot) {
    const quick = slot.querySelector('.ra-quick');
    if (!quick) return;
    quick.querySelectorAll('[data-ra-quick-action]').forEach((button) => {
      const native = nativeControl(slot, button.dataset.raQuickAction);
      const disabled = !native || native.disabled;
      if (button.disabled !== disabled) button.disabled = disabled;
    });
    const open = Boolean(quickCustomer) && slot.dataset.customerId === quickCustomer;
    slot.classList.toggle('ra-quick-open', open);
    quick.querySelector('.ra-quick-chevron')?.setAttribute('aria-expanded', String(open));
  }

  function setQuick(customer) {
    quickCustomer = customer || null;
    document.querySelectorAll('#routePanel .route-slot.filled').forEach(syncQuickActions);
  }

  function runQuickAction(button) {
    const slot = button.closest('.route-slot');
    const action = button.dataset.raQuickAction;
    const native = slot && nativeControl(slot, action);
    if (!native || native.disabled) return;
    const customer = slot.dataset.customerId;
    if (customer === openCustomer) closeStop(false);
    // Keep the moved stop's actions open so it can be moved again; a removed stop leaves the route.
    quickCustomer = action === 'remove' ? null : customer;
    pendingQuickFocus = action === 'remove' ? null : { customer, action };
    native.click();
    schedule();
  }

  function enhanceSlots() {
    document.querySelectorAll('#routePanel .route-slot.filled').forEach((slot) => {
      const label = slot.querySelector('.slot-content');
      if (!label) return;
      if (!slot.querySelector('.ra-stop-toggle')) {
        const fullLabel = label.textContent;
        const separator = fullLabel.indexOf(' - ');
        const name = document.createElement('span');
        name.className = 'ra-stop-name';
        name.textContent = separator < 0 ? fullLabel : fullLabel.slice(0, separator);
        const address = document.createElement('span');
        address.className = 'ra-stop-address';
        address.textContent = separator < 0 ? '' : fullLabel.slice(separator + 3);
        label.replaceChildren(name, address);
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'ra-stop-toggle';
        toggle.title = fullLabel;
        toggle.setAttribute('aria-expanded', 'false');
        label.replaceWith(toggle);
        toggle.append(label);
        const stay = document.createElement('span');
        stay.className = 'ra-stay-summary';
        toggle.append(stay);
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'ra-close-stop';
        close.textContent = 'Done';
        close.setAttribute('aria-label', 'Close stop details');
        slot.querySelector('.slot-layout').append(close);
        slot.querySelector('.slot-remove-btn')?.setAttribute('aria-label', 'Remove stop from route');
        // Native route controls and their listeners stay on the original nodes.
        slot.querySelectorAll('.ra-stop-toggle, .ra-close-stop').forEach((button) => {
          button.addEventListener('dragstart', (event) => { event.preventDefault(); event.stopPropagation(); });
        });
      }
      const select = slot.querySelector('.slot-stay-select');
      const custom = slot.querySelector('.slot-stay-custom');
      const stayLabel = select?.value === 'custom' ? `${custom?.value || ''} min` : select?.selectedOptions[0]?.textContent;
      const summary = slot.querySelector('.ra-stay-summary');
      const text = `Stay ${stayLabel || ''}`.trim();
      if (summary.textContent !== text) summary.textContent = text;
      if (!slot.querySelector('.ra-quick')) slot.append(buildQuickActions());
      syncQuickActions(slot);
      if (slot.dataset.customerId === openCustomer) presentOpenStop(slot);
      else {
        slot.classList.remove('ra-detail-open');
        slot.removeAttribute('role');
        slot.removeAttribute('aria-modal');
        slot.removeAttribute('aria-label');
      }
    });
    if (openCustomer && ![...document.querySelectorAll('#routePanel .route-slot.filled')].some((slot) => slot.dataset.customerId === openCustomer)) closeStop(false);
    if (quickCustomer && ![...document.querySelectorAll('#routePanel .route-slot.filled')].some((slot) => slot.dataset.customerId === quickCustomer)) quickCustomer = null;
    if (pendingQuickFocus) {
      const slot = [...document.querySelectorAll('#routePanel .route-slot.filled')].find((node) => node.dataset.customerId === pendingQuickFocus.customer);
      const keyboard = document.activeElement === document.body || !document.activeElement?.isConnected;
      if (slot && keyboard) {
        const same = slot.querySelector(`[data-ra-quick-action="${pendingQuickFocus.action}"]`);
        const target = same && !same.disabled ? same : slot.querySelector('[data-ra-quick-action]:not(:disabled)');
        target?.focus({ preventScroll: true });
      }
      if (slot) pendingQuickFocus = null;
    }
    document.querySelectorAll('#routesSection .route-slots-container').forEach((container) => {
      const empty = container.querySelectorAll('.route-slot.empty');
      let toggle = container.parentElement.querySelector('.ra-empty-toggle');
      if (!toggle) {
        toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'ra-empty-toggle';
        toggle.setAttribute('aria-expanded', 'false');
        container.after(toggle);
      }
      toggle.hidden = empty.length === 0;
      const text = `${container.classList.contains('ra-show-empty') ? 'Hide' : 'Show'} available slots (${empty.length})`;
      if (toggle.textContent !== text) toggle.textContent = text;
    });
  }

  function groups() {
    const list = [];
    const unassigned = $('unassignedSection');
    if (unassigned) {
      const count = document.querySelectorAll('#unassignedStopsList .draggable-item').length;
      unassigned.dataset.raKey = 'unassigned';
      list.push({ key: 'unassigned', label: `Unassigned (${count})`, count, node: unassigned });
    }
    document.querySelectorAll('#routesSection > *').forEach((section, index) => {
      const header = section.querySelector('.route-header');
      if (!header) return;
      const count = section.querySelectorAll('.route-slot.filled').length;
      const match = /Route Group\s+(\d+)/i.exec(header.textContent || '');
      const number = match ? match[1] : String(index + 1);
      section.dataset.raKey = `route-${number}`;
      list.push({ key: `route-${number}`, label: `Route ${number} (${count})`, count, node: section });
    });
    return list;
  }

  function renderChips(list) {
    const box = $('raChips');
    if (!box) return;
    const stops = list.reduce((sum, group) => sum + group.count, 0);
    const unassigned = list.find((group) => group.key === 'unassigned')?.count || 0;
    const status = $('raAssignmentStatus');
    if (status) status.textContent = `${stops - unassigned} / ${stops} assigned`;
    const routes = list.filter((group) => group.key !== 'unassigned').length;
    const summary = document.querySelector('#manualLtaOptions [data-lorry-summary-text]')?.textContent || '';
    const codes = /(\d+)\s+codes?/i.exec(summary);
    const chips = [
      ['check', `${stops} stop${stops === 1 ? '' : 's'} selected`, ''],
      ['alert', codes ? `Restrictions: ${codes[1]}` : 'Restrictions: off', codes && codes[1] !== '0' ? 'is-amber' : 'is-grey'],
      ['routes', `Route groups: ${routes}`, 'is-violet']
    ];
    box.replaceChildren(...chips.map(([icon, text, tone]) => {
      const chip = document.createElement('span');
      chip.className = `ra-chip ${tone}`.trim();
      const mark = document.createElement('i');
      mark.className = 'ui-icon';
      mark.dataset.icon = icon;
      mark.setAttribute('aria-hidden', 'true');
      chip.append(mark, document.createTextNode(text));
      return chip;
    }));
  }

  function renderTabs(list) {
    const tabs = $('raTabs');
    const panel = $('routePanel');
    if (!tabs || !panel) return;
    // Default: the first route; Unassigned when stops are waiting there.
    if (!list.some((group) => group.key === activeKey)) {
      const unassigned = list.find((group) => group.key === 'unassigned');
      activeKey = unassigned && unassigned.count ? 'unassigned' : (list.find((group) => group.key !== 'unassigned') || list[0])?.key || null;
    }
    tabs.replaceChildren(...list.map((group) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.dataset.raTab = group.key;
      tab.setAttribute('aria-selected', String(group.key === activeKey));
      tab.textContent = group.label;
      return tab;
    }));
    panel.dataset.raTab = activeKey || '';
    list.forEach((group) => group.node.classList.toggle('ra-active', group.key === activeKey));
    const picker = $('raGroupSelect');
    if (picker) {
      const signature = list.map((group) => `${group.key}:${group.count}`).join('|');
      if (picker.dataset.signature !== signature) {
        picker.replaceChildren(...list.map((group) => new Option(group.label, group.key)));
        picker.dataset.signature = signature;
      }
      picker.value = activeKey || '';
    }
    global.dispatchEvent(new CustomEvent('goroutex:review-group', { detail: { key: activeKey } }));
  }

  function refresh() {
    scheduled = false;
    if (pageRoot && !pageRoot.isConnected) return;
    const list = groups();
    if (openCustomer) {
      const slot = [...document.querySelectorAll('#routePanel .route-slot.filled')].find((node) => node.dataset.customerId === openCustomer);
      const owner = list.find((group) => slot && group.node.contains(slot));
      if (owner) activeKey = owner.key;
    }
    renderChips(list);
    renderTabs(list);
    enhanceSlots();
    const message = $('messageBar');
    if (message) message.classList.toggle('ra-default-notice', message.textContent.trim() === defaultNotice);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    (global.requestAnimationFrame || setTimeout)(refresh);
  }

  function init() {
    const page = $('page-manual-assign');
    if (!page || page.dataset.raInit === 'true') return;
    pageRoot = page;
    page.dataset.raInit = 'true';
    page.dataset.raView = 'stops';
    const shade = document.createElement('button');
    shade.id = 'raSheetShade';
    shade.type = 'button';
    shade.hidden = true;
    shade.tabIndex = -1;
    shade.setAttribute('aria-label', 'Close stop details');
    shade.addEventListener('click', () => closeStop());
    page.append(shade);
    document.querySelectorAll('.ra-view-switch [data-ra-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.raView)));
    const settings = $('raSettingsDialog');
    $('raSettingsBtn')?.addEventListener('click', () => { closeStop(); settings.showModal(); });
    settings?.querySelector('[data-ra-close-settings]')?.addEventListener('click', () => settings.close());
    settings?.addEventListener('click', (event) => {
      if (event.target !== settings) return;
      const rect = settings.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) settings.close();
    });
    $('startMapDetourBtn')?.addEventListener('click', () => { settings.close(); setView('map'); });
    $('raMoreActions')?.addEventListener('click', (event) => {
      if (event.target.closest('button')) $('raMoreActions').open = false;
    });
    $('retrieveStopsBtn')?.addEventListener('click', () => {
      global.requestAnimationFrame(() => { activeKey = 'unassigned'; setView('stops'); refresh(); });
    });
    $('raGroupSelect')?.addEventListener('change', (event) => { closeStop(false); activeKey = event.target.value; refresh(); });
    global.addEventListener('goroutex:map-group', (event) => {
      if (!groups().some((group) => group.key === event.detail.key)) return;
      closeStop(false); activeKey = event.detail.key; refresh();
    });
    // Keep the original action nodes and listeners; expose them in the wide toolbar.
    const more = $('raMoreActions');
    const actionMenu = more.querySelector('.ra-more-menu');
    const actionButtons = [...actionMenu.children];
    const placeActions = () => {
      actionButtons.forEach((button) => phone() ? actionMenu.append(button) : more.before(button));
      more.hidden = !phone();
    };
    placeActions();
    global.addEventListener('resize', placeActions);
    $('raReorderBtn')?.addEventListener('click', () => {
      closeStop();
      const on = page.dataset.raReorder !== 'true';
      page.dataset.raReorder = String(on);
      $('raReorderBtn').setAttribute('aria-pressed', String(on));
      $('raReorderBtn').textContent = on ? 'Done reordering' : 'Reorder';
      $('raReorderHint').hidden = !on;
    });
    $('raExpandMapBtn')?.addEventListener('click', () => {
      const on = page.dataset.raMapExpanded !== 'true';
      page.dataset.raMapExpanded = String(on);
      $('raExpandMapBtn').setAttribute('aria-expanded', String(on));
      $('raExpandMapBtn').textContent = on ? 'Close expanded map' : 'Expand map';
      resizeMap(true);
    });
    $('routePanel')?.addEventListener('click', (event) => {
      const quickButton = event.target.closest('[data-ra-quick-action]');
      if (quickButton) { event.preventDefault(); event.stopPropagation(); return runQuickAction(quickButton); }
      const chevron = event.target.closest('.ra-quick-chevron');
      if (chevron) {
        event.preventDefault(); event.stopPropagation();
        const customer = chevron.closest('.route-slot')?.dataset.customerId;
        return setQuick(customer === quickCustomer ? null : customer);
      }
      if (event.target.closest('.ra-close-stop')) return closeStop();
      const toggle = event.target.closest('.ra-stop-toggle');
      if (toggle) return openStop(toggle.closest('.route-slot'));
      const empty = event.target.closest('.ra-empty-toggle');
      if (empty) {
        const container = empty.previousElementSibling;
        const on = container.classList.toggle('ra-show-empty');
        empty.setAttribute('aria-expanded', String(on));
        schedule();
      }
    });
    $('routePanel')?.addEventListener('change', schedule);
    // Expose all ORIGINAL drop targets while sorting/dragging, including other groups.
    page.addEventListener('dragstart', (event) => {
      if (event.target.matches('.route-slot.filled, .draggable-item')) page.dataset.raDragging = 'true';
    });
    const endDrag = () => { delete page.dataset.raDragging; };
    page.addEventListener('dragend', endDrag, true);
    page.addEventListener('drop', endDrag, true);
    document.addEventListener('pointerdown', (event) => {
      if (quickCustomer && !event.target.closest?.('.ra-quick')) setQuick(null);
      const more = $('raMoreActions');
      if (more.open && !more.contains(event.target)) more.open = false;
    });
    document.addEventListener('keydown', (event) => {
      if (!page.classList.contains('active-page')) return;
      if (event.key === 'Escape') {
        if (quickCustomer) setQuick(null);
        if (openCustomer) { event.preventDefault(); closeStop(); }
        if (page.dataset.raMapExpanded === 'true') $('raExpandMapBtn').click();
        $('raMoreActions').open = false;
      }
      if (event.key === 'Tab' && page.dataset.raSheet === 'open') {
        const slot = page.querySelector('.ra-detail-open');
        const controls = [...slot.querySelectorAll('button:not(:disabled), select, input:not([hidden])')].filter((node) => node.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || !slot.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !slot.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
    });
    global.addEventListener('resize', () => {
      if (phone() && page.dataset.raMapExpanded === 'true') {
        page.dataset.raMapExpanded = 'false';
        $('raExpandMapBtn').setAttribute('aria-expanded', 'false');
        $('raExpandMapBtn').textContent = 'Expand map';
      }
      if (openCustomer) refresh();
      resizeMap();
    });
    $('raTabs')?.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-ra-tab]');
      if (!tab) return;
      closeStop(false);
      quickCustomer = null;
      activeKey = tab.dataset.raTab;
      refresh();
      $('raTabs').querySelector(`[data-ra-tab="${activeKey}"]`)?.focus({ preventScroll: true });
    });
    if (typeof MutationObserver === 'function') {
      const observer = new MutationObserver(schedule);
      ['stop-assignment-lists-container', 'manualLtaOptions', 'messageBar'].forEach((id) => {
        const node = $(id);
        if (node) observer.observe(node, { childList: true, subtree: true, characterData: true });
      });
      new MutationObserver(() => {
        if (page.classList.contains('active-page')) { schedule(); resizeMap(); }
        else { closeStop(false); settings?.close(); delete page.dataset.raMapExpanded; }
      }).observe(page, { attributes: true, attributeFilter: ['class'] });
    }
    refresh();
  }

  global.GoRouteXReviewAssignUi = { refresh, init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
