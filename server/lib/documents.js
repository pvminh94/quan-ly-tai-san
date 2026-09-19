'use strict';
/**
 * documents.js — Sinh chứng từ in phía server (HTML chuẩn in ấn A4)
 * Gồm: biên bản bàn giao, phiếu điều chuyển, phiếu bảo trì, biên bản thanh lý,
 *       biên bản kiểm kê, phiếu bảo hành, bảng khấu hao, nhãn dán (label).
 */

const store = require('./store');
const service = require('./service');
const util = require('./util');
const formatValue = require('./report-engine').formatValue;

const esc = util.escapeHtml;

function money(v) {
  return formatValue(v, 'money', 0, { currencySymbol: ' VNĐ', digits: 0 });
}

function date(v) {
  return formatValue(v, 'date');
}

function header(cfg, title, code, dateStr) {
  const c = cfg.company;
  return `
  <div class="doc-head">
    <div class="left">
      <div class="company">${esc(c.name)}</div>
      <div class="muted">Địa chỉ: ${esc(c.address)}</div>
      <div class="muted">Điện thoại: ${esc(c.phone)} • MST: ${esc(c.taxCode)}</div>
    </div>
    <div class="right">
      <div class="muted">Mẫu số: ${esc(code)}</div>
      <div class="muted">Ngày in: ${date(new Date().toISOString())}</div>
    </div>
  </div>
  <h1 class="doc-title">${esc(title)}</h1>
  ${dateStr ? `<div class="doc-sub">Ngày ${date(dateStr)}</div>` : ''}`;
}

function signatures(cfg, labels, people) {
  const items = labels.map((l, i) => `<div class="sig"><div class="sig-title">${esc(l)}</div><div class="sig-hint">(Ký, họ tên)</div><div class="sig-name">${esc((people && people[i]) || '')}</div></div>`);
  return `<div class="signatures">${items.join('')}</div>`;
}

function infoTable(rows) {
  return `<table class="info"><tbody>${rows
    .filter(Boolean)
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`)
    .join('')}</tbody></table>`;
}

function wrap(cfg, title, body, opts) {
  const o = opts || {};
  return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"/>
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Times New Roman", "Inter", serif; font-size: 13pt; color:#0f172a; margin:0; background:#e2e8f0; }
  .toolbar { position:fixed; inset:0 0 auto 0; height:46px; background:#0f172a; color:#fff; display:flex; align-items:center; gap:10px; padding:0 16px; font-family:"Inter",Arial,sans-serif; font-size:13px; z-index:9; }
  .toolbar button, .toolbar a { background:#2563eb; color:#fff; border:0; padding:7px 14px; border-radius:6px; cursor:pointer; text-decoration:none; font-size:13px; }
  .toolbar a.secondary { background:#334155; }
  .sheet { width:210mm; min-height:297mm; padding:18mm 16mm; background:#fff; margin:16px auto; box-shadow:0 2px 12px rgba(15,23,42,.2); }
  .doc-head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #1e3a8a; padding-bottom:8px; }
  .company { font-weight:700; font-size:13pt; color:#1e3a8a; text-transform:uppercase; }
  .muted { color:#475569; font-size:10pt; font-family:"Inter",Arial,sans-serif; }
  .doc-title { text-align:center; font-size:20pt; margin:18px 0 4px; text-transform:uppercase; letter-spacing:.5px; }
  .doc-sub { text-align:center; font-style:italic; margin-bottom:16px; font-size:11pt; }
  table { width:100%; border-collapse:collapse; }
  table.info { margin:10px 0 16px; font-family:"Inter",Arial,sans-serif; font-size:10.5pt; }
  table.info th { width:34%; text-align:left; padding:6px 8px; background:#f1f5f9; border:1px solid #cbd5e1; font-weight:600; }
  table.info td { padding:6px 8px; border:1px solid #cbd5e1; }
  table.data { font-family:"Inter",Arial,sans-serif; font-size:10pt; margin:12px 0; }
  table.data th { background:#dbeafe; border:1px solid #94a3b8; padding:6px 8px; text-align:center; }
  table.data td { border:1px solid #cbd5e1; padding:6px 8px; vertical-align:top; }
  table.data td.num { text-align:right; }
  table.data td.ctr { text-align:center; }
  table.data tfoot td { font-weight:700; background:#f8fafc; }
  .section { margin:18px 0 8px; font-weight:700; font-size:11pt; font-family:"Inter",Arial,sans-serif; text-transform:uppercase; color:#1e293b; border-left:4px solid #2563eb; padding-left:8px; }
  .signatures { display:flex; gap:12px; margin-top:36px; text-align:center; font-family:"Inter",Arial,sans-serif; }
  .sig { flex:1; }
  .sig-title { font-weight:700; font-size:10.5pt; }
  .sig-hint { font-style:italic; font-size:9pt; color:#64748b; margin-bottom:64px; }
  .sig-name { font-size:10.5pt; border-top:1px dashed #94a3b8; padding-top:4px; }
  .note { font-family:"Inter",Arial,sans-serif; font-size:10pt; color:#334155; }
  @media print {
    body { background:#fff; }
    .toolbar { display:none; }
    .sheet { margin:0; box-shadow:none; width:auto; min-height:auto; padding:0; }
    @page { size:A4 portrait; margin:14mm 14mm; }
  }
</style></head>
<body>
<div class="toolbar">
  <strong>${esc(title)}</strong>
  <div style="flex:1"></div>
  <button onclick="window.print()">🖨 In / Lưu PDF</button>
  <a class="secondary" href="javascript:window.close()">Đóng</a>
</div>
<div class="sheet">${body}</div>
${o.autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>' : ''}
</body></html>`;
}

