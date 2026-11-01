// End-to-End Automated Verification Suite for WebAI Badge Studio
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { decodeEpaperToRGBA, encodeRGBAToEpaper, crc32 } from '../src/epaper/codec.js';
import { preprocessForBWYR, ditherToBWYR } from '../src/epaper/dither.js';import { encodeQRMatrix } from '../src/epaper/qrcode.js';
import { patchBootcde, formatCounterPreview, PERSON_ICON_B64 } from '../src/epaper/bootcde-patcher.js';
import { createZipArchive, parseZipArchive } from '../src/storage/zip.js';
import {
  LITERT_MODELS,
  analyzePhotoTelemetry,
  parseAndValidateDesignSpec,
} from '../src/ai/llm-designer.js';
import {
  AI_LAYOUT_THEMES,
  renderProceduralBackdropRGBA,
  renderAiBadgeLayoutRGBA,
  dilateAlphaMaskOutline,
} from '../src/epaper/ai-layout.js';
import { composeAiSecondScreenOverlay } from '../src/epaper/composer.js';

// 1. Verify bit-exact 96,000-byte .epaper decode -> encode round-trip against hardware backup
const rawEpaper = new Uint8Array(fs.readFileSync('backup/option1_stage_qr.epaper'));
assert.equal(rawEpaper.length, 96000);
assert.equal(crc32(rawEpaper), 1139474309, 'Hardware CRC32 must match E.CRC32 on ESP32-C3');

const rgba = decodeEpaperToRGBA(rawEpaper);
assert.equal(rgba.length, 480 * 800 * 4);
const reencoded = encodeRGBAToEpaper(rgba);
assert.equal(reencoded.crc, 1139474309, 'Round-trip .epaper encode must be 100% bit-exact');
console.log('[PASS] .epaper 96,000B codec & CRC32 round-trip (CRC32 = 1139474309)');

// 2. Verify 4-color BWYR dithering engine on synthetic gradient
const synth = new Uint8ClampedArray(64 * 64 * 4);
for (let i = 0; i < 64 * 64; i++) {
  synth[i * 4] = (i * 7) & 255;
  synth[i * 4 + 1] = (i * 3) & 255;
  synth[i * 4 + 2] = (i * 11) & 255;
  synth[i * 4 + 3] = 255;
}
const floatRgb = preprocessForBWYR(synth, 64, 64);
for (const mode of ['atkinson', 'floyd-steinberg', 'bayer4', 'threshold']) {
  const out = ditherToBWYR(floatRgb, 64, 64, mode);
  assert.equal(out.length, 64 * 64 * 4);
}
console.log('[PASS] 4-color BWYR dithering pipeline (Atkinson, Floyd-Steinberg, Bayer 4x4, Threshold)');

// 3. Verify ISO/IEC 18004 QR Code matrix generator
const qr = encodeQRMatrix('https://www.linkedin.com/in/rabimba/', 'M');
assert.equal(qr.version, 3);
assert.equal(qr.size, 29);
console.log('[PASS] ISO/IEC 18004 QR generator (v3, 29x29 modules)');

// 4. Verify .bootcde firmware binary patcher & 144-byte transparent person icon header
const origBoot = new Uint8Array(fs.readFileSync('public/templates/orig_bootcde.bin'));
assert.equal(origBoot.length, 8689);
const iconBytes = Buffer.from(PERSON_ICON_B64, 'base64');
assert.equal(iconBytes.length, 144);
assert.deepEqual([...iconBytes.subarray(0, 4)], [32, 35, 129, 0], 'Person icon must start with [32, 35, 129, 0]');

assert.equal(formatCounterPreview(14, 'roman'), 'XIV');
assert.equal(formatCounterPreview(14, 'hex'), '0xE');
assert.equal(formatCounterPreview(14, 'binary'), '1110');

const patchedRoman = patchBootcde(origBoot, { counterFormat: 'roman', ledColor: '#00f' });
assert.ok(patchedRoman.length > origBoot.length);
console.log(`[PASS] .bootcde firmware binary patcher (${patchedRoman.length}B, CRC32 = ${patchedRoman.crc})`);

