// Opt-In 4-Color BWYR Parametric Visual Layout & Procedural Backdrop Engine
// Strictly uses the 4 hardware ePaper inks: Black (#000000), White (#FFFFFF), Yellow (#FFCC33), Red (#DB3727).
// Inactive by default until the user triggers the AI Designer or selects an AI Visual Theme.

import { EPAPER_PALETTE } from './codec.js';

export const AI_LAYOUT_THEMES = {
  'cyber-pcb': {
    id: 'cyber-pcb',
    label: 'Cyber PCB Hacker',
    cardBg: '#000000',
    cardBorder: '#ffcc33',
    cardAccent: '#db3727',
    nameRgb: [255, 204, 51],
    companyRgb: [255, 255, 255],
    tagBg: '#db3727',
    tagFg: [255, 255, 255],
  },
  'sunburst-pop': {
    id: 'sunburst-pop',
    idLabel: 'Sunburst Pop Keynote',
    label: 'Sunburst Pop',
    cardBg: '#ffcc33',
    cardBorder: '#000000',
    cardAccent: '#db3727',
    nameRgb: [0, 0, 0],
    companyRgb: [219, 55, 39],
    tagBg: '#000000',
    tagFg: [255, 204, 51],
  },
  'bauhaus-grid': {
    id: 'bauhaus-grid',
    label: 'Bauhaus Grid',
    cardBg: '#ffffff',
    cardBorder: '#000000',
    cardAccent: '#db3727',
    nameRgb: [0, 0, 0],
    companyRgb: [219, 55, 39],
    tagBg: '#ffcc33',
    tagFg: [0, 0, 0],
  },
  'retro-terminal': {
    id: 'retro-terminal',
    label: 'Retro Terminal OS',
    cardBg: '#000000',
    cardBorder: '#ffffff',
    cardAccent: '#ffcc33',
    nameRgb: [255, 255, 255],
    companyRgb: [255, 204, 51],
    tagBg: '#ffcc33',
    tagFg: [0, 0, 0],
  },
  'editorial-minimal': {
    id: 'editorial-minimal',
    label: 'Editorial Minimal',
    cardBg: '#ffffff',
    cardBorder: '#ffcc33',
    cardAccent: '#000000',
    nameRgb: [0, 0, 0],
    companyRgb: [0, 0, 0],
    tagBg: '#000000',
    tagFg: [255, 255, 255],
  },
};

const INK_BLACK = EPAPER_PALETTE[0];  // [0, 0, 0]
const INK_WHITE = EPAPER_PALETTE[1];  // [255, 255, 255]
const INK_YELLOW = EPAPER_PALETTE[2]; // [255, 204, 51]
const INK_RED = EPAPER_PALETTE[3];    // [219, 55, 39]

function setPx(rgba, width, height, x, y, ink) {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const idx = (y * width + x) * 4;
  rgba[idx] = ink[0];
  rgba[idx + 1] = ink[1];
  rgba[idx + 2] = ink[2];
  rgba[idx + 3] = 255;
}

function fillRectRgba(rgba, width, height, rx, ry, rw, rh, ink) {
  const x0 = Math.max(0, Math.floor(rx));
  const y0 = Math.max(0, Math.floor(ry));
  const x1 = Math.min(width, Math.floor(rx + rw));
  const y1 = Math.min(height, Math.floor(ry + rh));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * width + x) * 4;
      rgba[idx] = ink[0];
      rgba[idx + 1] = ink[1];
      rgba[idx + 2] = ink[2];
      rgba[idx + 3] = 255;
    }
  }
}

/**
 * Generates a pure 4-color BWYR procedural backdrop as a Uint8ClampedArray (width * height * 4).
 * Zero anti-aliasing: every pixel is strictly one of the 4 hardware ePaper inks.
 */