/* ---------------------------- Chứng từ cụ thể ---------------------------- */

function assignmentDoc(id, ctx) {
  const rec = store.find('assignments', id);
  if (!rec) return null;
  const d = service.decorate('assignments', rec);
  const asset = store.find('assets', rec.assetId);
  const da = service.decorateAsset(asset);
  const isRecover = rec.type === 'recover' || rec.type === 'return';
  const title = isRecover ? 'BIÊN BẢN THU HỒI TÀI SẢN' : 'BIÊN BẢN BÀN GIAO TÀI SẢN';
  const body = `
  ${header(ctx.settings, title, '01-VT/BBBG', d.date)}
  <p class="note">Hôm nay, ngày ${date(d.date)}, tại ${esc(ctx.settings.company.name)}, chúng tôi gồm:</p>
  <table class="data">
    <thead><tr><th style="width:60px">Bên</th><th>Họ và tên</th><th>Chức vụ / Bộ phận</th><th>Đại diện</th></tr></thead>
    <tbody>
      <tr><td class="ctr">Giao</td><td>${esc(d.fromUserName || ctx.settings.company.representative)}</td><td>${esc(store.find('users', rec.fromUserId) ? (store.find('users', rec.fromUserId).position || '') : 'Bộ phận quản lý tài sản')}</td><td>Bên giao tài sản</td></tr>
      <tr><td class="ctr">Nhận</td><td>${esc(d.toUserName || '')}</td><td>${esc(d.departmentName || '')}</td><td>Bên nhận tài sản</td></tr>
    </tbody>
  </table>
  <div class="section">Nội dung bàn giao</div>
  <table class="data">
    <thead><tr><th style="width:40px">STT</th><th>Mã tài sản</th><th>Tên tài sản</th><th>Model / Serial</th><th>ĐVT</th><th>SL</th><th>Tình trạng</th><th>Nguyên giá</th></tr></thead>
    <tbody>
      <tr>
        <td class="ctr">1</td><td class="ctr">${esc(d.assetCode)}</td><td>${esc(d.assetName)}</td>
        <td>${esc(da.model || '')} ${da.serial ? '/ ' + esc(da.serial) : ''}</td>
        <td class="ctr">${esc(da.unit || '')}</td><td class="ctr">${da.quantity || 1}</td>
        <td class="ctr">${esc((['new','good','fair','poor','broken'].includes(rec.conditionAtHandover) ? { new:'Mới', good:'Tốt', fair:'Khá', poor:'Kém', broken:'Hỏng' }[rec.conditionAtHandover] : '') || '')}</td>
        <td class="num">${money(da.originalCost)}</td>
      </tr>
    </tbody>
  </table>
  ${infoTable([
    ['Phụ kiện kèm theo', esc(rec.accessories || 'Không')],
    ['Mục đích sử dụng', esc(rec.purpose || '')],
    ['Vị trí đặt tài sản', esc(service.nameOf('locations', rec.locationId) || da.locationName || '')],
    ['Thời hạn / Ngày dự kiến thu hồi', rec.expectedReturnDate ? date(rec.expectedReturnDate) : 'Không thời hạn'],
    ['Ghi chú', esc(rec.note || '')],
  ])}
  <p class="note">Hai bên đã kiểm tra, xác nhận tình trạng tài sản như trên. Biên bản được lập thành 02 (hai) bản, mỗi bên giữ 01 bản có giá trị pháp lý như nhau.</p>
  ${signatures(ctx.settings, ['Người giao tài sản', 'Người nhận tài sản', 'Trưởng bộ phận / Giám đốc'], [rec.signatureGiver || d.fromUserName, rec.signatureReceiver || d.toUserName, rec.signatureManager || ctx.settings.company.representative])}
  <div style="text-align:right;font-family:Inter,Arial;font-size:9pt;color:#64748b;margin-top:24px">Mã phiếu: ${esc(d.code)}</div>`;
  return wrap(ctx.settings, title, body);
}

