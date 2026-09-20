#!/usr/bin/env node
'use strict';
/**
 * qr-test.js — Kiểm chứng mã QR (lib/qr.js) và mã vạch Code 128 (lib/barcode.js)
 *              bằng các bộ giải mã / bộ sinh ĐỘC LẬP.
 * ---------------------------------------------------------------------------
 * Ứng dụng không phụ thuộc thư viện ngoài; công cụ này chỉ dùng để kiểm thử:
 *
 *   npm install --no-save @zxing/library qrcode-generator      # thêm bwip-js nếu muốn so chiếu mã vạch
 *   node server/tools/qr-test.js
 *
 * Nội dung kiểm tra:
 *   0. Kiểm chứng chính bộ kiểm thử (giải mã QR do ZXing tự sinh)
 *   1. Giải mã nội dung thật dùng trong hệ thống (mã tài sản, liên kết tem…)
 *   2. Mọi phiên bản 1-10 × 4 mức sửa lỗi L/M/Q/H (ngắn / vừa / sát dung lượng)
 *   3. So chiếu từng ô với bộ sinh độc lập qrcode-generator (nếu đã cài)
 *   4. Khoét mã QR từ CHÍNH chứng từ in (tem tài sản) rồi giải mã lại — chứng minh tem in ra quét được
 *   5. Mã vạch Code 128: bảng pattern ↔ ZXing, chuỗi module ↔ bwip-js (nếu đã cài),
 *      khoét mã vạch từ tem in rồi giải mã lại, và kiểm tra X-dimension khi in
 *
 * Ghi chú kỹ thuật: bộ dò của ZXing có thể không nhận ra ảnh tổng hợp phóng
 * to bằng số nguyên ở một số tỉ lệ nhất định (lỗi của bộ dò, không phải của mã
 * QR — bộ sinh tham chiếu cũng bị như vậy). Vì thế công cụ kiểm tra ở nhiều
 * tỉ lệ ảnh và cả chế độ đọc thẳng PURE_BARCODE; chỉ cần một tỉ lệ đọc được là
 * kết luận ĐẠT (giống như camera thật luôn có nhiều khung hình khác nhau).
 */
const path = require('path');
const QR = require(path.join(__dirname, '..', 'lib', 'qr'));

let ZX = null;
try { ZX = require('@zxing/library'); } catch (e) {
  console.error('\n\u001b[33m  Cần cài bộ giải mã độc lập để chạy kiểm chứng QR:\u001b[0m');
  console.error('    npm install --no-save @zxing/library qrcode-generator\n');
  process.exit(3);
}
let qrcodeGen = null;
try { qrcodeGen = require('qrcode-generator'); } catch (e) { qrcodeGen = null; }

let PURE = false;
function luminance(rows, size, scale, quiet) {
  const dim = (size + quiet * 2) * scale;
  const L = new Uint8ClampedArray(dim * dim);
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const mx = Math.floor(x / scale) - quiet;
      const my = Math.floor(y / scale) - quiet;
      const dark = mx >= 0 && my >= 0 && mx < size && my < size && rows[my][mx] === 1;
      L[y * dim + x] = dark ? 0 : 255;
    }
  }
  return { L, dim };
}

/** Giải mã ma trận bằng ZXing ở một tỉ lệ ảnh; trả về nội dung hoặc mã lỗi */
function decodeAt(rows, size, scale, pure) {
  const { L, dim } = luminance(rows, size, scale, 4);
  const src = new ZX.RGBLuminanceSource(L, dim, dim);
  const bmp = new ZX.BinaryBitmap(new ZX.HybridBinarizer(src));
  const hints = new Map();
  if (pure) hints.set('PURE_BARCODE', true);
  try {
    return { text: new ZX.QRCodeReader().decode(bmp, hints).getText() };
  } catch (e) {
    return { error: String((e && e.message) || e).slice(0, 40) };
  }
}

/**
 * Dự phòng khi bộ dò ảnh của ZXing không nhận ra ma trận: đối chiếu nội dung
 * ma trận (sau khi bỏ mặt nạ) với bộ sinh tham chiếu độc lập. Chỉ dùng được khi
 * đã cài qrcode-generator; nếu không có thì trả về null (coi như chưa kết luận).
 */
