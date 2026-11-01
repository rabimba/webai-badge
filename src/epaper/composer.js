// 480x800 ePaper Badge & 2nd-Screen (programme.epaper) Canvas Composer
// Produces both the raw 4-color BWYR ImageData for .epaper encoding and the simulated hardware preview
// (which shows the firmware's dynamic bottom-left person icon + Roman/Arabic/Hex/Binary connection counter).

import { EPAPER_PALETTE, nearestPaletteIndex, encodeRGBAToEpaper } from './codec.js';
import { preprocessForBWYR, ditherToBWYR } from './dither.js';
import { encodeQRMatrix, buildVCardPayload, buildWiFiPayload } from './qrcode.js';
import { formatCounterPreview } from './bootcde-patcher.js';
import {
  renderProceduralBackdropRGBA,
  drawAiPrimaryLayoutCanvas,
  dilateAlphaMaskOutline,
  composeAiSecondScreenOverlay,
} from './ai-layout.js';

// Re-export so tests and consumers can access the AI 2nd-screen overlay descriptor
export { composeAiSecondScreenOverlay, dilateAlphaMaskOutline } from './ai-layout.js';

export const PHOTO_BOX = { x: 47, y: 17, w: 386, h: 389, radius: 30 };
export const NAME_CARD = { x: 33, y: 430, w: 414, h: 146, radius: 26 };

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Draws crisp 1-bit thresholded text onto an existing ImageData buffer so Canvas anti-aliasing
 * never introduces unwanted red/yellow fringe around black or white typography.
 */
function drawCrispTextLayer(targetCtx, width, height, drawCallback, fgRgb = [0, 0, 0], shadowRgb = null) {
  const off = document.createElement('canvas');
  off.width = width;
  off.height = height;
  const octx = off.getContext('2d');

  if (shadowRgb) {
    octx.clearRect(0, 0, width, height);
    octx.fillStyle = '#ffffff';
    drawCallback(octx, true);
    const sData = octx.getImageData(0, 0, width, height).data;
    const dstImg = targetCtx.getImageData(0, 0, width, height);
    const d = dstImg.data;
    for (let i = 0; i < width * height; i++) {
      if (sData[i * 4 + 3] > 110) {
        d[i * 4] = shadowRgb[0];
        d[i * 4 + 1] = shadowRgb[1];
        d[i * 4 + 2] = shadowRgb[2];
        d[i * 4 + 3] = 255;
      }
    }
    targetCtx.putImageData(dstImg, 0, 0);
  }

  octx.clearRect(0, 0, width, height);
  octx.fillStyle = '#ffffff';
  drawCallback(octx, false);
  const fData = octx.getImageData(0, 0, width, height).data;
  const dstImg = targetCtx.getImageData(0, 0, width, height);
  const d = dstImg.data;
  for (let i = 0; i < width * height; i++) {
    if (fData[i * 4 + 3] > 118) {
      d[i * 4] = fgRgb[0];
      d[i * 4 + 1] = fgRgb[1];
      d[i * 4 + 2] = fgRgb[2];
      d[i * 4 + 3] = 255;
    }
  }
  targetCtx.putImageData(dstImg, 0, 0);
}

/**
 * Draws a crisp pixel-aligned QR code onto targetCtx at (centerX, topY)
 */
