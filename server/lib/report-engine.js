'use strict';
/**
 * report-engine.js — Bộ máy báo cáo (Crystal-Reports-like)
 * ---------------------------------------------------------
 * - Mẫu báo cáo là JSON "layout" gồm các band: title, pageHeader, columnHeader,
 *   groupHeader, detail, groupFooter, pageFooter, summary.
 * - Mỗi phần tử (element) có toạ độ mm, căn lề, định dạng, công thức tổng hợp.
 * - Kết xuất: HTML (in/PDF), CSV, XLSX, DOCX.
 */

const util = require('./util');
const qr = require('./qr');
const zip = require('./zip');

const MM_TO_PX = 3.7795275591;
const MM_TO_PT = 2.8346456693;
const MM_TO_TWIP = 56.69291339;

/* ==================================================================== */
/* THIẾT KẾ MẶC ĐỊNH                                                    */
/* ==================================================================== */

const PAPER_SIZES = {
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  A3: { width: 297, height: 420 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
  Receipt: { width: 80, height: 200 },
  Custom: { width: 210, height: 297 },
};

const BANDS = [
  { key: 'reportTitle', label: 'Tiêu đề báo cáo', repeat: false, height: 26, optional: true },
  { key: 'pageHeader', label: 'Đầu trang (lặp mỗi trang)', repeat: true, height: 14 },
  { key: 'columnHeader', label: 'Tiêu đề cột', repeat: true, height: 9 },
  { key: 'groupHeader', label: 'Đầu nhóm', repeat: false, height: 8, optional: true },
  { key: 'detail', label: 'Chi tiết', repeat: false, height: 7, optional: true },
  { key: 'groupFooter', label: 'Tổng nhóm', repeat: false, height: 8, optional: true },
  { key: 'pageFooter', label: 'Chân trang (lặp mỗi trang)', repeat: true, height: 12 },
  { key: 'reportFooter', label: 'Tổng kết cuối báo cáo', repeat: false, height: 20, optional: true },
];

const ELEMENT_TYPES = [
  { value: 'field', label: 'Trường dữ liệu' },
  { value: 'text', label: 'Văn bản tĩnh' },
  { value: 'expr', label: 'Công thức / Tổng hợp' },
  { value: 'line', label: 'Đường kẻ' },
  { value: 'rect', label: 'Hình chữ nhật' },
  { value: 'image', label: 'Hình ảnh / Logo' },
  { value: 'pageNumber', label: 'Số trang' },
  { value: 'pageInfo', label: 'Trang X / Y' },
  { value: 'dateTime', label: 'Ngày giờ in' },
  { value: 'systemInfo', label: 'Thông tin hệ thống' },
  { value: 'richText', label: 'Khối văn bản dài' },
  { value: 'barcode', label: 'Mã vạch (Code128)' },
  { value: 'qrcode', label: 'Mã QR' },
];

function el(id, type, over) {
  return Object.assign(
    {
      id,
      type,
      x: 10,
      y: 2,
      w: 60,
      h: 6,
      text: '',
      field: '',
      expr: '',
      prefix: '',
      suffix: '',
      align: 'left',
      valign: 'middle',
      fontSize: 10,
      fontFamily: 'Inter, Arial, sans-serif',
      bold: false,
      italic: false,
      underline: false,
      color: '#111827',
      bgColor: '',
      border: false,
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: '#9ca3af',
      format: 'text',
      decimals: 0,
      wrap: true,
      uppercase: false,
      letterSpacing: 0,
      opacity: 1,
      suppressIfEmpty: false,
      sqlExpr: '',
      label: '',
    },
    over || {}
  );
}

/** Thiết kế trống (khung sườn mặc định) */
function blankDesign(opts) {
  const o = opts || {};
  const paper = o.paperSize || 'A4';
  const orientation = o.orientation || 'portrait';
  const size = PAPER_SIZES[paper] || PAPER_SIZES.A4;
  const contentWidth = (orientation === 'landscape' ? size.height : size.width) - 24;
  const fields = o.fields || [];
  const pick = (i) => (fields[i] ? fields[i].key : '');
  return {
    paperSize: paper,
    orientation,
    margins: { top: 12, right: 12, bottom: 12, left: 12 },
    bands: {
      reportTitle: {
        height: 24,
        elements: [
          el('t1', 'text', { x: 0, y: 0, w: contentWidth, h: 7, text: '{company.name}', fontSize: 11, bold: true, align: 'center', uppercase: true, color: '#1e3a8a' }),
          el('t2', 'text', { x: 0, y: 6.5, w: contentWidth, h: 5, text: 'Địa chỉ: {company.address} — ĐT: {company.phone}', fontSize: 8.5, align: 'center', color: '#4b5563' }),
          el('t3', 'text', { x: 0, y: 13, w: contentWidth, h: 8, text: o.title || 'BÁO CÁO DANH SÁCH TÀI SẢN', fontSize: 16, bold: true, align: 'center', uppercase: true, color: '#0f172a' }),
          el('t4', 'dateTime', { x: 0, y: 20.5, w: contentWidth, h: 4.5, text: 'Ngày in: {date} {time}', fontSize: 8.5, align: 'center', italic: true, color: '#6b7280' }),
        ],
      },
      pageHeader: {
        height: 12,
        elements: [
          el('p1', 'text', { x: 0, y: 0, w: contentWidth, h: 5, text: o.subTitle || 'Kỳ báo cáo: {params.fromDate} - {params.toDate}', fontSize: 9, align: 'left', color: '#374151' }),
        ],
      },
      columnHeader: {
        height: 8,
        elements: [
          el('c1', 'text', { x: 0, y: 0, w: 14, h: 8, text: 'STT', align: 'center', bold: true, fontSize: 9, bgColor: '#f1f5f9', border: true, format: 'text' }),
          el('c2', 'field', { x: 14, y: 0, w: 40, h: 8, field: pick(0) || 'code', label: 'Mã', align: 'center', bold: true, fontSize: 9, bgColor: '#f1f5f9', border: true }),
          el('c3', 'field', { x: 54, y: 0, w: 78, h: 8, field: pick(1) || 'name', label: 'Tên tài sản', align: 'left', bold: true, fontSize: 9, bgColor: '#f1f5f9', border: true }),
          el('c4', 'field', { x: 132, y: 0, w: 34, h: 8, field: pick(2) || 'categoryName', label: 'Danh mục', align: 'left', bold: true, fontSize: 9, bgColor: '#f1f5f9', border: true }),
          el('c5', 'field', { x: contentWidth - 34, y: 0, w: 34, h: 8, field: pick(3) || 'originalCost', label: 'Nguyên giá', align: 'right', bold: true, fontSize: 9, bgColor: '#f1f5f9', border: true, format: 'money' }),
        ],
      },
      detail: {
        height: 7,
        elements: [
          el('d1', 'expr', { x: 0, y: 0, w: 14, h: 7, expr: 'ROW()', align: 'center', fontSize: 9, border: true, format: 'number' }),
          el('d2', 'field', { x: 14, y: 0, w: 40, h: 7, field: pick(0) || 'code', align: 'center', fontSize: 9, border: true }),
          el('d3', 'field', { x: 54, y: 0, w: 78, h: 7, field: pick(1) || 'name', align: 'left', fontSize: 9, border: true }),
          el('d4', 'field', { x: 132, y: 0, w: 34, h: 7, field: pick(2) || 'categoryName', align: 'left', fontSize: 9, border: true }),
          el('d5', 'field', { x: contentWidth - 34, y: 0, w: 34, h: 7, field: pick(3) || 'originalCost', align: 'right', fontSize: 9, border: true, format: 'money' }),
        ],
      },
      groupHeader: {
        height: 8,
        elements: [el('g1', 'field', { x: 0, y: 0, w: contentWidth, h: 8, field: 'groupLabel', text: 'Nhóm: {groupValue}', bold: true, fontSize: 10, bgColor: '#e2e8f0', align: 'left', border: true })],
      },
      groupFooter: {
        height: 8,
        elements: [
          el('gf1', 'expr', { x: 0, y: 0, w: contentWidth, h: 8, expr: 'TỔNG NHÓM: {COUNT()}', align: 'left', bold: true, fontSize: 9, bgColor: '#f8fafc', border: true }),
        ],
      },
      pageFooter: {
        height: 12,
        elements: [
          el('f1', 'line', { x: 0, y: 0, w: contentWidth, h: 0.3, borderColor: '#94a3b8' }),
          el('f2', 'text', { x: 0, y: 1.5, w: contentWidth / 2, h: 4.5, text: '{company.name}', fontSize: 8, color: '#6b7280' }),
          el('f3', 'pageInfo', { x: contentWidth / 2, y: 1.5, w: contentWidth / 2, h: 4.5, text: 'Trang {page} / {pages}', fontSize: 8, align: 'right', color: '#6b7280' }),
          el('f4', 'systemInfo', { x: 0, y: 6, w: contentWidth, h: 4, text: '{footer}', fontSize: 7.5, align: 'center', color: '#9ca3af', italic: true }),
        ],
      },
      reportFooter: {
        height: 22,
        elements: [
          el('r1', 'expr', { x: 0, y: 0, w: contentWidth, h: 8, expr: 'TỔNG CỘNG: {COUNT()} tài sản', bold: true, fontSize: 11, align: 'left', border: true, bgColor: '#eff6ff' }),
          el('r2', 'text', { x: 0, y: 10, w: contentWidth / 3, h: 10, text: 'Người lập biểu\n(Ký, họ tên)', align: 'center', fontSize: 9, wrap: true }),
          el('r3', 'text', { x: contentWidth / 3, y: 10, w: contentWidth / 3, h: 10, text: 'Kế toán trưởng\n(Ký, họ tên)', align: 'center', fontSize: 9, wrap: true }),
          el('r4', 'text', { x: (contentWidth * 2) / 3, y: 10, w: contentWidth / 3, h: 10, text: 'Giám đốc\n(Ký, họ tên, đóng dấu)', align: 'center', fontSize: 9, wrap: true }),
        ],
      },
    },
    groups: o.groups || [],
    sorting: o.sorting || [],
    filters: o.filters || [],
    parameters: o.parameters || defaultParameters(),
    options: {
      showGridInDesigner: true,
      repeatColumnHeader: true,
      showZeroValues: true,
      includeDeleted: false,
      footerNote: '',
      pageBreaksBetweenGroups: false,
    },
  };
}

function defaultParameters() {
  return [
    { name: 'fromDate', label: 'Từ ngày', type: 'date', default: '', required: false, applyTo: 'purchaseDate', op: '>=', scope: 'auto' },
    { name: 'toDate', label: 'Đến ngày', type: 'date', default: '', required: false, applyTo: 'purchaseDate', op: '<=', scope: 'auto' },
    { name: 'departmentId', label: 'Phòng ban', type: 'ref', ref: 'departments', default: '', required: false, applyTo: 'departmentId', op: '=', scope: 'auto' },
  ];
}

/* ==================================================================== */
/* BIỂU THỨC & TỔNG HỢP                                                 */
/* ==================================================================== */

function formatValue(value, format, decimals, settings) {
  const cfg = settings || {};
  const d = decimals === undefined || decimals === null ? (format === 'money' ? (cfg.digits === undefined ? 0 : cfg.digits) : 2) : decimals;
  if (value === null || value === undefined || value === '') return '';
  switch (format) {
    case 'money':
    case 'number': {
      const n = Number(value);
      if (isNaN(n)) return String(value);
      const sign = n < 0 ? '-' : '';
      const abs = Math.abs(n).toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });
      return format === 'money' ? sign + abs + (cfg.currencySymbol || '') : sign + abs;
    }
    case 'percent':
      return Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + '%';
    case 'date': {
      const dt = new Date(value);
      if (isNaN(dt)) return String(value);
      const dd = util.pad(dt.getDate(), 2);
      const mm = util.pad(dt.getMonth() + 1, 2);
      return `${dd}/${mm}/${dt.getFullYear()}`;
    }
    case 'datetime': {
      const dt = new Date(value);
      if (isNaN(dt)) return String(value);
      return `${util.pad(dt.getDate(), 2)}/${util.pad(dt.getMonth() + 1, 2)}/${dt.getFullYear()} ${util.pad(dt.getHours(), 2)}:${util.pad(dt.getMinutes(), 2)}`;
    }
    case 'bool':
      return value === true || value === 'true' || value === 1 ? 'Có' : 'Không';
    default:
      return String(value);
  }
}

