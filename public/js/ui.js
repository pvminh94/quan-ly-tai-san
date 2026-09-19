/* ==========================================================================
   ui.js — Thư viện thành phần giao diện: bảng dữ liệu, biểu mẫu, modal…
   ========================================================================== */
(function () {
  'use strict';
  const U = App.U;
  const API = App.api;

  const UI = {};
  window.UI = UI;

  /* ============================== Toast ============================== */
  UI.toast = function (title, message, type, ms) {
    const root = document.getElementById('toast-root');
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.innerHTML = `<b>${U.esc(title)}</b>${message ? `<span class="muted">${U.esc(message)}</span>` : ''}`;
    root.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; el.style.transition = 'all .2s'; setTimeout(() => el.remove(), 220); }, ms || (type === 'error' ? 6000 : 3600));
  };

  /* ============================== Overlay tải ============================== */
  UI.loading = function (show, text) {
    const el = document.getElementById('loading-overlay');
    document.getElementById('loading-text').textContent = text || 'Đang xử lý…';
    el.classList.toggle('hidden', !show);
  };

  /* ============================== Modal ============================== */
  UI.modal = function (opts) {
    const o = Object.assign({ size: '', title: '', subtitle: '', body: '', footer: null, onOpen: null, closeOnOverlay: true }, opts || {});
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal ${o.size}">
        <div class="modal-head">
          <div>
            <h3>${U.esc(o.title)}</h3>
            ${o.subtitle ? `<div class="sub">${U.esc(o.subtitle)}</div>` : ''}
          </div>
          <button class="icon-btn x" title="Đóng (Esc)">✕</button>
        </div>
        <div class="modal-body"></div>
        ${o.footer === null ? '' : '<div class="modal-foot"></div>'}
      </div>`;
    const bodyEl = overlay.querySelector('.modal-body');
    if (typeof o.body === 'string') bodyEl.innerHTML = o.body;
    else if (o.body) bodyEl.appendChild(o.body);

    const foot = overlay.querySelector('.modal-foot');
    if (foot && o.footer) {
      if (typeof o.footer === 'string') foot.innerHTML = o.footer;
      else {
        o.footer.forEach((b) => {
          const btn = document.createElement('button');
          btn.className = 'btn ' + (b.cls || '');
          btn.innerHTML = b.label;
          if (b.left) btn.classList.add('left');
          btn.onclick = () => b.onClick ? b.onClick(api_of(overlay)) : api_of(overlay).close();
          if (b.id) btn.id = b.id;
          foot.appendChild(btn);
        });
      }
    }
    document.getElementById('modal-root').appendChild(overlay);

    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      if (o.onClose) o.onClose();
    }
    function onKey(e) { if (e.key === 'Escape' && o.closeOnOverlay !== 'never') close(); }
    overlay.querySelector('.x').onclick = close;
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay && o.closeOnOverlay) close(); });
    document.addEventListener('keydown', onKey);

    const api_of = (el) => ({
      el,
      body: el.querySelector('.modal-body'),
      foot: el.querySelector('.modal-foot'),
      close,
      setTitle(t) { el.querySelector('.modal-head h3').innerHTML = t; },
    });
    if (o.onOpen) o.onOpen(api_of(overlay));
    const firstInput = overlay.querySelector('input:not([type=hidden]), select, textarea');
    if (firstInput) setTimeout(() => firstInput.focus(), 60);
    return api_of(overlay);
  };

  /* ============================== Xác nhận ============================== */
  UI.confirm = function (opts) {
    const o = Object.assign({ title: 'Xác nhận', message: '', confirmText: 'Đồng ý', cancelText: 'Huỷ', danger: false }, opts || {});
    return new Promise((resolve) => {
      const m = UI.modal({
        size: 'sm',
        title: o.title,
        body: `<div style="font-size:13.5px">${o.message}</div>`,
        footer: [
          { label: o.cancelText, onClick: (m2) => { m2.close(); resolve(false); } },
          { label: o.confirmText, cls: o.danger ? 'danger' : 'primary', onClick: (m2) => { m2.close(); resolve(true); } },
        ],
        onClose: () => resolve(false),
      });
      if (o.focusConfirm) setTimeout(() => { const b = m.el.querySelector('.modal-foot .btn:last-child'); if (b) b.focus(); }, 80);
    });
  };

  /* ============================== Bảng dữ liệu ============================== */
  /**
   * UI.dataTable(container, config)
   * config: { entity, tableName, columns:[{key,label,type,render,width,align,sortable}], query:{}, rowActions, bulkActions,
   *           onRowClick, filters:[{key,label,type,options}], exportable, importable, refreshKey, pageSize, selectable, emptyText, toolbarExtra }
   */
  UI.dataTable = async function (container, config) {
    const cfg = Object.assign({
      entity: null, columns: [], query: {}, rowActions: [], bulkActions: [], filters: [],
      selectable: false, exportable: false, importable: false, pageSize: App.pref.get('pageSize', 25),
      emptyText: 'Không có dữ liệu phù hợp', rowKey: 'id',
    }, config);

    const state = Object.assign({ page: 1, limit: cfg.pageSize, q: '', sort: '', order: '', filters: {} }, cfg.query || {});
    const selected = new Set();
    const hiddenCols = new Set(App.pref.get('cols.' + (cfg.entity || cfg.tableName), []));

    container.innerHTML = `
      <div class="card">
        <div class="table-toolbar">
          <input type="search" class="dt-search" placeholder="🔍 Tìm kiếm…" value="${U.attr(state.q)}"/>
          ${cfg.filters.map(filterHTML).join('')}
          <div class="spacer"></div>
          <span class="muted tiny dt-count"></span>
          <button class="btn sm dt-columns" title="Chọn cột hiển thị">▦ Cột</button>
          ${cfg.importable && App.can(cfg.entity, 'create') ? `<button class="btn sm dt-import">⬆ Nhập Excel/CSV</button>` : ''}
          ${cfg.exportable !== false && App.can(cfg.entity, 'export') ? `<button class="btn sm dt-export">⬇ Xuất CSV</button>` : ''}
          <button class="btn sm dt-refresh" title="Tải lại">↻</button>
        </div>
        <div class="dt-bulkbar"></div>
        <div class="table-wrap"><table class="data compact"><thead></thead><tbody><tr><td class="empty">Đang tải…</td></tr></tbody></table></div>
        <div class="pagination"></div>
      </div>`;

    const tableEl = container.querySelector('table');
    const tbody = tableEl.querySelector('tbody');
    const thead = tableEl.querySelector('thead');
    const bulkbar = container.querySelector('.dt-bulkbar');

    function visibleColumns() {
      return cfg.columns.filter((c) => !hiddenCols.has(c.key));
    }

    function filterHTML(f) {
      if (f.type === 'select') {
        return `<select class="dt-filter" data-key="${U.attr(f.key)}" title="${U.attr(f.label)}">
          <option value="">${U.esc(f.label)}: Tất cả</option>
          ${(f.options || []).map((o) => `<option value="${U.attr(o.value)}">${U.esc(o.label)}</option>`).join('')}
        </select>`;
      }
      if (f.type === 'ref') {
        return `<select class="dt-filter" data-key="${U.attr(f.key)}" title="${U.attr(f.label)}" data-ref="${U.attr(f.ref)}">
          <option value="">${U.esc(f.label)}: Tất cả</option></select>`;
      }
      if (f.type === 'date') {
        return `<input type="date" class="dt-filter" data-key="${U.attr(f.key)}" data-op="${U.attr(f.op || 'from')}" title="${U.attr(f.label)}"/>`;
      }
      return `<input type="text" class="dt-filter" data-key="${U.attr(f.key)}" placeholder="${U.attr(f.label)}" style="width:150px"/>`;
    }

    async function loadRefFilters() {
      for (const f of cfg.filters.filter((x) => x.type === 'ref')) {
        const sel = container.querySelector(`.dt-filter[data-ref="${f.ref}"]`);
        if (!sel) continue;
        try {
          const res = await API.get('/api/lookups/' + f.ref);
          (res.data || []).forEach((o) => {
            const opt = document.createElement('option');
            opt.value = o.id; opt.textContent = o.label;
            sel.appendChild(opt);
          });
        } catch (e) { /* bỏ qua */ }
      }
    }

    function renderHead() {
      const cols = visibleColumns();
      thead.innerHTML = `<tr>
        ${cfg.selectable ? '<th class="ctr no-sort" style="width:34px"><input type="checkbox" class="dt-all"/></th>' : ''}
        ${cols.map((c) => {
          const sortable = c.sortable !== false && cfg.entity;
          const ind = state.sort === c.key ? `<span class="sort-ind">${state.order === 'asc' ? '▲' : '▼'}</span>` : '';
          const st = c.width ? ` style="width:${c.width}px"` : '';
          return `<th class="${c.align || ''} ${sortable ? '' : 'no-sort'}" data-sort="${c.key}"${st}>${U.esc(c.label)}${ind}</th>`;
        }).join('')}
        ${cfg.rowActions.length ? '<th class="no-sort" style="width:1%"></th>' : ''}
      </tr>`;
      thead.querySelectorAll('th[data-sort]').forEach((th) => {
        th.onclick = () => {
          const key = th.dataset.sort;
          if (state.sort === key) state.order = state.order === 'asc' ? 'desc' : 'asc';
          else { state.sort = key; state.order = 'asc'; }
          load();
        };
      });
      const all = thead.querySelector('.dt-all');
      if (all) all.onchange = () => { document.querySelectorAll('.dt-row-check').forEach((cb) => { cb.checked = all.checked; toggleSel(cb.dataset.id, all.checked); }); };
    }

    function toggleSel(id, on) {
      if (on) selected.add(String(id)); else selected.delete(String(id));
      renderBulk();
    }

    function renderBulk() {
      if (!cfg.selectable) return;
      if (!selected.size) { bulkbar.innerHTML = ''; return; }
      bulkbar.innerHTML = `<div class="row" style="padding:8px 12px;background:var(--c-primary-light);border-bottom:1px solid var(--border)">
        <b>Đã chọn ${selected.size} bản ghi</b>
        <div class="spacer" style="flex:1"></div>
        ${cfg.bulkActions.map((b, i) => `<button class="btn sm ${b.cls || ''}" data-bi="${i}">${U.esc(b.label)}</button>`).join('')}
        <button class="btn sm ghost" data-bi="clear">Bỏ chọn</button>
      </div>`;
      bulkbar.querySelectorAll('[data-bi]').forEach((btn) => {
        btn.onclick = () => {
          if (btn.dataset.bi === 'clear') { selected.clear(); document.querySelectorAll('.dt-row-check,.dt-all').forEach((cb) => (cb.checked = false)); renderBulk(); return; }
          const b = cfg.bulkActions[Number(btn.dataset.bi)];
          b.onClick(Array.from(selected), { reload: load, clear: () => { selected.clear(); renderBulk(); } });
        };
      });
    }

    async function load() {
      tbody.innerHTML = `<tr><td colspan="20" class="empty">Đang tải dữ liệu…</td></tr>`;
      const q = {};
      if (state.q) q.q = state.q;
      if (state.sort) { q.sort = state.sort; q.order = state.order; }
      q.page = state.page; q.limit = state.limit;
      Object.keys(state.filters).forEach((k) => { if (state.filters[k]) q['filter[' + k + ']'] = state.filters[k]; });
      Object.keys(state.ranges || {}).forEach((k) => Object.keys(state.ranges[k]).forEach((op) => { if (state.ranges[k][op]) q[op + '[' + k + ']'] = state.ranges[k][op]; }));
      if (state.includeDeleted) q.includeDeleted = '1';
      try {
        const res = await API.get(`/api/entities/${cfg.entity}?` + U.qs(q));
        renderRows(res.data || [], res.meta || {});
        lastMeta = res.meta || {};
      } catch (e) {
        tbody.innerHTML = `<tr><td colspan="20" class="empty">⚠️ ${U.esc(e.message)}</td></tr>`;
      }
    }
    let lastMeta = {};

    function renderRows(rows, meta) {
      renderHead();
      const cols = visibleColumns();
      container.querySelector('.dt-count').textContent = meta.total !== undefined ? `${U.num(meta.total)} bản ghi` : '';
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="${cols.length + 2}" class="empty"><div class="icon">📭</div><div>${U.esc(cfg.emptyText)}</div></td></tr>`;
      } else {
        tbody.innerHTML = rows.map((row) => `
          <tr data-id="${U.attr(row[cfg.rowKey])}" class="${row.isDeleted ? 'deleted' : ''}">
            ${cfg.selectable ? `<td class="ctr"><input type="checkbox" class="dt-row-check" data-id="${U.attr(row[cfg.rowKey])}" ${selected.has(String(row[cfg.rowKey])) ? 'checked' : ''}/></td>` : ''}
            ${cols.map((c) => {
              const val = c.render ? c.render(row) : App.formatField(cfg.entity, c.key, row[c.key], row);
              return `<td class="${c.align || ''}" ${c.nowrap ? 'style="white-space:nowrap"' : ''}>${val}</td>`;
            }).join('')}
            ${cfg.rowActions.length ? `<td class="actions">${cfg.rowActions.filter((a) => !a.showIf || a.showIf(row)).map((a, i) => `<button class="btn sm ghost" data-act="${i}" title="${U.attr(a.title || a.label)}">${a.icon || U.esc(a.label)}</button>`).join('')}</td>` : ''}
          </tr>`).join('');
      }
      tbody.querySelectorAll('.dt-row-check').forEach((cb) => (cb.onchange = () => toggleSel(cb.dataset.id, cb.checked)));
      tbody.querySelectorAll('tbody tr').forEach((tr) => {
        const row = rows.find((r) => String(r[cfg.rowKey]) === tr.dataset.id);
        tr.querySelectorAll('[data-act]').forEach((btn) => {
          btn.onclick = (e) => {
            e.stopPropagation();
            cfg.rowActions[Number(btn.dataset.act)].onClick(row, { reload: load });
          };
        });
        if (cfg.onRowClick) tr.onclick = (e) => { if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') cfg.onRowClick(row, { reload: load }); };
      });
      renderPagination(meta);
      renderBulk();
    }

    function renderPagination(meta) {
      const el = container.querySelector('.pagination');
      const pages = meta.pages || 1;
      const cur = meta.page || 1;
      let buttons = '';
      const add = (p, label, cls) => (buttons += `<button class="pg ${cls || ''}" data-p="${p}">${label}</button>`);
      add(cur - 1, '‹', cur <= 1 ? 'disabled' : '');
      const start = Math.max(1, cur - 2), end = Math.min(pages, start + 4);
      if (start > 1) add(1, '1');
      if (start > 2) buttons += '<span style="padding:0 4px">…</span>';
      for (let p = start; p <= end; p++) add(p, String(p), p === cur ? 'active' : '');
      if (end < pages - 1) buttons += '<span style="padding:0 4px">…</span>';
      if (end < pages) add(pages, String(pages));
      add(cur + 1, '›', cur >= pages ? 'disabled' : '');
      el.innerHTML = `
        <span>Hiển thị ${U.num(meta.from || 0)}–${U.num(meta.to || 0)} / ${U.num(meta.total || 0)} bản ghi</span>
        <select class="dt-limit" style="width:auto;padding:4px 8px">
          ${[10, 25, 50, 100, 200].map((n) => `<option ${n === state.limit ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
        <span class="muted tiny">/ trang</span>
        <div class="pages">${buttons}</div>`;
      el.querySelectorAll('.pg[data-p]').forEach((b) => {
        b.onclick = () => { const p = Number(b.dataset.p); if (p >= 1 && p <= pages && p !== cur) { state.page = p; load(); } };
      });
      el.querySelector('.dt-limit').onchange = (e) => { state.limit = Number(e.target.value); App.pref.set('pageSize', state.limit); state.page = 1; load(); };
    }

    /* ------------------------------ Sự kiện toolbar ------------------------------ */
    container.querySelector('.dt-search').oninput = U.debounce((e) => { state.q = e.target.value; state.page = 1; load(); }, 350);
    container.querySelector('.dt-refresh').onclick = () => load();
    container.querySelectorAll('.dt-filter').forEach((el) => {
      const ev = el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input';
      el.addEventListener(ev, U.debounce(() => {
        const key = el.dataset.key;
        if (el.dataset.op) {
          state.ranges = state.ranges || {};
          state.ranges[key] = state.ranges[key] || {};
          state.ranges[key][el.dataset.op === 'from' ? 'from' : 'to'] = el.value;
        } else {
          state.filters[key] = el.value;
        }
        state.page = 1;
        load();
      }, 250));
    });
    const exportBtn = container.querySelector('.dt-export');
    if (exportBtn) exportBtn.onclick = () => UI.exportDialog(cfg.entity, state);
    const importBtn = container.querySelector('.dt-import');
    if (importBtn) importBtn.onclick = () => UI.importDialog(cfg.entity, load);
    container.querySelector('.dt-columns').onclick = () => {
      const items = cfg.columns.map((c) => ({
        key: c.key, label: c.label, checked: !hiddenCols.has(c.key),
      }));
      const m = UI.modal({
        size: 'sm',
        title: 'Chọn cột hiển thị',
        body: `<div style="display:flex;flex-direction:column;gap:6px">${items.map((it) => `<label class="checkbox"><input type="checkbox" data-col="${U.attr(it.key)}" ${it.checked ? 'checked' : ''}/> <span>${U.esc(it.label)}</span></label>`).join('')}</div>`,
        footer: [
          { label: 'Khôi phục mặc định', onClick: () => { App.pref.remove('cols.' + cfg.entity); location.reload(); } },
          { label: 'Áp dụng', cls: 'primary', onClick: (mm) => {
            const hidden = [];
            mm.body.querySelectorAll('[data-col]').forEach((cb) => { if (!cb.checked) hidden.push(cb.dataset.col); });
            App.pref.set('cols.' + cfg.entity, hidden);
            hiddenCols.clear(); hidden.forEach((h) => hiddenCols.add(h));
            mm.close(); load();
          } },
        ],
      });
    };

    await loadRefFilters();
    await load();
    return { reload: load, state, getSelected: () => Array.from(selected) };
  };

  /* ============================== Xuất / Nhập dữ liệu ============================== */
  UI.exportDialog = function (entityName, state) {
    const entity = App.state.entities[entityName];
    const fields = Object.keys(entity.fields).filter((f) => !['json', 'password'].includes(entity.fields[f].type));
    const m = UI.modal({
      title: 'Xuất dữ liệu ra CSV (mở được bằng Excel)',
      subtitle: entity.label,
      body: `
        <div class="alert info mb">File CSV có mã UTF-8 BOM, mở trực tiếp bằng Excel không bị lỗi tiếng Việt.</div>
        <div class="row between mb"><b>Chọn trường xuất</b>
          <div class="row"><button class="btn sm" id="ex-all">Chọn tất cả</button><button class="btn sm" id="ex-none">Bỏ chọn</button></div>
        </div>
        <div class="grid cols-3" style="gap:4px;max-height:340px;overflow:auto">
          ${fields.map((f) => `<label class="checkbox"><input type="checkbox" data-f="${U.attr(f)}" checked/> <span class="tiny">${U.esc(entity.fields[f].label)}</span></label>`).join('')}
        </div>`,
      footer: [
        { label: 'Huỷ', onClick: (mm) => mm.close() },
        { label: '⬇ Xuất CSV', cls: 'primary', onClick: async (mm) => {
          const chosen = Array.from(mm.body.querySelectorAll('[data-f]:checked')).map((cb) => cb.dataset.f);
          const q = { fields: chosen.join(','), q: state.q || '', limit: 5000 };
          Object.keys(state.filters || {}).forEach((k) => { if (state.filters[k]) q['filter[' + k + ']'] = state.filters[k]; });
          mm.close();
          try {
            await API.download(`/api/entities/${entityName}/export.csv?` + U.qs(q), 'GET', null, `${entityName}-${U.today()}.csv`);
            UI.toast('Đã xuất dữ liệu', `${chosen.length} trường • ${entity.label}`, 'success');
          } catch (e) { UI.toast('Lỗi xuất dữ liệu', e.message, 'error'); }
        } },
      ],
    });
    m.body.querySelector('#ex-all').onclick = () => m.body.querySelectorAll('[data-f]').forEach((cb) => (cb.checked = true));
    m.body.querySelector('#ex-none').onclick = () => m.body.querySelectorAll('[data-f]').forEach((cb) => (cb.checked = false));
  };

  UI.importDialog = function (entityName, onDone) {
    const entity = App.state.entities[entityName];
    const m = UI.modal({
      title: 'Nhập dữ liệu từ CSV',
      subtitle: 'Hỗ trợ file xuất từ Excel (lưu dạng CSV UTF-8)',
      size: 'lg',
      body: `
        <div class="alert info mb">Hàng đầu tiên phải là <b>tên trường</b> (mã field) hoặc <b>nhãn tiếng Việt</b>. Ví dụ: <code class="mono">name</code> hoặc <code class="mono">Tên tài sản</code>.</div>
        <div class="dropzone" id="imp-drop">📄 <b>Kéo thả file CSV vào đây</b> hoặc bấm để chọn file<br/><span class="tiny">Kích thước tối đa 20MB</span>
          <input type="file" id="imp-file" accept=".csv,text/csv" class="hidden"/>
        </div>
        <div class="field mt"><label>Chế độ nhập</label>
          <select id="imp-mode">
            <option value="append">Thêm mới (báo lỗi nếu trùng mã)</option>
            <option value="upsert">Cập nhật nếu trùng mã, thêm mới nếu chưa có</option>
          </select>
        </div>
        <div id="imp-preview"></div>`,
      footer: [
        { label: 'Huỷ', onClick: (mm) => mm.close() },
        { label: '⬆ Bắt đầu nhập', cls: 'primary', id: 'imp-run', onClick: () => {} },
      ],
    });
    let rows = [];
    let headers = [];
    const drop = m.body.querySelector('#imp-drop');
    const fileInput = m.body.querySelector('#imp-file');
    const preview = m.body.querySelector('#imp-preview');
    drop.onclick = () => fileInput.click();
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); readFile(e.dataTransfer.files[0]); };
    fileInput.onchange = () => readFile(fileInput.files[0]);

    function readFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const parsed = U.parseCSV(String(reader.result));
        if (!parsed.length) { preview.innerHTML = '<div class="alert danger">File rỗng hoặc không đọc được.</div>'; return; }
        headers = parsed[0].map((h) => h.trim());
        // ánh xạ nhãn tiếng Việt -> key
        const map = {};
        headers.forEach((h, i) => {
          let key = h;
          if (!entity.fields[key]) {
            const found = Object.keys(entity.fields).find((f) => U.norm(entity.fields[f].label) === U.norm(h));
            if (found) key = found;
          }
          map[i] = key;
        });
        rows = parsed.slice(1).map((r) => {
          const o = {};
          r.forEach((v, i) => { if (map[i]) o[map[i]] = v; });
          return o;
        });
        preview.innerHTML = `
          <div class="alert success mb">Đọc được <b>${rows.length}</b> dòng, ${headers.length} cột.</div>
          <div class="csv-preview"><table class="data compact"><thead><tr>${headers.map((h) => `<th>${U.esc(entity.fields[h] ? entity.fields[h].label : h)}</th>`).join('')}</tr></thead>
          <tbody>${rows.slice(0, 6).map((r) => `<tr>${headers.map((h) => `<td>${U.esc(r[h] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      };
      reader.readAsText(file, 'utf-8');
    }

    m.foot.querySelector('#imp-run').onclick = async () => {
      if (!rows.length) return UI.toast('Chưa có dữ liệu', 'Vui lòng chọn file CSV hợp lệ', 'warning');
      UI.loading(true, 'Đang nhập dữ liệu…');
      try {
        const res = await API.post(`/api/entities/${entityName}/import`, { rows, mode: m.body.querySelector('#imp-mode').value });
        UI.loading(false);
        const r = res.data;
        UI.modal({
          title: 'Kết quả nhập dữ liệu',
          size: 'sm',
          body: `<div class="stat-row"><span>Thêm mới thành công</span><b style="color:var(--c-success)">${r.inserted}</b></div>
                 <div class="stat-row"><span>Cập nhật</span><b>${r.updated}</b></div>
                 <div class="stat-row"><span>Lỗi</span><b style="color:var(--c-danger)">${r.failed}</b></div>
                 ${r.errors.length ? `<div class="alert danger mt" style="max-height:220px;overflow:auto"><div>${r.errors.slice(0, 30).map((e) => `Dòng ${e.row}: ${U.esc(e.message)}`).join('<br/>')}</div></div>` : ''}`,
        });
        m.close();
        if (onDone) onDone();
      } catch (e) {
        UI.loading(false);
        UI.toast('Nhập dữ liệu thất bại', e.message, 'error');
      }
    };
  };

  /* ============================== Biểu mẫu tự sinh ============================== */
  /**
   * UI.entityForm(container, entityName, record, options)
   * Sinh form từ metadata; trả về { collect(), validate(), setErrors(), el }
   */
  UI.entityForm = function (container, entityName, record, options) {
    const o = options || {};
    const entity = App.state.entities[entityName];
    const data = record || {};
    const refs = {}; // cache danh mục tra cứu

    const groups = {};
    const order = [];
    Object.keys(entity.fields).forEach((fname) => {
      const f = entity.fields[fname];
      if (f.hidden && !f.computed) return;
      if (f.computed) return;
      if (o.skipFields && o.skipFields.includes(fname)) return;
      const g = f.group || 'Thông tin chung';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push({ name: fname, field: f });
    });

    function inputHTML(name, f) {
      const val = data[name];
      const cls = 'fld';
      const attrs = `data-field="${U.attr(name)}" class="${cls}" ${f.required ? 'data-required="1"' : ''}`;
      switch (f.type) {
        case 'text':
          return `<textarea ${attrs} rows="3">${U.esc(val || '')}</textarea>`;
        case 'bool':
          return `<label class="checkbox"><input type="checkbox" ${attrs} ${val ? 'checked' : ''}/> <span>${U.esc(f.label)}</span></label>`;
        case 'select':
          return `<select ${attrs}>
            ${f.required ? '' : '<option value="">— Chưa chọn —</option>'}
            ${(f.options || []).map((opt) => `<option value="${U.attr(opt.value)}" ${String(val) === String(opt.value) ? 'selected' : ''}>${U.esc(opt.label)}</option>`).join('')}
          </select>`;
        case 'date':
          return `<input type="date" ${attrs} value="${U.attr(val ? String(val).slice(0, 10) : '')}"/>`;
        case 'datetime':
          return `<input type="datetime-local" ${attrs} value="${U.attr(val ? String(val).slice(0, 16) : '')}"/>`;
        case 'number':
        case 'money':
        case 'percent':
          return `<input type="number" step="any" ${attrs} value="${U.attr(val === undefined || val === null ? '' : val)}"/>`;
        case 'password':
          return `<input type="password" ${attrs} placeholder="${f.hint || 'Tối thiểu 6 ký tự'}"/>`;
        case 'tags':
          return `<input type="text" ${attrs} value="${U.attr(Array.isArray(val) ? val.join(', ') : (val || ''))}" placeholder="Cách nhau bằng dấu phẩy"/>`;
        case 'image':
          return `<input type="text" ${attrs} value="${U.attr(val || '')}" placeholder="Dán URL hình ảnh"/>`;
        case 'ref':
          return `<select ${attrs} data-ref="${U.attr(f.ref)}" ${f.required ? 'data-required="1"' : ''}>
            <option value="">— Chưa chọn —</option>
          </select>`;
        default:
          return `<input type="text" ${attrs} value="${U.attr(val || '')}"/>`;
      }
    }

    container.innerHTML = order.map((g) => `
      <fieldset>
        <legend>${U.esc(g)}</legend>
        <div class="form-grid">
          ${groups[g].map((it) => {
            const f = it.field;
            const span = ['text', 'tags', 'image'].includes(f.type) ? 'span-2' : '';
            const ro = f.readonly || f.computed ? 'disabled' : '';
            return `<div class="field ${span}" data-wrap="${U.attr(it.name)}" ${f.showIf ? `data-show-if="${U.attr(f.showIf)}"` : ''}>
              <label>${U.esc(f.label)} ${f.required ? '<span class="req">*</span>' : ''}</label>
              ${inputHTML(it.name, f)}
              <div class="err-msg hidden" data-err="${U.attr(it.name)}"></div>
              ${f.hint ? `<div class="hint">${U.esc(f.hint)}</div>` : ''}
            </div>`;
          }).join('')}
        </div>
      </fieldset>`).join('');

    // Nạp danh mục tra cứu
    const refFields = Object.keys(entity.fields).filter((f) => entity.fields[f].type === 'ref');
    (async () => {
      for (const fname of refFields) {
        const f = entity.fields[fname];
        if (o.skipFields && o.skipFields.includes(fname)) continue;
        const sel = container.querySelector(`select[data-field="${fname}"]`);
        if (!sel) continue;
        let items = refs[f.ref];
        if (!items) {
          try {
            const res = await API.get('/api/lookups/' + f.ref);
            items = refs[f.ref] = res.data || [];
          } catch (e) { items = refs[f.ref] = []; }
        }
        items.forEach((it) => {
          const opt = document.createElement('option');
          opt.value = it.id;
          opt.textContent = (it.code ? it.code + ' — ' : '') + it.label;
          if (String(data[fname]) === String(it.id)) opt.selected = true;
          sel.appendChild(opt);
        });
        // Cập nhật tự động các trường theo danh mục
        if (o.autoFillRefs !== false) {
          sel.addEventListener('change', () => {
            const it = items.find((x) => String(x.id) === String(sel.value));
            if (!it) return;
            if (f.ref === 'categories' && it.extra) {
              const set = (n, v) => { const el = container.querySelector(`[data-field="${n}"]`); if (el && !el.value) el.value = v; };
              set('usefulLife', it.extra.usefulLife);
              set('depreciationRate', it.extra.rate);
              set('type', it.extra.type);
            }
            if (f.ref === 'users' && it.extra) {
              const dept = container.querySelector('[data-field="departmentId"]');
              if (dept && !dept.value) dept.value = it.extra.departmentId || '';
            }
          });
        }
      }
      applyShowIf();
    })();

    function applyShowIf() {
      container.querySelectorAll('[data-show-if]').forEach((wrap) => {
        const dep = wrap.dataset.showIf;
        const src = container.querySelector(`[data-field="${dep}"]`);
        const on = src && (src.type === 'checkbox' ? src.checked : !!src.value);
        wrap.classList.toggle('hidden', !on);
      });
    }
    container.addEventListener('change', (e) => { if (e.target.matches('.fld')) applyShowIf(); });

    function collect() {
      const out = {};
      container.querySelectorAll('[data-field]:not([disabled])').forEach((el) => {
        const name = el.dataset.field;
        const f = entity.fields[name];
        if (el.type === 'checkbox') out[name] = el.checked;
        else if (el.value === '') out[name] = ['number', 'money', 'percent'].includes(f.type) ? 0 : '';
        else if (f.type === 'tags') out[name] = el.value.split(',').map((s) => s.trim()).filter(Boolean);
        else if (['number', 'money', 'percent'].includes(f.type)) out[name] = Number(el.value);
        else out[name] = el.value;
      });
      return out;
    }

    function validate() {
      const errors = {};
      container.querySelectorAll('[data-field]').forEach((el) => {
        const name = el.dataset.field;
        const f = entity.fields[name];
        const wrap = container.querySelector(`[data-wrap="${name}"]`);
        if (wrap && wrap.classList.contains('hidden')) return;
        el.classList.remove('invalid');
        const errEl = container.querySelector(`[data-err="${name}"]`);
        if (errEl) { errEl.classList.add('hidden'); errEl.textContent = ''; }
        if (f.required && (el.type === 'checkbox' ? false : !el.value)) {
          errors[name] = f.label + ' là bắt buộc';
        }
      });
      return errors;
    }

    function setErrors(errs) {
      Object.keys(errs).forEach((name) => {
        const el = container.querySelector(`[data-field="${name}"]`);
        const errEl = container.querySelector(`[data-err="${name}"]`);
        if (el) el.classList.add('invalid');
        if (errEl) { errEl.textContent = errs[name]; errEl.classList.remove('hidden'); }
      });
      if (Object.keys(errs).length) UI.toast('Dữ liệu chưa hợp lệ', Object.values(errs)[0], 'warning');
    }

    return { collect, validate, setErrors, el: container, applyShowIf };
  };

  /** Hộp thoại thêm/sửa bản ghi dùng metadata */
  UI.recordDialog = function (entityName, record, opts) {
    const o = opts || {};
    const entity = App.state.entities[entityName];
    const isNew = !record || !record.id;
    const wrap = document.createElement('div');
    const m = UI.modal({
      size: o.size || 'lg',
      title: (isNew ? 'Thêm mới ' : 'Cập nhật ') + entity.singular.toLowerCase(),
      subtitle: isNew ? 'Điền thông tin bên dưới, các trường có dấu * là bắt buộc' : `Mã: ${U.esc(record[entity.codeField] || record.id)}`,
      body: wrap,
      footer: [
        { label: 'Huỷ', onClick: (mm) => mm.close() },
        {
          label: isNew ? '💾 Tạo mới' : '💾 Lưu thay đổi', cls: 'primary',
          onClick: async (mm) => {
            const errs = form.validate();
            if (Object.keys(errs).length) return form.setErrors(errs);
            const payload = form.collect();
            UI.loading(true, 'Đang lưu…');
            try {
              const res = isNew ? await API.post(`/api/entities/${entityName}`, payload) : await API.put(`/api/entities/${entityName}/${record.id}`, payload);
              UI.loading(false);
              UI.toast(isNew ? 'Đã tạo mới thành công' : 'Đã cập nhật thành công', `${entity.singular}: ${res.data[entity.codeField] || res.data.id}`, 'success');
              mm.close();
              if (o.onSaved) o.onSaved(res.data, isNew);
              else UI.bus && null;
            } catch (e) {
              UI.loading(false);
              if (e.payload && e.payload.errors) form.setErrors(e.payload.errors);
              else UI.toast('Không lưu được', e.message, 'error');
            }
          },
        },
      ],
    });
    const form = UI.entityForm(wrap, entityName, record, o);
  };

  /** Menu hành động nhanh trên bản ghi */
  UI.rowMenu = function (anchor, items) {
    const menu = document.getElementById('context-menu');
    menu.innerHTML = items.filter(Boolean).map((it, i) => it === '-' ? '<div class="sep"></div>' : `<div data-i="${i}">${it.icon ? it.icon + ' ' : ''}${U.esc(it.label)}</div>`).join('');
    const rect = anchor.getBoundingClientRect();
    menu.style.top = rect.bottom + 4 + 'px';
    menu.style.left = Math.min(rect.left, window.innerWidth - 230) + 'px';
    menu.classList.remove('hidden');
    menu.querySelectorAll('[data-i]').forEach((el) => {
      el.onclick = () => { menu.classList.add('hidden'); items[Number(el.dataset.i)].onClick(); };
    });
    setTimeout(() => document.addEventListener('mousedown', hideOnce), 10);
    function hideOnce(e) { if (!menu.contains(e.target)) { menu.classList.add('hidden'); document.removeEventListener('mousedown', hideOnce); } }
  };

  /* ============================== Tabs ============================== */
  UI.tabs = function (container, tabs, activeKey) {
    const key = activeKey || (tabs[0] && tabs[0].key);
    container.innerHTML = `
      <div class="tabs">${tabs.map((t) => `<button class="tab ${t.key === key ? 'active' : ''}" data-tab="${U.attr(t.key)}">${U.esc(t.label)}${t.badge !== undefined ? ` <span class="badge soft">${t.badge}</span>` : ''}</button>`).join('')}</div>
      <div class="tab-panels"></div>`;
    const panels = container.querySelector('.tab-panels');
    function show(k) {
      container.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === k));
      const t = tabs.find((x) => x.key === k);
      panels.innerHTML = '';
      if (t && t.render) t.render(panels);
    }
    container.querySelectorAll('.tab').forEach((b) => (b.onclick = () => show(b.dataset.tab)));
    show(key);
    return { show };
  };

  /* ============================== Thẻ KPI ============================== */
  UI.kpi = function (opts) {
    const o = opts || {};
    const value = typeof o.value === 'function' ? o.value() : o.value;
    return `<div class="card kpi ${o.color || 'blue'}">
      <div class="kicon">${o.icon || '📊'}</div>
      <div class="label">${U.esc(o.label)}</div>
      <div class="value">${value}${o.suffix ? ` <small>${U.esc(o.suffix)}</small>` : ''}</div>
      ${o.trend ? `<div class="trend">${o.trend}</div>` : ''}
    </div>`;
  };

  /* ============================== Trạng thái rỗng ============================== */
  UI.emptyState = function (icon, title, desc, actionHTML) {
    return `<div class="empty"><div class="icon">${icon || '📭'}</div><h3 style="margin:8px 0 4px">${U.esc(title || 'Chưa có dữ liệu')}</h3><p class="muted">${U.esc(desc || '')}</p>${actionHTML || ''}</div>`;
  };
})();
