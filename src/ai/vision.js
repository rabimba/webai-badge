// In-Browser WebAI Portrait Engine (MediaPipe Selfie Segmenter WebGPU/WASM + Offline Portrait Saliency Fallback)
// Segments people from background so the WebAI Summit geometric yellow/red star backdrop shines behind them,
// plus Smart Face Auto-Crop & Framing presets.

let mediapipeSegmenter = null;
let mediapipeLoading = false;

async function getMediaPipeSegmenter() {
  if (mediapipeSegmenter) return mediapipeSegmenter;
  if (mediapipeLoading) return null;
  mediapipeLoading = true;
  try {
    const vision = await import(
      /* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs'
    );
    const fileset = await vision.FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
    );
    mediapipeSegmenter = await vision.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
        delegate: 'GPU',
      },
      runningMode: 'IMAGE',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
    return mediapipeSegmenter;
  } catch {
    return null;
  } finally {
    mediapipeLoading = false;
  }
}

/**
 * Offline fallback portrait matte generator:
 * Uses border background color modeling (top-left, top-right, top edge samples) + spatial center/bottom prior
 * + skin/hair chroma preservation so background removal works even without internet access.
 */
function offlinePortraitMatte(imageData) {
  const { width, height, data } = imageData;
  const alpha = new Float32Array(width * height);

  // Sample outer top/side border strips to estimate background color clusters
  const bgSamples = [];
  const step = Math.max(2, Math.floor(width / 32));
  for (let x = 0; x < width; x += step) {
    for (const y of [2, Math.floor(height * 0.08), Math.floor(height * 0.18)]) {
      const idx = (y * width + x) * 4;
      bgSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
  }

  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];

      // Minimum color distance to background border samples
      let minBgDist = Infinity;
      for (let s = 0; s < bgSamples.length; s++) {
        const dr = r - bgSamples[s][0];
        const dg = g - bgSamples[s][1];
        const db = b - bgSamples[s][2];
        const d = Math.sqrt(dr * dr + dg * dg + db * db);
        if (d < minBgDist) minBgDist = d;
      }

      // Portrait spatial prior (elliptical torso + head region)
      const dx = (nx - 0.46) / 0.44;
      const dy = (ny - 0.62) / 0.46;
      const ellipse = Math.max(0, 1 - (dx * dx + dy * dy) * 0.65);

      // Skin/hair/clothing likelihood vs bright projector screen at top-right
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const isBrightScreen = ny < 0.45 && nx > 0.34 && lum > 175 && Math.abs(r - b) < 45;

      let fg = Math.min(1, (minBgDist / 62) * 0.65 + ellipse * 0.65);
      if (isBrightScreen) fg *= 0.08;
      if (ny > 0.44 && nx < 0.76 && ellipse > 0.32) fg = Math.max(fg, 0.92);

      alpha[y * width + x] = fg > 0.52 ? 1.0 : fg < 0.35 ? 0.0 : (fg - 0.35) / 0.17;
    }
  }

  // 3x3 box smooth alpha feather
  const smoothed = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          sum += alpha[(y + dy) * width + (x + dx)];
        }
      }
      smoothed[y * width + x] = sum / 9;
    }
  }
  return smoothed;
}

/**
 * Runs in-browser AI person segmentation on an HTMLImageElement or HTMLCanvasElement
 * Returns an offscreen canvas with transparent background.
 */
export async function segmentPortraitInBrowser(sourceImg) {
  const w = Math.min(768, sourceImg.naturalWidth || sourceImg.width || 512);
  const h = Math.round(
    w * ((sourceImg.naturalHeight || sourceImg.height || 512) / (sourceImg.naturalWidth || sourceImg.width || 512))
  );

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sourceImg, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);

  let maskFloat = null;
  let engineUsed = 'WebAI Local Portrait Matte';

  const seg = await getMediaPipeSegmenter();
  if (seg) {
    try {
      const result = seg.segment(canvas);
      if (result.confidenceMasks && result.confidenceMasks.length > 0) {
        maskFloat = result.confidenceMasks[0].getAsFloat32Array();
        engineUsed = 'MediaPipe SelfieSegmenter (WebGPU/WASM)';
      }
    } catch {}
  }

  if (!maskFloat) {
    maskFloat = offlinePortraitMatte(imgData);
  }

  const d = imgData.data;
  for (let i = 0; i < w * h; i++) {
    const m = Math.max(0, Math.min(1, maskFloat[i]));
    const sharpAlpha = m > 0.48 ? Math.min(1, (m - 0.48) * 4.5 + 0.5) : m * 0.4;
    d[i * 4 + 3] = Math.round(sharpAlpha * 255);
  }
  ctx.putImageData(imgData, 0, 0);
  return { canvas, engineUsed };
}

/**
 * Smart framing presets (normalized [x, y, size] crop window or zoom/pan parameters)
 */
export const SMART_CROP_PRESETS = {
  stage: { label: 'Full Stage + Logo', zoom: 1.0, panX: 0.0, panY: -0.05 },
  pair: { label: 'Two-Shot + Peace', zoom: 1.28, panX: -0.10, panY: 0.14 },
  closeup: { label: 'Faces Close-Up', zoom: 1.95, panX: -0.24, panY: 0.05 },
  solo: { label: 'Solo Portrait', zoom: 2.65, panX: -0.32, panY: 0.02 },
};
