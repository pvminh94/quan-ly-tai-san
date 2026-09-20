'use strict';
/**
 * generate-pwa-icons.js — Sinh bộ biểu tượng PWA chuẩn (192, 512, maskable, favicon.svg)
 * Không dùng thư viện ngoài — chuẩn thuần Node.js với zlib.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'public');

function createPng(w, h, rgbaBuf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const body = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawRows = [];
  for (let y = 0; y < h; y++) {
    rawRows.push(Buffer.from([0])); // filter none
    rawRows.push(rgbaBuf.subarray(y * w * 4, (y + 1) * w * 4));
  }
  const idat = zlib.deflateSync(Buffer.concat(rawRows), { level: 9 });
  return Buffer.concat([sig, makeChunk('IHDR', ihdr), makeChunk('IDAT', idat), makeChunk('IEND', Buffer.alloc(0))]);
}

function renderIcon(size, isMaskable) {
  const buf = Buffer.alloc(size * size * 4, 0);
  function setPx(x, y, r, g, b, a) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const idx = (y * size + x) * 4;
    buf[idx] = r;
    buf[idx + 1] = g;
    buf[idx + 2] = b;
    buf[idx + 3] = a;
  }

  const rCorner = isMaskable ? 0 : Math.round(size * 0.22);
  const pad = isMaskable ? 0 : Math.round(size * 0.05);
  const x0 = pad, y0 = pad, x1 = size - pad, y1 = size - pad;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isMaskable) {
        let inside = false;
        if (x >= x0 && x < x1 && y >= y0 && y < y1) {
          const dx = x < x0 + rCorner ? (x0 + rCorner - x) : (x > x1 - rCorner ? (x - (x1 - rCorner)) : 0);
          const dy = y < y0 + rCorner ? (y0 + rCorner - y) : (y > y1 - rCorner ? (y - (y1 - rCorner)) : 0);
          if (dx * dx + dy * dy <= rCorner * rCorner) inside = true;
        }
        if (!inside) continue;
      }

      // Linear gradient: #1e40af (dark blue) -> #2563eb (royal blue) -> #38bdf8 (cyan accent)
      const t = (x + y) / (size * 2);
      const bgR = Math.round(30 * (1 - t) + 37 * t);
      const bgG = Math.round(64 * (1 - t) + 99 * t);
      const bgB = Math.round(175 * (1 - t) + 235 * t);
      setPx(x, y, bgR, bgG, bgB, 255);
    }
  }

  // Draw Letter "A" monogram & inventory badge in center
  const scale = size / 64;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / scale;
      const ny = y / scale;

      // Outer triangle of A: top (32, 16), left (18, 48), right (46, 48)
      let inA = false;
      if (ny >= 17 && ny <= 47) {
        const halfWidth = ((ny - 17) / (47 - 17)) * 14;
        if (Math.abs(nx - 32) <= halfWidth) {
          inA = true;
          // Inner triangle cutout
          if (ny >= 26 && ny <= 41) {
            const innerHW = ((ny - 26) / (41 - 26)) * 7;
            if (Math.abs(nx - 32) <= innerHW) inA = false;
          }
          // Bottom opening between legs
          if (ny > 41) {
            if (Math.abs(nx - 32) < 7) inA = false;
          }
        }
      }

      // Dot accent at top right (asset tracking tag)
      const ddx = nx - 46;
      const ddy = ny - 18;
      const inDot = (ddx * ddx + ddy * ddy) <= 16;

      if (inA) setPx(x, y, 255, 255, 255, 255);
      else if (inDot) setPx(x, y, 56, 189, 248, 255); // #38bdf8 cyan
    }
  }

  return createPng(size, size, buf);
}

function main() {
  console.log('[pwa-icons] Đang sinh các biểu tượng PWA...');
  if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e40af"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#grad)"/>
  <path d="M20 47 L32 17 L44 47 H37 L34.5 40 H29.5 L27 47 Z M30.8 35 H33.2 L32 28 Z" fill="#ffffff"/>
  <circle cx="46" cy="18" r="4" fill="#38bdf8"/>
</svg>`;

  fs.writeFileSync(path.join(PUBLIC_DIR, 'favicon.svg'), svg.trim());
  fs.writeFileSync(path.join(PUBLIC_DIR, 'icon-192.png'), renderIcon(192, false));
  fs.writeFileSync(path.join(PUBLIC_DIR, 'icon-512.png'), renderIcon(512, false));
  fs.writeFileSync(path.join(PUBLIC_DIR, 'icon-maskable.png'), renderIcon(512, true));

  console.log('[pwa-icons] Hoàn tất: favicon.svg, icon-192.png, icon-512.png, icon-maskable.png');
}

if (require.main === module) main();

module.exports = { main, renderIcon, createPng };
