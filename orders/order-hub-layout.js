/** Presentation only: the original mapping, preview inputs and delegated handlers stay in place. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const phone = () => matchMedia('(max-width: 760px)').matches;
  const make = (tag, className, value) => {
    const node = document.createElement(tag); node.className = className;
    if (value !== undefined) node.textContent = value;
    if (tag === 'button') node.type = 'button'; return node;
  };
  const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  let forcedFile = false, openId = null, filter = 'all', scheduled = false, active = false, beforeOpen = null;
  let focusAfterRender = null, pendingFocus = false;
  function step() { return forcedFile ? 'file' : !$('preview-stage').hidden ? 'review' : !$('mapping-stage').hidden ? 'mapping' : 'file'; }
  function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(refresh); } }
  function groupMapping() {
    const grid = $('mapping-grid');
    let used = grid.querySelector('.oh-used-columns'), ignored = grid.querySelector('.oh-ignored-columns');
    if (!used) {
      used = make('div', 'oh-used-columns');
      ignored = make('details', 'oh-ignored-columns');
      ignored.append(make('summary', '', 'Ignored columns'), make('div', 'oh-ignored-list'));
      grid.append(used, ignored);
    }
    const ignoredList = ignored.querySelector('div');
    grid.querySelectorAll('select[data-mapping-index]').forEach((select) => {
      const label = select.closest('label'), destination = select.value ? used : ignoredList;
      if (label.parentElement !== destination) destination.append(label);
      if (!label.querySelector('.oh-map-arrow')) label.querySelector('span')?.after(make('span', 'oh-map-arrow', '→'));
    });
    // Native indexes remain the source of truth; reordering labels never edits their values.
    [used, ignoredList].forEach((group) => {
      const labels = [...group.children].sort((a, b) => Number(a.querySelector('select').dataset.mappingIndex) - Number(b.querySelector('select').dataset.mappingIndex));
      if (!labels.every((label, index) => group.children[index] === label)) labels.forEach((label) => group.append(label));
    });
    const count = ignoredList.children.length;
    setText(ignored.querySelector('summary'), `Ignored columns (${count})`); if (ignored.hidden !== (count === 0)) ignored.hidden = count === 0;
  }
  function closeDetail(restore = true) {
    const previousRow = currentRow();
    openId = null; $('import-panel').removeAttribute('data-order-detail');
    $('preview-body').querySelectorAll('.oh-preview-open').forEach((row) => {
      row.classList.remove('oh-preview-open'); row.removeAttribute('role'); row.removeAttribute('aria-modal'); row.removeAttribute('aria-label');
      row.querySelector('.oh-preview-view')?.setAttribute('aria-expanded', 'false');
    });
    const target = beforeOpen?.isConnected ? beforeOpen : previousRow?.querySelector('.oh-preview-view');
    if (restore) target?.focus({ preventScroll: true });
    beforeOpen = null;
  }
  function currentRow() { return [...$('preview-body').rows].find((row) => row.querySelector('[data-preview-id]')?.dataset.previewId === openId); }
  function openDetail(row) {
    closeDetail(false); openId = row.querySelector('[data-preview-id]').dataset.previewId;
    beforeOpen = row.querySelector('.oh-preview-view'); pendingFocus = true; decoratePreview();
  }
  function decoratePreview() {
    const rows = [...$('preview-body').rows];
    let visible = 0, attention = 0;
    rows.forEach((row) => {
      const cells = [...row.cells], checkbox = row.querySelector('[data-preview-id]');
      if (cells.length !== 7 || !checkbox) return;
      const needsReview = !cells[5].querySelector('.badge.ready');
      if (needsReview) attention++;
      const excluded = filter === 'review' && !needsReview;
      row.classList.toggle('oh-preview-filtered', excluded); if (!excluded) visible++;
      if (!row.querySelector('.oh-preview-view')) {
        cells.forEach((cell, index) => cell.dataset.label = ['Source row', 'Order', 'Customer', 'Delivery stop', 'Contact', 'Status / issue', 'Include'][index]);
        const rowHeading = make('div', 'oh-detail-heading');
        const back = make('button', 'secondary oh-detail-done', 'Done');
        rowHeading.append(make('strong', '', `Order ${cells[1].textContent}`), back); cells[0].prepend(rowHeading);
        const address = make('p', 'oh-preview-address');
        cells[2].append(address);
        const view = make('button', 'oh-preview-view secondary', 'Review details');
        view.setAttribute('aria-expanded', 'false'); cells[1].append(view);
        const include = make('label', 'oh-preview-include');
        // The original checkbox stays in the original tbody, preserving its handler and disabled state.
        checkbox.replaceWith(include); include.append(checkbox, document.createTextNode('Include'));
      }
      const stop = cells[3].querySelector('select');
      const address = stop ? (stop.value ? stop.selectedOptions[0]?.textContent : 'Delivery stop needed') : cells[3].querySelector('.resolution > span')?.textContent || 'Delivery stop needed';
      setText(cells[2].querySelector('.oh-preview-address'), address);
      row.querySelectorAll('[data-resolution]').forEach((select) => {
        let full = select.nextElementSibling;
        if (!full?.classList.contains('oh-resolution-value')) { full = make('p', 'oh-resolution-value'); select.after(full); }
        setText(full, select.value ? select.selectedOptions[0]?.textContent || '' : 'Choose an option above.');
      });
      row.classList.toggle('oh-preview-open', phone() && checkbox.dataset.previewId === openId);
      if (row.classList.contains('oh-preview-open')) {
        row.classList.remove('oh-preview-filtered');
        row.setAttribute('role', 'dialog'); row.setAttribute('aria-modal', 'true');
        row.setAttribute('aria-label', `Review order ${cells[1].firstChild?.textContent || ''}`);
        row.querySelector('.oh-preview-view').setAttribute('aria-expanded', 'true');
        $('import-panel').dataset.orderDetail = 'open';
        if (pendingFocus) { pendingFocus = false; row.querySelector('.oh-detail-done').focus({ preventScroll: true }); }
      }
    });
    if (openId && !currentRow()) closeDetail(false);
    setText($('oh-visible-count'), `${visible} shown on this page`);
    setText(document.querySelector('[data-preview-filter="review"]'), `Needs review (${attention})`);
    if (focusAfterRender && openId) {
      const row = currentRow();
      row?.querySelector(`[data-resolution="${focusAfterRender}"]`)?.focus({ preventScroll: true }); focusAfterRender = null;
    }
  }
  function notice() {
    const original = $('notice'), mirror = $('oh-import-notice');
    const visible = !original.hidden && original.textContent.trim();
    if (mirror.hidden !== !visible) mirror.hidden = !visible; mirror.classList.toggle('error', original.classList.contains('error'));
    let message = mirror.querySelector('.oh-notice-text');
    if (!message) { message = make('span', 'oh-notice-text'); mirror.append(message); }
    setText(message, original.textContent);
    const originals = [...original.querySelectorAll('button')];
    const signature = originals.map((b) => b.textContent).join('|');
    if (mirror.dataset.actions !== signature) {
      mirror.querySelectorAll('button').forEach((b) => b.remove());
      originals.forEach((button) => { const action = make('button', 'quiet', button.textContent); action.addEventListener('click', () => button.click()); mirror.append(action); });
      mirror.dataset.actions = signature;
    }
  }
  function refresh() {
    scheduled = false;
    const panel = $('import-panel'), isOpen = !panel.hidden && !$('workspace').hidden && phone();
    if (isOpen && !active) { active = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Import orders'); }
    if (!isOpen && active) { active = false; closeDetail(false); panel.removeAttribute('role'); panel.removeAttribute('aria-modal'); panel.removeAttribute('aria-label'); }
    document.body.classList.toggle('oh-import-active', isOpen);
    panel.dataset.importStep = step();
    document.querySelectorAll('button[data-import-step]').forEach((button) => {
      const key = button.dataset.importStep;
      button.disabled = $('close-import').disabled || (key === 'mapping' ? $('mapping-stage').hidden : key === 'review' ? $('preview-stage').hidden : false);
      if (key === step()) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    });
    groupMapping(); decoratePreview(); notice();
  }
  function init() {
    const panel = $('import-panel'); if (!panel) return;
    panel.addEventListener('click', (event) => {
      const stepButton = event.target.closest('button[data-import-step]');
      if (stepButton) {
        if (stepButton.dataset.importStep === 'file') { forcedFile = true; closeDetail(false); }
        else if (stepButton.dataset.importStep === 'mapping') { forcedFile = false; $('back-mapping').click(); }
        else forcedFile = false;
        schedule();
      }
      const view = event.target.closest('.oh-preview-view');
      if (view && phone()) openDetail(view.closest('tr'));
      if (event.target.closest('.oh-detail-done')) closeDetail();
    });
    $('oh-source-back').addEventListener('click', () => { forcedFile = true; schedule(); });
    $('open-import').addEventListener('click', () => { forcedFile = false; schedule(); if (phone()) requestAnimationFrame(() => $('close-import').focus({ preventScroll: true })); });
    $('close-import').addEventListener('click', () => { closeDetail(false); forcedFile = false; schedule(); $('open-import').focus({ preventScroll: true }); });
    $('file-input').addEventListener('change', () => { forcedFile = false; schedule(); });
    $('parse-paste').addEventListener('click', () => { forcedFile = false; schedule(); });
    $('preview-import').addEventListener('click', () => { forcedFile = false; filter = 'all'; document.querySelectorAll('[data-preview-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.previewFilter === 'all'))); closeDetail(false); schedule(); });
    $('back-mapping').addEventListener('click', () => { forcedFile = false; closeDetail(false); schedule(); });
    $('mapping-grid').addEventListener('change', () => { forcedFile = false; schedule(); });
    $('preview-body').addEventListener('change', (event) => { if (openId && event.target.dataset.resolution) focusAfterRender = event.target.dataset.resolution; schedule(); }, true);
    document.querySelectorAll('[data-preview-filter]').forEach((button) => button.addEventListener('click', () => {
      closeDetail(false); filter = button.dataset.previewFilter;
      document.querySelectorAll('[data-preview-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === button))); decoratePreview();
    }));
    document.addEventListener('keydown', (event) => {
      if (!active) return;
      if (event.key === 'Escape') { event.preventDefault(); if (openId) closeDetail(); else $('close-import').click(); }
      if (event.key === 'Tab') {
        const scope = currentRow() || panel;
        const controls = [...scope.querySelectorAll('button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea, summary')].filter((n) => n.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || !scope.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !scope.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
    });
    // Observe native renders, not our classes/text, to avoid feedback loops.
    new MutationObserver(schedule).observe(panel, { attributes: true, attributeFilter: ['hidden'], subtree: true });
    new MutationObserver(schedule).observe($('mapping-grid'), { childList: true });
    new MutationObserver(schedule).observe($('preview-body'), { childList: true });
    new MutationObserver(schedule).observe($('notice'), { childList: true, characterData: true, attributes: true, subtree: true });
    new MutationObserver(schedule).observe($('workspace'), { attributes: true, attributeFilter: ['hidden'] });
    addEventListener('resize', schedule); refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
