'use strict';
/**
 * service.js — Lớp nghiệp vụ dùng chung
 * - Bổ sung trường dẫn xuất (join tên danh mục/phòng ban/người dùng...)
 * - Tính khấu hao theo nhiều phương pháp, giá trị còn lại, bảo hành
 * - Truy vấn danh sách: lọc, tìm kiếm không dấu, sắp xếp, phân trang
 * - Thống kê cho dashboard, sinh thông báo, ghi nhật ký
 */

const store = require('./store');
const schema = require('./schema');
const util = require('./util');

const { ENTITIES, T } = schema;

/* =========================== TIỆN ÍCH TRA CỨU =========================== */

function nameOf(collection, id, field) {
  const rec = store.find(collection, id);
  if (!rec) return '';
  return rec[field || 'name'] || rec.code || '';
}

function settings() {
  const saved = store.all('settings');
  const merged = util.clone(schema.DEFAULT_SETTINGS);
  saved.forEach((row) => {
    if (typeof row.value === 'object' && row.value !== null && merged[row.key] && typeof merged[row.key] === 'object') {
      merged[row.key] = Object.assign({}, merged[row.key], row.value);
    } else {
      merged[row.key] = row.value;
    }
  });
  return merged;
}

function saveSettings(patch) {
  Object.keys(patch).forEach((key) => {
    const existing = store.findOne('settings', (s) => s.key === key);
    if (existing) store.update('settings', existing.id, { value: patch[key] });
    else store.insert('settings', { key, value: patch[key] });
  });
  return settings();
}

/* =========================== ĐÁNH MÃ TỰ ĐỘNG =========================== */

function generateCode(entityName, fields) {
  const cfg = settings();
  const entity = ENTITIES[entityName];
  const rule = (cfg.numbering && cfg.numbering[entityName]) || { prefix: (entity && entity.prefix) || 'TS', pattern: '{PREFIX}-{SEQ:4}' };
  const year = new Date().getFullYear();
  const key = entityName + (rule.resetYearly ? ':' + year : '');
  const dept = fields && fields.departmentId ? nameOf('departments', fields.departmentId, 'code') : 'CTY';
  let seq = store.nextSequence(key) + 1;
  let code = util.buildCode(rule.pattern, { prefix: rule.prefix, seq, dept });
  // Tránh trùng mã (trường hợp người dùng tự nhập tay)
  const codeField = (entity && entity.codeField) || 'code';
  let guard = 0;
  while (store.all(entityName).some((r) => String(r[codeField]).toUpperCase() === code.toUpperCase()) && guard < 1000) {
    guard += 1;
    seq = store.nextSequence(key) + 1;
    code = util.buildCode(rule.pattern, { prefix: rule.prefix, seq, dept });
  }
  return code;
}

/* =========================== KHẤU HAO =========================== */

/** Số tháng đã trôi qua kể từ ngày bắt đầu tính khấu hao */
function monthsElapsed(startDate, upTo) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const end = upTo ? new Date(upTo) : new Date();
  if (end < start) return 0;
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() >= start.getDate()) months += 1; // quy tắc tháng tròn
  return Math.max(0, months);
}

/**
 * Tính khấu hao luỹ kế & giá trị còn lại của 1 tài sản
 * @returns {{monthly:number, accumulated:number, bookValue:number, periods:number, lifeMonths:number}}
 */
function computeDepreciation(asset, upTo) {
  const original = Number(asset.originalCost || asset.purchasePrice || 0);
  const salvage = Number(asset.salvageValue || 0);
  const life = Math.max(1, Number(asset.usefulLife) || 60);
  const method = asset.depreciationMethod || 'straight_line';
  const depreciableBase = Math.max(0, original - salvage);
  const start = asset.depreciationStart || asset.purchaseDate;
  const elapsed = Math.min(monthsElapsed(start, upTo), life);

  let monthly = 0;
  let accumulated = 0;

  switch (method) {
    case 'none':
      monthly = 0;
      accumulated = 0;
      break;
    case 'declining_balance':
    case 'double_declining': {
      const factor = method === 'double_declining' ? 2 : 1.5;
      const annualRate = (Number(asset.depreciationRate) || (100 / (life / 12))) / 100;
      let book = original;
      let acc = 0;
      let m = Math.floor(annualRate * factor * 100) / 100 / 12;
      for (let i = 0; i < elapsed; i++) {
        const dep = Math.min(book * m, Math.max(0, book - salvage));
        acc += dep;
        book -= dep;
      }
      accumulated = acc;
      monthly = original * m;
      break;
    }
    case 'sum_of_years': {
      const years = Math.max(1, Math.round(life / 12));
      const sum = (years * (years + 1)) / 2;
      let acc = 0;
      for (let i = 0; i < elapsed; i++) {
        const yearIndex = Math.floor(i / 12) + 1;
        const yearDep = (depreciableBase * (years - yearIndex + 1)) / sum;
        acc += yearDep / 12;
      }
      accumulated = Math.min(acc, depreciableBase);
      monthly = depreciableBase / life;
      break;
    }
    case 'productive': {
      monthly = depreciableBase / life;
      accumulated = Math.min(monthly * elapsed, depreciableBase);
      break;
    }
    case 'straight_line':
    default: {
      monthly = depreciableBase / life;
      accumulated = Math.min(monthly * elapsed, depreciableBase);
      break;
    }
  }

  accumulated = Math.round(accumulated);
  const bookValue = Math.max(salvage, Math.round(original - accumulated));
  return { monthly: Math.round(monthly), accumulated, bookValue, periods: elapsed, lifeMonths: life };
}

