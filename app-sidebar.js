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
  const PRIMARY = [
    { key: 'dashboard', label: 'Dashboard', href: 'app.html#page-history-dashboard', page: 'page-history-dashboard' },
    { key: 'order-hub', label: 'Order Hub', href: 'order-hub.html' },
    { key: 'dispatch', label: 'Dispatch', href: 'dispatch.html' }
  ];
  const ACCOUNT_LINKS = [
    { key: 'account', label: 'Account', href: 'app.html#page-account-access', page: 'page-account-access' },
    { key: 'settings', label: 'Settings', href: 'settings.html' }
  ];
  let logoutHandler = null;

  function onAppShell() {
    return typeof global.showPage === 'function' && !!document.getElementById('appRoot');
  }

  function link(item, active, extraClass = '') {
    const current = item.key === active ? ' aria-current="page"' : '';
    const page = item.page ? ` data-page="${item.page}"` : '';
    return `<a href="${item.href}" data-nav="${item.key}"${page}${current} class="${extraClass}">${item.label}</a>`;
  }

  function render(root) {
    const active = root.dataset.active || 'dashboard';
    root.setAttribute('aria-label', 'Workspace navigation');
    root.innerHTML = `
      <a class="operations-brand" href="app.html#page-history-dashboard" data-nav="brand" aria-label="GoRouteX dashboard">GoRoute<span>X</span></a>
      <nav id="desktopAppNav" class="operations-nav" aria-label="Primary navigation">
        ${PRIMARY.map((item) => link(item, active, item.key === 'dashboard' ? 'is-dashboard' : '')).join('')}
        <a id="driverNavButton" href="driver-tracking.html" data-nav="driver" hidden>Driver Page</a>
      </nav>
      <div class="operations-sidebar-account">
        <strong id="sidebarDisplayName">Loading account…</strong>
        <span id="sidebarCurrentPlan">Loading plan…</span>
        ${ACCOUNT_LINKS.map((item) => link(item, active)).join('')}
        <button type="button" id="sidebarLogoutBtn" class="operations-logout">Logout</button>
      </div>`;
    if (root.dataset.mobileNav === 'top') renderMobileBar(root, active);
  }

  function renderMobileBar(root, active) {
    if (document.querySelector('.app-mobile-nav')) return;
    const bar = document.createElement('nav');
    bar.className = 'app-mobile-nav';
    bar.setAttribute('aria-label', 'Workspace navigation');
    bar.innerHTML = `<a class="app-mobile-nav-brand" href="app.html#page-history-dashboard" data-nav="brand">GoRoute<span>X</span></a>
      <div class="app-mobile-nav-links">${PRIMARY.concat(ACCOUNT_LINKS).map((item) => link(item, active)).join('')}
      <button type="button" class="operations-logout" data-nav="logout">Logout</button></div>`;
    root.insertAdjacentElement('afterend', bar);
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
    if (!target) return;
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
      const isActive = anchor.dataset.nav === key;
      anchor.classList.toggle('is-active', isActive);
      if (isActive) anchor.setAttribute('aria-current', 'page');
      else anchor.removeAttribute('aria-current');
    });
  }

  function setAccount({ name, plan } = {}) {
    const nameEl = document.getElementById('sidebarDisplayName');
    const planEl = document.getElementById('sidebarCurrentPlan');
    if (nameEl && name) nameEl.textContent = name;
    if (planEl && plan) planEl.textContent = plan;
  }

  function mount() {
    document.querySelectorAll('[data-app-sidebar]').forEach((root) => {
      if (root.dataset.rendered === 'true') return;
      render(root);
      root.dataset.rendered = 'true';
    });
  }

  global.GoRouteXSidebar = {
    setActive,
    setAccount,
    setLogoutHandler(handler) { logoutHandler = typeof handler === 'function' ? handler : null; },
    mount
  };
  // Render immediately when the script follows the placeholder; also cover deferred loading.
  mount();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  document.addEventListener('click', handleClick);
})(window);
