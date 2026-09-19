'use strict';
/**
 * util.js — Tiện ích dùng chung cho backend
 */

const crypto = require('crypto');

function uuid() {
  return crypto.randomUUID();
}

function nowISO() {
  return new Date().toISOString();
}

function todayStr(d) {
  const dt = d ? new Date(d) : new Date();
  return dt.toISOString().slice(0, 10);
}

/** Chuẩn hoá tiếng Việt để tìm kiếm không dấu */
function normalizeVN(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

function slug(str) {
  return normalizeVN(str).replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Định dạng số/tiền tệ VN */
function formatNumber(value, decimals) {
  const n = Number(value || 0);
  const d = decimals === undefined ? 0 : decimals;
  return n.toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function pad(num, size) {
  let s = String(num);
  while (s.length < size) s = '0' + s;
  return s;
}

/**
 * Sinh mã theo pattern, hỗ trợ token:
 * {PREFIX} {YYYY} {YY} {MM} {DD} {SEQ:n} {DEPT} {CAT}
 */
function buildCode(pattern, ctx) {
  const d = new Date();
  const map = {
    PREFIX: ctx.prefix || 'TS',
    YYYY: String(d.getFullYear()),
    YY: String(d.getFullYear()).slice(-2),
    MM: pad(d.getMonth() + 1, 2),
    DD: pad(d.getDate(), 2),
    DEPT: ctx.dept || 'CTY',
    CAT: ctx.cat || 'GEN',
  };
  return String(pattern || '{PREFIX}-{YYYY}-{SEQ:4}').replace(/\{(\w+)(?::(\d+))?\}/g, (m, key, size) => {
    if (key === 'SEQ') return pad(ctx.seq || 1, Number(size || 3));
    return map[key] !== undefined ? map[key] : m;
  });
}

/** Escape HTML khi render phía server (dùng cho export/in) */
function escapeHtml(str) {
  return String(str === null || str === undefined ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** So sánh ngày (chuỗi ISO hoặc yyyy-mm-dd) */
function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + Number(months));
  if (d.getDate() < day) d.setDate(0);
  return d;
}

function diffDays(a, b) {
  return Math.round((new Date(a) - new Date(b)) / 86400000);
}

function monthsBetween(a, b) {
  const d1 = new Date(a);
  const d2 = new Date(b);
  return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
}

/** Parse query string điều kiện lọc dạng filter[field]=value, toggles */
function parseListQuery(searchParams) {
  const q = {
    page: parseInt(searchParams.get('page') || '1', 10),
    limit: Math.min(parseInt(searchParams.get('limit') || '25', 10) || 25, 500),
    q: (searchParams.get('q') || '').trim(),
    sort: searchParams.get('sort') || '',
    order: (searchParams.get('order') || 'desc').toLowerCase(),
    filters: {},
    range: {},
    includeDeleted: searchParams.get('includeDeleted') === '1',
  };
  for (const [key, value] of searchParams.entries()) {
    let m = /^filter\[(.+)\]$/.exec(key);
    if (m) {
      q.filters[m[1]] = value;
      continue;
    }
    m = /^from\[(.+)\]$/.exec(key);
    if (m) {
      q.range[m[1]] = q.range[m[1]] || {};
      q.range[m[1]].from = value;
      continue;
    }
    m = /^to\[(.+)\]$/.exec(key);
    if (m) {
      q.range[m[1]] = q.range[m[1]] || {};
      q.range[m[1]].to = value;
    }
  }
  return q;
}

/** Nhân bản object sâu */
function clone(obj) {
  return JSON.parse(JSON.stringify(obj ?? null));
}

module.exports = {
  uuid,
  nowISO,
  todayStr,
  normalizeVN,
  slug,
  formatNumber,
  pad,
  buildCode,
  escapeHtml,
  addMonths,
  diffDays,
  monthsBetween,
  parseListQuery,
  clone,
};
