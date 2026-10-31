// Bit-exact 96,000-byte 2bpp .epaper <-> 480x800 upright RGBA ImageData codec + CRC32

export const EPAPER_PALETTE = [
  [0x00, 0x00, 0x00], // 0: Black (#000000)
  [0xff, 0xff, 0xff], // 1: White (#ffffff)
  [0xff, 0xcc, 0x33], // 2: Yellow (#ffcc33)
  [0xdb, 0x37, 0x27], // 3: Red (#db3727)
];

export const EPAPER_HEX = ['#000000', '#ffffff', '#ffcc33', '#db3727'];
export const EPAPER_NAMES = ['Carbon Black (00)', 'Paper White (01)', 'Amber Gold (10)', 'Signal Red (11)'];

// Standard IEEE 802.3 CRC32 (matches Espruino E.CRC32)
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function nearestPaletteIndex(r, g, b) {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < 4; i++) {
    const pr = EPAPER_PALETTE[i][0];
    const pg = EPAPER_PALETTE[i][1];
    const pb = EPAPER_PALETTE[i][2];
    const dr = r - pr;
    const dg = g - pg;
    const db = b - pb;
    const dist = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Decode 96,000-byte raw .epaper (800x480 landscape) into upright 480x800 RGBA Uint8ClampedArray
 * Rotation mapping: upright (x, y) where x in 0..479, y in 0..799 corresponds to
 * landscape (lx = 799 - y, ly = x).
 */
export function decodeEpaperToRGBA(epaperBytes) {
  if (epaperBytes.length !== 96000) {
    throw new Error(`Invalid .epaper size: expected 96000 bytes, got ${epaperBytes.length}`);
  }
  const rgba = new Uint8ClampedArray(480 * 800 * 4);
  for (let ly = 0; ly < 480; ly++) {
    const rowByteOffset = ly * 200; // 800 pixels / 4 pixels per byte = 200 bytes/row
    for (let bx = 0; bx < 200; bx++) {
      const byte = epaperBytes[rowByteOffset + bx];
      for (let sub = 0; sub < 4; sub++) {
        const lx = (bx << 2) | sub;
        const idx = (byte >> ((3 - sub) * 2)) & 3;
        const [r, g, b] = EPAPER_PALETTE[idx];
        // Upright coordinates: ux = ly, uy = 799 - lx
        const ux = ly;
        const uy = 799 - lx;
        const dst = (uy * 480 + ux) * 4;
        rgba[dst] = r;
        rgba[dst + 1] = g;
        rgba[dst + 2] = b;
        rgba[dst + 3] = 255;
      }
    }
  }
  return rgba;
}

/**
 * Encode upright 480x800 RGBA Uint8ClampedArray into 96,000-byte raw .epaper (800x480 landscape)
 */
export function encodeRGBAToEpaper(rgba) {
  const out = new Uint8Array(96000);
  const inkCounts = [0, 0, 0, 0];

  for (let ly = 0; ly < 480; ly++) {
    const rowByteOffset = ly * 200;
    for (let bx = 0; bx < 200; bx++) {
      let packed = 0;
      for (let sub = 0; sub < 4; sub++) {
        const lx = (bx << 2) | sub;
        const ux = ly;
        const uy = 799 - lx;
        const src = (uy * 480 + ux) * 4;
        const r = rgba[src];
        const g = rgba[src + 1];
        const b = rgba[src + 2];
        let idx = 0;
        if (r === 255 && g === 255 && b === 255) idx = 1;
        else if (r === 255 && g === 204 && b === 51) idx = 2;
        else if (r === 219 && g === 55 && b === 39) idx = 3;
        else if (r === 0 && g === 0 && b === 0) idx = 0;
        else idx = nearestPaletteIndex(r, g, b);

        inkCounts[idx]++;
        packed |= idx << ((3 - sub) * 2);
      }
      out[rowByteOffset + bx] = packed;
    }
  }
  return { bytes: out, crc: crc32(out), inkCounts };
}