export function drawCrispQR(targetCtx, payload, { centerX = 240, topY = 582, boxSize = 4, border = 2 } = {}) {
  if (!payload || !payload.trim()) return { bottomY: topY };
  const qr = encodeQRMatrix(payload.trim(), 'M');
  const quietModules = qr.size + border * 2;
  const qrPx = quietModules * boxSize;
  const cardPad = 6;
  const cardW = qrPx + cardPad * 2;
  const cardH = qrPx + cardPad * 2;
  const cardX = Math.round(centerX - cardW / 2);
  const cardY = Math.round(topY);

  // Outer rounded white card with 2px black border
  targetCtx.save();
  roundedRectPath(targetCtx, cardX, cardY, cardW, cardH, 10);
  targetCtx.fillStyle = '#ffffff';
  targetCtx.fill();
  targetCtx.lineWidth = 2;
  targetCtx.strokeStyle = '#000000';
  targetCtx.stroke();
  targetCtx.restore();

  // Exact pixel-snapped modules
  const qrX0 = cardX + cardPad + border * boxSize;
  const qrY0 = cardY + cardPad + border * boxSize;
  const imgData = targetCtx.getImageData(0, 0, 480, 800);
  const d = imgData.data;

  // Ensure quiet zone is pure white
  for (let py = cardY + 3; py < cardY + cardH - 3; py++) {
    for (let px = cardX + 3; px < cardX + cardW - 3; px++) {
      if (px >= 0 && px < 480 && py >= 0 && py < 800) {
        const idx = (py * 480 + px) * 4;
        d[idx] = 255;
        d[idx + 1] = 255;
        d[idx + 2] = 255;
        d[idx + 3] = 255;
      }
    }
  }

  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      const dark = qr.modules[r][c] === 1;
      const val = dark ? 0 : 255;
      const startX = qrX0 + c * boxSize;
      const startY = qrY0 + r * boxSize;
      for (let dy = 0; dy < boxSize; dy++) {
        for (let dx = 0; dx < boxSize; dx++) {
          const px = startX + dx;
          const py = startY + dy;
          if (px >= 0 && px < 480 && py >= 0 && py < 800) {
            const idx = (py * 480 + px) * 4;
            d[idx] = val;
            d[idx + 1] = val;
            d[idx + 2] = val;
            d[idx + 3] = 255;
          }
        }
      }
    }
  }

  targetCtx.putImageData(imgData, 0, 0);
  return { cardX, cardY, cardW, cardH, bottomY: cardY + cardH, version: qr.version, modulesCount: qr.size };
}

/**
 * Quantizes every pixel of an ImageData strictly to the 4 hardware ePaper inks
 */
export function snapImageDataToPalette(imgData) {
  const d = imgData.data;
  const total = imgData.width * imgData.height;
  for (let i = 0; i < total; i++) {
    const r = d[i * 4];
    const g = d[i * 4 + 1];
    const b = d[i * 4 + 2];
    const idx = nearestPaletteIndex(r, g, b);
    const [pr, pg, pb] = EPAPER_PALETTE[idx];
    d[i * 4] = pr;
    d[i * 4 + 1] = pg;
    d[i * 4 + 2] = pb;
    d[i * 4 + 3] = 255;
  }
  return imgData;
}

/**
 * Renders the top photo box (386x389) from a source image with zoom, pan, optional AI segmentation, and 4-color dithering
 */