/** Bổ sung mọi trường dẫn xuất cho 1 tài sản */
function decorateAsset(asset, opts) {
  if (!asset) return asset;
  const a = Object.assign({}, asset);
  // Join
  const cat = store.find('categories', a.categoryId);
  a.categoryName = cat ? cat.name : '';
  a.categoryCode = cat ? cat.code : '';
  a.locationName = nameOf('locations', a.locationId);
  a.departmentName = nameOf('departments', a.departmentId);
  const assignee = store.find('users', a.assigneeId);
  a.assigneeName = assignee ? assignee.fullName : '';
  a.assigneeEmail = assignee ? assignee.email : '';
  const supplier = store.find('suppliers', a.supplierId);
  a.supplierName = supplier ? supplier.name : '';
  const resp = store.find('users', a.responsibleId);
  a.responsibleName = resp ? resp.fullName : '';
  const contract = store.find('contracts', a.contractId);
  a.contractCode = contract ? contract.code : '';

  // Nguyên giá = giá mua*(1+VAT%) + vận chuyển + lắp đặt + khác
  const price = Number(a.purchasePrice || 0);
  const vat = (price * Number(a.vatPercent || 0)) / 100;
  a.vatAmount = Math.round(vat);
  a.originalCost = Math.round(price + vat + Number(a.transportCost || 0) + Number(a.installCost || 0) + Number(a.otherCost || 0));

  // Khấu hao
  const dep = computeDepreciation(Object.assign({}, a, { originalCost: a.originalCost }), opts && opts.upTo);
  a.monthlyDepreciation = dep.monthly;
  a.accumulatedDepreciation = dep.accumulated;
  a.bookValue = dep.bookValue;
  a.depreciationPeriods = dep.periods;
  a.depreciationProgress = dep.lifeMonths ? Math.round((dep.periods / dep.lifeMonths) * 100) : 0;
  a.totalCost = a.originalCost;

  // Bảo hành
  if (!a.warrantyEnd && a.warrantyStart && a.warrantyMonths) {
    const d = util.addMonths(a.warrantyStart, a.warrantyMonths);
    a.warrantyEnd = util.todayStr(d);
  }
  a.warrantyRemainingDays = a.warrantyEnd ? util.diffDays(a.warrantyEnd, new Date()) : 0;
  a.isWarrantyActive = a.warrantyEnd ? a.warrantyRemainingDays >= 0 : false;

  // Tuổi tài sản
  a.ageMonths = monthsElapsed(a.purchaseDate, new Date());
  a.profitLoss = Number(a.disposalValue || 0) - Number(a.bookValue || 0);

  // Cảnh báo
  a.alerts = [];
  if (a.nextMaintenanceAt && util.diffDays(a.nextMaintenanceAt, new Date()) <= 15 && util.diffDays(a.nextMaintenanceAt, new Date()) > -365 * 5) {
    a.alerts.push({ type: 'maintenance', label: 'Đến hạn bảo trì' });
  }
  if (a.warrantyEnd && a.warrantyRemainingDays >= 0 && a.warrantyRemainingDays <= 30) {
    a.alerts.push({ type: 'warranty', label: 'Sắp hết bảo hành' });
  }
  if (a.depreciationProgress >= 100) a.alerts.push({ type: 'depreciated', label: 'Đã khấu hao hết' });
  return a;
}

/* =========================== JOIN BẢN GHI KHÁC =========================== */

