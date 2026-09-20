'use strict';
/**
 * barcode.js — Bộ sinh mã vạch 1D chuẩn cho AMS Pro (không phụ thuộc thư viện ngoài).
 *
 * Hiện hỗ trợ **Code 128** (bộ ký tự A/B/C, tự chuyển bộ ký tự, checksum mod 103,
 * lề trắng 10 module hai bên theo đúng khuyến nghị ISO/IEC 15417).
 *
 * Bảng pattern dưới đây được kiểm chứng từng giá trị với bộ giải mã độc lập ZXing
 * (xem `server/tools/qr-test.js`, mục 5) nên mã in ra quét được bằng máy quét thật.
 *
 * Tham chiếu: ISO/IEC 15417 (Code 128), GS1 General Specifications.
 */

/* ---------------------------------------------------------------------------
 * 1. Bảng pattern: giá trị 0..106 → 6 module (vạch/trắng xen kẽ, bắt đầu bằng vạch)
 *    - 0..102  : ký tự dữ liệu
 *    - 103     : START A   (211412)
 *    - 104     : START B   (211214)
 *    - 105     : START C   (211232)
 *    - 106     : STOP      (2331112 — 7 module, kết thúc bằng vạch)
 * ------------------------------------------------------------------------- */
const PATTERN_TEXT =
  '212222,222122,222221,121223,121322,131222,122213,122312,132212,221213,' +
  '221312,231212,112232,122132,122231,113222,123122,123221,223211,221132,' +
  '221231,213212,223112,312131,311222,321122,321221,312212,322112,322211,' +
  '212123,212321,232121,111323,131123,131321,112313,132113,132311,211313,' +
  '231113,231311,112133,112331,132131,113123,113321,133121,313121,211331,' +
  '231131,213113,213311,213131,311123,311321,331121,312113,312311,332111,' +
  '314111,221411,431111,111224,111422,121124,121421,141122,141221,112214,' +
  '112412,122114,122411,142112,142211,241211,221114,413111,241112,134111,' +
  '111242,121142,121241,114212,124112,124211,411212,421112,421211,212141,' +
  '214121,412121,111143,111341,131141,114113,114311,411113,411311,113141,' +
  '114131,311141,411131,211412,211214,211232,2331112';
const PATTERNS = PATTERN_TEXT.split(',');

const START_A = 103;
const START_B = 104;
const START_C = 105;
const STOP = 106;
const CODE_A = 101; // ký tự chuyển sang bộ A (khi đang ở bộ B/C)
const CODE_B = 100; // ký tự chuyển sang bộ B (khi đang ở bộ A/C)
const CODE_C = 99; // ký tự chuyển sang bộ C (khi đang ở bộ A/B)

/** Bỏ dấu tiếng Việt để nội dung đưa vào mã vạch luôn nằm trong bộ ký tự Code 128 */
const VIET_MAP = {
  à: 'a', á: 'a', ả: 'a', ã: 'a', ạ: 'a', ă: 'a', ằ: 'a', ắ: 'a', ẳ: 'a', ẵ: 'a', ặ: 'a',
  â: 'a', ầ: 'a', ấ: 'a', ẩ: 'a', ẫ: 'a', ậ: 'a',
  è: 'e', é: 'e', ẻ: 'e', ẽ: 'e', ẹ: 'e', ê: 'e', ề: 'e', ế: 'e', ể: 'e', ễ: 'e', ệ: 'e',
  ì: 'i', í: 'i', ỉ: 'i', ĩ: 'i', ị: 'i',
  ò: 'o', ó: 'o', ỏ: 'o', õ: 'o', ọ: 'o', ô: 'o', ồ: 'o', ố: 'o', ổ: 'o', ỗ: 'o', ộ: 'o',
  ơ: 'o', ờ: 'o', ớ: 'o', ở: 'o', ỡ: 'o', ợ: 'o',
  ù: 'u', ú: 'u', ủ: 'u', ũ: 'u', ụ: 'u', ư: 'u', ừ: 'u', ứ: 'u', ử: 'u', ữ: 'u', ự: 'u',
  ỳ: 'y', ý: 'y', ỷ: 'y', ỹ: 'y', ỵ: 'y',
  đ: 'd',
  À: 'A', Á: 'A', Ả: 'A', Ã: 'A', Ạ: 'A', Ă: 'A', Ằ: 'A', Ắ: 'A', Ẳ: 'A', Ẵ: 'A', Ặ: 'A',
  Â: 'A', Ầ: 'A', Ấ: 'A', Ẩ: 'A', Ẫ: 'A', Ậ: 'A',
  È: 'E', É: 'E', Ẻ: 'E', Ẽ: 'E', Ẹ: 'E', Ê: 'E', Ề: 'E', Ế: 'E', Ể: 'E', Ễ: 'E', Ệ: 'E',
  Ì: 'I', Í: 'I', Ỉ: 'I', Ĩ: 'I', Ị: 'I',
  Ò: 'O', Ó: 'O', Ỏ: 'O', Õ: 'O', Ọ: 'O', Ô: 'O', Ồ: 'O', Ố: 'O', Ổ: 'O', Ỗ: 'O', Ộ: 'O',
  Ơ: 'O', Ờ: 'O', Ớ: 'O', Ở: 'O', Ỡ: 'O', Ợ: 'O',
  Ù: 'U', Ú: 'U', Ủ: 'U', Ũ: 'U', Ụ: 'U', Ư: 'U', Ừ: 'U', Ứ: 'U', Ử: 'U', Ữ: 'U', Ự: 'U',
  Ỳ: 'Y', Ý: 'Y', Ỷ: 'Y', Ỹ: 'Y', Ỵ: 'Y',
  Đ: 'D',
};

