// In-Browser LiteRT-LM (@litert-lm/core) & MediaPipe GenAI (@mediapipe/tasks-genai) WebGPU Badge Designer
// Runs lightweight .litertlm and .task models directly in the browser over WebGPU,
// combines user prompts with live photo luminance/contrast telemetry, and produces
// a validated 4-color BWYR BadgeDesignSpec JSON.

export const LITERT_MODELS = [
  {
    id: 'smollm-135m-task',
    label: 'SmolLM-135M-Instruct (MediaPipe .task • 167 MB • Fastest)',
    shortLabel: 'SmolLM-135M (167 MB)',
    runtime: 'mediapipe-genai',
    sizeMB: 167,
    url: 'https://huggingface.co/litert-community/SmolLM-135M-Instruct/resolve/main/SmolLM-135M-Instruct_multi-prefill-seq_q8_ekv1280.task',
    description: 'Ultra-lightweight 135M LiteRT/MediaPipe .task model. Downloads quickly and runs on any WebGPU laptop.',
  },
  {
    id: 'qwen3-0.6b-litert',
    label: 'Qwen3-0.6B-INT4 (LiteRT-LM .litertlm • 329 MB • Recommended)',
    shortLabel: 'Qwen3-0.6B (329 MB)',
    runtime: 'litert-lm',
    sizeMB: 329,
    url: 'https://huggingface.co/litert-community/Qwen3-0.6B/resolve/main/Qwen3-0.6B_dynamic_wi4b32_afp32.litertlm',
    description: '4-bit blockwise LiteRT-LM bundle with strong structured JSON reasoning and WebGPU acceleration.',
  },
  {
    id: 'qwen2.5-0.5b-task',
    label: 'Qwen2.5-0.5B-Instruct (MediaPipe .task • 547 MB)',
    shortLabel: 'Qwen2.5-0.5B (547 MB)',
    runtime: 'mediapipe-genai',
    sizeMB: 547,
    url: 'https://huggingface.co/litert-community/Qwen2.5-0.5B-Instruct/resolve/main/Qwen2.5-0.5B-Instruct_multi-prefill-seq_q8_ekv1280.task',
    description: '500M instruction-tuned MediaPipe GenAI .task bundle with crisp JSON formatting.',
  },
  {
    id: 'gemma4-e2b-web',
    label: 'Gemma-4-E2B-it-Web (LiteRT-LM .litertlm • 2.0 GB • High Quality)',
    shortLabel: 'Gemma-4-E2B (2.0 GB)',
    runtime: 'litert-lm',
    sizeMB: 2010,
    url: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm',
    description: 'Google Gemma 4 E2B Web-optimized LiteRT-LM bundle for desktop GPUs.',
  },
  {
    id: 'local-file',
    label: 'Load Local .litertlm or .task File (Gemma 3 270M / Custom)',
    shortLabel: 'Local .litertlm / .task',
    runtime: 'local',
    sizeMB: 0,
    url: '',
    description: 'Load any downloaded LiteRT-LM (.litertlm) or MediaPipe (.task / .bin) model from disk.',
  },
];

export const VALID_LAYOUT_THEMES = [
  'cyber-pcb',
  'sunburst-pop',
  'bauhaus-grid',
  'retro-terminal',
  'editorial-minimal',
];

export const VALID_BACKDROP_PATTERNS = [
  'sunburst',
  'circuit',
  'halftone',
  'bauhaus',
  'matrix-grid',
  'orig',
];

export const VALID_DITHER_MODES = ['atkinson', 'floyd-steinberg', 'bayer4', 'threshold'];
export const VALID_CROP_PRESETS = ['stage', 'pair', 'closeup', 'solo'];
export const VALID_COUNTER_FORMATS = ['roman', 'arabic', 'hex', 'binary'];
export const VALID_LED_COLORS = ['#00f', '#730', '#f00', '#072', '#607'];
export const VALID_SECOND_TEMPLATES = ['speaker', 'schedule', 'poster'];
export const VALID_ACCENT_INKS = ['yellow', 'red', 'white'];

