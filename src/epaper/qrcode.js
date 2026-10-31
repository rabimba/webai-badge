// Self-contained ISO/IEC 18004 QR Code Matrix Generator (Versions 1..10, EC Level L & M, Byte Mode)
// Zero external dependencies — renders crisp 1-bit pixel-aligned QR codes for ePaper displays.

// Capacities (data codewords) and EC codewords per block for EC Level M (0) and L (1)
// Format: [version]: { totalCodewords, ecPerBlock, blocksG1, dataPerBlockG1, blocksG2, dataPerBlockG2 }
const VERSION_TABLE_M = [
  null,
  { total: 26, ec: 10, g1: 1, d1: 16, g2: 0, d2: 0 },   // v1 (21x21) - up to 14 bytes
  { total: 44, ec: 16, g1: 1, d1: 28, g2: 0, d2: 0 },   // v2 (25x25) - up to 26 bytes
  { total: 70, ec: 26, g1: 1, d1: 44, g2: 0, d2: 0 },   // v3 (29x29) - up to 42 bytes
  { total: 100, ec: 18, g1: 2, d1: 32, g2: 0, d2: 0 },  // v4 (33x33) - up to 62 bytes
  { total: 134, ec: 24, g1: 2, d1: 43, g2: 0, d2: 0 },  // v5 (37x37) - up to 84 bytes
  { total: 172, ec: 16, g1: 4, d1: 27, g2: 0, d2: 0 },  // v6 (41x41) - up to 106 bytes
  { total: 196, ec: 18, g1: 4, d1: 31, g2: 0, d2: 0 },  // v7 (45x45) - up to 122 bytes
  { total: 242, ec: 22, g1: 2, d1: 38, g2: 2, d2: 39 }, // v8 (49x49) - up to 152 bytes
  { total: 292, ec: 22, g1: 3, d1: 36, g2: 2, d2: 37 }, // v9 (53x53) - up to 180 bytes
  { total: 346, ec: 26, g1: 4, d1: 43, g2: 1, d2: 44 }, // v10 (57x57) - up to 213 bytes
];

const VERSION_TABLE_L = [
  null,
  { total: 26, ec: 7, g1: 1, d1: 19, g2: 0, d2: 0 },
  { total: 44, ec: 10, g1: 1, d1: 34, g2: 0, d2: 0 },
  { total: 70, ec: 15, g1: 1, d1: 55, g2: 0, d2: 0 },
  { total: 100, ec: 20, g1: 1, d1: 80, g2: 0, d2: 0 },
  { total: 134, ec: 26, g1: 1, d1: 108, g2: 0, d2: 0 },
  { total: 172, ec: 18, g1: 2, d1: 68, g2: 0, d2: 0 },
  { total: 196, ec: 20, g1: 2, d1: 78, g2: 0, d2: 0 },
  { total: 242, ec: 24, g1: 2, d1: 97, g2: 0, d2: 0 },
  { total: 292, ec: 30, g1: 2, d1: 116, g2: 0, d2: 0 },
  { total: 346, ec: 18, g1: 2, d1: 68, g2: 2, d2: 69 },
];

const ALIGNMENT_COORDS = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

// GF(256) tables with primitive polynomial 0x11D
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

function bchFormatBits(ecLevelBits, maskPattern) {
  const data = (ecLevelBits << 3) | maskPattern;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function bchVersionBits(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >> i) & 1) rem ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | rem;
}

