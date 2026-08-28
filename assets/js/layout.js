(function (window) {
  'use strict';

  function initLayout(options = {}) {
    const requireAuth = options.requireAuth !== false;
    const allowedRoles = options.allowedRoles || null;

    const user = window.KaringApi.getStoredUser();

    if (requireAuth) {
      if (!user || !window.KaringApi.getToken()) {
        window.location.href = '/login.html';
        return;
      }

      if (allowedRoles && Array.isArray(allowedRoles) && !allowedRoles.includes(user.role)) {
        if (user.role === 'cashier' && !window.location.pathname.includes('pos_checkout')) {
          window.location.href = '/modules/pos/pos_checkout.html';
          return;
        }
      }
    }

    renderTopbar(user);
    renderSidebar(user);
    startClock();
  }

  function renderTopbar(user) {
    const topbarContainer = document.getElementById('appTopbar');
    if (!topbarContainer) return;

    const userName = user ? escapeHtml(user.name) : '';
    const topbarHtml = `
      <nav class="pos-topbar">
          <div class="topbar-brand-wrap">
              <button id="mobileMenuBtn" class="mobile-menu-btn" type="button" aria-label="Open navigation menu" aria-expanded="false" aria-controls="appSidebar">
                  <i class="bi bi-list" aria-hidden="true"></i>
              </button>
              <a class="topbar-brand-link" href="/index.html">
                  <span class="brand-mark">KE</span>
                  <span class="brand-name">Karing Enterprise</span>
              </a>
          </div>
          <div class="topbar-meta">
              <a href="/modules/pos/pos_checkout.html"><i class="bi bi-cart-check"></i> POS</a>
              <span><i class="bi bi-shop"></i> Main Branch</span>
              ${user ? `
                  <span><i class="bi bi-person-circle"></i> ${userName}</span>
                  <a href="#" id="logoutBtn"><i class="bi bi-box-arrow-right"></i> Logout</a>
              ` : ''}
              <span id="posClock"></span>
          </div>
      </nav>
    `;

    topbarContainer.innerHTML = topbarHtml;

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        window.KaringApi.logout();
      });
    }

    setupMobileMenuToggle();
  }

  function setupMobileMenuToggle() {
    const btn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('appSidebar');
    if (!btn || !sidebar) return;

    function openMenu() {
      btn.setAttribute('aria-expanded', 'true');
      btn.setAttribute('aria-label', 'Close navigation menu');
      btn.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';
      document.body.classList.add('mobile-nav-open');
    }

    function closeMenu() {
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-label', 'Open navigation menu');
      btn.innerHTML = '<i class="bi bi-list" aria-hidden="true"></i>';
      document.body.classList.remove('mobile-nav-open');
    }

    function toggleMenu() {
      const isExpanded = btn.getAttribute('aria-expanded') === 'true';
      if (isExpanded) {
        closeMenu();
      } else {
        openMenu();
      }
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });

    document.addEventListener('click', (e) => {
      if (document.body.classList.contains('mobile-nav-open')) {
        if (!sidebar.contains(e.target) && !btn.contains(e.target)) {
          closeMenu();
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('mobile-nav-open')) {
        closeMenu();
        btn.focus();
      }
    });

    sidebar.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (link) {
        closeMenu();
      }
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 900 && document.body.classList.contains('mobile-nav-open')) {
        closeMenu();
      }
    });
  }

  function renderSidebar(user) {
    const sidebarContainer = document.getElementById('appSidebar');
    if (!sidebarContainer) return;

    const role = user ? user.role : '';
    const currentPath = window.location.pathname;

    const links = [
      { label: 'Dashboard', icon: 'bi-speedometer2', href: '/index.html', roles: ['super_admin', 'admin'] },
      { label: 'Sales / POS', icon: 'bi-cart-check', href: '/modules/pos/pos_checkout.html', roles: ['super_admin', 'admin', 'cashier'] },
      { label: 'Inventory', icon: 'bi-box-seam', href: '/modules/inventory/index.html', roles: ['super_admin', 'admin'] },
      { label: 'Customers', icon: 'bi-people', href: '/modules/customers/index.html', roles: ['super_admin', 'admin'] },
      { label: 'Suppliers', icon: 'bi-truck', href: '/modules/suppliers/index.html', roles: ['super_admin', 'admin'] },
      { label: 'Employees', icon: 'bi-person-badge', href: '/modules/employees/index.html', roles: ['super_admin', 'admin'] },
      { label: 'Expenses', icon: 'bi-receipt', href: '/modules/expenses/index.html', roles: ['super_admin', 'admin'] },
      { label: 'Reports', icon: 'bi-graph-up-arrow', href: '/modules/reports/index.html', roles: ['super_admin', 'admin'] },
      { label: 'Users', icon: 'bi-shield-lock', href: '/modules/users/index.html', roles: ['super_admin'] }
    ];

    const visibleLinks = links.filter((link) => link.roles.includes(role));

    const linksHtml = visibleLinks.map((link) => {
      const isActive = currentPath === link.href || currentPath.endsWith(link.href.replace(/^\//, '')) || (link.href === '/index.html' && (currentPath === '/' || currentPath.endsWith('/index.html')));
      return `
        <a class="${isActive ? 'active' : ''}" href="${link.href}">
            <i class="bi ${link.icon}"></i>
            ${escapeHtml(link.label)}
        </a>
      `;
    }).join('');

    sidebarContainer.innerHTML = `
      <aside class="app-sidebar">
          <nav class="side-nav" aria-label="Module navigation">
              ${linksHtml}
          </nav>
      </aside>
    `;
  }

  function startClock() {
    function update() {
      const clockEl = document.getElementById('posClock');
      if (clockEl) {
        clockEl.textContent = new Date().toLocaleString('en-KE', {
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
    }
    update();
    setInterval(update, 30000);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function money(amount) {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES'
    }).format(Number(amount || 0));
  }

  window.KaringLayout = {
    init: initLayout,
    escapeHtml,
    money
  };
})(window);
