'use strict';
/**
 * routes.js — Toàn bộ API nghiệp vụ của hệ thống
 *
 * Nhóm chức năng:
 *  1. Xác thực & phiên làm việc
 *  2. Metadata, danh mục tra cứu (lookups), cấu hình
 *  3. Bảng điều khiển (dashboard) & phân tích
 *  4. CRUD tổng quát cho mọi thực thể (theo metadata) — có phân quyền & nhật ký
 *  5. Workflow: cấp phát, điều chuyển, bảo trì, thanh lý, kiểm kê, khấu hao
 *  6. Báo cáo: dataset, thiết kế mẫu, render HTML/CSV/DOCX/XLSX
 *  7. Quản trị: người dùng, phân quyền, sao lưu, CSDL, nhật ký, phiên
 *  8. Chứng từ in: biên bản bàn giao, điều chuyển, thanh lý, kiểm kê...
 */

const store = require('./lib/store');
const schema = require('./lib/schema');
const service = require('./lib/service');
const auth = require('./lib/auth');
const util = require('./lib/util');
const http = require('./lib/http');
const reports = require('./lib/report-engine');
const docs = require('./lib/documents');

const { ENTITIES, T, PERMISSION_MODULES, PERMISSION_ACTIONS } = schema;
const { sendJSON, sendError, sendText, readBody, parseCookies, clientIp } = http;

const COOKIE = 'ams_token';

/* ============================ TIỆN ÍCH ============================ */

function ok(res, data, meta) {
  sendJSON(res, 200, meta ? { data, meta } : { data });
}

function fail(res, status, message) {
  sendError(res, status, message);
}

function requireEntity(entityName, res) {
  const entity = ENTITIES[entityName];
  if (!entity) {
    sendError(res, 404, `Không tìm thấy thực thể "${entityName}"`);
    return null;
  }
  return entity;
}

function permModuleFor(entityName, entity) {
  return (entity && entity.perm) || entityName;
}

function checkPermission(ctx, moduleKey, action, res) {
  if (ctx.user.isSuperAdmin) return true;
  if (auth.can(ctx.user, moduleKey, action)) return true;
  sendError(res, 403, `Bạn không có quyền "${action}" trên module "${moduleKey}"`);
  return false;
}

/** Lọc bỏ trường readonly/computed khi ghi */
function sanitizePayload(entity, payload, isCreate) {
  const out = {};
  Object.keys(payload || {}).forEach((key) => {
    const field = entity.fields[key];
    if (!field) {
      if (key === 'id') return;
      out[key] = payload[key];
      return;
    }
    if (field.computed || field.readonly) {
      if (isCreate && field.readonly && payload[key] !== undefined && payload[key] !== '' && !field.computed && !field.auto) out[key] = payload[key];
      return;
    }
    let value = payload[key];
    if (field.type === T.NUMBER || field.type === T.MONEY || field.type === T.PERCENT) {
      value = value === '' || value === null || value === undefined ? (field.default !== undefined ? field.default : 0) : Number(value);
      if (isNaN(value)) value = 0;
    }
    if (field.type === T.BOOL) value = value === true || value === 'true' || value === 1 || value === '1';
    if (field.type === T.TAGS && typeof value === 'string') value = value.split(',').map((s) => s.trim()).filter(Boolean);
    out[key] = value;
  });
  return out;
}

/**
 * Nếu toàn bộ lỗi kiểm tra dữ liệu đều là lỗi trùng khoá nghiệp vụ (unique)
 * thì trả về HTTP 409 cho đúng ngữ nghĩa REST, ngược lại 422.
 */
function sendValidationErrors(res, entity, errors) {
  const keys = Object.keys(errors);
  const onlyDuplicate = keys.length > 0 && keys.every((k) => entity.fields[k] && entity.fields[k].unique);
  if (onlyDuplicate) return sendError(res, 409, Object.values(errors)[0], { errors });
  return sendError(res, 422, 'Dữ liệu không hợp lệ', { errors });
}

/** Kiểm tra ràng buộc: bắt buộc, duy nhất, kiểu dữ liệu */
function validatePayload(entity, payload, entityName, existingId) {
  const errors = {};
  Object.keys(entity.fields).forEach((name) => {
    const field = entity.fields[name];
    const value = payload[name];
    if (field.required && (value === undefined || value === null || value === '')) {
      if (!(field.auto && !existingId)) errors[name] = `${field.label} là bắt buộc`;
    }
    if (field.unique && value !== undefined && value !== null && value !== '') {
      const dup = store.all(entityName).find((r) => String(r[field.codeField || name]).toLowerCase() === String(value).toLowerCase() && String(r.id) !== String(existingId));
      const targetField = entity.codeField || name;
      const dup2 = store.all(entityName).find((r) => String(r[targetField]).toLowerCase() === String(value).toLowerCase() && String(r.id) !== String(existingId));
      if (dup || dup2) errors[name] = `${field.label} đã tồn tại trong hệ thống`;
    }
    if (field.type === T.REF && value !== undefined && value !== null && value !== '' && !store.find(field.ref, value)) {
      errors[name] = `${field.label}: không tìm thấy bản ghi tham chiếu`;
    }
  });
  return errors;
}

function diffChanges(before, after) {
  const changes = {};
  Object.keys(after || {}).forEach((k) => {
    const a = before ? before[k] : undefined;
    const b = after[k];
    const sa = JSON.stringify(a === undefined ? null : a);
    const sb = JSON.stringify(b === undefined ? null : b);
    if (sa !== sb) changes[k] = { from: a === undefined ? null : a, to: b === undefined ? null : b };
  });
  return changes;
}

/* ============================ XÁC THỰC ============================ */

function loadUserFromRequest(req) {
  const cookies = parseCookies(req);
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = bearer || cookies[COOKIE];
  const payload = auth.verifyToken(token);
  if (!payload) return null;
  const session = store.findOne('sessions', (s) => s.tokenId === payload.jti);
  if (!session || session.revokedAt) return null;
  if (session.expiresAt && new Date(session.expiresAt) < new Date()) return null;
  const user = store.find('users', payload.uid);
  if (!user || user.isDeleted) return null;
  if (user.status === 'locked') return null;
  store.update('sessions', session.id, { lastSeenAt: new Date().toISOString() });
  const decorated = auth.decorateUser(user);
  decorated.sessionId = session.id;
  return decorated;
}