export function renderDitheredPhotoBox(sourceImage, backdropImage, state) {
  const { w, h } = PHOTO_BOX;
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = w;
  cropCanvas.height = h;
  const cctx = cropCanvas.getContext('2d');

  const useAiBackdrop =
    state.aiLayout?.enabled &&
    state.aiLayout.backdropPattern &&
    state.aiLayout.backdropPattern !== 'orig';

  let procBgRgba = null;
  if (useAiBackdrop) {
    procBgRgba = renderProceduralBackdropRGBA(
      w,
      h,
      state.aiLayout.backdropPattern,
      state.aiLayout.accentInk || 'yellow'
    );
    cctx.putImageData(new ImageData(procBgRgba, w, h), 0, 0);
  } else if (backdropImage) {
    // Fill with WebAI geometric sunburst backdrop first (visible when AI background removal is active or zoomed out)
    cctx.drawImage(backdropImage, 0, 0, w, h);
  } else {
    cctx.fillStyle = '#ffcc33';
    cctx.fillRect(0, 0, w, h);
  }

  const imgToDraw = state.useAiCutout && state.segmentedCanvas ? state.segmentedCanvas : sourceImage;
  let fgAlphaMask = null;
  if (imgToDraw) {
    const sw = imgToDraw.naturalWidth || imgToDraw.width || w;
    const sh = imgToDraw.naturalHeight || imgToDraw.height || h;
    const baseScale = Math.max(w / sw, h / sh);
    const scale = baseScale * (state.zoom || 1.0);
    const drawW = sw * scale;
    const drawH = sh * scale;
    const dx = (w - drawW) / 2 + (state.panX || 0) * w;
    const dy = (h - drawH) / 2 + (state.panY || 0) * h;
    cctx.drawImage(imgToDraw, dx, dy, drawW, drawH);

    if (useAiBackdrop && state.useAiCutout && state.segmentedCanvas) {
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = w;
      maskCanvas.height = h;
      const mctx = maskCanvas.getContext('2d');
      mctx.drawImage(imgToDraw, dx, dy, drawW, drawH);
      fgAlphaMask = mctx.getImageData(0, 0, w, h).data;
    }
  }

  const rawRgba = cctx.getImageData(0, 0, w, h).data;
  const floatRgb = preprocessForBWYR(rawRgba, w, h, {
    contrast: state.contrast ?? 1.15,
    brightness: state.brightness ?? 1.0,
    warmthBlend: state.warmthBlend ?? 0.60,
    sharpness: state.sharpness ?? 0.35,
  });
  const ditheredRgba = ditherToBWYR(floatRgb, w, h, state.ditherMode || 'atkinson');

  // Preserve crisp 4-ink procedural backdrop pixels where cutout mask is transparent
  if (procBgRgba && fgAlphaMask) {
    for (let i = 0; i < w * h; i++) {
      if (fgAlphaMask[i * 4 + 3] < 96) {
        ditheredRgba[i * 4] = procBgRgba[i * 4];
        ditheredRgba[i * 4 + 1] = procBgRgba[i * 4 + 1];
        ditheredRgba[i * 4 + 2] = procBgRgba[i * 4 + 2];
        ditheredRgba[i * 4 + 3] = 255;
      }
    }
  }

  // Die-cut sticker outline ring between subject and 4-ink backdrop
  if (fgAlphaMask && (state.stickerOutline ?? true)) {
    const accent = state.aiLayout?.enabled ? state.aiLayout.accentInk : 'white';
    const outlineInk =
      accent === 'red' ? [219, 55, 39] : accent === 'yellow' ? [255, 204, 51] : [255, 255, 255];
    const outlined = dilateAlphaMaskOutline(ditheredRgba, w, h, 3, outlineInk);
    ditheredRgba.set(outlined);
  }

  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  const octx = outCanvas.getContext('2d');
  octx.putImageData(new ImageData(ditheredRgba, w, h), 0, 0);
  return outCanvas;
}

/**
 * Resolves the active QR payload string from state
 */
export function resolveQRPayload(state) {
  if (!state.qrEnabled || state.qrMode === 'off') return '';
  if (state.qrMode === 'vcard') {
    return buildVCardPayload({
      name: state.name,
      company: state.company,
      url: state.qrUrl,
      email: state.qrEmail,
    });
  }
  if (state.qrMode === 'wifi') {
    return buildWiFiPayload({
      ssid: state.wifiSsid,
      password: state.wifiPassword,
      encryption: state.wifiEnc || 'WPA',
    });
  }
  return state.qrUrl || 'https://www.linkedin.com/in/rabimba/';
}

/**
 * Composes the complete 480x800 badge.epaper image and returns:
 * - rawCanvas: 480x800 canvas containing the exact pixels to encode into badge.epaper
 * - previewCanvas: 480x800 canvas including the simulated firmware person icon + connection counter overlay
 * - encoded: { bytes, crc, inkCounts }
 */