function transferDoc(id, ctx) {
  const rec = store.find('transfers', id);
  if (!rec) return null;
  const d = service.decorate('transfers', rec);
  const asset = service.decorateAsset(store.find('assets', rec.assetId));
  const title = 'PHIẾU ĐIỀU CHUYỂN TÀI SẢN';
  const body = `
  ${header(ctx.settings, title, '02-VT/PDC', d.date)}
  ${infoTable([
    ['Số phiếu', `<strong>${esc(d.code)}</strong>`],
    ['Tài sản', `<strong>${esc(d.assetName)}</strong> (${esc(d.assetCode)})`],
    ['Danh mục', esc(asset.categoryName)],
    ['Nguyên giá', money(asset.originalCost)],
    ['Giá trị còn lại', money(asset.bookValue)],
  ])}
  <div class="section">Nội dung điều chuyển</div>
  <table class="data">
    <thead><tr><th>Tiêu chí</th><th>Từ (bàn giao)</th><th>Đến (tiếp nhận)</th></tr></thead>
    <tbody>
      <tr><td>Phòng ban</td><td>${esc(d.fromDepartmentName || '—')}</td><td><strong>${esc(d.toDepartmentName || '—')}</strong></td></tr>
      <tr><td>Người sử dụng</td><td>${esc(d.fromUserName || '—')}</td><td><strong>${esc(d.toUserName || '—')}</strong></td></tr>
      <tr><td>Vị trí</td><td>${esc(d.fromLocationName || '—')}</td><td><strong>${esc(d.toLocationName || '—')}</strong></td></tr>
    </tbody>
  </table>
  ${infoTable([
    ['Lý do điều chuyển', esc(rec.reason || '')],
    ['Chi phí vận chuyển', money(rec.transportCost)],
    ['Người đề nghị', esc(d.requestedByName || '')],
    ['Trạng thái', esc(({ draft:'Nháp', pending:'Chờ duyệt', approved:'Đã duyệt', completed:'Hoàn thành', rejected:'Từ chối', cancelled:'Đã huỷ' }[rec.status] || rec.status))],
  ])}
  <p class="note">Các bên có trách nhiệm bàn giao đầy đủ tài sản, phụ kiện kèm theo và cập nhật sổ theo dõi tài sản theo quy định.</p>
  ${signatures(ctx.settings, ['Người đề nghị', 'Người giao', 'Người nhận', 'Giám đốc duyệt'], [d.requestedByName, d.fromUserName, d.toUserName, d.approvedByName || ctx.settings.company.representative])}`;
  return wrap(ctx.settings, title, body);
}