/**
 * Analyzes an RGBA pixel buffer (e.g. from the active portrait photo) to guide
 * the LLM and 4-color BWYR dithering pipeline.
 */
export function analyzePhotoTelemetry(rgba, width, height) {
  const total = Math.max(1, width * height);
  const step = Math.max(1, Math.floor(total / 4096));
  let count = 0;
  let lumSum = 0;
  let lumSqSum = 0;
  let warmCount = 0;
  let borderEdgeEnergy = 0;
  let borderSamples = 0;

  for (let i = 0; i < total; i += step) {
    const idx = i * 4;
    const r = rgba[idx] / 255;
    const g = rgba[idx + 1] / 255;
    const b = rgba[idx + 2] / 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    lumSum += lum;
    lumSqSum += lum * lum;
    if (r > b + 0.08) warmCount++;
    count++;
  }

  // Measure top/side border busyness to decide whether background cutout helps
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  for (let y = 1; y < Math.floor(h * 0.35); y += 2) {
    for (let x = 1; x < w - 1; x += 4) {
      const i0 = (y * w + x) * 4;
      const i1 = (y * w + x + 1) * 4;
      const diff =
        Math.abs(rgba[i0] - rgba[i1]) +
        Math.abs(rgba[i0 + 1] - rgba[i1 + 1]) +
        Math.abs(rgba[i0 + 2] - rgba[i1 + 2]);
      borderEdgeEnergy += diff / (255 * 3);
      borderSamples++;
    }
  }

  const meanLum = count > 0 ? lumSum / count : 0.5;
  const variance = count > 0 ? Math.max(0, lumSqSum / count - meanLum * meanLum) : 0.04;
  const contrastStd = Math.sqrt(variance);
  const warmRatio = count > 0 ? warmCount / count : 0.5;
  const borderBusyness = borderSamples > 0 ? borderEdgeEnergy / borderSamples : 0.05;
  const busyBackground = borderBusyness > 0.045;

  const recommendedBrightness =
    meanLum < 0.32
      ? Number(Math.min(1.32, 1.0 + (0.38 - meanLum) * 0.75).toFixed(2))
      : meanLum > 0.72
        ? Number(Math.max(0.84, 1.0 - (meanLum - 0.68) * 0.5).toFixed(2))
        : 1.02;

  const recommendedContrast =
    contrastStd < 0.16
      ? 1.32
      : contrastStd > 0.28
        ? 1.1
        : 1.2;

  const recommendedWarmth = warmRatio < 0.35 ? 0.7 : 0.6;
  const recommendedCutout = busyBackground;
  const recommendedDither = contrastStd < 0.14 ? 'atkinson' : 'atkinson';

  return {
    meanLum: Number(meanLum.toFixed(3)),
    contrastStd: Number(contrastStd.toFixed(3)),
    warmRatio: Number(warmRatio.toFixed(3)),
    busyBackground,
    recommendedBrightness,
    recommendedContrast,
    recommendedWarmth,
    recommendedCutout,
    recommendedDither,
  };
}

function clampNum(val, min, max, fallback) {
  const n = typeof val === 'number' ? val : parseFloat(val);
  if (Number.isNaN(n)) return fallback;
  return Number(Math.max(min, Math.min(max, n)).toFixed(2));
}

function pickEnum(val, allowed, fallback) {
  if (typeof val === 'string') {
    const clean = val.trim().toLowerCase();
    const match = allowed.find((a) => a.toLowerCase() === clean);
    if (match) return match;
  }
  return fallback;
}

/**
 * Deterministic prompt-intent + photo-telemetry synthesizer used to fill missing fields
 * or provide instant zero-wait results before/without model download.
 */