async function handleLogin(ctx) {
  const { res, body, req } = ctx;
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) return fail(res, 400, 'Vui lòng nhập tên đăng nhập và mật khẩu');
  const user = store.findOne('users', (u) => u.username.toLowerCase() === username.toLowerCase() && !u.isDeleted);
  const ip = clientIp(req);
  if (!user) {
    service.audit('LOGIN_FAILED', 'users', { username, ip, path: '/api/auth/login', entityLabel: username, status: 401 });
    return fail(res, 401, 'Tên đăng nhập hoặc mật khẩu không đúng');
  }
  if (user.status === 'locked') {
    service.audit('LOGIN_FAILED', 'users', { username, userId: user.id, ip, entityLabel: 'Tài khoản bị khoá', status: 403 });
    return fail(res, 403, 'Tài khoản đã bị khoá. Vui lòng liên hệ quản trị viên.');
  }
  const valid = auth.verifyPassword(password, user.passwordSalt, user.passwordHash);
  if (!valid) {
    const failed = (user.failedAttempts || 0) + 1;
    const cfg = service.settings();
    const patch = { failedAttempts: failed };
    if (failed >= (cfg.system.lockAfterFailed || 5)) patch.status = 'locked';
    store.update('users', user.id, patch);
    service.audit('LOGIN_FAILED', 'users', { username, userId: user.id, ip, entityLabel: username, status: 401 });
    return fail(res, 401, failed >= (cfg.system.lockAfterFailed || 5) ? 'Sai mật khẩu quá nhiều lần, tài khoản đã bị khoá' : 'Tên đăng nhập hoặc mật khẩu không đúng');
  }

  const cfg = service.settings();
  const { token, payload } = auth.signToken({ uid: user.id, username: user.username }, cfg.system.sessionHours || 12);
  store.insert('sessions', {
    username: user.username,
    userId: user.id,
    tokenId: payload.jti,
    ip,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 250),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(payload.exp).toISOString(),
    lastSeenAt: new Date().toISOString(),
    revokedAt: null,
  });
  store.update('users', user.id, { lastLoginAt: new Date().toISOString(), failedAttempts: 0 });
  service.audit('LOGIN', 'users', { username: user.username, userId: user.id, ip, entityLabel: user.fullName, path: '/api/auth/login' });

  const decorated = auth.decorateUser(store.find('users', user.id));
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${(cfg.system.sessionHours || 12) * 3600}`);
  sendJSON(res, 200, {
    data: { user: decorated, token, permissions: decorated._permissions },
    meta: { permissionsModules: PERMISSION_MODULES, permissionsActions: PERMISSION_ACTIONS },
  });
}

function handleLogout(ctx) {
  const { res, user } = ctx;
  if (user && user.sessionId) {
    store.update('sessions', user.sessionId, { revokedAt: new Date().toISOString(), revokedBy: user.username });
    service.audit('LOGOUT', 'users', { username: user.username, userId: user.id, entityLabel: user.fullName });
  }
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
  ok(res, { success: true });
}

function handleMe(ctx) {
  const { res, user } = ctx;
  const cfg = service.settings();
  ok(res, {
    user,
    permissions: user._permissions,
    permissionsModules: PERMISSION_MODULES,
    permissionsActions: PERMISSION_ACTIONS,
    company: cfg.company,
    system: cfg.system,
    unreadNotifications: store.filter('notifications', (n) => !n.readAt).length,
  });
}

function handleChangePassword(ctx) {
  const { res, body, user, req } = ctx;
  const cfg = service.settings();
  const oldPass = String(body.oldPassword || '');
  const newPass = String(body.newPassword || '');
  const row = store.find('users', user.id);
  if (!auth.verifyPassword(oldPass, row.passwordSalt, row.passwordHash)) return fail(res, 400, 'Mật khẩu hiện tại không đúng');
  const errs = auth.validatePasswordStrength(newPass, cfg);
  if (errs.length) return fail(res, 400, errs.join('. '));
  const { salt, hash } = auth.hashPassword(newPass);
  store.update('users', user.id, { passwordSalt: salt, passwordHash: hash, mustChangePassword: false, passwordChangedAt: new Date().toISOString() });
  service.audit('CONFIG', 'users', { username: user.username, userId: user.id, entityLabel: 'Đổi mật khẩu', ip: clientIp(req) });
  ok(res, { success: true, message: 'Đổi mật khẩu thành công' });
}

/* ============================ METADATA ============================ */

function publicSettings() {
  const cfg = service.settings();
  return { company: cfg.company, system: cfg.system, depreciation: cfg.depreciation, notifications: cfg.notifications, report: cfg.report };
}

function handleMeta(ctx) {
  const { res, user } = ctx;
  const cfg = service.settings();
  const entities = {};
  Object.keys(ENTITIES).forEach((key) => {
    const e = ENTITIES[key];
    entities[key] = {
      key,
      label: e.label,
      singular: e.singular,
      icon: e.icon,
      perm: e.perm || key,
      prefix: e.prefix,
      codeField: e.codeField || 'code',
      softDelete: !!e.softDelete,
      readonly: !!e.readonly,
      searchFields: e.searchFields || [],
      defaultSort: e.defaultSort || { field: 'id', order: 'desc' },
      listFields: e.listFields || [],
      virtual: e.virtual || {},
      fields: e.fields,
    };
  });
  ok(res, {
    app: { name: cfg.system.appFullName, shortName: cfg.system.appName, version: cfg.system.version },
    entities,
    settings: publicSettings(),
    numbering: cfg.numbering,
    enums: {
      assetStatus: schema.ASSET_STATUS,
      assetCondition: schema.ASSET_CONDITION,
      depreciationMethods: schema.DEPRECIATION_METHODS,
      workflowStatus: schema.WORKFLOW_STATUS,
      priority: schema.PRIORITY,
      maintenanceTypes: schema.MAINTENANCE_TYPES,
      disposalTypes: schema.DISPOSAL_TYPES,
      units: schema.UNITS,
      permissionModules: PERMISSION_MODULES,
      permissionActions: PERMISSION_ACTIONS,
    },
    permissions: user ? user._permissions : {},
    user: user ? { id: user.id, fullName: user.fullName, username: user.username, roleName: user.roleName } : null,
  });
}

function handleLookups(ctx) {
  const { res, params } = ctx;
  const collection = params.collection;
  const entity = requireEntity(collection, res);
  if (!entity) return;
  const labelField = params.collection === 'users' ? 'fullName' : 'name';
  const mode = ctx.query.get('mode') || 'full';
  const base = store
    .filter(collection, (r) => !(entity.softDelete && r.isDeleted))
    .map((r) => {
      const dec = service.decorate(collection, r);
      return {
        id: r.id,
        code: r[entity.codeField || 'code'] || '',
        label: dec[labelField] || dec.code || ('#' + r.id),
        name: dec[nameOfField(collection)] || dec[labelField] || '',
        code2: dec.code || '',
        extra: lookupExtra(collection, dec),
        raw: mode === 'full' ? dec : undefined,
      };
    });
  ok(res, base);
}

function nameOfField(collection) {
  return collection === 'users' ? 'fullName' : 'name';
}

function lookupExtra(collection, rec) {
  switch (collection) {
    case 'categories':
      return { usefulLife: rec.defaultUsefulLife, rate: rec.defaultDepreciationRate, type: rec.defaultType, parentId: rec.parentId };
    case 'users':
      return { departmentId: rec.departmentId, departmentName: rec.departmentName, position: rec.position, email: rec.email, phone: rec.phone };
    case 'departments':
      return { parentId: rec.parentId, managerId: rec.managerId, costCenter: rec.costCenter };
    case 'locations':
      return { parentId: rec.parentId, type: rec.type, address: rec.address };
    case 'suppliers':
      return { phone: rec.phone, email: rec.email, taxCode: rec.taxCode, rating: rec.rating };
    case 'roles':
      return { dataScope: rec.dataScope, isSystem: rec.isSystem };
    default:
      return {};
  }
}

/* ============================ DASHBOARD ============================ */

function handleDashboard(ctx) {
  const { res } = ctx;
  ok(res, service.dashboardSummary());
}

function handleAnalytics(ctx) {
  const { res, query } = ctx;
  const groupBy = query.get('groupBy') || 'category';
  const metric = query.get('metric') || 'original';
  const assets = store.filter('assets', (a) => !a.isDeleted).map((a) => service.decorateAsset(a));

  const keyFn = {
    category: (a) => a.categoryName || 'Chưa phân loại',
    department: (a) => a.departmentName || 'Chưa phân bổ',
    location: (a) => a.locationName || 'Chưa xác định',
    status: (a) => (schema.ASSET_STATUS.find((s) => s.value === a.status) || {}).label || a.status,
    supplier: (a) => a.supplierName || 'Không rõ',
    year: (a) => String(a.purchaseDate || '').slice(0, 4) || 'Khác',
    condition: (a) => (schema.ASSET_CONDITION.find((c) => c.value === a.condition) || {}).label || a.condition,
    type: (a) => a.type || 'Khác',
  }[groupBy];

  const acc = {};
  assets.forEach((a) => {
    const key = keyFn(a);
    acc[key] = acc[key] || { key, count: 0, original: 0, book: 0, accumulated: 0, avg: 0 };
    acc[key].count += 1;
    acc[key].original += Number(a.originalCost || 0);
    acc[key].book += Number(a.bookValue || 0);
    acc[key].accumulated += Number(a.accumulatedDepreciation || 0);
  });
  const rows = Object.values(acc).map((r) => {
    r.avg = r.count ? Math.round(r.original / r.count) : 0;
    return r;
  });
  rows.sort((a, b) => (metric === 'count' ? b.count - a.count : b[metric] - a[metric]));
  ok(res, rows, { groupBy, metric, total: rows.length });
}

/* ============================ CRUD TỔNG QUÁT ============================ */

function applyCreateHooks(entityName, doc, ctx) {
  const cfg = service.settings();
  const entity = ENTITIES[entityName];
  // Sinh mã tự động
  if (entity.codeField && cfg.numbering[entityName]) {
    const codeField = entity.codeField;
    const hasCode = doc[codeField] && String(doc[codeField]).trim() && !String(doc[codeField]).startsWith('AUTO');
    if (!hasCode) doc[codeField] = service.generateCode(entityName, doc);
  }
  if (entityName === 'assets') {
    const cat = store.find('categories', doc.categoryId);
    if (cat) {
      if (!doc.usefulLife) doc.usefulLife = cat.defaultUsefulLife;
      if (!doc.depreciationRate) doc.depreciationRate = cat.defaultDepreciationRate;
      if (!doc.type) doc.type = cat.defaultType;
    }
    if (!doc.depreciationStart) doc.depreciationStart = doc.purchaseDate;
    if (!doc.warrantyStart) doc.warrantyStart = doc.purchaseDate;
    if (!doc.departmentId) {
      const assignee = store.find('users', doc.assigneeId);
      if (assignee) doc.departmentId = assignee.departmentId;
    }
    if (doc.status === 'in_use' && !doc.assignedDate) doc.assignedDate = util.todayStr();
  }
  if (entityName === 'maintenances' && doc.assetId) {
    if (doc.nextDueDate && doc.cycleDays) {
      doc.plannedDate = doc.plannedDate || doc.nextDueDate;
    }
  }
  if (entityName === 'disposals' && doc.assetId) {
    const a = store.find('assets', doc.assetId);
    if (a) {
      const dec = service.decorateAsset(a);
      if (!doc.originalCost) doc.originalCost = dec.originalCost;
      if (!doc.accumulated) doc.accumulated = dec.accumulatedDepreciation;
      if (!doc.bookValue) doc.bookValue = dec.bookValue;
    }
  }
  if (entityName === 'report_templates') {
    doc.design = doc.design || reports.blankDesign();
    doc.createdBy = ctx.user.username;
  }
  if (entityName === 'users') {
    if (!doc.password) doc.password = 'Ams@' + Math.floor(100000 + Math.random() * 899999);
    const { salt, hash } = auth.hashPassword(doc.password);
    doc.passwordSalt = salt;
    doc.passwordHash = hash;
    doc.plainPasswordOnce = doc.password;
    delete doc.password;
    if (!doc.employeeCode) doc.employeeCode = service.generateCode('users', doc);
  }
  if (entityName === 'stocktakes') {
    doc.status = doc.status || 'open';
  }
  return doc;
}

function applyUpdateHooks(entityName, before, patch, ctx) {
  if (entityName === 'users' && patch.password) {
    const errs = auth.validatePasswordStrength(patch.password, service.settings());
    if (errs.length) throw new Error(errs.join('. '));
    const { salt, hash } = auth.hashPassword(patch.password);
    patch.passwordSalt = salt;
    patch.passwordHash = hash;
    delete patch.password;
  }
  if (entityName === 'assets') {
    if (patch.status === 'in_use' && before.status !== 'in_use') patch.assignedDate = patch.assignedDate || util.todayStr();
  }
  if (entityName === 'report_templates') {
    patch.version = (before.version || 1) + 1;
    patch.updatedBy = ctx.user.username;
  }
  return patch;
}

/** Cập nhật các trường dẫn xuất & trạng thái liên quan sau khi thay đổi phiếu */
function postSaveSideEffects(entityName, record, isCreate, ctx) {
  if (!isCreate) return;
  try {
    if (entityName === 'assignments' && record.type === 'assign') {
      store.update('assets', record.assetId, {
        status: 'in_use',
        assigneeId: record.toUserId || null,
        departmentId: record.departmentId || null,
        locationId: record.locationId || null,
        assignedDate: record.date,
      });
    }
    if (entityName === 'assignments' && ['recover', 'return'].includes(record.type)) {
      store.update('assets', record.assetId, { status: 'in_stock', assigneeId: null, assignedDate: null });
    }
    if (entityName === 'maintenances') {
      const patch = { status: 'maintenance', lastMaintenanceAt: record.actualDate || record.plannedDate };
      if (record.nextDueDate) patch.nextMaintenanceAt = record.nextDueDate;
      if (record.status === 'completed') patch.status = record.conditionAfter === 'broken' ? 'damaged' : 'in_use';
      store.update('assets', record.assetId, patch);
    }
    if (entityName === 'stocktakes') {
      generateStocktakeItems(record, ctx);
    }
  } catch (e) {
    console.error('[side-effects]', e.message);
  }
}

function generateStocktakeItems(stocktake, ctx) {
  const existing = store.filter('stocktake_items', (i) => String(i.stocktakeId) === String(stocktake.id));
  if (existing.length) return existing;
  let assets = store.filter('assets', (a) => !a.isDeleted && !['disposed'].includes(a.status));
  if (stocktake.scope === 'department' && stocktake.departmentId) assets = assets.filter((a) => String(a.departmentId) === String(stocktake.departmentId));
  if (stocktake.scope === 'location' && stocktake.locationId) assets = assets.filter((a) => String(a.locationId) === String(stocktake.locationId));
  if (stocktake.scope === 'category' && stocktake.categoryId) assets = assets.filter((a) => String(a.categoryId) === String(stocktake.categoryId));
  return assets.map((a) =>
    store.insert('stocktake_items', {
      stocktakeId: stocktake.id,
      assetId: a.id,
      assetCode: a.code,
      assetName: a.name,
      expectedLocationId: a.locationId,
      expectedLocationName: service.nameOf('locations', a.locationId),
      locationId: a.locationId,
      locationName: service.nameOf('locations', a.locationId),
      assigneeId: a.assigneeId,
      assigneeName: service.nameOf('users', a.assigneeId, 'fullName'),
      bookQty: Number(a.quantity) || 1,
      countedQty: null,
      counted: false,
      result: 'match',
      conditionFound: a.condition,
      note: '',
    })
  );
}

function handleListEntity(ctx) {
  const { res, params, user } = ctx;
  const entityName = params.entity;
  const entity = requireEntity(entityName, res);
  if (!entity) return;
  if (!checkPermission(ctx, permModuleFor(entityName, entity), 'view', res)) return;

  const query = util.parseListQuery(ctx.url.searchParams);
  const scopeFilter = dataScopeFilter(user, entityName, ctx);
  const result = service.listEntity(entityName, query, { filterFn: scopeFilter });
  ok(res, result.data, result.meta);
}

/** Giới hạn dữ liệu theo phạm vi của vai trò (all/department/own) */
function dataScopeFilter(user, entityName, ctx) {
  if (!user || user.isSuperAdmin) return null;
  const role = store.find('roles', user.roleId);
  const scope = (role && role.dataScope) || 'all';
  if (scope === 'all') return null;
  if (scope === 'department' && user.departmentId && entityName === 'assets') {
    return (r) => String(r.departmentId) === String(user.departmentId) || String(r.assigneeId) === String(user.id);
  }
  if (scope === 'own' && entityName === 'assets') {
    return (r) => String(r.assigneeId) === String(user.id);
  }
  return null;
}

function handleGetEntity(ctx) {
  const { res, params } = ctx;
  const entityName = params.entity;
  const entity = requireEntity(entityName, res);
  if (!entity) return;
  if (!checkPermission(ctx, permModuleFor(entityName, entity), 'view', res)) return;
  const raw = store.find(entityName, params.id);
  if (!raw) return fail(res, 404, `${entity.singular} không tồn tại`);
  const data = service.decorate(entityName, raw);
  // Dữ liệu liên quan để hiển thị tab trong trang chi tiết
  const related = {};
  if (entityName === 'assets') {
    related.assignments = store.filter('assignments', (r) => String(r.assetId) === String(raw.id) && !r.isDeleted).map((r) => service.decorate('assignments', r));
    related.transfers = store.filter('transfers', (r) => String(r.assetId) === String(raw.id) && !r.isDeleted).map((r) => service.decorate('transfers', r));
    related.maintenances = store.filter('maintenances', (r) => String(r.assetId) === String(raw.id) && !r.isDeleted).map((r) => service.decorate('maintenances', r));
    related.depreciations = store.filter('depreciations', (r) => String(r.assetId) === String(raw.id) && !r.isDeleted).map((r) => service.decorate('depreciations', r));
    related.disposals = store.filter('disposals', (r) => String(r.assetId) === String(raw.id) && !r.isDeleted).map((r) => service.decorate('disposals', r));
    related.warranties = store.filter('warranties', (r) => String(r.assetId) === String(raw.id) && !r.isDeleted).map((r) => service.decorate('warranties', r));
    related.attachments = store.filter('attachments', (r) => r.entity === 'assets' && String(r.entityId) === String(raw.id)).map((r) => service.decorate('attachments', r));
  }
  if (entityName === 'users') {
    related.assets = store.filter('assets', (a) => String(a.assigneeId) === String(raw.id) && !a.isDeleted).map((a) => service.decorateAsset(a));
    related.sessions = store.filter('sessions', (s) => String(s.userId) === String(raw.id)).slice(-20).reverse();
    related.logs = store.filter('audit_logs', (l) => String(l.userId) === String(raw.id)).slice(-50).reverse();
  }
  if (entityName === 'stocktakes') {
    related.items = store.filter('stocktake_items', (i) => String(i.stocktakeId) === String(raw.id)).map((i) => service.decorate('stocktake_items', i));
  }
  if (entityName === 'departments' || entityName === 'categories' || entityName === 'locations' || entityName === 'suppliers') {
    related.assets = store
      .filter('assets', (a) => {
        if (a.isDeleted) return false;
        const map = { departments: 'departmentId', categories: 'categoryId', locations: 'locationId', suppliers: 'supplierId' };
        return String(a[map[entityName]]) === String(raw.id);
      })
      .map((a) => service.decorateAsset(a));
    related.children = store.filter(entityName, (r) => String(r.parentId) === String(raw.id) && !r.isDeleted).map((r) => service.decorate(entityName, r));
  }
  ok(res, data, { related });
}

async function handleCreateEntity(ctx) {
  const { res, params, body, user } = ctx;
  const entityName = params.entity;
  const entity = requireEntity(entityName, res);
  if (!entity) return;
  if (entity.readonly) return fail(res, 400, 'Thực thể này chỉ cho phép xem');
  if (!checkPermission(ctx, permModuleFor(entityName, entity), 'create', res)) return;

  let payload = sanitizePayload(entity, body, true);
  payload = applyCreateHooks(entityName, payload, ctx);
  const errors = validatePayload(entity, payload, entityName, null);
  if (Object.keys(errors).length) return sendValidationErrors(res, entity, errors);

  const record = store.insert(entityName, payload);
  const decorated = service.decorate(entityName, record);
  service.audit('CREATE', entityName, {
    username: user.username,
    userId: user.id,
    entityId: record.id,
    entityLabel: record[entity.codeField || 'code'] + ' - ' + (record.name || record.fullName || ''),
    changes: diffChanges(null, payload),
    ip: clientIp(ctx.req),
    path: ctx.url.pathname,
    method: 'POST',
  });
  postSaveSideEffects(entityName, decorated, true, ctx);
  ok(res, service.decorate(entityName, store.find(entityName, record.id)), { created: true });
}

async function handleUpdateEntity(ctx) {
  const { res, params, body, user } = ctx;
  const entityName = params.entity;
  const entity = requireEntity(entityName, res);
  if (!entity) return;
  if (entity.readonly) return fail(res, 400, 'Thực thể này chỉ cho phép xem');
  if (!checkPermission(ctx, permModuleFor(entityName, entity), 'update', res)) return;

  const before = store.find(entityName, params.id);
  if (!before) return fail(res, 404, `${entity.singular} không tồn tại`);

  let payload = sanitizePayload(entity, body, false);
  try {
    payload = applyUpdateHooks(entityName, before, payload, ctx);
  } catch (e) {
    return fail(res, 400, e.message);
  }
  const errors = validatePayload(entity, Object.assign({}, before, payload), entityName, params.id);
  if (Object.keys(errors).length) return sendValidationErrors(res, entity, errors);

  const changes = diffChanges(before, payload);
  store.update(entityName, params.id, payload);
  service.audit('UPDATE', entityName, {
    username: user.username,
    userId: user.id,
    entityId: params.id,
    entityLabel: before[entity.codeField || 'code'] + ' - ' + (before.name || before.fullName || ''),
    changes,
    ip: clientIp(ctx.req),
    path: ctx.url.pathname,
    method: 'PUT',
  });
  ok(res, service.decorate(entityName, store.find(entityName, params.id)));
}

function handleDeleteEntity(ctx) {
  const { res, params, user, query } = ctx;
  const entityName = params.entity;
  const entity = requireEntity(entityName, res);
  if (!entity) return;
  if (entity.readonly) return fail(res, 400, 'Thực thể này chỉ cho phép xem');
  if (!checkPermission(ctx, permModuleFor(entityName, entity), 'delete', res)) return;
  const before = store.find(entityName, params.id);
  if (!before) return fail(res, 404, `${entity.singular} không tồn tại`);

  const hard = query.get('hard') === '1';
  if (entity.softDelete && !hard) store.softRemove(entityName, params.id, user);
  else store.remove(entityName, params.id);

  service.audit('DELETE', entityName, {
    username: user.username,
    userId: user.id,
    entityId: params.id,
    entityLabel: before[entity.codeField || 'code'] + ' - ' + (before.name || before.fullName || ''),
    changes: { hard },
    ip: clientIp(ctx.req),
    path: ctx.url.pathname,
    method: 'DELETE',
  });
  ok(res, { success: true, hard });
}

function handleRestoreEntity(ctx) {
  const { res, params, user } = ctx;
  const entityName = params.entity;
  const entity = requireEntity(entityName, res);
  if (!entity) return;
  if (!checkPermission(ctx, permModuleFor(entityName, entity), 'delete', res)) return;
  const record = store.restore(entityName, params.id);
  if (!record) return fail(res, 404, 'Bản ghi không tồn tại');
  service.audit('RESTORE', entityName, { username: user.username, userId: user.id, entityId: params.id, entityLabel: record.code || '' });
  ok(res, service.decorate(entityName, record));
}

function handleTrash(ctx) {
  const { res, params, user } = ctx;
  const entityName = params.entity;
  const entity = requireEntity(entityName, res);
  if (!entity) return;
  const rows = store.filter(entityName, (r) => r.isDeleted).map((r) => service.decorate(entityName, r));
  ok(res, rows);
}

/* ---------------------- Nhập / Xuất dữ liệu ---------------------- */

function toCSV(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) v = v.join('; ');
    if (typeof v === 'object') v = JSON.stringify(v);
    const s = String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = columns.map((c) => c.label).join(',');
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(',')).join('\n');
  return '\ufeff' + head + '\n' + body;
}

function handleExportEntity(ctx) {
  const { res, params, user, query } = ctx;
  const entityName = params.entity;
  const entity = requireEntity(entityName, res);
  if (!entity) return;
  if (!checkPermission(ctx, permModuleFor(entityName, entity), 'export', res)) return;
  const q = util.parseListQuery(ctx.url.searchParams);
  q.limit = 100000;
  const rows = service.listEntity(entityName, q, { filterFn: dataScopeFilter(user, entityName, ctx) }).data;
  const fieldKeys = query.get('fields') ? query.get('fields').split(',') : Object.keys(entity.fields).filter((f) => entity.fields[f].type !== T.JSON && entity.fields[f].type !== T.PASSWORD);
  const columns = fieldKeys.map((k) => ({ key: k, label: (entity.fields[k] && entity.fields[k].label) || k }));
  const csv = toCSV(rows, columns);
  service.audit('EXPORT', entityName, { username: user.username, userId: user.id, entityLabel: `Xuất ${rows.length} bản ghi CSV` });
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${entityName}-${util.todayStr()}.csv"`,
  });
  res.end(csv);
}