function maintenanceDoc(id, ctx) {
  const rec = store.find('maintenances', id);
  if (!rec) return null;
  const d = service.decorate('maintenances', rec);
  const asset = service.decorateAsset(store.find('assets', rec.assetId));
  const title = 'PHIẾU YÊU CẦU BẢO TRÌ - SỬA CHỮA';
  const body = `
  ${header(ctx.settings, title, '03-VT/PBT', d.plannedDate || d.actualDate)}
  ${infoTable([
    ['Số phiếu', `<strong>${esc(d.code)}</strong>`],
    ['Tài sản', `${esc(d.assetName)} (${esc(d.assetCode)})`],
    ['Model / Serial', `${esc(asset.model || '')} / ${esc(asset.serial || '')}`],
    ['Vị trí', esc(asset.locationName)],
    ['Phòng ban quản lý', esc(asset.departmentName)],
    ['Loại bảo trì', esc(({ preventive:'Bảo trì định kỳ', corrective:'Sửa chữa khắc phục', inspection:'Kiểm tra/Hiệu chuẩn', upgrade:'Nâng cấp', calibration:'Hiệu chỉnh' }[rec.type] || ''))],
    ['Mức độ ưu tiên', esc(({ low:'Thấp', normal:'Bình thường', high:'Cao', urgent:'Khẩn cấp' }[rec.priority] || ''))],
    ['Ngày báo hỏng', rec.reportedDate ? date(rec.reportedDate) : ''],
    ['Ngày dự kiến thực hiện', rec.plannedDate ? date(rec.plannedDate) : ''],
    ['Ngày hoàn thành', rec.actualDate ? date(rec.actualDate) : 'Chưa hoàn thành'],
    ['Đơn vị thực hiện', esc(d.vendorName || 'Nội bộ')],
    ['Kỹ thuật viên', esc(rec.technician || '')],
    ['Thời gian dừng máy', (rec.downtimeHours || 0) + ' giờ'],
  ])}
  <div class="section">Mô tả hiện trạng &amp; phương án xử lý</div>
  <p class="note"><strong>Hiện tượng:</strong> ${esc(rec.description || '')}</p>
  <p class="note"><strong>Phương án:</strong> ${esc(rec.solution || '')}</p>
  <p class="note"><strong>Kết quả:</strong> ${esc(rec.result || '')}</p>
  <div class="section">Chi phí</div>
  <table class="data">
    <thead><tr><th>Khoản mục</th><th>Số tiền (VNĐ)</th><th>Ghi chú</th></tr></thead>
    <tbody>
      <tr><td>Chi phí công / dịch vụ</td><td class="num">${money(rec.cost)}</td><td>${rec.warrantyClaim ? 'Trong thời hạn bảo hành' : ''}</td></tr>
      <tr><td>Chi phí vật tư thay thế</td><td class="num">${money(rec.partsCost)}</td><td></td></tr>
    </tbody>
    <tfoot><tr><td>TỔNG CỘNG</td><td class="num">${money((rec.cost || 0) + (rec.partsCost || 0))}</td><td></td></tr></tfoot>
  </table>
  ${signatures(ctx.settings, ['Người báo hỏng', 'Kỹ thuật viên', 'Trưởng bộ phận KT', 'Giám đốc'], ['', rec.technician || '', '', ctx.settings.company.representative])}`;
  return wrap(ctx.settings, title, body);
}