/** Chuyển chuỗi về bộ ký tự ASCII mà Code 128 biểu diễn được (giữ nguyên nếu đã là ASCII) */
function toAscii(text) {
  const s = String(text == null ? '' : text);
  let out = '';
  for (const ch of s) {
    if (ch.charCodeAt(0) < 128) { out += ch; continue; }
    if (VIET_MAP[ch]) { out += VIET_MAP[ch]; continue; }
    // Các ký tự Unicode khác: bỏ dấu bằng cách tách thành ký tự cơ sở
    const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    out += base.charCodeAt(0) < 128 ? base : ' ';
  }
  return out;
}

/**
 * Chọn dãy ký tự Code 128 cho nội dung (tối ưu độ rộng mã):
 *  - Nội dung bắt đầu bằng >= 2 chữ số  → vào thẳng bộ C (không tốn ký tự chuyển bộ)
 *  - Đoạn chữ số >= 4 ở giữa chuỗi      → chuyển sang bộ C cho đoạn đó, nếu đoạn lẻ thì
 *    ký tự dư được giữ ở bộ hiện tại; sau đoạn số quay lại bộ A/B
 *  - Bộ A khi có ký tự điều khiển, ngược lại bộ B
 * Trả về { ascii, symbols, start }
 */
function encodeSymbols(text) {
  const ascii = toAscii(text);
  if (!ascii.length) return { ascii, symbols: [], start: START_B };

  const hasControl = /[\u0000-\u001f]/.test(ascii);
  const leadingDigits = (ascii.match(/^[0-9]+/) || [''])[0].length;
  let start = hasControl ? START_A : START_B;
  let cur = hasControl ? 'A' : 'B';
  if (leadingDigits >= 2) { start = START_C; cur = 'C'; }

  const symbols = [];
  const valOf = (code, set) => (set === 'A' ? (code < 32 ? code + 64 : code - 32) : code - 32);
  let i = 0;
  while (i < ascii.length) {
    const run = (ascii.slice(i).match(/^[0-9]+/) || [''])[0];

    if (cur === 'C') {
      // Trong bộ C: gom từng cặp số; hết cặp thì quay lại bộ A/B
      if (run.length >= 2) { symbols.push({ value: Number(ascii.substr(i, 2)), set: 'C' }); i += 2; continue; }
      const needA = ascii.charCodeAt(i) < 32;
      cur = needA ? 'A' : 'B';
      symbols.push({ value: needA ? CODE_A : CODE_B, set: 'switch' });
      continue;
    }

    // Đoạn chữ số >= 4 ở giữa chuỗi → dùng bộ C cho gọn
    if (run.length >= 4) {
      const end = i + run.length;
      let k = i;
      if (run.length % 2) { // ký tự dư giữ ở bộ hiện tại (đang ở bộ này nên không tốn thêm ký tự)
        symbols.push({ value: valOf(ascii.charCodeAt(k), cur), set: cur });
        k += 1;
      }
      symbols.push({ value: CODE_C, set: 'switch' });
      while (k + 1 < end) { symbols.push({ value: Number(ascii.substr(k, 2)), set: 'C' }); k += 2; }
      i = end;
      if (i < ascii.length) {
        const needA = ascii.charCodeAt(i) < 32;
        cur = needA ? 'A' : 'B';
        symbols.push({ value: needA ? CODE_A : CODE_B, set: 'switch' });
      } else {
        cur = 'C';
      }
      continue;
    }

    const c = ascii.charCodeAt(i);
    const needA = c < 32;
    if (needA && cur === 'B') { symbols.push({ value: CODE_A, set: 'switch' }); cur = 'A'; }
    if (!needA && cur === 'A' && c >= 96) { symbols.push({ value: CODE_B, set: 'switch' }); cur = 'B'; }
    symbols.push({ value: valOf(c, cur), set: cur });
    i += 1;
  }
  return { ascii, symbols, start };
}