async function handleImportEntity(ctx) {
  const { res, params, body, user } = ctx;
  const entityName = params.entity;
  const entity = requireEntity(entityName, res);
  if (!entity) return;
  if (!checkPermission(ctx, permModuleFor(entityName, entity), 'create', res)) return;
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return fail(res, 400, 'Không có dữ liệu để nhập');
  const mode = body.mode || 'append'; // append | upsert
  const result = { inserted: 0, updated: 0, failed: 0, errors: [] };
  rows.forEach((row, idx) => {
    try {
      const payload = sanitizePayload(entity, row, true);
      const codeField = entity.codeField || 'code';
      const existing = codeField && row[codeField] ? store.findOne(entityName, (r) => String(r[codeField]).toLowerCase() === String(row[codeField]).toLowerCase()) : null;
      if (existing && mode === 'upsert') {
        const patch = sanitizePayload(entity, row, false);
        store.update(entityName, existing.id, patch);
        result.updated += 1;
      } else {
        const prepared = applyCreateHooks(entityName, payload, ctx);
        const errors = validatePayload(entity, prepared, entityName, null);
        if (Object.keys(errors).length) throw new Error(Object.values(errors).join('; '));
        store.insert(entityName, prepared);
        result.inserted += 1;
      }
    } catch (e) {
      result.failed += 1;
      result.errors.push({ row: idx + 1, message: e.message });
    }
  });
  service.audit('IMPORT', entityName, { username: user.username, userId: user.id, entityLabel: `Nhập ${result.inserted} mới, ${result.updated} cập nhật, ${result.failed} lỗi` });
  ok(res, result);
}

