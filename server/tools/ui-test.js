'use strict';
/**
 * ui-test.js — Kiểm thử giao diện SPA bằng DOM thật (jsdom).
 * ---------------------------------------------------------------------------
 * Mở trang web bằng jsdom, đăng nhập, duyệt toàn bộ 34 đường dẫn của ứng dụng,
 * bắt mọi lỗi JavaScript và kiểm tra nội dung render (KPI, biểu đồ, biểu mẫu,
 * Trình thiết kế báo cáo…).
 *
 * Cách dùng:
 *   npm start                       # ở cửa sổ khác
 *   npx --yes jsdom-provider?  ->   npm install --no-save jsdom
 *   node server/tools/ui-test.js [cổng]
 */
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch (e) {
  console.error('\n\u001b[33m  Cần cài jsdom để chạy kiểm thử giao diện:\u001b[0m');
  console.error('    npm install --no-save jsdom     (chỉ dùng cho kiểm thử, ứng dụng không phụ thuộc)\n');
  process.exit(3);
}
const http = require('http');

const jsdomErrors = [];
process.on('uncaughtException', (e) => { jsdomErrors.push(String(e && e.stack || e)); });
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { const m = String(e && (e.detail || e.message) || e); if (!/Not implemented/.test(m)) jsdomErrors.push(m); });
vc.on('error', (...a) => { const m = a.map(String).join(' '); if (!/Not implemented/.test(m)) jsdomErrors.push(m); });

const PORT = Number((process.argv.find((a) => /^\d+$/.test(a))) || 3000);
const BASE = 'http://127.0.0.1:' + PORT;

let cookieJar = {};
function cookieHeader() {
  return Object.keys(cookieJar).map((k) => k + '=' + cookieJar[k]).join('; ');
}
function storeCookies(setCookie) {
  (setCookie || []).forEach((c) => {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (value === '' || /Expires=Thu, 01 Jan 1970/i.test(c)) delete cookieJar[name];
    else cookieJar[name] = value;
  });
}