/** Sinh mã Code 128 hoàn chỉnh: start + dữ liệu + checksum + stop, kèm chuỗi module */
function encode(text, options) {
  const o = options || {};
  const { ascii, symbols, start } = encodeSymbols(text);
  if (!symbols.length && !ascii.length) return null;

  // Checksum: (giá trị start + Σ giá trị ký tự × vị trí) mod 103
  let checksum = start;
  symbols.forEach((s, idx) => { checksum += s.value * (idx + 1); });
  checksum %= 103;

  const sequence = [start, ...symbols.map((s) => s.value), checksum, STOP];

  // Mỗi pattern gồm các nhóm module xen kẽ: nhóm lẻ (i chẵn) là vạch, nhóm chẵn là trắng
  const out = [];
  sequence.forEach((value) => {
    const p = PATTERNS[value];
    for (let i = 0; i < p.length; i++) {
      const w = Number(p[i]);
      const dark = i % 2 === 0 ? 1 : 0;
      for (let k = 0; k < w; k++) out.push(dark);
    }
  });

  const quiet = o.quiet === undefined ? 10 : Math.max(0, Number(o.quiet) || 0);
  const withQuiet = new Array(quiet).fill(0).concat(out, new Array(quiet).fill(0));
  return {
    text: String(text == null ? '' : text),
    ascii,
    start,
    symbols,
    checksum,
    patterns: sequence.map((v) => PATTERNS[v]),
    modules: out,          // mảng 0/1 của riêng mã
    width: out.length,     // bề rộng mã (module)
    quiet,
    totalWidth: withQuiet.length,
    withQuiet,
  };
}

/** Bề rộng mã (tính theo module) — dùng để kiểm tra X-dimension khi in */
function width(text, options) {
  const r = encode(text, options);
  return r ? r.totalWidth : 0;
}

/**
 * Sinh SVG mã vạch Code 128.
 * options: { quiet (mặc định 10), height (chiều cao vùng vạch, mặc định 70 trên 100),
 *            showText (in nội dung dưới mã), textSize, dark, light, moduleHeight }
 */
function svg(text, options) {
  const o = options || {};
  const r = encode(text, o);
  if (!r) return '';
  const quiet = r.quiet;
  const total = r.totalWidth;
  const showText = !!o.showText;
  const barHeight = o.barHeight === undefined ? (showText ? 78 : 100) : Number(o.barHeight);
  const textY = barHeight + (100 - barHeight) * 0.62;

  let rects = '';
  for (let i = 0; i < r.modules.length; i++) {
    if (r.modules[i] !== 1) continue;
    let run = 1;
    while (r.modules[i + run] === 1) run++;
    rects += `<rect x="${quiet + i}" y="0" width="${run}" height="${barHeight}"/>`;
    i += run - 1;
  }
  const label = showText
    ? `<text x="${total / 2}" y="${textY}" font-family="monospace" font-size="${o.textSize || 9}" text-anchor="middle" fill="#000" lengthAdjust="spacingAndGlyphs">${escapeXml(r.ascii)}</text>`
    : '';
  return `<svg viewBox="0 0 ${total} 100" preserveAspectRatio="none" style="width:100%;height:100%" data-barcode="${escapeXml(r.ascii)}" data-barcode-type="code128" data-barcode-quiet="${quiet}" data-barcode-width="${r.width}" shape-rendering="crispEdges">`
    + `<rect width="${total}" height="100" fill="${o.light || '#fff'}"/>`
    + `<g fill="${o.dark || '#000'}">${rects}${label}</g>`
    + `</svg>`;
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = {
  encode,
  svg,
  width,
  toAscii,
  _internal: { PATTERNS, START_A, START_B, START_C, STOP, CODE_A, CODE_B, CODE_C, encodeSymbols },
};