function decorateRecord(entityName, record) {
  if (!record) return record;
  const r = Object.assign({}, record);
  switch (entityName) {
    case 'assignments': {
      const asset = store.find('assets', r.assetId);
      r.assetCode = asset ? asset.code : r.assetCode;
      r.assetName = asset ? asset.name : r.assetName;
      r.categoryName = asset ? nameOf('categories', asset.categoryId) : '';
      r.unit = asset ? asset.unit : '';
      r.serial = asset ? asset.serial : '';
      r.toUserName = nameOf('users', r.toUserId, 'fullName');
      r.fromUserName = nameOf('users', r.fromUserId, 'fullName');
      r.departmentName = nameOf('departments', r.departmentId);
      r.locationName = nameOf('locations', r.locationId);
      break;
    }
    case 'transfers': {
      const asset = store.find('assets', r.assetId);
      r.assetCode = asset ? asset.code : r.assetCode;
      r.assetName = asset ? asset.name : r.assetName;
      r.originalCost = asset ? asset.originalCost : 0;
      r.fromDepartmentName = nameOf('departments', r.fromDepartmentId);
      r.toDepartmentName = nameOf('departments', r.toDepartmentId);
      r.fromUserName = nameOf('users', r.fromUserId, 'fullName');
      r.toUserName = nameOf('users', r.toUserId, 'fullName');
      r.fromLocationName = nameOf('locations', r.fromLocationId);
      r.toLocationName = nameOf('locations', r.toLocationId);
      r.requestedByName = nameOf('users', r.requestedBy, 'fullName');
      r.approvedByName = nameOf('users', r.approvedBy, 'fullName');
      break;
    }
    case 'maintenances': {
      const asset = store.find('assets', r.assetId);
      r.assetCode = asset ? asset.code : r.assetCode;
      r.assetName = asset ? asset.name : r.assetName;
      r.serial = asset ? asset.serial : '';
      r.categoryName = asset ? nameOf('categories', asset.categoryId) : '';
      r.departmentName = asset ? nameOf('departments', asset.departmentId) : '';
      r.locationName = asset ? nameOf('locations', asset.locationId) : '';
      r.vendorName = nameOf('suppliers', r.vendorId) || r.vendorName || '';
      r.totalCost = Number(r.cost || 0) + Number(r.partsCost || 0);
      r.daysOverdue = r.nextDueDate ? util.diffDays(new Date(), r.nextDueDate) : 0;
      break;
    }
    case 'depreciations': {
      const asset = store.find('assets', r.assetId);
      r.assetCode = asset ? asset.code : r.assetCode;
      r.assetName = asset ? asset.name : r.assetName;
      r.categoryName = asset ? nameOf('categories', asset.categoryId) : '';
      r.departmentName = asset ? nameOf('departments', asset.departmentId) : '';
      break;
    }
    case 'disposals': {
      const asset = store.find('assets', r.assetId);
      r.assetCode = asset ? asset.code : r.assetCode;
      r.assetName = asset ? asset.name : r.assetName;
      r.categoryName = asset ? nameOf('categories', asset.categoryId) : '';
      r.departmentName = asset ? nameOf('departments', asset.departmentId) : '';
      if (asset) {
        const dec = decorateAsset(asset);
        if (!r.originalCost) r.originalCost = dec.originalCost;
        if (!r.accumulated) r.accumulated = dec.accumulatedDepreciation;
        if (!r.bookValue) r.bookValue = dec.bookValue;
      }
      r.profitLoss = Number(r.salePrice || 0) - Number(r.disposalCost || 0) - Number(r.bookValue || 0);
      r.approvedByName = nameOf('users', r.approvedBy, 'fullName');
      break;
    }
    case 'warranties': {
      const asset = store.find('assets', r.assetId);
      r.assetCode = asset ? asset.code : r.assetCode;
      r.assetName = asset ? asset.name : r.assetName;
      r.serial = asset ? asset.serial : '';
      r.supplierName = nameOf('suppliers', r.supplierId);
      r.remainingDays = r.endDate ? util.diffDays(r.endDate, new Date()) : 0;
      if (r.endDate) {
        const rd = util.diffDays(r.endDate, new Date());
        r.computedStatus = rd < 0 ? 'expired' : rd <= 30 ? 'expiring' : 'active';
      }
      break;
    }
    case 'contracts': {
      r.supplierName = nameOf('suppliers', r.supplierId);
      r.assetCount = store.filter('assets', (a) => String(a.contractId) === String(r.id)).length;
      r.remainingDays = r.endDate ? util.diffDays(r.endDate, new Date()) : 0;
      break;
    }
    case 'categories': {
      const assets = store.filter('assets', (a) => String(a.categoryId) === String(r.id) && !a.isDeleted);
      r.assetCount = assets.length;
      r.totalValue = assets.reduce((s, a) => s + Number(a.bookValue || a.originalCost || 0), 0);
      r.originalValue = assets.reduce((s, a) => s + Number(a.originalCost || 0), 0);
      r.parentName = nameOf('categories', r.parentId);
      break;
    }
    case 'departments': {
      const assets = store.filter('assets', (a) => String(a.departmentId) === String(r.id) && !a.isDeleted);
      r.assetCount = assets.length;
      r.totalValue = assets.reduce((s, a) => s + Number(a.bookValue || a.originalCost || 0), 0);
      r.originalValue = assets.reduce((s, a) => s + Number(a.originalCost || 0), 0);
      r.parentName = nameOf('departments', r.parentId);
      r.managerName = nameOf('users', r.managerId, 'fullName');
      r.userCount = store.filter('users', (u) => String(u.departmentId) === String(r.id)).length;
      break;
    }
    case 'locations': {
      const assets = store.filter('assets', (a) => String(a.locationId) === String(r.id) && !a.isDeleted);
      r.assetCount = assets.length;
      r.totalValue = assets.reduce((s, a) => s + Number(a.bookValue || a.originalCost || 0), 0);
      r.usagePercent = r.capacity ? Math.min(100, Math.round((assets.length / r.capacity) * 100)) : 0;
      r.parentName = nameOf('locations', r.parentId);
      r.managerName = nameOf('users', r.managerId, 'fullName');
      break;
    }
    case 'suppliers': {
      const assets = store.filter('assets', (a) => String(a.supplierId) === String(r.id) && !a.isDeleted);
      r.assetCount = assets.length;
      r.totalValue = assets.reduce((s, a) => s + Number(a.originalCost || 0), 0);
      r.contractCount = store.filter('contracts', (c) => String(c.supplierId) === String(r.id)).length;
      break;
    }
    case 'users': {
      r.departmentName = nameOf('departments', r.departmentId);
      const role = store.find('roles', r.roleId);
      r.roleName = role ? role.name : '';
      r.assetCount = store.filter('assets', (a) => String(a.assigneeId) === String(r.id) && !a.isDeleted).length;
      r.assetValue = store
        .filter('assets', (a) => String(a.assigneeId) === String(r.id) && !a.isDeleted)
        .reduce((s, a) => s + Number(a.bookValue || a.originalCost || 0), 0);
      r.managerName = nameOf('users', r.managerId, 'fullName');
      delete r.passwordHash;
      delete r.passwordSalt;
      break;
    }
    case 'roles': {
      r.userCount = store.filter('users', (u) => String(u.roleId) === String(r.id)).length;
      break;
    }
    case 'stocktakes': {
      r.departmentName = nameOf('departments', r.departmentId);
      r.locationName = nameOf('locations', r.locationId);
      r.categoryName = nameOf('categories', r.categoryId);
      r.leaderName = nameOf('users', r.leaderId, 'fullName');
      const items = store.filter('stocktake_items', (i) => String(i.stocktakeId) === String(r.id));
      r.totalItems = items.length;
      r.countedItems = items.filter((i) => i.counted).length;
      r.diffItems = items.filter((i) => i.counted && i.result && i.result !== 'match').length;
      r.matchItems = items.filter((i) => i.counted && i.result === 'match').length;
      r.progress = items.length ? Math.round((r.countedItems / items.length) * 100) : 0;
      break;
    }
    case 'stocktake_items': {
      r.stocktakeCode = nameOf('stocktakes', r.stocktakeId, 'code');
      r.countedByName = nameOf('users', r.countedBy, 'fullName');
      r.conditionLabel = (schema.ASSET_CONDITION.find((c) => c.value === r.conditionFound) || {}).label || '';
      break;
    }
    case 'report_templates': {
      r.datasetLabel = (reportDatasets()[r.dataset] || {}).label || r.dataset;
      break;
    }
    case 'attachments': {
      r.entityLabel = r.entity ? nameOf(r.entity, r.entityId) : '';
      break;
    }
    default:
      break;
  }
  return r;
}