/* ============================ WORKFLOW ============================ */

function workflowAction(ctx, entityName, statusField, actions) {
  const { res, params, body, user } = ctx;
  const entity = requireEntity(entityName, res);
  if (!entity) return;
  if (!checkPermission(ctx, permModuleFor(entityName, entity), 'approve', res) && !checkPermission(ctx, permModuleFor(entityName, entity), 'update', res)) return;
  const record = store.find(entityName, params.id);
  if (!record) return fail(res, 404, 'Không tìm thấy bản ghi');
  const action = params.action;
  const def = actions[action];
  if (!def) return fail(res, 400, 'Hành động không hợp lệ: ' + action);
  const patch = def.patch(record, body, user, ctx) || {};
  store.update(entityName, params.id, patch);
  const updated = service.decorate(entityName, store.find(entityName, params.id));
  service.audit(def.auditAction || 'APPROVE', entityName, {
    username: user.username,
    userId: user.id,
    entityId: record.id,
    entityLabel: record.code + ' - ' + (record.assetName || record.name || ''),
    changes: patch,
  });
  if (def.after) def.after(updated, ctx);
  ok(res, updated);
}

const transferActions = {
  approve: {
    auditAction: 'APPROVE',
    patch: (r, body, user) => ({ status: 'approved', approvedBy: user.id, approvedAt: new Date().toISOString(), rejectReason: '' }),
    after: (r) => store.update('assets', r.assetId, { status: 'transferred' }),
  },
  reject: {
    auditAction: 'REJECT',
    patch: (r, body) => ({ status: 'rejected', rejectReason: body.reason || 'Không đạt yêu cầu' }),
    after: (r) => store.update('assets', r.assetId, { status: 'in_use' }),
  },
  complete: {
    auditAction: 'UPDATE',
    patch: () => ({ status: 'completed', completedAt: new Date().toISOString() }),
    after: (r) =>
      store.update('assets', r.assetId, {
        departmentId: r.toDepartmentId || null,
        locationId: r.toLocationId || null,
        assigneeId: r.toUserId || null,
        departmentName: undefined,
        status: r.toUserId ? 'in_use' : 'in_stock',
      }),
  },
};

const disposalActions = {
  approve: {
    auditAction: 'APPROVE',
    patch: (r, body, user) => ({ status: 'approved', approvedBy: user.id, approvedAt: new Date().toISOString() }),
    after: (r) => store.update('assets', r.assetId, { status: 'pending_disposal' }),
  },
  reject: {
    auditAction: 'REJECT',
    patch: (r, body) => ({ status: 'rejected', note: body.reason || '' }),
  },
  complete: {
    auditAction: 'UPDATE',
    patch: () => ({ status: 'completed' }),
    after: (r) => {
      const asset = store.find('assets', r.assetId);
      store.update('assets', r.assetId, {
        status: 'disposed',
        disposalDate: r.date,
        disposalValue: r.salePrice,
        assigneeId: null,
        locationId: asset ? asset.locationId : null,
      });
    },
  },
};

const maintenanceActions = {
  start: { patch: () => ({ status: 'in_progress' }) },
  complete: {
    patch: (r, body, user) => {
      const patch = {
        status: 'completed',
        actualDate: body.actualDate || util.todayStr(),
        result: body.result || r.result,
        cost: body.cost !== undefined ? Number(body.cost) : r.cost,
        partsCost: body.partsCost !== undefined ? Number(body.partsCost) : r.partsCost,
      };
      if (r.cycleDays) patch.nextDueDate = util.todayStr(new Date(Date.now() + r.cycleDays * 86400000));
      return patch;
    },
    after: (r) => {
      const patch = { status: r.conditionAfter === 'broken' ? 'damaged' : 'in_use', lastMaintenanceAt: r.actualDate };
      if (r.nextDueDate) patch.nextMaintenanceAt = r.nextDueDate;
      store.update('assets', r.assetId, patch);
    },
  },
  cancel: { patch: () => ({ status: 'cancelled' }) },
};

const assignmentActions = {
  confirm: { patch: (r, body, user) => ({ status: 'completed', confirmedAt: new Date().toISOString(), confirmedBy: user.id }) },
  cancel: {
    patch: () => ({ status: 'cancelled' }),
    after: (r) => store.update('assets', r.assetId, { status: 'in_stock', assigneeId: null }),
  },
};

/* ---------------------- Khấu hao: chạy kỳ ---------------------- */

function handleRunDepreciation(ctx) {
  const { res, body, user } = ctx;
  if (!checkPermission(ctx, 'depreciations', 'approve', res) && !checkPermission(ctx, 'depreciations', 'create', res)) return;
  const period = body.period || util.todayStr().slice(0, 7);
  const scope = body.scope || 'all';
  const cfg = service.settings();
  const upTo = new Date(period + '-28T23:59:59');
  let assets = store.filter('assets', (a) => !a.isDeleted && a.status !== 'disposed' && a.depreciationMethod !== 'none');
  if (scope === 'department' && body.departmentId) assets = assets.filter((a) => String(a.departmentId) === String(body.departmentId));
  if (scope === 'category' && body.categoryId) assets = assets.filter((a) => String(a.categoryId) === String(body.categoryId));
  if (scope === 'ids' && Array.isArray(body.assetIds)) assets = assets.filter((a) => body.assetIds.map(String).includes(String(a.id)));

  const existing = store.filter('depreciations', (d) => d.period === period && !d.isDeleted);
  const overwrite = !!body.overwrite;
  const created = [];
  const skipped = [];
  assets.forEach((asset) => {
    const already = existing.find((d) => String(d.assetId) === String(asset.id));
    if (already && !overwrite) {
      skipped.push(asset.code);
      return;
    }
    const dec = service.decorateAsset(asset, { upTo });
    const prevAcc = Number(asset.accumulatedDepreciation || 0);
    const opening = Number(asset.originalCost || asset.purchasePrice || 0) - prevAcc;
    const amount = Math.max(0, Math.min(dec.monthlyDepreciation, opening - Number(asset.salvageValue || 0)));
    const payload = {
      code: service.generateCode('depreciations', {}),
      period,
      assetId: asset.id,
      assetCode: asset.code,
      assetName: asset.name,
      departmentName: service.nameOf('departments', asset.departmentId),
      method: asset.depreciationMethod,
      openingValue: opening,
      depreciationAmount: amount,
      accumulated: prevAcc + amount,
      closingValue: Math.max(Number(asset.salvageValue || 0), opening - amount),
      expenseAccount: cfg.depreciation.expenseAccount,
      assetAccount: cfg.depreciation.assetAccount,
      runBy: user.username,
      runAt: new Date().toISOString(),
      status: 'posted',
      note: body.note || '',
    };
    if (already && overwrite) {
      store.update('depreciations', already.id, payload);
      created.push(payload);
    } else {
      store.insert('depreciations', payload);
      created.push(payload);
    }
    store.update('assets', asset.id, {
      accumulatedDepreciation: prevAcc + amount,
      depreciationPeriods: (asset.depreciationPeriods || 0) + 1,
    });
  });

  service.audit('RUN', 'depreciations', {
    username: user.username,
    userId: user.id,
    entityLabel: `Chạy khấu hao kỳ ${period}: ${created.length} bút toán, bỏ qua ${skipped.length}`,
  });
  ok(res, {
    period,
    processed: created.length,
    skipped: skipped.length,
    totalAmount: created.reduce((s, r) => s + Number(r.depreciationAmount || 0), 0),
    rows: created,
  });
}

function handleDepreciationPreview(ctx) {
  const { res, query } = ctx;
  const period = query.get('period') || util.todayStr().slice(0, 7);
  const upTo = new Date(period + '-28T23:59:59');
  const assets = store.filter('assets', (a) => !a.isDeleted && a.status !== 'disposed' && a.depreciationMethod !== 'none');
  const rows = assets.map((a) => {
    const dec = service.decorateAsset(a, { upTo });
    const prevAcc = Number(a.accumulatedDepreciation || 0);
    const opening = Number(a.originalCost || 0) - prevAcc;
    const amount = Math.max(0, Math.min(dec.monthlyDepreciation, opening - Number(a.salvageValue || 0)));
    return {
      assetId: a.id,
      code: a.code,
      name: a.name,
      categoryName: dec.categoryName,
      departmentName: dec.departmentName,
      method: a.depreciationMethod,
      originalCost: dec.originalCost,
      openingValue: opening,
      monthly: dec.monthlyDepreciation,
      amount,
      accumulated: prevAcc + amount,
      closingValue: Math.max(Number(a.salvageValue || 0), opening - amount),
      existing: !!store.findOne('depreciations', (d) => d.period === period && String(d.assetId) === String(a.id) && !d.isDeleted),
    };
  });
  ok(res, rows, { period, total: rows.reduce((s, r) => s + r.amount, 0) });
}

/* ---------------------- Kiểm kê ---------------------- */

function handleStocktakeGenerate(ctx) {
  const { res, params, user } = ctx;
  const stocktake = store.find('stocktakes', params.id);
  if (!stocktake) return fail(res, 404, 'Không tìm thấy đợt kiểm kê');
  const items = generateStocktakeItems(service.decorate('stocktakes', stocktake), ctx);
  ok(res, items.map((i) => service.decorate('stocktake_items', i)), { total: items.length });
}

