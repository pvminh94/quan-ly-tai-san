#!/usr/bin/env node
'use strict';
/**
 * reset-seed.js — Xoá sạch CSDL và khởi tạo lại dữ liệu mẫu.
 *
 * Cách dùng:
 *   node server/tools/reset-seed.js              # sao lưu rồi reset + seed
 *   node server/tools/reset-seed.js --no-backup  # reset không sao lưu
 *   node server/tools/reset-seed.js --empty      # chỉ xoá trắng, không seed
 */

const path = require('path');
const store = require('../lib/store');
const seed = require('../seed');

const args = process.argv.slice(2);
const noBackup = args.includes('--no-backup');
const emptyOnly = args.includes('--empty');

function line(t) {
  console.log('\x1b[36m' + t + '\x1b[0m');
}

(async () => {
  await store.init();
  const before = store.snapshot();
  const names = Object.keys(before.collections || {});
  const total = names.reduce((s, k) => s + (before.collections[k] || []).length, 0);
  console.log('');
  line('  AMS Pro — Khởi tạo lại dữ liệu');
  console.log('  ─────────────────────────────────────────────');
  console.log('  CSDL:            ' + path.join(__dirname, '..', '..', 'data', 'db.json'));
  console.log('  Bản ghi hiện có: ' + total + ' (' + names.length + ' bảng)');

  if (!noBackup && total > 0) {
    const file = store.backup('reset-seed');
    console.log('  Đã sao lưu:      ' + file);
  }

  line('  → Đang xoá dữ liệu…');
  store.reset();
  console.log('  Đã xoá sạch.');

  if (!emptyOnly) {
    line('  → Đang tạo dữ liệu mẫu…');
    const t0 = Date.now();
    const res = await seed.run({ force: true });
    const rows = Object.keys(res.counts || {}).map((k) => ({ k, n: res.counts[k] }));
    rows.sort((a, b) => b.n - a.n);
    console.log('');
    console.log('  Kết quả (' + ((Date.now() - t0) / 1000).toFixed(2) + 's):');
    rows.forEach((r) => console.log('    • ' + r.k.padEnd(20, ' ') + String(r.n).padStart(6, ' ')));
    console.log('');
    console.log('  Tổng: ' + rows.reduce((s, r) => s + r.n, 0) + ' bản ghi trong ' + rows.length + ' bảng.');
    console.log('  Tài khoản mẫu: admin / Admin@123 • ketoan.truong, thukho, kythuat.01, nhanvien.01 / User@123');
  }

  store.flush();
  console.log('');
  console.log('  \x1b[32m✔ Hoàn tất.\x1b[0m Khởi động lại máy chủ: npm start');
  console.log('');
  process.exit(0);
})().catch((err) => {
  console.error('\x1b[31m✘ Lỗi:\x1b[0m ' + err.stack);
  process.exit(1);
});