function decorate(entityName, record) {
  if (entityName === 'assets') return decorateAsset(record);
  return decorateRecord(entityName, record);
}

/* =========================== TRUY VẤN DANH SÁCH =========================== */

function matchFilter(record, field, value) {
  const raw = record[field];
  if (value === '__empty__') return raw === undefined || raw === null || raw === '';
  if (value === '__notempty__') return !(raw === undefined || raw === null || raw === '');
  if (String(raw) === String(value)) return true;
  if (typeof value === 'string' && value.includes(',')) {
    const list = value.split(',').map((s) => s.trim());
    return list.some((v) => String(raw) === v || (v.endsWith('*') && String(raw).startsWith(v.slice(0, -1))));
  }
  if (typeof value === 'string' && value.startsWith('!')) return String(raw) !== value.slice(1);
  return false;
}

/**
 * Truy vấn danh sách tổng quát
 * @param {string} entityName
 * @param {object} query { page, limit, q, sort, order, filters, range, includeDeleted }
 */
function listEntity(entityName, query, options) {
  const entity = ENTITIES[entityName];
  if (!entity) throw new Error('Thực thể không tồn tại: ' + entityName);
  const opts = options || {};
  let rows = store.all(entityName).slice();

  if (entity.softDelete && !query.includeDeleted) rows = rows.filter((r) => !r.isDeleted);
  if (query.includeDeleted === 'only') rows = rows.filter((r) => r.isDeleted);

  // Join trường dẫn xuất trước khi lọc (để lọc theo tên phòng ban, danh mục...)
  rows = rows.map((r) => decorate(entityName, r));

  if (opts.filterFn) rows = rows.filter(opts.filterFn);

  // Tìm kiếm text (không dấu, nhiều từ khoá)
  if (query.q) {
    const terms = util.normalizeVN(query.q).split(/\s+/).filter(Boolean);
    const fields = entity.searchFields || Object.keys(entity.fields);
    rows = rows.filter((r) => {
      const haystack = util.normalizeVN(fields.map((f) => (Array.isArray(r[f]) ? r[f].join(' ') : r[f])).join(' '));
      return terms.every((t) => haystack.includes(t));
    });
  }

  // Lọc theo trường
  Object.keys(query.filters || {}).forEach((field) => {
    const value = query.filters[field];
    if (value === '' || value === undefined || value === null) return;
    rows = rows.filter((r) => matchFilter(r, field, value));
  });

  // Lọc theo khoảng ngày/số
  Object.keys(query.range || {}).forEach((field) => {
    const { from, to } = query.range[field];
    rows = rows.filter((r) => {
      const v = r[field];
      if (v === undefined || v === null || v === '') return false;
      if (from && new Date(v) < new Date(from)) return false;
      if (to && new Date(v) > new Date(to + (String(to).length === 10 ? 'T23:59:59' : ''))) return false;
      return true;
    });
  });

  // Sắp xếp
  let sortField = query.sort || (entity.defaultSort && entity.defaultSort.field) || 'id';
  let order = query.order || (entity.defaultSort && entity.defaultSort.order) || 'desc';
  if (opts.sortFn) {
    rows.sort((a, b) => opts.sortFn(a, b, sortField, order));
  } else {
    rows.sort((a, b) => {
      let x = a[sortField];
      let y = b[sortField];
      if (typeof x === 'string' && typeof y === 'string' && sortField !== 'code') {
        x = util.normalizeVN(x);
        y = util.normalizeVN(y);
      }
      if (x === undefined || x === null) x = '';
      if (y === undefined || y === null) y = '';
      if (typeof x === 'number' && typeof y === 'number') return order === 'asc' ? x - y : y - x;
      return order === 'asc' ? String(x).localeCompare(String(y), 'vi') : String(y).localeCompare(String(x), 'vi');
    });
  }

  const total = rows.length;
  const page = Math.max(1, query.page || 1);
  const limit = query.limit > 0 ? query.limit : 25;
  const start = (page - 1) * limit;
  const paged = opts.noPaging ? rows : rows.slice(start, start + limit);

  return {
    data: paged,
    meta: {
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      from: total ? start + 1 : 0,
      to: Math.min(start + limit, total),
    },
  };
}

