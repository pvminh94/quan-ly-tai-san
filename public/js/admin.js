/* ==========================================================================
   admin.js — Phân hệ quản trị hệ thống
   ========================================================================== */
(function () {
  'use strict';
  const U = App.U;
  const API = App.api;
  const Admin = {};
  window.Admin = Admin;

  function head(title, sub, actions) {
    return Pages.pageHead(title, sub, actions || '');
  }

  /* ============================== Tổng quan hệ thống ============================== */

  Admin.system = async function (container) {
    container.innerHTML = head('🖥️ Trạng thái hệ thống', 'Thông tin kỹ thuật, CSDL, tiến trình và hoạt động',
      '<button class="btn" id="sys-reload">🔄 Làm mới</button>');
    const host = document.createElement('div');
    container.appendChild(host);
    const load = async () => {
      host.innerHTML = '<div class="page-loading"><div class="spinner"></div> Đang tải…</div>';
      try {
        const res = await API.get('/api/admin/system');
        const d = res.data;
        host.innerHTML = `
        <div class="grid cols-4 mb">
          ${UI.kpi({ label: 'Phiên bản ứng dụng', value: d.app.version, icon: '🚀', color: 'blue', trend: `Node ${d.app.node} • ${d.app.platform}` })}
          ${UI.kpi({ label: 'Thời gian hoạt động', value: (d.app.uptimeSeconds > 86400 ? Math.floor(d.app.uptimeSeconds / 86400) + ' ngày' : d.app.uptimeSeconds > 3600 ? Math.floor(d.app.uptimeSeconds / 3600) + ' giờ' : Math.floor(d.app.uptimeSeconds / 60) + ' phút'), icon: '⏱', color: 'green', trend: 'Từ ' + U.datetime(d.app.startedAt) })}
          ${UI.kpi({ label: 'Dung lượng CSDL', value: (d.database.sizeBytes / 1024 / 1024).toFixed(2), suffix: 'MB', icon: '💾', color: 'purple', trend: `${d.database.collections.length} bảng dữ liệu` })}
          ${UI.kpi({ label: 'Phiên đang hoạt động', value: d.activity.sessionsActive, icon: '🔑', color: 'amber', trend: `${d.activity.loginsToday} lượt đăng nhập hôm nay` })}
        </div>
        <div class="grid cols-3 mb">
          <div class="card"><div class="card-head"><h3>💻 Tài nguyên máy chủ</h3></div><div class="card-body">
            <div class="stat-row"><span>Node.js</span><b>${U.esc(d.app.node)}</b></div>
            <div class="stat-row"><span>Hệ điều hành</span><b>${U.esc(d.app.platform)}</b></div>
            <div class="stat-row"><span>Bộ nhớ RSS</span><b>${(d.memory.rss / 1024 / 1024).toFixed(1)} MB</b></div>
            <div class="stat-row"><span>Heap đã dùng</span><b>${(d.memory.heapUsed / 1024 / 1024).toFixed(1)} / ${(d.memory.heapTotal / 1024 / 1024).toFixed(1)} MB</b></div>
            <div class="stat-row"><span>Tổng bản ghi nhật ký</span><b>${U.num(d.activity.logsTotal)}</b></div>
            <div class="stat-row"><span>Đăng nhập gần nhất</span><b>${U.datetime(d.activity.lastLogin)}</b></div>
          </div></div>
          <div class="card"><div class="card-head"><h3>🗄️ CSDL & sao lưu</h3></div><div class="card-body">
            <div class="stat-row"><span>Tệp CSDL</span><b class="mono">${U.esc(d.database.file)}</b></div>
            <div class="stat-row"><span>Số bảng</span><b>${d.database.collections.length}</b></div>
            <div class="stat-row"><span>Bản sao lưu gần nhất</span><b>${d.database.lastBackup ? U.datetime(d.database.lastBackup.at) : 'Chưa có'}</b></div>
            <div class="mt row wrap" style="gap:6px">
              <button class="btn sm primary" id="sys-backup">💾 Sao lưu ngay</button>
              <a class="btn sm" href="#/admin/backup">Quản lý sao lưu</a>
              <a class="btn sm" href="#/admin/data">Công cụ dữ liệu</a>
            </div>
          </div></div>
          <div class="card"><div class="card-head"><h3>🔐 Bảo mật & phiên</h3></div><div class="card-body">
            <div class="stat-row"><span>Phiên đang mở</span><b>${d.activity.sessionsActive}</b></div>
            <div class="stat-row"><span>Đăng nhập hôm nay</span><b>${d.activity.loginsToday}</b></div>
            <div class="stat-row"><span>Vai trò của bạn</span><b>${U.esc(d.user.role)}</b></div>
            <div class="mt row wrap" style="gap:6px">
              <a class="btn sm" href="#/admin/sessions">Quản lý phiên đăng nhập</a>
              <a class="btn sm" href="#/admin/audit">Nhật ký hệ thống</a>
            </div>
          </div></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>📋 Danh sách bảng dữ liệu</h3><span class="sub">Số bản ghi theo từng phân hệ</span></div>
          <div class="table-wrap"><table class="data compact">
            <thead><tr><th>Bảng</th><th>Phân hệ</th><th class="num">Số bản ghi</th><th class="num">Đã xoá (thùng rác)</th><th></th></tr></thead>
            <tbody>${d.database.collections.map((c) => `<tr>
              <td class="mono">${U.esc(c.name)}</td><td>${U.esc(c.label)}</td>
              <td class="num">${U.num(c.count)}</td>
              <td class="num">${c.deleted ? U.num(c.deleted) : '—'}</td>
              <td class="cta"><a class="link" href="#/${c.name}">Mở phân hệ</a></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>`;
        host.querySelector('#sys-backup').onclick = async () => {
          UI.loading(true, 'Đang sao lưu…');
          try { const r = await API.post('/api/admin/backup', {}); UI.loading(false); UI.toast('Đã sao lưu CSDL', r.data.file, 'success'); load(); }
          catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
        };
      } catch (e) {
        host.innerHTML = `<div class="alert danger">${U.esc(e.message)}</div>`;
      }
    };
    container.querySelector('#sys-reload').onclick = load;
    await load();
  };

  /* ============================== Người dùng ============================== */

  Admin.users = function (container) {
    return Pages.entityList('users', container, {
      subtitle: 'Quản lý tài khoản, vai trò, phòng ban, trạng thái hoạt động và tài sản đang giao.',
      extraActions: () => [
        { label: 'Đặt lại MK', icon: '🔑', title: 'Đặt lại mật khẩu', showIf: () => App.can('users', 'update'), onClick: (row) => Actions.resetPassword(row) },
        { label: 'Khoá/Mở', icon: '🔒', title: 'Khoá hoặc mở khoá tài khoản', showIf: () => App.can('users', 'update'), onClick: (row) => Actions.toggleUser(row, () => App.Router.resolve()) },
      ],
      defaults: { status: 'active', mustChangePassword: true, joinDate: U.today() },
    });
  };

  /* ============================== Vai trò & phân quyền ============================== */

  Admin.roles = function (container) {
    return Pages.entityList('roles', container, {
      subtitle: 'Định nghĩa vai trò, ma trận phân quyền theo phân hệ và phạm vi dữ liệu.',
      headActions: App.can('roles', 'create') ? '<button class="btn primary" id="hd-role-perm">🛡 Tạo vai trò & phân quyền</button>' : '',
      onReady: (table, cont) => {
        const btn = cont.querySelector('#hd-role-perm');
        if (btn) btn.onclick = () => Admin.roleEditor(null, () => table.reload());
      },
      extraActions: () => [
        { label: 'Phân quyền', icon: '🛡', title: 'Sửa ma trận phân quyền', showIf: () => App.can('roles', 'update'), onClick: (row) => Admin.roleEditor(row, () => App.Router.resolve()) },
      ],
    });
  };

  Admin.roleEditor = async function (role, done) {
    const mods = App.state.enums.permissionModules || [];
    const acts = App.state.enums.permissionActions || [];
    const groups = {};
    mods.forEach((m) => { (groups[m.group] = groups[m.group] || []).push(m); });
    const perms = role ? U.clone(role.permissions || {}) : {};

    const m = UI.modal({
      size: 'xl',
      title: role ? 'Phân quyền vai trò: ' + role.name : 'Tạo vai trò mới',
      subtitle: 'Tích chọn quyền theo từng phân hệ. Quyền "Duyệt" dùng cho các phiếu cần phê duyệt.',
      body: `
        <div class="form-grid mb">
          <div class="field"><label>Mã vai trò <span class="req">*</span></label><input type="text" id="rl-code" value="${U.attr(role ? role.code : '')}" ${role && role.isSystem ? 'disabled' : ''}/></div>
          <div class="field"><label>Tên vai trò <span class="req">*</span></label><input type="text" id="rl-name" value="${U.attr(role ? role.name : '')}"/></div>
          <div class="field"><label>Phạm vi dữ liệu</label><select id="rl-scope">
            <option value="all" ${role && role.dataScope === 'all' ? 'selected' : ''}>Toàn hệ thống</option>
            <option value="department" ${role && role.dataScope === 'department' ? 'selected' : ''}>Theo phòng ban</option>
            <option value="own" ${role && role.dataScope === 'own' ? 'selected' : ''}>Chỉ dữ liệu của mình</option>
          </select></div>
          <div class="field"><label>Mô tả</label><input type="text" id="rl-desc" value="${U.attr(role ? role.description || '' : '')}"/></div>
        </div>
        <div class="row mb wrap" style="gap:6px">
          <button class="btn sm" data-bulk="all">Chọn tất cả</button>
          <button class="btn sm" data-bulk="none">Bỏ chọn tất cả</button>
          <button class="btn sm" data-bulk="view">Chỉ quyền xem</button>
          <button class="btn sm" data-bulk="rcud">Xem + Thêm/Sửa/Xoá</button>
        </div>
        <div class="table-wrap" style="max-height:52vh;border:1px solid var(--border);border-radius:8px">
          <table class="perm-table">
            <thead><tr><th style="width:260px">Phân hệ</th>${acts.map((a) => `<th>${U.esc(a.label)}</th>`).join('')}<th>Chọn nhanh</th></tr></thead>
            <tbody>
              ${Object.keys(groups).map((g) => `<tr class="perm-group-row"><td colspan="${acts.length + 2}">${U.esc(g)}</td></tr>
                ${groups[g].map((mod) => `<tr>
                  <td class="mod">${U.esc(mod.label)} <span class="muted tiny mono">${U.esc(mod.key)}</span></td>
                  ${acts.map((a) => `<td class="ctr"><input type="checkbox" data-perm="${mod.key}" data-act="${a.key}" ${((perms[mod.key] || []).includes(a.key) || (perms[mod.key] || []).includes('*')) ? 'checked' : ''}/></td>`).join('')}
                  <td class="ctr"><button class="link tiny" data-rowall="${mod.key}">tất cả</button> / <button class="link tiny" data-rownone="${mod.key}">bỏ</button></td>
                </tr>`).join('')}`).join('')}
              </tbody>
          </table>
        </div>`,
      footer: [
        { label: 'Huỷ', onClick: (mm) => mm.close() },
        { label: role ? '💾 Lưu phân quyền' : '＋ Tạo vai trò', cls: 'primary', onClick: async (mm) => {
          const code = mm.body.querySelector('#rl-code').value.trim();
          const name = mm.body.querySelector('#rl-name').value.trim();
          if (!name || (!role && !code)) return UI.toast('Thiếu thông tin', 'Vui lòng nhập mã và tên vai trò', 'warning');
          const collected = {};
          mm.body.querySelectorAll('[data-perm]').forEach((cb) => {
            const key = cb.dataset.perm;
            collected[key] = collected[key] || [];
            if (cb.checked) collected[key].push(cb.dataset.act);
          });
          const payload = {
            code: code.toUpperCase(), name, description: mm.body.querySelector('#rl-desc').value,
            dataScope: mm.body.querySelector('#rl-scope').value, permissions: collected, isSystem: false,
          };
          UI.loading(true, 'Đang lưu phân quyền…');
          try {
            if (role) await API.put('/api/entities/roles/' + role.id, payload);
            else await API.post('/api/entities/roles', payload);
            UI.loading(false); mm.close();
            UI.toast(role ? 'Đã cập nhật phân quyền' : 'Đã tạo vai trò mới', name, 'success');
            if (done) done();
          } catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
        } },
      ],
    });

    m.body.querySelectorAll('[data-bulk]').forEach((b) => (b.onclick = () => {
      const mode = b.dataset.bulk;
      m.body.querySelectorAll('[data-perm]').forEach((cb) => {
        if (mode === 'all') cb.checked = true;
        if (mode === 'none') cb.checked = false;
        if (mode === 'view') cb.checked = cb.dataset.act === 'view';
        if (mode === 'rcud') cb.checked = ['view', 'create', 'update', 'export'].includes(cb.dataset.act);
      });
    }));
    m.body.querySelectorAll('[data-rowall]').forEach((b) => (b.onclick = () => {
      m.body.querySelectorAll(`[data-perm="${b.dataset.rowall}"]`).forEach((cb) => (cb.checked = true));
    }));
    m.body.querySelectorAll('[data-rownone]').forEach((b) => (b.onclick = () => {
      m.body.querySelectorAll(`[data-perm="${b.dataset.rownone}"]`).forEach((cb) => (cb.checked = false));
    }));
  };

  /* ============================== Nhật ký hệ thống ============================== */

  Admin.auditLogs = function (container) {
    return Pages.entityList('audit_logs', container, {
      title: 'Nhật ký hoạt động hệ thống',
      subtitle: 'Theo dõi mọi thao tác: đăng nhập, thêm/sửa/xoá, phê duyệt, xuất dữ liệu, chạy tiến trình.',
      readonly: true,
      columns: [
        { key: 'createdAt', label: 'Thời gian', render: (r) => `<span class="mono tiny">${U.datetime(r.createdAt)}</span>` },
        { key: 'username', label: 'Người dùng', render: (r) => `<b>${U.esc(r.username)}</b>` },
        { key: 'action', label: 'Hành động', render: (r) => actionBadge(r.action) },
        { key: 'entity', label: 'Đối tượng', render: (r) => `<span class="badge soft mono">${U.esc(r.entity || '')}</span>` },
        { key: 'entityLabel', label: 'Mô tả' },
        { key: 'ip', label: 'IP', render: (r) => `<span class="mono tiny">${U.esc(r.ip || '')}</span>` },
        { key: 'method', label: 'Method' },
        { key: 'status', label: 'HTTP', align: 'ctr', render: (r) => `<span class="badge" style="background:${r.status < 400 ? '#dcfce7' : '#fee2e2'};color:${r.status < 400 ? '#15803d' : '#b91c1c'}">${r.status}</span>` },
      ],
      headActions: `${App.can('audit_logs', 'export') ? '<button class="btn" id="al-export">⬇ Xuất nhật ký</button>' : ''}
        ${App.can('audit_logs', 'delete') ? '<button class="btn danger" id="al-clear">🗑 Xoá nhật ký cũ</button>' : ''}`,
      rowActions: [
        { label: 'Chi tiết', icon: '👁', onClick: (row) => Admin.auditDetail(row) },
      ],
      selectable: false,
      onReady: (table, cont) => {
        const ex = cont.querySelector('#al-export');
        if (ex) ex.onclick = () => API.download('/api/entities/audit_logs/export.csv?limit=10000', 'GET', null, `nhat-ky-${U.today()}.csv`).then(() => UI.toast('Đang tải file…', '', 'success'));
        const cl = cont.querySelector('#al-clear');
        if (cl) cl.onclick = async () => {
          const okd = await UI.confirm({ title: 'Xoá toàn bộ nhật ký?', message: 'Hành động này không thể hoàn tác. Nên xuất nhật ký ra CSV trước khi xoá.', danger: true, confirmText: 'Xoá hết' });
          if (!okd) return;
          try { const r = await API.del('/api/admin/audit-logs'); UI.toast('Đã xoá nhật ký', r.data.deleted + ' bản ghi', 'success'); table.reload(); }
          catch (e) { UI.toast('Lỗi', e.message, 'error'); }
        };
      },
    });
  };

  function actionBadge(a) {
    const colors = {
      LOGIN: '#0ea5e9', LOGOUT: '#64748b', LOGIN_FAILED: '#ef4444', CREATE: '#16a34a', UPDATE: '#f59e0b', DELETE: '#ef4444',
      RESTORE: '#0ea5e9', APPROVE: '#059669', REJECT: '#dc2626', IMPORT: '#a855f7', EXPORT: '#8b5cf6', RUN: '#6366f1',
      CONFIG: '#64748b', RESTORE_DB: '#f97316',
    };
    const c = colors[a] || '#64748b';
    return `<span class="badge" style="background:${U.hexToRgba(c, .14)};color:${c};border-color:${U.hexToRgba(c, .35)}">${U.esc(a)}</span>`;
  }

  Admin.auditDetail = function (row) {
    const changes = row.changes || {};
    const keys = Object.keys(changes);
    UI.modal({
      size: 'lg',
      title: 'Chi tiết nhật ký #' + row.id,
      subtitle: `${row.username} • ${U.datetime(row.createdAt)} • ${row.ip || ''}`,
      body: `
        <div class="grid cols-2 mb">
          <div class="card"><div class="card-body">
            <div class="stat-row"><span>Hành động</span><b>${actionBadge(row.action)}</b></div>
            <div class="stat-row"><span>Đối tượng</span><b class="mono">${U.esc(row.entity || '')} #${U.esc(row.entityId || '')}</b></div>
            <div class="stat-row"><span>Mô tả</span><b>${U.esc(row.entityLabel || '')}</b></div>
            <div class="stat-row"><span>Đường dẫn API</span><b class="mono tiny">${U.esc(row.method || '')} ${U.esc(row.path || '')}</b></div>
            <div class="stat-row"><span>Trình duyệt</span><b class="tiny">${U.esc(String(row.userAgent || '').slice(0, 90))}</b></div>
          </div></div>
          <div class="card"><div class="card-body">
            <div class="muted tiny mb">Thay đổi dữ liệu (${keys.length} trường)</div>
            ${keys.length ? `<div class="table-wrap" style="max-height:280px"><table class="data compact"><thead><tr><th>Trường</th><th>Giá trị cũ</th><th>Giá trị mới</th></tr></thead>
              <tbody>${keys.map((k) => `<tr><td class="mono">${U.esc(k)}</td>
                <td class="tiny" style="max-width:180px;overflow:hidden">${U.esc(formatMaybe(changes[k].from))}</td>
                <td class="tiny" style="max-width:180px;overflow:hidden"><b>${U.esc(formatMaybe(changes[k].to))}</b></td></tr>`).join('')}</tbody></table></div>` : '<div class="muted tiny">Không có dữ liệu thay đổi</div>'}
          </div></div>
        </div>`,
    });
  };
  function formatMaybe(v) {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
    return String(v).slice(0, 80);
  }

  /* ============================== Phiên đăng nhập ============================== */

  Admin.sessions = function (container) {
    return Pages.entityList('sessions', container, {
      title: 'Phiên đăng nhập',
      subtitle: 'Theo dõi và thu hồi phiên làm việc của người dùng trên mọi thiết bị.',
      readonly: true,
      selectable: false,
      columns: [
        { key: 'username', label: 'Người dùng', render: (r) => `<b>${U.esc(r.username)}</b>` },
        { key: 'ip', label: 'Địa chỉ IP', render: (r) => `<span class="mono">${U.esc(r.ip || '')}</span>` },
        { key: 'userAgent', label: 'Thiết bị', render: (r) => `<span class="tiny">${U.esc(String(r.userAgent || '').slice(0, 60))}</span>` },
        { key: 'createdAt', label: 'Đăng nhập lúc', render: (r) => U.datetime(r.createdAt) },
        { key: 'lastSeenAt', label: 'Hoạt động cuối', render: (r) => U.datetime(r.lastSeenAt) },
        { key: 'expiresAt', label: 'Hết hạn', render: (r) => U.datetime(r.expiresAt) },
        { key: 'revokedAt', label: 'Trạng thái', render: (r) => r.revokedAt ? '<span class="badge" style="background:#fee2e2;color:#b91c1c">Đã thu hồi</span>' : (new Date(r.expiresAt) < new Date() ? '<span class="badge soft">Hết hạn</span>' : '<span class="badge" style="background:#dcfce7;color:#15803d">Đang hoạt động</span>') },
      ],
      rowActions: [
        { label: 'Thu hồi', icon: '⛔', title: 'Thu hồi phiên', showIf: (r) => !r.revokedAt && App.can('sessions', 'delete'), onClick: async (row) => {
          const okd = await UI.confirm({ title: 'Thu hồi phiên?', message: `Người dùng <b>${U.esc(row.username)}</b> sẽ bị đăng xuất khỏi thiết bị này.`, danger: true });
          if (!okd) return;
          try { await API.del('/api/admin/sessions/' + row.id); UI.toast('Đã thu hồi phiên', '', 'success'); App.Router.resolve(); }
          catch (e) { UI.toast('Lỗi', e.message, 'error'); }
        } },
      ],
    });
  };

  /* ============================== Cấu hình hệ thống ============================== */

  Admin.settings = async function (container) {
    if (!App.can('settings', 'view')) { container.innerHTML = UI.emptyState('🔒', 'Không có quyền', 'Bạn không được phép xem cấu hình hệ thống.'); return; }
    container.innerHTML = head('⚙️ Cấu hình hệ thống', 'Thông tin doanh nghiệp, quy tắc đánh mã, khấu hao mặc định, thông báo và định dạng báo cáo',
      '<button class="btn primary" id="st-save">💾 Lưu cấu hình</button>');
    const host = document.createElement('div');
    container.appendChild(host);
    const res = await API.get('/api/settings');
    const cfg = res.data;
    let settings = U.clone(cfg);

    const tabsHost = document.createElement('div');
    host.appendChild(tabsHost);
    UI.tabs(tabsHost, [
      { key: 'company', label: '🏢 Doanh nghiệp', render: renderCompany },
      { key: 'numbering', label: '🔢 Quy tắc đánh mã', render: renderNumbering },
      { key: 'depreciation', label: '📉 Khấu hao mặc định', render: renderDep },
      { key: 'notify', label: '🔔 Thông báo & Email', render: renderNotify },
      { key: 'system', label: '🖥️ Hệ thống & Báo cáo', render: renderSystem },
    ], 'company');

    function renderCompany(p) {
      const c = settings.company;
      p.innerHTML = `<div class="card"><div class="card-body"><div class="form-grid">
        ${fldFull('company.name', 'Tên công ty (in trên báo cáo)', c.name, 2)}
        ${fldFull('company.shortName', 'Tên viết tắt / thương hiệu', c.shortName)}
        ${fldFull('company.taxCode', 'Mã số thuế', c.taxCode)}
        ${fldFull('company.address', 'Địa chỉ', c.address, 2)}
        ${fldFull('company.phone', 'Điện thoại', c.phone)}
        ${fldFull('company.email', 'Email', c.email)}
        ${fldFull('company.website', 'Website', c.website)}
        ${fldFull('company.bankAccount', 'Tài khoản ngân hàng', c.bankAccount)}
        ${fldFull('company.representative', 'Người đại diện pháp luật', c.representative)}
        ${fldFull('company.position', 'Chức danh người đại diện', c.position)}
        ${fldFull('company.accountant', 'Kế toán trưởng', c.accountant)}
        ${fldFull('company.logo', 'URL logo (dùng cho báo cáo)', c.logo, 2)}
      </div>
      <div class="alert info">Thông tin này được in ở đầu mọi báo cáo và chứng từ (biên bản bàn giao, thanh lý, kiểm kê…).</div>
      </div></div>`;
      bindFields(p, 'company');
    }

    function renderNumbering(p) {
      const rules = settings.numbering;
      p.innerHTML = `<div class="card">
        <div class="card-head"><h3>Quy tắc sinh mã tự động</h3><span class="sub">Token hỗ trợ: {PREFIX} {YYYY} {YY} {MM} {DD} {SEQ:n}</span></div>
        <div class="table-wrap"><table class="data compact">
          <thead><tr><th>Phân hệ</th><th>Tiền tố</th><th>Mẫu mã</th><th>Xem trước</th></tr></thead>
          <tbody>${Object.keys(rules).map((k) => {
            const e = App.state.entities[k] || { label: k };
            const r = rules[k];
            const sample = r.pattern.replace(/\{PREFIX\}/g, r.prefix).replace(/\{YYYY\}/g, new Date().getFullYear()).replace(/\{YY\}/g, String(new Date().getFullYear()).slice(-2)).replace(/\{MM\}/g, String(new Date().getMonth() + 1).padStart(2, '0')).replace(/\{DD\}/g, String(new Date().getDate()).padStart(2, '0')).replace(/\{SEQ:(\d+)\}/g, (mm, n) => '1'.padStart(Number(n), '0'));
            return `<tr>
              <td><b>${U.esc(e.label || k)}</b><div class="tiny muted mono">${U.esc(k)}</div></td>
              <td><input type="text" data-num="${k}" data-part="prefix" value="${U.attr(r.prefix)}" style="width:90px"/></td>
              <td><input type="text" data-num="${k}" data-part="pattern" value="${U.attr(r.pattern)}" class="mono" style="min-width:220px"/></td>
              <td><span class="badge soft mono" id="preview-${k}">${U.esc(sample)}</span></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div></div>`;
      p.querySelectorAll('[data-num]').forEach((inp) => (inp.oninput = () => {
        settings.numbering[inp.dataset.num][inp.dataset.part] = inp.value;
        const r = settings.numbering[inp.dataset.num];
        const sample = r.pattern.replace(/\{PREFIX\}/g, r.prefix).replace(/\{YYYY\}/g, new Date().getFullYear()).replace(/\{YY\}/g, String(new Date().getFullYear()).slice(-2)).replace(/\{MM\}/g, String(new Date().getMonth() + 1).padStart(2, '0')).replace(/\{SEQ:(\d+)\}/g, (mm, n) => '1'.padStart(Number(n), '0'));
        p.querySelector('#preview-' + inp.dataset.num).textContent = sample;
      }));
    }

    function renderDep(p) {
      const d = settings.depreciation;
      p.innerHTML = `<div class="card"><div class="card-body"><div class="form-grid">
        <div class="field"><label>Phương pháp khấu hao mặc định</label><select id="dep-method">
          ${App.state.enums.depreciationMethods.map((x) => `<option value="${x.value}" ${d.defaultMethod === x.value ? 'selected' : ''}>${U.esc(x.label)}</option>`).join('')}
        </select></div>
        ${fldFull('depreciation.defaultUsefulLifeMonths', 'Thời gian sử dụng mặc định (tháng)', d.defaultUsefulLifeMonths, 1, 'number')}
        ${fldFull('depreciation.defaultRate', 'Tỷ lệ khấu hao mặc định (%/năm)', d.defaultRate, 1, 'number')}
        ${fldFull('depreciation.minValue', 'Giá trị tối thiểu ghi nhận TSCĐ (VNĐ)', d.minValue, 1, 'number')}
        ${fldFull('depreciation.expenseAccount', 'Tài khoản chi phí (Nợ)', d.expenseAccount)}
        ${fldFull('depreciation.assetAccount', 'Tài khoản khấu hao (Có)', d.assetAccount)}
        <div class="field span-2"><label class="checkbox"><input type="checkbox" id="dep-fullmonth" ${d.fullMonthRule ? 'checked' : ''}/> <span>Áp dụng nguyên tắc tháng tròn (tính khấu hao từ ngày tròn tháng)</span></label></div>
      </div>
      <div class="alert info">Các giá trị này được gợi ý sẵn khi thêm tài sản mới và dùng khi chạy khấu hao tự động.</div></div></div>`;
      p.querySelector('#dep-method').onchange = (e) => (settings.depreciation.defaultMethod = e.target.value);
      p.querySelector('#dep-fullmonth').onchange = (e) => (settings.depreciation.fullMonthRule = e.target.checked);
      bindFields(p, 'depreciation');
    }

    function renderNotify(p) {
      const n = settings.notifications;
      p.innerHTML = `<div class="card"><div class="card-body"><div class="form-grid">
        ${fldFull('notifications.maintenanceDaysBefore', 'Cảnh báo trước hạn bảo trì (ngày)', n.maintenanceDaysBefore, 1, 'number')}
        ${fldFull('notifications.warrantyDaysBefore', 'Cảnh báo trước hết bảo hành (ngày)', n.warrantyDaysBefore, 1, 'number')}
        <div class="field span-2"><label class="checkbox"><input type="checkbox" id="nt-email" ${n.emailEnabled ? 'checked' : ''}/> <span>Bật gửi email thông báo (cần cấu hình SMTP tại máy chủ)</span></label></div>
      </div>
      <div class="field"><label>Mẫu email nhắc bảo trì</label><textarea id="nt-tpl1" rows="5" class="mono" style="font-size:12px">${U.esc(n.emailTemplateMaintenance)}</textarea>
        <div class="hint">Biến: {fullName} {assetName} {assetCode} {dueDate} {companyName}</div></div>
      <div class="field"><label>Mẫu email bàn giao tài sản</label><textarea id="nt-tpl2" rows="5" class="mono" style="font-size:12px">${U.esc(n.emailTemplateAssign)}</textarea>
        <div class="hint">Biến: {fullName} {assetName} {assetCode} {date} {companyName}</div></div>
      </div></div>`;
      p.querySelector('#nt-email').onchange = (e) => (settings.notifications.emailEnabled = e.target.checked);
      p.querySelector('#nt-tpl1').oninput = (e) => (settings.notifications.emailTemplateMaintenance = e.target.value);
      p.querySelector('#nt-tpl2').oninput = (e) => (settings.notifications.emailTemplateAssign = e.target.value);
      bindFields(p, 'notifications');
    }

    function renderSystem(p) {
      const s = settings.system;
      p.innerHTML = `<div class="card"><div class="card-body"><div class="form-grid">
        ${fldFull('system.appName', 'Tên ngắn ứng dụng', s.appName)}
        ${fldFull('system.version', 'Phiên bản', s.version)}
        ${fldFull('system.dateFormat', 'Định dạng ngày', s.dateFormat)}
        ${fldFull('system.currency', 'Tiền tệ', s.currency)}
        ${fldFull('system.currencySymbol', 'Ký hiệu tiền tệ', s.currencySymbol)}
        ${fldFull('system.digits', 'Số chữ số thập phân', s.digits, 1, 'number')}
        ${fldFull('system.sessionHours', 'Thời hạn phiên đăng nhập (giờ)', s.sessionHours, 1, 'number')}
        ${fldFull('system.passwordMinLength', 'Độ dài mật khẩu tối thiểu', s.passwordMinLength, 1, 'number')}
        ${fldFull('system.lockAfterFailed', 'Khoá tài khoản sau số lần sai', s.lockAfterFailed, 1, 'number')}
        ${fldFull('system.defaultPaper', 'Khổ giấy mặc định', s.defaultPaper)}
        ${fldFull('system.rowsPerPage', 'Số dòng mỗi trang', s.rowsPerPage, 1, 'number')}
        ${fldFull('system.footerText', 'Dòng chân trang báo cáo', s.footerText, 2)}
      </div></div></div>`;
      bindFields(p, 'system');
    }

    function fldFull(path, label, value, span, type) {
      return `<div class="field ${span === 2 ? 'span-2' : ''}" data-path="${path}">
        <label>${U.esc(label)}</label>
        <input type="${type || 'text'}" value="${U.attr(value === undefined || value === null ? '' : value)}" ${type === 'number' ? 'step="any"' : ''}/>
      </div>`;
    }
    function bindFields(scope, group) {
      scope.querySelectorAll('[data-path]').forEach((wrap) => {
        const path = wrap.dataset.path;
        const input = wrap.querySelector('input');
        input.oninput = () => {
          const [g, k] = path.split('.');
          settings[g][k] = input.type === 'number' ? Number(input.value) : input.value;
        };
      });
    }

    container.querySelector('#st-save').onclick = async () => {
      if (!App.can('settings', 'update')) return UI.toast('Không có quyền', 'Bạn không được phép sửa cấu hình', 'error');
      UI.loading(true, 'Đang lưu cấu hình…');
      try {
        const res = await API.put('/api/settings', { patch: settings });
        UI.loading(false);
        App.state.settings = Object.assign({}, App.state.settings, res.data);
        UI.toast('Đã lưu cấu hình hệ thống', 'Áp dụng ngay cho toàn hệ thống', 'success');
      } catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
    };
  };

  /* ============================== Sao lưu & phục hồi ============================== */

  Admin.backup = async function (container) {
    if (!App.can('backup', 'view')) { container.innerHTML = UI.emptyState('🔒', 'Không có quyền', ''); return; }
    container.innerHTML = head('💾 Sao lưu & Phục hồi dữ liệu', 'Tạo bản sao lưu, tải xuống, tải lên và phục hồi CSDL',
      '<button class="btn primary" id="bk-new">💾 Tạo bản sao lưu mới</button>');
    const host = document.createElement('div');
    container.appendChild(host);
    const load = async () => {
      const res = await API.get('/api/admin/backups');
      const rows = res.data || [];
      host.innerHTML = `
        <div class="alert info mb">Bản sao lưu được lưu tại <code class="mono">data/backups/</code> trên máy chủ. Hệ thống tự động tạo bản sao lưu trước các thao tác nguy hiểm (phục hồi, nhập CSDL, reset dữ liệu).</div>
        <div class="card">
          <div class="card-head"><h3>Danh sách bản sao lưu (${rows.length})</h3>
            <div class="right">
              <button class="btn sm" id="bk-upload">⬆ Tải lên file sao lưu (.json)</button>
            </div>
          </div>
          <div class="table-wrap"><table class="data compact">
            <thead><tr><th>Tên file</th><th>Thời điểm</th><th class="num">Kích thước</th><th class="ctr">Hành động</th></tr></thead>
            <tbody>${rows.length ? rows.map((b) => `<tr>
              <td class="mono tiny">${U.esc(b.file)}</td>
              <td>${U.datetime(b.at)}</td>
              <td class="num">${(b.size / 1024).toFixed(1)} KB</td>
              <td class="ctr nowrap">
                <button class="btn sm" data-dl="${U.attr(b.file)}">⬇ Tải xuống</button>
                <button class="btn sm warning" data-rs="${U.attr(b.file)}">♻️ Phục hồi</button>
              </td></tr>`).join('') : '<tr><td colspan="4" class="empty">Chưa có bản sao lưu nào</td></tr>'}</tbody>
          </table></div>
        </div>`;
      host.querySelectorAll('[data-rs]').forEach((b) => (b.onclick = async () => {
        const okd = await UI.confirm({
          title: 'Phục hồi CSDL từ bản sao lưu?',
          message: `Toàn bộ dữ liệu hiện tại sẽ bị <b>thay thế</b> bằng nội dung của <code class="mono">${U.esc(b.dataset.rs)}</code>.<br/>Hệ thống sẽ tự động sao lưu trạng thái hiện tại trước khi phục hồi.`,
          danger: true, confirmText: '♻️ Phục hồi ngay',
        });
        if (!okd) return;
        UI.loading(true, 'Đang phục hồi dữ liệu…');
        try {
          await API.post('/api/admin/restore-backup', { file: b.dataset.rs });
          UI.loading(false);
          UI.toast('Phục hồi thành công', 'Hệ thống sẽ tải lại dữ liệu', 'success');
          setTimeout(() => location.reload(), 1200);
        } catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
      }));
      host.querySelectorAll('[data-dl]').forEach((b) => (b.onclick = async () => {
        try {
          const res = await fetch('/api/admin/db/export', { credentials: 'same-origin' });
          const blob = await res.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = b.dataset.dl;
          a.click();
          UI.toast('Đang tải bản sao lưu', '', 'success');
        } catch (e) { UI.toast('Lỗi', e.message, 'error'); }
      }));
      const up = host.querySelector('#bk-upload');
      if (up) up.onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = () => {
          const file = input.files[0];
          const reader = new FileReader();
          reader.onload = async () => {
            UI.loading(true, 'Đang tải lên…');
            try {
              await API.post('/api/admin/upload-backup', { content: String(reader.result) });
              UI.loading(false); UI.toast('Đã tải lên bản sao lưu', '', 'success'); load();
            } catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
          };
          reader.readAsText(file);
        };
        input.click();
      };
    };
    container.querySelector('#bk-new').onclick = async () => {
      UI.loading(true, 'Đang sao lưu…');
      try { const r = await API.post('/api/admin/backup', {}); UI.loading(false); UI.toast('Đã tạo bản sao lưu', r.data.file, 'success'); load(); }
      catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
    };
    await load();
  };

  /* ============================== Công cụ dữ liệu ============================== */

  Admin.dataTools = async function (container) {
    if (!App.can('data_tools', 'view')) { container.innerHTML = UI.emptyState('🔒', 'Không có quyền', ''); return; }
    container.innerHTML = head('🧰 Công cụ dữ liệu & CSDL', 'Xuất/nhập CSDL, kết xuất script SQL, thùng rác và khởi tạo dữ liệu mẫu');
    const host = document.createElement('div');
    container.appendChild(host);
    const stats = await API.get('/api/admin/system');
    const collections = stats.data.database.collections;

    host.innerHTML = `
      <div class="grid cols-2 mb">
        <div class="card">
          <div class="card-head"><h3>⬇ Kết xuất dữ liệu</h3></div>
          <div class="card-body">
            <p class="muted">Tải toàn bộ CSDL dưới dạng JSON (dùng để sao lưu ngoài hoặc chuyển máy chủ).</p>
            <button class="btn primary block mb" id="dt-json">📦 Tải CSDL JSON đầy đủ</button>
            <p class="muted mt">Kết xuất script SQL để chuyển sang MySQL / PostgreSQL.</p>
            <div class="row">
              <button class="btn block" id="dt-mysql">🐬 MySQL</button>
              <button class="btn block" id="dt-pg">🐘 PostgreSQL</button>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>⬆ Nhập dữ liệu</h3></div>
          <div class="card-body">
            <p class="muted">Nhập CSDL từ file JSON đã kết xuất. Hệ thống sẽ tự sao lưu trước khi nhập.</p>
            <div class="dropzone" id="dt-drop">📄 Kéo thả file <b>.json</b> vào đây hoặc bấm để chọn
              <input type="file" id="dt-file" accept=".json" class="hidden"/></div>
            <div id="dt-result" class="mt"></div>
          </div>
        </div>
      </div>
      <div class="card mb">
        <div class="card-head"><h3>🗑 Thùng rác & dữ liệu đã xoá</h3><span class="sub">Khôi phục bản ghi đã xoá mềm</span></div>
        <div class="table-wrap"><table class="data compact">
          <thead><tr><th>Phân hệ</th><th class="num">Đang dùng</th><th class="num">Trong thùng rác</th><th class="ctr">Thao tác</th></tr></thead>
          <tbody>${collections.filter((c) => c.deleted > 0 || true).map((c) => `<tr>
            <td><b>${U.esc(c.label)}</b> <span class="tiny muted mono">${U.esc(c.name)}</span></td>
            <td class="num">${U.num(c.count - c.deleted)}</td>
            <td class="num">${c.deleted ? `<span class="badge" style="background:#fee2e2;color:#b91c1c">${U.num(c.deleted)}</span>` : '—'}</td>
            <td class="ctr">${c.deleted ? `<button class="btn sm" data-trash="${U.attr(c.name)}">Xem & khôi phục</button>` : ''}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>⚠️ Vùng nguy hiểm</h3></div>
        <div class="card-body">
          <div class="alert danger mb">Các thao tác dưới đây ảnh hưởng toàn bộ hệ thống. Hệ thống luôn tạo bản sao lưu trước khi thực hiện.</div>
          <div class="row wrap" style="gap:8px">
            <button class="btn danger" id="dt-reset">🔄 Khởi tạo lại dữ liệu mẫu (reset)</button>
            <button class="btn" id="dt-audit">🧹 Xoá toàn bộ nhật ký</button>
          </div>
        </div>
      </div>`;

    host.querySelector('#dt-json').onclick = () => API.download('/api/admin/db/export', 'GET', null, `ams-database-${U.today()}.json`).then(() => UI.toast('Đang tải CSDL…', '', 'success'));
    host.querySelector('#dt-mysql').onclick = () => API.download('/api/admin/db/export-sql?dialect=mysql', 'GET', null, `ams-mysql-${U.today()}.sql`).then(() => UI.toast('Đang kết xuất SQL…', '', 'success'));
    host.querySelector('#dt-pg').onclick = () => API.download('/api/admin/db/export-sql?dialect=postgres', 'GET', null, `ams-postgres-${U.today()}.sql`).then(() => UI.toast('Đang kết xuất SQL…', '', 'success'));

    const drop = host.querySelector('#dt-drop');
    const fileInput = host.querySelector('#dt-file');
    drop.onclick = () => fileInput.click();
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); readDb(e.dataTransfer.files[0]); };
    fileInput.onchange = () => readDb(fileInput.files[0]);

    function readDb(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const result = host.querySelector('#dt-result');
        let payload;
        try { payload = JSON.parse(String(reader.result)); }
        catch (e) { result.innerHTML = '<div class="alert danger">File JSON không hợp lệ.</div>'; return; }
        const data = payload.data || payload;
        const counts = Object.keys(data.collections || {}).map((k) => `${k}: ${data.collections[k].length}`).join(' • ');
        result.innerHTML = `<div class="alert warning"><div><b>File hợp lệ.</b><br/><span class="tiny">${U.esc(counts)}</span></div></div>`;
        const okd = await UI.confirm({
          title: 'Nhập CSDL từ file?',
          message: 'Toàn bộ dữ liệu hiện tại sẽ bị thay thế bằng nội dung file. Hệ thống đã tự sao lưu trạng thái hiện tại.',
          danger: true, confirmText: '⬆ Nhập dữ liệu',
        });
        if (!okd) return;
        UI.loading(true, 'Đang nhập CSDL…');
        try {
          await API.post('/api/admin/db/import', { data });
          UI.loading(false);
          UI.toast('Nhập CSDL thành công', 'Đang tải lại hệ thống…', 'success');
          setTimeout(() => location.reload(), 1500);
        } catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
      };
      reader.readAsText(file);
    }

    host.querySelectorAll('[data-trash]').forEach((b) => (b.onclick = () => Admin.trashDialog(b.dataset.trash)));
    host.querySelector('#dt-reset').onclick = async () => {
      const okd = await UI.confirm({
        title: 'Khởi tạo lại dữ liệu mẫu?',
        message: 'Toàn bộ dữ liệu hiện tại sẽ bị <b>xoá và thay bằng dữ liệu mẫu</b> ban đầu (bao gồm tài khoản admin / Admin@123).<br/>Hệ thống đã tự sao lưu trước khi thực hiện.',
        danger: true, confirmText: '🔄 Reset dữ liệu',
      });
      if (!okd) return;
      UI.loading(true, 'Đang khởi tạo lại dữ liệu…');
      try { await API.post('/api/admin/reset-demo', { confirm: 'RESET' }); UI.loading(false); UI.toast('Đã reset dữ liệu mẫu', 'Đang tải lại…', 'success'); setTimeout(() => location.reload(), 1500); }
      catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
    };
    host.querySelector('#dt-audit').onclick = async () => {
      const okd = await UI.confirm({ title: 'Xoá toàn bộ nhật ký?', message: 'Hành động không thể hoàn tác.', danger: true });
      if (!okd) return;
      try { const r = await API.del('/api/admin/audit-logs'); UI.toast('Đã xoá', r.data.deleted + ' bản ghi', 'success'); }
      catch (e) { UI.toast('Lỗi', e.message, 'error'); }
    };
  };

  Admin.trashDialog = async function (entityName) {
    const entity = App.state.entities[entityName];
    const res = await API.get(`/api/entities/${entityName}/trash`);
    const rows = res.data || [];
    const m = UI.modal({
      size: 'lg',
      title: 'Thùng rác: ' + entity.label,
      subtitle: rows.length + ' bản ghi đã xoá',
      body: rows.length ? `<div class="table-wrap" style="max-height:56vh;border:1px solid var(--border);border-radius:8px">
        <table class="data compact"><thead><tr><th>Mã</th><th>Tên</th><th>Người xoá</th><th>Thời điểm xoá</th><th></th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td class="mono">${U.esc(r[entity.codeField] || r.id)}</td>
          <td>${U.esc(r.name || r.fullName || r.title || '')}</td>
          <td>${U.esc(r.deletedBy || '')}</td>
          <td>${U.datetime(r.deletedAt)}</td>
          <td class="ctr"><button class="btn sm success" data-rs="${r.id}">♻️ Khôi phục</button>
            <button class="btn sm danger" data-hard="${r.id}">Xoá vĩnh viễn</button></td>
        </tr>`).join('')}</tbody></table></div>` : UI.emptyState('🗑', 'Thùng rác trống', ''),
      footer: [{ label: 'Đóng', onClick: (mm) => mm.close() }],
    });
    m.body.querySelectorAll('[data-rs]').forEach((b) => (b.onclick = async () => {
      try { await API.post(`/api/entities/${entityName}/${b.dataset.rs}/restore`, {}); UI.toast('Đã khôi phục', '', 'success'); m.close(); Admin.trashDialog(entityName); }
      catch (e) { UI.toast('Lỗi', e.message, 'error'); }
    }));
    m.body.querySelectorAll('[data-hard]').forEach((b) => (b.onclick = async () => {
      const okd = await UI.confirm({ title: 'Xoá vĩnh viễn?', message: 'Bản ghi sẽ bị xoá hoàn toàn khỏi CSDL và không thể khôi phục.', danger: true });
      if (!okd) return;
      try { await API.del(`/api/entities/${entityName}/${b.dataset.hard}?hard=1`); UI.toast('Đã xoá vĩnh viễn', '', 'success'); m.close(); Admin.trashDialog(entityName); }
      catch (e) { UI.toast('Lỗi', e.message, 'error'); }
    }));
  };

  /* ============================== Menu quản trị ============================== */

  Admin.menu = function (container) {
    const cards = [
      { href: '#/admin/system', icon: '🖥️', title: 'Trạng thái hệ thống', desc: 'Thông tin máy chủ, CSDL, tiến trình, dung lượng' },
      { href: '#/admin/users', icon: '👥', title: 'Người dùng', desc: 'Tài khoản, vai trò, phòng ban, trạng thái' },
      { href: '#/admin/roles', icon: '🛡️', title: 'Vai trò & phân quyền', desc: 'Ma trận quyền theo 22 phân hệ × 6 hành động' },
      { href: '#/admin/audit', icon: '📜', title: 'Nhật ký hệ thống', desc: 'Mọi thao tác, thay đổi dữ liệu, đăng nhập' },
      { href: '#/admin/sessions', icon: '🔑', title: 'Phiên đăng nhập', desc: 'Thiết bị đang truy cập, thu hồi từ xa' },
      { href: '#/admin/settings', icon: '⚙️', title: 'Cấu hình hệ thống', desc: 'Doanh nghiệp, đánh mã, khấu hao, thông báo' },
      { href: '#/admin/backup', icon: '💾', title: 'Sao lưu & phục hồi', desc: 'Tạo, tải, phục hồi bản sao lưu CSDL' },
      { href: '#/admin/data', icon: '🧰', title: 'Công cụ dữ liệu', desc: 'Xuất JSON/SQL, nhập CSDL, thùng rác, reset' },
    ];
    container.innerHTML = head('🛠️ Quản trị hệ thống', 'Trung tâm điều khiển dành cho quản trị viên');
    const host = document.createElement('div');
    host.innerHTML = `<div class="grid cols-3">${cards.map((c) => `
      <a class="card" href="${c.href}" style="text-decoration:none;color:inherit">
        <div class="card-body">
          <div style="font-size:28px">${c.icon}</div>
          <h3 style="margin:8px 0 4px;font-size:15px">${U.esc(c.title)}</h3>
          <div class="muted tiny">${U.esc(c.desc)}</div>
        </div>
      </a>`).join('')}</div>`;
    container.appendChild(host);
  };
})();