export function renderProceduralBackdropRGBA(width, height, pattern = 'sunburst', accentInk = 'yellow') {
  const out = new Uint8ClampedArray(width * height * 4);
  const cx = width * 0.5;
  const cy = height * 0.42;
  const primaryInk = accentInk === 'red' ? INK_RED : accentInk === 'white' ? INK_WHITE : INK_YELLOW;
  const secondaryInk = accentInk === 'red' ? INK_YELLOW : INK_RED;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let ink = INK_BLACK;

      if (pattern === 'sunburst') {
        const dx = x - cx;
        const dy = y - cy;
        const angle = Math.atan2(dy, dx);
        const dist = Math.sqrt(dx * dx + dy * dy);
        const sector = Math.floor(((angle + Math.PI) / (Math.PI * 2)) * 24);
        if (dist < width * 0.16) {
          ink = INK_WHITE;
        } else if (sector % 3 === 0) {
          ink = primaryInk;
        } else if (sector % 3 === 1) {
          ink = secondaryInk;
        } else {
          ink = (x + y) % 2 === 0 ? INK_BLACK : INK_WHITE;
        }
      } else if (pattern === 'circuit') {
        // Dark PCB with crisp 4-ink yellow/red traces and solder pads
        ink = INK_BLACK;
        const gx = x % 32;
        const gy = y % 32;
        const cellX = Math.floor(x / 32);
        const cellY = Math.floor(y / 32);
        const hash = (cellX * 37 + cellY * 17) & 7;

        if ((gx === 16 && gy >= 6 && gy <= 26 && hash < 5) || (gy === 16 && gx >= 6 && gx <= 26 && hash >= 2)) {
          ink = hash % 2 === 0 ? INK_YELLOW : INK_RED;
        }
        // Diagonal 45-deg trace in select cells
        if (hash === 3 && Math.abs(gx - gy) <= 1) {
          ink = INK_YELLOW;
        }
        // Via pad rings
        const vdx = gx - 16;
        const vdy = gy - 16;
        const vr2 = vdx * vdx + vdy * vdy;
        if (vr2 <= 18 && vr2 >= 6) {
          ink = (cellX + cellY) % 2 === 0 ? INK_YELLOW : INK_RED;
        } else if (vr2 < 6) {
          ink = INK_WHITE;
        }
      } else if (pattern === 'halftone') {
        // Ordered 4-ink halftone dot gradient
        const ny = y / Math.max(1, height);
        const cell = 8;
        const lx = (x % cell) - cell / 2;
        const ly = (y % cell) - cell / 2;
        const r2 = lx * lx + ly * ly;
        const thresh = ny * 18;
        if (r2 < thresh * 0.45) {
          ink = INK_BLACK;
        } else if (r2 < thresh) {
          ink = secondaryInk;
        } else if (ny < 0.55) {
          ink = primaryInk;
        } else {
          ink = INK_WHITE;
        }
      } else if (pattern === 'bauhaus') {
        // Geometric Bauhaus color blocks + concentric quarter-circles
        const nx = x / Math.max(1, width);
        const ny = y / Math.max(1, height);
        const dTopLeft = Math.sqrt(x * x + y * y);
        const dBotRight = Math.sqrt((width - x) * (width - x) + (height - y) * (height - y));
        if (Math.abs(x - y * 0.95) < 4 || Math.abs(y - height * 0.5) < 3 || Math.abs(x - width * 0.68) < 3) {
          ink = INK_BLACK;
        } else if (dTopLeft < width * 0.42) {
          ink = Math.floor(dTopLeft / 18) % 2 === 0 ? INK_YELLOW : INK_RED;
        } else if (dBotRight < width * 0.46) {
          ink = INK_RED;
        } else if (nx > 0.68 && ny < 0.5) {
          ink = INK_YELLOW;
        } else {
          ink = INK_WHITE;
        }
      } else {
        // matrix-grid: horizon cyber grid + coordinate crosshairs
        ink = INK_BLACK;
        if (x % 24 === 0 || y % 24 === 0) {
          ink = (x / 24 + y / 24) % 2 === 0 ? INK_RED : INK_YELLOW;
        }
        if ((x % 48 === 12 && Math.abs((y % 48) - 12) <= 3) || (y % 48 === 12 && Math.abs((x % 48) - 12) <= 3)) {
          ink = INK_WHITE;
        }
      }

      setPx(out, width, height, x, y, ink);
    }
  }

  return out;
}

/**
 * Pure RGBA buffer compositor for unit testing and headless verification of AI Badge Layouts.
 * Guarantees 100% 4-ink hardware compliance and protects the bottom-left firmware counter zone.
 */