function disposalDoc(id, ctx) {
  const rec = store.find('disposals', id);
  if (!rec) return null;
  const d = service.decorate('disposals', rec);
  const title = 'BIÊN BẢN THANH LÝ TÀI SẢN';
  const body = `
  ${header(ctx.settings, title, '04-VT/BBTL', d.date)}
  <p class="note">Hôm nay, ngày ${date(d.date)}, Hội đồng thanh lý tài sản gồm các thành viên có tên sau đây tiến hành thanh lý các tài sản không còn khả năng sử dụng / hết thời hạn khấu hao:</p>
  <table class="data">
    <thead><tr><th style="width:50px">STT</th><th>Họ và tên</th><th>Chức vụ</th><th>Vai trò trong hội đồng</th></tr></thead>
    <tbody>
      ${(Array.isArray(rec.council) && rec.council.length ? rec.council : [ctx.settings.company.representative, ctx.settings.company.accountant]).map((m, i) => `<tr><td class="ctr">${i + 1}</td><td>${esc(m)}</td><td></td><td>${i === 0 ? 'Chủ tịch hội đồng' : 'Thành viên'}</td></tr>`).join('')}
    </tbody>
  </table>
  <div class="section">Tài sản thanh lý</div>
  <table class="data">
    <thead><tr><th style="width:40px">STT</th><th>Mã tài sản</th><th>Tên tài sản</th><th>Nguyên giá</th><th>Hao mòn luỹ kế</th><th>Giá trị còn lại</th><th>Giá trị thanh lý</th></tr></thead>
    <tbody>
      <tr><td class="ctr">1</td><td class="ctr">${esc(d.assetCode)}</td><td>${esc(d.assetName)}</td>
      <td class="num">${money(rec.originalCost)}</td><td class="num">${money(rec.accumulated)}</td>
      <td class="num">${money(rec.bookValue)}</td><td class="num">${money(rec.salePrice)}</td></tr>
    </tbody>
    <tfoot>
      <tr><td colspan="3">TỔNG CỘNG</td><td class="num">${money(rec.originalCost)}</td><td class="num">${money(rec.accumulated)}</td><td class="num">${money(rec.bookValue)}</td><td class="num">${money(rec.salePrice)}</td></tr>
      <tr><td colspan="6">Chênh lệch (lãi/lỗ) thanh lý</td><td class="num">${money(d.profitLoss)}</td></tr>
    </tfoot>
  </table>
  ${infoTable([
    ['Hình thức thanh lý', esc(({ sale:'Bán thanh lý', scrap:'Bán phế liệu', donate:'Tặng/Cho', destroy:'Tiêu huỷ', writeoff:'Ghi giảm/Xoá sổ' }[rec.type] || ''))],
    ['Lý do thanh lý', esc(rec.reason || '')],
    ['Người/Đơn vị mua', esc(rec.buyerName || '')],
    ['MST người mua', esc(rec.buyerTaxCode || '')],
    ['Số hoá đơn', esc(rec.invoiceNo || '')],
    ['Chi phí thanh lý', money(rec.disposalCost)],
  ])}
  <p class="note">Hội đồng thống nhất thanh lý tài sản nêu trên và đề nghị bộ phận kế toán ghi giảm tài sản, hạch toán thu nhập/chi phí theo quy định hiện hành.</p>
  ${signatures(ctx.settings, ['Chủ tịch hội đồng', 'Uỷ viên', 'Kế toán', 'Giám đốc'], [(Array.isArray(rec.council) && rec.council[0]) || ctx.settings.company.representative, (Array.isArray(rec.council) && rec.council[1]) || '', ctx.settings.company.accountant, ctx.settings.company.representative])}`;
  return wrap(ctx.settings, title, body);
}