export function composePrimaryBadge(assets, state) {
  const rawCanvas = document.createElement('canvas');
  rawCanvas.width = 480;
  rawCanvas.height = 800;
  const ctx = rawCanvas.getContext('2d');

  // Choose base template: keep original crisp Rabimba Karanjai / PayPal GDE middle card if unchanged
  const aiActive = Boolean(state.aiLayout?.enabled);
  const isDefaultIdentity =
    !aiActive &&
    !state.forceCustomCard &&
    state.name.trim() === 'Rabimba Karanjai' &&
    state.company.trim() === 'PayPal / GDE';

  const baseTemplate = isDefaultIdentity && assets.rabimbaBase ? assets.rabimbaBase : assets.cleanBase;
  if (baseTemplate) {
    ctx.drawImage(baseTemplate, 0, 0, 480, 800);
  } else {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 480, 800);
  }

  // 1. Top Photo Box (47, 17, 386x389, radius 30)
  const photoCanvas = renderDitheredPhotoBox(assets.currentPhoto, assets.photoBackdrop, state);
  ctx.save();
  roundedRectPath(ctx, PHOTO_BOX.x, PHOTO_BOX.y, PHOTO_BOX.w, PHOTO_BOX.h, PHOTO_BOX.radius);
  ctx.clip();
  ctx.drawImage(photoCanvas, PHOTO_BOX.x, PHOTO_BOX.y);
  ctx.restore();

  // 2. Opt-in AI Visual Layout OR Default Middle Name / Company Card
  if (aiActive) {
    drawAiPrimaryLayoutCanvas(ctx, state, {
      roundedRectPath,
      drawCrispTextLayer,
      PHOTO_BOX,
      NAME_CARD,
    });
  } else if (!isDefaultIdentity) {
    drawCrispTextLayer(
      ctx,
      480,
      800,
      (tctx) => {
        tctx.textAlign = 'center';
        tctx.textBaseline = 'middle';
        const nameText = state.name.trim() || 'Attendee Name';
        const nameSize = nameText.length > 20 ? 30 : nameText.length > 16 ? 34 : 38;
        tctx.font = `800 ${nameSize}px "Space Grotesk", "Helvetica Neue", Arial, sans-serif`;
        tctx.fillText(nameText, 240, 480);

        const compText = state.company.trim();
        if (compText) {
          const compSize = compText.length > 24 ? 22 : 28;
          tctx.font = `700 ${compSize}px "Space Grotesk", "Helvetica Neue", Arial, sans-serif`;
          tctx.fillText(compText, 240, 534);
        }
      },
      [0, 0, 0],
      null
    );
  }

  // 3. Scannable QR Code Card (below middle card, above bottom handle)
  const qrPayload = resolveQRPayload(state);
  let qrMeta = null;
  if (qrPayload) {
    // Choose optimal module pixel size so QR fits comfortably in y=580..720
    const testQr = encodeQRMatrix(qrPayload, 'M');
    const boxSize = testQr.size <= 29 ? 4 : testQr.size <= 37 ? 3 : 2;
    qrMeta = drawCrispQR(ctx, qrPayload, { centerX: 240, topY: 582, boxSize, border: 2 });
  }

  // 4. Bottom Handle (@rabimba)
  const handleText = (state.handle || '').trim();
  if (handleText) {
    const handleY = qrPayload ? 758 : 736;
    const handleSize = qrPayload ? 40 : 48;
    drawCrispTextLayer(
      ctx,
      480,
      800,
      (tctx, isShadow) => {
        tctx.textAlign = 'center';
        tctx.textBaseline = 'middle';
        tctx.font = `800 ${handleSize}px "Space Grotesk", "Helvetica Neue", Arial, sans-serif`;
        const ox = isShadow ? 2 : 0;
        const oy = isShadow ? 2 : 0;
        tctx.fillText(handleText, 240 + ox, handleY + oy);
      },
      [255, 255, 255],
      [0, 0, 0]
    );
  }

  // Strictly snap rawCanvas to the 4 hardware colors and encode 96,000-byte .epaper
  const rawImgData = snapImageDataToPalette(ctx.getImageData(0, 0, 480, 800));
  ctx.putImageData(rawImgData, 0, 0);
  const encoded = encodeRGBAToEpaper(rawImgData.data);

  // Build simulated hardware preview canvas (adds the dynamic firmware overlay at bottom-left)
  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = 480;
  previewCanvas.height = 800;
  const pctx = previewCanvas.getContext('2d');
  pctx.drawImage(rawCanvas, 0, 0);

  drawSimulatedFirmwareCounter(pctx, state.connectionCount ?? 14, state.counterFormat || 'roman');

  return { rawCanvas, previewCanvas, encoded, qrMeta };
}

/**
 * Draws the exact bottom-left person icon + formatted counter as rendered by Espruino showBadge()
 */