export function renderAiBadgeLayoutRGBA({ width = 480, height = 800, spec = {}, photoRgba = null }) {
  const out = new Uint8ClampedArray(width * height * 4);
  const theme = AI_LAYOUT_THEMES[spec.layoutTheme] || AI_LAYOUT_THEMES['cyber-pcb'];

  // 1. Outer background fill + geometric border rails
  fillRectRgba(out, width, height, 0, 0, width, height, INK_BLACK);
  const railInk = spec.accentInk === 'red' ? INK_RED : spec.accentInk === 'white' ? INK_WHITE : INK_YELLOW;

  // Outer 4px frame
  fillRectRgba(out, width, height, 8, 6, width - 16, 4, railInk);
  fillRectRgba(out, width, height, 8, height - 10, width - 16, 4, railInk);
  fillRectRgba(out, width, height, 8, 6, 4, height - 16, railInk);
  fillRectRgba(out, width, height, width - 12, 6, 4, height - 16, railInk);

  // 2. Photo Box (47, 17, 386x389)
  const bgRgba = renderProceduralBackdropRGBA(386, 389, spec.backdropPattern || 'circuit', spec.accentInk || 'yellow');
  for (let py = 0; py < 389; py++) {
    for (let px = 0; px < 386; px++) {
      const sIdx = (py * 386 + px) * 4;
      const hasFg = photoRgba && photoRgba[sIdx + 3] > 128;
      const src = hasFg ? photoRgba : bgRgba;
      setPx(out, width, height, 47 + px, 17 + py, [src[sIdx], src[sIdx + 1], src[sIdx + 2]]);
    }
  }

  // 3. Middle Identity Card (33, 430, 414x146)
  const cardInk =
    theme.cardBg === '#ffcc33'
      ? INK_YELLOW
      : theme.cardBg === '#ffffff'
        ? INK_WHITE
        : INK_BLACK;
  fillRectRgba(out, width, height, 33, 430, 414, 146, cardInk);
  fillRectRgba(out, width, height, 33, 430, 414, 5, INK_RED);

  // 4. Ensure bottom-left firmware counter safe zone (x=0..68, y=734..800) is clean dark contrast
  fillRectRgba(out, width, height, 0, 734, 68, 66, INK_BLACK);

  return out;
}

/**
 * Dilates the cutout foreground alpha mask by `radius` pixels and paints a pure
 * 4-ink outline ring (die-cut sticker border) between subject and backdrop.
 * Foreground pixels (alpha >= 96) keep their original RGB; ring pixels become outlineInk.
 */
export function dilateAlphaMaskOutline(rgba, width, height, radius = 3, outlineInk = [255, 255, 255]) {
  const out = new Uint8ClampedArray(rgba); // copy
  const isFg = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    isFg[i] = rgba[i * 4 + 3] >= 96 ? 1 : 0;
  }

  // Multi-pass 8-neighborhood (Chebyshev) dilation for a square sticker ring
  let grown = Uint8Array.from(isFg);
  for (let pass = 0; pass < radius; pass++) {
    const next = Uint8Array.from(grown);
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(height - 1, y + 1);
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (grown[i]) continue;
        const x0 = Math.max(0, x - 1);
        const x2 = Math.min(width - 1, x + 1);
        let neighbor = false;
        for (let ny = y0; ny <= y1 && !neighbor; ny++) {
          for (let nx = x0; nx <= x2; nx++) {
            if (grown[ny * width + nx]) {
              neighbor = true;
              break;
            }
          }
        }
        if (neighbor) next[i] = 1;
      }
    }
    grown = next;
  }

  for (let i = 0; i < width * height; i++) {
    if (grown[i] && !isFg[i]) {
      out[i * 4] = outlineInk[0];
      out[i * 4 + 1] = outlineInk[1];
      out[i * 4 + 2] = outlineInk[2];
      out[i * 4 + 3] = 255;
    }
  }
  return out;
}

/**
 * Opt-in AI theme parity overlay descriptor for the 2nd Screen (programme.epaper).
 * Returns null when aiLayout is disabled/classic so the default template stays untouched.
 */