function stocktakeDoc(id, ctx) {
  const rec = store.find('stocktakes', id);
  if (!rec) return null;
  const d = service.decorate('stocktakes', rec);
  const items = store.filter('stocktake_items', (i) => String(i.stocktakeId) === String(rec.id)).map((i) => service.decorate('stocktake_items', i));
  const title = 'BIÊN BẢN KIỂM KÊ TÀI SẢN';
  const body = `
  ${header(ctx.settings, title, '05-VT/BBKK', d.endDate || d.startDate)}
  ${infoTable([
    ['Tên đợt kiểm kê', `<strong>${esc(rec.name)}</strong>`],
    ['Số đợt', esc(d.code)],
    ['Phạm vi', esc(({ all:'Toàn công ty', department:'Theo phòng ban', location:'Theo vị trí', category:'Theo danh mục' }[rec.scope] || '')) + (d.departmentName ? ' — ' + esc(d.departmentName) : '') + (d.locationName ? ' — ' + esc(d.locationName) : '')],
    ['Thời gian', `${rec.startDate ? date(rec.startDate) : ''} - ${rec.endDate ? date(rec.endDate) : ''}`],
    ['Trưởng ban kiểm kê', esc(d.leaderName || '')],
    ['Thành viên', esc((Array.isArray(rec.members) ? rec.members.join(', ') : rec.members) || '')],
    ['Kết quả', `${d.countedItems}/${d.totalItems} tài sản đã kiểm kê • ${d.diffItems} chênh lệch`],
  ])}
  <div class="section">Chi tiết kết quả kiểm kê</div>
  <table class="data">
    <thead><tr><th style="width:40px">STT</th><th>Mã tài sản</th><th>Tên tài sản</th><th>Vị trí sổ sách</th><th>Vị trí thực tế</th><th>Người sử dụng</th><th>Kết quả</th><th>Tình trạng</th></tr></thead>
    <tbody>
      ${items
        .map(
          (i, idx) => `<tr><td class="ctr">${idx + 1}</td><td class="ctr">${esc(i.assetCode)}</td><td>${esc(i.assetName)}</td>
          <td>${esc(i.expectedLocationName || '')}</td><td>${esc(i.locationName || '')}</td><td>${esc(i.assigneeName || '')}</td>
          <td class="ctr">${esc(({ match:'Khớp', missing:'Không tìm thấy', extra:'Phát hiện thêm', wrong_location:'Sai vị trí', damaged:'Hư hỏng' }[i.result] || ''))}</td>
          <td class="ctr">${esc(i.conditionLabel || '')}</td></tr>`
        )
        .join('')}
      ${items.length ? '' : '<tr><td colspan="8" class="ctr">Chưa có dòng kiểm kê</td></tr>'}
    </tbody>
    <tfoot><tr><td colspan="6">TỔNG CỘNG: ${items.length} tài sản — Khớp: ${items.filter((i) => i.result === 'match').length} — Chênh lệch: ${items.filter((i) => i.result && i.result !== 'match').length}</td><td colspan="2"></td></tr></tfoot>
  </table>
  <p class="note">Ban kiểm kê xác nhận số liệu trên là đúng với thực tế kiểm tra tại thời điểm lập biên bản. Các trường hợp chênh lệch đã được ghi nhận và đề xuất xử lý theo quy định.</p>
  ${signatures(ctx.settings, ['Trưởng ban kiểm kê', 'Thành viên', 'Kế toán', 'Giám đốc'], [d.leaderName, (Array.isArray(rec.members) && rec.members[0]) || '', ctx.settings.company.accountant, ctx.settings.company.representative])}`;
  return wrap(ctx.settings, title, body);
}

function warrantyDoc(id, ctx) {
  const rec = store.find('warranties', id);
  if (!rec) return null;
  const d = service.decorate('warranties', rec);
  const title = 'PHIẾU YÊU CẦU BẢO HÀNH';
  const body = `
  ${header(ctx.settings, title, '06-VT/PBH', d.claimDate || d.startDate)}
  ${infoTable([
    ['Số phiếu', esc(d.code)],
    ['Tài sản', `${esc(d.assetName)} (${esc(d.assetCode)})`],
    ['Đơn vị bảo hành', esc(rec.provider || d.supplierName || '')],
    ['Thời hạn bảo hành', `${date(rec.startDate)} - ${date(rec.endDate)} (còn ${d.remainingDays} ngày)`],
    ['Phạm vi bảo hành', esc(rec.coverage || '')],
    ['Sự cố / Yêu cầu', esc(rec.issue || '')],
    ['Ngày yêu cầu', rec.claimDate ? date(rec.claimDate) : ''],
    ['Số lần yêu cầu trước đó', String(rec.claimCount || 0)],
  ])}
  <div class="section">Kết quả xử lý</div>
  <p class="note">${esc(rec.resolution || 'Chưa xử lý')}</p>
  ${infoTable([['Ngày hoàn tất', rec.resolvedDate ? date(rec.resolvedDate) : ''], ['Chi phí phát sinh', money(rec.cost)]])}
  ${signatures(ctx.settings, ['Người yêu cầu', 'Đại diện đơn vị bảo hành', 'Xác nhận của công ty'], ['', '', ctx.settings.company.representative])}`;
  return wrap(ctx.settings, title, body);
}