/** Áp dụng một cập nhật dòng kiểm kê (dùng chung cho sửa tay và quét mã) */
function applyStocktakeItem(ctx, item, body) {
  const user = ctx.user;
  const patch = {};
  ['counted', 'result', 'conditionFound', 'locationId', 'note'].forEach((k) => {
    if (body[k] !== undefined) patch[k] = body[k];
  });
  if (patch.locationId) patch.locationName = service.nameOf('locations', patch.locationId);
  patch.counted = patch.counted === undefined ? true : patch.counted;
  if (patch.counted) {
    patch.countedBy = user ? user.id : null;
    patch.countedAt = new Date().toISOString();
    if (body.countedQty !== undefined) patch.countedQty = Number(body.countedQty) || 0;
  } else {
    // Bỏ / hoàn tác lượt kiểm kê: xoá dấu người quét, thời điểm và số lượng thực tế
    patch.countedBy = null;
    patch.countedAt = null;
    patch.countedQty = null;
    if (body.result === undefined) patch.result = null;
  }
  store.update('stocktake_items', item.id, patch);

  // Cập nhật tài sản thực tế nếu chênh lệch
  if (patch.result === 'missing') store.update('assets', item.assetId, { status: 'lost' });
  if (patch.result === 'wrong_location' && patch.locationId) store.update('assets', item.assetId, { locationId: patch.locationId });
  if (patch.result === 'damaged') store.update('assets', item.assetId, { status: 'damaged', condition: patch.conditionFound || 'broken' });

  const parent = store.find('stocktakes', item.stocktakeId);
  if (parent) {
    const items = store.filter('stocktake_items', (i) => String(i.stocktakeId) === String(parent.id));
    store.update('stocktakes', parent.id, {
      totalItems: items.length,
      countedItems: items.filter((i) => i.counted).length,
      diffItems: items.filter((i) => i.counted && i.result && i.result !== 'match').length,
    });
  }
  return service.decorate('stocktake_items', store.find('stocktake_items', item.id));
}

function handleStocktakeItemUpdate(ctx) {
  const { res, params, body } = ctx;
  const item = store.find('stocktake_items', params.itemId);
  if (!item) return fail(res, 404, 'Không tìm thấy dòng kiểm kê');
  ok(res, applyStocktakeItem(ctx, item, body));
}

function handleStocktakeClose(ctx) {
  const { res, params, user } = ctx;
  const stocktake = store.find('stocktakes', params.id);
  if (!stocktake) return fail(res, 404, 'Không tìm thấy đợt kiểm kê');
  const items = store.filter('stocktake_items', (i) => String(i.stocktakeId) === String(stocktake.id));
  items.forEach((i) => {
    if (i.counted) store.update('assets', i.assetId, { lastStocktakeAt: util.todayStr() });
  });
  store.update('stocktakes', stocktake.id, { status: 'closed', closedAt: new Date().toISOString() });
  service.audit('UPDATE', 'stocktakes', { username: user.username, userId: user.id, entityId: stocktake.id, entityLabel: 'Chốt kiểm kê ' + stocktake.code });
  ok(res, service.decorate('stocktakes', store.find('stocktakes', stocktake.id)));
}

/* ================== QUÉT MÃ QR / MÃ VẠCH (KIỂM KÊ NHANH) ================== */

/**
 * Phân tích giá trị quét được thành mã tài sản.
 * Hỗ trợ: mã tài sản thô (TS-2026-00001), số thứ tự nội bộ, liên kết in trên tem:
 *   ams://asset/TS-2026-00001
 *   ams://stocktake/KK-2026-001/asset/12
 */
function parseScanCode(raw) {
  const value = String(raw == null ? '' : raw).trim();
  const out = { raw: value, code: '', assetId: null, stocktakeCode: '' };
  if (!value) return out;
  const scheme = value.match(/^ams:\/\/([^\s]+)$/i);
  if (scheme) {
    const parts = scheme[1].split('/').filter(Boolean);
    const head = String(parts[0] || '').toLowerCase();
    if (head === 'stocktake' && parts.length >= 2) {
      out.stocktakeCode = decodeURIComponent(parts[1]);
      if (parts[2] === 'asset' && parts[3]) out.assetId = Number(parts[3]) || null;
    } else if (parts[1]) {
      out.code = decodeURIComponent(parts[1]);
    } else if (parts[0]) {
      out.code = decodeURIComponent(parts[0]);
    }
  } else {
    out.code = value;
  }
  if (out.code && /^\d+$/.test(out.code)) out.assetId = out.assetId || Number(out.code);
  return out;
}

const scanNorm = (v) => String(v == null ? '' : v).trim().toUpperCase().replace(/[\s_]/g, '');

/** Tìm tài sản theo mã quét (mã, số thứ tự, hoặc số sê-ri) */
function findAssetByScan(parsed) {
  const live = (a) => a && !a.isDeleted;
  if (parsed.assetId) {
    const byId = live(store.find('assets', parsed.assetId)) ? store.find('assets', parsed.assetId) : null;
    if (byId) return { asset: byId, matchedBy: 'id' };
  }
  if (!parsed.code) return { asset: null, matchedBy: '' };
  const target = scanNorm(parsed.code);
  const assets = store.filter('assets', live);
  const exact = assets.find((a) => scanNorm(a.code) === target);
  if (exact) return { asset: exact, matchedBy: 'code' };
  const serial = assets.find((a) => a.serial && scanNorm(a.serial) === target);
  if (serial) return { asset: serial, matchedBy: 'serial' };
  return { asset: null, matchedBy: '', suggestions: assets.filter((a) => scanNorm(a.code).includes(target) || scanNorm(a.name).includes(target)).slice(0, 5) };
}

/** Đợt kiểm kê đang mở chứa tài sản (nếu người dùng không chọn đợt cụ thể) */
function openStocktakeFor(assetId, stocktakeCode) {
  const open = store.filter('stocktakes', (s) => !s.isDeleted && s.status === 'open');
  if (stocktakeCode) {
    const found = store.filter('stocktakes', (s) => !s.isDeleted && scanNorm(s.code) === scanNorm(stocktakeCode))[0];
    if (found) return found;
  }
  const withItem = open.find((s) => store.filter('stocktake_items', (i) => String(i.stocktakeId) === String(s.id) && String(i.assetId) === String(assetId)).length);
  return withItem || open[0] || null;
}

function stocktakeProgress(stocktake) {
  if (!stocktake) return null;
  const items = store.filter('stocktake_items', (i) => String(i.stocktakeId) === String(stocktake.id));
  const counted = items.filter((i) => i.counted);
  return {
    id: stocktake.id,
    code: stocktake.code,
    name: stocktake.name,
    status: stocktake.status,
    totalItems: items.length,
    countedItems: counted.length,
    remainingItems: items.length - counted.length,
    diffItems: counted.filter((i) => i.result && i.result !== 'match').length,
    matchItems: counted.filter((i) => !i.result || i.result === 'match').length,
    progress: items.length ? Math.round((counted.length / items.length) * 100) : 0,
  };
}

/** Tra cứu mã quét: trả về tài sản + dòng kiểm kê tương ứng + tiến độ đợt */
function handleScanLookup(ctx) {
  const { res, query } = ctx;
  const parsed = parseScanCode(query.get('code'));
  if (!parsed.raw) return fail(res, 422, 'Thiếu tham số code');
  const found = findAssetByScan(parsed);
  if (!found.asset) {
    return ok(res, { parsed, asset: null, suggestions: found.suggestions || [], item: null, stocktake: null, alreadyCounted: false }, { found: false });
  }
  const asset = service.decorate('assets', found.asset);
  const requested = query.get('stocktakeId');
  const stocktake = requested ? store.find('stocktakes', requested) : openStocktakeFor(asset.id, parsed.stocktakeCode);
  let item = null;
  if (stocktake) {
    const items = store.filter('stocktake_items', (i) => String(i.stocktakeId) === String(stocktake.id) && String(i.assetId) === String(asset.id));
    item = items[0] ? service.decorate('stocktake_items', items[0]) : null;
  }
  ok(res, {
    parsed,
    asset,
    matchedBy: found.matchedBy,
    item,
    inStocktakeList: !!item,
    alreadyCounted: !!(item && item.counted),
    countedAt: item ? item.countedAt : null,
    countedByName: item ? item.countedByName : '',
    stocktake: stocktakeProgress(stocktake),
  });
}

/** Ghi nhận một lần quét vào đợt kiểm kê (tạo dòng nếu tài sản ngoài danh sách) */
function handleScanCount(ctx) {
  const { res, body } = ctx;
  const parsed = parseScanCode(body.code);
  if (!parsed.raw) return fail(res, 422, 'Thiếu mã quét (code)');
  const found = findAssetByScan(parsed);
  if (!found.asset) {
    return fail(res, 404, 'Không tìm thấy tài sản với mã "' + parsed.raw + '". Kiểm tra lại mã in trên tem hoặc tạo tài sản mới.');
  }
  const asset = found.asset;
  let stocktake = body.stocktakeId ? store.find('stocktakes', body.stocktakeId) : openStocktakeFor(asset.id, parsed.stocktakeCode);
  if (!stocktake) return fail(res, 404, 'Không có đợt kiểm kê nào đang mở. Hãy tạo hoặc mở một đợt kiểm kê trước khi quét.');
  if (stocktake.status === 'closed') return fail(res, 422, 'Đợt kiểm kê ' + stocktake.code + ' đã chốt, không thể ghi nhận thêm.');

  // Tự sinh danh sách kiểm kê nếu đợt còn trống
  if (!store.filter('stocktake_items', (i) => String(i.stocktakeId) === String(stocktake.id)).length) {
    generateStocktakeItems(service.decorate('stocktakes', stocktake), ctx);
  }

  const items = store.filter('stocktake_items', (i) => String(i.stocktakeId) === String(stocktake.id));
  let item = items.find((i) => String(i.assetId) === String(asset.id));
  let created = false;
  if (!item) {
    // Tài sản có thật nhưng ngoài danh sách kiểm kê → ghi nhận là phát hiện thêm
    item = store.insert('stocktake_items', {
      stocktakeId: stocktake.id,
      assetId: asset.id,
      assetCode: asset.code,
      assetName: asset.name,
      expectedLocationId: asset.locationId || null,
      expectedLocationName: asset.locationName || '',
      locationId: asset.locationId || null,
      locationName: asset.locationName || '',
      assigneeId: asset.assigneeId || null,
      assigneeName: asset.assigneeName || '',
      bookQty: Number(asset.quantity) || 1,
      conditionFound: asset.condition,
      result: body.result || 'extra',
      note: 'Phát hiện qua quét mã — tài sản ngoài danh sách kiểm kê',
      counted: true,
    });
    created = true;
  }
  const payload = Object.assign({}, body);
  if (created) payload.result = payload.result || 'extra';
  if (!payload.result) payload.result = item.result || 'match';
  if (!payload.locationId && payload.result === 'wrong_location') payload.locationId = body.locationId || asset.locationId || null;
  const updated = applyStocktakeItem(ctx, item, payload);
  service.audit('UPDATE', 'stocktakes', {
    username: ctx.user.username, userId: ctx.user.id, entityId: stocktake.id,
    entityLabel: 'Quét mã ' + asset.code + ' (' + (payload.result || 'match') + ')',
  });
  ok(res, {
    asset: service.decorate('assets', asset),
    item: updated,
    createdItem: created,
    matchedBy: found.matchedBy,
    stocktake: stocktakeProgress(store.find('stocktakes', stocktake.id)),
  });
}

