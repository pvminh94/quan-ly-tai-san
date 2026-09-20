'use strict';
/**
 * qr.js — Bộ sinh mã QR THẬT (chuẩn ISO/IEC 18004), không dùng thư viện ngoài.
 * ---------------------------------------------------------------------------
 * Hỗ trợ: phiên bản 1–10, 4 mức sửa lỗi (L/M/Q/H), chế độ byte (UTF-8),
 *         Reed-Solomon GF(256), mặt nạ 0–7 chọn theo điểm phạt, thông tin
 *         định dạng & phiên bản đúng chuẩn ⇒ điện thoại quét được.
 *
 * Dùng:
 *   const qr = require('./qr');
 *   qr.svg('TS-2026-00001', { ecc: 'M', module: 2, quiet: 4 })
 *   qr.matrix('...')   // { size, version, ecc, mask, get(x,y) } — tiện cho kiểm thử
 */

/* ------------------------------ Trường GF(256) ------------------------------ */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** Đa thức sinh Reed-Solomon bậc `n` */
function generatorPoly(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Mã sửa lỗi Reed-Solomon cho một khối dữ liệu */
function rsEncode(data, ecLen) {
  const gen = generatorPoly(ecLen);
  const res = new Uint8Array(data.length + ecLen);
  res.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef === 0) continue;
    for (let j = 1; j < gen.length; j++) res[i + j] ^= gfMul(gen[j], coef);
  }
  return Array.from(res.slice(data.length));
}

/* --------------------------- Bảng cấu hình chuẩn --------------------------- */

/**
 * blocks: số khối nhóm 1, dataG1: codeword dữ liệu mỗi khối nhóm 1,
 * blocks2/dataG2: nhóm 2 (khối nhiều hơn 1 codeword), ec: codeword sửa lỗi mỗi khối.
 * Tổng data = blocks*dataG1 + blocks2*dataG2.
 */
const RS_BLOCKS = {
  1: { L: [1, 19, 0, 0, 7], M: [1, 16, 0, 0, 10], Q: [1, 13, 0, 0, 13], H: [1, 9, 0, 0, 17] },
  2: { L: [1, 34, 0, 0, 10], M: [1, 28, 0, 0, 16], Q: [1, 22, 0, 0, 22], H: [1, 16, 0, 0, 28] },
  3: { L: [1, 55, 0, 0, 15], M: [1, 44, 0, 0, 26], Q: [2, 17, 0, 0, 18], H: [2, 13, 0, 0, 22] },
  4: { L: [1, 80, 0, 0, 20], M: [2, 32, 0, 0, 18], Q: [2, 24, 0, 0, 26], H: [4, 9, 0, 0, 16] },
  5: { L: [1, 108, 0, 0, 26], M: [2, 43, 0, 0, 24], Q: [2, 15, 2, 16, 18], H: [2, 11, 2, 12, 22] },
  6: { L: [2, 68, 0, 0, 18], M: [4, 27, 0, 0, 16], Q: [4, 19, 0, 0, 24], H: [4, 15, 0, 0, 28] },
  7: { L: [2, 78, 0, 0, 20], M: [4, 31, 0, 0, 18], Q: [2, 14, 4, 15, 18], H: [4, 13, 1, 14, 26] },
  8: { L: [2, 97, 0, 0, 24], M: [2, 38, 2, 39, 22], Q: [4, 18, 2, 19, 22], H: [4, 14, 2, 15, 26] },
  9: { L: [2, 116, 0, 0, 30], M: [3, 36, 2, 37, 22], Q: [4, 16, 4, 17, 20], H: [4, 12, 4, 13, 24] },
  10: { L: [2, 68, 2, 69, 18], M: [4, 43, 1, 44, 26], Q: [6, 19, 2, 20, 24], H: [6, 15, 2, 16, 28] },
};

/** Tâm các ô định vị (alignment pattern) theo phiên bản */
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

/** Số bit dư (remainder bits) theo phiên bản */
const REMAINDER = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };

const ECC_BITS = { L: 1, M: 0, Q: 3, H: 2 }; // 2 bit trong thông tin định dạng

function maxVersion() {
  return 10;
}

/** Số codeword dữ liệu của phiên bản + mức sửa lỗi */
function dataCodewords(version, ecc) {
  const b = RS_BLOCKS[version][ecc];
  return b[0] * b[1] + b[2] * b[3];
}

function charCountBits(version) {
  return version <= 9 ? 8 : 16;
}