export function synthesizeSmartDesignSpec(userPrompt = '', currentState = {}, photoTelemetry = null) {
  const p = String(userPrompt || '').toLowerCase();

  let layoutTheme = 'cyber-pcb';
  let backdropPattern = 'circuit';
  let accentInk = 'yellow';
  let headerBadge = 'WEBAI SUMMIT // 2026';
  let tags = ['WEBGPU', 'LITE-RT'];
  let ditherMode = photoTelemetry?.recommendedDither || currentState.ditherMode || 'atkinson';
  let cropPreset = 'closeup';
  let counterFormat = currentState.counterFormat || 'roman';
  let ledColor = currentState.ledColor || '#00f';
  let secondScreenTemplate = currentState.secondScreenTemplate || 'speaker';

  if (p.includes('bauhaus') || p.includes('swiss') || p.includes('grid') || p.includes('architect')) {
    layoutTheme = 'bauhaus-grid';
    backdropPattern = 'bauhaus';
    accentInk = 'red';
    headerBadge = 'BAUHAUS // EDITION 26';
    tags = ['DESIGN SYS', '4-INK'];
    ditherMode = 'atkinson';
    cropPreset = 'pair';
    ledColor = '#f00';
  } else if (p.includes('retro') || p.includes('terminal') || p.includes('crt') || p.includes('8-bit') || p.includes('pixel') || p.includes('bayer')) {
    layoutTheme = 'retro-terminal';
    backdropPattern = 'halftone';
    accentInk = 'yellow';
    headerBadge = 'TERM_OS // TTY.EPAPER';
    tags = ['2BPP_BWYR', 'ESP32_C3'];
    ditherMode = 'bayer4';
    counterFormat = 'binary';
    ledColor = '#072';
  } else if (p.includes('pop') || p.includes('sunburst') || p.includes('keynote') || p.includes('speaker') || p.includes('vibrant') || p.includes('bold')) {
    layoutTheme = 'sunburst-pop';
    backdropPattern = 'sunburst';
    accentInk = 'yellow';
    headerBadge = 'KEYNOTE SPEAKER // ’26';
    tags = ['ON-DEVICE AI', 'GDE'];
    ditherMode = 'atkinson';
    cropPreset = 'closeup';
    counterFormat = 'roman';
    ledColor = '#730';
  } else if (p.includes('minimal') || p.includes('clean') || p.includes('exec') || p.includes('editorial') || p.includes('magazine')) {
    layoutTheme = 'editorial-minimal';
    backdropPattern = 'halftone';
    accentInk = 'white';
    headerBadge = 'SUMMIT FELLOW // 2026';
    tags = ['AI AGENTS', 'WEB STD'];
    ditherMode = 'floyd-steinberg';
    cropPreset = 'solo';
    counterFormat = 'roman';
    ledColor = '#00f';
  } else if (p.includes('cyber') || p.includes('pcb') || p.includes('hardware') || p.includes('hacker') || p.includes('circuit') || p.includes('matrix')) {
    layoutTheme = 'cyber-pcb';
    backdropPattern = p.includes('matrix') ? 'matrix-grid' : 'circuit';
    accentInk = 'yellow';
    headerBadge = 'HW LAB // REV 2.6';
    tags = ['LITERT-LM', 'ESP32-C3'];
    ditherMode = 'atkinson';
    cropPreset = 'closeup';
    counterFormat = 'hex';
    ledColor = '#f00';
  }

  // Explicit overrides from user prompt keywords
  if (p.includes('floyd') || p.includes('smooth')) ditherMode = 'floyd-steinberg';
  if (p.includes('bayer') || p.includes('ordered')) ditherMode = 'bayer4';
  if (p.includes('poster') && p.includes('dither')) ditherMode = 'threshold';
  if (p.includes('atkinson')) ditherMode = 'atkinson';

  if (p.includes('solo') || p.includes('tight')) cropPreset = 'solo';
  else if (p.includes('face') || p.includes('close')) cropPreset = 'closeup';
  else if (p.includes('pair') || p.includes('two')) cropPreset = 'pair';
  else if (p.includes('stage') || p.includes('full') || p.includes('wide')) cropPreset = 'stage';

  if (p.includes('binary')) counterFormat = 'binary';
  else if (p.includes('hex')) counterFormat = 'hex';
  else if (p.includes('arabic') || p.includes('number')) counterFormat = 'arabic';
  else if (p.includes('roman')) counterFormat = 'roman';

  if (p.includes('red led') || p.includes('crimson')) ledColor = '#f00';
  else if (p.includes('amber') || p.includes('gold led') || p.includes('yellow led')) ledColor = '#730';
  else if (p.includes('green') || p.includes('emerald')) ledColor = '#072';
  else if (p.includes('violet') || p.includes('purple')) ledColor = '#607';
  else if (p.includes('blue')) ledColor = '#00f';

  if (p.includes('schedule') || p.includes('agenda')) secondScreenTemplate = 'schedule';
  else if (p.includes('full-bleed') || p.includes('poster screen')) secondScreenTemplate = 'poster';

  const useAiCutout = p.includes('no cutout') || p.includes('keep background')
    ? false
    : true;

  const contrast = photoTelemetry?.recommendedContrast ?? 1.22;
  const brightness = photoTelemetry?.recommendedBrightness ?? 1.02;
  const warmthBlend = photoTelemetry?.recommendedWarmth ?? 0.65;
  const sharpness = ditherMode === 'bayer4' ? 0.45 : 0.4;

  return {
    layoutTheme,
    backdropPattern,
    accentInk,
    headerBadge,
    tags,
    ditherMode,
    contrast,
    brightness,
    warmthBlend,
    sharpness,
    useAiCutout,
    cropPreset,
    counterFormat,
    ledColor,
    secondScreenTemplate,
    name: currentState.name || 'Rabimba Karanjai',
    company: currentState.company || 'PayPal / GDE',
    handle: currentState.handle || '@rabimba',
    secondScreenTalk: currentState.secondScreenTalk || 'Scaling WebAI Agents & Hardware Hacking',
    reasoning: `Configured ${layoutTheme} 4-ink visual layout with ${backdropPattern} procedural backdrop, ${ditherMode} dithering, and photo-adapted gamut (brightness ${brightness}, contrast ${contrast}).`,
  };
}