/* =========================== THỐNG KÊ DASHBOARD =========================== */

function dashboardSummary(range) {
  const assets = store.filter('assets', (a) => !a.isDeleted).map((a) => decorateAsset(a));
  const to = range && range.to ? new Date(range.to) : new Date();
  const now = new Date();
  const active = assets.filter((a) => !['disposed', 'lost'].includes(a.status));

  const totalOriginal = assets.reduce((s, a) => s + Number(a.originalCost || 0), 0);
  const totalBook = active.reduce((s, a) => s + Number(a.bookValue || 0), 0);
  const totalAccum = assets.reduce((s, a) => s + Number(a.accumulatedDepreciation || 0), 0);
  const inUse = assets.filter((a) => ['in_use', 'allocated'].includes(a.status)).length;
  const inStock = assets.filter((a) => a.status === 'in_stock').length;
  const repairing = assets.filter((a) => ['maintenance', 'warranty', 'damaged'].includes(a.status)).length;
  const disposed = assets.filter((a) => a.status === 'disposed').length;

  // Nhóm theo danh mục
  const byCategory = {};
  assets.forEach((a) => {
    const key = a.categoryName || 'Chưa phân loại';
    byCategory[key] = byCategory[key] || { name: key, count: 0, original: 0, book: 0 };
    byCategory[key].count += 1;
    byCategory[key].original += Number(a.originalCost || 0);
    byCategory[key].book += Number(a.bookValue || 0);
  });

  // Nhóm theo phòng ban
  const byDepartment = {};
  assets.forEach((a) => {
    const key = a.departmentName || 'Chưa phân bổ';
    byDepartment[key] = byDepartment[key] || { name: key, count: 0, original: 0, book: 0 };
    byDepartment[key].count += 1;
    byDepartment[key].original += Number(a.originalCost || 0);
    byDepartment[key].book += Number(a.bookValue || 0);
  });

  // Nhóm theo trạng thái
  const byStatus = schema.ASSET_STATUS.map((s) => ({
    value: s.value,
    label: s.label,
    color: s.color,
    count: assets.filter((a) => a.status === s.value).length,
  })).filter((s) => s.count > 0);

  // Nhóm theo tình trạng
  const byCondition = schema.ASSET_CONDITION.map((c) => ({
    value: c.value,
    label: c.label,
    color: c.color,
    count: assets.filter((a) => a.condition === c.value).length,
  }));

  // Nhóm theo vị trí (top 8)
  const byLocation = Object.values(
    assets.reduce((acc, a) => {
      const key = a.locationName || 'Chưa xác định';
      acc[key] = acc[key] || { name: key, count: 0, book: 0 };
      acc[key].count += 1;
      acc[key].book += Number(a.bookValue || 0);
      return acc;
    }, {})
  )
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Khấu hao 12 tháng gần nhất (mô phỏng từ dữ liệu bút toán)
  const depreciations = store.filter('depreciations', (d) => !d.isDeleted);
  const monthlyDep = {};
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${util.pad(d.getMonth() + 1, 2)}`;
    monthlyDep[key] = { period: key, amount: 0, count: 0 };
  }
  depreciations.forEach((row) => {
    if (monthlyDep[row.period]) {
      monthlyDep[row.period].amount += Number(row.depreciationAmount || 0);
      monthlyDep[row.period].count += 1;
    }
  });

  // Mua sắm theo năm
  const byYear = {};
  assets.forEach((a) => {
    const y = a.purchaseDate ? String(a.purchaseDate).slice(0, 4) : 'Khác';
    byYear[y] = byYear[y] || { year: y, count: 0, value: 0 };
    byYear[y].count += 1;
    byYear[y].value += Number(a.originalCost || 0);
  });

  // Cảnh báo
  const maintenanceDue = assets
    .filter((a) => a.nextMaintenanceAt && util.diffDays(a.nextMaintenanceAt, now) <= 30 && !['disposed', 'lost'].includes(a.status))
    .sort((a, b) => new Date(a.nextMaintenanceAt) - new Date(b.nextMaintenanceAt));
  const warrantyExpiring = assets
    .filter((a) => a.warrantyEnd && util.diffDays(a.warrantyEnd, now) >= 0 && util.diffDays(a.warrantyEnd, now) <= 30)
    .sort((a, b) => new Date(a.warrantyEnd) - new Date(b.warrantyEnd));
  const fullyDepreciated = assets.filter((a) => a.depreciationProgress >= 100 && !['disposed', 'lost'].includes(a.status));
  const pendingApprovals = {
    transfers: store.filter('transfers', (t) => !t.isDeleted && t.status === 'pending').length,
    disposals: store.filter('disposals', (d) => !d.isDeleted && d.status === 'pending').length,
    maintenances: store.filter('maintenances', (m) => !m.isDeleted && m.status === 'pending').length,
  };

  // Chi phí bảo trì theo tháng
  const maintenanceCost = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${util.pad(d.getMonth() + 1, 2)}`;
    maintenanceCost[key] = { period: key, amount: 0, count: 0 };
  }
  store.filter('maintenances', (m) => !m.isDeleted).forEach((m) => {
    const key = String(m.actualDate || m.plannedDate || m.createdAt || '').slice(0, 7);
    if (maintenanceCost[key]) {
      maintenanceCost[key].amount += Number(m.cost || 0) + Number(m.partsCost || 0);
      maintenanceCost[key].count += 1;
    }
  });

  return {
    kpi: {
      totalAssets: assets.length,
      activeAssets: active.length,
      inUse,
      inStock,
      repairing,
      disposed,
      totalOriginal,
      totalBook,
      totalAccumulated: totalAccum,
      depreciationRate: totalOriginal ? Math.round((totalAccum / totalOriginal) * 1000) / 10 : 0,
      avgAssetValue: assets.length ? Math.round(totalOriginal / assets.length) : 0,
      assetGrowth30d: assets.filter((a) => util.diffDays(now, a.createdAt) <= 30).length,
      users: store.count('users', (u) => !u.isDeleted),
      departments: store.count('departments', (d) => !d.isDeleted),
      locations: store.count('locations', (l) => !l.isDeleted),
      suppliers: store.count('suppliers', (s) => !s.isDeleted),
      maintenanceCostThisYear: store
        .filter('maintenances', (m) => !m.isDeleted && String(m.actualDate || '').startsWith(String(now.getFullYear())))
        .reduce((s, m) => s + Number(m.cost || 0) + Number(m.partsCost || 0), 0),
      maintenanceDue: maintenanceDue.length,
      warrantyExpiring: warrantyExpiring.length,
      fullyDepreciated: fullyDepreciated.length,
      pendingApprovals: pendingApprovals.transfers + pendingApprovals.disposals,
      openStocktakes: store.count('stocktakes', (s) => s.status === 'open' && !s.isDeleted),
    },
    byCategory: Object.values(byCategory).sort((a, b) => b.original - a.original),
    byDepartment: Object.values(byDepartment).sort((a, b) => b.original - a.original),
    byStatus,
    byCondition,
    byLocation,
    depreciationTrend: Object.values(monthlyDep),
    maintenanceTrend: Object.values(maintenanceCost),
    byYear: Object.values(byYear).sort((a, b) => String(a.year).localeCompare(String(b.year))),
    alerts: {
      maintenanceDue: maintenanceDue.slice(0, 10),
      warrantyExpiring: warrantyExpiring.slice(0, 10),
      fullyDepreciated: fullyDepreciated.slice(0, 10),
    },
    recentActivity: store
      .filter('audit_logs', () => true)
      .slice(-15)
      .reverse()
      .map((l) => ({ createdAt: l.createdAt, username: l.username, action: l.action, entity: l.entity, entityLabel: l.entityLabel })),
    topValueAssets: assets.sort((a, b) => Number(b.originalCost || 0) - Number(a.originalCost || 0)).slice(0, 10),
  };
}