function assetLabelDoc(id, ctx) {
  const asset = service.decorateAsset(store.find('assets', id));
  if (!asset) return null;
  const title = 'NHÃN TÀI SẢN';
  const body = `
  <div style="display:flex;flex-wrap:wrap;gap:8px">
  ${Array.from({ length: 8 })
    .map(
      () => `
  <div style="width:88mm;border:2px solid #0f172a;border-radius:8px;padding:10px;font-family:Inter,Arial;margin-bottom:8px">
    <div style="font-weight:700;font-size:12pt;text-transform:uppercase;border-bottom:1px solid #94a3b8;padding-bottom:4px;margin-bottom:6px">${esc(ctx.settings.company.shortName || ctx.settings.company.name)}</div>
    <div style="font-size:9pt;color:#334155">Mã tài sản</div>
    <div style="font-weight:700;font-size:15pt;letter-spacing:1px">${esc(asset.code)}</div>
    <div style="font-size:11pt;margin:4px 0;font-weight:600">${esc(asset.name)}</div>
    <div style="font-size:8.5pt;color:#475569">Danh mục: ${esc(asset.categoryName)}</div>
    <div style="font-size:8.5pt;color:#475569">Bộ phận: ${esc(asset.departmentName || '—')}</div>
    <div style="font-size:8.5pt;color:#475569">Người sử dụng: ${esc(asset.assigneeName || '—')}</div>
    <div style="margin-top:6px;font-size:8pt;color:#64748b">Ngày mua: ${date(asset.purchaseDate)} • BH đến ${date(asset.warrantyEnd)}</div>
  </div>`
    )
    .join('')}
  </div>`;
  return wrap(ctx.settings, title, body, { autoPrint: false });
}

function depreciationDoc(id, ctx) {
  const assetId = id;
  const asset = store.find('assets', assetId);
  if (!asset) return null;
  const rows = store.filter('depreciations', (d) => String(d.assetId) === String(assetId) && !d.isDeleted).sort((a, b) => String(a.period).localeCompare(String(b.period)));
  const dec = service.decorateAsset(asset);
  const title = 'BẢNG TÍNH KHẤU HAO TÀI SẢN';
  const body = `
  ${header(ctx.settings, title, '07-VT/BKH', new Date().toISOString())}
  ${infoTable([
    ['Tài sản', `${esc(asset.name)} (${esc(asset.code)})`],
    ['Danh mục', esc(dec.categoryName)],
    ['Nguyên giá', money(dec.originalCost)],
    ['Phương pháp khấu hao', esc(({ straight_line:'Đường thẳng', declining_balance:'Số dư giảm dần', double_declining:'Số dư giảm dần kép', sum_of_years:'Tổng số năm', productive:'Theo sản lượng', none:'Không khấu hao' }[asset.depreciationMethod] || ''))],
    ['Thời gian sử dụng', (asset.usefulLife || 0) + ' tháng'],
    ['Bắt đầu tính khấu hao', date(asset.depreciationStart || asset.purchaseDate)],
    ['Mức khấu hao/tháng', money(dec.monthlyDepreciation)],
    ['Hao mòn luỹ kế', money(dec.accumulatedDepreciation)],
    ['Giá trị còn lại', money(dec.bookValue)],
  ])}
  <div class="section">Bảng khấu hao theo kỳ</div>
  <table class="data">
    <thead><tr><th style="width:40px">STT</th><th>Kỳ</th><th>Giá trị đầu kỳ</th><th>Khấu hao trong kỳ</th><th>Hao mòn luỹ kế</th><th>Giá trị còn lại</th><th>TK Nợ</th><th>TK Có</th></tr></thead>
    <tbody>
      ${rows
        .map(
          (r, i) => `<tr><td class="ctr">${i + 1}</td><td class="ctr">${esc(r.period)}</td><td class="num">${money(r.openingValue)}</td><td class="num">${money(r.depreciationAmount)}</td><td class="num">${money(r.accumulated)}</td><td class="num">${money(r.closingValue)}</td><td class="ctr">${esc(r.expenseAccount || '')}</td><td class="ctr">${esc(r.assetAccount || '')}</td></tr>`
        )
        .join('')}
    </tbody>
    <tfoot><tr><td colspan="3">TỔNG KHẤU HAO ĐÃ GHI SỔ</td><td class="num">${money(rows.reduce((s, r) => s + Number(r.depreciationAmount || 0), 0))}</td><td colspan="4"></td></tr></tfoot>
  </table>
  ${signatures(ctx.settings, ['Người lập biểu', 'Kế toán trưởng', 'Giám đốc'], ['', ctx.settings.company.accountant, ctx.settings.company.representative])}`;
  return wrap(ctx.settings, title, body);
}

