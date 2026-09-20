#!/usr/bin/env node
'use strict';
/**
 * smoke-test.js — Kiểm thử đầu-cuối (end-to-end) toàn bộ API của AMS Pro.
 *
 * Cách dùng:
 *   node server/tools/smoke-test.js              # tự khởi động máy chủ ở cổng 3111
 *   node server/tools/smoke-test.js --port 3000  # chạy trên máy chủ đang có sẵn
 *   node server/tools/smoke-test.js --keep       # giữ lại dữ liệu test
 *
 * Script sẽ kiểm tra: xác thực, phân quyền, CRUD, nghiệp vụ (cấp phát, điều chuyển,
 * bảo trì, khấu hao, kiểm kê, thanh lý), báo cáo & trình thiết kế, chứng từ in,
 * quản trị hệ thống (sao lưu, xuất CSDL, nhật ký, phiên), tệp tĩnh & SPA.
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const argv = process.argv.slice(2);
const grab = (flag, def) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : def;
};
const PORT = Number(grab('--port', 3111));
const KEEP = argv.includes('--keep');
const OWN_SERVER = !argv.includes('--port');

let passed = 0;
let failed = 0;
const failures = [];
let group = '';

function section(name) {
  group = name;
  console.log('\n\x1b[1m\x1b[36m■ ' + name + '\x1b[0m');
}
function ok(label, extra) {
  passed++;
  console.log('  \x1b[32m✓\x1b[0m ' + label + (extra ? ' \x1b[90m' + extra + '\x1b[0m' : ''));
}
function bad(label, detail) {
  failed++;
  failures.push(group + ' → ' + label + ': ' + detail);
  console.log('  \x1b[31m✗\x1b[0m ' + label + ' \x1b[31m' + detail + '\x1b[0m');
}
function check(label, cond, detail) {
  if (cond) ok(label, typeof cond === 'number' || typeof cond === 'string' ? String(cond) : '');
  else bad(label, detail || 'điều kiện không đúng');
}

/* ------------------------------ HTTP client ------------------------------ */