// 5. Verify PKZIP archive writer & reader round-trip
const zipBytes = createZipArchive([
  { name: 'hello.txt', data: 'WebAI 2026' },
  { name: 'badge.epaper', data: rawEpaper },
]);
const parsedZip = await parseZipArchive(zipBytes.buffer);
assert.equal(new TextDecoder().decode(parsedZip['hello.txt']), 'WebAI 2026');
assert.equal(crc32(parsedZip['badge.epaper']), 1139474309);
console.log('[PASS] Zero-dependency PKZIP backup/restore archive round-trip');

// 6. Verify LiteRT / MediaPipe WebGPU LLM model catalog & photo telemetry analyzer
assert.ok(Array.isArray(LITERT_MODELS) && LITERT_MODELS.length >= 4);
assert.ok(LITERT_MODELS.some((m) => m.runtime === 'litert-lm' && m.url.endsWith('.litertlm')));
assert.ok(LITERT_MODELS.some((m) => m.runtime === 'mediapipe-genai' && m.url.endsWith('.task')));

const darkPhoto = new Uint8ClampedArray(64 * 64 * 4);
for (let i = 0; i < 64 * 64; i++) {
  darkPhoto[i * 4] = 35;
  darkPhoto[i * 4 + 1] = 28;
  darkPhoto[i * 4 + 2] = 24;
  darkPhoto[i * 4 + 3] = 255;
}
const telemetry = analyzePhotoTelemetry(darkPhoto, 64, 64);
assert.ok(telemetry.meanLum < 0.25, 'Dark photo should report low luminance');
assert.ok(telemetry.recommendedBrightness > 1.05, 'Dark photo should recommend boosted brightness');
console.log('[PASS] Photo telemetry analyzer for AI-assisted BWYR gamut tuning');

// 7. Verify LLM Design Spec parser (handles Qwen3 <think> blocks, code fences, and out-of-range clamping)
const rawLlmOutput = `<think>
User wants a cyberpunk hardware hacker badge with circuit backdrop and hex counter.
</think>
\`\`\`json
{
  "layoutTheme": "cyber-pcb",
  "backdropPattern": "circuit",
  "accentInk": "yellow",
  "headerBadge": "HARDWARE HACKER // WEBAI",
  "tags": ["LITERT-LM", "WEBGPU", "EXTRA_TAG_IGNORED"],
  "ditherMode": "atkinson",
  "contrast": 2.9,
  "brightness": 0.2,
  "warmthBlend": 0.75,
  "sharpness": 0.55,
  "useAiCutout": true,
  "cropPreset": "closeup",
  "counterFormat": "hex",
  "ledColor": "#f00",
  "secondScreenTemplate": "poster",
  "reasoning": "High-contrast cyber-pcb frame with circuit traces and hex counter."
}
\`\`\``;
const spec = parseAndValidateDesignSpec(rawLlmOutput, {
  name: 'Rabimba Karanjai',
  company: 'PayPal / GDE',
  handle: '@rabimba',
});
assert.equal(spec.layoutTheme, 'cyber-pcb');
assert.equal(spec.backdropPattern, 'circuit');
assert.equal(spec.counterFormat, 'hex');
assert.equal(spec.ledColor, '#f00');
assert.equal(spec.contrast, 1.8, 'Contrast should be clamped to safe hardware max 1.8');
assert.equal(spec.brightness, 0.7, 'Brightness should be clamped to safe hardware min 0.7');
assert.equal(spec.tags.length, 2, 'Tags should be capped at 2 for badge legibility');
console.log('[PASS] LiteRT/MediaPipe LLM JSON spec parser & hardware constraint validator');

// 8. Verify 4-Ink Parametric Visual Layout & Procedural Backdrop Engine (strictly 4 hardware colors + 96,000B .epaper)
assert.ok(Object.keys(AI_LAYOUT_THEMES).length >= 5);
for (const pattern of ['sunburst', 'circuit', 'halftone', 'bauhaus', 'matrix-grid']) {
  const bg = renderProceduralBackdropRGBA(120, 120, pattern, 'yellow');
  assert.equal(bg.length, 120 * 120 * 4);
}
const aiBadgeRgba = renderAiBadgeLayoutRGBA({
  width: 480,
  height: 800,
  spec,
  photoRgba: new Uint8ClampedArray(386 * 389 * 4),
});
assert.equal(aiBadgeRgba.length, 480 * 800 * 4);
const aiEncoded = encodeRGBAToEpaper(aiBadgeRgba);
assert.equal(aiEncoded.bytes.length, 96000);
assert.equal(
  aiEncoded.inkCounts[0] + aiEncoded.inkCounts[1] + aiEncoded.inkCounts[2] + aiEncoded.inkCounts[3],
  480 * 800
);
console.log('[PASS] Opt-in 4-Ink AI Visual Layout & Procedural Backdrop Engine (96,000B verified)');

