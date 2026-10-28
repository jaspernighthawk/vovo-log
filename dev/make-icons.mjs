// Renders the app icon (same design as web/icon.svg) to PNG without any
// dependencies. Run: node dev/make-icons.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BG = hex('#6e31ea');
const ARCS = [[166, hex('#d95f9b')], [116, hex('#74c3ef')], [66, hex('#ffffff')]]; // radius, colour (512 space)

function render(size) {
  const s = size / 512;
  const px = new Uint8Array(size * size * 4);
  const SS = 3; // supersampling
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
      const X = (x + (i + 0.5) / SS) / s, Y = (y + (j + 0.5) / SS) / s; // 512 space
      // rounded square, radius 120
      const cx = Math.min(Math.max(X, 120), 392), cy = Math.min(Math.max(Y, 120), 392);
      if (Math.hypot(X - cx, Y - cy) > 120) continue;
      let c = BG;
      if (Y <= 380) {
        const d = Math.hypot(X - 256, Y - 380);
        for (const [rad, col] of ARCS) if (Math.abs(d - rad) <= 15) { c = col; break; }
      } else {
        for (const [rad, col] of ARCS) if (Math.hypot(Math.abs(X - 256) - rad, Y - 380) <= 15) { c = col; break; } // round caps
      }
      r += c[0]; g += c[1]; b += c[2]; a += 255;
    }
    const n = SS * SS, o = (y * size + x) * 4;
    if (a) { px[o] = r / (a / 255); px[o + 1] = g / (a / 255); px[o + 2] = b / (a / 255); px[o + 3] = a / n; }
  }
  return px;
}

function png(size, px) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1); }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [512, 192, 180]) {
  fs.writeFileSync(path.join(WEB, `icon-${size}.png`), png(size, render(size)));
  console.log(`icon-${size}.png`);
}