export function composeAiSecondScreenOverlay(aiLayout) {
  if (!aiLayout || !aiLayout.enabled) return null;
  const theme = AI_LAYOUT_THEMES[aiLayout.layoutTheme] || AI_LAYOUT_THEMES['cyber-pcb'];
  const accentHex =
    aiLayout.accentInk === 'red' ? '#db3727' : aiLayout.accentInk === 'white' ? '#ffffff' : '#ffcc33';
  return {
    borderColor: theme.cardBorder,
    cardBg: theme.cardBg,
    cardAccent: theme.cardAccent,
    accentHex,
    headerBadge: aiLayout.headerBadge || '',
    tags: Array.isArray(aiLayout.tags) ? aiLayout.tags.slice(0, 2) : [],
    themeId: theme.id,
  };
}

/**
 * Draws the opt-in AI Visual Layout frame, header pill, themed middle card, and skill tags
 * onto the 480x800 badge canvas when `state.aiLayout?.enabled` is true.
 */
export function drawAiPrimaryLayoutCanvas(ctx, state, helpers) {
  const { roundedRectPath, drawCrispTextLayer, PHOTO_BOX, NAME_CARD } = helpers;
  const spec = state.aiLayout;
  if (!spec || !spec.enabled) return;

  const theme = AI_LAYOUT_THEMES[spec.layoutTheme] || AI_LAYOUT_THEMES['cyber-pcb'];
  const accentHex =
    spec.accentInk === 'red' ? '#db3727' : spec.accentInk === 'white' ? '#ffffff' : '#ffcc33';
  const secondaryHex = spec.accentInk === 'red' ? '#ffcc33' : '#db3727';

  ctx.save();

  // 1. Theme-specific full-canvas architectural framing around photo & cards
  if (spec.layoutTheme === 'bauhaus-grid') {
    // Asymmetric Bauhaus color blocks along margins outside PHOTO_BOX (47..433)
    ctx.fillStyle = '#db3727';
    ctx.fillRect(12, 16, 22, 390);
    ctx.fillStyle = '#ffcc33';
    ctx.fillRect(446, 180, 22, 396);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(12, 428, 12, 150);
    roundedRectPath(ctx, PHOTO_BOX.x - 3, PHOTO_BOX.y - 3, PHOTO_BOX.w + 6, PHOTO_BOX.h + 6, PHOTO_BOX.radius + 2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000000';
    ctx.stroke();
  } else if (spec.layoutTheme === 'cyber-pcb') {
    // PCB corner fiducials + trace rails along left/right edges
    ctx.strokeStyle = accentHex;
    ctx.lineWidth = 3;
    // Left & right trace rails
    ctx.beginPath();
    ctx.moveTo(18, 28);
    ctx.lineTo(18, 412);
    ctx.lineTo(32, 426);
    ctx.moveTo(462, 28);
    ctx.lineTo(462, 412);
    ctx.lineTo(448, 426);
    ctx.stroke();

    // Solder pad nodes
    for (const [vx, vy] of [[18, 28], [18, 210], [462, 28], [462, 210]]) {
      ctx.fillStyle = secondaryHex;
      ctx.beginPath();
      ctx.arc(vx, vy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(vx, vy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (spec.layoutTheme === 'sunburst-pop') {
    // Bold double-border frame around photo box
    roundedRectPath(ctx, PHOTO_BOX.x - 6, PHOTO_BOX.y - 6, PHOTO_BOX.w + 12, PHOTO_BOX.h + 12, PHOTO_BOX.radius + 4);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#db3727';
    ctx.stroke();
    roundedRectPath(ctx, PHOTO_BOX.x - 2, PHOTO_BOX.y - 2, PHOTO_BOX.w + 4, PHOTO_BOX.h + 4, PHOTO_BOX.radius + 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffcc33';
    ctx.stroke();
  } else if (spec.layoutTheme === 'retro-terminal') {
    roundedRectPath(ctx, PHOTO_BOX.x - 4, PHOTO_BOX.y - 4, PHOTO_BOX.w + 8, PHOTO_BOX.h + 8, 12);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  } else if (spec.layoutTheme === 'editorial-minimal') {
    roundedRectPath(ctx, PHOTO_BOX.x - 3, PHOTO_BOX.y - 3, PHOTO_BOX.w + 6, PHOTO_BOX.h + 6, PHOTO_BOX.radius + 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  // 2. Top Header Banner Pill (overlaid cleanly at top of Photo Box y=14..46)
  if (spec.headerBadge) {
    const pillW = 316;
    const pillH = 30;
    const pillX = Math.round((480 - pillW) / 2);
    const pillY = 14;

    roundedRectPath(ctx, pillX, pillY, pillW, pillH, 10);
    ctx.fillStyle = '#000000';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = accentHex;
    ctx.stroke();

    drawCrispTextLayer(
      ctx,
      480,
      800,
      (tctx) => {
        tctx.textAlign = 'center';
        tctx.textBaseline = 'middle';
        tctx.font = '800 15px "JetBrains Mono", monospace';
        tctx.fillText(spec.headerBadge.slice(0, 26), 240, pillY + pillH / 2 + 1);
      },
      spec.accentInk === 'white' ? [255, 255, 255] : [255, 204, 51],
      null
    );
  }

  // 3. Custom Middle Identity Card (x=33, y=430, w=414, h=146)
  // Neo-brutalist offset shadow in secondary ink
  roundedRectPath(ctx, NAME_CARD.x + 5, NAME_CARD.y + 5, NAME_CARD.w, NAME_CARD.h, NAME_CARD.radius);
  ctx.fillStyle = theme.cardAccent;
  ctx.fill();

  roundedRectPath(ctx, NAME_CARD.x, NAME_CARD.y, NAME_CARD.w, NAME_CARD.h, NAME_CARD.radius);
  ctx.fillStyle = theme.cardBg;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = theme.cardBorder;
  ctx.stroke();

  // Top accent stripe inside card for retro-terminal / bauhaus-grid
  if (spec.layoutTheme === 'retro-terminal' || spec.layoutTheme === 'cyber-pcb') {
    ctx.fillStyle = accentHex;
    ctx.fillRect(NAME_CARD.x + 22, NAME_CARD.y + 10, NAME_CARD.w - 44, 4);
  }

  // Name & Company Typography inside themed card
  const hasTags = Array.isArray(spec.tags) && spec.tags.length > 0;
  const nameY = hasTags ? 468 : 480;
  const compY = hasTags ? 510 : 532;

  drawCrispTextLayer(
    ctx,
    480,
    800,
    (tctx) => {
      tctx.textAlign = 'center';
      tctx.textBaseline = 'middle';
      const nameText = (state.name || 'Rabimba Karanjai').trim();
      const nameSize = nameText.length > 20 ? 29 : nameText.length > 16 ? 33 : 37;
      tctx.font = `800 ${nameSize}px "Space Grotesk", "Helvetica Neue", Arial, sans-serif`;
      tctx.fillText(nameText, 240, nameY);
    },
    theme.nameRgb,
    null
  );

  const compText = (state.company || '').trim();
  if (compText) {
    drawCrispTextLayer(
      ctx,
      480,
      800,
      (tctx) => {
        tctx.textAlign = 'center';
        tctx.textBaseline = 'middle';
        const compSize = compText.length > 24 ? 20 : 24;
        tctx.font = `700 ${compSize}px "Space Grotesk", "Helvetica Neue", Arial, sans-serif`;
        tctx.fillText(compText, 240, compY);
      },
      theme.companyRgb,
      null
    );
  }

  // 4. Skill / Topic Pill Tags at bottom of Middle Card (y=536..566)
  if (hasTags) {
    const tags = spec.tags.slice(0, 2);
    const pillW = 148;
    const pillH = 26;
    const gap = 14;
    const totalW = tags.length * pillW + (tags.length - 1) * gap;
    const startX = Math.round(240 - totalW / 2);
    const pillY = 540;

    tags.forEach((tag, idx) => {
      const px = startX + idx * (pillW + gap);
      roundedRectPath(ctx, px, pillY, pillW, pillH, 8);
      ctx.fillStyle = theme.tagBg;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = theme.cardBorder;
      ctx.stroke();

      drawCrispTextLayer(
        ctx,
        480,
        800,
        (tctx) => {
          tctx.textAlign = 'center';
          tctx.textBaseline = 'middle';
          tctx.font = '800 13px "JetBrains Mono", monospace';
          tctx.fillText(String(tag).slice(0, 14), px + pillW / 2, pillY + pillH / 2 + 1);
        },
        theme.tagFg,
        null
      );
    });
  }

  // 5. Protect bottom-left firmware counter safe zone (0..68, 734..800)
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 734, 68, 66);

  ctx.restore();
}