export function encodeQRMatrix(text, ecLevel = 'M') {
  const utf8 = new TextEncoder().encode(text);
  const table = ecLevel === 'L' ? VERSION_TABLE_L : VERSION_TABLE_M;
  const ecBits = ecLevel === 'L' ? 0b01 : 0b00; // L=01, M=00

  let version = 1;
  while (version <= 10) {
    const spec = table[version];
    const dataCap = spec.g1 * spec.d1 + spec.g2 * spec.d2;
    const lenBits = version <= 9 ? 8 : 16;
    const maxBytes = Math.floor((dataCap * 8 - 4 - lenBits) / 8);
    if (utf8.length <= maxBytes) break;
    version++;
  }
  if (version > 10) {
    // Fallback to L if M overflowed
    if (ecLevel !== 'L') return encodeQRMatrix(text, 'L');
    throw new Error('QR text too long (max ~270 bytes)');
  }

  const spec = table[version];
  const dataCap = spec.g1 * spec.d1 + spec.g2 * spec.d2;
  const bits = [];
  const pushBits = (val, count) => {
    for (let i = count - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };

  // Byte mode indicator (0100)
  pushBits(0b0100, 4);
  pushBits(utf8.length, version <= 9 ? 8 : 16);
  for (const b of utf8) pushBits(b, 8);

  // Terminator (up to 4 zeros)
  const maxBits = dataCap * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataBytes = new Uint8Array(dataCap);
  for (let i = 0; i < bits.length / 8; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
    dataBytes[i] = b;
  }
  const padBytes = [0xec, 0x11];
  for (let i = bits.length / 8, p = 0; i < dataCap; i++, p ^= 1) {
    dataBytes[i] = padBytes[p];
  }

  // Split into blocks and compute RS error correction
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let i = 0; i < spec.g1; i++) {
    const blk = dataBytes.slice(offset, offset + spec.d1);
    offset += spec.d1;
    dataBlocks.push(blk);
    ecBlocks.push(rsEncode(blk, spec.ec));
  }
  for (let i = 0; i < spec.g2; i++) {
    const blk = dataBytes.slice(offset, offset + spec.d2);
    offset += spec.d2;
    dataBlocks.push(blk);
    ecBlocks.push(rsEncode(blk, spec.ec));
  }

  const interleaved = [];
  const maxDataLen = Math.max(spec.d1, spec.d2);
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of dataBlocks) {
      if (i < blk.length) interleaved.push(blk[i]);
    }
  }
  for (let i = 0; i < spec.ec; i++) {
    for (const blk of ecBlocks) {
      interleaved.push(blk[i]);
    }
  }

  const size = 17 + version * 4;
  const grid = Array.from({ length: size }, () => new Uint8Array(size));
  const isFunc = Array.from({ length: size }, () => new Uint8Array(size));

  const setFunc = (r, c, val) => {
    grid[r][c] = val ? 1 : 0;
    isFunc[r][c] = 1;
  };

  // Finder patterns + separators
  const drawFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr, c = c0 + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onRing = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunc(r, c, inOuter && (onRing || inCenter));
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const align = ALIGNMENT_COORDS[version];
  for (const r0 of align) {
    for (const c0 of align) {
      if (
        (r0 === 6 && c0 === 6) ||
        (r0 === 6 && c0 === size - 7) ||
        (r0 === size - 7 && c0 === 6)
      ) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunc(r0 + dr, c0 + dc, dark);
        }
      }
    }
  }

  // Reserve format info & dark module
  for (let i = 0; i <= 8; i++) {
    if (!isFunc[8][i]) setFunc(8, i, false);
    if (!isFunc[i][8]) setFunc(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    setFunc(8, size - 1 - i, false);
    setFunc(size - 1 - i, 8, false);
  }
  setFunc(size - 8, 8, true); // Dark module

  if (version >= 7) {
    const vbits = bchVersionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((vbits >> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunc(a, b, bit);
      setFunc(b, a, bit);
    }
  }

  // Place data bits in upward/downward 2-column zig-zag
  let bitIdx = 0;
  const totalBits = interleaved.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!isFunc[r][c]) {
          let bit = 0;
          if (bitIdx < totalBits) {
            bit = (interleaved[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
            bitIdx++;
          }
          grid[r][c] = bit;
        }
      }
    }
    upward = !upward;
  }

  // Evaluate all 8 masks and pick lowest penalty
  const maskFns = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  const writeFormatBits = (mGrid, maskIdx) => {
    const fbits = bchFormatBits(ecBits, maskIdx);
    // Bits 0..5 -> mGrid[0..5][8], bit 6 -> mGrid[7][8], bit 7 -> mGrid[8][8], bit 8 -> mGrid[8][7], bits 9..14 -> mGrid[8][14 - i]
    for (let i = 0; i <= 5; i++) mGrid[i][8] = (fbits >> i) & 1;
    mGrid[7][8] = (fbits >> 6) & 1;
    mGrid[8][8] = (fbits >> 7) & 1;
    mGrid[8][7] = (fbits >> 8) & 1;
    for (let i = 9; i < 15; i++) mGrid[8][14 - i] = (fbits >> i) & 1;

    // Top-right: bits 0..7 -> mGrid[8][size - 1 - i]
    for (let i = 0; i < 8; i++) mGrid[8][size - 1 - i] = (fbits >> i) & 1;
    // Bottom-left: bits 8..14 -> mGrid[size - 15 + i][8] reversed: bit 8 at size-7 .. bit 14 at size-1
    for (let i = 8; i < 15; i++) mGrid[size - 1 - (14 - i)][8] = (fbits >> i) & 1;
  };

  let bestGrid = null;
  let bestPenalty = Infinity;

  for (let m = 0; m < 8; m++) {
    const mGrid = grid.map((row) => new Uint8Array(row));
    const fn = maskFns[m];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!isFunc[r][c] && fn(r, c)) mGrid[r][c] ^= 1;
      }
    }
    writeFormatBits(mGrid, m);

    // Compute basic run-length & 2x2 box penalty
    let penalty = 0;
    for (let r = 0; r < size; r++) {
      let run = 1;
      for (let c = 1; c < size; c++) {
        if (mGrid[r][c] === mGrid[r][c - 1]) {
          run++;
          if (run === 5) penalty += 3;
          else if (run > 5) penalty += 1;
        } else run = 1;
      }
    }
    for (let c = 0; c < size; c++) {
      let run = 1;
      for (let r = 1; r < size; r++) {
        if (mGrid[r][c] === mGrid[r - 1][c]) {
          run++;
          if (run === 5) penalty += 3;
          else if (run > 5) penalty += 1;
        } else run = 1;
      }
    }
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = mGrid[r][c];
        if (v === mGrid[r][c + 1] && v === mGrid[r + 1][c] && v === mGrid[r + 1][c + 1]) {
          penalty += 3;
        }
      }
    }
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestGrid = mGrid;
    }
  }

  return { size, version, modules: bestGrid };
}

export function buildVCardPayload({ name, company, url, email }) {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${(name || '').trim()}`,
  ];
  if (company && company.trim()) lines.push(`ORG:${company.trim()}`);
  if (email && email.trim()) lines.push(`EMAIL:${email.trim()}`);
  if (url && url.trim()) lines.push(`URL:${url.trim()}`);
  lines.push('END:VCARD');
  return lines.join('\n');
}

export function buildWiFiPayload({ ssid, password, encryption = 'WPA' }) {
  const esc = (s) => (s || '').replace(/([\\;,:])/g, '\\$1');
  return `WIFI:T:${encryption};S:${esc(ssid)};P:${esc(password)};;`;
}