/* =========================== DATASET CHO REPORT DESIGNER =========================== */

/**
 * Nguồn dữ liệu cho Report Designer. Mỗi dataset = 1 "bảng" phẳng gồm
 * các trường có thể kéo thả vào mẫu báo cáo.
 */
function reportDatasets() {
  const ds = {};

  // Dataset tự sinh từ metadata của mọi thực thể
  Object.keys(ENTITIES).forEach((key) => {
    const entity = ENTITIES[key];
    const fields = [];
    Object.keys(entity.fields).forEach((fname) => {
      const f = entity.fields[fname];
      if (f.hidden && !f.computed) return;
      if (f.type === T.PASSWORD || f.type === T.JSON) return;
      fields.push({
        key: fname,
        label: f.label,
        type: f.type === T.REF ? T.STRING : f.type,
        options: f.options || null,
        group: f.group || 'Thông tin chung',
      });
    });
    Object.keys(entity.virtual || {}).forEach((vname) => {
      fields.push({ key: vname, label: entity.virtual[vname].label, type: entity.virtual[vname].type, group: 'Tính toán' });
    });
    ds[key] = {
      key,
      label: entity.label,
      group: 'Nghiệp vụ',
      entity: key,
      fields,
    };
  });

  // Dataset tổng hợp đặc biệt (SQL-like view)
  ds.v_asset_full = {
    key: 'v_asset_full',
    label: 'Tài sản (đầy đủ thông tin)',
    group: 'Tổng hợp',
    entity: 'assets',
    sql: 'SELECT * FROM assets LEFT JOIN categories, departments, locations, suppliers, users',
    fields: (ENTITIES.assets ? Object.keys(ENTITIES.assets.fields).map((f) => ({
      key: f,
      label: ENTITIES.assets.fields[f].label,
      type: ENTITIES.assets.fields[f].type === T.REF ? T.STRING : ENTITIES.assets.fields[f].type,
      group: ENTITIES.assets.fields[f].group || 'Thông tin chung',
    })) : []).concat([
      { key: 'ageMonths', label: 'Số tháng sử dụng', type: T.NUMBER, group: 'Tính toán' },
      { key: 'depreciationProgress', label: 'Tiến độ khấu hao (%)', type: T.NUMBER, group: 'Tính toán' },
      { key: 'warrantyRemainingDays', label: 'Ngày còn bảo hành', type: T.NUMBER, group: 'Tính toán' },
      { key: 'vatAmount', label: 'Tiền VAT', type: T.MONEY, group: 'Tính toán' },
    ]),
  };

  ds.v_depreciation_by_period = {
    key: 'v_depreciation_by_period',
    label: 'Khấu hao theo kỳ (tổng hợp)',
    group: 'Tổng hợp',
    entity: 'depreciations',
    fields: [
      { key: 'period', label: 'Kỳ', type: T.STRING, group: 'Thông tin chung' },
      { key: 'departmentName', label: 'Phòng ban', type: T.STRING, group: 'Thông tin chung' },
      { key: 'assetCode', label: 'Mã tài sản', type: T.STRING, group: 'Thông tin chung' },
      { key: 'assetName', label: 'Tên tài sản', type: T.STRING, group: 'Thông tin chung' },
      { key: 'openingValue', label: 'Giá trị đầu kỳ', type: T.MONEY, group: 'Số liệu' },
      { key: 'depreciationAmount', label: 'Mức khấu hao', type: T.MONEY, group: 'Số liệu' },
      { key: 'accumulated', label: 'Hao mòn luỹ kế', type: T.MONEY, group: 'Số liệu' },
      { key: 'closingValue', label: 'Giá trị còn lại', type: T.MONEY, group: 'Số liệu' },
    ],
  };

  ds.v_asset_value_by_dept = {
    key: 'v_asset_value_by_dept',
    label: 'Giá trị tài sản theo phòng ban',
    group: 'Tổng hợp',
    entity: 'departments',
    fields: [
      { key: 'code', label: 'Mã phòng ban', type: T.STRING, group: 'Thông tin chung' },
      { key: 'name', label: 'Tên phòng ban', type: T.STRING, group: 'Thông tin chung' },
      { key: 'managerName', label: 'Trưởng bộ phận', type: T.STRING, group: 'Thông tin chung' },
      { key: 'assetCount', label: 'Số tài sản', type: T.NUMBER, group: 'Số liệu' },
      { key: 'originalValue', label: 'Nguyên giá', type: T.MONEY, group: 'Số liệu' },
      { key: 'totalValue', label: 'Giá trị còn lại', type: T.MONEY, group: 'Số liệu' },
    ],
  };

  ds.v_maintenance_history = {
    key: 'v_maintenance_history',
    label: 'Lịch sử bảo trì (đầy đủ)',
    group: 'Tổng hợp',
    entity: 'maintenances',
    fields: (ENTITIES.maintenances ? [
      { key: 'code', label: 'Số phiếu', type: T.STRING, group: 'Thông tin chung' },
      { key: 'assetCode', label: 'Mã tài sản', type: T.STRING, group: 'Thông tin chung' },
      { key: 'assetName', label: 'Tên tài sản', type: T.STRING, group: 'Thông tin chung' },
      { key: 'categoryName', label: 'Danh mục', type: T.STRING, group: 'Thông tin chung' },
      { key: 'departmentName', label: 'Phòng ban', type: T.STRING, group: 'Thông tin chung' },
      { key: 'vendorName', label: 'Đơn vị thực hiện', type: T.STRING, group: 'Thông tin chung' },
      { key: 'type', label: 'Loại bảo trì', type: T.SELECT, group: 'Thông tin chung' },
      { key: 'actualDate', label: 'Ngày thực hiện', type: T.DATE, group: 'Thời gian' },
      { key: 'cost', label: 'Chi phí', type: T.MONEY, group: 'Số liệu' },
      { key: 'partsCost', label: 'Chi phí vật tư', type: T.MONEY, group: 'Số liệu' },
      { key: 'totalCost', label: 'Tổng chi phí', type: T.MONEY, group: 'Số liệu' },
      { key: 'status', label: 'Trạng thái', type: T.SELECT, group: 'Thông tin chung' },
    ] : []),
  };

  ds.v_stocktake_result = {
    key: 'v_stocktake_result',
    label: 'Kết quả kiểm kê',
    group: 'Tổng hợp',
    entity: 'stocktake_items',
    fields: [
      { key: 'stocktakeCode', label: 'Đợt kiểm kê', type: T.STRING, group: 'Thông tin chung' },
      { key: 'assetCode', label: 'Mã tài sản', type: T.STRING, group: 'Thông tin chung' },
      { key: 'assetName', label: 'Tên tài sản', type: T.STRING, group: 'Thông tin chung' },
      { key: 'expectedLocationName', label: 'Vị trí sổ sách', type: T.STRING, group: 'Thông tin chung' },
      { key: 'locationName', label: 'Vị trí thực tế', type: T.STRING, group: 'Thông tin chung' },
      { key: 'assigneeName', label: 'Người sử dụng', type: T.STRING, group: 'Thông tin chung' },
      { key: 'result', label: 'Kết quả', type: T.SELECT, group: 'Thông tin chung' },
      { key: 'conditionFound', label: 'Tình trạng', type: T.SELECT, group: 'Thông tin chung' },
      { key: 'countedByName', label: 'Người kiểm kê', type: T.STRING, group: 'Thông tin chung' },
    ],
  };

  ds.v_user_assets = {
    key: 'v_user_assets',
    label: 'Tài sản theo nhân viên',
    group: 'Tổng hợp',
    entity: 'users',
    fields: [
      { key: 'employeeCode', label: 'Mã nhân viên', type: T.STRING, group: 'Thông tin chung' },
      { key: 'fullName', label: 'Họ tên', type: T.STRING, group: 'Thông tin chung' },
      { key: 'departmentName', label: 'Phòng ban', type: T.STRING, group: 'Thông tin chung' },
      { key: 'position', label: 'Chức vụ', type: T.STRING, group: 'Thông tin chung' },
      { key: 'assetCount', label: 'Số tài sản đang giữ', type: T.NUMBER, group: 'Số liệu' },
      { key: 'assetValue', label: 'Tổng giá trị còn lại', type: T.MONEY, group: 'Số liệu' },
    ],
  };

  ds.v_asset_ledger = {
    key: 'v_asset_ledger',
    label: 'Sổ tài sản theo kỳ',
    group: 'Kế toán',
    entity: 'depreciations',
    fields: [
      { key: 'period', label: 'Kỳ', type: T.STRING, group: 'Thông tin chung' },
      { key: 'assetCode', label: 'Mã tài sản', type: T.STRING, group: 'Thông tin chung' },
      { key: 'assetName', label: 'Tên tài sản', type: T.STRING, group: 'Thông tin chung' },
      { key: 'openingValue', label: 'Giá trị đầu kỳ', type: T.MONEY, group: 'Số liệu' },
      { key: 'depreciationAmount', label: 'Khấu hao trong kỳ', type: T.MONEY, group: 'Số liệu' },
      { key: 'accumulated', label: 'Hao mòn luỹ kế', type: T.MONEY, group: 'Số liệu' },
      { key: 'closingValue', label: 'Giá trị còn lại', type: T.MONEY, group: 'Số liệu' },
      { key: 'expenseAccount', label: 'TK chi phí', type: T.STRING, group: 'Kế toán' },
      { key: 'assetAccount', label: 'TK tài sản', type: T.STRING, group: 'Kế toán' },
    ],
  };

  return ds;
}