/** Năm lần quét gần nhất của một đợt kiểm kê (hiển thị lại sau khi tải trang) */
function handleScanHistory(ctx) {
  const { res, query } = ctx;
  const stocktake = store.find('stocktakes', query.get('stocktakeId'));
  if (!stocktake) return fail(res, 404, 'Không tìm thấy đợt kiểm kê');
  const limit = Math.min(100, Number(query.get('limit')) || 20);
  const rows = store
    .filter('stocktake_items', (i) => String(i.stocktakeId) === String(stocktake.id) && i.counted && i.countedAt)
    .sort((a, b) => String(b.countedAt).localeCompare(String(a.countedAt)))
    .slice(0, limit)
    .map((i) => service.decorate('stocktake_items', i));
  ok(res, rows, { total: rows.length, stocktake: stocktakeProgress(stocktake) });
}

const SCAN_RESULT_LABELS = { match: 'Khớp sổ sách', wrong_location: 'Sai vị trí', damaged: 'Hư hỏng', missing: 'Không tìm thấy', extra: 'Phát hiện thêm' };

/**
 * Xuất kết quả quét kiểm kê ra Excel (.xlsx) hoặc CSV.
 * GET /api/scan/export?stocktakeId=<id>&format=xlsx|csv
 */
function handleScanExport(ctx) {
  const { res, query } = ctx;
  const stocktake = store.find('stocktakes', query.get('stocktakeId'));
  if (!stocktake) return fail(res, 404, 'Không tìm thấy đợt kiểm kê');
  const format = (query.get('format') || 'xlsx').toLowerCase();
  const items = store
    .filter('stocktake_items', (i) => String(i.stocktakeId) === String(stocktake.id))
    .sort((a, b) => String(a.assetCode).localeCompare(String(b.assetCode), 'vi'));
  const rows = items.map((i, idx) => {
    const d = service.decorate('stocktake_items', i);
    const a = store.find('assets', i.assetId) || {};
    return {
      stt: idx + 1,
      assetCode: d.assetCode || '',
      assetName: d.assetName || '',
      categoryName: service.nameOf('categories', a.categoryId),
      departmentName: service.nameOf('departments', a.departmentId),
      expectedLocationName: d.expectedLocationName || '',
      locationName: d.locationName || '',
      bookQty: Number(d.bookQty) || 0,
      countedQty: d.countedQty === null || d.countedQty === undefined ? '' : Number(d.countedQty),
      counted: d.counted ? 'Có' : 'Chưa',
      resultLabel: d.counted ? (SCAN_RESULT_LABELS[d.result] || d.result || '—') : 'Chưa kiểm kê',
      conditionLabel: d.conditionLabel || '',
      countedByName: d.countedByName || '',
      countedAt: d.countedAt ? new Date(d.countedAt).toLocaleString('vi-VN') : '',
      note: d.note || '',
    };
  });
  const counted = rows.filter((r) => r.counted === 'Có').length;
  const cols = [
    { key: 'stt', label: 'STT', format: 'number', w: 8 },
    { key: 'assetCode', label: 'Mã tài sản', format: 'text', w: 16 },
    { key: 'assetName', label: 'Tên tài sản', format: 'text', w: 34 },
    { key: 'categoryName', label: 'Danh mục', format: 'text', w: 22 },
    { key: 'departmentName', label: 'Phòng ban', format: 'text', w: 22 },
    { key: 'expectedLocationName', label: 'Vị trí sổ sách', format: 'text', w: 20 },
    { key: 'locationName', label: 'Vị trí thực tế', format: 'text', w: 20 },
    { key: 'bookQty', label: 'SL sổ sách', format: 'number', w: 10 },
    { key: 'countedQty', label: 'SL kiểm kê', format: 'number', w: 12 },
    { key: 'counted', label: 'Đã kiểm kê', format: 'text', w: 12 },
    { key: 'resultLabel', label: 'Kết quả', format: 'text', w: 18 },
    { key: 'conditionLabel', label: 'Tình trạng', format: 'text', w: 14 },
    { key: 'countedByName', label: 'Người kiểm kê', format: 'text', w: 20 },
    { key: 'countedAt', label: 'Thời điểm', format: 'text', w: 18 },
    { key: 'note', label: 'Ghi chú', format: 'text', w: 30 },
  ];
  const filenameBase = util.slug('Ket-qua-quet-kiem-ke ' + stocktake.code) + '-' + util.todayStr();
  const audit = () => service.audit('EXPORT', 'stocktakes', {
    username: ctx.user.username, userId: ctx.user.id,
    entityLabel: `Xuất kết quả quét đợt ${stocktake.code} (${format.toUpperCase()}) - ${counted}/${items.length} đã kiểm kê`,
  });

  if (format === 'csv') {
    const csvEsc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = '\ufeff' + [cols.map((c) => csvEsc(c.label)).join(','), ...rows.map((r) => cols.map((c) => csvEsc(r[c.key])).join(','))].join('\n');
    audit();
    const buf = Buffer.from(csv, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filenameBase}.csv"`,
      'Content-Length': buf.length,
    });
    return res.end(buf);
  }

  // Excel: dùng động cơ báo cáo (bộ ZIP nội bộ, không thư viện ngoài)
  const template = {
    name: 'Ket qua quet kiem ke - ' + stocktake.code,
    design: { bands: { columnHeader: { elements: cols.map((c, i) => ({ type: 'field', field: c.key, label: c.label, x: i, format: c.format, w: c.w })) } } },
  };
  const buf = reports.renderXLSX(template, rows, reportContext(ctx));
  audit();
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${filenameBase}.xlsx"`,
    'Content-Length': buf.length,
  });
  res.end(buf);
}

/**
 * IN TEM HÀNG LOẠT — 1 lượt in ra tem A4 cho nhiều tài sản (mỗi tài sản 1 tem, tự phân trang).
 * GET /api/documents/labels?assetIds=1,2,3  (hoặc stocktakeId / departmentId / locationId / categoryId, + copies=1..4)
 */
function handleLabelBatch(ctx) {
  const { res, query } = ctx;
  const flat = {};
  query.forEach((v, k) => { flat[k] = v; });
  if (!flat.assetIds && !flat.stocktakeId && !flat.departmentId && !flat.locationId && !flat.categoryId) {
    return fail(res, 422, 'Chưa có danh sách tài sản để in. Chọn tài sản, phòng ban, vị trí, danh mục hoặc đợt kiểm kê.');
  }
  const html = docs.assetLabelsBatch(flat, { settings: service.settings() });
  if (!html) return fail(res, 404, 'Không có dữ liệu để in tem');
  service.audit('EXPORT', 'documents', {
    username: ctx.user.username, userId: ctx.user.id,
    entityLabel: 'In tem hàng loạt (' + (flat.assetIds || flat.stocktakeId || flat.departmentId || flat.locationId || flat.categoryId) + ')',
  });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

/* ============================ BÁO CÁO ============================ */

function handleReportDatasets(ctx) {
  const { res } = ctx;
  const ds = service.reportDatasets();
  ok(res, Object.values(ds).map((d) => ({ key: d.key, label: d.label, group: d.group, entity: d.entity, sql: d.sql || null, fieldCount: d.fields.length, fields: d.fields })));
}

function handleReportDatasetData(ctx) {
  const { res, params, query } = ctx;
  const key = params.key;
  const filters = {};
  for (const [k, v] of query.entries()) {
    const m = /^filter\[(.+)\]$/.exec(k);
    if (m) filters[m[1]] = v;
  }
  const rows = service.datasetRows(key, {
    q: query.get('q') || '',
    sort: query.get('sort') || '',
    order: query.get('order') || 'asc',
    filters,
    limit: query.get('limit') ? Number(query.get('limit')) : 100000,
  });
  ok(res, rows, { total: rows.length, dataset: key });
}

async function handleReportPreview(ctx) {
  const { res, body } = ctx;
  const design = body.design || {};
  const datasetKey = body.dataset || design.dataset;
  const rows = service.datasetRows(datasetKey, { limit: body.limit || 200, filters: body.filters || {} });
  const template = {
    name: body.name || 'Xem trước báo cáo',
    dataset: datasetKey,
    paperSize: design.paperSize || 'A4',
    orientation: design.orientation || 'portrait',
    design: design,
  };
  const html = reports.renderHTML(template, rows, { context: reportContext(ctx), preview: true, maxRows: body.limit || 200 });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function reportContext(ctx) {
  const cfg = service.settings();
  return {
    company: cfg.company,
    system: cfg.system,
    settings: cfg,
    user: ctx.user ? { fullName: ctx.user.fullName, username: ctx.user.username } : { fullName: 'Hệ thống' },
    generatedAt: new Date().toISOString(),
  };
}

async function handleReportRender(ctx) {
  const { res, body, user } = ctx;
  let template = null;
  if (body.templateId) template = store.find('report_templates', body.templateId);
  if (!template && body.design) {
    template = {
      name: body.name || 'Báo cáo tuỳ chỉnh',
      dataset: body.dataset,
      paperSize: (body.design && body.design.paperSize) || 'A4',
      orientation: (body.design && body.design.orientation) || 'portrait',
      design: body.design,
    };
  }
  if (!template) return fail(res, 400, 'Thiếu mẫu báo cáo (templateId hoặc design)');

  const params = body.params || {};
  const datasetKey = body.dataset || template.dataset;
  let rows = service.datasetRows(datasetKey, {
    filters: Object.assign({}, (template.design && template.design.filters) || {}, body.filters || {}),
    q: body.q || '',
    includeDeleted: !!(template.design && template.design.includeDeleted),
  });

  // Áp dụng tham số báo cáo (parameters) do người dùng nhập
  rows = reports.applyRowParams(rows, template.design, params);

  const format = (body.format || 'html').toLowerCase();
  const ctxInfo = reportContext(ctx);
  service.audit('EXPORT', 'reports', {
    username: user.username,
    userId: user.id,
    entityLabel: `In báo cáo "${template.name}" (${format.toUpperCase()}) - ${rows.length} dòng`,
  });

  const filenameBase = util.slug(template.name || 'bao-cao') + '-' + util.todayStr();

  if (format === 'csv') {
    const csv = reports.renderCSV(template, rows, ctxInfo);
    const buf = Buffer.from(csv, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filenameBase}.csv"`,
      'Content-Length': buf.length,
    });
    return res.end(buf);
  }

  if (format === 'xlsx') {
    const buf = reports.renderXLSX(template, rows, ctxInfo);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filenameBase}.xlsx"`,
      'Content-Length': buf.length,
    });
    return res.end(buf);
  }

  if (format === 'docx') {
    const buf = reports.renderDOCX(template, rows, ctxInfo);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filenameBase}.docx"`,
      'Content-Length': buf.length,
    });
    return res.end(buf);
  }

  const html = reports.renderHTML(template, rows, { context: ctxInfo, autoPrint: format === 'print' || body.autoPrint });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleReportTemplateClone(ctx) {
  const { res, body, user } = ctx;
  const src = store.find('report_templates', body.id);
  if (!src) return fail(res, 404, 'Không tìm thấy mẫu');
  const copy = store.insert('report_templates', {
    code: service.generateCode('report_templates', {}),
    name: (body.name || src.name + ' (bản sao)').trim(),
    description: src.description,
    dataset: src.dataset,
    design: util.clone(src.design),
    paperSize: src.paperSize,
    orientation: src.orientation,
    createdBy: user.username,
    isSystem: false,
    version: 1,
  });
  ok(res, copy);
}