// 9. Verify Serpentine Scan & Perceptual BWYR Dithering (CRITICAL: hardware CRC32 round-trip must stay bit-exact)
const reencodedSerpentine = encodeRGBAToEpaper(decodeEpaperToRGBA(rawEpaper));
assert.equal(reencodedSerpentine.crc, 1139474309, 'Serpentine dithering pipeline must not alter .epaper round-trip CRC');

// Deterministic midtone patch: perceptual distance must never invent spurious red in neutral grays
const grayPatch = new Uint8ClampedArray(48 * 48 * 4);
for (let i = 0; i < 48 * 48; i++) {
  const v = 128 + ((i % 7) - 3);
  grayPatch[i * 4] = v; grayPatch[i * 4 + 1] = v; grayPatch[i * 4 + 2] = v; grayPatch[i * 4 + 3] = 255;
}
const grayPre = preprocessForBWYR(grayPatch, 48, 48, { contrast: 1.0, brightness: 1.0, warmthBlend: 0.0, sharpness: 0.0 });
for (const serpentine of [true, false]) {
  const dith = ditherToBWYR(grayPre, 48, 48, 'floyd-steinberg', { serpentine });
  assert.equal(dith.length, 48 * 48 * 4);
  for (let i = 0; i < 48 * 48; i++) {
    const r = dith[i * 4], g = dith[i * 4 + 1], b = dith[i * 4 + 2];
    const isRed = r === 0xdb && g === 0x37 && b === 0x27;
    assert.ok(!isRed, `Neutral gray must not quantize to Signal Red (serpentine=${serpentine})`);
  }
}
const serpOn = ditherToBWYR(grayPre, 48, 48, 'floyd-steinberg', { serpentine: true });
const serpOff = ditherToBWYR(grayPre, 48, 48, 'floyd-steinberg', { serpentine: false });
let differs = 0;
for (let i = 0; i < serpOn.length; i++) if (serpOn[i] !== serpOff[i]) differs++;
assert.ok(differs > 0, 'Serpentine scan should change error diffusion pattern vs raster scan');
console.log('[PASS] Serpentine scan & perceptual BWYR palette distance (hardware CRC32 bit-exact)');

// 10. Verify Die-Cut Sticker Outline Mask Dilation (pure 4-ink outline ring around cutout silhouette)
const tinyMask = new Uint8ClampedArray(16 * 16 * 4);
for (let y = 6; y < 10; y++) {
  for (let x = 6; x < 10; x++) {
    const idx = (y * 16 + x) * 4;
    tinyMask[idx] = 200; tinyMask[idx + 1] = 180; tinyMask[idx + 2] = 160; tinyMask[idx + 3] = 255;
  }
}
const outlined = dilateAlphaMaskOutline(tinyMask, 16, 16, 2, [255, 255, 255]);
assert.equal(outlined.length, 16 * 16 * 4);
let outlinePx = 0, fgPx = 0;
for (let i = 0; i < 16 * 16; i++) {
  const r = outlined[i * 4], g = outlined[i * 4 + 1], b = outlined[i * 4 + 2];
  const isFg = r === 200 && g === 180 && b === 160;
  const isOutline = r === 255 && g === 255 && b === 255;
  if (isFg) fgPx++;
  else if (isOutline) outlinePx++;
  assert.ok(isFg || isOutline || (r === 0 && g === 0 && b === 0), 'Outline dilation must only add pure 4-ink colors');
}
assert.equal(fgPx, 16, 'Foreground subject pixels must be preserved');
assert.ok(outlinePx >= 40, '2px dilation ring should add a substantial outline');
console.log('[PASS] Die-cut sticker outline mask dilation (pure 4-ink ring)');