export function drawSimulatedFirmwareCounter(ctx, count, format = 'roman') {
  // Draw white person silhouette at x=8..40, y=759..794
  ctx.save();
  ctx.fillStyle = '#ffffff';
  // Head circle
  ctx.beginPath();
  ctx.arc(24, 768, 6.5, 0, Math.PI * 2);
  ctx.fill();
  // Shoulders rounded arch
  ctx.beginPath();
  ctx.arc(24, 790, 12.5, Math.PI, 0, false);
  ctx.closePath();
  ctx.fill();

  const label = formatCounterPreview(count, format);
  if (label) {
    ctx.font = '700 21px "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width;
    const cx = Math.max(24, Math.floor(w / 2) + 6);
    ctx.textAlign = 'center';
    // Black outline for legibility over textured corner
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(label, cx, 744);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, cx, 744);
  }
  ctx.restore();
}

/**
 * Composes the 2nd Screen (programme.epaper, toggled by BTN1 on the physical badge)
 */
export function composeSecondScreen(assets, state) {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 800;
  const ctx = canvas.getContext('2d');

  // Background frame
  if (assets.cleanBase) {
    ctx.drawImage(assets.cleanBase, 0, 0);
  } else {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 480, 800);
  }

  const tpl = state.secondScreenTemplate || 'speaker';
  // Opt-in AI theme parity: when active, programme.epaper carries the 4-ink theme styling
  const aiOverlay = composeAiSecondScreenOverlay(state.aiLayout);

  const themedRect = (x, y, w2, h2, radius, fill, borderColor, borderWidth = 4) => {
    roundedRectPath(ctx, x, y, w2, h2, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    if (borderColor) {
      ctx.lineWidth = borderWidth;
      ctx.strokeStyle = borderColor;
      ctx.stroke();
    }
  };

  if (tpl === 'poster') {
    // Full-bleed 4-color dithered photo across the entire 480x800 screen with bottom badge bar
    const w = 480, h = 800;
    const temp = document.createElement('canvas');
    temp.width = w;
    temp.height = h;
    const tctx = temp.getContext('2d');
    const src = assets.currentPhoto;
    if (src) {
      const sw = src.naturalWidth || src.width || w;
      const sh = src.naturalHeight || src.height || h;
      const scale = Math.max(w / sw, h / sh) * (state.zoom || 1.0);
      const dw = sw * scale;
      const dh = sh * scale;
      tctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
    const floatRgb = preprocessForBWYR(tctx.getImageData(0, 0, w, h).data, w, h, {
      contrast: 1.18,
      brightness: 1.0,
      warmthBlend: 0.62,
      sharpness: 0.4,
    });
    const dithered = ditherToBWYR(floatRgb, w, h, state.ditherMode || 'atkinson');
    ctx.putImageData(new ImageData(dithered, w, h), 0, 0);

    // Bottom title bar
    roundedRectPath(ctx, 28, 668, 424, 104, 20);
    ctx.fillStyle = '#000000';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffcc33';
    ctx.stroke();

    drawCrispTextLayer(
      ctx,
      480,
      800,
      (octx) => {
        octx.textAlign = 'center';
        octx.textBaseline = 'middle';
        octx.font = '800 30px "Space Grotesk", sans-serif';
        octx.fillText(state.name || 'Rabimba Karanjai', 240, 704);
        octx.font = '700 22px "Space Grotesk", sans-serif';
        octx.fillText(`${state.company || 'PayPal / GDE'}  •  ${state.handle || '@rabimba'}`, 240, 742);
      },
      [255, 204, 51]
    );
  } else if (tpl === 'schedule') {
    // WebAI Summit Agenda / Schedule Card
    themedRect(32, 24, 416, 744, 26, aiOverlay ? aiOverlay.cardBg : '#000000', aiOverlay ? aiOverlay.borderColor : '#ffcc33', 4);

    // Header pill
    themedRect(52, 46, 376, 86, 18, aiOverlay ? aiOverlay.cardAccent : '#db3727', null);

    drawCrispTextLayer(
      ctx,
      480,
      800,
      (octx) => {
        octx.textAlign = 'center';
        octx.textBaseline = 'middle';
        octx.font = '800 28px "Space Grotesk", sans-serif';
        octx.fillText(
          aiOverlay?.headerBadge ? aiOverlay.headerBadge.slice(0, 22) : 'WEBAI SUMMIT 2026',
          240,
          76
        );
        octx.font = '700 18px "JetBrains Mono", monospace';
        octx.fillText('BTN1 SECOND SCREEN • LIVE AGENDA', 240, 108);
      },
      aiOverlay && aiOverlay.themeId === 'retro-terminal' ? [255, 204, 51] : [255, 255, 255]
    );

    const items = [
      ['09:30', 'Opening Keynote: WebGPU & Local Agents'],
      ['10:45', 'On-Device Multimodal Models in Chrome'],
      ['12:15', 'Hardware Lab: Espruino ePaper Badge'],
      ['14:00', state.secondScreenTalk || 'Scaling WebAI in Production (PayPal / GDE)'],
      ['15:30', 'Lightning Demos & Badge Mesh Sync'],
      ['17:00', 'Closing Panel & Community Social'],
    ];

    let y = 175;
    for (let i = 0; i < items.length; i++) {
      const [time, title] = items[i];
      const highlight = i === 3;
      roundedRectPath(ctx, 52, y - 24, 376, 74, 14);
      ctx.fillStyle = highlight ? '#ffcc33' : '#ffffff';
      ctx.fill();

      drawCrispTextLayer(
        ctx,
        480,
        800,
        (octx) => {
          octx.textAlign = 'left';
          octx.textBaseline = 'middle';
          octx.font = '800 19px "JetBrains Mono", monospace';
          octx.fillText(time, 68, y);
          octx.font = '700 18px "Space Grotesk", sans-serif';
          octx.fillText(title.slice(0, 32), 68, y + 26);
        },
        [0, 0, 0]
      );
      y += 92;
    }
  } else {
    // Default: Speaker & Contact Card (Giant scannable QR in top frame + Talk Title + Socials)
    themedRect(PHOTO_BOX.x, PHOTO_BOX.y, PHOTO_BOX.w, PHOTO_BOX.h, PHOTO_BOX.radius, '#ffffff', aiOverlay ? aiOverlay.borderColor : '#000000', 4);

    const payload = resolveQRPayload(state) || 'https://www.linkedin.com/in/rabimba/';
    drawCrispQR(ctx, payload, { centerX: 240, topY: 42, boxSize: 9, border: 2 });

    drawCrispTextLayer(
      ctx,
      480,
      800,
      (octx) => {
        octx.textAlign = 'center';
        octx.textBaseline = 'middle';
        octx.font = '800 22px "JetBrains Mono", monospace';
        octx.fillText('SCAN TO CONNECT ON LINKEDIN', 240, 378);
      },
      aiOverlay && aiOverlay.themeId === 'retro-terminal' ? [255, 204, 51] : [219, 55, 39]
    );

    // Middle Card: Name & Talk/Bio
    drawCrispTextLayer(
      ctx,
      480,
      800,
      (octx) => {
        octx.textAlign = 'center';
        octx.textBaseline = 'middle';
        octx.font = '800 34px "Space Grotesk", sans-serif';
        octx.fillText(state.name || 'Rabimba Karanjai', 240, 474);
        octx.font = '700 24px "Space Grotesk", sans-serif';
        octx.fillText(state.company || 'PayPal / GDE', 240, 518);
        octx.font = '700 18px "JetBrains Mono", monospace';
        octx.fillText(state.secondScreenTalk || 'WebAI Summit Speaker & Hardware Hacker', 240, 554);
      },
      [0, 0, 0]
    );

    // Bottom handle
    drawCrispTextLayer(
      ctx,
      480,
      800,
      (octx, isShadow) => {
        octx.textAlign = 'center';
        octx.textBaseline = 'middle';
        octx.font = '800 44px "Space Grotesk", sans-serif';
        octx.fillText(state.handle || '@rabimba', 240 + (isShadow ? 2 : 0), 735 + (isShadow ? 2 : 0));
      },
      [255, 255, 255],
      [0, 0, 0]
    );
  }

  const snapped = snapImageDataToPalette(ctx.getImageData(0, 0, 480, 800));
  ctx.putImageData(snapped, 0, 0);
  const encoded = encodeRGBAToEpaper(snapped.data);
  return { canvas, encoded };
}