/**
 * Parses raw LLM response text (stripping <think> tags and code fences), repairs common small-LLM
 * JSON quirks, and clamps all fields to hardware-safe values.
 */
export function parseAndValidateDesignSpec(rawText, fallbackContext = {}, photoTelemetry = null) {
  const base = synthesizeSmartDesignSpec(
    fallbackContext.userPrompt || '',
    fallbackContext,
    photoTelemetry
  );

  if (!rawText || typeof rawText !== 'string') {
    return base;
  }

  // Strip <think>...</think> reasoning blocks emitted by Qwen3 / DeepSeek models
  const stripped = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  let parsed = null;
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = stripped
      .slice(firstBrace, lastBrace + 1)
      .replace(/,\s*([}\]])/g, '$1');
    try {
      parsed = JSON.parse(candidate);
    } catch {
      parsed = null;
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return base;
  }

  const cleanTags = Array.isArray(parsed.tags)
    ? parsed.tags
        .map((t) => String(t || '').trim().toUpperCase().slice(0, 14))
        .filter(Boolean)
        .slice(0, 2)
    : base.tags;

  return {
    layoutTheme: pickEnum(parsed.layoutTheme, VALID_LAYOUT_THEMES, base.layoutTheme),
    backdropPattern: pickEnum(parsed.backdropPattern, VALID_BACKDROP_PATTERNS, base.backdropPattern),
    accentInk: pickEnum(parsed.accentInk, VALID_ACCENT_INKS, base.accentInk),
    headerBadge:
      typeof parsed.headerBadge === 'string' && parsed.headerBadge.trim()
        ? parsed.headerBadge.trim().toUpperCase().slice(0, 28)
        : base.headerBadge,
    tags: cleanTags.length > 0 ? cleanTags : base.tags,
    ditherMode: pickEnum(parsed.ditherMode, VALID_DITHER_MODES, base.ditherMode),
    contrast: clampNum(parsed.contrast, 0.8, 1.8, base.contrast),
    brightness: clampNum(parsed.brightness, 0.7, 1.4, base.brightness),
    warmthBlend: clampNum(parsed.warmthBlend, 0.0, 1.0, base.warmthBlend),
    sharpness: clampNum(parsed.sharpness, 0.0, 1.2, base.sharpness),
    useAiCutout:
      typeof parsed.useAiCutout === 'boolean' ? parsed.useAiCutout : base.useAiCutout,
    cropPreset: pickEnum(parsed.cropPreset, VALID_CROP_PRESETS, base.cropPreset),
    counterFormat: pickEnum(parsed.counterFormat, VALID_COUNTER_FORMATS, base.counterFormat),
    ledColor: pickEnum(parsed.ledColor, VALID_LED_COLORS, base.ledColor),
    secondScreenTemplate: pickEnum(
      parsed.secondScreenTemplate,
      VALID_SECOND_TEMPLATES,
      base.secondScreenTemplate
    ),
    name:
      typeof parsed.name === 'string' && parsed.name.trim()
        ? parsed.name.trim().slice(0, 28)
        : base.name,
    company:
      typeof parsed.company === 'string' && parsed.company.trim()
        ? parsed.company.trim().slice(0, 32)
        : base.company,
    handle:
      typeof parsed.handle === 'string' && parsed.handle.trim()
        ? parsed.handle.trim().slice(0, 22)
        : base.handle,
    secondScreenTalk:
      typeof parsed.secondScreenTalk === 'string' && parsed.secondScreenTalk.trim()
        ? parsed.secondScreenTalk.trim().slice(0, 48)
        : base.secondScreenTalk,
    reasoning:
      typeof parsed.reasoning === 'string' && parsed.reasoning.trim()
        ? parsed.reasoning.trim().slice(0, 180)
        : base.reasoning,
  };
}

