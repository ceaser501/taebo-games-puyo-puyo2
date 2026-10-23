// Readers for Puyo Puyo 2 (Windows 95, Korean) data and a tiny PNG writer.
//
//   *.CNS  picture: LZ-compressed bitmap with a 16- or 256-colour palette
//   *.GCM  picture: a plain BMP under another name
//   *.WLK  sound bank: raw PCM clips
//   *.MLK  music bank: standard MIDI files back to back
//
// The CNS decoder follows the game's own routine (PUYO2W95.EXE 0x423b90 unpacks, 0x40c960 reads
// the bitmap).
import zlib from 'node:zlib';

// LZ77 with one control byte per step (c, then its operands):
//   c = 0           end
//   c >= 0x80       ((c >> 4) & 7) literal bytes, then copy (c & 15) + 2 bytes from distance u8
//   0x00-0x0f       copy (c & 15) + 2 bytes from distance u8
//   0x10-0x1f       copy (c & 15) + 2 bytes from distance u16
//   0x20-0x2f       copy ((c & 15) << 8 | u8) bytes from distance u8
//   0x30-0x3f       copy ((c & 15) << 8 | u8) bytes from distance u16
//   0x40-0x5f       (c & 31) literal bytes
//   0x60-0x7f       ((c & 31) << 8 | u8) literal bytes
// Copies run forward one byte at a time, so they may overlap what they write.
export function unpackCns(src) {
  const out = [];
  let i = 0;
  const u8 = () => src[i++];
  const u16 = () => { const v = src[i] | (src[i + 1] << 8); i += 2; return v; };
  const literal = (n) => { for (let k = 0; k < n; k++) out.push(src[i++]); };
  for (;;) {
    const c = u8();
    if (c === 0 || c === undefined) break;
    let len, dist;
    if (c >= 0x80) { literal((c >> 4) & 7); dist = u8(); len = (c & 15) + 2; }
    else if (c < 0x10) { len = (c & 15) + 2; dist = u8(); }
    else if (c < 0x20) { len = (c & 15) + 2; dist = u16(); }
    else if (c < 0x30) { len = ((c & 15) << 8) | u8(); dist = u8(); }
    else if (c < 0x40) { len = ((c & 15) << 8) | u8(); dist = u16(); }
    else if (c < 0x60) { literal(c & 31); continue; }
    else { literal(((c & 31) << 8) | u8()); continue; }
    const from = out.length - dist;
    for (let k = 0; k < len; k++) out.push(out[from + k]);
  }
  return Buffer.from(out);
}

// Unpacked CNS:
//   u16 0, u16 width, u16 height, u16 colours - 1, then colours x (B, G, R, 0),
//   then the rows bottom-up: two pixels per byte (high nibble first) up to 16 colours, else one.
// Returns palette indices top-down plus the palette as [r, g, b] triples.
export function readCns(buf) {
  const b = unpackCns(buf);
  const width = b.readUInt16LE(2), height = b.readUInt16LE(4), colours = b.readUInt16LE(6) + 1;
  const palette = [];
  for (let k = 0; k < colours; k++) palette.push([b[8 + k * 4 + 2], b[8 + k * 4 + 1], b[8 + k * 4]]);
  const px = 8 + colours * 4;
  const index = new Uint8Array(width * height);
  const packed = colours <= 16;
  const pitch = packed ? width / 2 : width;
  for (let y = 0; y < height; y++) {
    const row = px + (height - 1 - y) * pitch;
    for (let x = 0; x < width; x++) {
      index[y * width + x] = packed ? (b[row + (x >> 1)] >> (x & 1 ? 0 : 4)) & 15 : b[row + x];
    }
  }
  return { width, height, palette, index };
}

// 8-bit BMP (GCM files).
export function readBmp(buf) {
  const off = buf.readUInt32LE(10), width = buf.readInt32LE(18), h = buf.readInt32LE(22);
  const height = Math.abs(h), bits = buf.readUInt16LE(28);
  if (bits !== 8) throw new Error(`BMP with ${bits} bits per pixel`);
  const used = buf.readUInt32LE(46) || 256;
  const pal = 14 + buf.readUInt32LE(14);
  const palette = [];
  for (let k = 0; k < used; k++) palette.push([buf[pal + k * 4 + 2], buf[pal + k * 4 + 1], buf[pal + k * 4]]);
  const pitch = (width + 3) & ~3;
  const index = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = off + (h > 0 ? height - 1 - y : y) * pitch;
    index.set(buf.subarray(row, row + width), y * width);
  }
  return { width, height, palette, index };
}

// Palette picture to RGBA; `key` is a palette index drawn transparent (or -1 for none).
export function toRgba({ width, height, palette, index }, key = -1) {
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < index.length; p++) {
    const i = index[p];
    if (i === key) continue;
    const c = palette[i] || [0, 0, 0];
    rgba.set(c, p * 4);
    rgba[p * 4 + 3] = 255;
  }
  return rgba;
}

export function crop(rgba, width, x, y, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) out.set(rgba.subarray(((y + r) * width + x) * 4, ((y + r) * width + x + w) * 4), r * w * 4);
  return out;
}

// Scale2x (EPX): doubles a picture and rounds off staircase edges by copying a neighbour where
// two neighbours agree. Twice gives 4x; drawn back down with smoothing, the pixel art keeps its
// look but loses the jagged outlines.
export function scale2x(rgba, width, height) {
  const w2 = width * 2;
  const out = new Uint8Array(w2 * height * 2 * 4);
  const v = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height);
  const o = new Uint32Array(out.buffer);
  const at = (x, y) => v[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = at(x, y), a = at(x, y - 1), b = at(x + 1, y), c = at(x - 1, y), d = at(x, y + 1);
      let e0 = p, e1 = p, e2 = p, e3 = p;
      if (a !== d && c !== b) {
        if (c === a) e0 = a;
        if (a === b) e1 = b;
        if (d === c) e2 = c;
        if (b === d) e3 = d;
      }
      const q = y * 2 * w2 + x * 2;
      o[q] = e0; o[q + 1] = e1; o[q + w2] = e2; o[q + w2 + 1] = e3;
    }
  }
  return out;
}

// Sound bank: u16 count - 1, then per clip u16 flags, u32 offset, u32 size, u32 sample rate.
// Clips are mono 16-bit PCM.
export function readWlk(buf) {
  const n = buf.readUInt16LE(0) + 1;
  const clips = [];
  for (let k = 0; k < n; k++) {
    const p = 2 + k * 14;
    const offset = buf.readUInt32LE(p + 2), size = buf.readUInt32LE(p + 6), rate = buf.readUInt32LE(p + 10);
    clips.push({ rate, pcm: buf.subarray(offset, offset + size) });
  }
  return clips;
}

export function encodeWav({ rate, pcm }) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8, 'latin1');
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36, 'latin1'); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// Music bank: u8 count, then per song u8 loops (1 = repeat), u32 offset, u32 size.
export function readMlk(buf) {
  const n = buf[0];
  const songs = [];
  for (let k = 0; k < n; k++) {
    const p = 1 + k * 9;
    const offset = buf.readUInt32LE(p + 1), size = buf.readUInt32LE(p + 5);
    songs.push({ loop: buf[p] === 1, midi: buf.subarray(offset, offset + size) });
  }
  return songs;
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