/* ============================ QUẢN TRỊ ============================ */

function handleSystemStatus(ctx) {
  const { res, user } = ctx;
  if (!checkPermission(ctx, 'settings', 'view', res)) return;
  const mem = process.memoryUsage();
  const cfg = service.settings();
  ok(res, {
    app: { version: cfg.system.version, name: cfg.system.appName, startedAt: store.startedAt, node: process.version, platform: process.platform, uptimeSeconds: Math.round(process.uptime()) },
    database: {
      file: 'data/db.json',
      sizeBytes: JSON.stringify(store.snapshot()).length,
      collections: Object.keys(store.collections).map((k) => ({ name: k, label: (ENTITIES[k] && ENTITIES[k].label) || k, count: store.all(k).length, deleted: store.filter(k, (r) => r.isDeleted).length })),
      lastBackup: store.meta.lastBackup || null,
    },
    memory: { rss: mem.rss, heapTotal: mem.heapTotal, heapUsed: mem.heapUsed },
    activity: {
      sessionsActive: store.filter('sessions', (s) => !s.revokedAt && new Date(s.expiresAt) > new Date()).length,
      loginsToday: store.filter('audit_logs', (l) => l.action === 'LOGIN' && String(l.createdAt).startsWith(util.todayStr())).length,
      logsTotal: store.count('audit_logs'),
      lastLogin: (store.filter('audit_logs', (l) => l.action === 'LOGIN').slice(-1)[0] || {}).createdAt || null,
    },
    storage: store.all('settings').length,
    user: { username: user.username, role: user.roleName },
  });
}

function handleBackup(ctx) {
  const { res, user } = ctx;
  if (!checkPermission(ctx, 'backup', 'create', res)) return;
  const file = store.backup('manual');
  service.audit('CONFIG', 'backup', { username: user.username, userId: user.id, entityLabel: 'Tạo bản sao lưu ' + file });
  ok(res, { file, backups: store.listBackups() });
}

function handleListBackups(ctx) {
  const { res } = ctx;
  if (!checkPermission(ctx, 'backup', 'view', res)) return;
  ok(res, store.listBackups());
}

function handleRestoreBackup(ctx) {
  const { res, body, user } = ctx;
  if (!checkPermission(ctx, 'backup', 'update', res)) return;
  store.backup('before-restore');
  store.restoreBackup(body.file);
  service.audit('RESTORE_DB', 'backup', { username: user.username, userId: user.id, entityLabel: 'Phục hồi từ ' + body.file });
  ok(res, { success: true, file: body.file });
}

