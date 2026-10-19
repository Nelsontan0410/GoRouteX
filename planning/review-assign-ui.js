/**
 * Review & Assign (page-manual-assign): presentation helpers added with the 2026-10 UI refresh.
 * - Status chips: stops selected, restriction codes, route groups (read from the page, never invented).
 * - Group tabs (Unassigned, Route 1, Route 2, ...) that show one group at a time on phones.
 * Read-only towards planning: it only reads the rendered lists and toggles data attributes / classes.
 * Loading this file registers no listeners until the DOM is ready; it makes no data or API requests.
 */
(function (global) {
  const $ = (id) => document.getElementById(id);
  let activeKey = null;
  let scheduled = false;

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
  }

  function refresh() {
    scheduled = false;
    const list = groups();
    renderChips(list);
    renderTabs(list);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    (global.requestAnimationFrame || setTimeout)(refresh);
  }

  function init() {
    const page = $('page-manual-assign');
    if (!page || page.dataset.raInit === 'true') return;
    page.dataset.raInit = 'true';
    $('raTabs')?.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-ra-tab]');
      if (!tab) return;
      activeKey = tab.dataset.raTab;
      refresh();
    });
    if (typeof MutationObserver === 'function') {
      const observer = new MutationObserver(schedule);
      ['stop-assignment-lists-container', 'manualLtaOptions'].forEach((id) => {
        const node = $(id);
        if (node) observer.observe(node, { childList: true, subtree: true, characterData: true });
      });
    }
    refresh();
  }

  global.GoRouteXReviewAssignUi = { refresh, init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