/* ------------------------------ Tạo bit stream ------------------------------ */

function buildCodewords(bytes, version, ecc) {
  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);                     // chế độ byte
  push(bytes.length, charCountBits(version));
  bytes.forEach((b) => push(b, 8));

  const totalData = dataCodewords(version, ecc);
  const capacityBits = totalData * 8;
  if (bits.length > capacityBits) throw new Error('Dữ liệu vượt dung lượng phiên bản ' + version);
  // Terminator tối đa 4 bit
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
  // Bù cho tròn byte
  while (bits.length % 8 !== 0) bits.push(0);
  // Byte đệm
  const padBytes = [0xec, 0x11];
  let p = 0;
  while (bits.length < capacityBits) push(padBytes[p++ % 2], 8);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    codewords.push(v);
  }

  // Chia khối, tính EC, đan xen
  const [n1, d1, n2, d2, ecLen] = RS_BLOCKS[version][ecc];
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < n1; i++) {
    const data = codewords.slice(offset, offset + d1);
    offset += d1;
    blocks.push({ data, ec: rsEncode(data, ecLen) });
  }
  for (let i = 0; i < n2; i++) {
    const data = codewords.slice(offset, offset + d2);
    offset += d2;
    blocks.push({ data, ec: rsEncode(data, ecLen) });
  }

  const out = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) blocks.forEach((b) => { if (i < b.data.length) out.push(b.data[i]); });
  for (let i = 0; i < ecLen; i++) blocks.forEach((b) => out.push(b.ec[i]));
  return out;
}

/* -------------------------------- Ma trận QR -------------------------------- */

function makeMatrix(modules, version, reserved) {
  return { array: modules, reserved, version };
}

/** Khởi tạo ma trận với các mẫu chức năng (finder, timing, alignment, dark module) */
function buildBase(version) {
  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(null));
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < size && y < size) m[y][x] = v; };
  // fn[y][x] = true cho mọi ô thuộc mẫu chức năng (không mang dữ liệu, không bị che)
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));

  const finder = (ox, oy) => {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const inRing = x >= 0 && x <= 6 && y >= 0 && y <= 6;
        const dark = inRing && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
        set(ox + x, oy + y, dark ? 1 : 0);
        // Cả ô định vị lẫn dải phân cách đều là mẫu chức năng — không bị che
        if (ox + x >= 0 && oy + y >= 0 && ox + x < size && oy + y < size) fn[oy + y][ox + x] = true;
      }
    }
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);

  // Timing pattern
  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    set(i, 6, v);
    set(6, i, v);
  }
  for (let i = 0; i < size; i++) { fn[6][i] = true; fn[i][6] = true; }

  // Alignment pattern
  const centers = ALIGN[version] || [];
  const last = centers.length - 1;
  centers.forEach((cy, j) => {
    centers.forEach((cx, i) => {
      // Chỉ bỏ 3 giao điểm trùng ô định vị ở ba góc; các ô nằm trên đường
      // timing vẫn được vẽ (đúng chuẩn — ô định vị con ngắt đường timing).
      const isFinderCorner = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
      if (isFinderCorner) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const dark = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
          set(cx + dx, cy + dy, dark ? 1 : 0);
          fn[cy + dy][cx + dx] = true;
        }
      }
    });
  });

  set(8, size - 8, 1); // dark module
  fn[size - 8][8] = true;

  // Vùng dành riêng cho thông tin định dạng
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  for (let i = 0; i < 9; i++) { reserved[8][i] = true; reserved[i][8] = true; }
  for (let i = 0; i < 8; i++) { reserved[8][size - 1 - i] = true; reserved[size - 1 - i][8] = true; }
  reserved[8][size - 8] = true;

  // Vùng thông tin phiên bản (v7+)
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        reserved[size - 11 + j][i] = true;
        reserved[i][size - 11 + j] = true;
      }
    }
  }
  return { m, reserved, size, fn };
}

