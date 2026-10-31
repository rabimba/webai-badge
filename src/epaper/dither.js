// 4-Color BWYR ePaper Dithering & Warm-Gamut Preprocessing Engine
import { EPAPER_PALETTE, nearestPaletteIndex } from './codec.js';

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/**
 * Preprocess an RGBA buffer (width x height) for 4-color Black/White/Yellow/Red ePaper:
 * - Applies brightness, contrast, and unsharp-mask sharpness
 * - Blends RGB toward a warm BWYR gamut so neutral grays dither cleanly between Black & White
 *   while skin tones and warm accents map smoothly across White/Yellow/Red/Black.
 */
export function preprocessForBWYR(srcRgba, width, height, opts = {}) {
  const {
    contrast = 1.15,
    brightness = 1.0,
    warmthBlend = 0.60,
    sharpness = 0.35,
  } = opts;

  const total = width * height;
  const floatBuf = new Float32Array(total * 3);

  // Compute 1st/99th percentile luminance for gentle autocontrast
  const lums = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const r = srcRgba[i * 4];
    const g = srcRgba[i * 4 + 1];
    const b = srcRgba[i * 4 + 2];
    lums[i] = Math.min(255, Math.max(0, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
  }
  const hist = new Uint32Array(256);
  for (let i = 0; i < total; i++) hist[lums[i]]++;
  let low = 0, high = 255, acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= total * 0.01) { low = i; break; }
  }
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += hist[i];
    if (acc >= total * 0.01) { high = i; break; }
  }
  const span = Math.max(1, high - low);

  for (let i = 0; i < total; i++) {
    let r = ((srcRgba[i * 4] - low) * 255) / span;
    let g = ((srcRgba[i * 4 + 1] - low) * 255) / span;
    let b = ((srcRgba[i * 4 + 2] - low) * 255) / span;

    // Brightness & Contrast
    r = ((r * brightness - 128) * contrast) + 128;
    g = ((g * brightness - 128) * contrast) + 128;
    b = ((b * brightness - 128) * contrast) + 128;

    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));

    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const warmth = Math.max(0, Math.min(1, (r - b) / 255));

    const wr = warmthBlend * r + (1 - warmthBlend) * lum;
    const wg = warmthBlend * g + (1 - warmthBlend) * lum;
    const wb = warmthBlend * b + (1 - warmthBlend) * lum * (1 - 0.5 * warmth);

    floatBuf[i * 3] = wr;
    floatBuf[i * 3 + 1] = wg;
    floatBuf[i * 3 + 2] = wb;
  }

  // Optional 3x3 sharpening pass
  if (sharpness > 0.01) {
    const copy = new Float32Array(floatBuf);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 3;
        for (let c = 0; c < 3; c++) {
          const center = copy[idx + c];
          const neighbors =
            copy[((y - 1) * width + x) * 3 + c] +
            copy[((y + 1) * width + x) * 3 + c] +
            copy[(y * width + (x - 1)) * 3 + c] +
            copy[(y * width + (x + 1)) * 3 + c];
          const lap = center * 4 - neighbors;
          floatBuf[idx + c] = Math.max(0, Math.min(255, center + sharpness * 0.35 * lap));
        }
      }
    }
  }

  return floatBuf;
}

/**
 * Dither a preprocessed Float32 RGB buffer (width x height x 3) into a 4-color BWYR RGBA Uint8ClampedArray
 * @param {object} opts - { serpentine: boolean } — when true, alternate row scan direction
 *   (boustrophedon) to eliminate diagonal error-diffusion streak artifacts.
 */
export function ditherToBWYR(floatRgb, width, height, mode = 'atkinson', opts = {}) {
  const serpentine = opts.serpentine !== false;
  const work = new Float32Array(floatRgb);
  const outRgba = new Uint8ClampedArray(width * height * 4);

  if (mode === 'bayer4') {
    for (let y = 0; y < height; y++) {
      const bRow = BAYER_4X4[y & 3];
      const ltr = !serpentine || y % 2 === 0;
      for (let n = 0; n < width; n++) {
        const x = ltr ? n : width - 1 - n;
        const p = (y * width + x) * 3;
        const bias = (bRow[x & 3] / 16 - 0.5) * 42;
        const r = Math.max(0, Math.min(255, work[p] + bias));
        const g = Math.max(0, Math.min(255, work[p + 1] + bias));
        const b = Math.max(0, Math.min(255, work[p + 2] + bias));
        const idx = nearestPaletteIndex(r, g, b);
        const [pr, pg, pb] = EPAPER_PALETTE[idx];
        const dst = (y * width + x) * 4;
        outRgba[dst] = pr;
        outRgba[dst + 1] = pg;
        outRgba[dst + 2] = pb;
        outRgba[dst + 3] = 255;
      }
    }
    return outRgba;
  }

  const isFloyd = mode === 'floyd-steinberg';
  const isThreshold = mode === 'threshold';

  const addErr = (x, y, er, eg, eb, weight) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const p = (y * width + x) * 3;
    work[p] += er * weight;
    work[p + 1] += eg * weight;
    work[p + 2] += eb * weight;
  };

  for (let y = 0; y < height; y++) {
    const ltr = !serpentine || y % 2 === 0;
    for (let n = 0; n < width; n++) {
      const x = ltr ? n : width - 1 - n;
      const p = (y * width + x) * 3;
      const oldR = Math.max(0, Math.min(255, work[p]));
      const oldG = Math.max(0, Math.min(255, work[p + 1]));
      const oldB = Math.max(0, Math.min(255, work[p + 2]));

      const idx = nearestPaletteIndex(oldR, oldG, oldB);
      const [newR, newG, newB] = EPAPER_PALETTE[idx];

      const dst = (y * width + x) * 4;
      outRgba[dst] = newR;
      outRgba[dst + 1] = newG;
      outRgba[dst + 2] = newB;
      outRgba[dst + 3] = 255;

      if (isThreshold) continue;

      const er = oldR - newR;
      const eg = oldG - newG;
      const eb = oldB - newB;

      if (isFloyd) {
        // Error direction mirrors with scan direction on serpentine rows
        const dir = ltr ? 1 : -1;
        addErr(x + dir, y, er, eg, eb, 7 / 16);
        addErr(x - dir, y + 1, er, eg, eb, 3 / 16);
        addErr(x, y + 1, er, eg, eb, 5 / 16);
        addErr(x + dir, y + 1, er, eg, eb, 1 / 16);
      } else {
        // Default: Atkinson (diffuses 6/8 of error for crisp high-contrast ePaper midtones)
        const dir = ltr ? 1 : -1;
        const w = 1 / 8;
        addErr(x + dir, y, er, eg, eb, w);
        addErr(x + 2 * dir, y, er, eg, eb, w);
        addErr(x - dir, y + 1, er, eg, eb, w);
        addErr(x, y + 1, er, eg, eb, w);
        addErr(x + dir, y + 1, er, eg, eb, w);
        addErr(x, y + 2, er, eg, eb, w);
      }
    }
  }

  return outRgba;
}
