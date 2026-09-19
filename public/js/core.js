/* ==========================================================================
   core.js — Lõi ứng dụng: trạng thái, API client, định tuyến, tiện ích
   ========================================================================== */
(function () {
  'use strict';

  const App = {
    state: {
      user: null,
      permissions: {},
      meta: null,
      entities: {},
      enums: {},
      settings: {},
      notifications: [],
      route: { name: '', params: {}, query: {} },
      cache: {},
      sidebarCollapsed: localStorage.getItem('ams.sidebar') === '1',
      theme: localStorage.getItem('ams.theme') || 'light',
    },
    bus: {},
  };
  window.App = App;

  /* ------------------------------ Tiện ích ------------------------------ */
  const U = {
    esc(s) {
      return String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    attr(s) { return U.esc(s); },
    num(v, d) {
      const n = Number(v || 0);
      if (isNaN(n)) return '0';
      return n.toLocaleString('vi-VN', { minimumFractionDigits: d || 0, maximumFractionDigits: d === undefined ? 0 : d });
    },
    money(v, d) {
      if (v === null || v === undefined || v === '') return '0';
      const n = Number(v);
      const digits = d === undefined ? (App.state.settings.digits === undefined ? 0 : App.state.settings.digits) : d;
      return n.toLocaleString('vi-VN', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + (App.state.settings.currencySymbol || '');
    },
    moneyShort(v) {
      const n = Number(v || 0);
      const abs = Math.abs(n);
      const sign = n < 0 ? '-' : '';
      if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2).replace('.', ',') + ' tỷ';
      if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1).replace('.', ',') + ' tr';
      if (abs >= 1e3) return sign + (abs / 1e3).toFixed(0) + ' ng';
      return sign + U.num(abs);
    },
    pct(v, d) { return U.num(v, d === undefined ? 1 : d) + '%'; },
    date(v, fallback) {
      if (!v) return fallback === undefined ? '—' : fallback;
      const d = new Date(v);
      if (isNaN(d)) return U.esc(v);
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    },
    datetime(v, fallback) {
      if (!v) return fallback === undefined ? '—' : fallback;
      const d = new Date(v);
      if (isNaN(d)) return U.esc(v);
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    },
    timeAgo(v) {
      if (!v) return '';
      const diff = (Date.now() - new Date(v).getTime()) / 1000;
      if (diff < 60) return 'vừa xong';
      if (diff < 3600) return Math.floor(diff / 60) + ' phút trước';
      if (diff < 86400) return Math.floor(diff / 3600) + ' giờ trước';
      if (diff < 2592000) return Math.floor(diff / 86400) + ' ngày trước';
      return U.date(v);
    },
    today() { return new Date().toISOString().slice(0, 10); },
    addDays(dateStr, days) {
      const d = dateStr ? new Date(dateStr) : new Date();
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    },
    initials(name) {
      const parts = String(name || '?').trim().split(/\s+/);
      return (parts[parts.length - 1] || '?').charAt(0).toUpperCase();
    },
    slug(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase(); },
    debounce(fn, ms) {
      let t; return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms || 300); };
    },
    download(filename, content, mime) {
      const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 400);
    },
    parseCSV(text) {
      const rows = [];
      let row = [], cell = '', inQ = false;
      const clean = text.replace(/^\ufeff/, '');
      for (let i = 0; i < clean.length; i++) {
        const c = clean[i];
        if (inQ) {
          if (c === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
          else if (c === '"') inQ = false;
          else cell += c;
        } else if (c === '"') inQ = true;
        else if (c === ',' || c === ';') { row.push(cell); cell = ''; }
        else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
        else if (c !== '\r') cell += c;
      }
      if (cell || row.length) { row.push(cell); rows.push(row); }
      return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
    },
    // Tìm không dấu
    norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase(); },
    qs(obj) {
      const p = new URLSearchParams();
      Object.keys(obj || {}).forEach((k) => {
        const v = obj[k];
        if (v === undefined || v === null || v === '') return;
        if (typeof v === 'object') Object.keys(v).forEach((k2) => p.append(`${k}[${k2}]`, v[k2]));
        else p.append(k, v);
      });
      return p.toString();
    },
    clone(o) { return JSON.parse(JSON.stringify(o === undefined ? null : o)); },
    colorOf(list, value) {
      const found = (list || []).find((x) => String(x.value) === String(value));
      return (found && found.color) || '#64748b';
    },
    labelOf(list, value) {
      const found = (list || []).find((x) => String(x.value) === String(value));
      return found ? found.label : (value || '');
    },
    hexToRgba(hex, a) {
      const h = String(hex || '#64748b').replace('#', '');
      const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    },
  };
  App.U = U;

  /* ------------------------------ API client ------------------------------ */
  const api = {
    async request(method, path, body, opts) {
      const o = opts || {};
      const init = { method, credentials: 'same-origin', headers: {} };
      if (body instanceof FormData) init.body = body;
      else if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      let res;
      try {
        res = await fetch(path, init);
      } catch (e) {
        throw new Error('Không kết nối được tới máy chủ. Vui lòng kiểm tra kết nối.');
      }
      if (res.status === 204) return null;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        if (!res.ok) throw new Error('Lỗi ' + res.status);
        return res;
      }
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401 && !o.silent) {
          if (App.state.user) UI.toast('Phiên làm việc đã hết hạn', 'Vui lòng đăng nhập lại.', 'warning');
          App.showLogin();
        }
        const err = new Error(data.message || 'Lỗi ' + res.status);
        err.status = res.status;
        err.payload = data;
        throw err;
      }
      return data;
    },
    get(p, opts) { return api.request('GET', p, undefined, opts); },
    post(p, b, opts) { return api.request('POST', p, b === undefined ? {} : b, opts); },
    put(p, b, opts) { return api.request('PUT', p, b, opts); },
    del(p, opts) { return api.request('DELETE', p, undefined, opts); },
    /** Tải file (CSV, DOCX, XLSX, SQL...) */
    async download(path, method, body, filename) {
      const init = { method: method || 'GET', credentials: 'same-origin' };
      if (body) { init.method = method || 'POST'; init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
      const res = await fetch(path, init);
      if (!res.ok) {
        let msg = 'Lỗi ' + res.status;
        try { const j = await res.json(); msg = j.message || msg; } catch (e) {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      let name = filename;
      if (!name) {
        const m = /filename="?([^";]+)"?/.exec(cd);
        name = m ? decodeURIComponent(m[1]) : 'download';
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 400);
      return name;
    },
    /** Mở báo cáo/chứng từ trong tab mới (in trực tiếp) */
    async openHTML(path, method, body, opts) {
      const o = opts || {};
      const win = window.open('', '_blank');
      if (win) win.document.write('<html lang="vi"><head><title>Đang tạo…</title><style>body{font-family:sans-serif;padding:40px;color:#64748b}</style></head><body><h3>⏳ Đang tạo tài liệu, vui lòng đợi…</h3></body></html>');
      try {
        const init = { method: method || 'GET', credentials: 'same-origin' };
        if (body) { init.method = method || 'POST'; init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
        const res = await fetch(path, init);
        const html = await res.text();
        if (!res.ok) {
          let msg = 'Lỗi ' + res.status;
          try { msg = JSON.parse(html).message || msg; } catch (e) {}
          throw new Error(msg);
        }
        if (win) { win.document.open(); win.document.write(html); win.document.close(); }
        else {
          const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.click();
        }
        return win;
      } catch (e) {
        if (win) win.close();
        if (!o.silent) UI.toast('Không tạo được tài liệu', e.message, 'error');
        throw e;
      }
    },
  };
  App.api = api;

  /* ------------------------------ Phân quyền ------------------------------ */
  App.can = function (moduleKey, action) {
    const u = App.state.user;
    if (!u) return false;
    if (u.isSuperAdmin || u.roleCode === 'ADMIN') return true;
    const list = (App.state.permissions || {})[moduleKey];
    if (!list) return false;
    return list.includes('*') || list.includes(action);
  };
  App.canAny = function (moduleKey) {
    return ['view', 'create', 'update', 'delete', 'approve', 'export'].some((a) => App.can(moduleKey, a));
  };

  /* ------------------------------ Định dạng trường ------------------------------ */
  App.fieldLabel = function (entityName, field) {
    const e = App.state.entities[entityName];
    if (!e || !e.fields[field]) return field;
    return e.fields[field].label || field;
  };

  App.formatField = function (entityName, field, value, row) {
    const e = App.state.entities[entityName];
    const f = e && e.fields[field];
    const type = f ? f.type : (typeof value === 'number' ? 'number' : 'string');
    if (f && f.options) {
      const opt = f.options.find((o) => String(o.value) === String(value));
      if (opt) {
        if (f.badge || f.options.some((o) => o.color)) {
          const color = opt.color || '#64748b';
          return `<span class="badge" style="background:${U.hexToRgba(color, .14)};color:${color};border-color:${U.hexToRgba(color, .35)}">${U.esc(opt.label)}</span>`;
        }
        return U.esc(opt.label);
      }
      return value === undefined || value === null || value === '' ? '—' : U.esc(value);
    }
    switch (type) {
      case 'money': return `<span class="mono">${U.money(value)}</span>`;
      case 'number': return `<span class="mono">${U.num(value, Number.isInteger(Number(value)) ? 0 : 2)}</span>`;
      case 'percent': return `<span class="mono">${U.num(value, 1)}%</span>`;
      case 'date': return U.date(value);
      case 'datetime': return U.datetime(value);
      case 'bool': return value ? '<span class="badge" style="background:#dcfce7;color:#15803d;border-color:#86efac">Có</span>' : '<span class="badge soft">Không</span>';
      case 'tags': return (Array.isArray(value) ? value : String(value || '').split(',')).filter(Boolean).map((t) => `<span class="tag">${U.esc(t)}</span>`).join('');
      case 'ref': {
        const label = f && f.refLabel ? (row && row[f.refLabel]) : null;
        return value ? U.esc(label || '#' + value) : '—';
      }
      case 'text': return value ? U.esc(String(value).slice(0, 120)) + (String(value).length > 120 ? '…' : '') : '—';
      default:
        if (typeof value === 'number') return U.num(value);
        return value === undefined || value === null || value === '' ? '—' : U.esc(value);
    }
  };

  /* ------------------------------ Lưu trữ ưa thích ------------------------------ */
  App.pref = {
    get(key, def) {
      try { const v = localStorage.getItem('ams.pref.' + key); return v === null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    set(key, val) { try { localStorage.setItem('ams.pref.' + key, JSON.stringify(val)); } catch (e) {} },
    remove(key) { try { localStorage.removeItem('ams.pref.' + key); } catch (e) {} },
  };

  /* ------------------------------ Router (hash-based) ------------------------------ */
  const Router = {
    routes: [],
    add(pattern, handler) {
      const keys = [];
      const regex = new RegExp('^' + pattern.replace(/:([A-Za-z0-9_]+)/g, (m, k) => { keys.push(k); return '([^/]+)'; }) + '$');
      Router.routes.push({ pattern, regex, keys, handler });
      return Router;
    },
    navigate(path, replace) {
      if (replace) location.replace('#' + path);
      else location.hash = '#' + path;
    },
    current() {
      const raw = location.hash.replace(/^#/, '') || '/dashboard';
      const [path, qs] = raw.split('?');
      const query = Object.fromEntries(new URLSearchParams(qs || ''));
      for (const r of Router.routes) {
        const m = r.regex.exec(path);
        if (m) {
          const params = {};
          r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
          return { name: r.pattern, params, query, path, handler: r.handler };
        }
      }
      return { name: 'notfound', params: {}, query, path, handler: null };
    },
    resolve() {
      const route = Router.current();
      App.state.route = route;
      const content = document.getElementById('content');
      if (!content) return;
      const scrollTop = window.scrollY;
      if (!route.handler) {
        content.innerHTML = `<div class="card"><div class="empty"><div class="icon">🧭</div><h3>Không tìm thấy trang: ${U.esc(route.path)}</h3><p>Đường dẫn không tồn tại hoặc bạn không có quyền truy cập.</p><a class="btn primary" href="#/dashboard">Về bảng điều khiển</a></div></div>`;
        return;
      }
      try {
        route.handler(route, content);
      } catch (e) {
        console.error(e);
        content.innerHTML = `<div class="card"><div class="empty"><div class="icon">⚠️</div><h3>Đã xảy ra lỗi khi tải trang</h3><p>${U.esc(e.message)}</p><button class="btn" onclick="location.reload()">Tải lại</button></div></div>`;
      }
      window.scrollTo(0, scrollTop > 200 ? 0 : scrollTop);
    },
    start() {
      window.addEventListener('hashchange', () => Router.resolve());
      Router.resolve();
    },
  };
  App.Router = Router;

  /* ------------------------------ Bảng màu & icon ------------------------------ */
  App.PALETTE = ['#2563eb', '#16a34a', '#f59e0b', '#ef4444', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#0f172a', '#0ea5e9', '#84cc16'];
  App.COLORS = { primary: '#2563eb', success: '#16a34a', warning: '#f59e0b', danger: '#dc2626', info: '#0ea5e9', purple: '#7c3aed', slate: '#64748b' };
})();