function contractDoc(id, ctx) {
  const rec = store.find('contracts', id);
  if (!rec) return null;
  const d = service.decorate('contracts', rec);
  const assets = store.filter('assets', (a) => String(a.contractId) === String(rec.id)).map((a) => service.decorateAsset(a));
  const title = 'BẢNG KÊ TÀI SẢN THEO HỢP ĐỒNG';
  const body = `
  ${header(ctx.settings, title, '08-VT/BKHĐ', rec.signDate)}
  ${infoTable([
    ['Hợp đồng', `${esc(rec.name)} (${esc(d.code)})`],
    ['Đối tác', esc(d.supplierName)],
    ['Loại hợp đồng', esc(({ purchase:'Mua sắm', lease_in:'Thuê vào', lease_out:'Cho thuê', service:'Dịch vụ', insurance:'Bảo hiểm', construction:'Thi công' }[rec.type] || ''))],
    ['Giá trị hợp đồng', money(rec.value) + ' ' + esc(rec.currency || 'VND')],
    ['Hiệu lực', `${date(rec.startDate)} - ${date(rec.endDate)}`],
    ['Điều khoản thanh toán', esc(rec.paymentTerms || '')],
  ])}
  <div class="section">Tài sản thuộc hợp đồng</div>
  <table class="data">
    <thead><tr><th style="width:40px">STT</th><th>Mã</th><th>Tên tài sản</th><th>Ngày mua</th><th>Nguyên giá</th><th>Giá trị còn lại</th><th>Trạng thái</th></tr></thead>
    <tbody>
      ${assets
        .map(
          (a, i) => `<tr><td class="ctr">${i + 1}</td><td class="ctr">${esc(a.code)}</td><td>${esc(a.name)}</td><td class="ctr">${date(a.purchaseDate)}</td>
          <td class="num">${money(a.originalCost)}</td><td class="num">${money(a.bookValue)}</td><td class="ctr">${esc(({ in_stock:'Trong kho', in_use:'Đang sử dụng', maintenance:'Bảo trì', disposed:'Đã thanh lý' }[a.status] || a.status))}</td></tr>`
        )
        .join('')}
      ${assets.length ? '' : '<tr><td colspan="7" class="ctr">Chưa có tài sản nào gắn với hợp đồng này</td></tr>'}
    </tbody>
    <tfoot><tr><td colspan="4">TỔNG CỘNG</td><td class="num">${money(assets.reduce((s, a) => s + Number(a.originalCost || 0), 0))}</td><td class="num">${money(assets.reduce((s, a) => s + Number(a.bookValue || 0), 0))}</td><td></td></tr></tfoot>
  </table>
  ${signatures(ctx.settings, ['Người lập bảng kê', 'Kế toán trưởng', 'Giám đốc'], ['', ctx.settings.company.accountant, ctx.settings.company.representative])}`;
  return wrap(ctx.settings, title, body);
}

const HANDLERS = {
  assignment: assignmentDoc,
  transfer: transferDoc,
  maintenance: maintenanceDoc,
  disposal: disposalDoc,
  stocktake: stocktakeDoc,
  warranty: warrantyDoc,
  label: assetLabelDoc,
  depreciation: depreciationDoc,
  contract: contractDoc,
};

function render(type, id, options) {
  const ctx = options || {};
  const handler = HANDLERS[type];
  if (!handler) return null;
  return handler(id, ctx);
}

module.exports = { render, HANDLERS };
