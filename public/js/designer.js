/* ==========================================================================
   designer.js — TRÌNH THIẾT KẾ BÁO CÁO (Report Designer)
   Kiểu Crystal Reports: band, kéo thả trường dữ liệu, công thức tổng hợp,
   nhóm - sắp xếp - lọc - tham số, xem trước và in ấn.
   ========================================================================== */
(function () {
  'use strict';
  const U = App.U;
  const API = App.api;
  const MM = 3.7795275591; // mm -> px

  const PAPER = { A4: [210, 297], A5: [148, 210], A3: [297, 420], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };
  const BANDS = [
    { key: 'reportTitle', label: 'Tiêu đề báo cáo', color: '#dbeafe' },
    { key: 'pageHeader', label: 'Đầu trang', color: '#e0e7ff' },
    { key: 'columnHeader', label: 'Tiêu đề cột', color: '#ede9fe' },
    { key: 'groupHeader', label: 'Đầu nhóm', color: '#fef3c7', groupOnly: true },
    { key: 'detail', label: 'Chi tiết', color: '#dcfce7' },
    { key: 'groupFooter', label: 'Tổng nhóm', color: '#fef9c3', groupOnly: true },
    { key: 'pageFooter', label: 'Chân trang', color: '#ffe4e6' },
    { key: 'reportFooter', label: 'Tổng kết cuối', color: '#f1f5f9' },
  ];
  const FORMATS = [
    { value: 'text', label: 'Văn bản' }, { value: 'number', label: 'Số' },
    { value: 'money', label: 'Tiền tệ (VNĐ)' }, { value: 'percent', label: 'Phần trăm' },
    { value: 'date', label: 'Ngày (dd/mm/yyyy)' }, { value: 'datetime', label: 'Ngày giờ' }, { value: 'bool', label: 'Có/Không' },
  ];
  const AGG_FUNCS = ['SUM', 'COUNT', 'AVG', 'MIN', 'MAX', 'COUNT_DISTINCT', 'FIRST', 'LAST', 'CONCAT'];

  const D = {
    template: null,
    design: null,
    fields: [],
    dataset: null,
    selection: [],
    clipboard: [],
    undoStack: [],
    redoStack: [],
    zoom: 1,
    grid: 8,
    showGrid: true,
    ghost: true,
    snap: true,
    dirty: false,
    container: null,
    dragState: null,
  };
  window.Designer = D;

  /* ------------------------------------------------------------------ */
  /* Khởi động                                                           */
  /* ------------------------------------------------------------------ */

  D.open = async function (templateId, container) {
    D.container = container;
    container.innerHTML = '<div class="page-loading"><div class="spinner"></div> Đang tải thiết kế…</div>';
    const [tplRes, dsRes] = await Promise.all([
      API.get('/api/entities/report_templates/' + templateId),
      API.get('/api/reports/datasets'),
    ]);
    D.template = tplRes.data;
    D.design = D.template.design || (await API.get('/api/reports/blank-design')).data;
    D.design.bands = D.design.bands || {};
    BANDS.forEach((b) => {
      if (!D.design.bands[b.key]) D.design.bands[b.key] = { height: b.key === 'detail' ? 7 : 10, elements: [] };
    });
    D.design.groups = D.design.groups || [];
    D.design.sorting = D.design.sorting || [];
    D.design.filters = D.design.filters || [];
    D.design.parameters = D.design.parameters || [];
    D.design.margins = D.design.margins || { top: 12, right: 12, bottom: 12, left: 12 };
    D.design.options = D.design.options || {};
    const datasets = dsRes.data || [];
    try {
      const sampleRes = await API.get('/api/reports/datasets/' + (D.template.dataset || 'assets') + '/data?limit=12');
      D.sampleRows = sampleRes.data || [];
    } catch (e) { D.sampleRows = []; }
    D.datasets = datasets;
    D.dataset = datasets.find((x) => x.key === D.template.dataset) || datasets[0];
    D.fields = D.dataset ? D.dataset.fields : [];
    D.selection = [];
    D.undoStack = [];
    D.redoStack = [];
    D.dirty = false;
    render();
    bindKeys();
    UI.toast('Trình thiết kế báo cáo', 'Kéo trường dữ liệu từ cột trái vào vùng thiết kế', 'info');
  };

  function pushUndo() {
    D.undoStack.push(JSON.stringify(D.design));
    if (D.undoStack.length > 60) D.undoStack.shift();
    D.redoStack = [];
    D.dirty = true;
  }
  function undo() {
    if (!D.undoStack.length) return UI.toast('Không còn thao tác để hoàn tác', '', 'warning');
    D.redoStack.push(JSON.stringify(D.design));
    D.design = JSON.parse(D.undoStack.pop());
    D.selection = [];
    render();
  }
  function redo() {
    if (!D.redoStack.length) return UI.toast('Không còn thao tác để làm lại', '', 'warning');
    D.undoStack.push(JSON.stringify(D.design));
    D.design = JSON.parse(D.redoStack.pop());
    D.selection = [];
    render();
  }
  D.undo = undo; D.redo = redo;

  /* ------------------------------------------------------------------ */
  /* Giao diện                                                           */
  /* ------------------------------------------------------------------ */

  function render() {
    const paper = PAPER[D.design.paperSize] || PAPER.A4;
    const landscape = D.design.orientation === 'landscape';
    D.container.innerHTML = `
      <div class="page-head" style="margin-bottom:10px">
        <div>
          <h1>🎨 ${U.esc(D.template.name)} <span class="badge soft mono">${U.esc(D.template.code || '')}</span> ${D.dirty ? '<span class="badge" style="background:#fef3c7;color:#92400e">chưa lưu</span>' : ''}</h1>
          <div class="sub">Nguồn dữ liệu: <b>${U.esc(D.dataset ? D.dataset.label : '')}</b> • ${D.fields.length} trường khả dụng</div>
        </div>
        <div class="actions">
          <button class="btn ghost" id="dz-back">← Danh sách mẫu</button>
          <button class="btn" id="dz-save-as">⧉ Lưu thành mẫu mới</button>
          <button class="btn primary" id="dz-save">💾 Lưu mẫu (Ctrl+S)</button>
        </div>
      </div>
      <div class="designer">
        <aside class="dz-panel">
          <div class="dz-tabs">
            <button class="active" data-ltab="tools">Công cụ</button>
            <button data-ltab="fields">Trường dữ liệu</button>
            <button data-ltab="formula">Công thức</button>
          </div>
          <div class="dz-panel-body" id="dz-left"></div>
        </aside>

        <section class="dz-center">
          <div class="dz-toolbar">
            <button class="tb" id="tb-undo" title="Hoàn tác (Ctrl+Z)">↶</button>
            <button class="tb" id="tb-redo" title="Làm lại (Ctrl+Y)">↷</button>
            <span class="div"></span>
            <button class="tb" data-align="left" title="Căn trái">⬅</button>
            <button class="tb" data-align="center" title="Căn giữa ngang">↔</button>
            <button class="tb" data-align="right" title="Căn phải">➡</button>
            <button class="tb" data-align="top" title="Căn trên">⬆</button>
            <button class="tb" data-align="middle" title="Căn giữa dọc">↕</button>
            <button class="tb" data-align="bottom" title="Căn dưới">⬇</button>
            <span class="div"></span>
            <button class="tb" data-align="dist-h" title="Phân bố đều ngang">⇹</button>
            <button class="tb" data-align="dist-v" title="Phân bố đều dọc">⇳</button>
            <button class="tb" data-align="same-w" title="Cùng chiều rộng">⇔</button>
            <button class="tb" data-align="same-h" title="Cùng chiều cao">⇕</button>
            <span class="div"></span>
            <button class="tb" id="tb-front" title="Đưa lên trên">⬆︎L</button>
            <button class="tb" id="tb-back" title="Đưa xuống dưới">⬇︎L</button>
            <button class="tb" id="tb-dup" title="Nhân bản (Ctrl+D)">⧉</button>
            <button class="tb" id="tb-del" title="Xoá (Delete)">🗑</button>
            <span class="div"></span>
            <button class="tb" id="tb-grid" title="Hiện/ẩn lưới">▦</button>
            <button class="tb" id="tb-snap" title="Bám lưới">🧲</button>
            <button class="tb" id="tb-ghost" title="Hiện dữ liệu mẫu (ghost preview)">👻</button>
            <button class="tb" id="tb-zoom-out" title="Thu nhỏ">➖</button>
            <span class="tiny mono" id="dz-zoom-label" style="min-width:44px;text-align:center">100%</span>
            <button class="tb" id="tb-zoom-in" title="Phóng to">➕</button>
            <span class="div"></span>
            <button class="btn sm" id="tb-preview">👁 Xem trước (F5)</button>
            <button class="btn sm" id="tb-print">🖨 In / PDF</button>
            <button class="btn sm" id="tb-docx">📝 Word</button>
            <button class="btn sm" id="tb-xlsx">📊 Excel</button>
          </div>
          <div class="dz-canvas-wrap" id="dz-canvas-wrap"></div>
          <div class="dz-statusbar">
            <span id="dz-status-sel">Chưa chọn đối tượng</span>
            <span id="dz-status-paper">${D.design.paperSize} ${landscape ? 'ngang' : 'dọc'} • ${(landscape ? paper[1] : paper[0]).toFixed(0)}×${(landscape ? paper[0] : paper[1]).toFixed(0)} mm</span>
            <span>Lưới ${D.grid}px • Đơn vị: mm</span>
            <span style="margin-left:auto" class="hint-keys">Phím tắt: <kbd>Ctrl</kbd>+<kbd>Z</kbd> hoàn tác • <kbd>Ctrl</kbd>+<kbd>D</kbd> nhân bản • <kbd>Del</kbd> xoá • phím mũi tên di chuyển</span>
          </div>
        </section>

        <aside class="dz-panel right">
          <div class="dz-tabs">
            <button class="active" data-rtab="props">Thuộc tính</button>
            <button data-rtab="data">Dữ liệu</button>
            <button data-rtab="page">Trang</button>
            <button data-rtab="rules">Quy tắc</button>
          </div>
          <div class="dz-panel-body dz-props" id="dz-right"></div>
        </aside>
      </div>`;

    renderCanvas();
    renderLeft('tools');
    renderRight('props');

    // Sự kiện toolbar
    const $ = (s) => D.container.querySelector(s);
    $('#dz-back').onclick = () => { if (!D.dirty || confirm('Thiết kế chưa lưu, bạn có chắc muốn rời đi?')) App.Router.navigate('/reports'); };
    $('#dz-save').onclick = () => save();
    $('#dz-save-as').onclick = () => saveAs();
    $('#tb-undo').onclick = undo;
    $('#tb-redo').onclick = redo;
    $('#tb-dup').onclick = () => duplicateSelection();
    $('#tb-del').onclick = () => deleteSelection();
    $('#tb-front').onclick = () => reorder(1);
    $('#tb-back').onclick = () => reorder(-1);
    $('#tb-grid').onclick = () => { D.showGrid = !D.showGrid; renderCanvas(); $('#tb-grid').classList.toggle('active', D.showGrid); };
    const ghostBtn = $('#tb-ghost');
    if (ghostBtn) ghostBtn.onclick = () => { D.ghost = !D.ghost; renderCanvas(); ghostBtn.classList.toggle('active', D.ghost); };
    $('#tb-snap').onclick = () => { D.snap = !D.snap; $('#tb-snap').classList.toggle('active', D.snap); };
    $('#tb-zoom-in').onclick = () => { D.zoom = Math.min(2, D.zoom + 0.1); renderCanvas(); };
    $('#tb-zoom-out').onclick = () => { D.zoom = Math.max(0.4, D.zoom - 0.1); renderCanvas(); };
    $('#tb-preview').onclick = () => preview();
    $('#tb-print').onclick = () => exportAs('html');
    $('#tb-docx').onclick = () => exportAs('docx');
    $('#tb-xlsx').onclick = () => exportAs('xlsx');
    $('#tb-front').classList.toggle('active', false);
    if (D.showGrid) $('#tb-grid').classList.add('active');
    if (D.ghost && $('#tb-ghost')) $('#tb-ghost').classList.add('active');
    if (D.snap) $('#tb-snap').classList.add('active');
    D.container.querySelectorAll('[data-align]').forEach((b) => (b.onclick = () => align(b.dataset.align)));
    D.container.querySelectorAll('[data-ltab]').forEach((b) => (b.onclick = () => { switchTab('left', b); renderLeft(b.dataset.ltab); }));
    D.container.querySelectorAll('[data-rtab]').forEach((b) => (b.onclick = () => { switchTab('right', b); renderRight(b.dataset.rtab); }));
    updateStatus();
  }

  function switchTab(side, btn) {
    D.container.querySelectorAll(`[data-${side === 'left' ? 'ltab' : 'rtab'}]`).forEach((b) => b.classList.toggle('active', b === btn));
  }

  /* --------------------------- Cột trái --------------------------- */

  function renderLeft(tab) {
    const host = D.container.querySelector('#dz-left');
    if (tab === 'tools') {
      const tools = [
        { type: 'text', label: 'Văn bản tĩnh', icon: '🔤' },
        { type: 'field', label: 'Trường dữ liệu', icon: '🔗' },
        { type: 'expr', label: 'Công thức / Tổng hợp', icon: '🧮' },
        { type: 'pageInfo', label: 'Trang X / Y', icon: '📄' },
        { type: 'dateTime', label: 'Ngày giờ in', icon: '🕐' },
        { type: 'systemInfo', label: 'Thông tin hệ thống', icon: 'ℹ️' },
        { type: 'line', label: 'Đường kẻ', icon: '➖' },
        { type: 'rect', label: 'Hình chữ nhật', icon: '⬛' },
        { type: 'image', label: 'Hình ảnh / Logo', icon: '🖼' },
        { type: 'barcode', label: 'Mã vạch Code128', icon: '▮▯' },
        { type: 'qrcode', label: 'Mã QR', icon: '⬜' },
        { type: 'richText', label: 'Khối văn bản dài', icon: '📝' },
      ];
      host.innerHTML = `
        <div class="dz-group">Đối tượng thiết kế</div>
        ${tools.map((t) => `<div class="dz-tool" draggable="true" data-newtype="${t.type}"><span>${t.icon}</span><span>${t.label}</span></div>`).join('')}
        <div class="dz-group">Thao tác nhanh</div>
        <button class="btn sm block mb" id="dp-template-dept">📋 Tạo bảng theo phòng ban</button>
        <button class="btn sm block mb" id="dp-template-list">📋 Tạo bảng danh sách đơn giản</button>
        <button class="btn sm block mb" id="dp-template-summary">📋 Tạo bảng tổng hợp có nhóm</button>
        <div class="dz-group">Bố cục band</div>
        <div class="tiny muted">Kéo đối tượng vào band tương ứng ở trang thiết kế. Nhấp đúp vào đối tượng để sửa nhanh nội dung.</div>`;
      host.querySelectorAll('[data-newtype]').forEach((el) => {
        el.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('application/x-ams-new', el.dataset.newtype);
          e.dataTransfer.effectAllowed = 'copy';
        });
        el.addEventListener('click', () => {
          addElement(el.dataset.newtype, { x: 10, y: 1, w: 60, h: 7 }, currentBand());
        });
      });
      host.querySelector('#dp-template-list').onclick = () => quickTable('list');
      host.querySelector('#dp-template-dept').onclick = () => quickTable('group');
      host.querySelector('#dp-template-summary').onclick = () => quickTable('summary');
    }
    if (tab === 'fields') {
      const groups = {};
      D.fields.forEach((f) => {
        const g = f.group || 'Thông tin chung';
        groups[g] = groups[g] || [];
        groups[g].push(f);
      });
      host.innerHTML = `
        <input type="search" id="dz-field-search" placeholder="🔍 Tìm trường dữ liệu…" class="mb"/>
        <div class="tiny muted mb">Kéo trường vào vùng thiết kế hoặc bấm để thêm vào band đang chọn.</div>
        <div id="dz-field-list">
        ${Object.keys(groups)
          .map((g) => `<div class="dz-group">${U.esc(g)}</div>${groups[g]
            .map((f) => `<div class="dz-field" draggable="true" data-field="${U.attr(f.key)}" title="Kiểu: ${U.attr(f.type)}"><span>🔹</span><span>${U.esc(f.label)}</span><span class="ft">${U.esc(shortType(f.type))}</span></div>`)
            .join('')}`)
          .join('')}
        </div>`;
      host.querySelectorAll('.dz-field').forEach((el) => {
        el.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('application/x-ams-field', el.dataset.field);
          e.dataTransfer.effectAllowed = 'copy';
        });
        el.addEventListener('click', () => {
          const f = D.fields.find((x) => x.key === el.dataset.field);
          if (!f) return;
          const band = currentBand();
          const isHeader = band === 'columnHeader';
          addElement('field', {
            x: autoX(band), y: 0.5, w: 40, h: band === 'columnHeader' ? 8 : 6.5,
            field: f.key, label: f.label, align: f.type === 'money' || f.type === 'number' ? 'right' : 'left',
            format: f.type === 'money' ? 'money' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text',
          }, band);
        });
      });
      host.querySelector('#dz-field-search').oninput = (e) => {
        const q = U.norm(e.target.value);
        host.querySelectorAll('.dz-field').forEach((el) => {
          el.style.display = U.norm(el.textContent).includes(q) ? '' : 'none';
        });
      };
    }
    if (tab === 'formula') {
      host.innerHTML = `
        <div class="dz-group">Hàm tổng hợp</div>
        <div class="tiny muted mb">Dùng trong đối tượng "Công thức / Tổng hợp":</div>
        ${AGG_FUNCS.map((fn) => `<div class="exp-item mb" style="cursor:pointer" data-fn="${fn}">
          <b class="mono">{${fn}(field)}</b>
          <div class="tiny muted">${fnDesc(fn)}</div>
        </div>`).join('')}
        <div class="dz-group">Tham số hệ thống</div>
        <div class="tiny">
          <div class="mb"><code class="mono">{company.name}</code> — Tên công ty</div>
          <div class="mb"><code class="mono">{company.address}</code> — Địa chỉ</div>
          <div class="mb"><code class="mono">{date}</code> / <code class="mono">{time}</code> — Ngày/giờ in</div>
          <div class="mb"><code class="mono">{user.fullName}</code> — Người in</div>
          <div class="mb"><code class="mono">{params.ten}</code> — Tham số người dùng nhập</div>
          <div class="mb"><code class="mono">{groupValue}</code> — Giá trị nhóm hiện tại</div>
          <div class="mb"><code class="mono">{footer}</code> — Dòng chân trang hệ thống</div>
          <div class="mb"><code class="mono">{rowIndex}</code> — Số thứ tự dòng</div>
        </div>
        <div class="dz-group">Phạm vi tổng hợp</div>
        <div class="tiny muted">Thêm tham số thứ 2: <code class="mono">group</code> = tổng theo nhóm, <code class="mono">page</code> = tổng theo trang, mặc định = toàn báo cáo.<br/>Ví dụ: <code class="mono">{SUM(originalCost,group)}</code></div>`;
      host.querySelectorAll('[data-fn]').forEach((el) => (el.onclick = () => {
        const snippet = `{${el.dataset.fn}(` + (D.fields[0] ? D.fields[0].key : '') + ')}';
        navigator.clipboard && navigator.clipboard.writeText(snippet);
        UI.toast('Đã sao chép công thức', snippet, 'success');
      }));
    }
  }

  function shortType(t) {
    return { money: '₫', number: '#', date: '📅', datetime: '🕐', bool: '✓', select: '▾', text: '¶' }[t] || 'A';
  }
  function fnDesc(fn) {
    return {
      SUM: 'Tổng giá trị số của một trường', COUNT: 'Đếm số dòng', AVG: 'Giá trị trung bình',
      MIN: 'Giá trị nhỏ nhất', MAX: 'Giá trị lớn nhất', COUNT_DISTINCT: 'Đếm giá trị khác nhau',
      FIRST: 'Giá trị dòng đầu tiên', LAST: 'Giá trị dòng cuối cùng', CONCAT: 'Nối chuỗi các dòng',
    }[fn] || '';
  }

  /* --------------------------- Vùng thiết kế --------------------------- */

  function renderCanvas() {
    const wrap = D.container.querySelector('#dz-canvas-wrap');
    const paper = PAPER[D.design.paperSize] || PAPER.A4;
    const landscape = D.design.orientation === 'landscape';
    const pw = (landscape ? paper[1] : paper[0]);
    const ph = (landscape ? paper[0] : paper[1]);
    const m = D.design.margins;
    const contentW = pw - m.left - m.right;
    const hasGroup = (D.design.groups || []).length > 0;

    const bandsHtml = BANDS.filter((b) => !b.groupOnly || hasGroup)
      .map((b) => {
        const band = D.design.bands[b.key] || { height: 8, elements: [] };
        const h = Number(band.height || 8);
        return `<div class="dz-band" data-band="${b.key}" style="top:${bandTop(b.key, hasGroup, m.top)}mm;height:${h}mm;background:${D.showGrid ? hexA(b.color, .35) : 'transparent'};border-bottom:1px dashed #94a3b8">
          <span class="dz-band-label" style="background:${b.color}">${b.label} (${h}mm)</span>
          ${(band.elements || []).map((e) => elementHTML(e, b.key)).join('')}
        </div>`;
      })
      .join('');

    wrap.innerHTML = `
      <div class="dz-paper" id="dz-paper" style="width:${pw}mm;height:${ph}mm;transform:scale(${D.zoom});transform-origin:top left;${D.showGrid ? `background-image:linear-gradient(to right, #eef2f7 1px, transparent 1px), linear-gradient(to bottom, #eef2f7 1px, transparent 1px);background-size:${D.grid}px ${D.grid}px;` : ''}">
        <div style="position:absolute;left:0;top:0;right:0;height:${m.top}mm;background:rgba(148,163,184,.07);border-bottom:1px dashed #cbd5e1"></div>
        <div style="position:absolute;left:0;bottom:0;right:0;height:${m.bottom}mm;background:rgba(148,163,184,.07);border-top:1px dashed #cbd5e1"></div>
        <div style="position:absolute;left:0;top:${m.top}mm;bottom:${m.bottom}mm;width:${m.left}mm;background:rgba(148,163,184,.05)"></div>
        <div style="position:absolute;right:0;top:${m.top}mm;bottom:${m.bottom}mm;width:${m.right}mm;background:rgba(148,163,184,.05)"></div>
        <div style="position:absolute;left:${m.left}mm;width:${contentW}mm;top:0;height:100%">${bandsHtml}</div>
        ${renderGhostPreview(m, pw, ph)}
      </div>`;

    const paperEl = wrap.querySelector('#dz-paper');
    const zoomLabel = D.container.querySelector('#dz-zoom-label');
    if (zoomLabel) zoomLabel.textContent = Math.round(D.zoom * 100) + '%';

    // Kéo thả tạo đối tượng mới
    paperEl.querySelectorAll('.dz-band').forEach((bandEl) => {
      bandEl.addEventListener('dragover', (e) => { e.preventDefault(); bandEl.classList.add('over'); });
      bandEl.addEventListener('dragleave', () => bandEl.classList.remove('over'));
      bandEl.addEventListener('drop', (e) => {
        e.preventDefault();
        bandEl.classList.remove('over');
        const bandKey = bandEl.dataset.band;
        const rect = bandEl.getBoundingClientRect();
        const xmm = Math.max(0, (e.clientX - rect.left) / (MM * D.zoom));
        const ymm = Math.max(0, (e.clientY - rect.top) / (MM * D.zoom));
        const newType = e.dataTransfer.getData('application/x-ams-new');
        const fieldKey = e.dataTransfer.getData('application/x-ams-field');
        if (fieldKey) {
          const f = D.fields.find((x) => x.key === fieldKey);
          addElement('field', {
            x: snap(xmm), y: snap(ymm), w: Math.max(25, Math.min(70, f.label.length * 2.6)), h: bandKey === 'columnHeader' ? 8 : 6.5,
            field: f.key, label: f.label,
            align: f.type === 'money' || f.type === 'number' ? 'right' : 'left',
            format: f.type === 'money' ? 'money' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text',
          }, bandKey);
        } else if (newType) {
          addElement(newType, { x: snap(xmm), y: snap(ymm), w: newType === 'line' ? 60 : 45, h: newType === 'line' ? 0.6 : 7 }, bandKey);
        }
      });
      bandEl.addEventListener('mousedown', (e) => { if (e.target === bandEl) { D.selection = []; renderCanvas(); renderRight('props'); updateStatus(); } });
    });

    // Chọn / kéo / resize đối tượng
    paperEl.querySelectorAll('.dz-el').forEach((el) => {
      const id = el.dataset.id;
      el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const bandKey = el.closest('.dz-band').dataset.band;
        const handle = e.target.classList.contains('handle') ? e.target.classList[1] : null;
        if (!D.selection.includes(id)) {
          if (e.shiftKey) D.selection.push(id); else D.selection = [id];
        }
        renderCanvas();
        renderRight('props');
        startDrag(e, id, bandKey, handle);
      });
      el.addEventListener('dblclick', () => {
        const found = findEl(id);
        if (!found) return;
        const e2 = found.el;
        if (e2.type === 'field') { renderRight('props'); D.container.querySelector('#p-text') && D.container.querySelector('#p-text').focus(); return; }
        const val = prompt('Nhập nội dung:', e2.text || '');
        if (val !== null) { pushUndo(); e2.text = val; renderCanvas(); renderRight('props'); }
      });
      el.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        const found = findEl(id);
        UI.rowMenu(ev.target, [
          { label: 'Nhân bản', icon: '⧉', onClick: () => duplicateSelection() },
          { label: 'Xoá', icon: '🗑', onClick: () => deleteSelection() },
          '-',
          { label: 'Đưa lên trên', onClick: () => reorder(1) },
          { label: 'Đưa xuống dưới', onClick: () => reorder(-1) },
          '-',
          { label: 'Chuyển sang band khác…', onClick: () => moveToBand(found) },
        ]);
      });
    });
    renderDecorations();
    updateStatus();
  }

  /**
   * Ghost preview: vẽ lớp dữ liệu mẫu mờ phía sau thiết kế để hình dung
   * kết quả in (giống Crystal Reports). Bật/tắt bằng nút 👻 trên thanh công cụ.
   */
  function renderGhostPreview(m, pw, ph) {
    if (!D.ghost) return '';
    const w = pw - m.left - m.right;
    const h = ph - m.top - m.bottom;
    const sample = D.sampleRows || [];
    const label = D.dataset ? D.dataset.label + ' — ' + sample.length + ' dòng dữ liệu mẫu' : 'Chưa chọn nguồn dữ liệu';
    const rowHeight = 7;
    let rows = '';
    const maxRows = Math.min(sample.length, Math.floor(h / rowHeight));
    for (let i = 0; i < maxRows; i++) {
      const r = sample[i] || {};
      const cols = D.fields.slice(0, 6).map((f, ci) => {
        const v = r[f.key];
        const text = v === undefined || v === null || v === '' ? '' : (f.type === 'money' ? U.moneyShort(v) : String(v)).slice(0, 18);
        return `<span style="width:${(100 / Math.min(6, D.fields.length)).toFixed(2)}%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;display:inline-block">${U.esc(text)}</span>`;
      }).join('');
      rows += `<div class="dz-ghost-row" style="height:${rowHeight}mm">${cols}</div>`;
    }
    return `<div class="dz-ghost" style="left:${m.left}mm;top:${m.top}mm;width:${w}mm;height:${h}mm">
      <div class="dz-ghost-tag">👻 ${U.esc(label)}</div>
      ${rows}
    </div>`;
  }

  function hexA(hex, a) {
    const h = String(hex || '#ffffff').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function bandTop(key, hasGroup, marginTop) {
    let y = marginTop;
    for (const b of BANDS) {
      if (b.groupOnly && !hasGroup) continue;
      if (b.key === key) return y;
      y += Number((D.design.bands[b.key] || {}).height || 8);
    }
    return y;
  }

  function elementHTML(e, bandKey) {
    const selected = D.selection.includes(String(e.id));
    const style = [
      `left:${Number(e.x || 0)}mm`, `top:${Number(e.y || 0)}mm`, `width:${Math.max(0.5, Number(e.w || 10))}mm`,
      e.type === 'line' ? 'height:0px' : `height:${Math.max(0.5, Number(e.h || 6))}mm`,
      `font-size:${Number(e.fontSize || 10)}pt`, `font-family:${e.fontFamily || 'Inter, Arial, sans-serif'}`,
      `text-align:${e.align || 'left'}`, `align-items:${e.valign === 'top' ? 'flex-start' : e.valign === 'bottom' ? 'flex-end' : 'center'}`,
      `justify-content:${e.align === 'center' ? 'center' : e.align === 'right' ? 'flex-end' : 'flex-start'}`,
      e.bold ? 'font-weight:700' : '', e.italic ? 'font-style:italic' : '', e.underline ? 'text-decoration:underline' : '',
      `color:${e.color || '#111827'}`, e.bgColor ? `background:${e.bgColor}` : '',
      e.border ? `border:${Number(e.borderWidth || 1)}px ${e.borderStyle || 'solid'} ${e.borderColor || '#9ca3af'}` : '',
      e.type === 'line' ? `border-top:${Number(e.borderWidth || 1)}px ${e.borderStyle || 'solid'} ${e.borderColor || '#111827'}` : '',
      e.opacity !== undefined && Number(e.opacity) < 1 ? `opacity:${e.opacity}` : '',
      'display:flex', 'overflow:hidden', 'white-space:' + (e.wrap === false ? 'nowrap' : 'normal'), 'line-height:1.15',
    ].join(';');
    const preview = elementPreview(e);
    return `<div class="dz-el ${selected ? 'selected' : ''}" data-id="${U.attr(e.id)}" style="${style}">
      <span style="width:100%;overflow:hidden;${e.align === 'center' ? 'text-align:center' : e.align === 'right' ? 'text-align:right' : ''}">${preview}</span>
      ${selected ? ['se', 'e', 's', 'w', 'n', 'ne', 'nw', 'sw'].map((h) => `<span class="handle ${h}"></span>`).join('') : ''}
    </div>`;
  }

  function elementPreview(e) {
    switch (e.type) {
      case 'field': {
        const f = D.fields.find((x) => x.key === e.field);
        return `<b style="color:#1d4ed8">⟨${U.esc(f ? f.label : e.field || '?')}⟩</b>`;
      }
      case 'expr': return `<b style="color:#7c3aed">ƒ ${U.esc(e.expr || 'Công thức')}</b>`;
      case 'text': return U.esc((e.text || '').slice(0, 120));
      case 'line': return '';
      case 'rect': return '';
      case 'image': return '🖼';
      case 'pageInfo':
      case 'pageNumber': return `Trang ⟨số⟩`;
      case 'dateTime': return '⟨ngày in⟩';
      case 'systemInfo': return U.esc((e.text || '{footer}').slice(0, 40));
      case 'barcode': return '▮▮▯▮▯▮▮▯';
      case 'qrcode': return '▩';
      default: return U.esc(e.text || '');
    }
  }

  function renderDecorations() {
    // chỉ báo vùng an toàn khi zoom nhỏ
  }

  function findEl(id) {
    for (const key of Object.keys(D.design.bands)) {
      const band = D.design.bands[key];
      const el = (band.elements || []).find((x) => String(x.id) === String(id));
      if (el) return { el, band: key };
    }
    return null;
  }

  /* --------------------------- Kéo / resize --------------------------- */

  function startDrag(e, id, bandKey, handle) {
    const found = findEl(id);
    if (!found) return;
    const els = D.selection.map((sid) => findEl(sid)).filter(Boolean);
    D.dragState = {
      startX: e.clientX, startY: e.clientY, handle,
      items: els.map((f) => ({ el: f.el, band: f.band, x: Number(f.el.x), y: Number(f.el.y), w: Number(f.el.w), h: Number(f.el.h) })),
      pushed: false,
    };
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', endDrag);
  }

  function onDrag(e) {
    const ds = D.dragState;
    if (!ds) return;
    if (!ds.pushed) { pushUndo(); ds.pushed = true; }
    const dx = (e.clientX - ds.startX) / (MM * D.zoom);
    const dy = (e.clientY - ds.startY) / (MM * D.zoom);
    const shift = e.shiftKey;
    ds.items.forEach((it) => {
      let x = it.x, y = it.y, w = it.w, h = it.h;
      if (!ds.handle) {
        x = it.x + dx; y = it.y + dy;
        if (shift) { if (Math.abs(dx) > Math.abs(dy)) y = it.y; else x = it.x; }
        it.el.x = Math.max(0, snap(x));
        it.el.y = Math.max(0, snap(y));
      } else {
        if (ds.handle.includes('e')) w = it.w + dx;
        if (ds.handle.includes('w')) { w = it.w - dx; x = it.x + dx; }
        if (ds.handle.includes('s')) h = it.h + dy;
        if (ds.handle.includes('n')) { h = it.h - dy; y = it.y + dy; }
        it.el.w = Math.max(4, snap(w));
        it.el.h = Math.max(0.5, snap(h));
        if (ds.handle.includes('w')) it.el.x = Math.max(0, snap(x));
        if (ds.handle.includes('n')) it.el.y = Math.max(0, snap(y));
      }
    });
    const first = ds.items[0] && ds.items[0].el;
    const found = first && findEl(first.id);
    if (found) {
      const dom = D.container.querySelector(`.dz-el[data-id="${CSS.escape(String(first.id))}"]`);
      if (dom) {
        dom.style.left = first.x + 'mm';
        dom.style.top = first.y + 'mm';
        dom.style.width = first.w + 'mm';
        dom.style.height = first.h + 'mm';
      }
    }
    // di chuyển nhiều đối tượng
    ds.items.forEach((it) => {
      const dom = D.container.querySelector(`.dz-el[data-id="${CSS.escape(String(it.el.id))}"]`);
      if (dom) {
        dom.style.left = it.el.x + 'mm';
        dom.style.top = it.el.y + 'mm';
        dom.style.width = it.el.w + 'mm';
        dom.style.height = it.el.h + 'mm';
      }
    });
    updateStatus();
  }

  function endDrag() {
    if (D.dragState && D.dragState.pushed) {
      D.dirty = true;
      renderRight('props');
      D.container.querySelector('#dz-status-sel') && updateStatus();
    }
    D.dragState = null;
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', endDrag);
  }

  function snap(v) {
    if (!D.snap) return Math.round(v * 10) / 10;
    const g = 0.5; // 0.5mm
    return Math.round(v / g) * g;
  }

  /* --------------------------- Thao tác đối tượng --------------------------- */

  function currentBand() {
    if (D.selection.length) {
      const f = findEl(D.selection[0]);
      if (f) return f.band;
    }
    return 'detail';
  }

  function autoX(bandKey) {
    const band = D.design.bands[bandKey] || { elements: [] };
    const maxX = (band.elements || []).reduce((m, e) => Math.max(m, Number(e.x || 0) + Number(e.w || 0)), 0);
    return Math.min(150, Math.round(maxX + 2));
  }

  function addElement(type, props, bandKey) {
    pushUndo();
    const id = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const el = Object.assign({
      id, type, x: 5, y: 1, w: 40, h: 7, text: '', field: '', expr: '', prefix: '', suffix: '',
      align: 'left', valign: 'middle', fontSize: 10, fontFamily: 'Inter, Arial, sans-serif',
      bold: false, italic: false, underline: false, color: '#111827', bgColor: '',
      border: false, borderWidth: 1, borderStyle: 'solid', borderColor: '#9ca3af',
      format: 'text', decimals: 0, wrap: true, uppercase: false, letterSpacing: 0, opacity: 1, visible: true,
    }, props || {});
    if (type === 'text' && !el.text) el.text = 'Văn bản mới';
    if (type === 'expr' && !el.expr) el.expr = '{COUNT()}';
    if (type === 'columnHeader' || bandKey === 'columnHeader') el.border = true;
    D.design.bands[bandKey] = D.design.bands[bandKey] || { height: 8, elements: [] };
    D.design.bands[bandKey].elements = D.design.bands[bandKey].elements || [];
    D.design.bands[bandKey].elements.push(el);
    D.selection = [id];
    renderCanvas();
    renderRight('props');
  }

  function deleteSelection() {
    if (!D.selection.length) return;
    pushUndo();
    Object.keys(D.design.bands).forEach((k) => {
      const band = D.design.bands[k];
      band.elements = (band.elements || []).filter((e) => !D.selection.includes(String(e.id)));
    });
    D.selection = [];
    renderCanvas();
    renderRight('props');
  }

  function duplicateSelection() {
    if (!D.selection.length) return;
    pushUndo();
    const copies = [];
    D.selection.forEach((id) => {
      const f = findEl(id);
      if (!f) return;
      const copy = JSON.parse(JSON.stringify(f.el));
      copy.id = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      copy.x = Number(copy.x) + 3;
      copy.y = Number(copy.y) + 1;
      D.design.bands[f.band].elements.push(copy);
      copies.push(copy.id);
    });
    D.selection = copies;
    renderCanvas();
    renderRight('props');
  }

  function reorder(dir) {
    if (!D.selection.length) return;
    pushUndo();
    D.selection.forEach((id) => {
      const f = findEl(id);
      if (!f) return;
      const arr = D.design.bands[f.band].elements;
      const i = arr.findIndex((x) => String(x.id) === String(id));
      arr.splice(i, 1);
      if (dir > 0) arr.push(f.el); else arr.unshift(f.el);
    });
    renderCanvas();
  }

  function align(mode) {
    if (D.selection.length < 1) return UI.toast('Chưa chọn đối tượng', 'Hãy chọn ít nhất một đối tượng', 'warning');
    pushUndo();
    const items = D.selection.map((id) => findEl(id)).filter(Boolean);
    const els = items.map((x) => x.el);
    const minX = Math.min.apply(null, els.map((e) => Number(e.x)));
    const maxX = Math.max.apply(null, els.map((e) => Number(e.x) + Number(e.w)));
    const minY = Math.min.apply(null, els.map((e) => Number(e.y)));
    const maxY = Math.max.apply(null, els.map((e) => Number(e.y) + Number(e.h)));
    els.forEach((e) => {
      switch (mode) {
        case 'left': e.x = snap(minX); break;
        case 'right': e.x = snap(maxX - Number(e.w)); break;
        case 'center': e.x = snap((minX + maxX) / 2 - Number(e.w) / 2); break;
        case 'top': e.y = snap(minY); break;
        case 'bottom': e.y = snap(maxY - Number(e.h)); break;
        case 'middle': e.y = snap((minY + maxY) / 2 - Number(e.h) / 2); break;
        case 'same-w': e.w = snap(els[0].w); break;
        case 'same-h': e.h = snap(els[0].h); break;
        case 'dist-h': {
          const sorted = els.slice().sort((a, b) => a.x - b.x);
          const totalW = sorted.reduce((s, x) => s + Number(x.w), 0);
          const gap = (maxX - minX - totalW) / Math.max(1, sorted.length - 1);
          let cx = minX;
          sorted.forEach((x) => { x.x = snap(cx); cx += Number(x.w) + gap; });
          break;
        }
        case 'dist-v': {
          const sorted = els.slice().sort((a, b) => a.y - b.y);
          const totalH = sorted.reduce((s, x) => s + Number(x.h), 0);
          const gap = (maxY - minY - totalH) / Math.max(1, sorted.length - 1);
          let cy = minY;
          sorted.forEach((x) => { x.y = snap(cy); cy += Number(x.h) + gap; });
          break;
        }
      }
    });
    renderCanvas();
    renderRight('props');
  }

  function moveToBand(found) {
    const m = UI.modal({
      size: 'sm', title: 'Chuyển đối tượng sang band khác',
      body: `<div class="field"><label>Band đích</label><select id="mb">${BANDS.map((b) => `<option value="${b.key}" ${b.key === found.band ? 'selected' : ''}>${b.label}</option>`).join('')}</select></div>`,
      footer: [
        { label: 'Huỷ', onClick: (mm) => mm.close() },
        { label: 'Chuyển', cls: 'primary', onClick: (mm) => {
          const target = mm.body.querySelector('#mb').value;
          pushUndo();
          D.design.bands[found.band].elements = D.design.bands[found.band].elements.filter((x) => String(x.id) !== String(found.el.id));
          D.design.bands[target].elements = D.design.bands[target].elements || [];
          D.design.bands[target].elements.push(found.el);
          found.el.y = 0.5;
          mm.close();
          renderCanvas();
        } },
      ],
    });
  }

  /* --------------------------- Cột phải --------------------------- */

  function renderRight(tab) {
    const host = D.container.querySelector('#dz-right');
    if (tab === 'props') return renderProps(host);
    if (tab === 'data') return renderDataTab(host);
    if (tab === 'page') return renderPageTab(host);
    if (tab === 'rules') return renderRulesTab(host);
  }

  function renderProps(host) {
    if (!D.selection.length) {
      host.innerHTML = `<div class="alert info">Chọn một đối tượng trên trang thiết kế để xem và chỉnh sửa thuộc tính.</div>
        <div class="dz-group">Thuộc tính band đang chọn</div>
        <div class="field"><label>Band</label><select id="pb-band">${BANDS.map((b) => `<option value="${b.key}">${b.label}</option>`).join('')}</select></div>
        <div class="field"><label>Chiều cao band (mm)</label><input type="number" id="pb-height" step="0.5" value="8"/></div>`;
      const sel = host.querySelector('#pb-band');
      sel.onchange = () => {
        const h = Number((D.design.bands[sel.value] || {}).height || 8);
        host.querySelector('#pb-height').value = h;
      };
      host.querySelector('#pb-height').onchange = (e) => {
        pushUndo();
        D.design.bands[sel.value] = D.design.bands[sel.value] || { elements: [] };
        D.design.bands[sel.value].height = Number(e.target.value) || 8;
        renderCanvas();
      };
      return;
    }
    const id = D.selection[0];
    const found = findEl(id);
    if (!found) return;
    const e = found.el;
    const multi = D.selection.length > 1;
    host.innerHTML = `
      <div class="row between mb">
        <b style="font-size:12.5px">${multi ? D.selection.length + ' đối tượng được chọn' : elTypeLabel(e.type)}</b>
        <span class="badge soft mono">${U.esc(found.band)}</span>
      </div>
      ${e.type === 'field' ? `
        <div class="field"><label>Trường dữ liệu</label><select id="p-field">${D.fields.map((f) => `<option value="${U.attr(f.key)}" ${f.key === e.field ? 'selected' : ''}>${U.esc(f.label)}</option>`).join('')}</select></div>
        <div class="field"><label>Nhãn cột (dùng ở band tiêu đề cột)</label><input type="text" id="p-label" value="${U.attr(e.label || '')}"/></div>` : ''}
      ${['text', 'expr', 'richText', 'systemInfo', 'barcode', 'qrcode'].includes(e.type) ? `
        <div class="field"><label>${e.type === 'expr' ? 'Công thức' : e.type === 'barcode' ? 'Nội dung mã vạch' : 'Nội dung'}</label>
          <textarea id="p-text" rows="${e.type === 'expr' || e.type === 'richText' ? 4 : 2}">${U.esc(e.text || '')}</textarea>
          ${e.type === 'expr' ? `<div class="hint">Ví dụ: <code class="mono">TỔNG: {SUM(originalCost)} VNĐ</code>, <code class="mono">{COUNT()}</code>, <code class="mono">{SUM(cost,group)}</code></div>` : ''}
        </div>` : ''}
      ${e.type === 'expr' ? `<div class="field"><label>Biểu thức tổng hợp (expr)</label><input type="text" id="p-expr" value="${U.attr(e.expr || '')}" class="mono"/></div>` : ''}
      ${e.type === 'image' ? `<div class="field"><label>Nguồn ảnh (URL hoặc trường dữ liệu)</label><input type="text" id="p-img" value="${U.attr(e.text || '')}"/><div class="hint">Để trống sẽ dùng logo công ty trong cấu hình.</div></div>` : ''}
      <div class="prop-row">
        <div class="field"><label>X (mm)</label><input type="number" step="0.5" id="p-x" value="${Number(e.x || 0)}"/></div>
        <div class="field"><label>Y (mm)</label><input type="number" step="0.5" id="p-y" value="${Number(e.y || 0)}"/></div>
        <div class="field"><label>Rộng (mm)</label><input type="number" step="0.5" id="p-w" value="${Number(e.w || 10)}"/></div>
        <div class="field"><label>Cao (mm)</label><input type="number" step="0.5" id="p-h" value="${Number(e.h || 6)}"/></div>
      </div>
      <div class="prop-row">
        <div class="field"><label>Canh ngang</label><select id="p-align">${[['left', 'Trái'], ['center', 'Giữa'], ['right', 'Phải']].map(([v, l]) => `<option value="${v}" ${e.align === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>Canh dọc</label><select id="p-valign">${[['top', 'Trên'], ['middle', 'Giữa'], ['bottom', 'Dưới']].map(([v, l]) => `<option value="${v}" ${e.valign === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="prop-row">
        <div class="field"><label>Cỡ chữ (pt)</label><input type="number" step="0.5" id="p-fs" value="${Number(e.fontSize || 10)}"/></div>
        <div class="field"><label>Định dạng</label><select id="p-format">${FORMATS.map((f) => `<option value="${f.value}" ${e.format === f.value ? 'selected' : ''}>${f.label}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Số thập phân</label><input type="number" id="p-dec" value="${Number(e.decimals || 0)}" min="0" max="4"/></div>
      <div class="field"><label>Kiểu chữ</label>
        <div class="row wrap" style="gap:6px">
          <label class="checkbox"><input type="checkbox" id="p-bold" ${e.bold ? 'checked' : ''}/> <b>Đậm</b></label>
          <label class="checkbox"><input type="checkbox" id="p-italic" ${e.italic ? 'checked' : ''}/> <i>Nghiêng</i></label>
          <label class="checkbox"><input type="checkbox" id="p-under" ${e.underline ? 'checked' : ''}/> <u>Gạch chân</u></label>
          <label class="checkbox"><input type="checkbox" id="p-upper" ${e.uppercase ? 'checked' : ''}/> IN HOA</label>
          <label class="checkbox"><input type="checkbox" id="p-wrap" ${e.wrap !== false ? 'checked' : ''}/> Tự xuống dòng</label>
        </div>
      </div>
      <div class="prop-row">
        <div class="field"><label>Màu chữ</label><input type="color" id="p-color" value="${U.attr(e.color || '#111827')}" style="height:32px;padding:2px"/></div>
        <div class="field"><label>Màu nền</label><input type="color" id="p-bg" value="${U.attr(e.bgColor || '#ffffff')}" style="height:32px;padding:2px"/></div>
      </div>
      <label class="checkbox mb"><input type="checkbox" id="p-nobg" ${!e.bgColor ? 'checked' : ''}/> <span>Không dùng màu nền</span></label>
      <div class="field"><label>Viền</label>
        <label class="checkbox mb"><input type="checkbox" id="p-border" ${e.border ? 'checked' : ''}/> <span>Hiển thị đường viền</span></label>
        <div class="prop-row">
          <select id="p-bstyle">${[['solid', 'Nét liền'], ['dashed', 'Nét đứt'], ['dotted', 'Nét chấm'], ['double', 'Nét đôi']].map(([v, l]) => `<option value="${v}" ${e.borderStyle === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <input type="color" id="p-bcolor" value="${U.attr(e.borderColor || '#9ca3af')}" style="height:32px;padding:2px"/>
        </div>
        <input type="number" id="p-bwidth" value="${Number(e.borderWidth || 1)}" min="1" max="6" style="margin-top:6px" title="Độ dày viền (px)"/>
      </div>
      <button class="btn sm block mb" id="p-del">🗑 Xoá đối tượng</button>`;

    const bind = (sel, handler, ev) => {
      const el = host.querySelector(sel);
      if (el) el.addEventListener(ev || 'change', handler);
    };
    const set = (patch, rerenderProps) => { pushUndo(); Object.assign(e, patch); renderCanvas(); if (rerenderProps) renderProps(host); };
    bind('#p-field', (ev) => {
      const f = D.fields.find((x) => x.key === ev.target.value);
      set({ field: ev.target.value, label: f ? f.label : '', format: f ? (f.type === 'money' ? 'money' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text') : 'text' }, true);
    });
    bind('#p-label', (ev) => set({ label: ev.target.value }));
    bind('#p-text', (ev) => set({ text: ev.target.value }), 'input');
    bind('#p-expr', (ev) => set({ expr: ev.target.value }));
    bind('#p-img', (ev) => set({ text: ev.target.value }));
    ['x', 'y', 'w', 'h', 'fs', 'dec'].forEach((k) => {
      const map = { x: 'x', y: 'y', w: 'w', h: 'h', fs: 'fontSize', dec: 'decimals' };
      bind('#p-' + k, (ev) => set({ [map[k]]: Number(ev.target.value) }));
    });
    bind('#p-align', (ev) => set({ align: ev.target.value }));
    bind('#p-valign', (ev) => set({ valign: ev.target.value }));
    bind('#p-format', (ev) => set({ format: ev.target.value }));
    bind('#p-color', (ev) => set({ color: ev.target.value }));
    bind('#p-bg', (ev) => set({ bgColor: ev.target.value }));
    bind('#p-bcolor', (ev) => set({ borderColor: ev.target.value }));
    bind('#p-bstyle', (ev) => set({ borderStyle: ev.target.value }));
    bind('#p-bwidth', (ev) => set({ borderWidth: Number(ev.target.value) }));
    ['bold', 'italic', 'under', 'upper', 'wrap', 'border'].forEach((k) => {
      const map = { bold: 'bold', italic: 'italic', under: 'underline', upper: 'uppercase', wrap: 'wrap', border: 'border' };
      bind('#p-' + k, (ev) => set({ [map[k]]: ev.target.checked }));
    });
    bind('#p-nobg', (ev) => set({ bgColor: ev.target.checked ? '' : '#ffffff' }, true));
    bind('#p-del', () => deleteSelection(), 'click');
  }

  function elTypeLabel(t) {
    return {
      field: '🔗 Trường dữ liệu', text: '🔤 Văn bản tĩnh', expr: '🧮 Công thức / Tổng hợp', line: '➖ Đường kẻ',
      rect: '⬛ Hình chữ nhật', image: '🖼 Hình ảnh', pageNumber: '📄 Số trang', pageInfo: '📄 Trang X/Y',
      dateTime: '🕐 Ngày giờ in', systemInfo: 'ℹ️ Thông tin hệ thống', barcode: '▮ Mã vạch', qrcode: '⬜ Mã QR', richText: '📝 Khối văn bản',
    }[t] || t;
  }

  /* --------------------------- Tab Dữ liệu --------------------------- */

  function renderDataTab(host) {
    const ds = D.dataset || {};
    host.innerHTML = `
      <div class="dz-group">Nguồn dữ liệu</div>
      <div class="field"><label>Dataset</label>
        <select id="d-dataset">${(D.datasets || []).map((d) => `<option value="${U.attr(d.key)}" ${d.key === D.template.dataset ? 'selected' : ''}>${U.esc(d.label)}</option>`).join('')}</select>
        <div class="hint">Đổi dataset cần khởi động lại trình thiết kế để nạp danh sách trường mới.</div>
      </div>
      <div class="dz-group">Nhóm dữ liệu (Group)</div>
      <div class="tiny muted mb">Báo cáo sẽ nhóm dòng theo trường được chọn và lặp lại đầu/tổng nhóm.</div>
      ${(D.design.groups || []).map((g, i) => `
        <div class="exp-item mb"><div class="top"><span>Nhóm ${i + 1}:</span>
          <select data-group="${i}" class="g-field">${D.fields.map((f) => `<option value="${U.attr(f.key)}" ${f.key === g.field ? 'selected' : ''}>${U.esc(f.label)}</option>`).join('')}</select>
          <span class="x" data-delgroup="${i}">✕</span></div></div>`).join('')}
      <button class="btn sm block mb" id="d-addgroup">＋ Thêm nhóm</button>
      <div class="dz-group">Sắp xếp</div>
      ${(D.design.sorting || []).map((s, i) => `
        <div class="exp-item mb"><div class="top">
          <select data-sort="${i}" class="s-field" style="flex:1">${D.fields.map((f) => `<option value="${U.attr(f.key)}" ${f.key === s.field ? 'selected' : ''}>${U.esc(f.label)}</option>`).join('')}</select>
          <select data-sortorder="${i}" style="width:78px"><option value="asc" ${s.order === 'asc' ? 'selected' : ''}>Tăng</option><option value="desc" ${s.order === 'desc' ? 'selected' : ''}>Giảm</option></select>
          <span class="x" data-delsort="${i}">✕</span></div></div>`).join('')}
      <button class="btn sm block mb" id="d-addsort">＋ Thêm sắp xếp</button>
      <div class="dz-group">Lọc dữ liệu (Filter)</div>
      ${(D.design.filters || []).map((f, i) => `
        <div class="exp-item mb"><div class="top">
          <select data-filter="${i}" class="f-field" style="flex:1">${D.fields.map((x) => `<option value="${U.attr(x.key)}" ${x.key === f.field ? 'selected' : ''}>${U.esc(x.label)}</option>`).join('')}</select>
          <select data-filterop="${i}" style="width:70px">${[['=', '='], ['!=', '≠'], ['like', 'chứa'], ['in', 'trong']].map(([v, l]) => `<option value="${v}" ${f.op === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <span class="x" data-delfilter="${i}">✕</span></div>
          <input type="text" data-filterval="${i}" value="${U.attr(f.value || '')}" placeholder="Giá trị (nhiều giá trị cách nhau dấu phẩy)" style="margin-top:6px"/>
        </div>`).join('')}
      <button class="btn sm block mb" id="d-addfilter">＋ Thêm điều kiện lọc</button>
      <label class="checkbox mb"><input type="checkbox" id="d-include-deleted" ${D.design.includeDeleted ? 'checked' : ''}/> <span>Bao gồm cả bản ghi đã xoá</span></label>
      <div class="dz-group">Tham số người dùng nhập khi chạy</div>
      ${(D.design.parameters || []).map((p, i) => `
        <div class="exp-item mb">
          <div class="top"><b>${U.esc(p.label || p.name)}</b><span class="badge soft">${U.esc(p.type)}</span><span class="x" data-delparam="${i}">✕</span></div>
          <div class="tiny muted" style="margin-top:4px">Lọc theo trường: <code class="mono">${U.esc(p.applyTo || '—')}</code> ${U.esc(p.op || '')}</div>
        </div>`).join('')}
      <button class="btn sm block" id="d-addparam">＋ Thêm tham số</button>`;

    const dsSel = host.querySelector('#d-dataset');
    dsSel.onchange = () => { D.template.dataset = dsSel.value; D.dirty = true; UI.toast('Đã đổi dataset', 'Hãy tải lại trình thiết kế để nạp trường mới', 'info'); };

    host.querySelector('#d-addgroup').onclick = () => { pushUndo(); D.design.groups.push({ field: D.fields[0] ? D.fields[0].key : '', label: 'Nhóm' }); renderDataTab(host); renderCanvas(); };
    host.querySelectorAll('[data-delgroup]').forEach((b) => (b.onclick = () => { pushUndo(); D.design.groups.splice(Number(b.dataset.delgroup), 1); renderDataTab(host); renderCanvas(); }));
    host.querySelectorAll('.g-field').forEach((s) => (s.onchange = () => { pushUndo(); D.design.groups[Number(s.dataset.group)].field = s.value; renderCanvas(); }));
    host.querySelector('#d-addsort').onclick = () => { pushUndo(); D.design.sorting.push({ field: D.fields[0] ? D.fields[0].key : '', order: 'asc' }); renderDataTab(host); };
    host.querySelectorAll('[data-delsort]').forEach((b) => (b.onclick = () => { pushUndo(); D.design.sorting.splice(Number(b.dataset.delsort), 1); renderDataTab(host); }));
    host.querySelectorAll('.s-field').forEach((s) => (s.onchange = () => { pushUndo(); D.design.sorting[Number(s.dataset.sort)].field = s.value; }));
    host.querySelectorAll('[data-sortorder]').forEach((s) => (s.onchange = () => { pushUndo(); D.design.sorting[Number(s.dataset.sortorder)].order = s.value; }));
    host.querySelector('#d-addfilter').onclick = () => { pushUndo(); D.design.filters.push({ field: D.fields[0] ? D.fields[0].key : '', op: '=', value: '' }); renderDataTab(host); };
    host.querySelectorAll('[data-delfilter]').forEach((b) => (b.onclick = () => { pushUndo(); D.design.filters.splice(Number(b.dataset.delfilter), 1); renderDataTab(host); }));
    host.querySelectorAll('.f-field').forEach((s) => (s.onchange = () => { pushUndo(); D.design.filters[Number(s.dataset.filter)].field = s.value; }));
    host.querySelectorAll('[data-filterop]').forEach((s) => (s.onchange = () => { pushUndo(); D.design.filters[Number(s.dataset.filterop)].op = s.value; }));
    host.querySelectorAll('[data-filterval]').forEach((s) => (s.oninput = () => { D.design.filters[Number(s.dataset.filterval)].value = s.value; D.dirty = true; }));
    host.querySelector('#d-include-deleted').onchange = (ev) => { pushUndo(); D.design.includeDeleted = ev.target.checked; };
    host.querySelector('#d-addparam').onclick = () => {
      pushUndo();
      D.design.parameters.push({ name: 'param' + ((D.design.parameters || []).length + 1), label: 'Tham số mới', type: 'text', applyTo: D.fields[0] ? D.fields[0].key : '', op: '=', default: '' });
      renderDataTab(host);
    };
    host.querySelectorAll('[data-delparam]').forEach((b) => (b.onclick = () => { pushUndo(); D.design.parameters.splice(Number(b.dataset.delparam), 1); renderDataTab(host); }));
  }

  /* --------------------------- Tab Trang --------------------------- */

  function renderPageTab(host) {
    const m = D.design.margins;
    host.innerHTML = `
      <div class="dz-group">Khổ giấy & hướng</div>
      <div class="prop-row">
        <div class="field"><label>Khổ giấy</label><select id="pg-size">${Object.keys(PAPER).map((k) => `<option value="${k}" ${D.design.paperSize === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
        <div class="field"><label>Hướng</label><select id="pg-orient">
          <option value="portrait" ${D.design.orientation !== 'landscape' ? 'selected' : ''}>Dọc</option>
          <option value="landscape" ${D.design.orientation === 'landscape' ? 'selected' : ''}>Ngang</option></select></div>
      </div>
      <div class="dz-group">Lề trang (mm)</div>
      <div class="prop-row">
        <div class="field"><label>Trên</label><input type="number" id="pg-mt" value="${m.top}"/></div>
        <div class="field"><label>Dưới</label><input type="number" id="pg-mb" value="${m.bottom}"/></div>
        <div class="field"><label>Trái</label><input type="number" id="pg-ml" value="${m.left}"/></div>
        <div class="field"><label>Phải</label><input type="number" id="pg-mr" value="${m.right}"/></div>
      </div>
      <div class="dz-group">Chiều cao các band (mm)</div>
      ${BANDS.map((b) => `<div class="field"><label style="color:${b.color === '#f1f5f9' ? '#64748b' : '#0f172a'}">${b.label}</label>
        <input type="number" step="0.5" data-bh="${b.key}" value="${Number((D.design.bands[b.key] || {}).height || 8)}"/></div>`).join('')}
      <div class="dz-group">Tuỳ chọn</div>
      <label class="checkbox mb"><input type="checkbox" id="pg-grid" ${D.showGrid ? 'checked' : ''}/> <span>Hiện lưới thiết kế</span></label>
      <label class="checkbox mb"><input type="checkbox" id="pg-snap" ${D.snap ? 'checked' : ''}/> <span>Bám lưới khi kéo thả</span></label>
      <label class="checkbox mb"><input type="checkbox" id="pg-repeat" ${D.design.options.repeatColumnHeader !== false ? 'checked' : ''}/> <span>Lặp lại tiêu đề cột ở mọi trang</span></label>
      <label class="checkbox mb"><input type="checkbox" id="pg-break" ${D.design.options.pageBreaksBetweenGroups ? 'checked' : ''}/> <span>Ngắt trang giữa các nhóm</span></label>`;

    host.querySelector('#pg-size').onchange = (ev) => { pushUndo(); D.design.paperSize = ev.target.value; render(); renderRight('page'); };
    host.querySelector('#pg-orient').onchange = (ev) => { pushUndo(); D.design.orientation = ev.target.value; render(); renderRight('page'); };
    ['mt', 'mb', 'ml', 'mr'].forEach((k) => {
      const map = { mt: 'top', mb: 'bottom', ml: 'left', mr: 'right' };
      host.querySelector('#pg-' + k).onchange = (ev) => { pushUndo(); D.design.margins[map[k]] = Number(ev.target.value); renderCanvas(); };
    });
    host.querySelectorAll('[data-bh]').forEach((inp) => (inp.onchange = (ev) => {
      pushUndo();
      D.design.bands[inp.dataset.bh] = D.design.bands[inp.dataset.bh] || { elements: [] };
      D.design.bands[inp.dataset.bh].height = Number(ev.target.value) || 6;
      renderCanvas();
    }));
    host.querySelector('#pg-grid').onchange = (ev) => { D.showGrid = ev.target.checked; renderCanvas(); };
    host.querySelector('#pg-snap').onchange = (ev) => { D.snap = ev.target.checked; };
    host.querySelector('#pg-repeat').onchange = (ev) => { pushUndo(); D.design.options.repeatColumnHeader = ev.target.checked; };
    host.querySelector('#pg-break').onchange = (ev) => { pushUndo(); D.design.options.pageBreaksBetweenGroups = ev.target.checked; };
  }

  /* --------------------------- Tab Quy tắc --------------------------- */

  function renderRulesTab(host) {
    host.innerHTML = `
      <div class="dz-group">Bảng dữ liệu mẫu</div>
      <button class="btn sm block mb" id="r-preview">👁 Xem trước dữ liệu (20 dòng đầu)</button>
      <div id="r-data"></div>
      <div class="dz-group">Khung mẫu nhanh</div>
      <div class="tiny muted mb">Sinh lại bố cục từ danh sách trường (ghi đè band tiêu đề cột & chi tiết).</div>
      <button class="btn sm block mb" id="r-quick-list">📋 Bảng danh sách (không nhóm)</button>
      <button class="btn sm block mb" id="r-quick-group">📋 Bảng có nhóm + tổng nhóm</button>
      <button class="btn sm block mb" id="r-quick-summary">📋 Bảng tổng hợp tài chính</button>
      <div class="dz-group">Công cụ</div>
      <button class="btn sm block mb" id="r-clear-detail">🧹 Xoá trắng band chi tiết</button>
      <button class="btn sm block mb" id="r-clear-all">🧹 Xoá toàn bộ đối tượng</button>
      <button class="btn sm block" id="r-reset">↺ Khôi phục thiết kế gốc</button>`;
    host.querySelector('#r-preview').onclick = async () => {
      const box = host.querySelector('#r-data');
      box.innerHTML = '<div class="page-loading"><div class="spinner"></div> Đang tải…</div>';
      try {
        const res = await API.get(`/api/reports/datasets/${D.template.dataset}/data?limit=20`);
        const rows = res.data || [];
        if (!rows.length) { box.innerHTML = '<div class="alert warning">Không có dữ liệu</div>'; return; }
        const keys = Object.keys(rows[0]).slice(0, 8);
        box.innerHTML = `<div class="table-wrap" style="max-height:240px;border:1px solid var(--border);border-radius:8px">
          <table class="data compact"><thead><tr>${keys.map((k) => `<th>${U.esc(k)}</th>`).join('')}</tr></thead>
          <tbody>${rows.map((r) => `<tr>${keys.map((k) => `<td>${U.esc(String(r[k] === null || r[k] === undefined ? '' : r[k]).slice(0, 22))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      } catch (e) { box.innerHTML = `<div class="alert danger">${U.esc(e.message)}</div>`; }
    };
    host.querySelector('#r-quick-list').onclick = () => quickTable('list');
    host.querySelector('#r-quick-group').onclick = () => quickTable('group');
    host.querySelector('#r-quick-summary').onclick = () => quickTable('summary');
    host.querySelector('#r-clear-detail').onclick = () => { pushUndo(); D.design.bands.detail.elements = []; D.selection = []; renderCanvas(); };
    host.querySelector('#r-clear-all').onclick = async () => {
      if (!(await UI.confirm({ title: 'Xoá toàn bộ đối tượng?', message: 'Toàn bộ đối tượng trong mọi band sẽ bị xoá.', danger: true }))) return;
      pushUndo();
      Object.keys(D.design.bands).forEach((k) => (D.design.bands[k].elements = []));
      D.selection = []; renderCanvas();
    };
    host.querySelector('#r-reset').onclick = async () => {
      if (!(await UI.confirm({ title: 'Khôi phục thiết kế gốc?', message: 'Mọi thay đổi chưa lưu sẽ mất.', danger: true }))) return;
      D.undoStack.push(JSON.stringify(D.design));
      const res = await API.get('/api/reports/blank-design');
      D.design = res.data;
      render(); renderRight('rules');
    };
  }

  /** Sinh nhanh bố cục bảng */
  function quickTable(mode) {
    pushUndo();
    const fields = D.fields.filter((f) => f.type !== 'json').slice(0, mode === 'summary' ? 6 : 7);
    const paper = PAPER[D.design.paperSize] || PAPER.A4;
    const landscape = D.design.orientation === 'landscape';
    const contentW = (landscape ? paper[1] : paper[0]) - D.design.margins.left - D.design.margins.right;
    const colW = contentW / fields.length;
    const colEls = [];
    const detailEls = [];
    fields.forEach((f, i) => {
      const align = f.type === 'money' || f.type === 'number' ? 'right' : f.type === 'date' ? 'center' : 'left';
      colEls.push({ id: 'c' + i + '_' + Date.now().toString(36), type: 'field', x: i * colW, y: 0, w: colW, h: 8, field: f.key, label: f.label, align, bold: true, fontSize: 9, bgColor: '#dbeafe', border: true, borderColor: '#94a3b8', format: f.type === 'money' ? 'money' : f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text' });
      detailEls.push({ id: 'd' + i + '_' + Date.now().toString(36), type: 'field', x: i * colW, y: 0, w: colW, h: 6.5, field: f.key, align, fontSize: 9, border: true, borderColor: '#cbd5e1', format: f.type === 'money' ? 'money' : f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text', wrap: false });
    });
    D.design.bands.columnHeader = { height: 8, elements: colEls };
    D.design.bands.detail = { height: 6.5, elements: detailEls };

    if (mode !== 'list') {
      const groupField = D.fields.find((f) => ['departmentName', 'categoryName', 'period', 'locationName', 'stocktakeCode'].includes(f.key)) || D.fields.find((f) => f.key.endsWith('Name')) || fields[0];
      D.design.groups = [{ field: groupField.key, label: groupField.label }];
      D.design.bands.groupHeader = { height: 8, elements: [{ id: 'gh' + Date.now().toString(36), type: 'text', x: 0, y: 0, w: contentW, h: 8, text: '▸ ' + groupField.label.toUpperCase() + ': {groupValue}', bold: true, fontSize: 10, bgColor: '#f1f5f9', border: true, borderColor: '#94a3b8', align: 'left', valign: 'middle' }] };
      const moneyField = fields.filter((f) => f.type === 'money').slice(-1)[0];
      D.design.bands.groupFooter = {
        height: 8,
        elements: [
          { id: 'gf1' + Date.now().toString(36), type: 'text', x: 0, y: 0, w: contentW * 0.6, h: 8, text: 'Cộng nhóm ({COUNT(group)} dòng):', bold: true, fontSize: 9.5, align: 'right', bgColor: '#f8fafc', border: true },
          { id: 'gf2' + Date.now().toString(36), type: 'expr', x: contentW * 0.6, y: 0, w: contentW * 0.4, h: 8, expr: moneyField ? `{SUM(${moneyField.key},group)}` : '{COUNT(group)}', bold: true, fontSize: 9.5, align: 'right', bgColor: '#f8fafc', border: true, format: 'money' },
        ],
      };
    } else {
      D.design.groups = [];
      D.design.bands.groupHeader = { height: 8, elements: [] };
      D.design.bands.groupFooter = { height: 8, elements: [] };
    }
    if (!D.design.bands.reportFooter || !D.design.bands.reportFooter.elements.length) {
      D.design.bands.reportFooter = {
        height: 20,
        elements: [{ id: 'rf' + Date.now().toString(36), type: 'expr', x: 0, y: 0, w: contentW, h: 8, expr: 'TỔNG CỘNG: {COUNT()} bản ghi' + (fields.filter((f) => f.type === 'money').length ? ' — Tổng tiền: {SUM(' + fields.filter((f) => f.type === 'money').slice(-1)[0].key + ')}' : ''), bold: true, fontSize: 11, align: 'left', bgColor: '#eff6ff', border: true, borderColor: '#2563eb' }],
      };
    }
    D.selection = [];
    renderCanvas();
    renderRight('props');
    UI.toast('Đã sinh bố cục bảng', mode === 'list' ? 'Danh sách đơn giản' : mode === 'group' ? 'Có nhóm và tổng nhóm' : 'Tổng hợp tài chính', 'success');
  }

  /* --------------------------- Lưu / xuất --------------------------- */

  async function save(silent) {
    UI.loading(true, 'Đang lưu thiết kế…');
    try {
      await API.put('/api/entities/report_templates/' + D.template.id, {
        name: D.template.name,
        description: D.template.description,
        dataset: D.template.dataset,
        design: D.design,
        paperSize: D.design.paperSize,
        orientation: D.design.orientation,
      });
      UI.loading(false);
      D.dirty = false;
      if (!silent) UI.toast('Đã lưu mẫu báo cáo', D.template.name, 'success');
      const titleHost = D.container.querySelector('.page-head h1');
      if (titleHost) titleHost.innerHTML = titleHost.innerHTML.replace(' <span class="badge" style="background:#fef3c7;color:#92400e">chưa lưu</span>', '');
    } catch (e) { UI.loading(false); UI.toast('Không lưu được', e.message, 'error'); }
  }
  D.save = save;

  function saveAs() {
    const m = UI.modal({
      size: 'sm', title: 'Lưu thành mẫu mới',
      body: `<div class="field"><label>Tên mẫu mới</label><input type="text" id="sa-name" value="${U.attr(D.template.name + ' (bản sao)')}"/></div>
             <div class="field"><label>Mô tả</label><input type="text" id="sa-desc" value="${U.attr(D.template.description || '')}"/></div>`,
      footer: [
        { label: 'Huỷ', onClick: (mm) => mm.close() },
        { label: '💾 Tạo mẫu mới', cls: 'primary', onClick: async (mm) => {
          UI.loading(true, 'Đang tạo…');
          try {
            const res = await API.post('/api/entities/report_templates', {
              name: mm.body.querySelector('#sa-name').value,
              description: mm.body.querySelector('#sa-desc').value,
              dataset: D.template.dataset, design: D.design,
              paperSize: D.design.paperSize, orientation: D.design.orientation,
            });
            UI.loading(false); mm.close();
            UI.toast('Đã tạo mẫu mới', res.data.code, 'success');
            App.Router.navigate('/reports/designer/' + res.data.id);
          } catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
        } },
      ],
    });
  }

  async function preview() {
    UI.loading(true, 'Đang tạo bản xem trước…');
    try {
      const res = await fetch('/api/reports/preview', API.withAuth({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ design: D.design, dataset: D.template.dataset, name: D.template.name, limit: 300 }),
      }));
      const html = await res.text();
      UI.loading(false);
      const m = UI.modal({
        size: 'xl', title: 'Xem trước báo cáo: ' + D.template.name,
        subtitle: 'Bản xem trước dùng tối đa 300 dòng dữ liệu',
        body: `<iframe class="report-frame" style="height:70vh"></iframe>`,
        footer: [
          { label: 'Đóng', onClick: (mm) => mm.close() },
          { label: '⬇ CSV', onClick: (mm) => { mm.close(); exportAs('csv'); } },
          { label: '⬇ Word', onClick: (mm) => { mm.close(); exportAs('docx'); } },
          { label: '⬇ Excel', onClick: (mm) => { mm.close(); exportAs('xlsx'); } },
          { label: '🖨 In / PDF', cls: 'primary', onClick: (mm) => { mm.close(); exportAs('html'); } },
        ],
      });
      const iframe = m.body.querySelector('iframe');
      iframe.srcdoc = html;
    } catch (e) { UI.loading(false); UI.toast('Lỗi xem trước', e.message, 'error'); }
  }

  async function exportAs(format) {
    if (format === 'html') {
      UI.loading(true, 'Đang chuẩn bị bản in…');
      try {
        const res = await fetch('/api/reports/render', API.withAuth({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ design: D.design, dataset: D.template.dataset, name: D.template.name, format: 'html' }),
        }));
        const html = await res.text();
        UI.loading(false);
        const win = window.open('', '_blank');
        if (win) { win.document.open(); win.document.write(html); win.document.close(); }
      } catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
      return;
    }
    UI.loading(true, 'Đang kết xuất ' + format.toUpperCase() + '…');
    try {
      await API.download('/api/reports/render', 'POST', { design: D.design, dataset: D.template.dataset, name: D.template.name, format }, `${U.slug(D.template.name)}.${format}`);
      UI.loading(false);
      UI.toast('Đã xuất file', format.toUpperCase(), 'success');
    } catch (e) { UI.loading(false); UI.toast('Lỗi', e.message, 'error'); }
  }

  /* --------------------------- Bàn phím --------------------------- */

  function bindKeys() {
    document.addEventListener('keydown', onKey);
  }
  function onKey(e) {
    if (!D.container || !document.body.contains(D.container)) { document.removeEventListener('keydown', onKey); return; }
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = ['input', 'textarea', 'select'].includes(tag);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && D.selection.length && !typing) {
      e.preventDefault();
      D.clipboard = D.selection.map((id) => { const f = findEl(id); return f ? JSON.parse(JSON.stringify(f.el)) : null; }).filter(Boolean);
      UI.toast('Đã sao chép', D.clipboard.length + ' đối tượng', 'info');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && D.clipboard.length && !typing) {
      e.preventDefault();
      pushUndo();
      const ids = [];
      D.clipboard.forEach((c) => {
        const copy = JSON.parse(JSON.stringify(c));
        copy.id = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        copy.x = Number(copy.x) + 2; copy.y = Number(copy.y) + 1;
        const band = findEl(c.id) ? findEl(c.id).band : 'detail';
        D.design.bands[band].elements.push(copy);
        ids.push(copy.id);
      });
      D.selection = ids;
      renderCanvas();
      return;
    }
    if (e.key === 'F5') { e.preventDefault(); preview(); return; }
    if (typing) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && D.selection.length) {
      e.preventDefault();
      const step = e.shiftKey ? 2 : 0.5;
      pushUndo();
      D.selection.forEach((id) => {
        const f = findEl(id);
        if (!f) return;
        if (e.key === 'ArrowLeft') f.el.x = Math.max(0, snap(Number(f.el.x) - step));
        if (e.key === 'ArrowRight') f.el.x = snap(Number(f.el.x) + step);
        if (e.key === 'ArrowUp') f.el.y = Math.max(0, snap(Number(f.el.y) - step));
        if (e.key === 'ArrowDown') f.el.y = snap(Number(f.el.y) + step);
      });
      renderCanvas();
    }
  }

  function updateStatus() {
    const el = D.container && D.container.querySelector('#dz-status-sel');
    if (!el) return;
    if (!D.selection.length) { el.textContent = 'Chưa chọn đối tượng'; return; }
    if (D.selection.length > 1) { el.textContent = `Đang chọn ${D.selection.length} đối tượng`; return; }
    const f = findEl(D.selection[0]);
    if (!f) return;
    el.textContent = `${elTypeLabel(f.el.type)} • X=${Number(f.el.x).toFixed(1)}mm Y=${Number(f.el.y).toFixed(1)}mm • ${Number(f.el.w).toFixed(1)}×${Number(f.el.h).toFixed(1)}mm`;
  }
})();
