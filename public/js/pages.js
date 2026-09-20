/* ==========================================================================
   pages.js — Các trang nghiệp vụ: danh sách, chi tiết, biểu mẫu, thao tác
   ========================================================================== */
(function () {
  'use strict';
  const U = App.U;
  const API = App.api;
  const Pages = {};
  window.Pages = Pages;

  /* ============================== Tiện ích chung ============================== */

  function pageHead(title, subtitle, actionsHTML, icon) {
    return `<div class="page-head">
      <div>
        <h1>${icon ? icon + ' ' : ''}${U.esc(title)}</h1>
        ${subtitle ? `<div class="sub">${subtitle}</div>` : ''}
      </div>
      <div class="actions">${actionsHTML || ''}</div>
    </div>`;
  }
  Pages.pageHead = pageHead;

  /** Sinh định nghĩa cột từ metadata của thực thể */
  function columnsFor(entityName) {
    const entity = App.state.entities[entityName];
    const fields = entity.listFields && entity.listFields.length ? entity.listFields : Object.keys(entity.fields).slice(0, 8);
    return fields.map((key) => {
      const f = entity.fields[key] || (entity.virtual && entity.virtual[key]) || { label: key, type: 'string' };
      return {
        key,
        label: f.label || key,
        align: ['money', 'number', 'percent'].includes(f.type) ? 'num' : ['date', 'datetime'].includes(f.type) ? 'ctr' : '',
        render: (row) => App.formatField(entityName, key, row[key], row),
      };
    });
  }
  Pages.columnsFor = columnsFor;

  /** Nút hành động trên dòng */
  function rowActions(entityName, opts) {
    const o = opts || {};
    const entity = App.state.entities[entityName];
    const acts = [];
    if (App.can(entity.perm, 'view')) acts.push({ label: 'Xem', icon: '👁', title: 'Xem chi tiết', onClick: (row) => App.Router.navigate(`/${entityName}/${row.id}`) });
    if (App.can(entity.perm, 'update') && !o.readonly) acts.push({ label: 'Sửa', icon: '✏️', title: 'Sửa', onClick: (row) => UI.recordDialog(entityName, row, { onSaved: () => o.reload && o.reload() }) });
    if (App.can(entity.perm, 'delete') && !o.readonly) acts.push({ label: 'Xoá', icon: '🗑', title: 'Xoá', onClick: async (row) => {
      const okd = await UI.confirm({ title: 'Xoá bản ghi?', message: `Bạn chắc chắn muốn xoá <b>${U.esc(row[entity.codeField] || '')} — ${U.esc(row.name || row.fullName || row.title || '')}</b>?<br/><span class="muted tiny">Bản ghi sẽ được chuyển vào thùng rác và có thể khôi phục.</span>`, danger: true, confirmText: 'Xoá' });
      if (!okd) return;
      try { await API.del(`/api/entities/${entityName}/${row.id}`); UI.toast('Đã xoá', '', 'success'); o.reload && o.reload(); }
      catch (e) { UI.toast('Không xoá được', e.message, 'error'); }
    } });
    if (o.extraActions) acts.push.apply(acts, o.extraActions);
    return acts;
  }

  /* ============================== Trang danh sách thực thể ============================== */

  Pages.entityList = async function (entityName, container, opts) {
    const o = opts || {};
    const entity = App.state.entities[entityName];
    if (!entity) { container.innerHTML = UI.emptyState('❓', 'Không tìm thấy phân hệ', entityName); return; }
    if (!App.can(entity.perm, 'view')) {
      container.innerHTML = UI.emptyState('🔒', 'Không có quyền truy cập', `Vai trò của bạn không được phép xem phân hệ ${entity.label}.`);
      return;
    }

    const filters = buildFilters(entityName);
    const extraActions = typeof o.extraActions === 'function' ? o.extraActions() : (o.extraActions || []);

    container.innerHTML = pageHead(
      o.title || entity.label,
      o.subtitle || `Quản lý ${entity.label.toLowerCase()} — tổng hợp, tra cứu, cập nhật và in báo cáo.`,
      `${App.can(entity.perm, 'create') && !o.readonly ? `<button class="btn primary" id="btn-add">＋ Thêm ${U.esc(entity.singular.toLowerCase())}</button>` : ''}
       ${o.headActions || ''}`
    ) + `<div id="list-host"></div>` + (o.footerHTML || '');

    const addBtn = container.querySelector('#btn-add');
    if (addBtn) addBtn.onclick = () => UI.recordDialog(entityName, o.defaults || null, { onSaved: () => table.reload() });

    const table = await UI.dataTable(container.querySelector('#list-host'), {
      entity: entityName,
      columns: o.columns || columnsFor(entityName),
      filters,
      selectable: App.can(entity.perm, 'delete'),
      importable: !o.readonly,
      rowActions: rowActions(entityName, { reload: () => table.reload(), readonly: o.readonly, extraActions }),
      bulkActions: [
        ...(App.can(entity.perm, 'delete') ? [{
          label: '🗑 Xoá nhiều bản ghi', cls: 'danger',
          onClick: async (ids, api2) => {
            const okd = await UI.confirm({ title: `Xoá ${ids.length} bản ghi?`, message: 'Các bản ghi sẽ được chuyển vào thùng rác.', danger: true, confirmText: 'Xoá tất cả' });
            if (!okd) return;
            UI.loading(true, 'Đang xoá…');
            for (const id of ids) { try { await API.del(`/api/entities/${entityName}/${id}`); } catch (e) {} }
            UI.loading(false);
            UI.toast('Đã xoá', `${ids.length} bản ghi đã chuyển vào thùng rác`, 'success');
            api2.clear(); table.reload();
          },
        }] : []),
        {
          label: '⬇ Xuất CSV (đã chọn)', onClick: (ids) => {
            const fields = Object.keys(entity.fields).filter((f) => !['json', 'password'].includes(entity.fields[f].type));
            API.download(`/api/entities/${entityName}/export.csv?fields=${fields.join(',')}`, 'GET').then(() => UI.toast('Đang tải file…', '', 'success'));
          },
        },
      ],
      onRowClick: (row) => App.Router.navigate(`/${entityName}/${row.id}`),
      emptyText: `Chưa có ${entity.label.toLowerCase()} nào. ${App.can(entity.perm, 'create') ? 'Bấm "Thêm mới" để bắt đầu.' : ''}`,
    });
    if (o.onReady) o.onReady(table, container);
    return table;
  };

  function buildFilters(entityName) {
    switch (entityName) {
      case 'assets':
        return [
          { key: 'status', label: 'Trạng thái', type: 'select', options: App.state.enums.assetStatus },
          { key: 'condition', label: 'Tình trạng', type: 'select', options: App.state.enums.assetCondition },
          { key: 'departmentId', label: 'Phòng ban', type: 'ref', ref: 'departments' },
          { key: 'locationId', label: 'Vị trí', type: 'ref', ref: 'locations' },
          { key: 'categoryId', label: 'Danh mục', type: 'ref', ref: 'categories' },
          { key: 'assigneeId', label: 'Người sử dụng', type: 'ref', ref: 'users' },
          { key: 'purchaseDate', label: 'Mua từ ngày', type: 'date', op: 'from' },
          { key: 'purchaseDate', label: 'Đến ngày', type: 'date', op: 'to' },
        ];
      case 'assignments':
        return [
          { key: 'type', label: 'Loại phiếu', type: 'select', options: [
            { value: 'assign', label: 'Cấp phát' }, { value: 'recover', label: 'Thu hồi' },
            { value: 'lend', label: 'Cho mượn' }, { value: 'return', label: 'Trả lại' }] },
          { key: 'status', label: 'Trạng thái', type: 'select', options: App.state.enums.workflowStatus },
          { key: 'departmentId', label: 'Phòng ban', type: 'ref', ref: 'departments' },
          { key: 'date', label: 'Từ ngày', type: 'date', op: 'from' },
          { key: 'date', label: 'Đến ngày', type: 'date', op: 'to' },
        ];
      case 'transfers':
        return [
          { key: 'status', label: 'Trạng thái', type: 'select', options: App.state.enums.workflowStatus },
          { key: 'toDepartmentId', label: 'Đến phòng ban', type: 'ref', ref: 'departments' },
          { key: 'date', label: 'Từ ngày', type: 'date', op: 'from' },
          { key: 'date', label: 'Đến ngày', type: 'date', op: 'to' },
        ];
      case 'maintenances':
        return [
          { key: 'status', label: 'Trạng thái', type: 'select', options: App.state.enums.workflowStatus },
          { key: 'type', label: 'Loại bảo trì', type: 'select', options: App.state.enums.maintenanceTypes },
          { key: 'priority', label: 'Ưu tiên', type: 'select', options: App.state.enums.priority },
          { key: 'actualDate', label: 'Từ ngày', type: 'date', op: 'from' },
        ];
      case 'depreciations':
        return [
          { key: 'period', label: 'Kỳ (YYYY-MM)', type: 'text' },
          { key: 'status', label: 'Trạng thái', type: 'select', options: [{ value: 'posted', label: 'Đã ghi sổ' }, { value: 'draft', label: 'Nháp' }] },
          { key: 'assetId', label: 'Tài sản', type: 'ref', ref: 'assets' },
        ];
      case 'disposals':
        return [
          { key: 'status', label: 'Trạng thái', type: 'select', options: App.state.enums.workflowStatus },
          { key: 'type', label: 'Hình thức', type: 'select', options: App.state.enums.disposalTypes },
        ];
      case 'warranties':
        return [{ key: 'status', label: 'Trạng thái', type: 'select', options: [
          { value: 'active', label: 'Đang hiệu lực' }, { value: 'expiring', label: 'Sắp hết hạn' }, { value: 'expired', label: 'Hết hạn' },
          { value: 'claimed', label: 'Đã yêu cầu' }, { value: 'resolved', label: 'Đã xử lý' }] }];
      case 'stocktakes':
        return [{ key: 'status', label: 'Trạng thái', type: 'select', options: [
          { value: 'open', label: 'Đang kiểm kê' }, { value: 'closed', label: 'Đã chốt' }, { value: 'cancelled', label: 'Đã huỷ' }] }];
      case 'users':
        return [
          { key: 'departmentId', label: 'Phòng ban', type: 'ref', ref: 'departments' },
          { key: 'roleId', label: 'Vai trò', type: 'ref', ref: 'roles' },
          { key: 'status', label: 'Trạng thái', type: 'select', options: [
            { value: 'active', label: 'Hoạt động' }, { value: 'locked', label: 'Đã khoá' },
            { value: 'pending', label: 'Chờ kích hoạt' }, { value: 'resigned', label: 'Đã nghỉ việc' }] },
        ];
      case 'audit_logs':
        return [
          { key: 'action', label: 'Hành động', type: 'select', options: [
            'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'APPROVE', 'REJECT', 'IMPORT', 'EXPORT', 'RUN', 'CONFIG', 'RESTORE_DB'
          ].map((a) => ({ value: a, label: a })) },
          { key: 'username', label: 'Người dùng', type: 'text' },
          { key: 'entity', label: 'Đối tượng', type: 'text' },
          { key: 'createdAt', label: 'Từ ngày', type: 'date', op: 'from' },
          { key: 'createdAt', label: 'Đến ngày', type: 'date', op: 'to' },
        ];
      case 'report_templates':
        return [{ key: 'dataset', label: 'Nguồn dữ liệu', type: 'text' }];
      case 'attachments':
        return [
          { key: 'entity', label: 'Đối tượng', type: 'text' },
          { key: 'type', label: 'Phân loại', type: 'select', options: [
            { value: 'invoice', label: 'Hoá đơn' }, { value: 'contract', label: 'Hợp đồng' }, { value: 'handover', label: 'Biên bản bàn giao' },
            { value: 'photo', label: 'Hình ảnh' }, { value: 'manual', label: 'Tài liệu kỹ thuật' }, { value: 'other', label: 'Khác' }] },
        ];
      default:
        return [];
    }
  }
  Pages.buildFilters = buildFilters;

  /* ============================== Trang chi tiết ============================== */

  Pages.entityDetail = async function (entityName, id, container) {
    const entity = App.state.entities[entityName];
    if (!App.can(entity.perm, 'view')) { container.innerHTML = UI.emptyState('🔒', 'Không có quyền truy cập', ''); return; }

    let res;
    try { res = await API.get(`/api/entities/${entityName}/${id}`); }
    catch (e) { container.innerHTML = UI.emptyState('⚠️', 'Không tải được bản ghi', e.message, '<a class="btn" href="#/' + entityName + '">Quay lại danh sách</a>'); return; }

    const row = res.data;
    const related = res.meta && res.meta.related ? res.meta.related : {};
    const title = row.name || row.fullName || row.title || row.code || ('#' + id);

    container.innerHTML = pageHead(title, buildSubtitle(entityName, row), buildDetailActions(entityName, row, container), '📄')
      + `<div class="detail-grid"><div id="detail-main"></div><div id="detail-side"></div></div>`;

    /* --- Tab chính --- */
    const tabs = [{ key: 'info', label: '📋 Thông tin chi tiết', render: (host) => renderInfoTable(host, entityName, row) }];

    if (entityName === 'assets') {
      tabs.push({ key: 'dep', label: '📉 Khấu hao', badge: (related.depreciations || []).length, render: (host) => renderRelatedTable(host, 'depreciations', related.depreciations || [], ['period', 'depreciationAmount', 'accumulated', 'closingValue', 'status']) });
      tabs.push({ key: 'his', label: '🔄 Vòng đời', render: (host) => renderAssetTimeline(host, row.id) });
      tabs.push({ key: 'asg', label: '🤝 Cấp phát', badge: (related.assignments || []).length, render: (host) => renderRelatedTable(host, 'assignments', related.assignments || [], ['code', 'type', 'toUserName', 'date', 'status']) });
      tabs.push({ key: 'trf', label: '🔀 Điều chuyển', badge: (related.transfers || []).length, render: (host) => renderRelatedTable(host, 'transfers', related.transfers || [], ['code', 'toDepartmentName', 'date', 'status']) });
      tabs.push({ key: 'mnt', label: '🔧 Bảo trì', badge: (related.maintenances || []).length, render: (host) => renderRelatedTable(host, 'maintenances', related.maintenances || [], ['code', 'type', 'actualDate', 'cost', 'status']) });
      tabs.push({ key: 'war', label: '🛡 Bảo hành', badge: (related.warranties || []).length, render: (host) => renderRelatedTable(host, 'warranties', related.warranties || [], ['code', 'provider', 'startDate', 'endDate', 'status']) });
      tabs.push({ key: 'att', label: '📎 Tài liệu', badge: (related.attachments || []).length, render: (host) => renderRelatedTable(host, 'attachments', related.attachments || [], ['name', 'type', 'size', 'uploadedBy', 'createdAt']) });
    }
    if (entityName === 'stocktakes') {
      tabs.push({ key: 'items', label: '✅ Kết quả kiểm kê', badge: (related.items || []).length, render: (host) => renderStocktakeItems(host, row, related.items || []) });
    }
    if (entityName === 'users') {
      tabs.push({ key: 'assets', label: '📦 Tài sản đang giữ', badge: (related.assets || []).length, render: (host) => renderRelatedTable(host, 'assets', related.assets || [], ['code', 'name', 'categoryName', 'originalCost', 'bookValue', 'status']) });
      tabs.push({ key: 'sessions', label: '🔑 Phiên đăng nhập', badge: (related.sessions || []).length, render: (host) => renderRelatedTable(host, 'sessions', related.sessions || [], ['createdAt', 'ip', 'userAgent', 'lastSeenAt', 'revokedAt']) });
      tabs.push({ key: 'logs', label: '📜 Nhật ký', badge: (related.logs || []).length, render: (host) => renderRelatedTable(host, 'audit_logs', related.logs || [], ['createdAt', 'action', 'entity', 'entityLabel', 'ip']) });
    }
    if (['departments', 'categories', 'locations', 'suppliers'].includes(entityName)) {
      tabs.push({ key: 'assets', label: '📦 Tài sản liên quan', badge: (related.assets || []).length, render: (host) => renderRelatedTable(host, 'assets', related.assets || [], ['code', 'name', 'assigneeName', 'originalCost', 'bookValue', 'status']) });
      if ((related.children || []).length) tabs.push({ key: 'children', label: '🌳 Cấp con', badge: related.children.length, render: (host) => renderRelatedTable(host, entityName, related.children || [], ['code', 'name', 'assetCount']) });
    }
    if (entityName === 'roles') {
      tabs.push({ key: 'perms', label: '🛡 Ma trận phân quyền', render: (host) => renderRolePerms(host, row) });
    }
    UI.tabs(container.querySelector('#detail-main'), tabs, App.state.route.query.tab || 'info');

    /* --- Cột bên --- */
    renderDetailSide(container.querySelector('#detail-side'), entityName, row, related);
  };

  function buildSubtitle(entityName, row) {
    const bits = [];
    if (row.code) bits.push(`<b class="mono">${U.esc(row.code)}</b>`);
    if (row.categoryName) bits.push(U.esc(row.categoryName));
    if (row.departmentName) bits.push('Phòng ban: ' + U.esc(row.departmentName));
    if (row.status) bits.push(App.formatField(entityName, 'status', row.status, row));
    return bits.join(' &nbsp;•&nbsp; ');
  }

  function buildDetailActions(entityName, row, container) {
    const btns = [];
    const docs = { assignments: 'assignment', transfers: 'transfer', maintenances: 'maintenance', disposals: 'disposal', stocktakes: 'stocktake', warranties: 'warranty', contracts: 'contract' };
    if (docs[entityName]) {
      btns.push(`<button class="btn" id="d-print">🖨 In chứng từ</button>`);
    }
    if (entityName === 'assets') {
      if (App.can('assets', 'create')) {
        btns.push(`<button class="btn" id="d-assign">🤝 Cấp phát</button>`);
        btns.push(`<button class="btn" id="d-transfer">🔀 Điều chuyển</button>`);
        btns.push(`<button class="btn" id="d-maintain">🔧 Bảo trì</button>`);
        btns.push(`<button class="btn" id="d-dispose">🗑 Thanh lý</button>`);
      }
      btns.push(`<button class="btn" id="d-label">🏷 In tem</button>`);
      btns.push(`<button class="btn" id="d-dep">📉 Bảng khấu hao</button>`);
    }
    if (entityName === 'transfers') {
      if (row.status === 'pending' && App.can('transfers', 'approve')) {
        btns.push('<button class="btn success" id="w-approve">✔ Duyệt</button>');
        btns.push('<button class="btn danger" id="w-reject">✖ Từ chối</button>');
      }
      if (row.status === 'approved' && App.can('transfers', 'update')) btns.push('<button class="btn primary" id="w-complete">🏁 Hoàn thành điều chuyển</button>');
    }
    if (entityName === 'disposals') {
      if (row.status === 'pending' && App.can('disposals', 'approve')) {
        btns.push('<button class="btn success" id="w-approve">✔ Duyệt thanh lý</button>');
        btns.push('<button class="btn danger" id="w-reject">✖ Từ chối</button>');
      }
      if (row.status === 'approved' && App.can('disposals', 'update')) btns.push('<button class="btn primary" id="w-complete">🏁 Hoàn tất thanh lý</button>');
    }
    if (entityName === 'maintenances') {
      if (['pending', 'approved'].includes(row.status) && App.can('maintenances', 'update')) btns.push('<button class="btn primary" id="w-start">▶ Bắt đầu thực hiện</button>');
      if (row.status === 'in_progress' && App.can('maintenances', 'update')) btns.push('<button class="btn success" id="w-complete">✔ Hoàn thành bảo trì</button>');
    }
    if (entityName === 'stocktakes') {
      if (row.status === 'open') {
        btns.push('<button class="btn primary" id="w-count">🧮 Kiểm kê</button>');
        if (App.can('stocktakes', 'approve')) btns.push('<button class="btn success" id="w-close">🔒 Chốt kiểm kê</button>');
      }
    }
    if (entityName === 'users') {
      if (App.can('users', 'update')) {
        btns.push('<button class="btn" id="u-reset">🔑 Đặt lại mật khẩu</button>');
        btns.push(`<button class="btn ${row.status === 'locked' ? 'success' : 'warning'}" id="u-lock">${row.status === 'locked' ? '🔓 Mở khoá' : '🔒 Khoá tài khoản'}</button>`);
      }
    }
    if (App.can(App.state.entities[entityName].perm, 'update')) btns.push('<button class="btn primary" id="d-edit">✏️ Sửa</button>');
    btns.push(`<a class="btn ghost" href="#/${entityName}">← Danh sách</a>`);

    setTimeout(() => {
      const $ = (s) => container.querySelector(s);
      if ($('#d-print')) $('#d-print').onclick = () => API.openHTML(`/api/documents/${docs[entityName]}/${row.id}`);
      if ($('#d-edit')) $('#d-edit').onclick = () => App.Router.navigate(`/${entityName}/${row.id}/edit`);
      if ($('#d-label')) $('#d-label').onclick = () => API.openHTML(`/api/documents/label/${row.id}`);
      if ($('#d-dep')) $('#d-dep').onclick = () => API.openHTML(`/api/documents/depreciation/${row.id}`);
      if ($('#d-assign')) $('#d-assign').onclick = () => Actions.assignDialog(row, () => App.Router.resolve());
      if ($('#d-transfer')) $('#d-transfer').onclick = () => Actions.transferDialog(row, () => App.Router.resolve());
      if ($('#d-maintain')) $('#d-maintain').onclick = () => Actions.maintenanceDialog(row, () => App.Router.resolve());
      if ($('#d-dispose')) $('#d-dispose').onclick = () => Actions.disposeDialog(row, () => App.Router.resolve());
      if ($('#w-approve')) $('#w-approve').onclick = () => Actions.workflow(entityName, row.id, 'approve', () => App.Router.resolve());
      if ($('#w-reject')) $('#w-reject').onclick = () => Actions.workflow(entityName, row.id, 'reject', () => App.Router.resolve());
      if ($('#w-complete')) $('#w-complete').onclick = () => Actions.workflow(entityName, row.id, 'complete', () => App.Router.resolve());
      if ($('#w-start')) $('#w-start').onclick = () => Actions.workflow(entityName, row.id, 'start', () => App.Router.resolve());
      if ($('#w-count')) $('#w-count').onclick = () => App.Router.navigate(`/stocktakes/${row.id}/count`);
      if ($('#w-close')) $('#w-close').onclick = () => Actions.closeStocktake(row, () => App.Router.resolve());
      if ($('#u-reset')) $('#u-reset').onclick = () => Actions.resetPassword(row);
      if ($('#u-lock')) $('#u-lock').onclick = () => Actions.toggleUser(row, () => App.Router.resolve());
    }, 0);
    return btns.join('');
  }

  function renderInfoTable(host, entityName, row) {
    const entity = App.state.entities[entityName];
    const groups = {};
    const order = [];
    Object.keys(entity.fields).forEach((fname) => {
      const f = entity.fields[fname];
      if (f.hidden && !f.computed) return;
      const g = f.group || 'Thông tin chung';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push({ name: fname, field: f, value: row[fname] });
    });
    host.innerHTML = order
      .map((g) => `
      <div class="card mb">
        <div class="card-head"><h3>${U.esc(g)}</h3></div>
        <div class="card-body">
          <dl class="info-list">
            ${groups[g].map((it) => `<dt>${U.esc(it.field.label)}</dt><dd>${it.field.type === 'json' ? '<span class="muted tiny">(dữ liệu ẩn)</span>' : App.formatField(entityName, it.name, it.value, row) || '<span class="muted">—</span>'}</dd>`).join('')}
          </dl>
        </div>
      </div>`)
      .join('');

    if (entityName === 'audit_logs' && row.changes) {
      const box = document.createElement('div');
      box.className = 'card';
      box.innerHTML = `<div class="card-head"><h3>Chi tiết thay đổi</h3></div><div class="card-body"><pre class="mono tiny" style="white-space:pre-wrap;max-height:340px;overflow:auto">${U.esc(JSON.stringify(row.changes, null, 2))}</pre></div>`;
      host.appendChild(box);
    }
  }

  function renderRelatedTable(host, entityName, rows, fields) {
    if (!rows.length) { host.innerHTML = UI.emptyState('📭', 'Chưa có dữ liệu', 'Không có bản ghi liên quan trong phân hệ này.'); return; }
    host.innerHTML = `<div class="card"><div class="table-wrap"><table class="data compact">
      <thead><tr>${fields.map((f) => `<th>${U.esc(App.fieldLabel(entityName, f))}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr style="cursor:pointer" data-id="${U.attr(r.id)}">${fields.map((f) => `<td>${App.formatField(entityName, f, r[f], r)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div></div>`;
    host.querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () => App.Router.navigate(`/${entityName}/${tr.dataset.id}`)));
  }

  async function renderAssetTimeline(host, assetId) {
    host.innerHTML = '<div class="page-loading"><div class="spinner"></div> Đang tải lịch sử…</div>';
    try {
      const res = await API.get(`/api/assets/${assetId}/history`);
      const events = res.data || [];
      if (!events.length) { host.innerHTML = UI.emptyState('📭', 'Chưa có sự kiện', 'Tài sản này chưa phát sinh giao dịch nào.'); return; }
      host.innerHTML = `<div class="card"><div class="card-body"><div class="timeline">${events
        .map((e) => `<div class="timeline-item">
          <div class="tt">${U.esc(e.title)}</div>
          <div class="tm">${U.date(e.at)} • ${U.esc(summaryOf(e))}</div>
        </div>`).join('')}</div></div></div>`;
    } catch (e) { host.innerHTML = `<div class="alert danger">${U.esc(e.message)}</div>`; }
  }
  function summaryOf(e) {
    const d = e.detail || {};
    switch (e._kind) {
      case 'assignments': return `Người nhận: ${d.toUserName || '—'} • ${d.status === 'completed' ? 'Đã hoàn thành' : d.status || ''}`;
      case 'transfers': return `Đến: ${d.toDepartmentName || '—'} • ${d.status || ''}`;
      case 'maintenances': return `${d.type || ''} • Chi phí: ${U.money(d.cost)} • ${d.status || ''}`;
      case 'disposals': return `Giá bán: ${U.money(d.salePrice)} • Lãi/lỗ: ${U.money(d.profitLoss)}`;
      case 'warranties': return `BH đến ${U.date(d.endDate)} • ${d.status || ''}`;
      case 'depreciations': return `Khấu hao: ${U.money(d.depreciationAmount)} • Luỹ kế: ${U.money(d.accumulated)}`;
      default: return '';
    }
  }

  function renderStocktakeItems(host, stocktake, items) {
    const done = items.filter((i) => i.counted).length;
    const diff = items.filter((i) => i.counted && i.result !== 'match').length;
    host.innerHTML = `<div class="card mb"><div class="card-body row wrap" style="gap:20px">
        <div><div class="muted tiny">Tổng số tài sản</div><b style="font-size:18px">${items.length}</b></div>
        <div><div class="muted tiny">Đã kiểm kê</div><b style="font-size:18px;color:var(--c-success)">${done}</b></div>
        <div><div class="muted tiny">Chênh lệch</div><b style="font-size:18px;color:var(--c-danger)">${diff}</b></div>
        <div style="flex:1;min-width:220px"><div class="muted tiny mb">Tiến độ ${items.length ? Math.round((done / items.length) * 100) : 0}%</div>
          <div class="progress"><span style="width:${items.length ? Math.round((done / items.length) * 100) : 0}%"></span></div></div>
        ${stocktake.status === 'open' ? `<button class="btn primary" id="go-count">🧮 Vào màn hình kiểm kê</button>` : ''}
      </div></div>
      <div class="card"><div class="table-wrap"><table class="data compact">
        <thead><tr><th>Mã tài sản</th><th>Tên tài sản</th><th>Vị trí sổ sách</th><th>Vị trí thực tế</th><th>Người sử dụng</th><th>Kết quả</th><th>Tình trạng</th><th>Người KK</th></tr></thead>
        <tbody>${items.map((i) => `<tr>
          <td class="mono">${U.esc(i.assetCode)}</td><td>${U.esc(i.assetName)}</td>
          <td>${U.esc(i.expectedLocationName || '')}</td><td>${U.esc(i.locationName || '')}</td>
          <td>${U.esc(i.assigneeName || '')}</td>
          <td>${App.formatField('stocktake_items', 'result', i.result, i)}</td>
          <td>${App.formatField('stocktake_items', 'conditionFound', i.conditionFound, i)}</td>
          <td>${U.esc(i.countedByName || '—')}</td></tr>`).join('')}</tbody>
      </table></div></div>`;
    const btn = host.querySelector('#go-count');
    if (btn) btn.onclick = () => App.Router.navigate(`/stocktakes/${stocktake.id}/count`);
  }

  function renderRolePerms(host, role) {
    const mods = App.state.enums.permissionModules || [];
    const acts = App.state.enums.permissionActions || [];
    const groups = {};
    mods.forEach((m) => { groups[m.group] = groups[m.group] || []; groups[m.group].push(m); });
    host.innerHTML = `<div class="card"><div class="table-wrap"><table class="perm-table">
      <thead><tr><th style="width:220px">Phân hệ</th>${acts.map((a) => `<th>${U.esc(a.label)}</th>`).join('')}</tr></thead>
      <tbody>${Object.keys(groups).map((g) => `<tr class="perm-group-row"><td colspan="${acts.length + 1}">${U.esc(g)}</td></tr>
        ${groups[g].map((m) => `<tr><td class="mod">${U.esc(m.label)}</td>${acts.map((a) => {
          const on = ((role.permissions || {})[m.key] || []).includes(a.key) || ((role.permissions || {})[m.key] || []).includes('*');
          return `<td class="ctr">${on ? '<span style="color:#16a34a;font-weight:700">✓</span>' : '<span style="color:#cbd5e1">—</span>'}</td>`;
        }).join('')}</tr>`).join('')}`).join('')}</tbody></table></div></div>`;
  }

  function renderDetailSide(host, entityName, row, related) {
    const blocks = [];
    if (entityName === 'assets') {
      blocks.push(`
        <div class="card mb">
          <div class="card-head"><h3>Giá trị & khấu hao</h3></div>
          <div class="card-body">
            <div class="stat-row"><span>Nguyên giá</span><b>${U.money(row.originalCost)}</b></div>
            <div class="stat-row"><span>Hao mòn luỹ kế</span><b style="color:var(--c-warning)">${U.money(row.accumulatedDepreciation)}</b></div>
            <div class="stat-row"><span>Giá trị còn lại</span><b style="color:var(--c-success)">${U.money(row.bookValue)}</b></div>
            <div class="stat-row"><span>Khấu hao/tháng</span><b>${U.money(row.monthlyDepreciation)}</b></div>
            <div class="stat-row"><span>Phương pháp</span><b>${U.esc(U.labelOf(App.state.enums.depreciationMethods, row.depreciationMethod))}</b></div>
            <div class="stat-row"><span>Kỳ đã khấu hao</span><b>${U.num(row.depreciationPeriods)} / ${U.num(row.usefulLife)} tháng</b></div>
            <div class="mt"><div class="row between tiny muted mb"><span>Tiến độ khấu hao</span><span>${U.num(row.depreciationProgress)}%</span></div>
              <div class="progress ${row.depreciationProgress >= 100 ? 'red' : ''}"><span style="width:${Math.min(100, row.depreciationProgress)}%"></span></div></div>
          </div>
        </div>
        <div class="card mb">
          <div class="card-head"><h3>Bảo hành & bảo hiểm</h3></div>
          <div class="card-body">
            <div class="stat-row"><span>Thời hạn BH</span><b>${U.num(row.warrantyMonths)} tháng</b></div>
            <div class="stat-row"><span>Hết hạn BH</span><b>${U.date(row.warrantyEnd)} ${row.warrantyRemainingDays !== undefined ? `<span class="badge ${row.warrantyRemainingDays < 0 ? 'soft' : row.warrantyRemainingDays <= 30 ? '' : 'soft'}" style="${row.warrantyRemainingDays >= 0 && row.warrantyRemainingDays <= 30 ? 'background:#fef3c7;color:#92400e' : ''}">${row.warrantyRemainingDays < 0 ? 'hết hạn' : 'còn ' + row.warrantyRemainingDays + ' ngày'}</span>` : ''}</b></div>
            <div class="stat-row"><span>Bảo hiểm</span><b>${row.insured ? 'Có — ' + U.esc(row.insuranceCompany || '') : 'Không'}</b></div>
            ${row.insured ? `<div class="stat-row"><span>Giá trị BH</span><b>${U.money(row.insuranceValue)}</b></div><div class="stat-row"><span>Hết hạn BH</span><b>${U.date(row.insuranceExpiry)}</b></div>` : ''}
          </div>
        </div>`);
    }
    if (entityName === 'stocktakes' && related.items) {
      const items = related.items;
      blocks.push(`<div class="card mb"><div class="card-head"><h3>Tiến độ kiểm kê</h3></div><div class="card-body">
        <div class="stat-row"><span>Tổng tài sản</span><b>${items.length}</b></div>
        <div class="stat-row"><span>Đã kiểm kê</span><b>${items.filter((i) => i.counted).length}</b></div>
        <div class="stat-row"><span>Chênh lệch</span><b>${items.filter((i) => i.counted && i.result !== 'match').length}</b></div>
        <div class="stat-row"><span>Không tìm thấy</span><b>${items.filter((i) => i.result === 'missing').length}</b></div>
        <div class="stat-row"><span>Hư hỏng</span><b>${items.filter((i) => i.result === 'damaged').length}</b></div>
      </div></div>`);
    }
    // Nhật ký liên quan
    blocks.push(`<div class="card"><div class="card-head"><h3>Nhật ký & metadata</h3></div><div class="card-body">
      <div class="stat-row"><span>ID hệ thống</span><b>#${U.num(row.id)}</b></div>
      <div class="stat-row"><span>Ngày tạo</span><b>${U.datetime(row.createdAt)}</b></div>
      <div class="stat-row"><span>Cập nhật cuối</span><b>${U.datetime(row.updatedAt)}</b></div>
      ${row.isDeleted ? `<div class="stat-row"><span>Đã xoá</span><b style="color:var(--c-danger)">${U.datetime(row.deletedAt)} bởi ${U.esc(row.deletedBy)}</b></div>` : ''}
    </div></div>`);
    host.innerHTML = blocks.join('');
  }

  /* ============================== Trang sửa ============================== */

  Pages.entityEdit = function (entityName, id, container) {
    const entity = App.state.entities[entityName];
    if (!App.can(entity.perm, 'update')) { container.innerHTML = UI.emptyState('🔒', 'Không có quyền sửa', ''); return; }
    container.innerHTML = pageHead('Cập nhật ' + entity.singular.toLowerCase(), 'Chỉnh sửa thông tin và lưu lại', `<a class="btn ghost" href="#/${entityName}/${id}">← Quay lại</a>`);
    const host = document.createElement('div');
    host.className = 'card';
    host.innerHTML = '<div class="card-body" id="form-host"></div><div class="modal-foot"><button class="btn" id="f-cancel">Huỷ</button><button class="btn primary" id="f-save">💾 Lưu thay đổi</button></div>';
    container.appendChild(host);
    API.get(`/api/entities/${entityName}/${id}`).then((res) => {
      const form = UI.entityForm(host.querySelector('#form-host'), entityName, res.data, {});
      host.querySelector('#f-save').onclick = async () => {
        const errs = form.validate();
        if (Object.keys(errs).length) return form.setErrors(errs);
        UI.loading(true, 'Đang lưu…');
        try {
          await API.put(`/api/entities/${entityName}/${id}`, form.collect());
          UI.loading(false); UI.toast('Đã lưu thay đổi', '', 'success');
          App.Router.navigate(`/${entityName}/${id}`);
        } catch (e) {
          UI.loading(false);
          if (e.payload && e.payload.errors) form.setErrors(e.payload.errors); else UI.toast('Lỗi', e.message, 'error');
        }
      };
      host.querySelector('#f-cancel').onclick = () => App.Router.navigate(`/${entityName}/${id}`);
    });
  };

  /* ============================== Thao tác nghiệp vụ ============================== */

  const Actions = {};
  window.Actions = Actions;

  Actions.workflow = async function (entityName, id, action, done) {
    const labels = { approve: 'Duyệt', reject: 'Từ chối', complete: 'Hoàn thành', start: 'Bắt đầu thực hiện', cancel: 'Huỷ phiếu', confirm: 'Xác nhận' };
    let body = {};
    if (action === 'reject') {
      const reason = await new Promise((resolve) => {
        // Settle trước khi đóng (xem ghi chú ở UI.confirm)
        let settled = false;
        const settle = (value) => { if (!settled) { settled = true; resolve(value); } };
        UI.modal({
          size: 'sm', title: 'Từ chối phê duyệt',
          body: `<div class="field"><label>Lý do từ chối <span class="req">*</span></label><textarea id="rj" rows="3" placeholder="Nhập lý do từ chối…"></textarea></div>`,
          footer: [
            { label: 'Huỷ', onClick: (mm) => { settle(null); mm.close(); } },
            { label: 'Xác nhận từ chối', cls: 'danger', onClick: (mm) => { const v = mm.body.querySelector('#rj').value.trim(); settle(v || 'Không đạt yêu cầu'); mm.close(); } },
          ],
          onClose: () => settle(null),
        });
      });
      if (reason === null) return;
      body = { reason };
    } else {
      const okd = await UI.confirm({ title: labels[action] + '?', message: `Bạn chắc chắn muốn <b>${labels[action].toLowerCase()}</b> bản ghi này?`, confirmText: labels[action] });
      if (!okd) return;
    }
    UI.loading(true, 'Đang xử lý…');
    try {
      await API.post(`/api/${entityName}/${id}/${action}`, body);
      UI.loading(false);
      UI.toast('Thành công', `Đã ${labels[action].toLowerCase()} bản ghi`, 'success');
      if (done) done();
    } catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
  };

  Actions.assignDialog = function (asset, done) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="alert info mb">Tài sản: <b>${U.esc(asset.name)}</b> (${U.esc(asset.code)}) — Giá trị còn lại: <b>${U.money(asset.bookValue)}</b></div>
      <div class="form-grid" id="asg-form"></div>`;
    const m = UI.modal({
      title: 'Lập phiếu cấp phát tài sản', subtitle: 'Biên bản bàn giao sẽ được tạo tự động', size: 'lg', body: wrap,
      footer: [
        { label: 'Huỷ', onClick: (mm) => mm.close() },
        { label: '💾 Tạo phiếu cấp phát', cls: 'primary', onClick: async (mm) => {
          const f = form.collect();
          if (!f.toUserId) return UI.toast('Thiếu thông tin', 'Vui lòng chọn người nhận tài sản', 'warning');
          UI.loading(true, 'Đang tạo phiếu…');
          try {
            const res = await API.post('/api/entities/assignments', Object.assign({ assetId: asset.id, assetCode: asset.code, assetName: asset.name }, f));
            UI.loading(false); UI.toast('Đã tạo phiếu cấp phát', res.data.code, 'success');
            mm.close();
            const ask = await UI.confirm({ title: 'In biên bản bàn giao?', message: 'Bạn có muốn mở bản in biên bản bàn giao tài sản ngay bây giờ?', confirmText: '🖨 In ngay' });
            if (ask) API.openHTML(`/api/documents/assignment/${res.data.id}`);
            if (done) done();
          } catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
        } },
      ],
    });
    const form = UI.entityForm(m.body.querySelector('#asg-form'), 'assignments', {
      assetId: asset.id, type: 'assign', date: U.today(), conditionAtHandover: asset.condition || 'good',
      departmentId: asset.departmentId, locationId: asset.locationId, fromUserId: App.state.user.id,
    }, { skipFields: ['assetCode', 'assetName', 'toUserName', 'fromUserName', 'departmentName', 'code', 'status', 'signatureReceiver', 'signatureGiver', 'signatureManager'] });
  };

  Actions.transferDialog = function (asset, done) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="alert info mb">Điều chuyển tài sản <b>${U.esc(asset.name)}</b> (${U.esc(asset.code)})</div><div class="form-grid" id="trf-form"></div>`;
    const m = UI.modal({
      title: 'Lập phiếu điều chuyển tài sản', size: 'lg', body: wrap,
      footer: [
        { label: 'Huỷ', onClick: (mm) => mm.close() },
        { label: '💾 Tạo phiếu (chờ duyệt)', cls: 'primary', onClick: async (mm) => {
          const f = form.collect();
          if (!f.toDepartmentId) return UI.toast('Thiếu thông tin', 'Vui lòng chọn phòng ban tiếp nhận', 'warning');
          UI.loading(true, 'Đang tạo phiếu…');
          try {
            const res = await API.post('/api/entities/transfers', Object.assign({ assetId: asset.id, assetCode: asset.code, assetName: asset.name, status: 'pending' }, f));
            UI.loading(false); UI.toast('Đã tạo phiếu điều chuyển', res.data.code + ' — chờ phê duyệt', 'success');
            mm.close(); if (done) done();
          } catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
        } },
      ],
    });
    const form = UI.entityForm(m.body.querySelector('#trf-form'), 'transfers', {
      assetId: asset.id, date: U.today(), status: 'pending',
      fromDepartmentId: asset.departmentId, fromUserId: asset.assigneeId, fromLocationId: asset.locationId,
      requestedBy: App.state.user.id,
    }, { skipFields: ['assetCode', 'assetName', 'toDepartmentName', 'fromDepartmentName', 'toUserName', 'fromUserName', 'approvedBy', 'approvedAt', 'completedAt', 'code'] });
  };

  Actions.maintenanceDialog = function (asset, done) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="alert warning mb">Yêu cầu bảo trì cho <b>${U.esc(asset.name)}</b> (${U.esc(asset.code)})</div><div id="mnt-form"></div>`;
    const m = UI.modal({
      title: 'Lập phiếu bảo trì - sửa chữa', size: 'lg', body: wrap,
      footer: [
        { label: 'Huỷ', onClick: (mm) => mm.close() },
        { label: '💾 Tạo phiếu', cls: 'primary', onClick: async (mm) => {
          const f = form.collect();
          if (!f.description) return UI.toast('Thiếu thông tin', 'Vui lòng mô tả hiện tượng hư hỏng', 'warning');
          UI.loading(true, 'Đang tạo phiếu…');
          try {
            const res = await API.post('/api/entities/maintenances', Object.assign({ assetId: asset.id, assetCode: asset.code, assetName: asset.name, status: 'pending', reportedDate: U.today() }, f));
            UI.loading(false); UI.toast('Đã tạo phiếu bảo trì', res.data.code, 'success');
            mm.close(); if (done) done();
          } catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
        } },
      ],
    });
    const form = UI.entityForm(m.body.querySelector('#mnt-form'), 'maintenances', {
      assetId: asset.id, type: 'corrective', priority: 'normal', reportedDate: U.today(), plannedDate: U.addDays(U.today(), 3), status: 'pending',
    }, { skipFields: ['assetCode', 'assetName', 'code', 'vendorName', 'result', 'actualDate', 'nextDueDate'] });
  };

  Actions.disposeDialog = function (asset, done) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="alert danger mb">Thanh lý tài sản <b>${U.esc(asset.name)}</b> (${U.esc(asset.code)}) — thao tác này cần phê duyệt trước khi ghi giảm tài sản.</div>
      <div class="grid cols-3 mb">
        <div class="card"><div class="card-body"><div class="muted tiny">Nguyên giá</div><b>${U.money(asset.originalCost)}</b></div></div>
        <div class="card"><div class="card-body"><div class="muted tiny">Hao mòn luỹ kế</div><b>${U.money(asset.accumulatedDepreciation)}</b></div></div>
        <div class="card"><div class="card-body"><div class="muted tiny">Giá trị còn lại</div><b>${U.money(asset.bookValue)}</b></div></div>
      </div>
      <div id="dsp-form"></div>`;
    const m = UI.modal({
      title: 'Lập phiếu thanh lý tài sản', size: 'lg', body: wrap,
      footer: [
        { label: 'Huỷ', onClick: (mm) => mm.close() },
        { label: '💾 Tạo phiếu thanh lý', cls: 'danger', onClick: async (mm) => {
          const f = form.collect();
          UI.loading(true, 'Đang tạo phiếu…');
          try {
            const res = await API.post('/api/entities/disposals', Object.assign({
              assetId: asset.id, assetCode: asset.code, assetName: asset.name, status: 'pending',
              bookValue: asset.bookValue, originalCost: asset.originalCost, accumulated: asset.accumulatedDepreciation,
            }, f));
            UI.loading(false); UI.toast('Đã tạo phiếu thanh lý', res.data.code + ' — chờ phê duyệt', 'success');
            mm.close(); if (done) done();
          } catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
        } },
      ],
    });
    const form = UI.entityForm(m.body.querySelector('#dsp-form'), 'disposals', {
      assetId: asset.id, date: U.today(), type: 'sale', status: 'pending', council: [App.state.settings.company.representative || '', App.state.settings.company.accountant || ''],
    }, { skipFields: ['assetCode', 'assetName', 'bookValue', 'originalCost', 'accumulated', 'profitLoss', 'code', 'approvedBy', 'approvedAt'] });
  };

  Actions.closeStocktake = async function (stocktake, done) {
    const okd = await UI.confirm({
      title: 'Chốt đợt kiểm kê?',
      message: `Sau khi chốt, hệ thống sẽ ghi nhận ngày kiểm kê vào tài sản và không thể sửa kết quả kiểm kê của <b>${U.esc(stocktake.name)}</b>.`,
      confirmText: '🔒 Chốt kiểm kê',
    });
    if (!okd) return;
    UI.loading(true, 'Đang chốt kiểm kê…');
    try {
      await API.post(`/api/stocktakes/${stocktake.id}/close`, {});
      UI.loading(false); UI.toast('Đã chốt đợt kiểm kê', '', 'success');
      if (done) done();
    } catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
  };

  Actions.resetPassword = async function (user) {
    const m = UI.modal({
      size: 'sm',
      title: 'Đặt lại mật khẩu',
      subtitle: user.fullName + ' (' + user.username + ')',
      body: `<div class="field"><label>Mật khẩu mới</label><input type="text" id="np" placeholder="Để trống để hệ thống tự sinh"/></div>
             <div class="alert info tiny">Người dùng sẽ được yêu cầu đổi mật khẩu ở lần đăng nhập kế tiếp. Mọi phiên đang hoạt động sẽ bị thu hồi.</div>`,
      footer: [
        { label: 'Huỷ', onClick: (mm) => mm.close() },
        { label: '🔑 Đặt lại', cls: 'primary', onClick: async (mm) => {
          const np = mm.body.querySelector('#np').value.trim();
          UI.loading(true, 'Đang xử lý…');
          try {
            const res = await API.post(`/api/admin/users/${user.id}/reset-password`, np ? { newPassword: np } : {});
            UI.loading(false); mm.close();
            UI.modal({ size: 'sm', title: 'Đặt lại mật khẩu thành công', body: res.data.newPassword ? `<div class="alert success">Mật khẩu mới: <b class="mono" style="font-size:16px">${U.esc(res.data.newPassword)}</b><br/><span class="tiny">Vui lòng sao chép và gửi cho người dùng.</span></div>` : '<div class="alert success">Đã đặt lại mật khẩu theo yêu cầu.</div>' });
          } catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
        } },
      ],
    });
  };

  Actions.toggleUser = async function (user, done) {
    const lock = user.status !== 'locked';
    const okd = await UI.confirm({
      title: lock ? 'Khoá tài khoản?' : 'Mở khoá tài khoản?',
      message: lock ? `Người dùng <b>${U.esc(user.username)}</b> sẽ không thể đăng nhập và mọi phiên hiện tại bị thu hồi.` : `Mở khoá cho <b>${U.esc(user.username)}</b>?`,
      danger: lock, confirmText: lock ? '🔒 Khoá' : '🔓 Mở khoá',
    });
    if (!okd) return;
    try { await API.post(`/api/admin/users/${user.id}/toggle-status`, {}); UI.toast('Đã cập nhật', '', 'success'); if (done) done(); }
    catch (e) { UI.toast('Lỗi', e.message, 'error'); }
  };

  /* ============================== Trang kiểm kê (đếm) ============================== */

  Pages.stocktakeCount = async function (stocktakeId, container) {
    const res = await API.get(`/api/entities/stocktakes/${stocktakeId}`);
    const stocktake = res.data;
    const items = (res.meta.related && res.meta.related.items) || [];
    container.innerHTML = pageHead('Kiểm kê: ' + stocktake.name,
      `Mã đợt: <b class="mono">${U.esc(stocktake.code)}</b> • ${items.filter((i) => i.counted).length}/${items.length} tài sản đã kiểm kê`,
      `<button class="btn" id="sk-export">⬇ Xuất kết quả</button>
       <button class="btn primary" id="sk-save">💾 Lưu kết quả</button>
       <a class="btn ghost" href="#/stocktakes/${stocktakeId}">← Quay lại</a>`);

    const host = document.createElement('div');
    host.className = 'card';
    host.innerHTML = `<div class="table-toolbar">
        <input type="search" id="sk-search" placeholder="🔍 Tìm mã hoặc tên tài sản…" style="width:300px"/>
        <select id="sk-filter" style="width:auto"><option value="">Tất cả kết quả</option><option value="uncounted">Chưa kiểm kê</option><option value="diff">Có chênh lệch</option><option value="match">Khớp</option></select>
        <div class="spacer" style="flex:1"></div>
        <span class="muted tiny" id="sk-stat"></span>
      </div>
      <div class="table-wrap"><table class="data compact" id="sk-table">
        <thead><tr><th style="width:38px" class="ctr">✓</th><th>Mã tài sản</th><th>Tên tài sản</th><th>Vị trí sổ sách</th><th>Người sử dụng</th><th>Vị trí thực tế</th><th>Kết quả</th><th>Tình trạng</th><th>Ghi chú</th></tr></thead>
        <tbody></tbody></table></div>`;
    container.appendChild(host);

    const state = { items: U.clone(items), dirty: new Set() };

    function renderTable() {
      const q = U.norm(document.getElementById('sk-search').value);
      const filt = document.getElementById('sk-filter').value;
      const tbody = host.querySelector('#sk-table tbody');
      const rows = state.items.filter((i) => {
        if (q && !(U.norm(i.assetCode).includes(q) || U.norm(i.assetName).includes(q))) return false;
        if (filt === 'uncounted') return !i.counted;
        if (filt === 'diff') return i.counted && i.result !== 'match';
        if (filt === 'match') return i.counted && i.result === 'match';
        return true;
      });
      tbody.innerHTML = rows.map((i) => `<tr data-item="${i.id}">
        <td class="ctr"><input type="checkbox" class="sk-counted" ${i.counted ? 'checked' : ''}/></td>
        <td class="mono">${U.esc(i.assetCode)}</td>
        <td>${U.esc(i.assetName)}</td>
        <td>${U.esc(i.expectedLocationName || '')}</td>
        <td>${U.esc(i.assigneeName || '')}</td>
        <td><input type="text" class="sk-loc" value="${U.attr(i.locationName || '')}" style="min-width:150px;padding:4px 6px"/></td>
        <td><select class="sk-result" style="padding:4px 6px">
          ${[['match', 'Khớp'], ['missing', 'Không tìm thấy'], ['extra', 'Phát hiện thêm'], ['wrong_location', 'Sai vị trí'], ['damaged', 'Hư hỏng']].map(([v, l]) => `<option value="${v}" ${i.result === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></td>
        <td><select class="sk-condition" style="padding:4px 6px">
          ${App.state.enums.assetCondition.map((c) => `<option value="${c.value}" ${i.conditionFound === c.value ? 'selected' : ''}>${U.esc(c.label)}</option>`).join('')}
        </select></td>
        <td><input type="text" class="sk-note" value="${U.attr(i.note || '')}" style="min-width:140px;padding:4px 6px"/></td>
      </tr>`).join('') || `<tr><td colspan="9" class="empty">Không có dòng nào phù hợp</td></tr>`;

      tbody.querySelectorAll('tr[data-item]').forEach((tr) => {
        const item = state.items.find((x) => String(x.id) === tr.dataset.item);
        const mark = () => { state.dirty.add(item.id); const cb = tr.querySelector('.sk-counted'); if (cb) cb.checked = true; item.counted = true; updateStat(); };
        tr.querySelector('.sk-counted').onchange = (e) => { item.counted = e.target.checked; state.dirty.add(item.id); updateStat(); };
        tr.querySelector('.sk-loc').oninput = (e) => { item.locationName = e.target.value; mark(); };
        tr.querySelector('.sk-result').onchange = (e) => { item.result = e.target.value; mark(); };
        tr.querySelector('.sk-condition').onchange = (e) => { item.conditionFound = e.target.value; mark(); };
        tr.querySelector('.sk-note').oninput = (e) => { item.note = e.target.value; mark(); };
      });
      updateStat();
    }

    function updateStat() {
      const done = state.items.filter((i) => i.counted).length;
      const diff = state.items.filter((i) => i.counted && i.result !== 'match').length;
      document.getElementById('sk-stat').innerHTML = `Đã kiểm kê <b>${done}/${state.items.length}</b> • Chênh lệch <b style="color:var(--c-danger)">${diff}</b>`;
    }

    document.getElementById('sk-search').oninput = U.debounce(renderTable, 250);
    document.getElementById('sk-filter').onchange = renderTable;
    document.getElementById('sk-save').onclick = async () => {
      if (!state.dirty.size) return UI.toast('Không có thay đổi', 'Chưa có dòng nào được cập nhật', 'warning');
      UI.loading(true, 'Đang lưu kết quả kiểm kê…');
      let ok = 0;
      for (const id of state.dirty) {
        const item = state.items.find((x) => String(x.id) === String(id));
        try {
          await API.post(`/api/stocktakes/${stocktakeId}/items/${id}`, {
            counted: item.counted, result: item.result, conditionFound: item.conditionFound, note: item.note,
          });
          ok++;
        } catch (e) { /* tiếp tục */ }
      }
      state.dirty.clear();
      UI.loading(false);
      UI.toast('Đã lưu kết quả kiểm kê', `${ok} dòng được cập nhật`, 'success');
    };
    document.getElementById('sk-export').onclick = () => API.openHTML(`/api/documents/stocktake/${stocktakeId}`);
    renderTable();
  };

  /* ============================== Trang báo cáo ============================== */

  Pages.reports = async function (container) {
    container.innerHTML = pageHead('Báo cáo & In ấn', 'Chạy mẫu báo cáo, xuất PDF/Word/Excel hoặc tự thiết kế mẫu mới',
      `${App.can('reports', 'create') ? '<button class="btn primary" id="btn-new-report">＋ Thiết kế mẫu báo cáo mới</button>' : ''}
       <a class="btn" href="#/reports/library">📚 Thư viện dữ liệu</a>`);
    const host = document.createElement('div');
    container.appendChild(host);
    const res = await API.get('/api/entities/report_templates?limit=200&sort=code&order=asc');
    const templates = res.data || [];
    if (!templates.length) { host.innerHTML = '<div class="card">' + UI.emptyState('📊', 'Chưa có mẫu báo cáo', 'Bấm "Thiết kế mẫu báo cáo mới" để bắt đầu.') + '</div>'; return; }

    host.innerHTML = `<div class="grid cols-3">${templates
      .map((t) => `
      <div class="card" style="display:flex;flex-direction:column">
        <div class="card-body" style="flex:1">
          <div class="row between">
            <span class="badge soft mono">${U.esc(t.code)}</span>
            ${t.isSystem ? '<span class="badge" style="background:#ede9fe;color:#6d28d9;border-color:#ddd6fe">Mẫu hệ thống</span>' : ''}
          </div>
          <h3 style="margin:10px 0 6px;font-size:15px">${U.esc(t.name)}</h3>
          <p class="muted tiny" style="min-height:34px">${U.esc(t.description || '')}</p>
          <div class="tiny muted row wrap" style="gap:10px;margin-top:6px">
            <span>📚 ${U.esc(t.datasetLabel || t.dataset)}</span>
            <span>📄 ${U.esc(t.paperSize || 'A4')} ${t.orientation === 'landscape' ? 'ngang' : 'dọc'}</span>
            <span>v${U.num(t.version || 1)}</span>
          </div>
        </div>
        <div class="modal-foot" style="justify-content:flex-start;gap:6px;flex-wrap:wrap">
          <button class="btn primary sm" data-run="${t.id}">▶ Chạy báo cáo</button>
          <button class="btn sm" data-design="${t.id}">🎨 Thiết kế</button>
          <button class="btn sm" data-clone="${t.id}">⧉ Nhân bản</button>
          <button class="btn sm" data-docx="${t.id}" title="Xuất Word">📝</button>
          <button class="btn sm" data-xlsx="${t.id}" title="Xuất Excel">📊</button>
          <button class="btn sm" data-csv="${t.id}" title="Xuất CSV">📃</button>
        </div>
      </div>`)
      .join('')}</div>`;

    host.querySelectorAll('[data-run]').forEach((b) => (b.onclick = () => Pages.runReportDialog(templates.find((t) => String(t.id) === b.dataset.run))));
    host.querySelectorAll('[data-design]').forEach((b) => (b.onclick = () => App.Router.navigate('/reports/designer/' + b.dataset.design)));
    host.querySelectorAll('[data-clone]').forEach((b) => (b.onclick = async () => {
      try { const r = await API.post('/api/reports/templates/clone', { id: Number(b.dataset.clone) }); UI.toast('Đã nhân bản mẫu', r.data.code); Pages.reports(container); }
      catch (e) { UI.toast('Lỗi', e.message, 'error'); }
    }));
    host.querySelectorAll('[data-docx]').forEach((b) => (b.onclick = () => Pages.exportTemplate(templates.find((t) => String(t.id) === b.dataset.docx), 'docx')));
    host.querySelectorAll('[data-xlsx]').forEach((b) => (b.onclick = () => Pages.exportTemplate(templates.find((t) => String(t.id) === b.dataset.xlsx), 'xlsx')));
    host.querySelectorAll('[data-csv]').forEach((b) => (b.onclick = () => Pages.exportTemplate(templates.find((t) => String(t.id) === b.dataset.csv), 'csv')));
    const newBtn = container.querySelector('#btn-new-report');
    if (newBtn) newBtn.onclick = () => Pages.newReportDialog(() => Pages.reports(container));
  };

  Pages.newReportDialog = async function (done) {
    const dsRes = await API.get('/api/reports/datasets');
    const datasets = dsRes.data || [];
    const m = UI.modal({
      title: 'Thiết kế mẫu báo cáo mới',
      subtitle: 'Chọn nguồn dữ liệu, hệ thống sẽ tạo bố cục mẫu để bạn chỉnh sửa',
      size: 'lg',
      body: `
        <div class="form-grid">
          <div class="field"><label>Tên mẫu báo cáo <span class="req">*</span></label><input type="text" id="nr-name" placeholder="vd: Báo cáo tài sản theo kho"/></div>
          <div class="field"><label>Nguồn dữ liệu <span class="req">*</span></label><select id="nr-ds">${datasets.map((d) => `<option value="${U.attr(d.key)}">${U.esc(d.group ? d.group + ' — ' : '')}${U.esc(d.label)} (${d.fieldCount} trường)</option>`).join('')}</select></div>
          <div class="field span-2"><label>Mô tả</label><input type="text" id="nr-desc" placeholder="Mục đích sử dụng của báo cáo"/></div>
          <div class="field"><label>Khổ giấy</label><select id="nr-paper"><option>A4</option><option>A3</option><option>A5</option><option>Letter</option><option>Legal</option></select></div>
          <div class="field"><label>Hướng giấy</label><select id="nr-orient"><option value="portrait">Dọc (Portrait)</option><option value="landscape">Ngang (Landscape)</option></select></div>
        </div>
        <div class="alert info">Sau khi tạo, bạn sẽ vào trình thiết kế để kéo thả các trường dữ liệu, định dạng, nhóm, sắp xếp và xem trước.</div>`,
      footer: [
        { label: 'Huỷ', onClick: (mm) => mm.close() },
        { label: '🎨 Tạo và mở trình thiết kế', cls: 'primary', onClick: async (mm) => {
          const name = mm.body.querySelector('#nr-name').value.trim();
          if (!name) return UI.toast('Thiếu tên', 'Vui lòng nhập tên mẫu báo cáo', 'warning');
          const dataset = mm.body.querySelector('#nr-ds').value;
          const ds = datasets.find((d) => d.key === dataset);
          const fields = (ds.fields || []).slice(0, 6);
          // Lấy mẫu thiết kế mặc định từ server để đồng bộ
          const blankRes = await API.get('/api/reports/blank-design');
          const design = blankRes.data;
          design.paperSize = mm.body.querySelector('#nr-paper').value;
          design.orientation = mm.body.querySelector('#nr-orient').value;
          // Đổi nhãn tiêu đề
          if (design.bands.reportTitle && design.bands.reportTitle.elements[2]) design.bands.reportTitle.elements[2].text = name.toUpperCase();
          // Gán các cột mặc định theo dataset
          ['columnHeader', 'detail'].forEach((band) => {
            const els = (design.bands[band] && design.bands[band].elements) || [];
            const fieldEls = els.filter((e) => e.type === 'field').sort((a, b) => a.x - b.x);
            fieldEls.forEach((e, i) => {
              const f = fields[i + 1] || fields[0];
              if (f) { e.field = f.key; e.label = f.label; }
            });
          });
          try {
            const created = await API.post('/api/entities/report_templates', {
              name, description: mm.body.querySelector('#nr-desc').value, dataset, design,
              paperSize: design.paperSize, orientation: design.orientation,
            });
            mm.close();
            UI.toast('Đã tạo mẫu báo cáo', created.data.code, 'success');
            App.Router.navigate('/reports/designer/' + created.data.id);
            if (done) done();
          } catch (e) { UI.toast('Lỗi', e.message, 'error'); }
        } },
      ],
    });
  };

  Pages.runReportDialog = async function (template) {
    const design = template.design || {};
    const params = design.parameters || [];
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="alert info mb">Mẫu: <b>${U.esc(template.name)}</b> — nguồn dữ liệu <b>${U.esc(template.datasetLabel || template.dataset)}</b></div>
      <div class="form-grid">
        ${params.length ? params.map((p) => {
          if (p.type === 'date') return `<div class="field"><label>${U.esc(p.label)}</label><input type="date" data-param="${U.attr(p.name)}"/></div>`;
          if (p.type === 'ref') return `<div class="field"><label>${U.esc(p.label)}</label><select data-param="${U.attr(p.name)}" data-ref="${U.attr(p.ref)}"><option value="">Tất cả</option></select></div>`;
          if (p.type === 'number') return `<div class="field"><label>${U.esc(p.label)}</label><input type="number" data-param="${U.attr(p.name)}"/></div>`;
          return `<div class="field"><label>${U.esc(p.label)}</label><input type="text" data-param="${U.attr(p.name)}" value="${U.attr(p.default || '')}"/></div>`;
        }).join('') : '<div class="muted">Mẫu báo cáo này không có tham số lọc.</div>'}
      </div>
      <div class="field"><label>Số dòng tối đa (xem trước)</label><input type="number" id="rp-limit" value="500" min="1" max="20000"/></div>`;
    for (const p of params.filter((x) => x.type === 'ref')) {
      try {
        const r = await API.get('/api/lookups/' + p.ref);
        const sel = wrap.querySelector(`[data-param="${p.name}"]`);
        (r.data || []).forEach((o) => { const opt = document.createElement('option'); opt.value = o.id; opt.textContent = o.label; sel.appendChild(opt); });
      } catch (e) {}
    }
    const m = UI.modal({
      title: 'Chạy báo cáo: ' + template.name,
      size: 'lg',
      body: wrap,
      footer: [
        { label: 'Huỷ', onClick: (mm) => mm.close() },
        { label: '⬇ Word (.docx)', onClick: (mm) => Pages.runReport(template, mm, 'docx') },
        { label: '⬇ Excel (.xlsx)', onClick: (mm) => Pages.runReport(template, mm, 'xlsx') },
        { label: '⬇ CSV', onClick: (mm) => Pages.runReport(template, mm, 'csv') },
        { label: '🖨 Xem trước & In (PDF)', cls: 'primary', onClick: (mm) => Pages.runReport(template, mm, 'print') },
      ],
    });
  };

  Pages.runReport = async function (template, modalApi, format) {
    const params = {};
    modalApi.body.querySelectorAll('[data-param]').forEach((el) => { if (el.value) params[el.dataset.param] = el.value; });
    const limit = Number((modalApi.body.querySelector('#rp-limit') || {}).value || 500);
    if (format === 'html' || format === 'print') {
      modalApi.close();
      UI.loading(true, 'Đang tạo báo cáo…');
      try {
        // Lấy HTML qua fetch rồi mở tab để tránh mất cookie trong popup
        const res = await fetch('/api/reports/render', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateId: template.id, format: 'html', params }),
        });
        const html = await res.text();
        UI.loading(false);
        const win = window.open('', '_blank');
        if (win) { win.document.open(); win.document.write(html); win.document.close(); }
        else {
          const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
          window.open(URL.createObjectURL(blob), '_blank');
        }
      } catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
      return;
    }
    modalApi.close();
    UI.loading(true, 'Đang kết xuất ' + format.toUpperCase() + '…');
    try {
      await API.download('/api/reports/render', 'POST', { templateId: template.id, format, params }, `${U.slug(template.name)}.${format}`);
      UI.loading(false);
      UI.toast('Đã xuất báo cáo', 'Định dạng ' + format.toUpperCase(), 'success');
    } catch (e) { UI.loading(false); UI.toast('Lỗi xuất báo cáo', e.message, 'error'); }
  };

  Pages.exportTemplate = function (template, format) {
    UI.loading(true, 'Đang kết xuất…');
    API.download('/api/reports/render', 'POST', { templateId: template.id, format }, `${U.slug(template.name)}.${format}`)
      .then(() => { UI.loading(false); UI.toast('Đã xuất: ' + format.toUpperCase(), template.name, 'success'); })
      .catch((e) => { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); });
  };

  /* Thư viện dữ liệu cho Report Designer */
  Pages.dataLibrary = async function (container) {
    const res = await API.get('/api/reports/datasets');
    const datasets = res.data || [];
    container.innerHTML = pageHead('Thư viện dữ liệu báo cáo', 'Danh sách các nguồn dữ liệu (dataset) và trường có thể dùng khi thiết kế báo cáo',
      '<a class="btn ghost" href="#/reports">← Danh sách mẫu</a>');
    const groups = {};
    datasets.forEach((d) => { groups[d.group || 'Khác'] = groups[d.group || 'Khác'] || []; groups[d.group || 'Khác'].push(d); });
    const host = document.createElement('div');
    container.appendChild(host);
    host.innerHTML = Object.keys(groups).map((g) => `<div class="card mb">
      <div class="card-head"><h3>${U.esc(g)}</h3><span class="sub">${groups[g].length} nguồn dữ liệu</span></div>
      <div class="card-body grid cols-2" style="gap:10px">
        ${groups[g].map((d) => `
          <div style="border:1px solid var(--border);border-radius:10px;padding:10px">
            <div class="row between"><b>${U.esc(d.label)}</b><span class="badge soft mono">${U.esc(d.key)}</span></div>
            <div class="muted tiny" style="margin:4px 0 8px">Bảng: <code class="mono">${U.esc(d.entity)}</code> • ${d.fieldCount} trường ${d.sql ? '• <b>dataset tổng hợp</b>' : ''}</div>
            <details><summary class="link" style="font-size:12px">Xem danh sách trường</summary>
              <div class="table-wrap" style="max-height:220px;margin-top:6px"><table class="data compact"><thead><tr><th>Trường</th><th>Nhãn</th><th>Kiểu</th></tr></thead>
              <tbody>${(d.fields || []).map((f) => `<tr><td class="mono">${U.esc(f.key)}</td><td>${U.esc(f.label)}</td><td>${U.esc(f.type)}</td></tr>`).join('')}</tbody></table></div>
            </details>
          </div>`).join('')}
      </div></div>`).join('');
  };

  /* ============================== Trang cá nhân ============================== */

  Pages.profile = async function (container) {
    const me = App.state.user;
    const res = await API.get(`/api/entities/users/${me.id}`);
    const row = res.data;
    const related = (res.meta && res.meta.related) || {};
    container.innerHTML = pageHead('Trang cá nhân', 'Thông tin tài khoản, tài sản đang quản lý và bảo mật',
      '<button class="btn" id="p-pass">🔑 Đổi mật khẩu</button>');
    const host = document.createElement('div');
    host.innerHTML = `<div class="detail-grid">
      <div>
        <div class="card mb"><div class="card-head"><h3>Thông tin cá nhân</h3></div><div class="card-body">
          <dl class="info-list">
            <dt>Họ và tên</dt><dd><b>${U.esc(row.fullName)}</b></dd>
            <dt>Tên đăng nhập</dt><dd class="mono">${U.esc(row.username)}</dd>
            <dt>Mã nhân viên</dt><dd class="mono">${U.esc(row.employeeCode || '—')}</dd>
            <dt>Email</dt><dd>${U.esc(row.email || '—')}</dd>
            <dt>Điện thoại</dt><dd>${U.esc(row.phone || '—')}</dd>
            <dt>Phòng ban</dt><dd>${U.esc(row.departmentName || '—')}</dd>
            <dt>Chức vụ</dt><dd>${U.esc(row.position || '—')}</dd>
            <dt>Vai trò</dt><dd>${U.esc(row.roleName || '')} <span class="badge soft">${U.esc(row.dataScope || '')}</span></dd>
            <dt>Đăng nhập gần nhất</dt><dd>${U.datetime(row.lastLoginAt)}</dd>
          </dl>
        </div></div>
        <div class="card"><div class="card-head"><h3>Tài sản tôi đang quản lý (${(related.assets || []).length})</h3></div>
          <div class="table-wrap"><table class="data compact"><thead><tr><th>Mã</th><th>Tên tài sản</th><th class="num">Giá trị còn lại</th><th>Trạng thái</th></tr></thead>
          <tbody>${(related.assets || []).map((a) => `<tr style="cursor:pointer" onclick="location.hash='#/assets/${a.id}'"><td class="mono">${U.esc(a.code)}</td><td>${U.esc(a.name)}</td><td class="num">${U.money(a.bookValue)}</td><td>${App.formatField('assets', 'status', a.status, a)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Bạn chưa được giao tài sản nào</td></tr>'}</tbody>
        </table></div></div>
      </div>
      <div>
        <div class="card mb"><div class="card-head"><h3>Quyền hạn của tôi</h3></div><div class="card-body">
          <div class="muted tiny mb">Vai trò <b>${U.esc(row.roleName || '')}</b> cho phép truy cập các phân hệ sau:</div>
          ${(App.state.enums.permissionModules || []).filter((mod) => App.can(mod.key, 'view')).map((mod) => `<div class="row between" style="padding:4px 0;border-bottom:1px dashed var(--border)"><span>${U.esc(mod.label)}</span><span class="tiny muted">${['view', 'create', 'update', 'delete', 'approve', 'export'].filter((a) => App.can(mod.key, a)).join(', ')}</span></div>`).join('')}
        </div></div>
        <div class="card"><div class="card-head"><h3>Phiên đăng nhập gần đây</h3></div><div class="card-body">
          ${(related.sessions || []).slice(0, 5).map((s) => `<div class="timeline-item"><div class="tt">${U.esc(s.ip || '')} ${s.revokedAt ? '<span class="badge soft">đã thu hồi</span>' : '<span class="badge" style="background:#dcfce7;color:#15803d">đang hoạt động</span>'}</div><div class="tm">${U.datetime(s.createdAt)} • ${U.esc(String(s.userAgent || '').slice(0, 60))}</div></div>`).join('') || '<div class="muted tiny">Không có dữ liệu</div>'}
        </div></div>
      </div>
    </div>`;
    container.appendChild(host);
    const passBtn = container.querySelector('#p-pass');
    if (passBtn) passBtn.onclick = Pages.changePasswordDialog;
    if (App.state.route.query.tab === 'password') Pages.changePasswordDialog();
  };

  Pages.changePasswordDialog = function () {
    const m = UI.modal({
      size: 'sm',
      title: 'Đổi mật khẩu',
      body: `<div class="field"><label>Mật khẩu hiện tại</label><input type="password" id="cp-old"/></div>
             <div class="field"><label>Mật khẩu mới</label><input type="password" id="cp-new"/><div class="hint">Tối thiểu 6 ký tự, gồm chữ và số.</div></div>
             <div class="field"><label>Xác nhận mật khẩu mới</label><input type="password" id="cp-confirm"/></div>
             <div id="cp-err"></div>`,
      footer: [
        { label: 'Huỷ', onClick: (mm) => mm.close() },
        { label: '💾 Cập nhật', cls: 'primary', onClick: async (mm) => {
          const oldP = mm.body.querySelector('#cp-old').value;
          const newP = mm.body.querySelector('#cp-new').value;
          const conf = mm.body.querySelector('#cp-confirm').value;
          const err = mm.body.querySelector('#cp-err');
          if (newP !== conf) { err.innerHTML = '<div class="alert danger">Mật khẩu xác nhận không khớp</div>'; return; }
          UI.loading(true, 'Đang cập nhật…');
          try {
            await API.post('/api/auth/change-password', { oldPassword: oldP, newPassword: newP });
            UI.loading(false); mm.close(); UI.toast('Đổi mật khẩu thành công', '', 'success');
          } catch (e) { UI.loading(false); err.innerHTML = `<div class="alert danger">${U.esc(e.message)}</div>`; }
        } },
      ],
    });
  };

  /* ============================== Khấu hao: chạy kỳ ============================== */

  Pages.depreciationRun = function () {
    const period = U.today().slice(0, 7);
    const m = UI.modal({
      title: 'Chạy khấu hao tài sản theo kỳ',
      subtitle: 'Hệ thống tính khấu hao cho toàn bộ tài sản theo phương pháp đã thiết lập và sinh bút toán',
      size: 'lg',
      body: `
        <div class="form-grid">
          <div class="field"><label>Kỳ khấu hao</label><input type="month" id="dr-period" value="${period}"/></div>
          <div class="field"><label>Phạm vi</label><select id="dr-scope">
            <option value="all">Toàn bộ tài sản</option>
            <option value="department">Theo phòng ban</option>
            <option value="category">Theo danh mục</option>
          </select></div>
          <div class="field hidden" id="dr-dept-wrap"><label>Phòng ban</label><select id="dr-dept"></select></div>
          <div class="field hidden" id="dr-cat-wrap"><label>Danh mục</label><select id="dr-cat"></select></div>
          <div class="field span-2"><label class="checkbox"><input type="checkbox" id="dr-overwrite"/> <span>Ghi đè nếu kỳ này đã có bút toán (chạy lại kỳ)</span></label></div>
        </div>
        <div class="row mb"><button class="btn" id="dr-preview">👁 Xem trước kết quả tính</button><span class="muted tiny" id="dr-info"></span></div>
        <div id="dr-table"></div>`,
      footer: [
        { label: 'Huỷ', onClick: (mm) => mm.close() },
        { label: '⚙️ Chạy khấu hao kỳ này', cls: 'primary', id: 'dr-run', onClick: async (mm) => {
          const okd = await UI.confirm({ title: 'Xác nhận chạy khấu hao?', message: 'Hệ thống sẽ sinh bút toán khấu hao và cập nhật hao mòn luỹ kế cho các tài sản trong phạm vi đã chọn.', confirmText: '⚙️ Chạy ngay' });
          if (!okd) return;
          UI.loading(true, 'Đang tính khấu hao…');
          try {
            const res = await API.post('/api/depreciations/run', {
              period: mm.body.querySelector('#dr-period').value,
              scope: mm.body.querySelector('#dr-scope').value,
              departmentId: mm.body.querySelector('#dr-dept').value,
              categoryId: mm.body.querySelector('#dr-cat').value,
              overwrite: mm.body.querySelector('#dr-overwrite').checked,
            });
            UI.loading(false);
            mm.close();
            UI.toast('Chạy khấu hao thành công', `${res.data.processed} bút toán • Tổng ${U.money(res.data.totalAmount)}`, 'success');
            App.Router.resolve();
          } catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
        } },
      ],
    });
    const scopeSel = m.body.querySelector('#dr-scope');
    scopeSel.onchange = () => {
      m.body.querySelector('#dr-dept-wrap').classList.toggle('hidden', scopeSel.value !== 'department');
      m.body.querySelector('#dr-cat-wrap').classList.toggle('hidden', scopeSel.value !== 'category');
    };
    Promise.all([API.get('/api/lookups/departments'), API.get('/api/lookups/categories')]).then(([d, c]) => {
      (d.data || []).forEach((x) => { const o = document.createElement('option'); o.value = x.id; o.textContent = x.label; m.body.querySelector('#dr-dept').appendChild(o); });
      (c.data || []).forEach((x) => { const o = document.createElement('option'); o.value = x.id; o.textContent = x.label; m.body.querySelector('#dr-cat').appendChild(o); });
    });
    m.body.querySelector('#dr-preview').onclick = async () => {
      UI.loading(true, 'Đang tính toán…');
      try {
        const period2 = m.body.querySelector('#dr-period').value || period;
        const res = await API.get(`/api/depreciations/preview?period=${period2}`);
        UI.loading(false);
        const rows = res.data || [];
        m.body.querySelector('#dr-info').innerHTML = `<b>${rows.length}</b> tài sản • Tổng khấu hao kỳ: <b>${U.money(res.meta.total)}</b>`;
        m.body.querySelector('#dr-table').innerHTML = `<div class="table-wrap" style="max-height:340px;border:1px solid var(--border);border-radius:8px">
          <table class="data compact"><thead><tr><th>Mã</th><th>Tên tài sản</th><th>Phòng ban</th><th class="num">Nguyên giá</th><th class="num">Giá trị đầu kỳ</th><th class="num">KH kỳ này</th><th class="num">Còn lại</th><th class="ctr">Trạng thái</th></tr></thead>
          <tbody>${rows.slice(0, 200).map((r) => `<tr><td class="mono">${U.esc(r.code)}</td><td>${U.esc(r.name)}</td><td>${U.esc(r.departmentName || '')}</td>
            <td class="num">${U.money(r.originalCost)}</td><td class="num">${U.money(r.openingValue)}</td>
            <td class="num"><b>${U.money(r.amount)}</b></td><td class="num">${U.money(r.closingValue)}</td>
            <td class="ctr">${r.existing ? '<span class="badge" style="background:#fef3c7;color:#92400e">đã có bút toán</span>' : '<span class="badge" style="background:#dcfce7;color:#15803d">chờ chạy</span>'}</td></tr>`).join('')}</tbody></table></div>`;
      } catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
    };
  };

  /* ============================== Wrapper danh sách + hành động đặc thù ============================== */

  Pages.assetsPage = function (container) {
    return Pages.entityList('assets', container, {
      headActions: `${App.can('assets', 'create') ? '<button class="btn" id="hd-import-invoice">📥 Nhập tài sản hàng loạt</button>' : ''}
        ${App.can('assets', 'view') ? '<button class="btn" id="hd-reports">📊 Báo cáo tài sản</button>' : ''}`,
      onReady: (table, cont) => {
        const imp = cont.querySelector('#hd-import-invoice');
        if (imp) imp.onclick = () => UI.importDialog('assets', () => table.reload());
        const rep = cont.querySelector('#hd-reports');
        if (rep) rep.onclick = () => App.Router.navigate('/reports');
      },
      extraActions: () => [
        { label: 'In tem', icon: '🏷', title: 'In tem tài sản', onClick: (row) => API.openHTML(`/api/documents/label/${row.id}`) },
        { label: 'Bảng KH', icon: '📉', title: 'Bảng khấu hao', onClick: (row) => API.openHTML(`/api/documents/depreciation/${row.id}`) },
      ],
    });
  };

  Pages.depreciationsPage = function (container) {
    return Pages.entityList('depreciations', container, {
      subtitle: 'Bút toán khấu hao tài sản theo kỳ — sinh tự động hoặc chạy thủ công theo phạm vi.',
      headActions: App.can('depreciations', 'create') ? '<button class="btn primary" id="hd-run-dep">⚙️ Chạy khấu hao kỳ</button>' : '',
      onReady: (table, cont) => {
        const btn = cont.querySelector('#hd-run-dep');
        if (btn) btn.onclick = () => Pages.depreciationRun();
      },
    });
  };

  Pages.stocktakesPage = function (container) {
    return Pages.entityList('stocktakes', container, {
      extraActions: [
        { label: 'Kiểm kê', icon: '🧮', title: 'Vào màn hình kiểm kê', showIf: (row) => row.status === 'open', onClick: (row) => App.Router.navigate(`/stocktakes/${row.id}/count`) },
        { label: 'In BB', icon: '🖨', title: 'In biên bản kiểm kê', onClick: (row) => API.openHTML(`/api/documents/stocktake/${row.id}`) },
      ],
    });
  };

  Pages.transfersPage = function (container) {
    return Pages.entityList('transfers', container, {
      extraActions: [
        { label: 'Duyệt', icon: '✔', title: 'Phê duyệt', showIf: (row) => row.status === 'pending' && App.can('transfers', 'approve'), onClick: (row) => Actions.workflow('transfers', row.id, 'approve', () => App.Router.resolve()) },
        { label: 'Từ chối', icon: '✖', title: 'Từ chối', showIf: (row) => row.status === 'pending' && App.can('transfers', 'approve'), onClick: (row) => Actions.workflow('transfers', row.id, 'reject', () => App.Router.resolve()) },
        { label: 'In', icon: '🖨', title: 'In phiếu điều chuyển', onClick: (row) => API.openHTML(`/api/documents/transfer/${row.id}`) },
      ],
    });
  };

  Pages.disposalsPage = function (container) {
    return Pages.entityList('disposals', container, {
      extraActions: [
        { label: 'Duyệt', icon: '✔', showIf: (row) => row.status === 'pending' && App.can('disposals', 'approve'), onClick: (row) => Actions.workflow('disposals', row.id, 'approve', () => App.Router.resolve()) },
        { label: 'Hoàn tất', icon: '🏁', showIf: (row) => row.status === 'approved' && App.can('disposals', 'update'), onClick: (row) => Actions.workflow('disposals', row.id, 'complete', () => App.Router.resolve()) },
        { label: 'In BB', icon: '🖨', onClick: (row) => API.openHTML(`/api/documents/disposal/${row.id}`) },
      ],
    });
  };

  Pages.maintenancesPage = function (container) {
    return Pages.entityList('maintenances', container, {
      extraActions: [
        { label: 'Hoàn thành', icon: '✔', showIf: (row) => ['pending', 'approved', 'in_progress'].includes(row.status) && App.can('maintenances', 'update'), onClick: (row) => Actions.workflow('maintenances', row.id, 'complete', () => App.Router.resolve()) },
        { label: 'In', icon: '🖨', onClick: (row) => API.openHTML(`/api/documents/maintenance/${row.id}`) },
      ],
    });
  };

  Pages.warrantiesPage = function (container) {
    return Pages.entityList('warranties', container, {
      extraActions: [{ label: 'In', icon: '🖨', onClick: (row) => API.openHTML(`/api/documents/warranty/${row.id}`) }],
    });
  };

  Pages.contractsPage = function (container) {
    return Pages.entityList('contracts', container, {
      extraActions: [{ label: 'Bảng kê', icon: '🖨', title: 'In bảng kê tài sản theo hợp đồng', onClick: (row) => API.openHTML(`/api/documents/contract/${row.id}`) }],
    });
  };

  Pages.assignmentsPage = function (container) {
    return Pages.entityList('assignments', container, {
      extraActions: [{ label: 'In BB', icon: '🖨', title: 'In biên bản bàn giao', onClick: (row) => API.openHTML(`/api/documents/assignment/${row.id}`) }],
    });
  };

  Pages.notificationsPage = async function (container) {
    container.innerHTML = pageHead('Thông báo hệ thống', 'Cảnh báo bảo trì, bảo hành, phê duyệt và các sự kiện quan trọng',
      '<button class="btn" id="nt-mark">✔ Đánh dấu đã đọc tất cả</button><button class="btn primary" id="nt-refresh">🔄 Quét cảnh báo mới</button>');
    const host = document.createElement('div');
    container.appendChild(host);
    const render = async () => {
      const res = await API.get('/api/notifications');
      const rows = res.data || [];
      host.innerHTML = `<div class="card">${rows.length ? rows.map((n) => `
        <div class="row" style="padding:11px 14px;border-bottom:1px solid var(--border);gap:12px;${n.readAt ? '' : 'background:var(--c-primary-light)'}">
          <div style="width:8px;height:8px;border-radius:50%;background:${n.level === 'danger' ? '#ef4444' : n.level === 'warning' ? '#f59e0b' : n.level === 'success' ? '#16a34a' : '#0ea5e9'};margin-top:6px"></div>
          <div style="flex:1">
            <div class="row between"><b>${U.esc(n.title)}</b><span class="tiny muted">${U.timeAgo(n.createdAt)}</span></div>
            <div class="tiny muted">${U.esc(n.message)}</div>
          </div>
          ${n.link ? `<a class="btn sm" href="${U.attr(n.link)}">Mở</a>` : ''}
        </div>`).join('') : UI.emptyState('🔔', 'Không có thông báo', '')}</div>`;
    };
    await render();
    container.querySelector('#nt-mark').onclick = async () => { await API.post('/api/notifications/mark', { all: true }); UI.toast('Đã đánh dấu tất cả là đã đọc', '', 'success'); App.refreshNotifications(); render(); };
    container.querySelector('#nt-refresh').onclick = async () => {
      UI.loading(true, 'Đang quét cảnh báo…');
      const r = await API.post('/api/notifications/refresh-alerts', {});
      UI.loading(false);
      UI.toast('Đã quét cảnh báo', `${r.data.created} thông báo mới được tạo`, 'success');
      App.refreshNotifications(); render();
    };
  };

  /* ============================== Trang lỗi / 404 ============================== */
  Pages.notFound = function (container) {
    container.innerHTML = '<div class="card">' + UI.emptyState('🧭', 'Không tìm thấy trang', 'Đường dẫn không tồn tại.', '<a class="btn primary" href="#/dashboard">Về bảng điều khiển</a>') + '</div>';
  };
})();