/**
 * Builds the compact prompt for LiteRT-LM / MediaPipe GenAI models.
 */
export function buildLiteRtDesignPrompt(userPrompt, currentState, photoTelemetry) {
  const lumDesc = photoTelemetry
    ? `meanLum=${photoTelemetry.meanLum} (recommendedBrightness=${photoTelemetry.recommendedBrightness}, recommendedContrast=${photoTelemetry.recommendedContrast})`
    : 'meanLum=0.48';

  return `You are a 4-color ePaper Badge Art Director for the 480x800 Espruino badge (Black #000000, White #FFFFFF, Yellow #FFCC33, Red #DB3727).
Output ONLY a valid JSON object matching this exact schema (no markdown, no extra text):
{
  "layoutTheme": "cyber-pcb" | "sunburst-pop" | "bauhaus-grid" | "retro-terminal" | "editorial-minimal",
  "backdropPattern": "circuit" | "sunburst" | "halftone" | "bauhaus" | "matrix-grid",
  "accentInk": "yellow" | "red" | "white",
  "headerBadge": "SHORT UPPERCASE BANNER (max 24 chars)",
  "tags": ["TAG1", "TAG2"],
  "ditherMode": "atkinson" | "floyd-steinberg" | "bayer4" | "threshold",
  "contrast": number (0.9 to 1.6),
  "brightness": number (0.8 to 1.3),
  "warmthBlend": number (0.3 to 0.9),
  "sharpness": number (0.2 to 0.8),
  "useAiCutout": true | false,
  "cropPreset": "stage" | "pair" | "closeup" | "solo",
  "counterFormat": "roman" | "arabic" | "hex" | "binary",
  "ledColor": "#00f" | "#730" | "#f00" | "#072" | "#607",
  "secondScreenTemplate": "speaker" | "schedule" | "poster",
  "reasoning": "1 short sentence explaining the 4-ink design."
}

Current Attendee: name="${currentState.name || 'Rabimba Karanjai'}", company="${currentState.company || 'PayPal / GDE'}", handle="${currentState.handle || '@rabimba'}"
Photo Telemetry: ${lumDesc}
User Request: "${userPrompt || 'Design a bold high-contrast WebAI Summit hardware hacker badge'}"
JSON:`;
}

/**
 * Downloads a model URL with streaming progress and caches it in browser CacheStorage
 * so subsequent page loads are instant.
 */