function handleExportDatabase(ctx) {
  const { res, user } = ctx;
  if (!checkPermission(ctx, 'data_tools', 'export', res)) return;
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), exportedBy: user.username, version: service.settings().system.version, data: store.snapshot() }, null, 1);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="ams-database-${util.todayStr()}.json"`,
  });
  res.end(payload);
}

async function handleImportDatabase(ctx) {
  const { res, body, user } = ctx;
  if (!checkPermission(ctx, 'data_tools', 'create', res)) return;
  const payload = body.data || body;
  if (!payload.collections) return fail(res, 400, 'File không đúng định dạng CSDL AMS');
  store.backup('before-import');
  store.collections = payload.collections;
  store.meta = payload.meta || {};
  store.counters = payload.counters || {};
  store.flush();
  service.audit('IMPORT', 'database', { username: user.username, userId: user.id, entityLabel: 'Nhập toàn bộ CSDL' });
  ok(res, { success: true, collections: Object.keys(store.collections).length });
}

function handleResetDemo(ctx) {
  const { res, body, user } = ctx;
  if (!checkPermission(ctx, 'data_tools', 'delete', res)) return;
  if (body.confirm !== 'RESET') return fail(res, 400, 'Vui lòng xác nhận bằng cách gửi confirm="RESET"');
  store.backup('before-reset');
  const seed = require('./seed');
  seed.run({ fresh: true });
  service.audit('CONFIG', 'database', { username: user.username, userId: user.id, entityLabel: 'Khởi tạo lại dữ liệu mẫu' });
  ok(res, { success: true, message: 'Đã khởi tạo lại dữ liệu mẫu (tài khoản: admin / Admin@123)' });
}

function handleClearAuditLogs(ctx) {
  const { res, user } = ctx;
  if (!checkPermission(ctx, 'audit_logs', 'delete', res)) return;
  const count = store.count('audit_logs');
  store.collections.audit_logs = [];
  store.flush();
  service.audit('DELETE', 'audit_logs', { username: user.username, userId: user.id, entityLabel: `Xoá ${count} bản ghi nhật ký` });
  ok(res, { success: true, deleted: count });
}

function handleRevokeSession(ctx) {
  const { res, params, user } = ctx;
  if (!checkPermission(ctx, 'sessions', 'delete', res)) return;
  const session = store.find('sessions', params.id);
  if (!session) return fail(res, 404, 'Không tìm thấy phiên');
  store.update('sessions', session.id, { revokedAt: new Date().toISOString(), revokedBy: user.username });
  service.audit('CONFIG', 'sessions', { username: user.username, userId: user.id, entityLabel: 'Thu hồi phiên của ' + session.username });
  ok(res, { success: true });
}

function handleAdminResetPassword(ctx) {
  const { res, params, body, user } = ctx;
  if (!checkPermission(ctx, 'users', 'update', res)) return;
  const target = store.find('users', params.id);
  if (!target) return fail(res, 404, 'Không tìm thấy người dùng');
  const newPass = body.newPassword || 'Ams@' + Math.floor(100000 + Math.random() * 899999);
  const { salt, hash } = auth.hashPassword(newPass);
  store.update('users', target.id, { passwordSalt: salt, passwordHash: hash, mustChangePassword: true, failedAttempts: 0, status: target.status === 'locked' ? 'active' : target.status });
  // Thu hồi mọi phiên của người dùng
  store.filter('sessions', (s) => String(s.userId) === String(target.id) && !s.revokedAt).forEach((s) => store.update('sessions', s.id, { revokedAt: new Date().toISOString(), revokedBy: user.username }));
  service.audit('CONFIG', 'users', { username: user.username, userId: user.id, entityId: target.id, entityLabel: 'Đặt lại mật khẩu cho ' + target.username });
  ok(res, { success: true, newPassword: body.newPassword ? undefined : newPass, message: 'Đã đặt lại mật khẩu' });
}

function handleToggleUserStatus(ctx) {
  const { res, params, user } = ctx;
  if (!checkPermission(ctx, 'users', 'update', res)) return;
  const target = store.find('users', params.id);
  if (!target) return fail(res, 404, 'Không tìm thấy người dùng');
  if (String(target.id) === String(user.id)) return fail(res, 400, 'Không thể tự khoá tài khoản của mình');
  const status = target.status === 'locked' ? 'active' : 'locked';
  store.update('users', target.id, { status, failedAttempts: 0 });
  if (status === 'locked') store.filter('sessions', (s) => String(s.userId) === String(target.id) && !s.revokedAt).forEach((s) => store.update('sessions', s.id, { revokedAt: new Date().toISOString(), revokedBy: user.username }));
  service.audit('CONFIG', 'users', { username: user.username, userId: user.id, entityId: target.id, entityLabel: (status === 'locked' ? 'Khoá' : 'Mở khoá') + ' tài khoản ' + target.username });
  ok(res, { success: true, status });
}

function handlePermissionMatrix(ctx) {
  const { res } = ctx;
  ok(res, { modules: PERMISSION_MODULES, actions: PERMISSION_ACTIONS, roles: store.filter('roles', (r) => !r.isDeleted).map((r) => service.decorate('roles', r)) });
}

/** Sao lưu người dùng gửi lên (upload file .json) */
async function handleUploadBackup(ctx) {
  const { res, body, user } = ctx;
  if (!checkPermission(ctx, 'backup', 'create', res)) return;
  const content = body.content || (body.raw ? body.raw : null);
  if (!content) return fail(res, 400, 'Thiếu nội dung file sao lưu');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = 'db-upload-' + stamp + '.json';
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    if (!parsed.collections) throw new Error('File không đúng định dạng CSDL AMS');
    require('fs').writeFileSync(require('path').join(require('path').resolve(__dirname, '..', '..', 'data', 'backups'), name), JSON.stringify(parsed));
    service.audit('CONFIG', 'backup', { username: user.username, userId: user.id, entityLabel: 'Tải lên bản sao lưu ' + name });
    ok(res, { file: name, success: true });
  } catch (e) {
    fail(res, 400, 'File không hợp lệ: ' + e.message);
  }
}

/** Sinh script SQL (MySQL/PostgreSQL) từ dữ liệu hiện tại */
function handleExportSQL(ctx) {
  const { res, user, query } = ctx;
  if (!checkPermission(ctx, 'data_tools', 'export', res)) return;
  const dialect = query.get('dialect') || 'mysql';
  const lines = [];
  lines.push(`-- ============================================================`);
  lines.push(`-- AMS Pro - Kết xuất cấu trúc & dữ liệu (${dialect.toUpperCase()})`);
  lines.push(`-- Sinh lúc: ${new Date().toISOString()} bởi ${user.username}`);
  lines.push(`-- ============================================================`);
  lines.push('');
  const sqlType = (t) => {
    switch (t) {
      case T.NUMBER:
      case T.MONEY:
      case T.PERCENT:
        return dialect === 'postgres' ? 'NUMERIC(18,2)' : 'DECIMAL(18,2)';
      case T.BOOL:
        return dialect === 'postgres' ? 'BOOLEAN' : 'TINYINT(1)';
      case T.DATE:
        return 'DATE';
      case T.DATETIME:
        return dialect === 'postgres' ? 'TIMESTAMP' : 'DATETIME';
      case T.TEXT:
      case T.JSON:
        return dialect === 'postgres' ? 'JSONB' : 'JSON';
      default:
        return dialect === 'postgres' ? 'VARCHAR(255)' : 'VARCHAR(255)';
    }
  };
  Object.keys(ENTITIES).forEach((name) => {
    const e = ENTITIES[name];
    lines.push(`-- Bảng ${name}: ${e.label}`);
    lines.push(`CREATE TABLE IF NOT EXISTS ${name} (`);
    const cols = ['  id INTEGER PRIMARY KEY'];
    Object.keys(e.fields).forEach((f) => {
      const fd = e.fields[f];
      if (fd.type === T.JSON) cols.push(`  ${f} TEXT`);
      else cols.push(`  ${f} ${sqlType(fd.type)}${fd.required && !fd.auto ? ' NOT NULL' : ''}`);
    });
    cols.push('  createdAt VARCHAR(40)', '  updatedAt VARCHAR(40)', '  isDeleted ' + (dialect === 'postgres' ? 'BOOLEAN' : 'TINYINT(1)') + ' DEFAULT 0');
    lines.push(cols.join(',\n'));
    lines.push(');');
    lines.push('');
  });
  lines.push('-- ================= DỮ LIỆU =================');
  const quote = (v) => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return dialect === 'postgres' ? (v ? 'TRUE' : 'FALSE') : v ? '1' : '0';
    if (typeof v === 'object') return "'" + JSON.stringify(v).replace(/'/g, "''") + "'";
    return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
  };
  Object.keys(ENTITIES).forEach((name) => {
    const rows = store.all(name);
    if (!rows.length) return;
    lines.push(`-- ${rows.length} bản ghi vào ${name}`);
    rows.forEach((row) => {
      const keys = Object.keys(row).filter((k) => k !== 'id');
      lines.push(`INSERT INTO ${name} (id, ${keys.join(', ')}) VALUES (${quote(row.id)}, ${keys.map((k) => quote(row[k])).join(', ')});`);
    });
    lines.push('');
  });
  const buf = Buffer.from(lines.join('\n'), 'utf8');
  res.writeHead(200, {
    'Content-Type': 'application/sql; charset=utf-8',
    'Content-Disposition': `attachment; filename="ams-${dialect}-${util.todayStr()}.sql"`,
    'Content-Length': buf.length,
  });
  res.end(buf);
}

/* ============================ CHỨNG TỪ IN ============================ */

function handleDocument(ctx) {
  const { res, params, user, query } = ctx;
  const { type, id } = params;
  const html = docs.render(type, id, { user, settings: service.settings(), query });
  if (!html) return fail(res, 404, 'Không tìm thấy chứng từ');
  service.audit('EXPORT', 'documents', { username: user.username, userId: user.id, entityLabel: `In chứng từ ${type} #${id}` });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

/* ============================ THÔNG BÁO ============================ */

function handleNotifications(ctx) {
  const { res, user, query } = ctx;
  const onlyUnread = query.get('unread') === '1';
  let rows = store.all('notifications').slice().reverse();
  if (!user.isSuperAdmin) rows = rows.filter((n) => !n.userId || String(n.userId) === String(user.id));
  if (onlyUnread) rows = rows.filter((n) => !n.readAt);
  ok(res, rows.slice(0, 100), { unread: rows.filter((n) => !n.readAt).length });
}

function handleMarkNotifications(ctx) {
  const { res, body, user } = ctx;
  const ids = body.ids || [];
  if (body.all) store.filter('notifications', (n) => !n.readAt).forEach((n) => store.update('notifications', n.id, { readAt: new Date().toISOString() }));
  else ids.forEach((id) => store.update('notifications', id, { readAt: new Date().toISOString() }));
  ok(res, { success: true });
}

function handleRefreshAlerts(ctx) {
  const { res } = ctx;
  const created = service.refreshAlerts();
  ok(res, { created: created.length, items: created });
}

/* ============================ ĐĂNG KÝ ROUTES ============================ */

function register(router) {
  /* ---- Xác thực ---- */
  router.post('/api/auth/login', handleLogin);
  router.post('/api/auth/logout', handleLogout);
  router.get('/api/auth/me', handleMe);
  router.post('/api/auth/change-password', handleChangePassword);

  /* ---- Metadata ---- */
  router.get('/api/meta', handleMeta);
  router.get('/api/lookups/:collection', handleLookups);
  router.get('/api/settings', (ctx) => ok(ctx.res, service.settings()));
  router.put('/api/settings', async (ctx) => {
    if (!checkPermission(ctx, 'settings', 'update', ctx.res)) return;
    const updated = service.saveSettings(ctx.body.patch || ctx.body);
    service.audit('CONFIG', 'settings', { username: ctx.user.username, userId: ctx.user.id, entityLabel: 'Cập nhật cấu hình hệ thống', changes: ctx.body });
    ok(ctx.res, updated);
  });
  router.get('/api/numbering/preview/:entity', (ctx) => {
    const entity = requireEntity(ctx.params.entity, ctx.res);
    if (!entity) return;
    const cfg = service.settings();
    const rule = cfg.numbering[ctx.params.entity] || { prefix: entity.prefix, pattern: '{PREFIX}-{SEQ:4}' };
    const sample = util.buildCode(rule.pattern, { prefix: rule.prefix, seq: store.peekSequence(ctx.params.entity + ':' + new Date().getFullYear()) + 1 });
    ok(ctx.res, { pattern: rule.pattern, prefix: rule.prefix, sample });
  });

  /* ---- Dashboard ---- */
  router.get('/api/dashboard/summary', handleDashboard);
  router.get('/api/dashboard/analytics', handleAnalytics);

  /* ---- Báo cáo ---- */
  router.get('/api/reports/datasets', handleReportDatasets);
  router.get('/api/reports/datasets/:key/data', handleReportDatasetData);
  router.post('/api/reports/preview', handleReportPreview);
  router.post('/api/reports/render', handleReportRender);
  router.post('/api/reports/templates/clone', handleReportTemplateClone);
  router.get('/api/reports/blank-design', (ctx) => ok(ctx.res, reports.blankDesign()));

  /* ---- Nghiệp vụ đặc thù ---- */
  router.post('/api/depreciations/run', handleRunDepreciation);
  router.get('/api/depreciations/preview', handleDepreciationPreview);

  router.post('/api/stocktakes/:id/generate-items', handleStocktakeGenerate);
  router.post('/api/stocktakes/:id/items/:itemId', handleStocktakeItemUpdate);
  router.post('/api/stocktakes/:id/close', handleStocktakeClose);
  router.get('/api/scan/lookup', handleScanLookup);
  router.post('/api/scan/count', handleScanCount);
  router.get('/api/scan/history', handleScanHistory);
  router.get('/api/scan/export', handleScanExport);

  router.post('/api/transfers/:id/:action', (ctx) => workflowAction(ctx, 'transfers', 'status', transferActions));
  router.post('/api/disposals/:id/:action', (ctx) => workflowAction(ctx, 'disposals', 'status', disposalActions));
  router.post('/api/maintenances/:id/:action', (ctx) => workflowAction(ctx, 'maintenances', 'status', maintenanceActions));
  router.post('/api/assignments/:id/:action', (ctx) => workflowAction(ctx, 'assignments', 'status', assignmentActions));

  router.get('/api/assets/:id/history', (ctx) => {
    const assetId = ctx.params.id;
    const events = [];
    const push = (name, list, map) => list.forEach((r) => events.push(Object.assign({ _kind: name }, map(r))));
    push('assignments', store.filter('assignments', (r) => String(r.assetId) === String(assetId)), (r) => ({ at: r.date || r.createdAt, title: `Cấp phát/thu hồi - ${r.code}`, detail: service.decorate('assignments', r) }));
    push('transfers', store.filter('transfers', (r) => String(r.assetId) === String(assetId)), (r) => ({ at: r.date || r.createdAt, title: `Điều chuyển - ${r.code}`, detail: service.decorate('transfers', r) }));
    push('maintenances', store.filter('maintenances', (r) => String(r.assetId) === String(assetId)), (r) => ({ at: r.actualDate || r.plannedDate || r.createdAt, title: `Bảo trì - ${r.code}`, detail: service.decorate('maintenances', r) }));
    push('disposals', store.filter('disposals', (r) => String(r.assetId) === String(assetId)), (r) => ({ at: r.date || r.createdAt, title: `Thanh lý - ${r.code}`, detail: service.decorate('disposals', r) }));
    push('warranties', store.filter('warranties', (r) => String(r.assetId) === String(assetId)), (r) => ({ at: r.claimDate || r.startDate, title: `Bảo hành - ${r.code}`, detail: service.decorate('warranties', r) }));
    push('depreciations', store.filter('depreciations', (r) => String(r.assetId) === String(assetId)), (r) => ({ at: r.period, title: `Khấu hao kỳ ${r.period}`, detail: r }));
    events.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
    ok(ctx.res, events);
  });

  /* ---- Nhập / xuất ---- */
  router.get('/api/entities/:entity/export.csv', handleExportEntity);
  router.post('/api/entities/:entity/import', handleImportEntity);
  router.get('/api/entities/:entity/trash', handleTrash);
  router.post('/api/entities/:entity/:id/restore', handleRestoreEntity);

  /* ---- CRUD tổng quát ---- */
  router.get('/api/entities/:entity', handleListEntity);
  router.post('/api/entities/:entity', handleCreateEntity);
  router.get('/api/entities/:entity/:id', handleGetEntity);
  router.put('/api/entities/:entity/:id', handleUpdateEntity);
  router.patch('/api/entities/:entity/:id', handleUpdateEntity);
  router.delete('/api/entities/:entity/:id', handleDeleteEntity);

  /* ---- Quản trị ---- */
  router.get('/api/admin/system', handleSystemStatus);
  router.get('/api/admin/permission-matrix', handlePermissionMatrix);
  router.get('/api/admin/backups', handleListBackups);
  router.post('/api/admin/backup', handleBackup);
  router.post('/api/admin/restore-backup', handleRestoreBackup);
  router.post('/api/admin/upload-backup', handleUploadBackup);
  router.get('/api/admin/db/export', handleExportDatabase);
  router.post('/api/admin/db/import', handleImportDatabase);
  router.get('/api/admin/db/export-sql', handleExportSQL);
  router.post('/api/admin/reset-demo', handleResetDemo);
  router.delete('/api/admin/audit-logs', handleClearAuditLogs);
  router.delete('/api/admin/sessions/:id', handleRevokeSession);
  router.post('/api/admin/users/:id/reset-password', handleAdminResetPassword);
  router.post('/api/admin/users/:id/toggle-status', handleToggleUserStatus);

  /* ---- Thông báo ---- */
  router.get('/api/notifications', handleNotifications);
  router.post('/api/notifications/mark', handleMarkNotifications);
  router.post('/api/notifications/refresh-alerts', handleRefreshAlerts);

  /* ---- Chứng từ in ---- */
  router.get('/api/documents/labels', handleLabelBatch);
  router.get('/api/documents/:type/:id', handleDocument);

  /* ---- Health ---- */
  router.get('/api/health', (ctx) =>
    ok(ctx.res, {
      status: 'ok',
      app: service.settings().system.appName,
      version: service.settings().system.version,
      time: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
    })
  );
}

module.exports = {
  register,
  loadUserFromRequest,
  sendJSON,
  sendError,
  requireEntity,
  checkPermission,
  resolveGenericEntity: () => null,
  COOKIE,
  publicSettings,
};
