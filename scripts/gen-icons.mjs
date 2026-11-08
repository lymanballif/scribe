import zlib from "node:zlib";
import fs from "node:fs";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function icon(size, { transparent = false } = {}) {
  const px = Buffer.alloc(size * 4 * size);
  const r = size * 0.22;
  const inRound = (x, y) => {
    const cx = Math.min(Math.max(x, r), size - r);
    const cy = Math.min(Math.max(y, r), size - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const lines = [0.44, 0.44, 0.28];
  const lh = Math.round(size * 0.052);
  const gap = Math.round(size * 0.085);
  const y0 = Math.round(size * 0.5 - (lines.length * lh + (lines.length - 1) * gap) / 2);
  const x0 = Math.round(size * 0.28);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let col = transparent && !inRound(x, y) ? null : [22, 22, 22];
      if (col) {
        for (let l = 0; l < lines.length; l++) {
          const w = Math.round(size * lines[l]);
          const ly = y0 + l * (lh + gap);
          if (x >= x0 && x < x0 + w && y >= ly && y < ly + lh) col = [255, 255, 255];
        }
      }
      if (col) { px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = 255; }
    }
  }
  return png(size, px);
}

fs.mkdirSync("public", { recursive: true });
fs.writeFileSync("public/icon-192.png", icon(192, { transparent: true }));
fs.writeFileSync("public/icon-512.png", icon(512, { transparent: true }));
fs.writeFileSync("public/icon-maskable-512.png", icon(512));
fs.writeFileSync("public/apple-touch-icon.png", icon(180));
console.log("icons written to public/");