async function fetchModelBlobWithCache(url, onProgress) {
  const cacheName = 'webai-litert-models-v1';
  let cache = null;
  if (typeof caches !== 'undefined') {
    try {
      cache = await caches.open(cacheName);
      const cachedResp = await cache.match(url);
      if (cachedResp) {
        onProgress?.(1, 'Loaded from browser cache');
        return await cachedResp.blob();
      }
    } catch {
      cache = null;
    }
  }

  const resp = await fetch(url, { mode: 'cors' });
  if (!resp.ok) {
    throw new Error(`Model download HTTP ${resp.status}`);
  }

  const total = parseInt(resp.headers.get('content-length') || '0', 10);
  if (!resp.body) {
    const blob = await resp.blob();
    if (cache) {
      try {
        await cache.put(url, new Response(blob));
      } catch {}
    }
    onProgress?.(1, 'Download complete');
    return blob;
  }

  const reader = resp.body.getReader();
  const chunks = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    if (total > 0) {
      const mbDone = (loaded / (1024 * 1024)).toFixed(1);
      const mbTotal = (total / (1024 * 1024)).toFixed(0);
      onProgress?.(loaded / total, `${mbDone} / ${mbTotal} MB`);
    } else {
      const mbDone = (loaded / (1024 * 1024)).toFixed(1);
      onProgress?.(0.5, `${mbDone} MB downloaded...`);
    }
  }

  const blob = new Blob(chunks, { type: 'application/octet-stream' });
  if (cache) {
    try {
      await cache.put(url, new Response(blob));
    } catch {}
  }
  onProgress?.(1, 'Model cached locally');
  return blob;
}

/**
 * Unified In-Browser WebGPU LLM Engine supporting:
 * 1. Google LiteRT-LM Web API (@litert-lm/core) for .litertlm models
 * 2. Google MediaPipe GenAI (@mediapipe/tasks-genai) LlmInference for .task models
 * 3. Local .litertlm or .task File / Blob objects
 */
export class WebAiBadgeLlmEngine {
  constructor({ onStatus, onProgress, onLog } = {}) {
    this.onStatus = onStatus;
    this.onProgress = onProgress;
    this.onLog = onLog;
    this.activeModelId = null;
    this.runtimeType = null; // 'litert-lm' | 'mediapipe-genai'
    this.litertEngine = null;
    this.mediapipeLlm = null;
    this.isLoading = false;
  }

  static isWebGpuAvailable() {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
  }

  async dispose() {
    try {
      if (this.litertEngine?.delete) await this.litertEngine.delete();
      if (this.mediapipeLlm?.close) await this.mediapipeLlm.close();
    } catch {}
    this.litertEngine = null;
    this.mediapipeLlm = null;
    this.activeModelId = null;
    this.runtimeType = null;
  }

