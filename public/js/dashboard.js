/* ==========================================================================
   dashboard.js — Bảng điều khiển & phân tích
   ========================================================================== */
(function () {
  'use strict';
  const U = App.U;
  const API = App.api;
  const Dash = {};
  window.Dash = Dash;

  Dash.dashboard = async function (container) {
    container.innerHTML = `
      <div class="page-head">
        <div>
          <h1>📊 Bảng điều khiển</h1>
          <div class="sub">Tổng quan tình hình quản lý tài sản — cập nhật <b id="dash-time">đang tải…</b></div>
        </div>
        <div class="actions">
          <button class="btn" id="dash-refresh">🔄 Làm mới</button>
          ${App.can('reports', 'view') ? '<a class="btn" href="#/reports">📈 Báo cáo</a>' : ''}
          ${App.can('assets', 'create') ? '<a class="btn primary" href="#/assets" >＋ Tài sản mới</a>' : ''}
        </div>
      </div>
      <div id="dash-body"><div class="page-loading"><div class="spinner"></div> Đang tổng hợp dữ liệu…</div></div>`;

    const load = async () => {
      try {
        const res = await API.get('/api/dashboard/summary');
        render(res.data);
        document.getElementById('dash-time').textContent = U.datetime(new Date().toISOString());
      } catch (e) {
        document.getElementById('dash-body').innerHTML = `<div class="alert danger">Không tải được dữ liệu: ${U.esc(e.message)}</div>`;
      }
    };
    document.getElementById('dash-refresh').onclick = load;
    await load();
  };

  function render(d) {
    const k = d.kpi;
    const body = document.getElementById('dash-body');
    const myScope = App.state.user.departmentId ? `<a class="link" href="#/assets?filter[departmentId]=${App.state.user.departmentId}">Xem tài sản phòng ban tôi</a>` : '';
    body.innerHTML = `
    <!-- KPI -->
    <div class="grid cols-4 mb">
      ${UI.kpi({ label: 'Tổng tài sản đang quản lý', value: U.num(k.totalAssets), icon: '📦', color: 'blue', trend: `${U.num(k.assetGrowth30d)} tài sản thêm trong 30 ngày` })}
      ${UI.kpi({ label: 'Tổng nguyên giá', value: U.moneyShort(k.totalOriginal), suffix: 'VNĐ', icon: '💰', color: 'purple', trend: `Bình quân ${U.moneyShort(k.avgAssetValue)}/tài sản` })}
      ${UI.kpi({ label: 'Giá trị còn lại', value: U.moneyShort(k.totalBook), suffix: 'VNĐ', icon: '📈', color: 'green', trend: `Hao mòn luỹ kế ${U.pct(k.depreciationRate)} nguyên giá` })}
      ${UI.kpi({ label: 'Hao mòn luỹ kế', value: U.moneyShort(k.totalAccumulated), suffix: 'VNĐ', icon: '📉', color: 'amber', trend: `${U.num(k.fullyDepreciated)} tài sản đã khấu hao hết` })}
    </div>

    <div class="grid cols-4 mb">
      ${kpiSmall('Đang sử dụng', k.inUse, '#16a34a', '✅')}
      ${kpiSmall('Trong kho / chưa cấp phát', k.inStock, '#64748b', '🏬')}
      ${kpiSmall('Đang bảo trì / hỏng', k.repairing, '#f59e0b', '🔧')}
      ${kpiSmall('Đã thanh lý', k.disposed, '#475569', '🗑')}
    </div>

    ${(k.maintenanceDue > 0 || k.warrantyExpiring > 0 || k.pendingApprovals > 0 || k.fullyDepreciated > 0) ? `
    <div class="card mb">
      <div class="card-head"><h3>⚠️ Cần bạn xử lý</h3><span class="sub">Các hạng mục đến hạn hoặc chờ phê duyệt</span></div>
      <div class="card-body grid cols-4">
        ${alertCard('Đến hạn bảo trì', k.maintenanceDue, 'kỳ bảo trì trong 30 ngày tới', '#assets?filter[status]=in_use', '🔧', 'amber')}
        ${alertCard('Sắp hết bảo hành', k.warrantyExpiring, 'tài sản hết hạn trong 30 ngày', '#/warranties', '🛡', 'blue')}
        ${alertCard('Chờ phê duyệt', k.pendingApprovals, 'phiếu điều chuyển & thanh lý', '#/transfers?filter[status]=pending', '⏳', 'red')}
        ${alertCard('Đã khấu hao hết', k.fullyDepreciated, 'đề xuất thanh lý / xử lý', '#/assets', '📉', 'slate')}
      </div>
    </div>` : ''}

    <div class="grid cols-2 mb">
      <div class="card">
        <div class="card-head"><h3>💰 Nguyên giá tài sản theo danh mục</h3><div class="right"><span class="muted tiny">Top ${Math.min(10, d.byCategory.length)}</span></div></div>
        <div class="card-body">${Charts.hBar(d.byCategory.slice(0, 10).map((c) => ({ label: c.name, value: c.original })), { format: 'money' })}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>🏢 Cơ cấu tài sản theo phòng ban</h3><div class="right"><span class="muted tiny">theo nguyên giá</span></div></div>
        <div class="card-body">${Charts.hBar(d.byDepartment.slice(0, 10).map((c, i) => ({ label: c.name, value: c.original, color: App.PALETTE[i % App.PALETTE.length] })), { format: 'money' })}</div>
      </div>
    </div>

    <div class="grid cols-3 mb">
      <div class="card">
        <div class="card-head"><h3>📊 Trạng thái tài sản</h3></div>
        <div class="card-body">${Charts.donut(d.byStatus.map((s) => ({ label: s.label, value: s.count, color: s.color })), { centerLabel: 'Tài sản', format: 'number' })}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>🩺 Tình trạng kỹ thuật</h3></div>
        <div class="card-body">${Charts.stackedBar(d.byCondition.filter((c) => c.count > 0).map((c) => ({ label: c.label, value: c.count, color: c.color })))}</div>
        <div class="card-body" style="padding-top:0">
          ${d.byCondition.filter((c) => c.count > 0).map((c) => `<div class="stat-row"><span>${U.esc(c.label)}</span><b>${U.num(c.count)} (${U.pct((c.count / Math.max(1, k.totalAssets)) * 100, 1)})</b></div>`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>📍 Tài sản theo vị trí</h3></div>
        <div class="card-body">${Charts.hBar(d.byLocation.map((l) => ({ label: l.name, value: l.count })), { format: 'number' })}</div>
      </div>
    </div>

    <div class="grid cols-2 mb">
      <div class="card">
        <div class="card-head"><h3>📉 Khấu hao 12 kỳ gần nhất</h3><div class="right"><span class="muted tiny">đơn vị: VNĐ</span></div></div>
        <div class="card-body">${Charts.line(d.depreciationTrend.map((t) => ({ label: t.period.slice(5) + '/' + t.period.slice(2, 4), value: t.amount })), { format: 'money', color: '#7c3aed' })}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>🔧 Chi phí bảo trì 6 tháng gần nhất</h3></div>
        <div class="card-body">${Charts.vBar(d.maintenanceTrend.map((t) => ({ label: t.period.slice(5) + '/' + t.period.slice(2, 4), value: t.amount })), { format: 'money', color: '#f59e0b', height: 190 })}</div>
      </div>
    </div>

    <div class="grid cols-2 mb">
      <div class="card">
        <div class="card-head"><h3>🔧 Tài sản đến hạn bảo trì (30 ngày)</h3><div class="right"><a class="link tiny" href="#/maintenances">Xem tất cả</a></div></div>
        <div class="table-wrap">${tableOf(d.alerts.maintenanceDue, [
          { k: 'code', l: 'Mã', c: 'mono', link: true },
          { k: 'name', l: 'Tên tài sản' },
          { k: 'departmentName', l: 'Phòng ban' },
          { k: 'nextMaintenanceAt', l: 'Hạn bảo trì', fmt: (v) => `<span class="badge" style="background:#fef3c7;color:#92400e">${U.date(v)}</span>` },
        ])}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>🛡 Tài sản sắp hết bảo hành</h3><div class="right"><a class="link tiny" href="#/warranties">Xem tất cả</a></div></div>
        <div class="table-wrap">${tableOf(d.alerts.warrantyExpiring, [
          { k: 'code', l: 'Mã', c: 'mono', link: true },
          { k: 'name', l: 'Tên tài sản' },
          { k: 'supplierName', l: 'Nhà cung cấp' },
          { k: 'warrantyEnd', l: 'Hết bảo hành', fmt: (v) => `${U.date(v)} <span class="tiny muted">(còn ${Math.max(0, Math.round((new Date(v) - new Date()) / 86400000))} ngày)</span>` },
        ])}</div>
      </div>
    </div>

    <div class="grid cols-2 mb">
      <div class="card">
        <div class="card-head"><h3>💎 Top 10 tài sản giá trị lớn nhất</h3><div class="right"><a class="link tiny" href="#/assets?sort=originalCost&order=desc">Xem tất cả</a></div></div>
        <div class="table-wrap">${tableOf(d.topValueAssets, [
          { k: 'code', l: 'Mã', c: 'mono', link: true },
          { k: 'name', l: 'Tên tài sản' },
          { k: 'categoryName', l: 'Danh mục' },
          { k: 'originalCost', l: 'Nguyên giá', fmt: (v) => U.money(v), align: 'num' },
          { k: 'bookValue', l: 'Còn lại', fmt: (v) => U.money(v), align: 'num' },
        ])}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>🕒 Hoạt động gần đây</h3><div class="right"><a class="link tiny" href="#/admin/audit">Nhật ký đầy đủ</a></div></div>
        <div class="card-body" style="max-height:330px;overflow:auto">
          <div class="timeline">
            ${d.recentActivity.map((a) => `<div class="timeline-item">
              <div class="tt">${actionLabel(a.action)} <span class="muted tiny">${U.esc(a.entity || '')}</span></div>
              <div class="tm">${U.esc(a.username)} • ${U.timeAgo(a.createdAt)} • ${U.esc(a.entityLabel || '')}</div>
            </div>`).join('') || '<div class="muted tiny">Chưa có hoạt động</div>'}
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>📅 Tài sản đầu tư theo năm</h3></div>
      <div class="card-body">${Charts.vBar(d.byYear.map((y) => ({ label: y.year, value: y.value })), { format: 'money', color: '#2563eb', height: 200 })}
        <div class="legend">${d.byYear.map((y) => `<span class="li">${U.esc(y.year)}: <b>${U.num(y.count)}</b> tài sản — <b>${U.moneyShort(y.value)}</b></span>`).join('')}</div>
      </div>
    </div>

    <div class="grid cols-4 mt">
      ${UI.kpi({ label: 'Người dùng', value: U.num(k.users), icon: '👥', color: 'slate', trend: `${U.num(k.departments)} phòng ban • ${U.num(k.locations)} vị trí` })}
      ${UI.kpi({ label: 'Nhà cung cấp', value: U.num(k.suppliers), icon: '🚚', color: 'blue', trend: 'Đang hợp tác' })}
      ${UI.kpi({ label: 'Chi phí bảo trì năm nay', value: U.moneyShort(k.maintenanceCostThisYear), suffix: 'VNĐ', icon: '🔧', color: 'amber' })}
      ${UI.kpi({ label: 'Đợt kiểm kê đang mở', value: U.num(k.openStocktakes), icon: '🧮', color: 'purple', trend: k.openStocktakes ? '<a class="link" href="#/stocktakes">Vào kiểm kê ngay</a>' : '' })}
    </div>`;

    body.querySelectorAll('[data-goto]').forEach((el) => (el.onclick = () => App.Router.navigate(el.dataset.goto)));
  }

  function kpiSmall(label, value, color, icon) {
    return `<div class="card" style="padding:12px;display:flex;gap:10px;align-items:center">
      <div style="width:40px;height:40px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:18px;background:${U.hexToRgba(color, .13)};color:${color}">${icon}</div>
      <div><div class="muted tiny">${U.esc(label)}</div><b style="font-size:19px">${U.num(value)}</b></div>
    </div>`;
  }

  function alertCard(label, value, desc, link, icon, color) {
    const colors = { amber: '#f59e0b', blue: '#2563eb', red: '#ef4444', slate: '#64748b' };
    const c = colors[color] || '#2563eb';
    return `<a href="${link}" style="text-decoration:none;color:inherit;display:block;border:1px solid var(--border);border-radius:10px;padding:11px;background:${U.hexToRgba(c, .06)}">
      <div class="row between"><span style="font-size:20px">${icon}</span><b style="font-size:22px;color:${c}">${U.num(value)}</b></div>
      <div style="font-weight:600;margin-top:6px">${U.esc(label)}</div>
      <div class="muted tiny">${U.esc(desc)}</div>
    </a>`;
  }

  function tableOf(rows, cols) {
    if (!rows || !rows.length) return '<div class="empty tiny">Không có dữ liệu</div>';
    return `<table class="data compact"><thead><tr>${cols.map((c) => `<th class="${c.align || ''}">${U.esc(c.l)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr ${cols[0].link ? `style="cursor:pointer" onclick="location.hash='#/assets/${r.id}'"` : ''}>
        ${cols.map((c) => `<td class="${c.c || ''} ${c.align || ''}">${c.fmt ? c.fmt(r[c.k], r) : (r[c.k] === null || r[c.k] === undefined || r[c.k] === '' ? '—' : U.esc(r[c.k]))}</td>`).join('')}
      </tr>`).join('')}</tbody></table>`;
  }

  function actionLabel(a) {
    const map = {
      LOGIN: '🔑 Đăng nhập', LOGOUT: '🚪 Đăng xuất', LOGIN_FAILED: '⛔ Đăng nhập thất bại', CREATE: '➕ Thêm mới',
      UPDATE: '✏️ Cập nhật', DELETE: '🗑 Xoá', RESTORE: '♻️ Khôi phục', APPROVE: '✅ Phê duyệt', REJECT: '❌ Từ chối',
      IMPORT: '⬆ Nhập dữ liệu', EXPORT: '⬇ Xuất dữ liệu', RUN: '⚙️ Chạy tiến trình', CONFIG: '🔧 Cấu hình', RESTORE_DB: '💾 Phục hồi CSDL',
    };
    return map[a] || ('• ' + a);
  }
  Dash.actionLabel = actionLabel;

  /* ============================== Trang phân tích ============================== */

  Dash.analytics = async function (container) {
    container.innerHTML = `
      <div class="page-head">
        <div><h1>📈 Phân tích & Thống kê</h1><div class="sub">Phân tích đa chiều giá trị tài sản theo phòng ban, danh mục, vị trí, nhà cung cấp…</div></div>
        <div class="actions">
          <select id="an-group" style="width:210px">
            <option value="category">Nhóm theo danh mục</option>
            <option value="department">Nhóm theo phòng ban</option>
            <option value="location">Nhóm theo vị trí</option>
            <option value="status">Nhóm theo trạng thái</option>
            <option value="supplier">Nhóm theo nhà cung cấp</option>
            <option value="year">Nhóm theo năm mua</option>
            <option value="condition">Nhóm theo tình trạng</option>
          </select>
          <select id="an-metric" style="width:210px">
            <option value="original">Theo nguyên giá</option>
            <option value="book">Theo giá trị còn lại</option>
            <option value="count">Theo số lượng</option>
            <option value="accumulated">Theo hao mòn</option>
          </select>
          <button class="btn" id="an-export">⬇ Xuất CSV</button>
        </div>
      </div>
      <div id="an-body"><div class="page-loading"><div class="spinner"></div> Đang phân tích…</div></div>`;

    const load = async () => {
      const groupBy = document.getElementById('an-group').value;
      const metric = document.getElementById('an-metric').value;
      const res = await API.get(`/api/dashboard/analytics?groupBy=${groupBy}&metric=${metric}`);
      const rows = res.data || [];
      const total = rows.reduce((s, r) => s + Number(r[metric] || 0), 0);
      document.getElementById('an-body').innerHTML = `
        <div class="grid cols-3 mb">
          <div class="card"><div class="card-body">
            <div class="muted tiny">Tổng theo tiêu chí đã chọn</div>
            <div style="font-size:22px;font-weight:700">${metric === 'count' ? U.num(total) : U.money(total)}</div>
            <div class="tiny muted">${rows.length} nhóm</div>
          </div></div>
          <div class="card" style="grid-column:span 2"><div class="card-body">
            ${Charts.stackedBar(rows.slice(0, 12).map((r, i) => ({ label: r.key, value: Number(r[metric]) || 0, color: App.PALETTE[i % App.PALETTE.length] })))}
          </div></div>
        </div>
        <div class="card mb"><div class="card-body">${Charts.vBar(rows.slice(0, 14).map((r, i) => ({ label: r.key.slice(0, 14), value: r[metric], color: App.PALETTE[i % App.PALETTE.length] })), { format: metric === 'count' ? 'number' : 'money', height: 250 })}</div></div>
        <div class="card">
          <div class="card-head"><h3>Bảng số liệu chi tiết</h3></div>
          <div class="table-wrap"><table class="data compact">
            <thead><tr><th>Nhóm</th><th class="num">Số tài sản</th><th class="num">Nguyên giá</th><th class="num">Hao mòn luỹ kế</th><th class="num">Giá trị còn lại</th><th class="num">Bình quân/TS</th><th class="num">% nguyên giá</th></tr></thead>
            <tbody>${rows.map((r) => `<tr>
              <td><b>${U.esc(r.key)}</b></td>
              <td class="num">${U.num(r.count)}</td>
              <td class="num">${U.money(r.original)}</td>
              <td class="num">${U.money(r.accumulated)}</td>
              <td class="num">${U.money(r.book)}</td>
              <td class="num">${U.money(r.avg)}</td>
              <td class="num">${U.pct(total && metric === 'original' ? (r.original / total) * 100 : (r.original / Math.max(1, rows.reduce((s, x) => s + x.original, 0))) * 100, 1)}</td>
            </tr>`).join('')}</tbody>
            <tfoot><tr style="font-weight:700;background:var(--bg-muted)">
              <td>TỔNG CỘNG</td><td class="num">${U.num(rows.reduce((s, r) => s + r.count, 0))}</td>
              <td class="num">${U.money(rows.reduce((s, r) => s + r.original, 0))}</td>
              <td class="num">${U.money(rows.reduce((s, r) => s + r.accumulated, 0))}</td>
              <td class="num">${U.money(rows.reduce((s, r) => s + r.book, 0))}</td><td></td><td></td></tr></tfoot>
          </table></div>
        </div>`;
    };
    document.getElementById('an-group').onchange = load;
    document.getElementById('an-metric').onchange = load;
    document.getElementById('an-export').onclick = () => {
      const groupBy = document.getElementById('an-group').value;
      API.get(`/api/dashboard/analytics?groupBy=${groupBy}&metric=original`).then((res) => {
        const rows = res.data || [];
        const csv = '\ufeff' + ['Nhóm,Số tài sản,Nguyên giá,Hao mòn luỹ kế,Giá trị còn lại,Bình quân']
          .concat(rows.map((r) => `"${r.key}",${r.count},${r.original},${r.accumulated},${r.book},${r.avg}`)).join('\n');
        U.download(`phan-tich-${groupBy}-${U.today()}.csv`, csv, 'text/csv;charset=utf-8');
        UI.toast('Đã xuất CSV', '', 'success');
      });
    };
    await load();
  };
})();
