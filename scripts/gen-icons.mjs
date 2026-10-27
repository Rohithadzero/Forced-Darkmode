// Renders the toolbar/store icons (crescent on a rounded dark tile) to public/icons/*.png.
// No dependencies: 4x4 supersampled rasterizer + minimal PNG encoder.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');
mkdirSync(out, { recursive: true });

const TILE = [30, 31, 34];
const MOON = [236, 236, 238];
const SS = 4;

function coverage(x, y) {
  // Unit coordinates 0..1. Returns [tileAlpha, moonAlpha].
  const r = 0.22;
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0);
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
  const inTile = dx * dx + dy * dy <= r * r;
  const inA = (x - 0.5) ** 2 + (y - 0.5) ** 2 <= 0.3 ** 2;
  const inB = (x - 0.63) ** 2 + (y - 0.39) ** 2 <= 0.25 ** 2;
  return [inTile ? 1 : 0, inTile && inA && !inB ? 1 : 0];
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let tile = 0;
      let moon = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [t, m] = coverage((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          tile += t;
          moon += m;
        }
      }
      tile /= SS * SS;
      moon /= SS * SS;
      const mix = tile > 0 ? moon / tile : 0;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(TILE[c] * (1 - mix) + MOON[c] * mix);
      px[i + 3] = Math.round(tile * 255);
    }
  }
  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) writeFileSync(resolve(out, `${size}.png`), png(size, render(size)));
console.log('icons → public/icons');