function getByPath(row, path) {
  if (!path) return '';
  if (row[path] !== undefined) return row[path];
  return path.split('.').reduce((acc, k) => (acc === undefined || acc === null ? undefined : acc[k]), row);
}

/** Thay thế token dạng {field}, {company.name}, {params.x}, {date}, {time}, {page}, {pages} */
function interpolate(template, ctx) {
  return String(template || '').replace(/\{([^}]+)\}/g, (m, token) => {
    const t = token.trim();
    if (t === 'date') return formatValue(ctx.generatedAt, 'date');
    if (t === 'time') return new Date(ctx.generatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    if (t === 'footer') return (ctx.settings && ctx.settings.system && ctx.settings.system.footerText) || '';
    if (t === 'rowIndex' || t === 'ROWNUM') return ctx.rowIndex !== undefined ? ctx.rowIndex + 1 : '';
    if (t.startsWith('params.')) return formatValue(getByPath(ctx.params || {}, t.slice(7)), guessFormatFromValue(getByPath(ctx.params || {}, t.slice(7))));
    if (t.startsWith('company.')) return getByPath(ctx.company || {}, t.slice(8)) || '';
    if (t.startsWith('user.')) return getByPath(ctx.user || {}, t.slice(5)) || '';
    if (t.startsWith('groupValue')) return ctx.groupValue !== undefined ? String(ctx.groupValue) : '';
    if (t.startsWith('groupLabel')) return ctx.groupLabel || '';
    const v = ctx.row ? getByPath(ctx.row, t) : undefined;
    if (v !== undefined && v !== null) return String(v);
    return String(getByPath(ctx, t) || '');
  });
}

