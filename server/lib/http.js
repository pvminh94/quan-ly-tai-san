'use strict';
/**
 * http.js — HTTP router siêu nhẹ + tiện ích request/response/static file
 */

const fs = require('fs');
const path = require('path');
const url = require('url');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
};

class Router {
  constructor() {
    this.routes = [];
    this.middlewares = [];
  }

  use(fn) {
    this.middlewares.push(fn);
  }

  add(method, pattern, handler, opts) {
    const keys = [];
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/\/:([A-Za-z0-9_]+)/g, (m, key) => {
            keys.push(key);
            return '/([^/]+)';
          })
          .replace(/\*/g, '(.*)') +
        '/?$'
    );
    this.routes.push({ method, regex, keys, handler, opts: opts || {} });
  }

  get(p, h, o) {
    this.add('GET', p, h, o);
  }
  post(p, h, o) {
    this.add('POST', p, h, o);
  }
  put(p, h, o) {
    this.add('PUT', p, h, o);
  }
  patch(p, h, o) {
    this.add('PATCH', p, h, o);
  }
  delete(p, h, o) {
    this.add('DELETE', p, h, o);
  }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.regex.exec(pathname);
      if (m) {
        const params = {};
        route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        return { route, params };
      }
    }
    return null;
  }
}

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload === undefined ? null : payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text, type) {
  res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(text);
}

function sendError(res, status, message, extra) {
  sendJSON(res, status, Object.assign({ error: true, message, status }, extra || {}));
}

function readBody(req, limitMb) {
  return new Promise((resolve, reject) => {
    const max = (limitMb || 32) * 1024 * 1024;
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(new Error('Payload quá lớn'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      const ct = req.headers['content-type'] || '';
      if (ct.includes('application/json')) {
        try {
          return resolve(JSON.parse(raw));
        } catch (e) {
          return reject(new Error('JSON không hợp lệ: ' + e.message));
        }
      }
      if (ct.includes('application/x-www-form-urlencoded')) {
        return resolve(Object.fromEntries(new URLSearchParams(raw)));
      }
      resolve({ raw });
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}

/** Phục vụ file tĩnh, chống path traversal */
function serveStatic(rootDir, reqPath, res, fallbackFile) {
  let rel = decodeURIComponent(reqPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(rootDir, safe);
  if (!filePath.startsWith(rootDir)) {
    sendError(res, 403, 'Truy cập bị từ chối');
    return true;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    if (fallbackFile) {
      const fb = path.join(rootDir, fallbackFile);
      if (fs.existsSync(fb)) return sendFile(fb, res);
    }
    return false;
  }
  return sendFile(filePath, res);
}

function sendFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=60',
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

module.exports = {
  Router,
  sendJSON,
  sendText,
  sendError,
  readBody,
  parseCookies,
  clientIp,
  serveStatic,
  MIME,
};
