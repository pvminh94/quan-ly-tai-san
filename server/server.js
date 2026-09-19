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

/* ------------------------------ Router ------------------------------ */
const router = new httpLib.Router();
routes.register(router);

const PUBLIC_PATHS = ['/api/auth/login', '/api/health'];

async function handleRequest(req, res) {
  const started = Date.now();
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsed.pathname;

  // CORS nhẹ cho phép tích hợp ngoài (ví dụ mở báo cáo ở tab khác)
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
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
        if (!user) return httpLib.sendError(res, 401, 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.');
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