function placeData(version, codewords, reservedBase) {
  const size = version * 4 + 17;
  const m = reservedBase.m.map((row) => row.slice());
  const reserved = reservedBase.reserved.map((row) => row.slice());
  void reservedBase.fn;
  let bitIndex = 0;
  const totalBits = codewords.length * 8 + (REMAINDER[version] || 0);

  const nextBit = () => {
    if (bitIndex >= codewords.length * 8) { bitIndex++; return 0; } // remainder bits = 0
    const byte = codewords[bitIndex >> 3];
    const bit = (byte >> (7 - (bitIndex & 7))) & 1;
    bitIndex++;
    return bit;
  };

  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5; // bỏ cột timing
    for (let i = 0; i < size; i++) {
      const y = upward ? size - 1 - i : i;
      for (let k = 0; k < 2; k++) {
        const x = right - k;
        // Bỏ qua vùng dành riêng (thông tin định dạng/phiên bản) VÀ mọi ô đã có
        // mẫu chức năng (ô định vị, timing, alignment, dark module).
        if (reserved[y][x] || m[y][x] !== null) continue;
        m[y][x] = nextBit();
      }
    }
    upward = !upward;
  }
  void totalBits;
  return m;
}

const MASK_FN = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(m, notData, maskIndex) {
  const size = m.length;
  const out = m.map((row) => row.slice());
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // notData = hợp của vùng dành riêng (thông tin định dạng/phiên bản)
      // và vùng mẫu chức năng (ô định vị, timing, alignment, ô đen cố định)
      if (notData[y][x]) continue;
      if (MASK_FN[maskIndex](x, y)) out[y][x] ^= 1;
    }
  }
  return out;
}

/** Thông tin định dạng: 15 bit (5 dữ liệu + BCH) XOR 0x5412 */
function formatBits(ecc, mask) {
  const data = (ECC_BITS[ecc] << 3) | mask;
  let d = data << 10;
  for (let i = 14; i >= 10; i--) if ((d >> i) & 1) d ^= 0x537 << (i - 10);
  return ((data << 10) | d) ^ 0x5412;
}

function versionBits(version) {
  let d = version << 12;
  for (let i = 17; i >= 12; i--) if ((d >> i) & 1) d ^= 0x1f25 << (i - 12);
  return (version << 12) | d;
}

function writeFormat(m, ecc, mask) {
  const size = m.length;
  const bits = formatBits(ecc, mask);
  const get = (i) => (bits >> i) & 1; // i = chỉ số bit, 14 là bit cao nhất
  // Quy ước: setMod(x, y, v) — cột x, hàng y
  // Quy ước: setMod(x, y, v) — cột x, hàng y (giống setFunctionModule của thư viện tham chiếu)
  const setMod = (x, y, v) => { m[y][x] = v; };

  // Bản sao 1 — quanh ô định vị góc trên-trái. Bit thấp nhất (bit 0) đặt tại (8,0),
  // tăng dần theo thứ tự ô của chuẩn ISO/IEC 18004 (mục 8.9).
  for (let i = 0; i <= 5; i++) setMod(8, i, get(i));
  setMod(8, 7, get(6));
  setMod(8, 8, get(7));
  setMod(7, 8, get(8));
  for (let i = 9; i < 15; i++) setMod(14 - i, 8, get(i));

  // Bản sao 2 — góc trên-phải (hàng 8, từ phải sang) và góc dưới-trái (cột 8)
  for (let i = 0; i < 8; i++) setMod(size - 1 - i, 8, get(i));
  for (let i = 8; i < 15; i++) setMod(8, size - 15 + i, get(i));
  setMod(8, size - 8, 1); // ô đen cố định (dark module)
  return m;
}

function writeVersion(m, version) {
  if (version < 7) return m;
  const bits = versionBits(version);
  const size = m.length;
  // 18 bit, bit thấp nhất trước (i = 0 → 17) — chuẩn ISO/IEC 18004 mục 8.10.
  // Hai bản sao đối xứng qua đường chéo, mỗi vị trí nhận cùng một bit.
  for (let i = 0; i < 18; i++) {
    const bit = (bits >> i) & 1;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    m[b][a] = bit;
    m[a][b] = bit;
  }
  return m;
}

/* ------------------------------- Chọn mặt nạ ------------------------------- */

function penalty(m) {
  const size = m.length;
  let score = 0;
  // Quy tắc 1: dãy cùng màu ≥ 5
  const scanLine = (getter) => {
    let run = 1;
    for (let i = 1; i < size; i++) {
      if (getter(i) === getter(i - 1)) {
        run++;
      } else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += 3 + (run - 5);
  };
  for (let y = 0; y < size; y++) scanLine((x) => m[y][x]);
  for (let x = 0; x < size; x++) scanLine((y) => m[y][x]);
  // Quy tắc 2: khối 2x2 cùng màu
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = m[y][x];
      if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) score += 3;
    }
  }
  // Quy tắc 3: mẫu giống finder
  const pattern = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const matchAt = (arr, start) => pattern.every((p, i) => arr[start + i] === p);
  for (let y = 0; y < size; y++) {
    const row = m[y];
    for (let x = 0; x + 11 <= size; x++) if (matchAt(row, x)) score += 40;
  }
  for (let x = 0; x < size; x++) {
    const col = m.map((row) => row[x]);
    for (let y = 0; y + 11 <= size; y++) if (matchAt(col, y)) score += 40;
  }
  // Quy tắc 4: tỷ lệ ô đen
  let dark = 0;
  m.forEach((row) => row.forEach((v) => { if (v) dark++; }));
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
}