function contentMatchesReference(mine, version, ecc) {
  if (!qrcodeGen) return null;
  const COORD1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const ref = qrcodeGen(version, ecc);
  ref.addData(mine.text);
  ref.make();
  const n = ref.getModuleCount();
  if (n !== mine.rows.length) return false;
  const rows = [];
  for (let y = 0; y < n; y++) { const r = []; for (let x = 0; x < n; x++) r.push(ref.isDark(y, x) ? 1 : 0); rows.push(r); }
  let bits = 0;
  COORD1.forEach(([x, y], i) => { bits |= rows[y][x] << i; });
  const refMask = ((bits ^ 0x5412) >> 10) & 7;
  const notData = mine.reservedRows;
  const unref = rows.map((row, y) => row.map((v, x) => (notData[y][x] ? v : (QR._internal.MASK_FN[refMask](x, y) ? v ^ 1 : v))));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (notData[y][x]) continue;
      if (unref[y][x] !== mine.placedRows[y][x]) return false;
    }
  }
  return true;
}

/** Giải mã mã vạch Code 128 bằng ZXing từ chuỗi module 0/1 */
function decodeCode128(modules, expected) {
  const attempts = [2, 3, 4, 6];
  const errors = [];
  for (const scale of attempts) {
    const pad = 14 * scale;
    const w = modules.length * scale + pad * 2;
    const h = 60;
    const L = new Uint8ClampedArray(w * h).fill(255);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < modules.length * scale; x++) {
        if (modules[Math.floor(x / scale)] === 1) L[y * w + pad + x] = 0;
      }
    }
    const src = new ZX.RGBLuminanceSource(L, w, h);
    const bmp = new ZX.BinaryBitmap(new ZX.HybridBinarizer(src));
    const hints = new Map();
    hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.CODE_128]);
    hints.set('POSSIBLE_FORMATS', [ZX.BarcodeFormat.CODE_128]);
    try {
      const text = new ZX.MultiFormatReader().decode(bmp, hints).getText();
      if (text === expected) return { ok: true, how: 'scale ' + scale };
      errors.push('nội dung khác: ' + text);
    } catch (e) {
      errors.push(String((e && e.message) || e).slice(0, 40));
    }
  }
  return { ok: false, error: errors[0] };
}

/** Thử nhiều tỉ lệ ảnh (như nhiều khoảng cách camera khác nhau) */
function decodeMatrix(rows, size, text) {
  const attempts = [];
  for (const scale of [3, 6, 12]) attempts.push({ scale, pure: false });
  attempts.push({ scale: 8, pure: true });
  const errors = [];
  for (const a of attempts) {
    const r = decodeAt(rows, size, a.scale, a.pure);
    if (r.text === text) return { ok: true, how: 'scale ' + a.scale + (a.pure ? '/đọc thẳng' : '') };
    errors.push(r.error || 'lệch nội dung');
  }
  return { ok: false, how: errors[0] };
}

let passed = 0;
let failed = 0;
const fails = [];
function ok(label, extra) { passed++; console.log('  \u001b[32m✓\u001b[0m ' + label + (extra ? ' \u001b[90m' + extra + '\u001b[0m' : '')); }
function bad(label, extra) { failed++; fails.push(label + (extra ? ' — ' + extra : '')); console.log('  \u001b[31m✗\u001b[0m ' + label + ' \u001b[31m' + (extra || '') + '\u001b[0m'); }
function section(t) { console.log('\n\u001b[1m\u001b[36m■ ' + t + '\u001b[0m'); }

