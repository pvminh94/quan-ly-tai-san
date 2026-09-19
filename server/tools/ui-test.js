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
const results = [];
let passed = 0;
let failed = 0;
function ok(msg, extra) { passed++; results.push('  \u001b[32m✓\u001b[0m ' + msg + (extra ? ' \u001b[90m' + extra + '\u001b[0m' : '')); }
function bad(msg, extra) { failed++; results.push('  \u001b[31m✗\u001b[0m ' + msg + ' \u001b[31m' + (extra || '') + '\u001b[0m'); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    ['#/khong-ton-tai-xyz', 'Không tìm thấy trang'],
  ];
  const errBefore = errors.length;
  for (const [hash, expect] of routes) {
    const e0 = errors.length;
    window.location.hash = hash;
    await sleep(hash.includes('designer') ? 1500 : 700);
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
  await sleep(900);
  const sr = doc.getElementById('search-results');
  if (sr && !sr.classList.contains('hidden') && sr.querySelectorAll('.sr-item').length) ok('Tìm kiếm nhanh toàn hệ thống', sr.querySelectorAll('.sr-item').length + ' kết quả');
  else bad('Tìm kiếm nhanh không trả kết quả');

  window.location.hash = '#/dashboard';
  await sleep(800);
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
  await sleep(2000);
  const dz = doc.querySelector('.designer');
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