function guessFormatFromValue(v) {
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return 'date';
  return 'text';
}

/** Các hàm tổng hợp hỗ trợ trong công thức */
const AGGREGATES = {
  SUM: (rows, field) => rows.reduce((s, r) => s + Number(getByPath(r, field) || 0), 0),
  COUNT: (rows) => rows.length,
  AVG: (rows, field) => (rows.length ? rows.reduce((s, r) => s + Number(getByPath(r, field) || 0), 0) / rows.length : 0),
  MIN: (rows, field) => (rows.length ? Math.min(...rows.map((r) => Number(getByPath(r, field) || 0))) : 0),
  MAX: (rows, field) => (rows.length ? Math.max(...rows.map((r) => Number(getByPath(r, field) || 0))) : 0),
  COUNT_DISTINCT: (rows, field) => new Set(rows.map((r) => String(getByPath(r, field) || ''))).size,
  FIRST: (rows, field) => (rows.length ? getByPath(rows[0], field) : ''),
  LAST: (rows, field) => (rows.length ? getByPath(rows[rows.length - 1], field) : ''),
  CONCAT: (rows, field, sep) => rows.map((r) => getByPath(r, field)).filter(Boolean).join(sep === undefined ? ', ' : sep),
};

/**
 * Tính biểu thức tổng hợp dạng: "TỔNG: {SUM(originalCost)} VNĐ"
 * ctx: { rows, row, groupValue, page, pages, params, company, settings, generatedAt, rowIndex, dataset }
 */
function evalExpression(expr, ctx) {
  const out = String(expr || '').replace(/\{([A-Z_]+)\(([^}]*)\)\}/g, (m, fn, args) => {
    const name = fn.toUpperCase();
    if (name === 'ROW') return String((ctx.rowIndex || 0) + 1);
    if (name === 'PAGE') return String(ctx.page || 1);
    if (name === 'PAGES') return String(ctx.pages || 1);
    const aggregate = AGGREGATES[name];
    if (!aggregate) return '';
    const parts = String(args || '').split(',').map((s) => s.trim()).filter((s) => s !== '');
    const field = parts[0] || '';
    const scope = parts[1] || (ctx.scope || 'report');
    let rows = ctx.rows || [];
    if (scope === 'group') rows = ctx.groupRows || ctx.rows || [];
    if (scope === 'page') rows = ctx.pageRows || ctx.rows || [];
    const value = name === 'COUNT_DISTINCT' ? aggregate(rows, field) : name === 'COUNT' ? aggregate(rows) : aggregate(rows, field);
    const isNumeric = typeof value === 'number';
    if (!isNumeric) return formatValue(value, 'text', 0, ctx.settings);
    const fmt = parts[2] || 'number';
    const decimals = parts[3] !== undefined ? Number(parts[3]) : 0;
    return formatValue(value, fmt, decimals, ctx.settings);
  });
  return interpolate(out, ctx);
}

/* ==================================================================== */
/* XỬ LÝ NHÓM / SẮP XẾP / LỌC THEO THAM SỐ                              */
/* ==================================================================== */

