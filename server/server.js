'use strict';
/**
 * server.js — Điểm khởi động hệ thống AMS Pro
 * - Phục vụ API tại /api/*
 * - Phục vụ giao diện SPA trong thư mục /public
 * - Tự khởi tạo dữ liệu mẫu ở lần chạy đầu tiên
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const store = require('./lib/store');
const schema = require('./lib/schema');
const service = require('./lib/service');
const auth = require('./lib/auth');
const httpLib = require('./lib/http');
const routes = require('./routes');
const seed = require('./seed');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

/* ------------------------- Khởi tạo dữ liệu ------------------------- */
store.init();
if (store.isEmpty()) {
  console.log('[init] Cơ sở dữ liệu trống — đang khởi tạo dữ liệu mẫu tiếng Việt...');
  const result = seed.run({});
  console.log('[init] Đã tạo:', JSON.stringify(result.counts || {}, null, 0));
}

/**
 * Trang thông báo hết phiên cho các yêu cầu mở trực tiếp bằng trình duyệt
 * (ví dụ bấm in/nhãn tem mở tab mới sau khi phiên đã hết hạn).
 */
function sessionExpiredPage(pathname) {
  const back = '/';
  return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Phiên làm việc đã hết hạn — AMS Pro</title>
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#eef2f7;
       font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#0f172a;padding:24px}
  .box{background:#fff;border-radius:16px;box-shadow:0 18px 40px rgba(15,23,42,.12);padding:32px 34px;max-width:520px;width:100%;text-align:center}
  .icon{font-size:40px;line-height:1}
  h1{font-size:19px;margin:14px 0 8px}
  p{margin:0 0 6px;color:#475569;font-size:14px;line-height:1.6}
  code{background:#f1f5f9;border-radius:6px;padding:2px 6px;font-size:12.5px;color:#334155;word-break:break-all}
  .row{display:flex;gap:10px;justify-content:center;margin-top:22px;flex-wrap:wrap}
  a.btn{display:inline-block;padding:11px 20px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;background:#2563eb;color:#fff}
  a.btn.ghost{background:#f1f5f9;color:#0f172a}
  .hint{margin-top:18px;font-size:12.5px;color:#94a3b8}
</style></head>
<body>
  <div class="box">
    <div class="icon">🔒</div>
    <h1>Phiên làm việc đã hết hạn (lỗi 401)</h1>
    <p>Tài liệu bạn yêu cầu cần đăng nhập lại mới xem được:</p>
    <p><code>${String(pathname || '').replace(/[<>&"]/g, '')}</code></p>
    <div class="row">
      <a class="btn" href="${back}">Đăng nhập lại</a>
      <a class="btn ghost" href="javascript:history.back()">Quay lại</a>
    </div>
    <div class="hint">Mẹo: hãy in/nhãn tem từ trong ứng dụng để tab mới giữ được phiên đăng nhập.</div>
  </div>
</body></html>`;
}

/* ------------------------------ Router ------------------------------ */
const router = new httpLib.Router();
routes.register(router);

const PUBLIC_PATHS = ['/api/auth/login', '/api/health'];

async function handleRequest(req, res) {
  const started = Date.now();
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsed.pathname;

  // CORS nhẹ cho phép tích hợp ngoài (ví dụ mở báo cáo ở tab khác).
  // Ứng dụng cũng chạy được trong khung nhúng sandbox — khi đó trình duyệt gửi
  // "Origin: null"; trả về "*" (không dùng cookie, xác thực bằng token) để không
  // bị chặn CORS.
  const reqOrigin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', reqOrigin && reqOrigin !== 'null' ? reqOrigin : '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    // ---------- API ----------
    if (pathname.startsWith('/api/')) {
      const match = router.match(req.method, pathname);
      if (!match) return httpLib.sendError(res, 404, `Không tìm thấy API: ${req.method} ${pathname}`);

      let user = null;
      if (!PUBLIC_PATHS.includes(pathname)) {
        user = routes.loadUserFromRequest(req);
        if (!user) {
          // Mở trực tiếp bằng trình duyệt (tab mới, in ấn…) → trả trang HTML dễ hiểu
          // thay vì JSON thô, kèm nút quay lại đăng nhập.
          if (req.method === 'GET' && String(req.headers.accept || '').includes('text/html')) {
            res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(sessionExpiredPage(pathname));
          }
          return httpLib.sendError(res, 401, 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.');
        }
      } else {
        user = routes.loadUserFromRequest(req);
      }

      let body = {};
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        body = await httpLib.readBody(req);
      }

      const ctx = {
        req,
        res,
        url: parsed,
        query: parsed.searchParams,
        params: match.params,
        body,
        user,
        started,
      };

      await match.route.handler(ctx);

      // Ghi log hiệu năng cho các API ghi dữ liệu
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && user && !['/api/auth/login', '/api/auth/logout'].includes(pathname)) {
        const dur = Date.now() - started;
        if (dur > 1500) {
          service.audit('RUN', 'performance', { username: user.username, userId: user.id, entityLabel: `API chậm: ${req.method} ${pathname} (${dur}ms)`, path: pathname, method: req.method, durationMs: dur });
        }
      }
      return;
    }

    // ---------- Tài nguyên tĩnh / SPA ----------
    const served = httpLib.serveStatic(PUBLIC_DIR, pathname, res, 'index.html');
    if (!served) {
      const rel = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
      const candidate = path.join(PUBLIC_DIR, rel);
      if (fs.existsSync(candidate)) return httpLib.serveStatic(PUBLIC_DIR, pathname, res);
      // Mọi đường dẫn khác trả về SPA (client-side routing)
      return httpLib.serveStatic(PUBLIC_DIR, '/index.html', res);
    }
    return;
  } catch (err) {
    console.error('[error]', err);
    if (!res.headersSent) httpLib.sendError(res, 500, 'Lỗi hệ thống: ' + err.message);
    return;
  }
}

const server = http.createServer(handleRequest);

server.listen(PORT, HOST, () => {
  const cfg = service.settings();
  const lines = [
    '',
    '  ╔══════════════════════════════════════════════════════════════╗',
    '  ║          AMS PRO - HỆ THỐNG QUẢN LÝ TÀI SẢN DOANH NGHIỆP     ║',
    '  ╚══════════════════════════════════════════════════════════════╝',
    '',
    `  Ứng dụng      : ${cfg.system.appFullName} v${cfg.system.version}`,
    `  Địa chỉ       : http://localhost:${PORT}`,
    `  Môi trường    : Node ${process.version} trên ${os.platform()}`,
    `  CSDL          : data/db.json (${Object.keys(store.collections).length} bảng)`,
    '',
    '  Tài khoản mặc định:',
    '    • Quản trị viên : admin / Admin@123',
    '    • Kế toán       : ketoan.truong / User@123',
    '    • Thủ kho       : thukho / User@123',
    '    • Kỹ thuật      : kythuat.01 / User@123',
    '    • Nhân viên     : nhanvien.01 / User@123',
    '',
    `  Số bản ghi: ${['assets', 'users', 'departments', 'maintenances', 'depreciations', 'report_templates'].map((k) => `${k}=${store.all(k).length}`).join(', ')}`,
    '',
  ];
  console.log(lines.join('\n'));
});

process.on('SIGINT', () => {
  console.log('\n[shutdown] Đang lưu dữ liệu...');
  store.flush();
  process.exit(0);
});
process.on('SIGTERM', () => {
  store.flush();
  process.exit(0);
});
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

module.exports = server;