// 11. Verify Opt-in AI Theme Parity Overlay for 2nd Screen (programme.epaper)
const overlayOn = composeAiSecondScreenOverlay({
  enabled: true,
  layoutTheme: 'retro-terminal',
  accentInk: 'yellow',
  headerBadge: 'TERM_OS // TTY.EPAPER',
  tags: ['2BPP_BWYR', 'ESP32_C3'],
});
assert.ok(overlayOn.borderColor === '#ffffff' && overlayOn.cardBg === '#000000' && overlayOn.accentHex === '#ffcc33');
const overlayOff = composeAiSecondScreenOverlay(null);
assert.equal(overlayOff, null);
const overlayClassic = composeAiSecondScreenOverlay({ enabled: false, layoutTheme: 'cyber-pcb' });
assert.equal(overlayClassic, null, 'AI theme must stay opt-in: disabled aiLayout yields null overlay');
console.log('[PASS] Opt-in AI theme parity overlay for programme.epaper 2nd screen');

// 12. Verify Wi-Fi Provisioning Helpers (wifi.json build/parse for badge storage write)
import { buildWifiJson, parseWifiJson } from '../src/transport/wifi-provisioning.js';
const full = buildWifiJson({
  ssid: 'Badge24',
  password: 'x'.repeat(8),
  backupSsid: 'ALPHABET-GUEST',
  backupPassword: '',
});
assert.deepEqual(full.obj, {
  ssid: 'Badge24',
  options: { password: 'x'.repeat(8) },
  backup_ssid: 'ALPHABET-GUEST',
  backup_options: { password: '' },
  badgeURL: 'https://www.espruino.com/webai2026',
});
assert.deepEqual(JSON.parse(full.json), full.obj, 'wifi.json string must round-trip through JSON.parse');

// Special characters in SSID/password must survive the JSON round-trip
const special = buildWifiJson({ ssid: 'My;Net,work"', password: 'pa"ss;word,' });
assert.equal(JSON.parse(special.json).ssid, 'My;Net,work"');
assert.equal(JSON.parse(special.json).options.password, 'pa"ss;word,');

// Open network: empty password allowed
const open = buildWifiJson({ ssid: 'OpenNet', password: '' });
assert.deepEqual(open.obj.options, { password: '' });

// Rejections
assert.throws(() => buildWifiJson({ ssid: 'x'.repeat(33), password: '' }), /SSID/);
assert.throws(() => buildWifiJson({ ssid: 'Net', password: 'short1' }), /8/);
assert.throws(() => buildWifiJson({ ssid: '', password: '' }), /SSID/);

// Parse back from badge storage
assert.equal(parseWifiJson('{"ssid":"Badge24","options":{"password":"p"}}').ssid, 'Badge24');
assert.throws(() => parseWifiJson('{}'), /ssid/);
assert.throws(() => parseWifiJson('not json'), /wifi\.json/);
console.log('[PASS] Wi-Fi provisioning wifi.json build/parse helpers (round-trip + validation)');

// 13. Composer wiring smoke test: every ai-layout symbol called inside composer.js
// must be locally imported (not merely re-exported). Guards against ReferenceError
// at render time, which Node tests otherwise can't see (canvas-dependent module).
const composerSrc = fs.readFileSync('src/epaper/composer.js', 'utf8');
const importBlock = composerSrc.match(/import\s*{([^}]*)}\s*from\s*'\.\/ai-layout\.js'/)?.[1] ?? '';
const importedNames = importBlock.split(',').map((s) => s.trim().split(' as ')[0]).filter(Boolean);
for (const fnName of ['renderProceduralBackdropRGBA', 'drawAiPrimaryLayoutCanvas', 'dilateAlphaMaskOutline', 'composeAiSecondScreenOverlay']) {
  const calledInComposer = new RegExp(`\\b${fnName}\\s*\\(`).test(composerSrc.replace(/import[^\n]*\n/g, ''));
  if (calledInComposer) {
    assert.ok(
      importedNames.includes(fnName),
      `composer.js calls ${fnName}() but does not import it from ai-layout.js (re-export alone does not bind a local name)`
    );
  }
}
console.log('[PASS] Composer ai-layout import wiring (no runtime ReferenceError)');