function applyRowParams(rows, design, params) {
  let out = rows.slice();
  const p = params || {};
  const designParams = (design && design.parameters) || [];
  designParams.forEach((def) => {
    const value = p[def.name];
    const empty = value === undefined || value === null || value === '';
    if (empty) return;
    if (def.applyTo && def.op) {
      const field = def.applyTo;
      // Nếu không dòng nào có trường này (nguồn dữ liệu không hỗ trợ tham số),
      // bỏ qua tham số thay vì lọc sạch toàn bộ dữ liệu.
      const fieldExists = out.some((r) => getByPath(r, field) !== undefined);
      if (!fieldExists) return;
      out = out.filter((r) => {
        const rv = getByPath(r, field);
        switch (def.op) {
          case '>=':
            return rv !== undefined && rv !== null && rv !== '' && (field.endsWith('Date') || field.endsWith('At') || def.type === 'date' ? new Date(rv) >= new Date(value) : Number(rv) >= Number(value));
          case '<=':
            return rv !== undefined && rv !== null && rv !== '' && (field.endsWith('Date') || field.endsWith('At') || def.type === 'date' ? new Date(rv) <= new Date(value + (String(value).length === 10 ? 'T23:59:59' : '')) : Number(rv) <= Number(value));
          case '=':
            return String(rv) === String(value);
          case '!=':
            return String(rv) !== String(value);
          case 'in': {
            const list = String(value).split(',').map((s) => s.trim());
            return list.includes(String(rv));
          }
          case 'like':
            return util.normalizeVN(rv).includes(util.normalizeVN(value));
          default:
            return true;
        }
      });
    }
  });

  const sorting = (design && design.sorting) || [];
  if (sorting.length) {
    out.sort((a, b) => {
      for (const s of sorting) {
        const av = getByPath(a, s.field);
        const bv = getByPath(b, s.field);
        if (av === bv) continue;
        const cmp = String(av === undefined || av === null ? '' : av).localeCompare(String(bv === undefined || bv === null ? '' : bv), 'vi', { numeric: true });
        if (cmp !== 0) return s.order === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  }
  return out;
}

/** Nhóm dữ liệu theo design.groups (hỗ trợ đa cấp) */
function buildGroups(rows, design) {
  const groups = (design && design.groups) || [];
  if (!groups.length) return [{ field: null, value: '', label: '', rows }];
  const result = [];
  const groupBy = (list, level, parentLabel) => {
    const g = groups[level];
    if (!g) {
      return;
    }
    const map = new Map();
    list.forEach((r) => {
      const raw = getByPath(r, g.field);
      const key = raw === undefined || raw === null || raw === '' ? '(Không xác định)' : String(raw);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });
    for (const [key, items] of map.entries()) {
      const label = parentLabel ? parentLabel + ' / ' + key : key;
      result.push({ field: g.field, label: g.label, value: key, fullLabel: label, rows: items, level });
      if (groups[level + 1]) groupBy(items, level + 1, label);
    }
  };
  groupBy(rows, 0, '');
  return result;
}

/* ==================================================================== */
/* RENDER HTML (IN / XUẤT PDF)                                          */
/* ==================================================================== */

function paperDims(design) {
  const size = PAPER_SIZES[design.paperSize] || PAPER_SIZES.A4;
  const landscape = design.orientation === 'landscape';
  const w = landscape ? Math.max(size.width, size.height) : Math.min(size.width, size.height);
  const h = landscape ? Math.max(size.width, size.height) : Math.min(size.width, size.height);
  return { width: w, height: h };
}

function bandHeight(design, key) {
  const band = design.bands && design.bands[key];
  if (!band) return 0;
  const maxEl = (band.elements || []).reduce((m, e) => Math.max(m, Number(e.y || 0) + Number(e.h || 0)), 0);
  return Math.max(Number(band.height || 0), maxEl);
}

function elementHTML(e, ctx) {
  const style = [];
  const left = Number(e.x || 0) * MM_TO_PX;
  const top = Number(e.y || 0) * MM_TO_PX;
  const width = Number(e.w || 0) * MM_TO_PX;
  const height = Number(e.h || 0) * MM_TO_PX;
  style.push(`left:${left.toFixed(2)}px`, `top:${top.toFixed(2)}px`, `width:${width.toFixed(2)}px`, `height:${height.toFixed(2)}px`);
  style.push(`font-size:${Number(e.fontSize || 10)}pt`);
  style.push('font-family:' + (e.fontFamily || 'Inter, Arial, sans-serif'));
  style.push('text-align:' + (e.align || 'left'));
  const valign = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[e.valign || 'middle'];
  style.push('justify-content:' + valign);
  if (e.bold) style.push('font-weight:700');
  if (e.italic) style.push('font-style:italic');
  if (e.underline) style.push('text-decoration:underline');
  if (e.color) style.push('color:' + e.color);
  if (e.bgColor) style.push('background:' + e.bgColor);
  if (e.letterSpacing) style.push('letter-spacing:' + e.letterSpacing + 'px');
  if (e.opacity !== undefined && Number(e.opacity) < 1) style.push('opacity:' + e.opacity);
  if (e.wrap === false) style.push('white-space:nowrap;overflow:hidden');
  if (e.padding) style.push('padding:' + Number(e.padding) * MM_TO_PX + 'px');
  style.push('line-height:1.25');
  style.push('box-sizing:border-box');
  if (e.border) {
    const bw = Number(e.borderWidth || 1);
    style.push(`border:${bw}px ${e.borderStyle || 'solid'} ${e.borderColor || '#9ca3af'}`);
  }
  if (e.type === 'line') {
    style.push('height:0', `border-top:${Number(e.borderWidth || 1)}px ${e.borderStyle || 'solid'} ${e.borderColor || '#111827'}`);
  }

  let content = '';
  switch (e.type) {
    case 'field': {
      const raw = e.field ? getByPath(ctx.row || {}, e.field) : '';
      if (e.suppressIfEmpty && (raw === undefined || raw === null || raw === '' || raw === 0)) return '';
      content = formatValue(raw, e.format || guessFormatFromValue(raw), e.decimals, ctx.settings);
      if (raw === '' || raw === undefined || raw === null) {
        // Ở band header, hiển thị nhãn cột
        if (ctx.isHeaderBand) content = e.label || e.text || '';
      }
      break;
    }
    case 'expr':
      content = evalExpression(e.expr || e.text, ctx);
      break;
    case 'text':
      content = interpolate(e.text || '', ctx);
      break;
    case 'pageNumber':
      content = String(ctx.page || 1);
      break;
    case 'pageInfo':
      content = `Trang ${ctx.page || 1} / ${ctx.pages || 1}`;
      break;
    case 'dateTime': {
      const d = new Date(ctx.generatedAt || Date.now());
      content = `${util.pad(d.getDate(), 2)}/${util.pad(d.getMonth() + 1, 2)}/${d.getFullYear()} ${util.pad(d.getHours(), 2)}:${util.pad(d.getMinutes(), 2)}`;
      break;
    }
    case 'systemInfo':
      content = interpolate(e.text || '{footer}', ctx);
      break;
    case 'richText':
      content = interpolate(e.text || '', ctx).replace(/\n/g, '<br/>');
      break;
    case 'barcode':
      content = code128SVG(String(interpolate(e.text || e.field ? (ctx.row ? getByPath(ctx.row, e.field) : '') : '', ctx) || ''), width, height);
      break;
    case 'qrcode':
      content = qrSVG(
        String(interpolate(e.text || '', ctx) || (ctx.row && e.field ? getByPath(ctx.row, e.field) : '')),
        Math.min(width, height),
        { ecc: e.ecc || 'Q', quiet: e.quiet }
      );
      break;
    case 'image': {
      const src = e.text || (e.field && ctx.row ? getByPath(ctx.row, e.field) : '') || (ctx.company && ctx.company.logo) || '';
      if (!src) return '';
      content = `<img src="${escapeAttr(src)}" style="max-width:100%;max-height:100%;object-fit:contain" alt=""/>`;
      break;
    }
    case 'rect':
      content = '';
      break;
    default:
      content = interpolate(e.text || '', ctx);
  }

  if (e.uppercase && typeof content === 'string') content = content.toUpperCase();
  if (e.type === 'line' || e.type === 'rect') {
    return `<div class="el" style="${style.join(';')}"></div>`;
  }
  const inner = e.wrap === false ? `<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${content}</span>` : content;
  return `<div class="el" style="${style.join(';')}"><div class="elbody">${inner}</div></div>`;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtml(s) {
  return util.escapeHtml(s);
}

/** Sinh mã vạch Code128 dạng SVG (đơn giản hoá, đủ để in ấn) */
function code128SVG(text, width, height) {
  if (!text) return '';
  const patterns = '212222,222122,222221,121223,121322,131222,122213,122312,132212,221213,221312,231212,112232,122132,122231,113222,123122,123221,223211,221132,221231,213212,223112,312131,311222,321122,321221,312212,322112,322211,212123,212321,232121,111323,131123,131321,112313,132113,132311,211313,231113,231311,112133,112331,132131,113123,113321,133121,313121,211331,231131,213113,213311,213131,311123,311321,331121,312113,312311,332111,314111,221411,431111,111224,111422,121124,121421,141122,141221,112214,112412,122114,122411,142112,142211,241211,221114,413111,241112,134111,111242,121142,121241,114212,124112,124211,411212,421112,421211,212141,214121,412121,111143,111341,131141,114113,114311,411113,411311,113141,114131,311141,411131,211412,211214,211232';
  const arr = patterns.split(',');
  const codes = [];
  let checksum = 104;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i) - 32;
    if (c < 0 || c > 94) continue;
    codes.push(c);
    checksum += c * (i + 1);
  }
  codes.push(checksum % 103);
  const bars = [];
  let x = 0;
  const start = arr[103];
  const all = [start, ...codes.map((c) => arr[c]), '2331112'];
  all.forEach((p) => {
    for (let i = 0; i < p.length; i++) {
      const w = Number(p[i]);
      const isBar = i % 2 === 0;
      if (isBar) bars.push(`<rect x="${x}" y="0" width="${w}" height="100"/>`);
      x += w;
    }
  });
  return `<svg viewBox="0 0 ${x} 100" preserveAspectRatio="none" style="width:100%;height:100%">${bars.join('')}</svg>`;
}

/**
 * QR code: dùng bộ sinh QR thật (ISO/IEC 18004) trong lib/qr.js — mã quét được
 * bằng điện thoại. Mức sửa lỗi mặc định Q để in nhãn nhỏ vẫn quét tốt.
 */
function qrSVG(text, size, opts) {
  const o = opts || {};
  const value = String(text == null ? '' : text);
  if (!value) return '';
  let data;
  try {
    data = qr.matrix(value, { ecc: o.ecc || 'Q' });
  } catch (err) {
    return '';
  }
  // Lề trắng quanh mã (quiet zone) tính bằng module — mỗi module vẫn đúng 1 đơn vị để in nét
  const quiet = o.quiet === undefined ? 2 : Math.max(0, Number(o.quiet) || 0);
  const n = data.size;
  const total = n + quiet * 2;
  const cells = [];
  for (let y = 0; y < n; y++) {
    let run = 0;
    for (let x = 0; x <= n; x++) {
      const dark = x < n && data.rows[y][x] === 1;
      if (dark) { run++; continue; }
      if (run) cells.push(`<rect x="${x - run + quiet}" y="${y + quiet}" width="${run}" height="1"/>`);
      run = 0;
    }
  }
  return `<svg viewBox="0 0 ${total} ${total}" style="width:100%;height:100%" shape-rendering="crispEdges" data-qr="${escapeAttr(value)}" data-qr-version="${data.version}" data-qr-ecc="${data.ecc}" data-qr-quiet="${quiet}" data-qr-size="${n}">`
    + `<rect width="${total}" height="${total}" fill="#fff"/>`
    + `<g fill="#000">${cells.join('')}</g>`
    + `</svg>`;
}

/**
 * Render toàn bộ báo cáo thành HTML nhiều trang (phân trang thật theo chiều cao detail)
 */
function renderHTML(template, rows, opts) {
  const o = opts || {};
  const design = template.design || blankDesign({});
  const ctx = o.context || {};
  const cfg = ctx.settings || {};
  const paper = paperDims(design);
  const margins = design.margins || { top: 12, right: 12, bottom: 12, left: 12 };
  const contentWidth = paper.width - margins.left - margins.right;
  const usableHeight = paper.height - margins.top - margins.bottom;

  const groups = buildGroups(rows, design);
  const groupField = design.groups && design.groups[0] ? design.groups[0].field : null;

  const hTitle = bandHeight(design, 'reportTitle');
  const hPageHeader = bandHeight(design, 'pageHeader');
  const hColHeader = bandHeight(design, 'columnHeader');
  const hDetail = Math.max(4, bandHeight(design, 'detail'));
  const hPageFooter = bandHeight(design, 'pageFooter');
  const hGroupHeader = groupField ? bandHeight(design, 'groupHeader') : 0;
  const hGroupFooter = groupField ? bandHeight(design, 'groupFooter') : 0;

  // Tính số trang: trang đầu có title; các trang sau chỉ pageHeader
  const pages = [];
  let current = { rows: [], groups: [], page: 1 };
  let y = usableHeight;
  let firstPage = true;
  const reservedHeader = () => (firstPage ? hTitle + hPageHeader + hColHeader : hPageHeader + hColHeader);

  const pushPage = () => {
    pages.push(current);
    current = { rows: [], groups: [], page: pages.length + 1 };
    y = usableHeight;
    firstPage = false;
  };

  if (!rows.length) {
    current.empty = true;
    y = 0;
  } else if (groupField) {
    groups.forEach((g) => {
      // Đủ chỗ cho đầu nhóm + ít nhất 1 dòng chi tiết?
      if (y - reservedHeader() - hGroupHeader - hDetail - hGroupFooter < 0) pushPage();
      current.groups.push({ header: g, rows: [], footer: null });
      const gIndex = current.groups.length - 1;
      y -= reservedHeader() === 0 ? 0 : 0;
      y = Math.max(0, y - hGroupHeader);
      g.rows.forEach((row) => {
        if (y - hDetail < hPageFooter) {
          pushPage();
          current.groups.push({ header: g, rows: [], footer: null, continued: true });
          y = Math.max(0, y - hGroupHeader);
          current.groups[current.groups.length - 1].rows.push(row);
          y -= hDetail;
        } else {
          const cur = current.groups[current.groups.length - 1] || current.groups[gIndex];
          cur.rows.push(row);
          y -= hDetail;
        }
      });
      if (y - hGroupFooter < hPageFooter) pushPage();
      const lastGroup = current.groups[current.groups.length - 1];
      if (lastGroup) lastGroup.footer = { index: g.rows.length ? 0 : 0, group: g };
      y -= hGroupFooter;
    });
  } else {
    rows.forEach((row) => {
      if (y - reservedHeader() - hDetail < 0 && current.rows.length === 0 && firstPage) {
        // Trang đầu tiên luôn có ít nhất 1 dòng
      } else if (y - hDetail < hPageFooter) {
        pushPage();
      }
      current.rows.push(row);
      y -= hDetail;
    });
  }
  if (!pages.length || (current.rows.length && pages[pages.length - 1] !== current)) pages.push(current);
  const totalPages = pages.length;

  const totalRows = rows.length;
  const renderBand = (key, bandCtx) => {
    const band = design.bands && design.bands[key];
    if (!band || !band.elements || !band.elements.length) return '';
    const height = bandHeight(design, key);
    const ctxFull = Object.assign({}, ctx, { params: o.params || {}, settings: cfg, generatedAt: ctx.generatedAt || new Date().toISOString() }, bandCtx);
    return `<div class="band band-${key}" style="height:${(height * MM_TO_PX).toFixed(2)}px;position:relative">${band.elements
      .filter((e) => e.visible !== false)
      .map((e) => elementHTML(e, ctxFull))
      .join('')}</div>`;
  };

  const pagesHTML = pages
    .map((page, pageIdx) => {
      const pageRows = [];
      page.rows.forEach((r) => pageRows.push(r));
      page.groups.forEach((g) => g.rows.forEach((r) => pageRows.push(r)));
      const bandCtxBase = {
        page: pageIdx + 1,
        pages: totalPages,
        rows: rows,
        pageRows,
        params: o.params || {},
      };
      let body = '';
      if (pageIdx === 0) body += renderBand('reportTitle', Object.assign({}, bandCtxBase, { isHeaderBand: false }));
      body += renderBand('pageHeader', Object.assign({}, bandCtxBase, { isHeaderBand: false }));
      body += renderBand('columnHeader', Object.assign({}, bandCtxBase, { isHeaderBand: true }));

      if (design.options && design.options.repeatColumnHeader !== false) {
        // đã render ở trên; với các trang sau cũng render lại nên không cần thêm
      }

      if (page.empty) {
        body += `<div class="band" style="height:${(20 * MM_TO_PX).toFixed(0)}px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-style:italic">Không có dữ liệu phù hợp với điều kiện báo cáo</div>`;
      }

      page.groups.forEach((g) => {
        const groupRows = g.header.rows;
        body += renderBand('groupHeader', Object.assign({}, bandCtxBase, { row: groupRows[0] || {}, groupValue: g.header.value, groupLabel: g.header.fullLabel, groupRows: groupRows, scope: 'group' }));
        g.rows.forEach((row, i) => {
          body += renderBand(
            'detail',
            Object.assign({}, bandCtxBase, {
              row,
              rowIndex: rows.indexOf(row),
              groupRows,
              groupValue: g.header.value,
              scope: 'report',
            })
          );
        });
        if (g.footer) {
          body += renderBand('groupFooter', Object.assign({}, bandCtxBase, { row: groupRows[0] || {}, groupRows: groupRows, groupValue: g.header.value, scope: 'group' }));
        }
      });

      page.rows.forEach((row, i) => {
        body += renderBand('detail', Object.assign({}, bandCtxBase, { row, rowIndex: rows.indexOf(row), scope: 'report' }));
      });

      if (pageIdx === totalPages - 1) {
        body += renderBand('reportFooter', Object.assign({}, bandCtxBase, { row: {}, scope: 'report', rows }));
      }
      body += renderBand('pageFooter', Object.assign({}, bandCtxBase, { scope: 'page' }));

      return `<div class="page" style="width:${paper.width}mm;height:${paper.height}mm;padding:${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm">
        <div class="page-body" style="width:${contentWidth}mm;height:${usableHeight}mm">${body}</div>
      </div>`;
    })
    .join('');

  const title = template.name || 'Báo cáo';
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; background:#e2e8f0; font-family:${(cfg.report && cfg.report.defaultFont) || 'Inter, Arial, sans-serif'}; color:#111827; }
  .toolbar { position:fixed; top:0; left:0; right:0; height:48px; background:#0f172a; color:#fff; display:flex; align-items:center; gap:8px; padding:0 16px; z-index:50; font-size:13px; }
  .toolbar button, .toolbar a { background:#1e293b; color:#fff; border:1px solid #334155; padding:7px 12px; border-radius:6px; cursor:pointer; font-size:13px; text-decoration:none; }
  .toolbar button:hover, .toolbar a:hover { background:#334155; }
  .toolbar .primary { background:#2563eb; border-color:#2563eb; }
  .toolbar .spacer { flex:1; }
  .pages { padding:64px 0 40px; }
  .page { background:#fff; margin:0 auto 16px; box-shadow:0 2px 12px rgba(15,23,42,.18); position:relative; overflow:hidden; }
  .page-body { position:relative; }
  .band { position:relative; }
  .el { position:absolute; display:flex; overflow:hidden; }
  .elbody { width:100%; }
  @media print {
    body { background:#fff; }
    .toolbar { display:none; }
    .pages { padding:0; }
    .page { box-shadow:none; margin:0; page-break-after:always; break-after:page; }
    .page:last-child { page-break-after:auto; break-after:auto; }
    @page { size: ${design.paperSize || 'A4'} ${design.orientation === 'landscape' ? 'landscape' : 'portrait'}; margin: 0; }
  }
</style>
</head>
<body>
<div class="toolbar">
  <strong>${escapeHtml(title)}</strong>
  <span style="color:#94a3b8">${totalRows} dòng • ${totalPages} trang</span>
  <div class="spacer"></div>
  <button class="primary" onclick="window.print()">🖨 In / Lưu PDF</button>
  <a href="javascript:window.close()">Đóng</a>
${o.preview ? '  <span style="color:#fbbf24">● Chế độ xem trước</span>' : ''}
</div>
<div class="pages">${pagesHTML}</div>
${o.autoPrint ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},350)})</script>' : ''}
</body>
</html>`;
}

/* ==================================================================== */
/* RENDER CSV                                                           */
/* ==================================================================== */

function renderCSV(template, rows, context) {
  const design = template.design || {};
  const colBand = design.bands && design.bands.columnHeader;
  const detailBand = design.bands && design.bands.detail;
  let columns = [];
  if (colBand && colBand.elements) {
    columns = colBand.elements
      .filter((e) => e.type === 'field' || e.type === 'expr')
      .sort((a, b) => a.x - b.x)
      .map((e) => ({ key: e.field, label: e.label || e.text || e.field || 'Cột', format: e.format, decimals: e.decimals, type: e.type, expr: e.expr }));
  }
  if (!columns.length && detailBand && detailBand.elements) {
    columns = detailBand.elements
      .filter((e) => e.type === 'field')
      .map((e) => ({ key: e.field, label: e.field, format: e.format, decimals: e.decimals }));
  }
  if (!columns.length && rows.length) {
    columns = Object.keys(rows[0]).map((k) => ({ key: k, label: k, format: 'text' }));
  }
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [];
  lines.push(columns.map((c) => esc(c.label)).join(','));
  rows.forEach((row, idx) => {
    lines.push(
      columns
        .map((c) => {
          const ctx = { row, rows, rowIndex: idx, params: {}, settings: (context && context.settings) || {}, company: (context && context.company) || {} };
          if (c.type === 'expr') return esc(evalExpression(c.expr, ctx));
          const raw = getByPath(row, c.key);
          return esc(formatValue(raw, c.format || guessFormatFromValue(raw), c.decimals, ctx.settings));
        })
        .join(',')
    );
  });
  return '\ufeff' + lines.join('\n');
}

/* ==================================================================== */
/* RENDER XLSX (OOXML tối giản)                                         */
/* ==================================================================== */

function xmlEsc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function colName(n) {
  let s = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function renderXLSX(template, rows, context) {
  const design = template.design || {};
  const colBand = design.bands && design.bands.columnHeader;
  const cols = ((colBand && colBand.elements) || [])
    .filter((e) => e.type === 'field' || e.type === 'expr')
    .sort((a, b) => a.x - b.x);
  const columns = cols.length
    ? cols.map((e) => ({ key: e.field, label: e.label || e.text || e.field, format: e.format, decimals: e.decimals, type: e.type, expr: e.expr, width: e.w }))
    : Object.keys(rows[0] || {}).map((k) => ({ key: k, label: k, format: 'text' }));

  const companyName = (context.company && context.company.name) || '';
  const title = template.name || 'Báo cáo';

  const sheet = [];
  const colWidths = columns.map((c) => Math.max(10, Math.min(40, Number(c.width) || 18)));
  sheet.push(`<row r="1"><c r="A1" t="inlineStr" s="2"><is><t>${xmlEsc(companyName)}</t></is></c></row>`);
  sheet.push(`<row r="2"><c r="A2" t="inlineStr" s="3"><is><t>${xmlEsc(title).toUpperCase()}</t></is></c></row>`);
  sheet.push(`<row r="3"><c r="A3" t="inlineStr" s="0"><is><t>Ngày in: ${xmlEsc(new Date().toLocaleString('vi-VN'))}</t></is></c></row>`);
  sheet.push(`<row r="4"><c r="A4" t="inlineStr" s="0"><is><t>Tổng số dòng: ${rows.length}</t></is></c></row>`);

  const headerRowIndex = 5;
  sheet.push(
    `<row r="${headerRowIndex}">${columns
      .map((c, i) => `<c r="${colName(i + 1)}${headerRowIndex}" t="inlineStr" s="1"><is><t>${xmlEsc(c.label)}</t></is></c>`)
      .join('')}</row>`
  );

  rows.forEach((row, idx) => {
    const r = headerRowIndex + 1 + idx;
    sheet.push(
      `<row r="${r}">${columns
        .map((c, i) => {
          const ref = colName(i + 1) + r;
          const ctx = { row, rows, rowIndex: idx, settings: (context && context.settings) || {}, company: context.company || {} };
          if (c.type === 'expr') {
            const val = evalExpression(c.expr, Object.assign({}, ctx, { settings: Object.assign({}, ctx.settings, { currencySymbol: '' }) }));
            return `<c r="${ref}" t="inlineStr"><is><t>${xmlEsc(val)}</t></is></c>`;
          }
          const raw = getByPath(row, c.key);
          if (typeof raw === 'number' && ['money', 'number', 'percent'].includes(c.format)) {
            return `<c r="${ref}"><v>${raw}</v></c>`;
          }
          const val = formatValue(raw, c.format || guessFormatFromValue(raw), c.decimals, Object.assign({}, ctx.settings, { currencySymbol: '' }));
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEsc(val)}</t></is></c>`;
        })
        .join('')}</row>`
    );
  });

  const lastCol = colName(columns.length || 1);
  const summaryRow = headerRowIndex + rows.length + 2;
  sheet.push(
    `<row r="${summaryRow}"><c r="A${summaryRow}" t="inlineStr" s="1"><is><t>TỔNG CỘNG (${rows.length} dòng)</t></is></c>` +
      columns
        .map((c, i) => {
          if (i === 0 || !['money', 'number'].includes(c.format)) return '';
          const total = rows.reduce((s, r) => s + Number(getByPath(r, c.key) || 0), 0);
          return `<c r="${colName(i + 1)}${summaryRow}" s="1"><v>${total}</v></c>`;
        })
        .join('') +
      '</row>'
  );

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols>${colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${sheet.join('')}</sheetData>
<mergeCells count="1"><mergeCell ref="A1:${lastCol}1"/></mergeCells>
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="10"/><name val="Calibri"/></font>
<font><b/><sz val="10"/><name val="Calibri"/></font>
<font><b/><sz val="12"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><name val="Calibri"/></font>
</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF94A3B8"/></left><right style="thin"><color rgb="FF94A3B8"/></right><top style="thin"><color rgb="FF94A3B8"/></top><bottom style="thin"><color rgb="FF94A3B8"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const files = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xmlEsc((template.name || 'Bao cao').slice(0, 28))}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { name: 'xl/styles.xml', data: stylesXml },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
  ];
  return zip.createZip(files);
}

/* ==================================================================== */
/* RENDER DOCX (OOXML với bảng dữ liệu + band dạng khối định vị)        */
/* ==================================================================== */

function renderDOCX(template, rows, context) {
  const design = template.design || {};
  const paper = paperDims(design);
  const margins = design.margins || { top: 12, right: 12, bottom: 12, left: 12 };
  const contentWidth = paper.width - margins.left - margins.right;
  const colBand = (design.bands && design.bands.columnHeader) || { elements: [] };
  const detailBand = (design.bands && design.bands.detail) || { elements: [] };

  const columns = (colBand.elements || [])
    .filter((e) => e.type === 'field' || e.type === 'expr')
    .sort((a, b) => a.x - b.x)
    .map((e) => ({
      key: e.field,
      label: e.label || e.text || e.field || '',
      align: e.align || 'left',
      format: e.format,
      decimals: e.decimals,
      type: e.type,
      expr: e.expr,
      widthMm: Number(e.w) || 30,
      bold: !!e.bold,
    }));

  const bodyParas = [];

  const paragraph = (text, opts) => {
    const o = opts || {};
    const runs = String(text)
      .split('\n')
      .map((line, i) => `${i > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEsc(line)}</w:t>`)
      .join('');
    return `<w:p><w:pPr>${o.align ? `<w:jc w:val="${o.align}"/>` : ''}${o.size || o.bold ? `<w:rPr>${o.bold ? '<w:b/>' : ''}<w:sz w:val="${(o.size || 11) * 2}"/></w:rPr>` : ''}</w:pPr><w:r><w:rPr>${o.bold ? '<w:b/>' : ''}${o.italic ? '<w:i/>' : ''}<w:sz w:val="${(o.size || 11) * 2}"/>${o.color ? `<w:color w:val="${String(o.color).replace('#', '')}"/>` : ''}${o.font ? `<w:rFonts w:ascii="${xmlEsc(o.font)}" w:hAnsi="${xmlEsc(o.font)}"/>` : ''}</w:rPr>${runs}</w:r></w:p>`;
  };

  // Band tiêu đề (trích các phần tử text/field tĩnh ở reportTitle)
  const titleBand = (design.bands && design.bands.reportTitle) || { elements: [] };
  titleBand.elements
    .slice()
    .sort((a, b) => a.y - b.y)
    .forEach((e) => {
      const text = e.type === 'text' || e.type === 'dateTime' ? interpolate(e.text || '', Object.assign({}, context, { generatedAt: new Date().toISOString() })) : e.type === 'field' ? getByPath(rows[0] || {}, e.field) : '';
      if (!text) return;
      const align = e.align === 'center' ? 'center' : e.align === 'right' ? 'right' : 'left';
      bodyParas.push(paragraph(text, { align, bold: e.bold, size: Math.max(8, Math.round(Number(e.fontSize || 11) * 0.72)), italic: e.italic }));
    });

  // Bảng dữ liệu
  const totalWidth = columns.reduce((s, c) => s + c.widthMm, 0) || contentWidth;
  const cellWidths = columns.map((c) => Math.round(((c.widthMm / totalWidth) * contentWidth) * MM_TO_TWIP));

  const tableRow = (cells, opts) => {
    const o = opts || {};
    return `<w:tr>${o.header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells
      .map(
        (cell, i) =>
          `<w:tc><w:tcPr><w:tcW w:w="${cellWidths[i] || 1000}" w:type="dxa"/>${o.header ? '<w:shd w:val="clear" w:color="auto" w:fill="DBEAFE"/>' : ''}<w:vAlign w:val="center"/></w:tcPr>${paragraph(cell, {
            align: o.header ? 'center' : o.aligns && o.aligns[i] === 'right' ? 'right' : o.aligns && o.aligns[i] === 'center' ? 'center' : 'left',
            bold: o.header || (o.bolds && o.bolds[i]),
            size: o.size || 9,
          })}</w:tc>`
      )
      .join('')}</w:tr>`;
  };

  const tableXml = `<w:tbl>
<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${Math.round(contentWidth * MM_TO_TWIP)}" w:type="dxa"/><w:tblBorders>
<w:top w:val="single" w:sz="4" w:color="94A3B8"/><w:left w:val="single" w:sz="4" w:color="94A3B8"/><w:bottom w:val="single" w:sz="4" w:color="94A3B8"/><w:right w:val="single" w:sz="4" w:color="94A3B8"/><w:insideH w:val="single" w:sz="4" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="4" w:color="CBD5E1"/></w:tblBorders></w:tblPr>
<w:tblGrid>${cellWidths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>
${tableRow(columns.map((c) => c.label), { header: true })}
${rows
  .map((row, idx) =>
    tableRow(
      columns.map((c) => {
        const ctx = { row, rows, rowIndex: idx, params: {}, settings: (context && context.settings) || {}, company: context.company || {} };
        if (c.type === 'expr') return evalExpression(c.expr, ctx);
        const raw = getByPath(row, c.key);
        return formatValue(raw, c.format || guessFormatFromValue(raw), c.decimals, Object.assign({}, ctx.settings, { currencySymbol: '' }));
      }),
      { aligns: columns.map((c) => c.align), size: 9 }
    )
  )
  .join('\n')}
${
  columns.some((c) => ['money', 'number'].includes(c.format))
    ? tableRow(
        columns.map((c, i) => {
          if (i === 0) return 'TỔNG CỘNG';
          if (!['money', 'number'].includes(c.format)) return '';
          const total = rows.reduce((s, r) => s + Number(getByPath(r, c.key) || 0), 0);
          return formatValue(total, 'number', c.decimals, Object.assign({}, context.settings, { currencySymbol: '' }));
        }),
        { bolds: columns.map(() => true), aligns: columns.map((c) => c.align), size: 9 }
      )
    : ''
}
</w:tbl>`;

  // Band cuối: chữ ký
  const footerBand = (design.bands && design.bands.reportFooter) || { elements: [] };
  const sigElems = footerBand.elements.filter((e) => e.type === 'text' && /ký/i.test(e.text || ''));
  const sigParas = sigElems.length
    ? `<w:p/>` +
      paragraph(sigElems.map((e) => (e.text || '').replace(/\n/g, ' — ')).join('        '), { align: 'center', bold: true, size: 9 }) +
      paragraph(sigElems.map(() => '(Ký, họ tên)').join('        '), { align: 'center', italic: true, size: 8 })
    : '';

  const sectionWidthTwip = Math.round(paper.width * MM_TO_TWIP);
  const sectionHeightTwip = Math.round(paper.height * MM_TO_TWIP);
  const marginTwips = {
    top: Math.round(margins.top * MM_TO_TWIP),
    right: Math.round(margins.right * MM_TO_TWIP),
    bottom: Math.round(margins.bottom * MM_TO_TWIP),
    left: Math.round(margins.left * MM_TO_TWIP),
  };

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
${bodyParas.join('\n')}
${tableXml}
${sigParas}
<w:sectPr>
<w:pgSz w:w="${sectionWidthTwip}" w:h="${sectionHeightTwip}"${design.orientation === 'landscape' ? ' w:orient="landscape"' : ''}/>
<w:pgMar w:top="${marginTwips.top}" w:right="${marginTwips.right}" w:bottom="${marginTwips.bottom}" w:left="${marginTwips.left}" w:header="720" w:footer="720" w:gutter="0"/>
</w:sectPr>
</w:body>
</w:document>`;

  const files = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    {
      name: 'word/styles.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>
</w:styles>`,
    },
    { name: 'word/document.xml', data: documentXml },
  ];
  return zip.createZip(files);
}

module.exports = {
  blankDesign,
  renderHTML,
  renderCSV,
  renderXLSX,
  renderDOCX,
  applyRowParams,
  evalExpression,
  interpolate,
  formatValue,
  buildGroups,
  qrSVG,
  code128SVG,
  BANDS,
  ELEMENT_TYPES,
  PAPER_SIZES,
  getByPath,
};