  async loadModel(modelId, localFile = null) {
    if (this.isLoading) return;
    if (!localFile && this.activeModelId === modelId && (this.litertEngine || this.mediapipeLlm)) {
      return;
    }

    if (!WebAiBadgeLlmEngine.isWebGpuAvailable()) {
      throw new Error('WebGPU is not enabled in this browser. Using Instant Smart Copilot.');
    }

    this.isLoading = true;
    try {
      await this.dispose();

      let modelMeta = LITERT_MODELS.find((m) => m.id === modelId) || LITERT_MODELS[0];
      let blob = null;
      let isLitertLmFormat = modelMeta.runtime === 'litert-lm';

      if (localFile) {
        blob = localFile;
        isLitertLmFormat = localFile.name.toLowerCase().endsWith('.litertlm');
        this.onStatus?.(`Loading local ${localFile.name}...`);
        this.onProgress?.(0.35, `Reading ${localFile.name}`);
      } else {
        this.onStatus?.(`Downloading ${modelMeta.shortLabel}...`);
        blob = await fetchModelBlobWithCache(modelMeta.url, (frac, label) => {
          this.onProgress?.(frac * 0.82, label);
        });
      }

      if (isLitertLmFormat) {
        this.onStatus?.('Initializing LiteRT-LM WebGPU Engine...');
        this.onProgress?.(0.88, 'Compiling LiteRT-LM WebGPU shaders...');
        const litertMod = await import(
          /* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@litert-lm/core/+esm'
        );
        const Engine = litertMod.Engine || litertMod.default?.Engine;
        if (!Engine) {
          throw new Error('@litert-lm/core Engine export not found');
        }
        this.litertEngine = await Engine.create({
          model: blob,
          mainExecutorSettings: {
            maxNumTokens: 1280,
          },
        });
        this.runtimeType = 'litert-lm';
        this.activeModelId = localFile ? `local:${localFile.name}` : modelMeta.id;
      } else {
        this.onStatus?.('Initializing MediaPipe GenAI WebGPU...');
        this.onProgress?.(0.88, 'Compiling MediaPipe LlmInference WebGPU...');
        const genaiMod = await import(
          /* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.22/genai_bundle.mjs'
        );
        const FilesetResolver = genaiMod.FilesetResolver || genaiMod.default?.FilesetResolver;
        const LlmInference = genaiMod.LlmInference || genaiMod.default?.LlmInference;
        const genaiFileset = await FilesetResolver.forGenAiTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.22/wasm'
        );
        const blobUrl = URL.createObjectURL(blob);
        try {
          this.mediapipeLlm = await LlmInference.createFromOptions(genaiFileset, {
            baseOptions: {
              modelAssetPath: blobUrl,
            },
            maxTokens: 512,
            topK: 20,
            temperature: 0.35,
          });
        } finally {
          setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        }
        this.runtimeType = 'mediapipe-genai';
        this.activeModelId = localFile ? `local:${localFile.name}` : modelMeta.id;
      }

      this.onProgress?.(null);
      const activeName = localFile ? localFile.name : modelMeta.shortLabel;
      this.onStatus?.(`WebGPU Ready • ${activeName}`);
      this.onLog?.({
        time: new Date().toLocaleTimeString(),
        msg: `Loaded ${activeName} via ${this.runtimeType === 'litert-lm' ? 'LiteRT-LM (@litert-lm/core)' : 'MediaPipe GenAI (@mediapipe/tasks-genai)'} on WebGPU.`,
        type: 'ok',
      });
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Generates a validated BadgeDesignSpec using the loaded LiteRT-LM / MediaPipe model,
   * or falls back cleanly to the photo-telemetry-aware heuristic engine if offline/unloaded.
   */
  async generateBadgeDesign({ userPrompt, currentState, photoTelemetry, onStreamText }) {
    const prompt = buildLiteRtDesignPrompt(userPrompt, currentState, photoTelemetry);
    let rawResponse = '';
    let engineUsed = 'WebAI Smart Telemetry Copilot';

    if (this.runtimeType === 'litert-lm' && this.litertEngine) {
      this.onStatus?.('LiteRT-LM generating 4-ink design...');
      const chat = await this.litertEngine.createConversation();
      for await (const chunk of chat.sendMessageStreaming(prompt)) {
        const piece =
          typeof chunk === 'string'
            ? chunk
            : chunk?.content?.[0]?.text || chunk?.text || '';
        rawResponse += piece;
        onStreamText?.(rawResponse);
      }
      engineUsed = `LiteRT-LM WebGPU (${this.activeModelId})`;
    } else if (this.runtimeType === 'mediapipe-genai' && this.mediapipeLlm) {
      this.onStatus?.('MediaPipe LlmInference generating design...');
      rawResponse = await new Promise((resolve, reject) => {
        let acc = '';
        try {
          const maybePromise = this.mediapipeLlm.generateResponse(
            prompt,
            (partial, done) => {
              acc += partial || '';
              onStreamText?.(acc);
              if (done) resolve(acc);
            }
          );
          if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise.then((res) => {
              if (typeof res === 'string' && !acc) resolve(res);
            }).catch(reject);
          }
        } catch (err) {
          reject(err);
        }
      });
      engineUsed = `MediaPipe GenAI WebGPU (${this.activeModelId})`;
    }

    const spec = parseAndValidateDesignSpec(
      rawResponse,
      { ...currentState, userPrompt },
      photoTelemetry
    );
    return { spec, rawResponse, engineUsed };
  }
}