/** Lấy dữ liệu của 1 dataset (đã join, đã lọc theo tham số) */
function datasetRows(datasetKey, params) {
  const p = params || {};
  const def = reportDatasets()[datasetKey];
  if (!def) throw new Error('Dataset không tồn tại: ' + datasetKey);
  let rows = listEntity(def.entity, {
    page: 1,
    limit: 100000,
    q: p.q || '',
    sort: p.sort || '',
    order: p.order || 'asc',
    filters: p.filters || {},
    range: p.range || {},
    includeDeleted: !!p.includeDeleted,
  }).data;
  if (p.limit && Number(p.limit) > 0) rows = rows.slice(0, Number(p.limit));
  return rows;
}

/* =========================== THÔNG BÁO & NHẬT KÝ =========================== */

function notifyUsers(rec) {
  const doc = Object.assign(
    {
      title: '',
      message: '',
      type: 'system',
      level: 'info',
      createdAt: new Date().toISOString(),
      readAt: null,
    },
    rec
  );
  return store.insert('notifications', doc);
}

/** Sinh thông báo cảnh báo tự động (bảo trì, bảo hành, duyệt phiếu) */
function refreshAlerts() {
  const cfg = settings();
  const created = [];
  const now = new Date();
  const existingKeys = new Set(store.all('notifications').slice(-400).map((n) => n.dedupeKey).filter(Boolean));

  store.filter('assets', (a) => !a.isDeleted).forEach((a) => {
    const dec = decorateAsset(a);
    if (dec.nextMaintenanceAt && util.diffDays(dec.nextMaintenanceAt, now) <= cfg.notifications.maintenanceDaysBefore) {
      const key = 'maint:' + a.id + ':' + dec.nextMaintenanceAt;
      if (!existingKeys.has(key)) {
        created.push(
          notifyUsers({
            title: 'Tài sản đến hạn bảo trì',
            message: `${dec.name} (${dec.code}) — hạn bảo trì ${dec.nextMaintenanceAt}`,
            type: 'maintenance_due',
            level: 'warning',
            link: '#/assets/' + a.id,
            dedupeKey: key,
          })
        );
      }
    }
    if (dec.warrantyEnd && util.diffDays(dec.warrantyEnd, now) >= 0 && util.diffDays(dec.warrantyEnd, now) <= cfg.notifications.warrantyDaysBefore) {
      const key = 'warr:' + a.id + ':' + dec.warrantyEnd;
      if (!existingKeys.has(key)) {
        created.push(
          notifyUsers({
            title: 'Sắp hết hạn bảo hành',
            message: `${dec.name} (${dec.code}) — hết bảo hành ${dec.warrantyEnd} (còn ${dec.warrantyRemainingDays} ngày)`,
            type: 'warranty_expiring',
            level: 'info',
            link: '#/assets/' + a.id,
            dedupeKey: key,
          })
        );
      }
    }
  });
  return created;
}

/* --------------------------- Ghi nhật ký --------------------------- */

function audit(action, entity, opts) {
  const o = opts || {};
  return store.insert('audit_logs', {
    username: o.username || 'system',
    userId: o.userId || null,
    action,
    entity: entity || '',
    entityId: o.entityId !== undefined ? String(o.entityId) : '',
    entityLabel: o.entityLabel || '',
    changes: o.changes || null,
    ip: o.ip || '',
    userAgent: o.userAgent || '',
    path: o.path || '',
    method: o.method || '',
    status: o.status || 200,
    durationMs: o.durationMs || 0,
    createdAt: new Date().toISOString(),
  });
}

module.exports = {
  settings,
  saveSettings,
  generateCode,
  computeDepreciation,
  monthsElapsed,
  decorate,
  decorateAsset,
  decorateRecord,
  listEntity,
  dashboardSummary,
  reportDatasets,
  datasetRows,
  nameOf,
  notifyUsers,
  refreshAlerts,
  audit,
};