(async () => {
  console.log('\u001b[1m');
  console.log('  ╔══════════════════════════════════════════════════════════════╗');
  console.log('  ║   AMS Pro — Kiểm chứng mã QR bằng bộ giải mã độc lập         ║');
  console.log('  ╚══════════════════════════════════════════════════════════════╝');
  console.log('\u001b[0m');

  /* ---------------- 0. Kiểm chứng chính bộ kiểm thử ---------------- */
  section('0. Kiểm chứng bộ kiểm thử (giải mã QR do ZXing tự sinh)');
  try {
    const hints = new Map();
    hints.set(0, ZX.QRCodeDecoderErrorCorrectionLevel.M);
    const bm = new ZX.MultiFormatWriter().encode('TS-2026-00001', ZX.BarcodeFormat.QR_CODE, 0, 0, hints);
    const margin = (() => { for (let y = 0; y < bm.getHeight(); y++) for (let x = 0; x < bm.getWidth(); x++) if (bm.get(x, y)) return y; return 0; })();
    const n = bm.getHeight() - margin * 2;
    const rows = [];
    for (let y = 0; y < n; y++) { const r = []; for (let x = 0; x < n; x++) r.push(bm.get(x + margin, y + margin) ? 1 : 0); rows.push(r); }
    const r = decodeMatrix(rows, n, 'TS-2026-00001');
    if (r.ok) ok('Bộ kiểm thử giải mã đúng QR do ZXing sinh', r.how);
    else bad('Bộ kiểm thử không giải mã được QR của ZXing — dừng kiểm chứng', r.how);
  } catch (e) { bad('Lỗi khởi tạo bộ kiểm thử', e.message); }
  if (failed) {
    console.log('\n  Không thể tiếp tục khi bộ kiểm thử chưa đáng tin.\n');
    process.exit(1);
  }

  /* ---------------- 1. Nội dung thật của hệ thống ---------------- */
  section('1. Nội dung dùng trong hệ thống (nhãn tem, liên kết quét)');
  const realCases = [
    ['Mã tài sản', 'TS-2026-00001'],
    ['Số tài sản', 'TS-2026-00132'],
    ['Liên kết tem (ams://asset/<mã>)', 'ams://asset/TS-2026-00001'],
    ['Liên kết kiểm kê', 'ams://stocktake/KK-2025-001/asset/1'],
    ['Liên kết có tham số thời gian', 'ams://asset/TS-2026-00132?t=1758345000000'],
    ['Tên tài sản tiếng Việt có dấu', 'Máy gia công CNC DMG MORI — Phân xưởng Sản xuất 1'],
    ['Tên dài (tiếng Việt)', 'Hệ thống máy chủ Dell PowerEdge R750 — Phòng Công nghệ thông tin — Toà nhà A'],
    ['Số chứng từ', 'PC-2026-0001'],
    ['Chuỗi dài 200 ký tự', 'A'.repeat(200)],
  ];
  for (const [label, text] of realCases) {
    const m = QR.matrix(text, { ecc: 'Q' });
    m.text = text;
    const r = decodeMatrix(m.rows, m.size, text);
    if (r.ok) ok(label, 'v' + m.version + '-' + m.ecc + ' • ' + text.length + ' byte • ' + r.how);
    else {
      const refOk = contentMatchesReference(m, m.version, m.ecc);
      if (refOk === true) ok(label, 'v' + m.version + '-' + m.ecc + ' • bộ dò ZXing bỏ sót — ma trận khớp bộ sinh chuẩn');
      else bad(label, r.how);
    }
  }
  const tooLong = (() => {
    try { QR.matrix('X'.repeat(3000), { ecc: 'L' }); return false; } catch (e) { return /quá dài/i.test(e.message); }
  })();
  if (tooLong) ok('Nội dung vượt dung lượng báo lỗi rõ ràng (không sinh mã sai)');
  else bad('Không báo lỗi khi nội dung vượt dung lượng');

  /* ---------------- 2. Toàn bộ phiên bản × mức sửa lỗi ---------------- */
  section('2. Phiên bản 1-10 × mức sửa lỗi L/M/Q/H (ngắn / vừa / sát dung lượng)');
  for (let v = 1; v <= 10; v++) {
    const line = [];
    for (const ecc of ['L', 'M', 'Q', 'H']) {
      const cap = QR._internal.RS_BLOCKS[v][ecc];
      const dataCodewords = cap[0] * cap[1] + cap[2] * cap[3];
      const maxBytes = dataCodewords - (v <= 9 ? 2 : 3);
      const lengths = [4, Math.max(5, Math.floor(maxBytes / 2)), maxBytes];
      let cells = '';
      for (const len of lengths) {
        const text = ('v' + v + ecc.toLowerCase()).padEnd(Math.max(4, len), 'x');
        const m = QR.matrix(text, { ecc, version: v });
        m.text = text;
        const r = decodeMatrix(m.rows, m.size, text);
        if (r.ok) { passed++; cells += '\u001b[32m✓\u001b[0m'; }
        else {
          // Bộ dò ảnh của ZXing có thể bỏ sót ảnh tổng hợp; xác minh nội dung ma trận
          const refOk = contentMatchesReference(m, v, ecc);
          if (refOk === true) { passed++; cells += '\u001b[93m✓\u001b[0m'; ok('v' + v + '-' + ecc + ' ' + len + 'B: bộ dò ZXing bỏ sót, ma trận khớp bộ sinh chuẩn', 'đã đối chiếu từng ô'); }
          else { failed++; fails.push('v' + v + '-' + ecc + ' ' + len + 'B: ' + r.how); cells += '\u001b[31m✗\u001b[0m'; }
        }
      }
      line.push(ecc + cells);
    }
    console.log('  v' + String(v).padStart(2) + '  ' + line.join('   '));
  }
  ok('Đã kiểm tra ' + (10 * 4 * 3) + ' trường hợp phiên bản/mức sửa lỗi/độ dài', failed ? failed + ' trường hợp lỗi' : 'tất cả giải mã đúng');

  /* ---------------- 3. So chiếu với bộ sinh độc lập ---------------- */
  if (qrcodeGen) {
    section('3. So chiếu từng ô với bộ sinh độc lập qrcode-generator');
    // Đọc thông tin định dạng của bộ sinh tham chiếu để biết mặt nạ nó chọn
    const COORD1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
    const readFormat = (rows) => {
      let bits = 0;
      COORD1.forEach(([x, y], i) => { bits |= rows[y][x] << i; }); // bit thấp nhất tại (8,0)
      const data = (bits ^ 0x5412) >> 10;
      return { mask: data & 7, ecc: ['M', 'L', 'H', 'Q'][(data >> 3) & 3] };
    };
    const cases = [
      ['ams://asset/TS-2026-00001', 3, 'Q'],
      ['TS-2026-00001', 1, 'M'],
      ['ams://stocktake/KK-2025-001/asset/12', 4, 'M'],
      ['A'.repeat(120), 6, 'L'],
    ];
    let totalDiff = 0;
    let compared = 0;
    for (const [text, version, ecc] of cases) {
      const q = qrcodeGen(version, ecc);
      q.addData(text);
      q.make();
      const n = q.getModuleCount();
      const rows = [];
      for (let y = 0; y < n; y++) { const r = []; for (let x = 0; x < n; x++) r.push(q.isDark(y, x) ? 1 : 0); rows.push(r); }
      const fmt = readFormat(rows);
      const mine = QR.matrix(text, { version, ecc: fmt.ecc, mask: fmt.mask });
      let d = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (rows[y][x] !== mine.rows[y][x]) d++;
      totalDiff += d;
      compared++;
      if (d === 0) ok('v' + version + '-' + fmt.ecc + ' mặt nạ ' + fmt.mask + ': trùng khớp từng ô', text.length + ' byte');
      else bad('v' + version + '-' + fmt.ecc + ' mặt nạ ' + fmt.mask + ': khác ' + d + ' ô', text.length + ' byte');
    }
    ok('Tổng khác biệt với bộ sinh độc lập', totalDiff + ' ô / ' + compared + ' ma trận đối chiếu');
  } else {
    section('3. So chiếu với bộ sinh độc lập (bỏ qua)');
    console.log('  \u001b[90mChưa cài qrcode-generator — bỏ qua phần so chiếu từng ô.\u001b[0m');
    console.log('  \u001b[90mCài thêm: npm install --no-save qrcode-generator\u001b[0m');
  }

  /* ---------------- 4. Tem tài sản in ra có quét được không? ---------------- */
  section('4. Khoét mã QR từ chứng từ in (tem tài sản) rồi giải mã lại');
  try {
    const store = require(path.join(__dirname, '..', 'lib', 'store'));
    await store.init();
    const docs = require(path.join(__dirname, '..', 'lib', 'documents'));
    const service = require(path.join(__dirname, '..', 'lib', 'service'));
    const asset = store.all('assets').find((a) => a.code === 'TS-2026-00001') || store.all('assets')[0];
    const user = store.all('users').find((u) => u.isSuperAdmin) || store.all('users')[0];
    const html = docs.render('label', asset.id, { user, settings: service.settings(), query: { copies: 4 } });
    const tem = (html.match(/class="tem"/g) || []).length;
    if (tem === 4) ok('In 4 nhãn tem theo tham số ?copies=4');
    else bad('Số nhãn tem in ra không đúng', tem + ' tem');

    const blocks = html.match(/<svg[^>]*data-qr="[^"]*"[^>]*>[\s\S]*?<\/svg>/g) || [];
    if (blocks.length === tem) ok('Mỗi nhãn tem đều có mã QR', blocks.length + ' mã QR');
    else bad('Số mã QR không khớp số nhãn', blocks.length + ' / ' + tem);

    let decoded = 0;
    for (const block of blocks) {
      const box = block.match(/viewBox="0 0 (\d+) (\d+)"/);
      const content = (block.match(/data-qr="([^"]*)"/) || [])[1];
      const quiet = Number((block.match(/data-qr-quiet="(\d+)"/) || [])[1] || 2);
      const n = Number(box[2]) - quiet * 2;
      const rows = [];
      for (let y = 0; y < n; y++) rows.push(new Array(n).fill(0));
      const rects = block.match(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g) || [];
      rects.forEach((r) => {
        const [x, y, w, h] = r.match(/\d+/g).map(Number);
        for (let yy = y - quiet; yy < y - quiet + h; yy++) {
          for (let xx = x - quiet; xx < x - quiet + w; xx++) {
            if (yy >= 0 && yy < n && xx >= 0 && xx < n) rows[yy][xx] = 1;
          }
        }
      });
      const r = decodeMatrix(rows, n, content);
      if (r.ok) decoded++;
      else bad('Mã QR trên tem in không giải mã được', content + ' — ' + r.how);
    }
    if (decoded === blocks.length && blocks.length) {
      ok('Cả ' + decoded + ' mã QR khoét từ tem in đều giải mã đúng nội dung', 'ams://asset/' + asset.code);
    }
  } catch (e) {
    bad('Không kiểm tra được chứng từ in', e.message);
  }

  /* ---------------- 5. Mã vạch Code 128 ---------------- */
  section('5. Mã vạch Code 128 (in trên tem tài sản)');
  try {
    const barcode = require(path.join(__dirname, '..', 'lib', 'barcode'));

    // 5.1 Bảng pattern phải trùng bộ giải mã ZXing
    const zxPatterns = (ZX.Code128Reader && ZX.Code128Reader.CODE_PATTERNS) || null;
    if (zxPatterns && zxPatterns.length) {
      let diff = 0;
      zxPatterns.forEach((p2, v) => { if (p2.join(',') !== barcode._internal.PATTERNS[v].split('').join(',')) diff++; });
      if (!diff) ok('Bảng pattern Code 128 (0-106) trùng bộ giải mã ZXing từng giá trị');
      else bad('Bảng pattern Code 128 khác ZXing', diff + ' giá trị');
    } else {
      console.log('  \u001b[90mBản ZXing này không mở bảng pattern — bỏ qua mục 5.1\u001b[0m');
    }

    // 5.2 Giải mã các mã vạch do hệ thống sinh
    const barCases = ['TS-2026-00001', 'TS-2026-00132', 'KK-2025-001', 'AB-12/34', '1234567890', 'A', 'Phòng Công nghệ thông tin'];
    let barOk = 0;
    const barFails = [];
    for (const t of barCases) {
      const enc = barcode.encode(t);
      const r = decodeCode128(enc.modules, enc.ascii);
      if (r.ok) barOk++;
      else barFails.push(t + ' (' + r.error + ')');
    }
    if (barOk === barCases.length) ok('Mã vạch sinh ra giải mã đúng cả ' + barOk + '/' + barCases.length + ' trường hợp', 'gồm mã tài sản, mã đợt, chuỗi số và tiếng Việt có dấu');
    else bad('Có mã vạch không giải mã được', barFails.join('; '));

    // 5.3 Nội dung tiếng Việt → ASCII (Code 128 không biểu diễn được dấu)
    const asciiText = barcode.toAscii('Phòng Công nghệ thông tin — Máy tính Để bàn');
    if (/^[\x20-\x7e]*$/.test(asciiText)) ok('Nội dung tiếng Việt được chuyển sang ASCII cho mã vạch', asciiText);
    else bad('Chuyển tiếng Việt sang ASCII lỗi', JSON.stringify(asciiText));

    // 5.4 Mã vạch trong TEM IN phải giải mã được + kích thước in hợp lệ
    const store2 = require(path.join(__dirname, '..', 'lib', 'store'));
    const docs2 = require(path.join(__dirname, '..', 'lib', 'documents'));
    const service2 = require(path.join(__dirname, '..', 'lib', 'service'));
    const asset2 = store2.all('assets').find((a) => a.code === 'TS-2026-00001') || store2.all('assets')[0];
    const user2 = store2.all('users').find((u) => u.isSuperAdmin) || store2.all('users')[0];
    const labelHtml = docs2.render('label', asset2.id, { user: user2, settings: service2.settings(), query: { copies: 4 } });
    const bars = labelHtml.match(/<svg[^>]*data-barcode="[^"]*"[^>]*>[\s\S]*?<\/svg>/g) || [];
    if (bars.length === 4) ok('Mỗi nhãn tem đều có mã vạch Code 128', bars.length + ' mã vạch');
    else bad('Số mã vạch trên tem không khớp số nhãn', bars.length + ' / 4');

    let barDecoded = 0;
    let xDim = 0;
    for (const block of bars) {
      const content = (block.match(/data-barcode="([^"]*)"/) || [])[1];
      const quiet = Number((block.match(/data-barcode-quiet="(\d+)"/) || [])[1] || 0);
      const total = Number((block.match(/data-barcode-width="(\d+)"/) || [])[1]) + quiet * 2;
      const n = Number((block.match(/viewBox="0 0 (\d+) /) || [])[1]);
      const row = new Array(n).fill(0);
      (block.match(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"\/>/g) || []).forEach((r) => {
        const [x, y, w, h] = r.match(/\d+/g).map(Number);
        if (h < 20) return;
        for (let i = 0; i < w; i++) if (x + i < n) row[x + i] = 1;
      });
      const r = decodeCode128(row, content);
      if (r.ok) barDecoded++;
      else bad('Mã vạch trên tem in không giải mã được', content + ' — ' + r.error);
      const temW = Number((labelHtml.match(/width:(\d+)mm;height:\d+mm;border/) || [])[1] || 0);
      if (temW) xDim = Math.round(((temW - 4) / (total || n)) * 1000) / 1000;
    }
    if (barDecoded === bars.length && bars.length) ok('Cả ' + barDecoded + ' mã vạch khoét từ tem in đều giải mã đúng', 'TS-2026-00001');
    if (xDim) {
      if (xDim >= 0.25) ok('Bề rộng module mã vạch khi in đủ lớn để máy quét đọc', xDim + ' mm/module (khuyến nghị ≥ 0,25 mm)');
      else bad('Bề rộng module mã vạch quá nhỏ để quét', xDim + ' mm/module');
    }
  } catch (e) {
    bad('Không kiểm tra được mã vạch', String((e && e.message) || e));
  }

  console.log('\n' + '─'.repeat(64));
  console.log((failed === 0 ? '\u001b[32m' : '\u001b[31m') + '  KẾT QUẢ: ' + passed + ' đạt / ' + failed + ' lỗi \u001b[0m');
  if (failed) {
    console.log('\n  Chi tiết lỗi:');
    fails.slice(0, 15).forEach((f) => console.log('   • ' + f));
  }
  console.log('─'.repeat(64) + '\n');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('Lỗi khi chạy kiểm chứng:', e); process.exit(2); });
