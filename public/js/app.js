/* ==========================================================================
   app.js — Khởi động ứng dụng: đăng nhập, menu, định tuyến, thông báo
   ========================================================================== */
(function () {
  'use strict';
  const U = App.U;
  const API = App.api;

  /* ============================== Đăng nhập ============================== */

  App.showLogin = function () {
    App.state.user = null;
    App.state.token = null;
    document.getElementById('app').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('password').value = '';
    const u = localStorage.getItem('ams.lastUser');
    if (u) document.getElementById('username').value = u;
  };

  async function doLogin(e) {
    if (e) e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const btn = document.getElementById('login-btn');
    const errBox = document.getElementById('login-error');
    errBox.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = '⏳ Đang đăng nhập…';
    try {
      const res = await API.post('/api/auth/login', { username, password }, { silent: true });
      App.state.user = res.data.user;
      App.state.token = res.data.token;
      localStorage.setItem('ams.lastUser', username);
      if (App.state.user.mustChangePassword) {
        setTimeout(() => {
          UI.toast('Yêu cầu đổi mật khẩu', 'Vì lý do bảo mật, vui lòng đổi mật khẩu ngay.', 'warning', 8000);
          Pages.changePasswordDialog();
        }, 700);
      }
      await boot(true);
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Đăng nhập';
    }
  }

  App.logout = async function () {
    // 1) Thu hồi phiên trên máy chủ (xoá cookie HttpOnly)
    try { await API.post('/api/auth/logout', {}, { silent: true }); } catch (e) { /* vẫn đăng xuất phía client */ }
    // 2) Xoá toàn bộ trạng thái phía client
    App.state.user = null;
    App.state.token = null;
    App.state.permissions = {};
    App.state.notifications = [];
    try { localStorage.removeItem('ams.pref.pendingSort'); } catch (e) {}
    document.getElementById('user-dropdown').classList.add('hidden');
    const sr = document.getElementById('search-results');
    if (sr) sr.classList.add('hidden');
    const notif = document.getElementById('notif-count');
    if (notif) { notif.textContent = '0'; notif.classList.add('hidden'); }
    document.getElementById('nav').innerHTML = '';
    document.getElementById('content').innerHTML = '';
    document.querySelectorAll('.modal-overlay').forEach((m) => m.remove());
    UI.loading(false);
    if (window.Designer) window.Designer.dirty = false;
    // 3) Quay về màn hình đăng nhập (không phụ thuộc vào việc tải lại trang)
    if (location.hash && location.hash !== '#/dashboard') location.hash = '#/dashboard';
    App.showLogin();
    document.getElementById('password').value = '';
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    UI.toast('Đã đăng xuất', 'Hẹn gặp lại bạn!', 'success');
    return true;
  };

  /* ============================== Menu điều hướng ============================== */

  const MENU = [
    { group: 'Tổng quan', items: [
      { key: 'dashboard', label: 'Bảng điều khiển', icon: '📊', href: '#/dashboard', perm: 'dashboard' },
      { key: 'analytics', label: 'Phân tích & thống kê', icon: '📈', href: '#/analytics', perm: 'dashboard' },
      { key: 'notifications', label: 'Thông báo', icon: '🔔', href: '#/notifications', perm: 'dashboard', badge: 'notifications' },
    ]},
    { group: 'Quản lý tài sản', items: [
      { key: 'assets', label: 'Tài sản', icon: '📦', href: '#/assets', perm: 'assets' },
      { key: 'categories', label: 'Danh mục tài sản', icon: '🗂️', href: '#/categories', perm: 'categories' },
      { key: 'locations', label: 'Vị trí / Kho', icon: '📍', href: '#/locations', perm: 'locations' },
      { key: 'attachments', label: 'Tài liệu đính kèm', icon: '📎', href: '#/attachments', perm: 'attachments' },
    ]},
    { group: 'Nghiệp vụ', items: [
      { key: 'assignments', label: 'Cấp phát / Thu hồi', icon: '🤝', href: '#/assignments', perm: 'assignments' },
      { key: 'transfers', label: 'Điều chuyển', icon: '🔀', href: '#/transfers', perm: 'transfers', badge: 'transfers' },
      { key: 'maintenances', label: 'Bảo trì - Sửa chữa', icon: '🔧', href: '#/maintenances', perm: 'maintenances' },
      { key: 'depreciations', label: 'Khấu hao', icon: '📉', href: '#/depreciations', perm: 'depreciations' },
      { key: 'scan', label: 'Quét mã kiểm kê', icon: '📷', href: '#/scan', perm: 'stocktakes' },
      { key: 'stocktakes', label: 'Kiểm kê', icon: '🧮', href: '#/stocktakes', perm: 'stocktakes' },
      { key: 'disposals', label: 'Thanh lý', icon: '🗑️', href: '#/disposals', perm: 'disposals', badge: 'disposals' },
      { key: 'warranties', label: 'Bảo hành', icon: '🛡️', href: '#/warranties', perm: 'warranties' },
    ]},
    { group: 'Danh mục & Đối tác', items: [
      { key: 'suppliers', label: 'Nhà cung cấp', icon: '🚚', href: '#/suppliers', perm: 'suppliers' },
      { key: 'contracts', label: 'Hợp đồng', icon: '📑', href: '#/contracts', perm: 'contracts' },
      { key: 'departments', label: 'Phòng ban', icon: '🏢', href: '#/departments', perm: 'departments' },
    ]},
    { group: 'Báo cáo', items: [
      { key: 'reports', label: 'Mẫu báo cáo & In ấn', icon: '🖨️', href: '#/reports', perm: 'reports' },
      { key: 'library', label: 'Thư viện dữ liệu', icon: '📚', href: '#/reports/library', perm: 'reports' },
    ]},
    { group: 'Quản trị', items: [
      { key: 'admin', label: 'Tổng quan quản trị', icon: '🛠️', href: '#/admin', perm: 'settings' },
      { key: 'users', label: 'Người dùng', icon: '👥', href: '#/admin/users', perm: 'users' },
      { key: 'roles', label: 'Vai trò & phân quyền', icon: '🛡️', href: '#/admin/roles', perm: 'roles' },
      { key: 'audit', label: 'Nhật ký hệ thống', icon: '📜', href: '#/admin/audit', perm: 'audit_logs' },
      { key: 'sessions', label: 'Phiên đăng nhập', icon: '🔑', href: '#/admin/sessions', perm: 'sessions' },
      { key: 'settings', label: 'Cấu hình hệ thống', icon: '⚙️', href: '#/admin/settings', perm: 'settings' },
      { key: 'backup', label: 'Sao lưu & phục hồi', icon: '💾', href: '#/admin/backup', perm: 'backup' },
      { key: 'data', label: 'Công cụ dữ liệu', icon: '🧰', href: '#/admin/data', perm: 'data_tools' },
    ]},
  ];

  function buildNav(filter) {
    const nav = document.getElementById('nav');
    if (!nav) return;
    const q = U.norm(filter || '');
    nav.innerHTML = MENU.map((g) => {
      const items = g.items.filter((it) => App.can(it.perm, 'view') && (!q || U.norm(it.label).includes(q)));
      if (!items.length) return '';
      return `<div class="nav-group">
        <div class="nav-group-title">${U.esc(g.group)}</div>
        ${items.map((it) => `<a class="nav-item" href="${it.href}" data-nav="${it.key}" title="${U.attr(it.label)}">
          <span class="ni">${it.icon}</span><span>${U.esc(it.label)}</span>
          ${it.badge ? `<span class="nb hidden" data-badge="${it.badge}">0</span>` : ''}
        </a>`).join('')}
      </div>`;
    }).join('');
    highlightNav();
  }

  function highlightNav() {
    const hash = location.hash || '#/dashboard';
    document.querySelectorAll('.nav-item').forEach((a) => {
      const href = a.getAttribute('href');
      const active = hash === href || (href !== '#/dashboard' && hash.startsWith(href + '/')) || (href === '#/assets' && hash.startsWith('#/assets'));
      a.classList.toggle('active', active);
    });
  }

  /* ============================== Định tuyến ============================== */

  function registerRoutes() {
    const R = App.Router;
    R.add('/dashboard', (route, c) => Dash.dashboard(c));
    R.add('/analytics', (route, c) => Dash.analytics(c));
    R.add('/profile', (route, c) => Pages.profile(c));
    R.add('/notifications', (route, c) => Pages.notificationsPage(c));

    R.add('/reports', (route, c) => Pages.reports(c));
    R.add('/reports/library', (route, c) => Pages.dataLibrary(c));
    R.add('/reports/designer/:id', (route, c) => Designer.open(route.params.id, c));

    R.add('/assets', (route, c) => Pages.assetsPage(c));
    R.add('/assets/:id/edit', (route, c) => Pages.entityEdit('assets', route.params.id, c));
    R.add('/assets/:id', (route, c) => Pages.entityDetail('assets', route.params.id, c));

    R.add('/depreciations', (route, c) => Pages.depreciationsPage(c));
    R.add('/scan', (route, c) => Pages.scan ? Pages.scan(c) : Pages.notFound(c));
    R.add('/stocktakes/:id/count', (route, c) => Pages.stocktakeCount(route.params.id, c));
    R.add('/stocktakes', (route, c) => Pages.stocktakesPage(c));
    R.add('/transfers', (route, c) => Pages.transfersPage(c));
    R.add('/disposals', (route, c) => Pages.disposalsPage(c));
    R.add('/maintenances', (route, c) => Pages.maintenancesPage(c));
    R.add('/warranties', (route, c) => Pages.warrantiesPage(c));
    R.add('/contracts', (route, c) => Pages.contractsPage(c));
    R.add('/assignments', (route, c) => Pages.assignmentsPage(c));

    R.add('/admin', (route, c) => Admin.menu(c));
    R.add('/admin/system', (route, c) => Admin.system(c));
    R.add('/admin/users', (route, c) => Admin.users(c));
    R.add('/admin/roles', (route, c) => Admin.roles(c));
    R.add('/admin/audit', (route, c) => Admin.auditLogs(c));
    R.add('/admin/sessions', (route, c) => Admin.sessions(c));
    R.add('/admin/settings', (route, c) => Admin.settings(c));
    R.add('/admin/backup', (route, c) => Admin.backup(c));
    R.add('/admin/data', (route, c) => Admin.dataTools(c));

    // Thực thể tổng quát (kiểm tra phân hệ có tồn tại trong metadata không)
    const known = (name) => !!(App.state.entities && App.state.entities[name]);
    R.add('/:entity/:id/edit', (route, c) => (known(route.params.entity) ? Pages.entityEdit(route.params.entity, route.params.id, c) : Pages.notFound(c)));
    R.add('/:entity/:id', (route, c) => (known(route.params.entity) ? Pages.entityDetail(route.params.entity, route.params.id, c) : Pages.notFound(c)));
    R.add('/:entity', (route, c) => (known(route.params.entity) ? Pages.entityList(route.params.entity, c) : Pages.notFound(c)));
  }

  /** Áp dụng bộ lọc từ query string (vd: #/assets?filter[status]=in_use) */
  function applyQueryDefaults() {
    const q = App.state.route.query || {};
    if (q.sort) App.pref.set('pendingSort', q.sort);
  }

  /* ============================== Thông báo ============================== */

  App.refreshNotifications = async function () {
    try {
      const res = await API.get('/api/notifications?unread=1');
      const unread = (res.meta && res.meta.unread) || 0;
      const el = document.getElementById('notif-count');
      if (el) {
        el.textContent = unread > 99 ? '99+' : String(unread);
        el.classList.toggle('hidden', unread === 0);
      }
      App.state.notifications = res.data || [];
    } catch (e) {}
  };

  function showNotificationPanel(anchor) {
    const items = App.state.notifications || [];
    const menu = document.getElementById('context-menu');
    menu.style.minWidth = '360px';
    menu.innerHTML = items.length
      ? items.slice(0, 12).map((n) => `<div data-notif="${n.id}" style="display:flex;gap:8px;align-items:flex-start">
          <span style="width:8px;height:8px;border-radius:50%;margin-top:6px;background:${n.level === 'danger' ? '#ef4444' : n.level === 'warning' ? '#f59e0b' : n.level === 'success' ? '#16a34a' : '#0ea5e9'}"></span>
          <span style="flex:1"><b style="font-size:12.5px">${U.esc(n.title)}</b><br/><span class="tiny muted">${U.esc(n.message)}</span><br/><span class="tiny" style="color:var(--text-light)">${U.timeAgo(n.createdAt)}</span></span>
        </div>`).join('') + '<div class="sep"></div><div data-goto="#/notifications">📋 Xem tất cả thông báo</div>'
      : '<div class="muted tiny" style="padding:10px">Không có thông báo chưa đọc 🎉</div><div class="sep"></div><div data-goto="#/notifications">📋 Trang thông báo</div>';
    const rect = anchor.getBoundingClientRect();
    menu.style.top = rect.bottom + 6 + 'px';
    menu.style.left = Math.max(10, rect.right - 380) + 'px';
    menu.classList.remove('hidden');
    menu.querySelectorAll('[data-goto]').forEach((el) => (el.onclick = () => { menu.classList.add('hidden'); location.hash = el.dataset.goto; }));
    menu.querySelectorAll('[data-notif]').forEach((el) => (el.onclick = async () => {
      const n = items.find((x) => String(x.id) === el.dataset.notif);
      await API.post('/api/notifications/mark', { ids: [el.dataset.notif] });
      menu.classList.add('hidden');
      App.refreshNotifications();
      if (n && n.link) location.hash = n.link.replace(/^#/, '') || '#/notifications';
    }));
    setTimeout(() => document.addEventListener('mousedown', function hide(e) {
      if (!menu.contains(e.target)) { menu.classList.add('hidden'); menu.style.minWidth = ''; document.removeEventListener('mousedown', hide); }
    }), 10);
  }

  /* ============================== Tìm kiếm nhanh ============================== */

  function setupGlobalSearch() {
    const input = document.getElementById('global-search');
    const box = document.getElementById('search-results');
    const run = U.debounce(async () => {
      const q = input.value.trim();
      if (q.length < 2) { box.classList.add('hidden'); return; }
      try {
        const res = await API.get(`/api/entities/assets?q=${encodeURIComponent(q)}&limit=8`);
        const rows = res.data || [];
        box.innerHTML = rows.length
          ? rows.map((r) => `<div class="sr-item" data-id="${r.id}">
              <span style="font-size:18px">📦</span>
              <div style="flex:1"><b>${U.esc(r.name)}</b><div class="sr-meta">${U.esc(r.code)} • ${U.esc(r.categoryName || '')} • ${U.esc(r.departmentName || '')}</div></div>
              <div class="text-right"><div class="tiny muted">${U.moneyShort(r.bookValue)}</div><div>${App.formatField('assets', 'status', r.status, r)}</div></div>
            </div>`).join('')
          : `<div class="sr-item"><span class="muted">Không tìm thấy tài sản nào khớp "${U.esc(q)}"</span></div>`;
        box.classList.remove('hidden');
        box.querySelectorAll('[data-id]').forEach((el) => (el.onclick = () => { box.classList.add('hidden'); input.value = ''; location.hash = '#/assets/' + el.dataset.id; }));
      } catch (e) { /* bỏ qua */ }
    }, 320);
    input.addEventListener('input', run);
    input.addEventListener('focus', () => { if (input.value.trim().length >= 2) run(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = box.querySelector('[data-id]');
        if (first) first.click();
        else if (input.value.trim()) location.hash = '#/assets?q=' + encodeURIComponent(input.value.trim());
      }
      if (e.key === 'Escape') box.classList.add('hidden');
    });
    document.addEventListener('mousedown', (e) => { if (!box.contains(e.target) && e.target !== input) box.classList.add('hidden'); });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); input.select(); }
    });
  }

  /* ============================== Thêm nhanh ============================== */

  function setupQuickAdd() {
    document.getElementById('btn-quick-add').onclick = (e) => {
      const items = [];
      if (App.can('assets', 'create')) items.push({ label: 'Tài sản mới', icon: '📦', onClick: () => UI.recordDialog('assets', { purchaseDate: U.today(), quantity: 1, status: 'in_stock', condition: 'new', depreciationStart: U.today(), warrantyStart: U.today() }, { onSaved: () => App.Router.resolve() }) });
      if (App.can('maintenances', 'create')) items.push({ label: 'Phiếu bảo trì', icon: '🔧', onClick: () => UI.recordDialog('maintenances', { type: 'preventive', priority: 'normal', reportedDate: U.today(), status: 'pending' }, { onSaved: () => App.Router.resolve() }) });
      if (App.can('transfers', 'create')) items.push({ label: 'Phiếu điều chuyển', icon: '🔀', onClick: () => UI.recordDialog('transfers', { date: U.today(), status: 'pending' }, { onSaved: () => App.Router.resolve() }) });
      if (App.can('stocktakes', 'create')) items.push({ label: 'Đợt kiểm kê', icon: '🧮', onClick: () => UI.recordDialog('stocktakes', { startDate: U.today(), endDate: U.addDays(U.today(), 15), scope: 'all', status: 'open' }, { onSaved: () => App.Router.resolve() }) });
      if (App.can('disposals', 'create')) items.push({ label: 'Phiếu thanh lý', icon: '🗑️', onClick: () => UI.recordDialog('disposals', { date: U.today(), type: 'sale', status: 'pending' }, { onSaved: () => App.Router.resolve() }) });
      if (App.can('assignments', 'create')) items.push({ label: 'Phiếu cấp phát', icon: '🤝', onClick: () => UI.recordDialog('assignments', { type: 'assign', date: U.today(), status: 'completed' }, { onSaved: () => App.Router.resolve() }) });
      if (App.can('depreciations', 'create')) items.push({ label: '⚙️ Chạy khấu hao kỳ', onClick: () => Pages.depreciationRun() });
      if (App.can('reports', 'create')) items.push({ label: 'Mẫu báo cáo mới', icon: '🎨', onClick: () => Pages.newReportDialog() });
      UI.rowMenu(e.currentTarget, items);
    };
  }

  /* ============================== Giao diện ============================== */

  function applyTheme() {
    document.body.classList.toggle('dark', App.state.theme === 'dark');
  }

  function boot(justLoggedIn) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    return loadMeta().then(() => {
      buildNav();
      document.getElementById('btn-top-scan').hidden = !App.can('assets', 'view');
      App.refreshNotifications();
      registerRoutes();
      App.Router.start();
      highlightNav();
      window.addEventListener('hashchange', () => { highlightNav(); applyQueryDefaults(); });
      if (justLoggedIn) UI.toast('Xin chào ' + App.state.user.fullName + ' 👋', 'Vai trò: ' + App.state.user.roleName, 'success');
    });
  }

  async function loadMeta() {
    const res = await API.get('/api/meta');
    const d = res.data;
    App.state.meta = d;
    App.state.entities = d.entities;
    App.state.enums = d.enums;
    App.state.settings = d.settings.system || {};
    App.state.company = d.settings.company || {};
    App.state.permissions = (res.data.permissions) || App.state.user._permissions || {};
    const me = res.data.user || {};
    document.getElementById('user-name').textContent = App.state.user.fullName;
    document.getElementById('user-role').textContent = App.state.user.roleName;
    document.getElementById('user-avatar').textContent = U.initials(App.state.user.fullName);
    document.getElementById('brand-company').textContent = d.settings.company.shortName || d.settings.company.name;
    document.getElementById('app-version').textContent = 'v' + d.app.version;
    document.getElementById('footer-left').textContent = `${d.settings.company.name} — ${d.app.name} v${d.app.version}`;
    document.getElementById('footer-right').textContent = 'Người dùng: ' + App.state.user.fullName + ' (' + App.state.user.roleName + ')';
    document.title = d.app.name + ' — ' + d.settings.company.shortName;
  }

  async function restoreSession() {
    try {
      const res = await API.get('/api/auth/me', { silent: true });
      App.state.user = res.data.user;
      App.state.permissions = res.data.permissions || {};
      await boot(false);
      return true;
    } catch (e) { return false; }
  }

  /* ============================== Sự kiện chung ============================== */

  document.addEventListener('DOMContentLoaded', async () => {
    applyTheme();
    document.body.classList.toggle('sidebar-collapsed', App.state.sidebarCollapsed);

    document.getElementById('login-form').addEventListener('submit', doLogin);
    document.getElementById('toggle-password').onclick = () => {
      const p = document.getElementById('password');
      p.type = p.type === 'password' ? 'text' : 'password';
    };
    document.querySelectorAll('.chip[data-u]').forEach((c) => (c.onclick = () => {
      document.getElementById('username').value = c.dataset.u;
      document.getElementById('password').value = c.dataset.p;
    }));
    document.getElementById('show-help').onclick = (e) => {
      e.preventDefault();
      UI.modal({
        size: 'sm', title: 'Quên mật khẩu?',
        body: `<div class="alert info">Vui lòng liên hệ <b>quản trị viên hệ thống</b> để được đặt lại mật khẩu.<br/><br/>Quản trị viên vào <b>Quản trị → Người dùng → Đặt lại mật khẩu</b> để cấp mật khẩu mới cho bạn. Mật khẩu mới sẽ yêu cầu đổi ở lần đăng nhập kế tiếp.</div>
               <div class="muted tiny">Hỗ trợ kỹ thuật: support@ams.vn — (028) 3822 1234</div>`,
      });
    };

    document.getElementById('btn-top-scan').onclick = () => {
      if (!App.can('assets', 'view')) return;
      Pages.scanAssetDialog();
    };
    document.getElementById('btn-logout').onclick = async (e) => {
      e.preventDefault();
      const dl = document.getElementById('user-dropdown');
      if (dl) dl.classList.add('hidden');
      const okd = await UI.confirm({ title: 'Đăng xuất?', message: 'Bạn có chắc muốn đăng xuất khỏi hệ thống?', confirmText: 'Đăng xuất' });
      if (okd) await App.logout();
    };
    document.getElementById('toggle-sidebar').onclick = () => {
      App.state.sidebarCollapsed = !App.state.sidebarCollapsed;
      document.body.classList.toggle('sidebar-collapsed', App.state.sidebarCollapsed);
      localStorage.setItem('ams.sidebar', App.state.sidebarCollapsed ? '1' : '0');
    };
    document.getElementById('open-sidebar').onclick = () => document.body.classList.toggle('sidebar-open');
    document.getElementById('menu-search').oninput = (e) => buildNav(e.target.value);
    document.getElementById('btn-theme').onclick = () => {
      App.state.theme = App.state.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('ams.theme', App.state.theme);
      applyTheme();
    };
    document.getElementById('btn-notifications').onclick = (e) => showNotificationPanel(e.currentTarget);
    document.getElementById('user-btn').onclick = (e) => {
      e.stopPropagation();
      const dd = document.getElementById('user-dropdown');
      dd.classList.toggle('hidden');
      setTimeout(() => document.addEventListener('mousedown', function hide(ev) {
        if (!dd.contains(ev.target) && ev.target.id !== 'user-btn') { dd.classList.add('hidden'); document.removeEventListener('mousedown', hide); }
      }), 10);
    };
    document.querySelectorAll('[data-nav]').forEach((a) => (a.onclick = () => document.getElementById('user-dropdown').classList.add('hidden')));

    setupGlobalSearch();
    setupQuickAdd();

    const ok = await restoreSession();
    if (!ok) App.showLogin();

    // Quét cảnh báo định kỳ 5 phút
    setInterval(async () => {
      if (!App.state.user) return;
      try { await API.post('/api/notifications/refresh-alerts', {}, { silent: true }); } catch (e) {}
      App.refreshNotifications();
    }, 5 * 60 * 1000);
  });

  // Cảnh báo khi rời trang mà chưa lưu thiết kế
  window.addEventListener('beforeunload', (e) => {
    if (window.Designer && Designer.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
})();
