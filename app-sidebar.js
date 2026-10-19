/**
 * Shared primary navigation for the three independent pages: Dashboard (app.html), Order Hub and Dispatch.
 *
 * Usage: <aside class="operations-sidebar" data-app-sidebar data-active="dashboard|order-hub|dispatch"></aside>
 *        <script src="app-sidebar.js"></script>
 * Optional: data-mobile-nav="top" also renders a compact top bar for narrow screens (pages without their own
 * mobile navigation). The active item comes from markup, so it survives direct navigation and refresh.
 *
 * Route planning is a Dashboard workflow, so planning steps keep Dashboard active (see setActive).
 * Exposes window.GoRouteXSidebar = { setActive, setAccount, setLogoutHandler }.
 */
(function (global) {
  // 24px line icons (Lucide-style paths), decorative only: every link keeps its text label.
  const ICONS = {
    dashboard: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    'order-hub': '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    dispatch: '<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    account: '<path d="M4 18h16"/><path d="M4 18l-1-10 5 4 4-6 4 6 5-4-1 10"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    gps: '<circle cx="12" cy="10" r="3"/><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/>',
    driver: '<circle cx="12" cy="10" r="3"/><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'
  };
  const icon = (key) => `<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[key] || ''}</svg>`;

  const PRIMARY = [
    { key: 'dashboard', label: 'PlanEngine', short: 'PlanEngine', href: 'app.html#page-history-dashboard', page: 'page-history-dashboard' },
    { key: 'order-hub', label: 'Order Hub', short: 'Orders', href: 'order-hub.html' },
    { key: 'dispatch', label: 'Dispatch', short: 'Dispatch', href: 'dispatch.html' }
  ];
  const ACCOUNT_LINKS = [
    { key: 'account', label: 'Plan &amp; Access', href: 'app.html#page-account-access', page: 'page-account-access' },
    { key: 'settings', label: 'Settings', href: 'settings.html' }
  ];
  let logoutHandler = null;

  function onAppShell() {
    return typeof global.showPage === 'function' && !!document.getElementById('appRoot');
  }

  function link(item, active, extraClass = '', label = item.label) {
    const current = item.key === active ? ' aria-current="page"' : '';
    const page = item.page ? ` data-page="${item.page}"` : '';
    return `<a href="${item.href}" data-nav="${item.key}"${page}${current} class="${extraClass}">${icon(item.key)}<span class="nav-label">${label}</span></a>`;
  }

  function render(root) {
    const active = root.dataset.active || 'dashboard';
    root.setAttribute('aria-label', 'Workspace navigation');
    root.innerHTML = `
      <a class="operations-brand" href="app.html#page-history-dashboard" data-nav="brand" aria-label="GoRouteX dashboard">GoRoute<span>X</span></a>
      <nav id="desktopAppNav" class="operations-nav" aria-label="Primary navigation">
        ${PRIMARY.map((item) => link(item, active, item.key === 'dashboard' ? 'is-dashboard' : '')).join('')}
      </nav>
      <div class="operations-sidebar-account">
        <div class="operations-sidebar-user"><span class="operations-avatar" id="sidebarAvatar" aria-hidden="true">·</span><div><strong id="sidebarDisplayName">Loading account…</strong>
        <span id="sidebarCurrentPlan">Loading plan…</span></div></div>
        ${ACCOUNT_LINKS.map((item) => link(item, active)).join('')}
        <button type="button" id="sidebarLogoutBtn" class="operations-logout">${icon('logout')}<span class="nav-label">Logout</span></button>
      </div>`;
    if (root.dataset.mobileNav === 'top') renderMobileBar(root, active);
  }

  // Narrow screens: a slim top bar (brand) and a bottom tab bar (PlanEngine, Orders, Dispatch, More).
  function renderMobileBar(root, active) {
    if (document.querySelector('.app-mobile-nav')) return;
    const bar = document.createElement('nav');
    bar.className = 'app-mobile-nav';
    bar.setAttribute('aria-label', 'Workspace navigation');
    bar.innerHTML = `<a class="app-mobile-nav-brand" href="app.html#page-history-dashboard" data-nav="brand">GoRoute<span>X</span></a>
      <div class="app-mobile-nav-links">${PRIMARY.map((item) => link(item, active, 'app-tab', item.short)).join('')}
      <button type="button" class="app-tab" data-nav="more" aria-haspopup="true" aria-expanded="false">${icon('more')}<span class="nav-label">More</span></button></div>`;
    root.insertAdjacentElement('afterend', bar);
    document.body.classList.add('has-app-tabbar');
  }

  // "More" sheet shared by the bottom tab bars (this one and app.html's): Plan & Access, Settings, Logout.
  function toggleMore(trigger, extra = []) {
    let sheet = document.getElementById('appMoreSheet');
    if (sheet && !sheet.hidden) { closeMore(); return; }
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.id = 'appMoreSheet';
      sheet.className = 'app-more-sheet';
      sheet.setAttribute('role', 'menu');
      document.body.append(sheet);
    }
    const active = document.querySelector('[data-app-sidebar]')?.dataset.active || '';
    sheet.innerHTML = extra.concat(ACCOUNT_LINKS).map((item) => link(item, active, 'app-more-item'))
      .concat(`<button type="button" class="app-more-item operations-logout" data-nav="logout">${icon('logout')}<span class="nav-label">Logout</span></button>`).join('');
    sheet.hidden = false;
    trigger?.setAttribute('aria-expanded', 'true');
    sheet.querySelector('a, button')?.focus();
  }
  function closeMore() {
    const sheet = document.getElementById('appMoreSheet');
    if (sheet) sheet.hidden = true;
    document.querySelectorAll('[data-nav="more"]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  }

  function isBlocked(anchor) {
    return anchor.getAttribute('aria-disabled') === 'true';
  }

  async function defaultLogout() {
    try {
      if (global.FirebaseApp?.auth?.signOut) await global.FirebaseApp.auth.signOut();
      else if (global.firebase?.auth) await global.firebase.auth().signOut();
    } catch (error) {
      console.warn('Sign out failed:', error);
    }
    global.location.href = 'login.html';
  }

  function logout() {
    if (logoutHandler) return logoutHandler();
    if (typeof global.logout === 'function') return global.logout();
    return defaultLogout();
  }

  function handleClick(event) {
    const target = event.target.closest('[data-nav], .operations-logout');
    if (!event.target.closest('#appMoreSheet, [data-nav="more"]')) closeMore();
    if (!target) return;
    if (target.dataset.nav === 'more') {
      event.preventDefault();
      // app.html adds its own pages (e.g. GPS tracking) to the sheet through data-more-pages.
      const extra = target.dataset.morePages ? JSON.parse(target.dataset.morePages) : [];
      toggleMore(target, extra);
      return;
    }
    if (target.closest('#appMoreSheet')) closeMore();
    if (target.classList.contains('operations-logout') || target.dataset.nav === 'logout') {
      event.preventDefault();
      logout();
      return;
    }
    if (isBlocked(target)) {
      event.preventDefault();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return; // let "open in new tab" work
    if (!onAppShell()) return;
    // Inside app.html, switch pages in place instead of reloading the shell.
    if (target.dataset.page) {
      event.preventDefault();
      global.showPage(target.dataset.page);
    } else if (target.dataset.nav === 'brand') {
      event.preventDefault();
      global.showPage('page-history-dashboard');
    } else if (target.dataset.nav === 'dispatch' && typeof global.openDispatchPage === 'function') {
      event.preventDefault();
      global.openDispatchPage();
    }
  }

  function setActive(key) {
    document.querySelectorAll('[data-app-sidebar] [data-nav], .app-mobile-nav [data-nav]').forEach((anchor) => {
      if (anchor.dataset.nav === 'more') return;
      const isActive = anchor.dataset.nav === key;
      anchor.classList.toggle('is-active', isActive);
      if (isActive) anchor.setAttribute('aria-current', 'page');
      else anchor.removeAttribute('aria-current');
    });
  }

  function setAccount({ name, plan } = {}) {
    const nameEl = document.getElementById('sidebarDisplayName');
    const planEl = document.getElementById('sidebarCurrentPlan');
    const avatar = document.getElementById('sidebarAvatar');
    if (avatar && name) avatar.textContent = String(name).trim().slice(0, 1).toUpperCase();
    if (nameEl && name) nameEl.textContent = name;
    if (planEl && plan) planEl.textContent = plan;
  }

  function mount() {
    document.querySelectorAll('[data-app-sidebar]').forEach((root) => {
      if (root.dataset.rendered === 'true') return;
      render(root);
      root.dataset.rendered = 'true';
    });
    // Pages write the account name straight into the sidebar; keep the avatar initial in step.
    const nameEl = document.getElementById('sidebarDisplayName');
    const avatar = document.getElementById('sidebarAvatar');
    if (nameEl && avatar && typeof MutationObserver === 'function' && !nameEl.dataset.avatarWatch) {
      nameEl.dataset.avatarWatch = 'true';
      const sync = () => { const text = String(nameEl.textContent || '').trim(); avatar.textContent = !text || /unavailable|^loading/i.test(text) ? '·' : text.slice(0, 1).toUpperCase(); };
      new MutationObserver(sync).observe(nameEl, { childList: true, characterData: true, subtree: true });
      sync();
    }
  }

  global.GoRouteXSidebar = {
    setActive,
    setAccount,
    setLogoutHandler(handler) { logoutHandler = typeof handler === 'function' ? handler : null; },
    icon,
    mount
  };
  // Render immediately when the script follows the placeholder; also cover deferred loading.
  mount();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  document.addEventListener('click', handleClick);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMore(); });
})(window);