/** fetch giả lập dùng http của Node + jar cookie (jsdom không có fetch) */
function makeFetch(window) {
  return function fetchShim(input, opts) {
    const o = opts || {};
    const url = typeof input === 'string' ? input : input.url;
    const u = new URL(url, BASE);
    return new Promise((resolve, reject) => {
      const headers = Object.assign({}, o.headers || {});
      const jar = cookieHeader();
      if (jar) headers.Cookie = jar;
      let payload = o.body;
      if (payload && typeof payload !== 'string') payload = JSON.stringify(payload);
      if (payload && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
      if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
      const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: o.method || 'GET', headers }, (res) => {
        storeCookies(res.headers['set-cookie']);
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const headerMap = {};
          Object.keys(res.headers).forEach((k) => { headerMap[k.toLowerCase()] = String(res.headers[k]); });
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: { get: (n) => headerMap[String(n).toLowerCase()] || null, has: (n) => headerMap[String(n).toLowerCase()] !== undefined, forEach: (fn) => Object.keys(headerMap).forEach((k) => fn(headerMap[k], k)), raw: res.headers },
            text: () => Promise.resolve(buf.toString('utf8')),
            json: () => Promise.resolve(JSON.parse(buf.toString('utf8'))),
            blob: () => Promise.resolve(new window.Blob([buf])),
          });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  };
}

const errors = [];
const consoleErrors = [];

/** Gọi API bằng chính jar cookie của phiên kiểm thử */
function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = { Accept: 'application/json' };
    const jar = cookieHeader();
    if (jar) headers.Cookie = jar;
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      storeCookies(res.headers['set-cookie']);
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) {}
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const results = [];
let passed = 0;
let failed = 0;
function ok(msg, extra) { passed++; results.push('  \u001b[32m✓\u001b[0m ' + msg + (extra ? ' \u001b[90m' + extra + '\u001b[0m' : '')); }
function bad(msg, extra) { failed++; results.push('  \u001b[31m✗\u001b[0m ' + msg + ' \u001b[31m' + (extra || '') + '\u001b[0m'); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Chờ tới khi điều kiện đúng (thay cho chờ cố định, tránh kiểm thử chập chờn) */
async function waitFor(fn, timeout, step) {
  const t0 = Date.now();
  const limit = timeout || 8000;
  for (;;) {
    let v;
    try { v = fn(); } catch (e) { v = undefined; }
    if (v) return v;
    if (Date.now() - t0 > limit) return null;
    await sleep(step || 200);
  }
}

(async () => {
  console.log('\n\u001b[1m  AMS Pro — Kiểm thử giao diện SPA (jsdom) trên ' + BASE + '\u001b[0m\n');
  const dom = await JSDOM.fromURL(BASE + '/', {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = makeFetch(window);
      window.URL.createObjectURL = () => 'blob:mock';
      window.open = () => ({ document: { write() {}, close() {} }, focus() {}, print() {} });
      window.print = () => {};
      window.addEventListener('error', (e) => errors.push((e.error && e.error.stack) || e.message));
      window.addEventListener('unhandledrejection', (e) => errors.push('Promise: ' + ((e.reason && e.reason.stack) || e.reason)));
      const origErr = window.console.error;
      window.console.error = function (...a) { consoleErrors.push(a.map(String).join(' ')); origErr.apply(window.console, a); };
      window.confirm = () => true;
    },
  });
  const { window } = dom;
  const doc = window.document;

  // ---- chờ SPA nạp xong ----
  await new Promise((resolve) => {
    if (doc.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve);
  });
  await sleep(400);
  if (window.App && window.Pages && window.UI && window.Dash && window.Designer && window.Admin) ok('Nạp đủ 8 mô-đun SPA (App, UI, Pages, Dash, Designer, Admin, Charts)');
  else bad('Thiếu mô-đun SPA', ['App', 'Pages', 'UI', 'Dash', 'Designer', 'Admin'].filter((k) => !window[k]).join(', '));

  const loginVisible = !doc.getElementById('login-screen').classList.contains('hidden');
  if (loginVisible) ok('Hiển thị màn hình đăng nhập khi chưa có phiên');

  // ---- đăng nhập ----
  doc.getElementById('username').value = 'admin';
  doc.getElementById('password').value = 'Admin@123';
  doc.getElementById('login-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 40 && !(window.App && window.App.state.user); i++) await sleep(120);
  if (window.App && window.App.state.user) ok('Đăng nhập & khởi động ứng dụng', window.App.state.user.fullName + ' • ' + window.App.state.user.roleName);
  else bad('Đăng nhập thất bại', (doc.getElementById('login-error') || {}).textContent || '');

  const navItems = doc.querySelectorAll('.nav-item').length;
  if (navItems > 20) ok('Dựng menu điều hướng theo phân quyền', navItems + ' mục');
  else bad('Menu điều hướng quá ít', navItems + ' mục');
  if (doc.getElementById('brand-company').textContent.trim().length > 0) ok('Hiển thị thông tin doanh nghiệp trên thanh bên', doc.getElementById('brand-company').textContent.trim());
  if (doc.getElementById('user-name').textContent.includes('Quản trị') || doc.getElementById('user-name').textContent.length > 3) ok('Thông tin người dùng ở góc phải', doc.getElementById('user-name').textContent);

  // ---- duyệt từng route ----
  const routes = [
    ['#/dashboard', 'Bảng điều khiển'],
    ['#/analytics', 'Phân tích'],
    ['#/assets', 'Tài sản'],
    ['#/assets/1', 'TS-'],
    ['#/assets/1/edit', 'Chỉnh sửa'],
    ['#/categories', 'Danh mục'],
    ['#/locations', 'Vị trí'],
    ['#/departments', 'Phòng ban'],
    ['#/suppliers', 'Nhà cung cấp'],
    ['#/contracts', 'Hợp đồng'],
    ['#/assignments', 'Cấp phát'],
    ['#/transfers', 'Điều chuyển'],
    ['#/maintenances', 'Bảo trì'],
    ['#/depreciations', 'Khấu hao'],
    ['#/stocktakes', 'Kiểm kê'],
    ['#/stocktakes/1/count', 'Kiểm kê'],
    ['#/disposals', 'Thanh lý'],
    ['#/warranties', 'Bảo hành'],
    ['#/attachments', 'Tài liệu'],
    ['#/reports', 'Báo cáo'],
    ['#/reports/library', 'Thư viện'],
    ['#/reports/designer/1', ''],
    ['#/profile', ''],
    ['#/notifications', ''],
    ['#/admin', 'Quản trị'],
    ['#/admin/system', 'Trạng thái'],
    ['#/admin/users', 'Người dùng'],
    ['#/admin/roles', 'Vai trò'],
    ['#/admin/audit', 'Nhật ký'],
    ['#/admin/sessions', 'Phiên'],
    ['#/admin/settings', 'Cấu hình'],
    ['#/admin/backup', 'Sao lưu'],
    ['#/admin/data', 'Công cụ'],
    ['#/scan', 'Quét'],
    ['#/khong-ton-tai-xyz', 'Không tìm thấy trang'],
  ];
  const errBefore = errors.length;
  for (const [hash, expect] of routes) {
    const e0 = errors.length;
    window.location.hash = hash;
    if (hash.includes('designer')) await waitFor(() => doc.querySelector('.designer'), 12000);
    await waitFor(() => {
      const c = doc.getElementById('content');
      return c && c.textContent.trim().length > 0 && !c.querySelector('.page-loading');
    }, hash.includes('designer') ? 12000 : 6000);
    await sleep(250);
    const view = doc.getElementById('content');
    const html = view ? view.innerHTML : '';
    const newErr = errors.slice(e0).concat(jsdomErrors.splice(0));
    if (newErr.length) bad('Route ' + hash, newErr[0].split('\n')[0].slice(0, 160));
    else if (html.length < 200) bad('Route ' + hash, 'nội dung render quá ngắn (' + html.length + ' ký tự)');
    else if (expect && !html.includes(expect)) bad('Route ' + hash, 'không thấy nội dung mong đợi: "' + expect + '"');
    else ok('Route ' + hash, html.length + ' ký tự');
  }
  if (errors.length === errBefore) ok('Không phát sinh lỗi JavaScript khi duyệt toàn bộ phân hệ');

  // ---- tương tác: tìm kiếm nhanh, modal, biểu đồ ----
  const searchInput = doc.getElementById('global-search');
  searchInput.value = 'may';
  searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => { const x = doc.getElementById('search-results'); return x && x.querySelectorAll('.sr-item').length > 0; }, 8000);
  const sr = doc.getElementById('search-results');
  if (sr && !sr.classList.contains('hidden') && sr.querySelectorAll('.sr-item').length) ok('Tìm kiếm nhanh toàn hệ thống', sr.querySelectorAll('.sr-item').length + ' kết quả');
  else bad('Tìm kiếm nhanh không trả kết quả');

  window.location.hash = '#/dashboard';
  await waitFor(() => doc.querySelectorAll('#content svg').length >= 4, 10000);
  const charts = doc.querySelectorAll('#content svg');
  if (charts.length >= 4) ok('Biểu đồ SVG nội bộ render', charts.length + ' biểu đồ');
  else bad('Biểu đồ thiếu', charts.length + ' biểu đồ');
  const kpis = doc.querySelectorAll('#content .kpi, #content .kpi-card, #content .stat-card');
  if (kpis.length >= 4) ok('Thẻ KPI trên bảng điều khiển', kpis.length + ' thẻ');

  // ---- mở form thêm mới tài sản ----
  if (window.App.can('assets', 'create') && window.UI && window.UI.recordDialog) {
    try {
      window.UI.recordDialog('assets', {}, {});
      for (let i = 0; i < 30 && !doc.querySelectorAll('.modal').length; i++) await sleep(150);
      await sleep(700);
      const modals = doc.querySelectorAll('.modal');
      const modal = modals[modals.length - 1];
      if (modal && modal.querySelectorAll('input,select,textarea').length > 10) ok('Mở form thêm tài sản theo metadata', modal.querySelectorAll('input,select,textarea').length + ' trường');
      else bad('Form tài sản thiếu trường');
      const closeBtn = modal.querySelector('.modal-close, [data-close], .icon-btn.x');
      if (closeBtn) closeBtn.click();
      await sleep(200);
    } catch (e) { bad('Form tài sản lỗi', e.message); }
  }

  // ---- trình thiết kế báo cáo ----
  window.location.hash = '#/reports/designer/1';
  const dz = await waitFor(() => doc.querySelector('.designer'), 12000);
  if (dz) {
    ok('Trình thiết kế báo cáo mở được');
    const tools = doc.querySelectorAll('[data-tool]').length;
    if (tools >= 8) ok('Thanh công cụ trình thiết kế', tools + ' công cụ');
    const bands = doc.querySelectorAll('.dz-band').length;
    if (bands >= 6) ok('Khung dải báo cáo (bands)', bands + ' dải');
    const sel = doc.querySelectorAll('.dz-el').length;
    const fieldChips = doc.querySelectorAll('[data-field], .dz-field-item').length;
    if (fieldChips > 20) ok('Danh sách trường dữ liệu của dataset', fieldChips + ' trường');
    const els = doc.querySelectorAll('.dz-el').length;
    if (els > 5) ok('Phần tử thiết kế đã tải từ mẫu báo cáo', els + ' phần tử');
    else bad('Mẫu báo cáo không hiển thị phần tử', els + ' phần tử');
    const ghostRows = doc.querySelectorAll('.dz-ghost-row').length;
    if (ghostRows > 2) ok('Lớp xem trước dữ liệu mẫu (ghost preview)', ghostRows + ' dòng');
    else bad('Ghost preview không hiển thị', ghostRows + ' dòng');
    const bandsDetected = doc.querySelectorAll('.dz-band[data-band]').length;
    ok('Số dải thiết kế hiển thị', bandsDetected + ' dải');
  } else bad('Không mở được trình thiết kế báo cáo');

  // ---- hộp thoại xác nhận (lỗi từng làm mọi thao tác xác nhận bị bỏ qua) ----
  try {
    const pTrue = window.UI.confirm({ title: 'Kiểm thử', message: 'Chọn Đồng ý', confirmText: 'Đồng ý' });
    await sleep(200);
    const m1 = doc.querySelectorAll('.modal');
    m1[m1.length - 1].querySelector('.modal-foot .btn:last-child').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const vTrue = await pTrue;
    if (vTrue === true) ok('UI.confirm trả về true khi bấm xác nhận');
    else bad('UI.confirm trả về sai giá trị khi xác nhận', String(vTrue));

    const pFalse = window.UI.confirm({ title: 'Kiểm thử', message: 'Chọn Huỷ' });
    await sleep(200);
    const m2 = doc.querySelectorAll('.modal');
    m2[m2.length - 1].querySelector('.modal-foot .btn:first-child').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const vFalse = await pFalse;
    if (vFalse === false) ok('UI.confirm trả về false khi bấm huỷ');
    else bad('UI.confirm trả về sai giá trị khi huỷ', String(vFalse));
  } catch (e) { bad('Hộp thoại xác nhận lỗi', e.message); }

  // ---- thao tác xoá thật qua giao diện (phụ thuộc UI.confirm) ----
  try {
    const created = await apiRequest('POST', '/api/entities/categories', { name: 'Danh mục kiểm thử giao diện' });
    const catId = created.json && created.json.data && created.json.data.id;
    if (!catId) bad('Không tạo được bản ghi kiểm thử qua API');
    else {
      window.location.hash = '#/categories';
      const searchBox = await waitFor(() => doc.querySelector('#content .dt-search'), 10000);
      if (!searchBox) throw new Error('Bảng danh mục không render kịp');
      searchBox.value = 'kiểm thử giao diện';
      searchBox.dispatchEvent(new window.Event('input', { bubbles: true }));
      await waitFor(() => /Danh mục kiểm thử giao diện/.test(doc.getElementById('content').textContent), 8000);
      // Chỉ thao tác trên đúng dòng kiểm thử (tìm theo tên bản ghi trong bảng)
      const testRow = await waitFor(() => {
        const rows = Array.from(doc.querySelectorAll('#content tbody tr'));
        return rows.find((tr) => /Danh mục kiểm thử giao diện/.test(tr.textContent));
      }, 8000);
      const delBtn = testRow && Array.from(testRow.querySelectorAll('td.actions button')).find((b) => (b.getAttribute('title') || '') === 'Xoá');
      if (!testRow) bad('Không thấy dòng kiểm thử trong bảng danh mục');
      if (!delBtn) bad('Không thấy nút xoá trên danh sách');
      else {
        delBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await sleep(400);
        const modals = doc.querySelectorAll('.modal');
        const confirmModal = modals[modals.length - 1];
        if (!confirmModal || !/Xoá/.test(confirmModal.textContent)) bad('Không hiện hộp thoại xác nhận xoá');
        else {
          confirmModal.querySelector('.modal-foot .btn:last-child').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
          await sleep(900);
          const after = await apiRequest('GET', '/api/entities/categories/' + catId);
          const gone = after.status === 404 || (after.json && after.json.data && (after.json.data.isDeleted || after.json.data.deletedAt));
          if (gone) ok('Xoá bản ghi qua giao diện (xác nhận có hiệu lực)');
          else bad('Xoá qua giao diện không thực hiện', 'status=' + after.status);
          await apiRequest('DELETE', '/api/entities/categories/' + catId + '?hard=1');
        }
      }
    }
  } catch (e) { bad('Luồng xoá qua giao diện lỗi', e.message); }

  // ---- trang quét mã QR/mã vạch (kiểm kê nhanh bằng điện thoại) ----
  try {
    window.location.hash = '#/scan';
    const scanInput = await waitFor(() => doc.getElementById('scan-input'), 12000);
    if (!scanInput) bad('Trang quét mã không render');
    else {
      ok('Trang quét mã render (khung camera + ô nhập mã)');
      const skOptions = await waitFor(() => {
        const opts = doc.querySelectorAll('#scan-sk option');
        return opts.length && opts[0].value ? opts : null;
      }, 12000);
      if (skOptions) ok('Nạp danh sách đợt kiểm kê đang mở cho trang quét', skOptions.length + ' đợt');
      else bad('Không nạp được đợt kiểm kê đang mở');

      const statusWarn = await waitFor(() => /BarcodeDetector/.test(doc.getElementById('scan-status').innerHTML), 8000);
      if (statusWarn) ok('Cảnh báo dẫn đường khi trình duyệt thiếu bộ đọc mã');
      else bad('Thiếu cảnh báo khi không có BarcodeDetector');

      const tips = doc.querySelectorAll('#scan-tips [data-try]');
      if (tips.length) ok('Gợi ý mã tài sản để thử nhanh', tips.length + ' gợi ý');
      else bad('Không có gợi ý mã tài sản');

      // Chụp trạng thái đợt kiểm kê trước kiểm thử để khôi phục đúng như cũ
      const skId0 = doc.getElementById('scan-sk') ? doc.getElementById('scan-sk').value : '';
      const skRes = skId0 ? await apiRequest('GET', '/api/entities/stocktakes/' + skId0) : null;
      const itemsBefore = (((skRes || {}).json || {}).meta || {}).related || {};
      const beforeById = {};
      (itemsBefore.items || []).forEach((i) => { beforeById[String(i.id)] = i; });
      const freeItem = (itemsBefore.items || []).find((i) => !i.counted && i.assetCode);
      const touched = [];
      doc.getElementById('scan-demo').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      const rec1 = await waitFor(() => /Đã ghi nhận/.test(doc.getElementById('scan-result').innerHTML) && doc.querySelector('#scan-result [data-undo]'), 15000);
      if (rec1) {
        ok('Quét thử ghi nhận kết quả kiểm kê', (doc.querySelector('#scan-result .scan-asset-code') || {}).textContent || '');
        const undoId = rec1.dataset ? rec1.dataset.undo : rec1.getAttribute('data-undo');
        if (undoId) touched.push(undoId);
      } else bad('Quét thử không ghi nhận được kết quả');

      // Tra cứu mã bằng ô nhập tay (dùng dòng chưa kiểm kê của đợt; ghi nhớ để khôi phục sau)
      const assetCode = (freeItem && freeItem.assetCode) || 'TS-2026-00010';
      const assetLookup = await apiRequest('GET', '/api/entities/assets?q=' + assetCode + '&limit=5');
      const assetBefore = ((assetLookup.json || {}).data || []).find((a) => a.code === assetCode) || null;
      scanInput.value = assetCode;
      scanInput.dispatchEvent(new window.Event('input', { bubbles: true }));
      doc.getElementById('scan-go').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      const found = await waitFor(() => doc.getElementById('scan-result').innerHTML.indexOf(assetCode) >= 0, 15000);
      if (found) ok('Tra cứu mã tài sản bằng ô nhập tay');
      else bad('Không tra cứu được mã bằng ô nhập tay');

      const undoBtn = doc.querySelector('#scan-result [data-undo]');
      if (undoBtn && touched.indexOf(undoBtn.getAttribute('data-undo')) < 0) touched.push(undoBtn.getAttribute('data-undo'));
      const actBtns = doc.querySelectorAll('#scan-result [data-act]');
      if (actBtns.length >= 4) ok('Thẻ kết quả có đủ nút ghi nhận kết quả', actBtns.length + ' nút');
      else bad('Thiếu nút ghi nhận kết quả trong thẻ kết quả', actBtns.length + ' nút');

      // Đổi kết quả sang "Sai vị trí" rồi trả về "Khớp"
      const wrongBtn = Array.from(actBtns).find((b) => b.getAttribute('data-act') === 'wrong_location');
      if (wrongBtn) {
        wrongBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        const wrongOk = await waitFor(() => /Sai vị trí/.test(doc.getElementById('scan-result').innerHTML), 15000);
        if (wrongOk) ok('Ghi nhận kết quả "Sai vị trí" khi quét');
        else bad('Không ghi nhận được kết quả sai vị trí');
      }

      // Lịch sử quét + tiến độ
      const histRow = await waitFor(() => doc.querySelector('#scan-history-card .scan-history-row'), 10000);
      if (histRow) ok('Lịch sử quét hiển thị lượt vừa quét');
      else bad('Lịch sử quét không cập nhật');
      const progressText = doc.getElementById('scan-progress-card').textContent;
      if (/đã kiểm kê/.test(progressText) && /còn lại/.test(progressText)) ok('Bảng tiến độ kiểm kê hiển thị đầy đủ số liệu');
      else bad('Bảng tiến độ thiếu số liệu', progressText.slice(0, 60));

      // Hoàn tác lượt kiểm kê vừa ghi
      const undoNow = doc.querySelector('#scan-result [data-undo]');
      const beforeProgress = doc.getElementById('scan-progress-card').textContent;
      undoNow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await waitFor(() => doc.querySelector('.modal-overlay'), 6000);
      const undoConfirm = Array.from(doc.querySelectorAll('.modal-overlay .modal-foot .btn:last-child'));
      if (undoConfirm.length) {
        undoConfirm[undoConfirm.length - 1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        const undone = await waitFor(() => doc.getElementById('scan-progress-card').textContent !== beforeProgress, 12000);
        if (undone) ok('Hoàn tác lượt kiểm kê vừa quét');
        else bad('Hoàn tác không cập nhật tiến độ');
      } else bad('Không hiện hộp thoại xác nhận hoàn tác');

      // Mã không tồn tại
      scanInput.value = 'MA-KHONG-TON-TAI-9999';
      scanInput.dispatchEvent(new window.Event('input', { bubbles: true }));
      doc.getElementById('scan-go').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      const notFound = await waitFor(() => /Không tìm thấy tài sản/.test(doc.getElementById('scan-result').innerHTML), 15000);
      if (notFound) ok('Cảnh báo khi quét mã không có trong hệ thống');
      else bad('Không cảnh báo khi mã không tồn tại');

      // Nút in tem QR tại màn hình kiểm kê mở hộp thoại chọn số nhãn
      if (window.Pages && typeof window.Pages.labelDialog === 'function') {
        window.Pages.labelDialog({ id: 1, code: 'TS-2026-00001', name: 'Máy tính để bàn Dell' });
        const modal = await waitFor(() => {
          const mods = doc.querySelectorAll('.modal');
          return mods.length ? mods[mods.length - 1] : null;
        }, 6000);
        const hasCopies = modal && modal.querySelector('#label-copies');
        if (hasCopies) ok('Hộp thoại in tem QR có chọn số nhãn');
        else bad('Hộp thoại in tem thiếu lựa chọn số nhãn');
        if (modal) {
          const closeBtn = modal.querySelector('.modal-foot .btn:first-child') || modal.querySelector('.icon-btn.x');
          if (closeBtn) closeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        }
      } else bad('Không có hàm in tem Pages.labelDialog');

      // Dọn dẹp: trả mọi dòng bị kiểm thử chạm về đúng trạng thái trước đó
      const skId = doc.getElementById('scan-sk') ? doc.getElementById('scan-sk').value : '';
      for (const itemId of touched) {
        if (!itemId || itemId === 'undefined' || !skId) continue;
        const b = beforeById[String(itemId)];
        if (b && b.counted) {
          await apiRequest('POST', '/api/stocktakes/' + skId + '/items/' + itemId, {
            counted: true, result: b.result, countedQty: b.countedQty, conditionFound: b.conditionFound, note: b.note || '',
          });
        } else {
          await apiRequest('POST', '/api/stocktakes/' + skId + '/items/' + itemId, {
            counted: false, result: (b && b.result) || '', note: (b && b.note) || '',
          });
        }
      }
      if (assetBefore && assetBefore.locationId) {
        await apiRequest('POST', '/api/entities/assets/' + assetBefore.id, { locationId: assetBefore.locationId, locationName: assetBefore.locationName });
      }
      ok('Dọn dẹp các lượt kiểm kê phát sinh khi kiểm thử', touched.length + ' lượt (đã khôi phục vị trí tài sản)');
    }
  } catch (e) { bad('Luồng quét mã lỗi', e.message); }

  // ---- In tem hàng loạt + Quét ngay trong màn hình kiểm kê + Quét tìm tài sản ----
  try {
    window.location.hash = '#/assets';
    const lbBtn = await waitFor(() => doc.getElementById('hd-label-batch'), 10000);
    if (lbBtn) ok('Danh sách tài sản có nút "In tem hàng loạt"');
    else bad('Thiếu nút In tem hàng loạt trên danh sách tài sản');
    if (doc.getElementById('hd-scan-asset')) ok('Danh sách tài sản có nút "Quét tìm tài sản"');
    else bad('Thiếu nút Quét tìm tài sản trên danh sách tài sản');
    const topScan = doc.getElementById('btn-top-scan');
    if (topScan && !topScan.hidden) ok('Nút quét mã ở thanh trên cùng (toàn cục)');
    else bad('Thiếu nút quét ở thanh trên cùng');

    // Hộp thoại in tem hàng loạt: đổi phạm vi → ước tính số tem cập nhật
    window.Pages.labelBatchDialog({});
    const lbModal = await waitFor(() => {
      const mods = doc.querySelectorAll('.modal');
      return mods.length ? Array.from(mods).find((mm) => mm.querySelector('#lb-source')) : null;
    }, 8000);
    if (!lbModal) bad('Hộp thoại in tem hàng loạt không mở');
    else {
      ok('Hộp thoại in tem hàng loạt mở (nguồn: đã chọn/phòng ban/vị trí/danh mục/đợt kiểm kê)');
      const lbScope = lbModal.querySelector('#lb-scope');
      await waitFor(() => lbScope && lbScope.options.length > 1, 8000);
      if (lbScope && lbScope.options.length > 1) {
        // Duyệt các phòng ban đến khi gặp phạm vi có tài sản (phòng ban đầu có thể trống)
        let counted = false;
        for (const opt of Array.from(lbScope.options).slice(1)) {
          lbScope.value = opt.value;
          lbScope.dispatchEvent(new window.Event('change', { bubbles: true }));
          counted = !!(await waitFor(() => /→/.test(lbModal.querySelector('#lb-count').value), 6000));
          if (counted) break;
        }
        if (counted) ok('Ước tính tem hàng loạt cập nhật theo phạm vi', lbModal.querySelector('#lb-count').value);
        else bad('Ước tính tem hàng loạt không cập nhật', lbModal.querySelector('#lb-count').value);
      } else bad('Hộp thoại in tem: dropdown phạm vi trống');
      const lbClose = lbModal.querySelector('.modal-foot .btn:first-child') || lbModal.querySelector('.icon-btn.x');
      if (lbClose) lbClose.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    }
    await sleep(300);

    // Quét ngay trong màn hình kiểm kê: mở hộp thoại, nhập mã, ghi nhận không chuyển trang
    let skOpen = null, free2 = null;
    const skList = await apiRequest('GET', '/api/entities/stocktakes?status=open&limit=20&sort=id&order=desc');
    for (const s of ((skList.json || {}).data || [])) {
      const d = await apiRequest('GET', '/api/entities/stocktakes/' + s.id);
      const its = (((d.json || {}).meta || {}).related || {}).items || [];
      const f = its.find((i) => !i.counted && i.assetCode);
      if (f) { skOpen = s; free2 = f; break; }
    }
    if (!skOpen) bad('Không có đợt kiểm kê đang mở (chưa kiểm kê hết) để thử quét ngay');
    else {
      window.location.hash = '#/stocktakes/' + skOpen.id + '/count';
      const skScanBtn = await waitFor(() => doc.getElementById('sk-scan'), 10000);
      if (!skScanBtn) bad('Màn hình kiểm kê thiếu nút "Quét ngay"');
      else {
        ok('Màn hình kiểm kê có nút "Quét ngay" (hộp thoại quét tại chỗ)');
        skScanBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        const sdInput = await waitFor(() => doc.getElementById('sd-input'), 10000);
        if (!sdInput) bad('Hộp thoại quét ngay không mở');
        else {
          ok('Hộp thoại quét ngay mở (khung camera + ô nhập mã, không chuyển trang)');
          sdInput.value = free2.assetCode;
          sdInput.dispatchEvent(new window.Event('input', { bubbles: true }));
          doc.getElementById('sd-go').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
          const sdRec = await waitFor(() => /Đã ghi nhận/.test(doc.getElementById('sd-result').innerHTML), 15000);
          if (sdRec) ok('Quét ngay: quét là ghi kết quả luôn vào đợt kiểm kê');
          else bad('Quét ngay không ghi nhận được kết quả');
          const rowUpd = await waitFor(() => {
            const rows = Array.from(doc.querySelectorAll('#sk-table tbody tr'));
            const tr = rows.find((r) => (r.querySelector('.mono') || {}).textContent === free2.assetCode);
            return tr && tr.querySelector('.sk-counted') && tr.querySelector('.sk-counted').checked;
          }, 8000);
          if (rowUpd) ok('Sau quét, dòng tương ứng trên màn hình kiểm kê được đánh dấu ngay');
          else bad('Dòng kiểm kê không được cập nhật sau khi quét');
          const sdClose = Array.from(doc.querySelectorAll('.modal-foot .btn')).find((b) => /Đóng/.test(b.textContent));
          if (sdClose) sdClose.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
          await apiRequest('POST', '/api/stocktakes/' + skOpen.id + '/items/' + free2.id, { counted: false, result: '', note: '' });
          ok('Dọn dẹp: khôi phục dòng kiểm kê về chưa kiểm kê', free2.assetCode);
        }
      }
    }

    // Quét để tìm tài sản: hộp thoại → nhập mã → mở thẳng hồ sơ tài sản
    window.location.hash = '#/assets';
    await waitFor(() => doc.getElementById('hd-scan-asset'), 10000);
    const target = await apiRequest('GET', '/api/entities/assets?limit=1&sort=id&order=desc');
    const ta = ((target.json || {}).data || [])[0];
    if (!ta) bad('Không có tài sản để thử quét tìm');
    else {
      window.Pages.scanAssetDialog();
      const saInput = await waitFor(() => doc.getElementById('sa-input'), 10000);
      if (!saInput) bad('Hộp thoại quét tìm tài sản không mở');
      else {
        ok('Hộp thoại quét tìm tài sản mở (từ danh sách tài sản/thanh trên cùng)');
        saInput.value = ta.code;
        saInput.dispatchEvent(new window.Event('input', { bubbles: true }));
        doc.getElementById('sa-go').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        const foundIt = await waitFor(() => /Đã tìm thấy/.test((doc.getElementById('sa-result') || {}).innerHTML || ''), 10000);
        if (foundIt) ok('Quét tìm: nhận diện tài sản đúng theo mã');
        else bad('Quét tìm: không nhận diện được tài sản');
        const navOk = await waitFor(() => window.location.hash === '#/assets/' + ta.id, 8000);
        if (navOk) ok('Quét tìm: mở thẳng hồ sơ tài sản tương ứng');
        else bad('Quét tìm: không mở hồ sơ tài sản', window.location.hash);
      }
    }
  } catch (e) { bad('Luồng in tem hàng loạt / quét mới lỗi', e.message); }

  // ---- PWA Di động & Chữ ký số trên chứng từ ----
  try {
    // 1. Kiểm tra phần tử PWA trong DOM
    const manifestLink = doc.querySelector('link[rel="manifest"]');
    if (manifestLink && manifestLink.getAttribute('href') === '/manifest.webmanifest') ok('PWA: Thẻ link manifest khai báo đúng /manifest.webmanifest');
    else bad('PWA: Thiếu thẻ link manifest hoặc sai href');

    const themeMeta = doc.querySelector('meta[name="theme-color"]');
    if (themeMeta && themeMeta.getAttribute('content') === '#2563eb') ok('PWA: Khai báo theme-color #2563eb chuẩn');
    else bad('PWA: Thiếu meta theme-color');

    const bottomNav = doc.getElementById('mobile-bottom-nav');
    if (bottomNav && bottomNav.querySelectorAll('.mb-item').length >= 5) ok('PWA: Thanh điều hướng dưới đáy (mobile bottom nav) có đủ 5 mục (Tổng quan, Tài sản, Quét QR, Kiểm kê, Ký số)');
    else bad('PWA: Thiếu thanh điều hướng mobile-bottom-nav');

    // 2. Kiểm tra trang Chữ ký số (#/signatures)
    window.location.hash = '#/signatures';
    const sigHead = await waitFor(() => /Chữ ký số & Chứng từ điện tử/.test((doc.querySelector('.page-head') || {}).textContent || ''), 10000);
    if (sigHead) ok('Trang Chữ ký số (#/signatures) render đúng tiêu đề và thống kê');
    else bad('Trang Chữ ký số không render');

    await waitFor(() => doc.getElementById('sig-search'), 8000);
    const btnCert = doc.getElementById('sig-btn-cert');
    if (btnCert) {
      btnCert.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      const certModal = await waitFor(() => {
        const m = doc.querySelectorAll('.modal');
        return Array.from(m).find((x) => /Chứng thư số Doanh nghiệp/.test(x.textContent));
      }, 8000);
      if (certModal && /564E53-2026-CA01-8F9A/.test(certModal.textContent)) ok('Hộp thoại thông tin Chứng thư số CA hiển thị đúng số serial & thuật toán RSA-2048');
      else bad('Hộp thoại chứng thư số không hiển thị đúng');
      if (certModal) {
        const closeBtn = certModal.querySelector('.btn.primary') || certModal.querySelector('.modal-foot .btn');
        if (closeBtn) closeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      }
    } else bad('Thiếu nút xem chứng thư số');

    // 3. Kiểm tra hộp thoại ký số điện tử
    const btnSign = doc.getElementById('sig-btn-sign');
    if (btnSign) {
      btnSign.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      const signModal = await waitFor(() => doc.getElementById('sd-form'), 8000);
      if (signModal && doc.getElementById('sd-role') && doc.getElementById('sd-pin')) ok('Hộp thoại ký số chứng từ mở thành công (chọn vai trò, tên, PIN)');
      else bad('Hộp thoại ký số không mở');
      const cancelBtn = doc.getElementById('sd-cancel');
      if (cancelBtn) cancelBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    } else bad('Thiếu nút ký chứng từ mới');

  } catch (e) { bad('Luồng kiểm thử PWA / Chữ ký số lỗi', e.message); }

  // ---- đăng xuất (chạy cuối vì sẽ kết thúc phiên) ----
  try {
    doc.getElementById('user-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(150);
    doc.getElementById('btn-logout').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(400);
    const modals = doc.querySelectorAll('.modal');
    const outModal = modals[modals.length - 1];
    if (!outModal) bad('Không hiện hộp thoại xác nhận đăng xuất');
    else {
      outModal.querySelector('.modal-foot .btn:last-child').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await sleep(1200);
      const cookieGone = !/ams_token=/.test(cookieHeader());
      const backToLogin = !doc.getElementById('login-screen').classList.contains('hidden') && doc.getElementById('app').classList.contains('hidden');
      const me = await apiRequest('GET', '/api/auth/me');
      if (cookieGone) ok('Đăng xuất xoá cookie phiên');
      else bad('Cookie phiên chưa bị xoá khi đăng xuất');
      if (backToLogin) ok('Đăng xuất đưa về màn hình đăng nhập');
      else bad('Không quay về màn hình đăng nhập sau khi đăng xuất');
      if (me.status === 401) ok('Phiên đã bị thu hồi trên máy chủ');
      else bad('Phiên vẫn còn hiệu lực sau đăng xuất', 'status=' + me.status);

      // Đăng nhập lại ngay sau khi đăng xuất
      doc.getElementById('username').value = 'admin';
      doc.getElementById('password').value = 'Admin@123';
      doc.getElementById('login-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      for (let i = 0; i < 40 && !(window.App && window.App.state.user); i++) await sleep(150);
      if (window.App.state.user) ok('Đăng nhập lại được ngay sau khi đăng xuất', window.App.state.user.fullName);
      else bad('Không đăng nhập lại được sau khi đăng xuất', (doc.getElementById('login-error') || {}).textContent || '');
      if (doc.querySelectorAll('.nav-item').length > 20) ok('Menu được dựng lại đầy đủ sau khi đăng nhập lại', doc.querySelectorAll('.nav-item').length + ' mục');
    }
  } catch (e) { bad('Luồng đăng xuất lỗi', e.message); }

  // ---- tổng kết ----
  console.log(results.join('\n'));
  if (consoleErrors.length) {
    console.log('\n\u001b[33m  Cảnh báo console.error (' + consoleErrors.length + '):\u001b[0m');
    consoleErrors.slice(0, 6).forEach((c) => console.log('    • ' + c.slice(0, 200)));
  }
  if (errors.length) {
    console.log('\n\u001b[31m  Lỗi JavaScript (' + errors.length + '):\u001b[0m');
    errors.slice(0, 10).forEach((e) => console.log('    • ' + String(e).split('\n').slice(0, 3).join(' | ').slice(0, 300)));
  }
  console.log('\n' + '─'.repeat(62));
  console.log((failed === 0 ? '\u001b[32m' : '\u001b[31m') + '  GIAO DIỆN: ' + passed + ' đạt / ' + failed + ' lỗi\u001b[0m');
  console.log('─'.repeat(62) + '\n');
  dom.window.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('Lỗi harness:', e);
  process.exit(2);
});