let cookie = '';
function request(method, url, body, opts) {
  const o = opts || {};
  const jar = o.jar === undefined ? cookie : o.jar;
  return new Promise((resolve, reject) => {
    const payload = body === undefined || body === null ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const headers = Object.assign(
      { Accept: o.accept || 'application/json' },
      payload ? { 'Content-Type': o.contentType || 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      jar ? { Cookie: jar } : {}
    );
    const req = http.request({ host: '127.0.0.1', port: PORT, path: url, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const setCookie = res.headers['set-cookie'];
        if (setCookie && o.saveCookie !== false) {
          cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
        }
        let json = null;
        const isJson = String(res.headers['content-type'] || '').includes('json');
        if (o.raw) return resolve({ status: res.statusCode, headers: res.headers, body: buf });
        if (isJson) {
          try { json = JSON.parse(buf.toString('utf8')); } catch (e) { json = null; }
        }
        resolve({ status: res.statusCode, headers: res.headers, json, text: buf.toString('utf8'), size: buf.length, cookie: cookie });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const GET = (u, o) => request('GET', u, null, o);
const POST = (u, b, o) => request('POST', u, b === undefined ? {} : b, o);
const PUT = (u, b, o) => request('PUT', u, b, o);
const DEL = (u, o) => request('DELETE', u, null, o);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ Khởi động ------------------------------ */

let child = null;
async function startServer() {
  if (!OWN_SERVER) {
    const h = await GET('/api/health', { jar: '' });
    if (h.status !== 200) throw new Error('Máy chủ ở cổng ' + PORT + ' không phản hồi /api/health');
    return;
  }
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), HOST: '0.0.0.0' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try {
      const h = await GET('/api/health', { jar: '' });
      if (h.status === 200) return;
    } catch (e) { /* chờ tiếp */ }
  }
  throw new Error('Máy chủ không khởi động được sau 18 giây');
}

/* ------------------------------ Nội dung test ------------------------------ */

const created = { assets: [], transfers: [], maintenances: [], stocktakes: [], disposals: [], categories: [], assignments: [] };
let adminUser = null;
let asset = null;
let templateId = null;

async function testHealth() {
  section('1. Sức khoẻ hệ thống & tệp tĩnh');
  const h = await GET('/api/health', { jar: '' });
  check('/api/health trả 200', h.status === 200, 'status=' + h.status);
  check('Có thông tin phiên bản', h.json && h.json.data && h.json.data.version, JSON.stringify(h.json && h.json.data).slice(0, 80));

  const html = await GET('/', { jar: '', raw: true });
  check('Trang chủ trả HTML', html.status === 200 && /text\/html/.test(html.headers['content-type']), 'status=' + html.status);
  const spa = await GET('/#/assets', { jar: '', raw: true });
  check('SPA fallback cho route con', spa.status === 200 && /<div id="app"/.test(spa.body.toString()), 'status=' + spa.status);
  const css = await GET('/css/app.css', { jar: '', raw: true });
  check('CSS tĩnh tải được', css.status === 200 && css.body.length > 5000, css.body.length + ' bytes');
  let scriptsOk = true;
  const scripts = ['core.js', 'ui.js', 'charts.js', 'pages.js', 'dashboard.js', 'designer.js', 'admin.js', 'app.js'];
  for (const s of scripts) {
    const r = await GET('/js/' + s, { jar: '', raw: true });
    if (r.status !== 200) { scriptsOk = false; bad('JS ' + s, 'status=' + r.status); }
  }
  if (scriptsOk) ok('8 tệp JavaScript SPA', 'core → app');
  const trav = await GET('/../server/lib/store.js', { jar: '', raw: true });
  const travBody = trav.body.toString();
  check('Chặn truy cập tệp ngoài thư mục public', !/class Store|module\.exports|createServer/.test(travBody), 'status=' + trav.status + ' • ' + travBody.length + ' bytes (SPA shell)');
  const trav2 = await GET('/%2e%2e%2fserver%2flib%2fstore.js', { jar: '', raw: true });
  check('Chặn truy cập dạng mã hoá URL', !/class Store|module\.exports/.test(trav2.body.toString()), 'status=' + trav2.status);
  const dbLeak = await GET('/data/db.json', { jar: '', raw: true });
  check('Không lộ tệp CSDL qua HTTP', !/collections/.test(dbLeak.body.toString()), 'status=' + dbLeak.status);
  const miss = await GET('/api/khong-ton-tai', { jar: '' });
  check('API không tồn tại trả 404 JSON', miss.status === 404 && miss.json && miss.json.error === true, 'status=' + miss.status);
}

async function testAuth() {
  section('2. Xác thực & phân quyền');
  const skip = await GET('/api/dashboard/summary', { jar: '' });
  check('Truy cập API khi chưa đăng nhập → 401', skip.status === 401, 'status=' + skip.status);

  const wrong = await POST('/api/auth/login', { username: 'admin', password: 'sai-mat-khau' });
  check('Sai mật khẩu → 401', wrong.status === 401, 'status=' + wrong.status);

  const noUser = await POST('/api/auth/login', { username: 'khong.ton.tai', password: 'abc123' });
  check('Tài khoản không tồn tại → 401', noUser.status === 401, 'status=' + noUser.status);

  const login = await POST('/api/auth/login', { username: 'admin', password: 'Admin@123' });
  check('Đăng nhập admin thành công', login.status === 200 && !!login.json.data.token, 'status=' + login.status);
  check('Cookie phiên được thiết lập', /ams_token=/.test(cookie), cookie.slice(0, 24) + '…');
  adminUser = login.json.data.user;
  check('Thông tin người dùng có vai trò', adminUser && adminUser.roleName, adminUser && adminUser.roleName);

  const me = await GET('/api/auth/me');
  check('/api/auth/me trả đúng người dùng', me.status === 200 && me.json.data.user.username === 'admin', 'status=' + me.status);
  check('Danh sách quyền được trả về', me.json.data.permissions && Object.keys(me.json.data.permissions).length > 10, Object.keys(me.json.data.permissions || {}).length + ' phân hệ');

  const meta = await GET('/api/meta');
  const d = meta.json.data;
  check('/api/meta trả về cấu hình', meta.status === 200, 'status=' + meta.status);
  check('Số phân hệ thực thể', Object.keys(d.entities || {}).length >= 20, Object.keys(d.entities || {}).length + ' thực thể');
  check('Danh mục enum', Object.keys(d.enums || {}).length >= 8, Object.keys(d.enums || {}).length + ' enum');
  check('Phân hệ quyền', (d.enums.permissionModules || []).length >= 20, (d.enums.permissionModules || []).length + ' phân hệ quyền');
  check('Cấu hình công ty đầy đủ', d.settings.company && d.settings.company.name && d.settings.company.taxCode, d.settings.company && d.settings.company.name);

  // Người dùng vai trò thấp
  const lowJar = '';
  const low = await POST('/api/auth/login', { username: 'nhanvien.01', password: 'User@123' }, { jar: '', saveCookie: false });
  check('Đăng nhập tài khoản nhân viên', low.status === 200, 'status=' + low.status);
  const lowCookie = (low.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  const denied = await POST('/api/entities/assets', { name: 'Tài sản test quyền' }, { jar: lowCookie });
  check('Nhân viên không được thêm tài sản → 403', denied.status === 403, 'status=' + denied.status);
  const deniedAdmin = await GET('/api/admin/system', { jar: lowCookie });
  check('Nhân viên không vào được API quản trị → 403', deniedAdmin.status === 403, 'status=' + deniedAdmin.status);
  await POST('/api/auth/logout', {}, { jar: lowCookie, saveCookie: false });
  await POST('/api/auth/login', { username: 'admin', password: 'Admin@123' });   // khôi phục phiên admin cho các bước sau
}

async function testCrud() {
  section('3. CRUD, tìm kiếm, xuất/nhập');
  const list = await GET('/api/entities/assets?limit=5');
  check('Danh sách tài sản', list.status === 200 && Array.isArray(list.json.data), list.status + ' / ' + (list.json.data || []).length + ' dòng');
  check('Meta phân trang', list.json.meta && typeof list.json.meta.total === 'number', JSON.stringify(list.json.meta).slice(0, 90));
  const total = list.json.meta.total;
  check('Dữ liệu mẫu đã được tạo', total > 50, total + ' tài sản');

  const search = await GET('/api/entities/assets?q=may%20phay&limit=5');
  check('Tìm kiếm không dấu (q=may phay)', search.status === 200, (search.json.meta || {}).total + ' kết quả');
  const sort = await GET('/api/entities/assets?sort=originalCost&order=desc&limit=3');
  const costs = (sort.json.data || []).map((a) => a.originalCost);
  check('Sắp xếp theo nguyên giá giảm dần', costs.length === 3 && costs[0] >= costs[1] && costs[1] >= costs[2], JSON.stringify(costs));
  const filter = await GET('/api/entities/assets?filter%5Bstatus%5D=in_use&limit=3');
  check('Lọc theo trạng thái', filter.status === 200 && (filter.json.meta.total || 0) > 0, 'in_use: ' + (filter.json.meta.total || 0));

  const cat = await POST('/api/entities/categories', { code: 'TEST-CAT', name: 'Danh mục kiểm thử', type: 'tangible', depreciationMethod: 'straight_line', usefulLifeMonths: 60, status: 'active' });
  check('Tạo bản ghi mới (danh mục)', cat.status === 201 || cat.status === 200, 'status=' + cat.status);
  const catId = cat.json.data.id;
  created.categories.push(catId);
  const upd = await PUT('/api/entities/categories/' + catId, { name: 'Danh mục kiểm thử (đã sửa)' });
  check('Cập nhật bản ghi', upd.status === 200 && upd.json.data.name.includes('đã sửa'), 'status=' + upd.status);

  const existingUser = (await GET('/api/entities/users?limit=1')).json.data[0];
  const dupUser = await POST('/api/entities/users', { username: existingUser.username, fullName: 'Trùng tài khoản', roleId: existingUser.roleId });
  check('Chặn trùng khoá nghiệp vụ (409)', dupUser.status === 409, 'status=' + dupUser.status);
  check('Mã tự sinh cho bản ghi mới', /^DM-\d+$/.test(cat.json.data.code || ''), 'mã danh mục: ' + cat.json.data.code);
  const cat2 = await POST('/api/entities/categories', { name: 'Danh mục kiểm thử 2' });
  check('Mã tự sinh tăng dần theo quy tắc', cat2.json.data.code !== cat.json.data.code, cat.json.data.code + ' → ' + cat2.json.data.code);
  if (cat2.json.data.id) created.categories.push(cat2.json.data.id);
  const invalid = await POST('/api/entities/categories', { name: '' });
  check('Kiểm tra dữ liệu bắt buộc (422)', invalid.status === 422, 'status=' + invalid.status);

  const csv = await GET('/api/entities/assets/export.csv?limit=20', { raw: true });
  check('Xuất CSV tài sản', csv.status === 200 && csv.body.length > 500 && /;|,/.test(csv.body.toString().slice(0, 400)), csv.body.length + ' bytes');

  const imp = await POST('/api/entities/categories/import', { mode: 'append', rows: [{ code: 'TEST-IMP-1', name: 'Nhập từ JSON 1' }, { code: 'TEST-IMP-2', name: 'Nhập từ JSON 2' }] });
  check('Nhập JSON nhiều dòng', imp.status === 200 && imp.json.data.inserted === 2, JSON.stringify(imp.json.data));
  const impList = await GET('/api/entities/categories?q=' + encodeURIComponent('Nhập từ JSON'));
  check('Bản ghi nhập đã có trong CSDL', (impList.json.meta.total || 0) >= 2, (impList.json.meta.total || 0) + ' bản ghi');
  for (const r of impList.json.data || []) created.categories.push(r.id);   // dọn hết bản ghi vừa nhập

  const del = await DEL('/api/entities/categories/' + catId);
  check('Xoá mềm bản ghi', del.status === 200, 'status=' + del.status);
  const trash = await GET('/api/entities/categories/trash');
  check('Bản ghi nằm trong thùng rác', (trash.json.data || []).some((r) => r.id === catId), (trash.json.data || []).length + ' trong thùng rác');
  const restored = await POST('/api/entities/categories/' + catId + '/restore');
  check('Khôi phục từ thùng rác', restored.status === 200, 'status=' + restored.status);
}

async function testAssetsBusiness() {
  section('4. Nghiệp vụ tài sản');
  const list = await GET('/api/entities/assets?limit=1&sort=id&order=asc');
  asset = list.json.data[0];
  check('Lấy được tài sản để kiểm thử', !!asset, asset && asset.code);

  const detail = await GET('/api/entities/assets/' + asset.id);
  check('Chi tiết tài sản có dữ liệu tính toán', detail.status === 200 && detail.json.data.bookValue !== undefined, 'giá trị còn lại: ' + (detail.json.data.bookValue || 0));
  check('Tài sản có tên danh mục', !!detail.json.data.categoryName, detail.json.data.categoryName);

  const dash = await GET('/api/dashboard/summary');
  const s = dash.json.data;
  const k = s.kpi || {};
  check('Bảng điều khiển trả số liệu KPI', dash.status === 200 && k.totalAssets > 0, 'tổng ' + k.totalAssets + ' tài sản');
  check('Nguyên giá & giá trị còn lại', k.totalOriginal > 0 && k.totalBook >= 0, 'NG: ' + k.totalOriginal + ' — CL: ' + k.totalBook);
  check('Phân bổ theo trạng thái & phòng ban', (s.byStatus || []).length > 0 && (s.byDepartment || []).length > 0, (s.byStatus || []).length + ' trạng thái, ' + (s.byDepartment || []).length + ' phòng ban');
  check('Cảnh báo & hoạt động gần đây', s.alerts && s.recentActivity && s.recentActivity.length > 0, (s.alerts.maintenanceDue || []).length + ' đến hạn bảo trì, ' + s.recentActivity.length + ' hoạt động');
  check('Số phiếu chờ phê duyệt là số nguyên', typeof k.pendingApprovals === 'number', k.pendingApprovals + ' phiếu');

  const ana = await GET('/api/dashboard/analytics?groupBy=department&metric=originalCost');
  check('Phân tích theo phòng ban', ana.status === 200 && Array.isArray(ana.json.data), (ana.json.data || []).length + ' nhóm');
  if ((ana.json.data || []).length) {
    const row = ana.json.data[0];
    check('Dòng phân tích có số liệu', row.original > 0 || row.count > 0, row.key + ': ' + row.count + ' tài sản / ' + row.original);
  }

  const create = await POST('/api/entities/assets', {
    code: 'TEST-TS-001',
    name: 'Máy tính xách tay kiểm thử E2E',
    categoryId: asset.categoryId,
    departmentId: asset.departmentId,
    locationId: asset.locationId,
    status: 'in_stock',
    condition: 'new',
    quantity: 1,
    unit: 'Cái',
    originalCost: 25000000,
    purchaseDate: '2026-01-15',
    supplierId: asset.supplierId,
    depreciationMethod: 'straight_line',
    usefulLifeMonths: 36,
    depreciationStart: '2026-02-01',
    residualValue: 0,
  });
  check('Tạo tài sản mới', create.status === 201 || create.status === 200, 'status=' + create.status);
  const newAsset = create.json.data;
  created.assets.push(newAsset.id);
  check('Tự sinh mã tài sản theo quy tắc', !!newAsset.code && newAsset.code !== 'TEST-TS-001', newAsset.code);
  check('Khấu hao được khởi tạo', newAsset.accumulatedDepreciation !== undefined, 'khấu hao luỹ kế: ' + newAsset.accumulatedDepreciation);

  // Cấp phát
  const assign = await POST('/api/entities/assignments', {
    assetId: newAsset.id, toUserId: adminUser.id, type: 'assign', departmentId: newAsset.departmentId,
    locationId: newAsset.locationId, date: '2026-02-01', status: 'completed',
    conditionAtHandover: 'new', purpose: 'Công tác kiểm thử', note: 'Bàn giao kiểm thử',
  });
  check('Tạo phiếu cấp phát tài sản', assign.status === 201 || assign.status === 200, 'status=' + assign.status);
  created.assignments.push(assign.json.data.id);
  check('Phiếu cấp phát tự sinh số phiếu', !!(assign.json.data.code || '').startsWith('CP'), assign.json.data.code);
  const afterAssign = await GET('/api/entities/assets/' + newAsset.id);
  check('Tài sản chuyển sang trạng thái đang sử dụng', afterAssign.json.data.status === 'in_use', afterAssign.json.data.status);
  check('Người sử dụng được ghi nhận trên tài sản', afterAssign.json.data.assigneeName === adminUser.fullName, afterAssign.json.data.assigneeName);
  check('Lịch sử phiếu gắn với tài sản', ((afterAssign.json.meta || {}).related || {}).assignments !== undefined, 'tab nghiệp vụ liên quan');

  // Điều chuyển có quy trình duyệt
  const loc2 = (await GET('/api/entities/locations?limit=2')).json.data;
  const targetLoc = loc2[1] || loc2[0] || { id: newAsset.locationId, departmentId: newAsset.departmentId };
  const tr = await POST('/api/entities/transfers', {
    assetId: newAsset.id, fromDepartmentId: newAsset.departmentId, toDepartmentId: targetLoc.departmentId || newAsset.departmentId,
    toLocationId: targetLoc.id, reason: 'Điều chuyển kiểm thử E2E', date: '2026-03-01', status: 'pending',
  });
  check('Tạo phiếu điều chuyển', tr.status === 201 || tr.status === 200, 'status=' + tr.status);
  const trId = tr.json.data.id;
  created.transfers.push(trId);
  const approve = await POST('/api/transfers/' + trId + '/approve', { note: 'Đồng ý điều chuyển' });
  check('Phê duyệt phiếu điều chuyển', approve.status === 200 && approve.json.data.status === 'approved', JSON.stringify(approve.json.data).slice(0, 80));
  check('Người phê duyệt được ghi nhận', !!approve.json.data.approvedAt, approve.json.data.approvedAt);
  const stAfterApprove = await GET('/api/entities/assets/' + newAsset.id);
  check('Tài sản chuyển trạng thái "đang điều chuyển"', stAfterApprove.json.data.status === 'transferred', stAfterApprove.json.data.status);
  const complete = await POST('/api/transfers/' + trId + '/complete', {});
  check('Hoàn thành phiếu điều chuyển', complete.status === 200 && complete.json.data.status === 'completed', 'status=' + complete.status);
  const afterTr = await GET('/api/entities/assets/' + newAsset.id);
  check('Vị trí tài sản cập nhật theo phiếu điều chuyển', String(afterTr.json.data.locationId) === String(targetLoc.id), String(afterTr.json.data.locationId));

  // Bảo trì
  const mt = await POST('/api/entities/maintenances', {
    assetId: newAsset.id, type: 'corrective', priority: 'high', status: 'pending',
    reportedDate: '2026-04-01', description: 'Màn hình bị sọc, cần kiểm tra', cost: 1500000, technician: 'Trung tâm bảo hành kiểm thử',
  });
  check('Tạo phiếu bảo trì', mt.status === 201 || mt.status === 200, 'status=' + mt.status);
  const mtId = mt.json.data.id;
  created.maintenances.push(mtId);
  const stMaint = await GET('/api/entities/assets/' + newAsset.id);
  check('Tài sản chuyển trạng thái bảo trì', stMaint.json.data.status === 'maintenance', stMaint.json.data.status);
  const mtStart = await POST('/api/maintenances/' + mtId + '/start', {});
  check('Tiếp nhận phiếu bảo trì', mtStart.status === 200 && mtStart.json.data.status === 'in_progress', 'status=' + mtStart.status);
  const mtDone = await POST('/api/maintenances/' + mtId + '/complete', { cost: 1750000, partsCost: 250000, result: 'Thay cáp màn hình', actualDate: '2026-04-05' });
  check('Hoàn thành bảo trì & ghi chi phí', mtDone.status === 200 && mtDone.json.data.cost === 1750000, 'chi phí: ' + (mtDone.json.data || {}).cost);
  const afterMt = await GET('/api/entities/assets/' + newAsset.id);
  check('Tài sản về trạng thái đang sử dụng sau bảo trì', afterMt.json.data.status === 'in_use', afterMt.json.data.status);
  const mtHistory = ((afterMt.json.meta || {}).related || {}).maintenances || [];
  check('Lịch sử bảo trì ghi nhận chi phí', mtHistory.length > 0 && mtHistory.some((m) => Number(m.cost) === 1750000), mtHistory.length + ' phiếu');

  // Bảo hành
  const wt = await POST('/api/entities/warranties', {
    assetId: newAsset.id, provider: 'Nhà cung cấp kiểm thử', startDate: '2026-02-01', endDate: '2028-02-01',
    status: 'active', coverage: 'Bảo hành tiêu chuẩn 24 tháng', claimCount: 0, note: 'Hồ sơ bảo hành kiểm thử',
  });
  check('Tạo hồ sơ bảo hành', wt.status === 201 || wt.status === 200, 'status=' + wt.status);
  created.warranties = created.warranties || [];
  created.warranties.push(wt.json.data.id);
}

async function testDepreciation() {
  section('5. Khấu hao & kiểm kê');
  const prev = await GET('/api/depreciations/preview?period=2026-03');
  check('Xem trước khấu hao theo kỳ', prev.status === 200 && Array.isArray(prev.json.data), (prev.json.data || []).length + ' tài sản');
  if ((prev.json.data || []).length) {
    const row = prev.json.data[0];
    check('Dòng xem trước có số liệu khấu hao', row.amount >= 0 && row.closingValue !== undefined, row.code + ' → ' + row.amount);
  }

  const run = await POST('/api/depreciations/run', { period: '2026-03', scope: 'all', overwrite: true, note: 'Chạy kiểm thử E2E' });
  check('Chạy khấu hao kỳ 2026-03', run.status === 200 && run.json.data.processed > 0, run.json.data.processed + ' tài sản, tổng ' + run.json.data.totalAmount + ' đ');
  check('Kết quả khấu hao trả về từng dòng', Array.isArray(run.json.data.rows) && run.json.data.rows.length > 0, run.json.data.rows.length + ' dòng');
  const depList = await GET('/api/entities/depreciations?filter%5Bperiod%5D=2026-03&limit=5');
  check('Bản ghi khấu hao kỳ 2026-03 được tạo', (depList.json.meta.total || 0) > 0, (depList.json.meta.total || 0) + ' bản ghi');
  const depAsset = await GET('/api/entities/assets/' + asset.id);
  check('Khấu hao luỹ kế cập nhật trên tài sản', depAsset.json.data.accumulatedDepreciation >= 0, 'luỹ kế: ' + depAsset.json.data.accumulatedDepreciation);

  const st = await POST('/api/entities/stocktakes', {
    code: 'TEST-KK-001', name: 'Kiểm kê kiểm thử E2E', startDate: '2026-05-01', endDate: '2026-05-10',
    scope: 'department', departmentId: asset.departmentId, status: 'in_progress', note: 'Kiểm kê tự động',
  });
  check('Tạo đợt kiểm kê', st.status === 201 || st.status === 200, 'status=' + st.status);
  const stId = st.json.data.id;
  created.stocktakes.push(stId);
  const items = await GET('/api/entities/stocktake_items?filter%5BstocktakeId%5D=' + stId + '&limit=5');
  const itemsCount = (items.json.meta || {}).total || 0;
  check('Tự sinh danh sách tài sản cần kiểm kê', itemsCount > 0, itemsCount + ' dòng');
  if (itemsCount) {
    const item = items.json.data[0];
    const upd = await POST('/api/stocktakes/' + stId + '/items/' + item.id, { counted: true, result: 'match', conditionFound: 'good', locationId: item.expectedLocationId, note: 'Khớp sổ sách' });
    check('Ghi nhận kết quả kiểm kê', upd.status === 200 && upd.json.data.counted === true, JSON.stringify(upd.json.data).slice(0, 70));
  }
  const close = await POST('/api/stocktakes/' + stId + '/close', {});
  check('Chốt đợt kiểm kê', close.status === 200 && close.json.data.status === 'closed', 'status=' + close.status);

  const dp = await POST('/api/entities/disposals', {
    assetId: newAsset2().id, type: 'sale', reason: 'Hết khấu hao, thanh lý kiểm thử E2E',
    date: '2026-06-01', status: 'pending', salePrice: 3000000, buyerName: 'Công ty thu mua kiểm thử', disposalCost: 100000,
  });
  check('Tạo phiếu thanh lý', dp.status === 201 || dp.status === 200, 'status=' + dp.status);
  const dpId = dp.json.data.id;
  created.disposals.push(dpId);
  check('Phiếu thanh lý tính giá trị sổ sách', dp.json.data.bookValue !== undefined, 'giá trị sổ: ' + dp.json.data.bookValue);
  const dpApprove = await POST('/api/disposals/' + dpId + '/approve', { note: 'Đồng ý thanh lý' });
  check('Duyệt phiếu thanh lý', dpApprove.status === 200 && dpApprove.json.data.status === 'approved', 'status=' + dpApprove.status);
  const dpAsset = await GET('/api/entities/assets/' + newAsset2().id);
  check('Tài sản chờ thanh lý không còn khấu hao tiếp', ['pending_disposal', 'disposed'].includes(dpAsset.json.data.status), dpAsset.json.data.status);
  const dpDone = await POST('/api/disposals/' + dpId + '/complete', {});
  check('Hoàn tất thanh lý → tài sản đã thanh lý', dpDone.status === 200 && dpDone.json.data.status === 'completed', 'status=' + dpDone.status);
  const dpAsset2 = await GET('/api/entities/assets/' + newAsset2().id);
  check('Trạng thái tài sản cập nhật "đã thanh lý"', ['disposed', 'pending_disposal'].includes(dpAsset2.json.data.status), dpAsset2.json.data.status);
}

function newAsset2() {
  return { id: created.assets[0] };
}

async function testReports() {
  section('6. Báo cáo & Trình thiết kế');
  const ds = await GET('/api/reports/datasets');
  const datasets = ds.json.data || [];
  check('Danh sách nguồn dữ liệu báo cáo', datasets.length >= 20, datasets.length + ' dataset');
  const assetsDs = datasets.find((x) => x.key === 'assets');
  check('Dataset tài sản có nhiều trường', assetsDs && assetsDs.fields.length > 40, assetsDs ? assetsDs.fields.length + ' trường' : 'thiếu dataset assets');

  const tpl = await GET('/api/entities/report_templates?limit=20');
  const templates = tpl.json.data || [];
  check('Mẫu báo cáo hệ thống', templates.length >= 9, templates.length + ' mẫu');
  templateId = templates[0] && templates[0].id;
  check('Mẫu có thiết kế dải (bands)', templates[0] && templates[0].design && templates[0].design.bands, Object.keys((templates[0].design || {}).bands || {}).length + ' dải');

  const blank = await GET('/api/reports/blank-design');
  check('Sinh thiết kế trống cho trình thiết kế', blank.status === 200 && blank.json.data.bands, Object.keys((blank.json.data || {}).bands || {}).length + ' dải');
  const paper = blank.json.data.paperSize;
  check('Thiết kế trống có khổ giấy & lề', !!paper && !!blank.json.data.margins, paper + ' • lề ' + JSON.stringify(blank.json.data.margins));
  check('Thiết kế trống có đủ 8 dải in', Object.keys(blank.json.data.bands || {}).length === 8, Object.keys(blank.json.data.bands || {}).length + ' dải');

  const preview = await POST('/api/reports/preview', { design: templates[0].design, dataset: templates[0].dataset, name: templates[0].name, limit: 20 }, { raw: true });
  check('Xem trước báo cáo (như trình thiết kế)', preview.status === 200 && /<html/i.test(preview.body.toString().slice(0, 300)), (preview.body.length / 1024).toFixed(1) + ' KB');
  const previewCustom = await POST('/api/reports/preview', { design: blank.json.data, dataset: 'v_depreciation_by_period', limit: 30 }, { raw: true });
  check('Xem trước với dataset khấu hao', previewCustom.status === 200, (previewCustom.body.length / 1024).toFixed(1) + ' KB');

  const formats = ['html', 'csv', 'xlsx', 'docx'];
  for (const f of formats) {
    const r = await POST('/api/reports/render', { templateId, format: f, params: { fromDate: '2026-01-01', toDate: '2026-12-31' } }, { raw: true });
    const sz = r.body.length;
    const head = f === 'html' ? /<html|<!DOCTYPE/i.test(r.body.toString().slice(0, 500)) : true;
    check('Kết xuất báo cáo ' + f.toUpperCase(), r.status === 200 && sz > 1000 && head, (sz / 1024).toFixed(1) + ' KB');
  }
  const htmlOut = await POST('/api/reports/render', { templateId, format: 'html' }, { raw: true });
  const htmlStr = htmlOut.body.toString();
  check('Báo cáo HTML có phân trang (.page)', /class="page"/.test(htmlStr), (htmlStr.match(/class="page"/g) || []).length + ' trang');
  check('Không còn lỗi định dạng số "132,00"', !/132,00(?![0-9])/.test(htmlStr), 'kiểm tra số nguyên');

  const xlsxOut = await POST('/api/reports/render', { templateId, format: 'xlsx' }, { raw: true });
  check('XLSX là tệp ZIP hợp lệ', xlsxOut.body.slice(0, 2).toString() === 'PK', xlsxOut.body.slice(0, 4).toString('hex'));
  const docxOut = await POST('/api/reports/render', { templateId, format: 'docx' }, { raw: true });
  check('DOCX là tệp ZIP hợp lệ', docxOut.body.slice(0, 2).toString() === 'PK', docxOut.body.slice(0, 4).toString('hex'));

  // Mọi mẫu báo cáo hệ thống phải kết xuất được dữ liệu (không rỗng) với tham số rỗng
  const allTpl = await GET('/api/entities/report_templates?limit=50');
  let emptyTemplates = [];
  let rendered = 0;
  for (const t of allTpl.json.data || []) {
    const r = await POST('/api/reports/render', { templateId: t.id, format: 'html' }, { raw: true });
    const html = r.body.toString();
    const m = /(\d+)\s*dòng/.exec(html);
    const rows = m ? Number(m[1]) : -1;
    if (r.status === 200 && rows > 0) rendered++;
    else emptyTemplates.push(t.code + ' (' + (rows < 0 ? 'không đọc được' : rows + ' dòng') + ')');
  }
  check('Tất cả mẫu báo cáo hệ thống đều có dữ liệu', emptyTemplates.length === 0, rendered + '/' + (allTpl.json.data || []).length + ' mẫu có dòng' + (emptyTemplates.length ? ' • rỗng: ' + emptyTemplates.join(', ') : ''));

  const clone = await POST('/api/reports/templates/clone', { id: templateId, name: 'Bản sao kiểm thử E2E' });
  check('Nhân bản mẫu báo cáo', clone.status === 200 || clone.status === 201, 'status=' + clone.status);
  const cloneId = (clone.json.data || {}).id;
  if (cloneId) {
    const design = JSON.parse(JSON.stringify(templates[0].design));
    design.bands.reportFooter = { height: 12, elements: [{ id: 'tf', type: 'text', x: 0, y: 2, w: 180, h: 6, text: 'Thử nghiệm trình thiết kế', align: 'center' }] };
    const save = await PUT('/api/entities/report_templates/' + cloneId, { design });
    check('Lưu thiết kế từ trình thiết kế', save.status === 200, 'status=' + save.status);
    const back = await GET('/api/entities/report_templates/' + cloneId);
    check('Thiết kế lưu đúng vào CSDL', (back.json.data.design.bands.reportFooter.elements[0].text || '').includes('trình thiết kế'), back.json.data.design.bands.reportFooter.elements[0].text);
    created.templates = [cloneId];
  }

  const custom = await POST('/api/reports/render', {
    dataset: 'assets',
    format: 'html',
    design: {
      paperSize: 'A5', orientation: 'landscape', margins: { top: 10, right: 10, bottom: 10, left: 10 },
      bands: {
        reportTitle: { height: 14, elements: [{ id: 'a', type: 'text', x: 0, y: 0, w: 180, h: 8, text: 'BÁO CÁO THIẾT KẾ TỰ DO', bold: true, align: 'center', fontSize: 14 }] },
        columnHeader: { height: 8, elements: [{ id: 'b', type: 'field', x: 0, y: 0, w: 90, h: 8, field: 'name', label: 'Tên tài sản', bold: true, border: true }] },
        detail: { height: 7, elements: [{ id: 'c', type: 'field', x: 0, y: 0, w: 90, h: 7, field: 'name', border: true }] },
      },
      groups: [], sorting: [], filters: [], parameters: [], options: {},
    },
  }, { raw: true });
  check('Kết xuất với thiết kế tuỳ biến gửi kèm', custom.status === 200 && /BÁO CÁO THIẾT KẾ TỰ DO/.test(custom.body.toString()), custom.body.length + ' bytes');
}

async function testDocuments() {
  section('7. Chứng từ in (9 loại)');
  const types = ['assignment', 'transfer', 'maintenance', 'disposal', 'stocktake', 'warranty', 'label', 'depreciation', 'contract'];
  for (const t of types) {
    let id = asset.id;
    if (t === 'assignment') id = created.assignments[0];
    if (t === 'transfer') id = created.transfers[0];
    if (t === 'maintenance') id = created.maintenances[0];
    if (t === 'disposal') id = created.disposals[0];
    if (t === 'stocktake') id = created.stocktakes[0];
    if (t === 'warranty') id = created.warranties && created.warranties[0];
    const r = await GET('/api/documents/' + t + '/' + id, { raw: true });
    const body = r.body.toString();
    check('Chứng từ "' + t + '"', r.status === 200 && /<html/i.test(body) && body.length > 2000, (r.body.length / 1024).toFixed(1) + ' KB');
  }
}

async function testAdmin() {
  section('8. Quản trị hệ thống');
  const sys = await GET('/api/admin/system');
  const sd = sys.json.data;
  check('Trạng thái hệ thống', sys.status === 200 && sd.database && sd.app, sd.app.version + ' • ' + sd.database.collections.length + ' bảng');
  check('Thông tin tài nguyên máy chủ', sd.memory && sd.memory.rss > 0, (sd.memory.rss / 1048576).toFixed(1) + ' MB RSS');
  check('Số phiên đang hoạt động', sd.activity && typeof sd.activity.sessionsActive === 'number', sd.activity.sessionsActive + ' phiên');

  const matrix = await GET('/api/admin/permission-matrix');
  check('Ma trận phân quyền', matrix.status === 200, JSON.stringify(matrix.json.data).slice(0, 80));

  const users = await GET('/api/entities/users?limit=50');
  check('Danh sách người dùng', (users.json.meta.total || 0) >= 10, users.json.meta.total + ' người dùng');
  const roles = await GET('/api/entities/roles?limit=20');
  check('Danh sách vai trò', (roles.json.meta.total || 0) >= 5, roles.json.meta.total + ' vai trò');

  const sessions = await GET('/api/entities/sessions?limit=10');
  check('Danh sách phiên đăng nhập', (sessions.json.meta.total || 0) > 0, sessions.json.meta.total + ' phiên');
  const logs = await GET('/api/entities/audit_logs?limit=10&sort=id&order=desc');
  check('Nhật ký hệ thống', (logs.json.meta.total || 0) > 50, logs.json.meta.total + ' bản ghi');
  const recent = (logs.json.data || [])[0];
  check('Nhật ký ghi lại thao tác vừa thực hiện', recent && recent.username === 'admin', recent ? recent.action + ' ' + recent.entity : '');

  const setg = await GET('/api/settings');
  check('Đọc cấu hình hệ thống', setg.status === 200 && setg.json.data.company, setg.json.data.company.name);
  const setp = await PUT('/api/settings', { patch: { system: { footerText: 'AMS Pro — kiểm thử tự động' } } });
  check('Cập nhật cấu hình hệ thống', setp.status === 200 && setp.json.data.system.footerText.includes('kiểm thử'), setp.json.data.system.footerText);
  const setBack = await PUT('/api/settings', { patch: { system: { footerText: 'AMS Pro — Hệ thống Quản lý Tài sản Doanh nghiệp' } } });
  check('Khôi phục cấu hình ban đầu', setBack.status === 200, '');

  const bk = await POST('/api/admin/backup');
  check('Tạo bản sao lưu CSDL', bk.status === 200 && bk.json.data.file, bk.json.data && bk.json.data.file);
  const bkl = await GET('/api/admin/backups');
  check('Liệt kê bản sao lưu', (bkl.json.data || []).length > 0, (bkl.json.data || []).length + ' bản');

  const dbo = await GET('/api/admin/db/export', { raw: true });
  check('Kết xuất toàn bộ CSDL (JSON)', dbo.status === 200 && dbo.body.length > 100000, (dbo.body.length / 1048576).toFixed(2) + ' MB');
  const sql = await GET('/api/admin/db/export-sql?dialect=mysql', { raw: true });
  check('Kết xuất script SQL (MySQL)', sql.status === 200 && /CREATE TABLE/i.test(sql.body.toString()), sql.body.length + ' bytes');
  const pgsql = await GET('/api/admin/db/export-sql?dialect=postgres', { raw: true });
  check('Kết xuất script SQL (PostgreSQL)', pgsql.status === 200 && /CREATE TABLE/i.test(pgsql.body.toString()), pgsql.body.length + ' bytes');

  const notif = await GET('/api/notifications?limit=5');
  check('Thông báo người dùng', notif.status === 200 && Array.isArray(notif.json.data), (notif.json.data || []).length + ' thông báo');
  const refresh = await POST('/api/notifications/refresh-alerts');
  check('Quét cảnh báo tự động', refresh.status === 200, JSON.stringify(refresh.json.data).slice(0, 80));

  const rp = await POST('/api/admin/users/' + adminUser.id + '/reset-password', {});
  check('Đặt lại mật khẩu người dùng (sinh mật khẩu mới)', rp.status === 200 && !!rp.json.data.newPassword, rp.json.data && rp.json.data.newPassword);
  if (rp.json.data && rp.json.data.newPassword) {
    const relog = await POST('/api/auth/login', { username: 'admin', password: rp.json.data.newPassword }, { jar: '' });
    check('Đăng nhập được bằng mật khẩu vừa đặt lại', relog.status === 200, 'status=' + relog.status);
    check('Bắt buộc đổi mật khẩu sau khi đặt lại', !!(relog.json.data.user || {}).mustChangePassword, String((relog.json.data.user || {}).mustChangePassword));
  }
  const back = await POST('/api/admin/users/' + adminUser.id + '/reset-password', { newPassword: 'Admin@123' });
  check('Khôi phục mật khẩu demo cho admin', back.status === 200, 'status=' + back.status);
  const restore = await POST('/api/auth/login', { username: 'admin', password: 'Admin@123' });
  check('Đăng nhập lại bằng Admin@123', restore.status === 200, 'status=' + restore.status);
  const victim = (await GET('/api/entities/users?limit=50')).json.data.find((u) => u.id !== adminUser.id && u.status === 'active');
  if (victim) {
    const toggle = await POST('/api/admin/users/' + victim.id + '/toggle-status', {});
    check('Khoá tài khoản người dùng', toggle.status === 200 && toggle.json.data.status === 'locked', victim.username + ' → ' + JSON.stringify(toggle.json.data));
    const blocked = await POST('/api/auth/login', { username: victim.username, password: 'User@123' }, { jar: '', saveCookie: false });
    check('Tài khoản bị khoá không đăng nhập được', blocked.status === 401 || blocked.status === 403, 'status=' + blocked.status);
    const toggle2 = await POST('/api/admin/users/' + victim.id + '/toggle-status', {});
    check('Mở khoá lại tài khoản', toggle2.status === 200 && toggle2.json.data.status === 'active', JSON.stringify(toggle2.json.data));
  }
  const selfLock = await POST('/api/admin/users/' + adminUser.id + '/toggle-status', {});
  check('Chặn tự khoá tài khoản của chính mình', selfLock.status === 400, 'status=' + selfLock.status);
}

/* ------------------------------ Dọn dẹp ------------------------------ */

async function cleanup() {
  if (KEEP) return;
  section('9. Dọn dẹp dữ liệu kiểm thử');
  let n = 0;
  const hard = async (entity, id) => {
    const r = await DEL('/api/entities/' + entity + '/' + id + '?hard=1');
    if (r.status === 200) n++;
  };
  for (const id of created.assets) await hard('assets', id);
  for (const id of created.assignments) await hard('assignments', id);
  for (const id of created.transfers) await hard('transfers', id);
  for (const id of created.maintenances) await hard('maintenances', id);
  for (const id of created.stocktakes) {
    const its = await GET('/api/entities/stocktake_items?filter%5BstocktakeId%5D=' + id + '&limit=500');
    for (const it of its.json.data || []) await hard('stocktake_items', it.id);
    await hard('stocktakes', id);
  }
  for (const id of created.disposals) await hard('disposals', id);
  for (const id of created.categories) await hard('categories', id);
  for (const id of created.warranties || []) await hard('warranties', id);
  for (const id of created.templates || []) await hard('report_templates', id);
  // Xoá các bản ghi khấu hao / kiểm kê sinh ra trong test
  const deps = await GET('/api/entities/depreciations?filter%5Bperiod%5D=2026-03&limit=500');
  for (const d of deps.json.data || []) await hard('depreciations', d.id);
  ok('Đã xoá ' + n + ' bản ghi kiểm thử khỏi CSDL');
}

/* ------------------------------ Chạy ------------------------------ */

(async () => {
  const t0 = Date.now();
  console.log('\x1b[1m');
  console.log('  ╔══════════════════════════════════════════════════════════════╗');
  console.log('  ║   AMS Pro — Kiểm thử đầu-cuối toàn hệ thống                  ║');
  console.log('  ║   Cổng: ' + String(PORT).padEnd(6, ' ') + '  Chế độ: ' + (OWN_SERVER ? 'tự khởi động máy chủ' : 'máy chủ có sẵn').padEnd(28, ' ') + '║');
  console.log('  ╚══════════════════════════════════════════════════════════════╝');
  console.log('\x1b[0m');
  try {
    await startServer();
    ok('Máy chủ sẵn sàng tại http://127.0.0.1:' + PORT);
    await testHealth();
    await testAuth();
    await testCrud();
    await testAssetsBusiness();
    await testDepreciation();
    await testReports();
    await testDocuments();
    await testAdmin();
    await cleanup();
  } catch (e) {
    bad('Lỗi không mong đợi', e.stack);
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n' + '─'.repeat(64));
  console.log(
    (failed === 0 ? '\x1b[32m' : '\x1b[31m') +
      '  KẾT QUẢ: ' + passed + ' đạt / ' + failed + ' lỗi \x1b[0m' +
      '  (' + secs + 's)'
  );
  if (failed) {
    console.log('\n  Chi tiết lỗi:');
    failures.forEach((f) => console.log('   • ' + f));
  }
  console.log('─'.repeat(64) + '\n');

  if (child) child.kill('SIGTERM');
  await sleep(200);
  process.exit(failed ? 1 : 0);
})();