/* --------------------------------- API công khai --------------------------------- */

/** Phân tích tuỳ chọn, chọn phiên bản tối thiểu và dựng ma trận cuối cùng */
function build(text, opts) {
  const o = Object.assign({ ecc: 'M', version: null, mask: null }, opts || {});
  const bytes = Array.from(Buffer.from(String(text), 'utf8'));
  if (!bytes.length) throw new Error('Nội dung QR rỗng');

  const eccOrder = ['H', 'Q', 'M', 'L'];
  let version = null;
  let ecc = o.ecc;
  const fits = (v, e) => {
    const bits = 4 + charCountBits(v) + bytes.length * 8;
    return bits <= dataCodewords(v, e) * 8;
  };
  // Ưu tiên mức yêu cầu, tự hạ mức nếu quá dài
  const levels = [ecc].concat(eccOrder.filter((e) => e !== ecc));
  if (o.version) {
    version = Number(o.version);
    if (!fits(version, ecc)) throw new Error('Dữ liệu không vừa phiên bản ' + version + '-' + ecc);
  } else {
    for (const level of levels) {
      for (let v = 1; v <= maxVersion(); v++) {
        if (fits(v, level)) { version = v; ecc = level; break; }
      }
      if (version) break;
    }
  }
  if (!version) {
    throw new Error('Nội dung quá dài cho mã QR (tối đa phiên bản ' + maxVersion() + '): ' + bytes.length + ' byte');
  }

  const codewords = buildCodewords(bytes, version, ecc);
  const base = buildBase(version);
  const placed = placeData(version, codewords, base);

  // Hợp nhất vùng "không phải dữ liệu": dành riêng + mẫu chức năng
  const notData = base.reserved.map((row, y) => row.map((v, x) => v || base.fn[y][x]));

  // Chọn mặt nạ có điểm phạt nhỏ nhất (hoặc dùng mặt nạ được chỉ định)
  const masks = o.mask === null || o.mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [Number(o.mask)];
  let best = null;
  for (const mask of masks) {
    const masked = applyMask(placed, notData, mask);
    writeFormat(masked, ecc, mask);
    writeVersion(masked, version);
    const score = penalty(masked);
    if (!best || score < best.score) best = { score, mask, matrix: masked };
  }
  const out = { matrix: best.matrix, version, ecc, mask: best.mask, placed, reserved: notData };
  return out;
}

/** Trả về ma trận dạng { size, version, ecc, mask, get(x,y) } */
function matrix(text, opts) {
  const r = build(text, opts);
  return {
    size: r.matrix.length,
    version: r.version,
    ecc: r.ecc,
    mask: r.mask,
    get: (x, y) => r.matrix[y][x],
    rows: r.matrix,
    placedRows: r.placed,      // trước khi áp mặt nạ
    reservedRows: r.reserved,  // vùng không chứa dữ liệu
  };
}

/** Sinh SVG (dùng cho báo cáo in và tem tài sản) */
function svg(text, opts) {
  const o = Object.assign({ quiet: 4, dark: '#000000', light: '#ffffff', margin: null }, opts || {});
  const r = build(text, o);
  const m = r.matrix;
  const size = m.length;
  const quiet = o.margin === undefined || o.margin === null ? o.quiet : o.margin;
  const total = size + quiet * 2;
  let rects = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (m[y][x]) rects += `<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" style="width:100%;height:100%" shape-rendering="crispEdges" data-qr="${r.version}${r.ecc}">` +
    `<rect width="${total}" height="${total}" fill="${o.light}"/>` +
    `<g fill="${o.dark}">${rects}</g></svg>`;
}

module.exports = {
  svg,
  matrix,
  build,
  // xuất cho kiểm thử / dùng nâng cao
  _internal: { dataCodewords, formatBits, versionBits, rsEncode, buildCodewords, RS_BLOCKS, MASK_FN },
};
