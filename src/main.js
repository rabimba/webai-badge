// WebAI Badge Studio — Main Application Controller
import {
  EPAPER_HEX,
  EPAPER_NAMES,
  nearestPaletteIndex,
  decodeEpaperToRGBA,
} from './epaper/codec.js';
import {
  composePrimaryBadge,
  composeSecondScreen,
} from './epaper/composer.js';
import {
  formatCounterPreview,
  patchBootcde,
  buildLiveShowBadgeJS,
} from './epaper/bootcde-patcher.js';
import {
  segmentPortraitInBrowser,
  SMART_CROP_PRESETS,
} from './ai/vision.js';
import {
  WebAiBadgeLlmEngine,
  analyzePhotoTelemetry,
} from './ai/llm-designer.js';
import {
  createZipArchive,
  parseZipArchive,
  saveSafetySnapshot,
} from './storage/zip.js';
import { EspruinoBadgeClient } from './transport/espruino-client.js';
import { buildWifiJson, parseWifiJson } from './transport/wifi-provisioning.js';

const assets = {
  cleanBase: null,
  rabimbaBase: null,
  photoBackdrop: null,
  stagePhoto: null,
  currentPhoto: null,
  origBootcdeBytes: null,
};

const state = {
  activeScreen: 'primary', // 'primary' | 'second'
  zoom: 1.0,
  panX: 0.0,
  panY: -0.05,
  ditherMode: 'atkinson',
  contrast: 1.18,
  brightness: 1.0,
  warmthBlend: 0.60,
  sharpness: 0.35,
  useAiCutout: false,
  segmentedCanvas: null,
  stickerOutline: true,

  name: 'Rabimba Karanjai',
  company: 'PayPal / GDE',
  handle: '@rabimba',
  forceCustomCard: false,

  qrEnabled: true,
  qrMode: 'url', // 'url' | 'vcard' | 'wifi' | 'off'
  qrUrl: 'https://www.linkedin.com/in/rabimba/',
  qrEmail: 'rabimba@paypal.com',
  wifiSsid: '',
  wifiPassword: '',
  wifiEnc: 'WPA',

  secondScreenTemplate: 'speaker', // 'speaker' | 'schedule' | 'poster'
  secondScreenTalk: 'Scaling WebAI Agents & Hardware Hacking (PayPal / GDE)',

  counterFormat: 'roman', // 'roman' | 'arabic' | 'hex' | 'binary'
  connectionCount: 14,
  ledColor: '#00f',
  ledCssColor: '#2563eb',

  connections: [],
  scanIds: [
    '60832860', '2986116216', '275320569', '275320569',
    '421682328', '3630428741', '3348903647', '302424290',
    '4045388346', '3095823794', '3934353615', '1729472692',
    '1985322603', '3596240347',
  ],
  deviceInfo: null,

  // Opt-in AI Visual Layout (inactive until user clicks Generate AI Design or selects a theme)
  aiLayout: {
    enabled: false,
    layoutTheme: 'cyber-pcb',
    backdropPattern: 'circuit',
    accentInk: 'yellow',
    headerBadge: 'WEBAI SUMMIT // 2026',
    tags: ['LITERT-LM', 'WEBGPU'],
    reasoning: '',
  },
};

let latestPrimaryResult = null;
let latestSecondResult = null;
let webcamStream = null;
let pulseNeoPixelChaseRef = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function triggerDownload(bytesOrBlob, filename, mime = 'application/octet-stream') {
  const blob =
    bytesOrBlob instanceof Blob
      ? bytesOrBlob
      : new Blob([bytesOrBlob], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function appendConsoleLog({ time, msg, type = 'info' }) {
  const logsEl = $('#consoleLogs');
  const headline = $('#consoleHeadline');
  if (headline) headline.textContent = `[${time}] ${msg}`;
  if (!logsEl) return;
  const line = document.createElement('div');
  line.className = `log-line log-${type}`;
  line.innerHTML = `<span class="log-time">${time}</span><span>${msg.replace(/</g, '&lt;')}</span>`;
  logsEl.appendChild(line);
  logsEl.scrollTop = logsEl.scrollHeight;
}

function setFlashProgress(fraction, label = '') {
  const wrap = $('#flashProgressWrap');
  const fill = $('#flashProgressFill');
  const txt = $('#flashProgressText');
  if (fraction === null) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const pct = Math.round(fraction * 100);
  fill.style.width = `${pct}%`;
  txt.textContent = label || `${pct}%`;
}

function setLlmProgress(fraction, label = '') {
  const wrap = $('#llmProgressWrap');
  const fill = $('#llmProgressFill');
  const txt = $('#llmProgressText');
  if (!wrap || !fill || !txt) return;
  if (fraction === null) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const pct = Math.max(2, Math.min(100, Math.round(fraction * 100)));
  fill.style.width = `${pct}%`;
  txt.textContent = label || `${pct}%`;
}

const llmEngine = new WebAiBadgeLlmEngine({
  onStatus: (statusText) => {
    const tag = $('#llmEngineStatus');
    if (tag) tag.textContent = statusText;
  },
  onProgress: setLlmProgress,
  onLog: appendConsoleLog,
});

function computeCurrentPhotoTelemetry() {
  if (!assets.currentPhoto) return null;
  const off = document.createElement('canvas');
  off.width = 96;
  off.height = 96;
  const octx = off.getContext('2d');
  octx.drawImage(assets.currentPhoto, 0, 0, 96, 96);
  const rgba = octx.getImageData(0, 0, 96, 96).data;
  return analyzePhotoTelemetry(rgba, 96, 96);
}

const badgeClient = new EspruinoBadgeClient({
  onLog: appendConsoleLog,
  onStatusChange: ({ connected, mode }) => {
    const led = $('#statusLed');
    const telemetry = $('#deviceTelemetryText');
    const btnSerial = $('#btnConnectSerial');
    const btnBle = $('#btnConnectBle');
    if (connected) {
      led.classList.add('connected');
      telemetry.textContent = `CONNECTED VIA ${mode.toUpperCase()} • READY TO FLASH`;
      if (mode === 'serial') btnSerial.textContent = '✓ USB-C Connected';
      if (mode === 'bluetooth') btnBle.textContent = '✓ BLE Connected';
      setWifiProvEnabled(true);
    } else {
      led.classList.remove('connected');
      telemetry.textContent = 'SIMULATOR READY • 480×800 2BPP BWYR (96,000 B)';
      btnSerial.innerHTML = '<span class="btn-dot usb"></span> Connect USB-C';
      btnBle.innerHTML = '<span class="btn-dot ble"></span> Connect BLE';
      setWifiProvEnabled(false);
    }
  },
});

function triggerEpaperRefreshAnimation() {
  const overlay = $('#epaperFlashOverlay');
  if (!overlay) return;
  overlay.classList.remove('flashing');
  void overlay.offsetWidth;
  overlay.classList.add('flashing');
}

// Wi-Fi Provisioning card enable/disable (Tab 3). Function declaration so the
// badgeClient onStatusChange callback can safely call it before wiring runs.
function setWifiProvEnabled(connected) {
  const readBtn = $('#btnWifiRead');
  const writeBtn = $('#btnWifiWrite');
  const status = $('#wifiProvStatus');
  if (!readBtn || !writeBtn || !status) return;
  readBtn.disabled = !connected;
  writeBtn.disabled = !connected;
  const title = connected ? '' : 'Connect the badge first';
  readBtn.title = title;
  writeBtn.title = title;
  status.textContent = connected
    ? 'Connected — read current credentials or write new ones'
    : 'No badge connected — connect via USB-C or BLE';
}

function renderActiveBadgeCanvas() {
  latestPrimaryResult = composePrimaryBadge(assets, state);
  latestSecondResult = composeSecondScreen(assets, state);

  const previewCanvas = $('#badgePreviewCanvas');
  const pctx = previewCanvas.getContext('2d');
  const activeRes =
    state.activeScreen === 'second' ? latestSecondResult : latestPrimaryResult;
  const srcCanvas =
    state.activeScreen === 'second'
      ? latestSecondResult.canvas
      : latestPrimaryResult.previewCanvas;

  pctx.clearRect(0, 0, 480, 800);
  pctx.drawImage(srcCanvas, 0, 0);

  // Update CRC32 & 4-Ink distribution telemetry
  const { crc, inkCounts } = activeRes.encoded;
  $('#crcReadout').textContent = String(crc);

  const totalPx = 480 * 800;
  const pcts = inkCounts.map((c) => ((c / totalPx) * 100).toFixed(1));
  $('#barBlack').style.width = `${pcts[0]}%`;
  $('#barWhite').style.width = `${pcts[1]}%`;
  $('#barYellow').style.width = `${pcts[2]}%`;
  $('#barRed').style.width = `${pcts[3]}%`;

  $('#pctBlack').textContent = `${pcts[0]}%`;
  $('#pctWhite').textContent = `${pcts[1]}%`;
  $('#pctYellow').textContent = `${pcts[2]}%`;
  $('#pctRed').textContent = `${pcts[3]}%`;

  const qrBadge = $('#qrStatusBadge');
  if (state.activeScreen === 'second') {
    qrBadge.textContent = `2ND SCREEN (${state.secondScreenTemplate.toUpperCase()}) • 96,000 B`;
  } else if (latestPrimaryResult.qrMeta) {
    qrBadge.textContent = `QR: v${latestPrimaryResult.qrMeta.version} (${latestPrimaryResult.qrMeta.modulesCount}×${latestPrimaryResult.qrMeta.modulesCount}) • 1-BIT SCANNABLE`;
  } else {
    qrBadge.textContent = 'QR: OFF • FULL PORTRAIT BADGE';
  }

  updateFirmwareInspector();
}

function updateFirmwareInspector() {
  const formatted = formatCounterPreview(
    state.connectionCount,
    state.counterFormat
  );
  $('#counterLivePreviewTag').textContent =
    `Preview: ${formatted || '(hidden)'} (${state.connectionCount})`;

  const liveJs = buildLiveShowBadgeJS({
    counterFormat: state.counterFormat,
    ledColor: state.ledColor,
  });
  $('#bootcdeCodePreview').textContent = liveJs;

  if (assets.origBootcdeBytes) {
    try {
      const patched = patchBootcde(assets.origBootcdeBytes, {
        counterFormat: state.counterFormat,
        ledColor: state.ledColor,
      });
      $('#bootcdeStatsLabel').textContent =
        `${patched.length.toLocaleString()} bytes • CRC32: ${patched.crc} • Strip: 64px`;
    } catch (err) {
      $('#bootcdeStatsLabel').textContent = err.message;
    }
  }
}

function setupPixelLoupe() {
  const bezel = $('#epaperBezel');
  const loupe = $('#pixelLoupe');
  const loupeCanvas = $('#loupeCanvas');
  const lctx = loupeCanvas.getContext('2d');
  const meta = $('#loupeMeta');
  const previewCanvas = $('#badgePreviewCanvas');
  const chk = $('#chkPixelLoupe');

  bezel.addEventListener('mousemove', (ev) => {
    if (!chk.checked) {
      loupe.hidden = true;
      return;
    }
    const rect = bezel.getBoundingClientRect();
    const relX = (ev.clientX - rect.left) / rect.width;
    const relY = (ev.clientY - rect.top) / rect.height;
    const bx = Math.max(0, Math.min(479, Math.floor(relX * 480)));
    const by = Math.max(0, Math.min(799, Math.floor(relY * 800)));

    loupe.hidden = false;
    const leftPx = Math.min(rect.width - 138, Math.max(6, ev.clientX - rect.left + 16));
    const topPx = Math.min(rect.height - 156, Math.max(6, ev.clientY - rect.top - 70));
    loupe.style.left = `${leftPx}px`;
    loupe.style.top = `${topPx}px`;

    // Sample 15x15 neighborhood around (bx, by) and magnify 8x -> 120x120
    const pctx = previewCanvas.getContext('2d');
    const radius = 7;
    const sx = Math.max(0, Math.min(480 - 15, bx - radius));
    const sy = Math.max(0, Math.min(800 - 15, by - radius));
    const patch = pctx.getImageData(sx, sy, 15, 15);

    lctx.imageSmoothingEnabled = false;
    const off = document.createElement('canvas');
    off.width = 15;
    off.height = 15;
    off.getContext('2d').putImageData(patch, 0, 0);
    lctx.clearRect(0, 0, 120, 120);
    lctx.drawImage(off, 0, 0, 120, 120);

    // Draw subtle grid & center crosshair
    lctx.strokeStyle = 'rgba(128,128,128,0.28)';
    lctx.lineWidth = 1;
    for (let i = 0; i <= 15; i++) {
      lctx.beginPath();
      lctx.moveTo(i * 8, 0);
      lctx.lineTo(i * 8, 120);
      lctx.stroke();
      lctx.beginPath();
      lctx.moveTo(0, i * 8);
      lctx.lineTo(120, i * 8);
      lctx.stroke();
    }
    lctx.strokeStyle = '#ffcc33';
    lctx.lineWidth = 2;
    lctx.strokeRect((bx - sx) * 8, (by - sy) * 8, 8, 8);

    const centerPx = pctx.getImageData(bx, by, 1, 1).data;
    const idx = nearestPaletteIndex(centerPx[0], centerPx[1], centerPx[2]);
    const bits = idx.toString(2).padStart(2, '0');
    meta.textContent = `(${bx},${by}) ${EPAPER_HEX[idx].toUpperCase()} [${bits}]`;
  });

  bezel.addEventListener('mouseleave', () => {
    loupe.hidden = true;
  });
}

function renderConnectionsUI(filterText = '') {
  const list = state.connections || [];
  $('#tabConnCount').textContent = String(list.length);
  $('#connTotalLabel').textContent = String(list.length);

  const q = filterText.trim().toLowerCase();
  const filtered = list.filter((c) => {
    if (!q) return true;
    const blob = `${c.name || ''} ${c.company || ''} ${c.linkedin || ''} ${c.github || ''} ${c.other || ''} ${c.notes || ''}`.toLowerCase();
    return blob.includes(q);
  });

  const tbody = $('#connTableBody');
  tbody.innerHTML = '';
  filtered.forEach((c, i) => {
    const tr = document.createElement('tr');
    const links = [];
    if (c.linkedin) {
      const url = c.linkedin.startsWith('http') ? c.linkedin : `https://${c.linkedin}`;
      links.push(`<a class="conn-link" href="${url}" target="_blank" rel="noopener">LinkedIn ↗</a>`);
    }
    if (c.github) {
      const url = c.github.startsWith('http')
        ? c.github
        : `https://github.com/${c.github.replace(/^@/, '')}`;
      links.push(`<a class="conn-link" href="${url}" target="_blank" rel="noopener">GitHub ↗</a>`);
    }
    if (c.other) {
      const url = c.other.startsWith('http') ? c.other : `https://${c.other}`;
      links.push(`<a class="conn-link" href="${url}" target="_blank" rel="noopener">Web ↗</a>`);
    }
    const note = c.notes ? `<span style="color:#9ba5b7">${c.notes.replace(/</g, '&lt;')}</span>` : '';
    tr.innerHTML = `
      <td style="font-family:var(--font-mono);color:var(--ink-yellow)">${formatCounterPreview(i + 1, 'roman')}</td>
      <td><b>${(c.name || 'Attendee').replace(/</g, '&lt;')}</b></td>
      <td>${(c.company || '—').replace(/</g, '&lt;')}</td>
      <td>${links.join('')}${note}</td>
    `;
    tbody.appendChild(tr);
  });

  drawNetworkConstellation(list);
}

function drawNetworkConstellation(connections) {
  const canvas = $('#networkGraphCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;

  // Radial grid rings
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (const r of [42, 78, 118]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  const n = connections.length;
  connections.forEach((c, i) => {
    const angle = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
    const rx = (i % 2 === 0 ? 155 : 225);
    const ry = (i % 2 === 0 ? 58 : 78);
    const x = cx + Math.cos(angle) * rx;
    const y = cy + Math.sin(angle) * ry;

    // Edge line
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(255, 204, 51, 0.35)' : 'rgba(219, 55, 39, 0.38)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Node dot
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 === 0 ? '#ffcc33' : '#db3727';
    ctx.fill();

    // Name label
    const firstName = (c.name || 'Peer').split(' ')[0];
    ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#e5e7eb';
    ctx.textAlign = x >= cx ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(firstName, x + (x >= cx ? 8 : -8), y);
  });

  // Center node (Rabimba / Active Badge)
  ctx.beginPath();
  ctx.arc(cx, cy, 14, 0, Math.PI * 2);
  ctx.fillStyle = '#ffcc33';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#db3727';
  ctx.stroke();

  ctx.font = '800 10px "JetBrains Mono", monospace';
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(formatCounterPreview(n, state.counterFormat), cx, cy);
}

function bindEvents() {
  // Studio Tabs
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach((b) => b.classList.remove('active'));
      $$('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.getAttribute('data-tab');
      $(`#${target}`).classList.add('active');
      if (target === 'tab-second') {
        setScreenView('second');
      } else if (target === 'tab-studio') {
        setScreenView('primary');
      }
    });
  });

  // Screen View Toggle (Primary vs 2nd Screen)
  const setScreenView = (mode) => {
    if (state.activeScreen !== mode) {
      state.activeScreen = mode;
      triggerEpaperRefreshAnimation();
    }
    $('#btnViewPrimary').classList.toggle('active', mode === 'primary');
    $('#btnViewSecond').classList.toggle('active', mode === 'second');
    renderActiveBadgeCanvas();
  };

  $('#btnViewPrimary').addEventListener('click', () => setScreenView('primary'));
  $('#btnViewSecond').addEventListener('click', () => setScreenView('second'));

  // Physical Tactile Hardware Buttons on Simulator PCB
  $('#hwBtn1').addEventListener('click', () => {
    setScreenView(state.activeScreen === 'primary' ? 'second' : 'primary');
  });

  $('#hwBtn2').addEventListener('click', () => {
    state.connectionCount = Math.min(399, state.connectionCount + 1);
    $('#inpConnectionCount').value = String(state.connectionCount);
    setScreenView('primary');
    triggerEpaperRefreshAnimation();
  });

  // Exposed later below (hoisted via function declaration)
  window.__pulseNeoPixelChase = () => {
    if (typeof pulseNeoPixelChaseRef === 'function') pulseNeoPixelChaseRef();
  };

  // Smart Framing Presets
  $$('.preset-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.preset-chip').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const key = btn.getAttribute('data-crop');
      const p = SMART_CROP_PRESETS[key];
      if (p) {
        state.zoom = p.zoom;
        state.panX = p.panX;
        state.panY = p.panY;
        syncCropSliders();
        renderActiveBadgeCanvas();
      }
    });
  });

  $('#btnResetCrop').addEventListener('click', () => {
    state.zoom = 1.0;
    state.panX = 0.0;
    state.panY = -0.05;
    syncCropSliders();
    renderActiveBadgeCanvas();
  });

  const syncCropSliders = () => {
    $('#rngZoom').value = String(state.zoom);
    $('#valZoom').textContent = `${state.zoom.toFixed(2)}×`;
    $('#rngPanX').value = String(state.panX);
    $('#valPanX').textContent = `${Math.round(state.panX * 100)}%`;
    $('#rngPanY').value = String(state.panY);
    $('#valPanY').textContent = `${Math.round(state.panY * 100)}%`;
  };

  // Crop & Dither Sliders
  $('#rngZoom').addEventListener('input', (e) => {
    state.zoom = parseFloat(e.target.value);
    $('#valZoom').textContent = `${state.zoom.toFixed(2)}×`;
    renderActiveBadgeCanvas();
  });
  $('#rngPanX').addEventListener('input', (e) => {
    state.panX = parseFloat(e.target.value);
    $('#valPanX').textContent = `${Math.round(state.panX * 100)}%`;
    renderActiveBadgeCanvas();
  });
  $('#rngPanY').addEventListener('input', (e) => {
    state.panY = parseFloat(e.target.value);
    $('#valPanY').textContent = `${Math.round(state.panY * 100)}%`;
    renderActiveBadgeCanvas();
  });

  // Dither Algorithm Chips
  $$('.mode-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.mode-chip').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.ditherMode = btn.getAttribute('data-dither');
      renderActiveBadgeCanvas();
    });
  });

  $('#rngContrast').addEventListener('input', (e) => {
    state.contrast = parseFloat(e.target.value);
    $('#valContrast').textContent = state.contrast.toFixed(2);
    renderActiveBadgeCanvas();
  });
  $('#rngBrightness').addEventListener('input', (e) => {
    state.brightness = parseFloat(e.target.value);
    $('#valBrightness').textContent = state.brightness.toFixed(2);
    renderActiveBadgeCanvas();
  });
  $('#rngWarmth').addEventListener('input', (e) => {
    state.warmthBlend = parseFloat(e.target.value);
    $('#valWarmth').textContent = `${Math.round(state.warmthBlend * 100)}%`;
    renderActiveBadgeCanvas();
  });
  $('#rngSharpness').addEventListener('input', (e) => {
    state.sharpness = parseFloat(e.target.value);
    $('#valSharpness').textContent = state.sharpness.toFixed(2);
    renderActiveBadgeCanvas();
  });

  // Upload Photo
  $('#inputPhotoUpload').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const img = await loadImage(reader.result);
      assets.currentPhoto = img;
      state.segmentedCanvas = null;
      if (state.useAiCutout) {
        await runAiSegmentation();
      }
      renderActiveBadgeCanvas();
    };
    reader.readAsDataURL(file);
  });

  // Webcam Capture
  $('#btnWebcamCapture').addEventListener('click', async () => {
    const drawer = $('#webcamDrawer');
    const video = $('#webcamVideo');
    try {
      webcamStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 720 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
      video.srcObject = webcamStream;
      drawer.hidden = false;
    } catch (err) {
      appendConsoleLog({
        time: new Date().toLocaleTimeString(),
        msg: `Webcam error: ${err.message || err}`,
        type: 'warn',
      });
    }
  });

  const stopWebcam = () => {
    if (webcamStream) {
      webcamStream.getTracks().forEach((t) => t.stop());
      webcamStream = null;
    }
    $('#webcamDrawer').hidden = true;
  };

  $('#btnCloseWebcam').addEventListener('click', stopWebcam);
  $('#btnSnapWebcam').addEventListener('click', async () => {
    const video = $('#webcamVideo');
    if (!video.videoWidth) return;
    const snap = document.createElement('canvas');
    snap.width = video.videoWidth;
    snap.height = video.videoHeight;
    snap.getContext('2d').drawImage(video, 0, 0);
    stopWebcam();
    assets.currentPhoto = snap;
    state.segmentedCanvas = null;
    if (state.useAiCutout) await runAiSegmentation();
    renderActiveBadgeCanvas();
  });

  // WebAI Background Cutout
  const runAiSegmentation = async () => {
    if (!assets.currentPhoto) return;
    $('#aiEngineStatus').textContent = 'Segmenting...';
    const { canvas, engineUsed } = await segmentPortraitInBrowser(assets.currentPhoto);
    state.segmentedCanvas = canvas;
    $('#aiEngineStatus').textContent = engineUsed;
  };

  $('#btnToggleAiCutout').addEventListener('click', async () => {
    state.useAiCutout = !state.useAiCutout;
    $('#btnToggleAiCutout').classList.toggle('active', state.useAiCutout);
    $('#aiCutoutStateText').textContent = state.useAiCutout ? 'ON' : 'OFF';
    if (state.useAiCutout && !state.segmentedCanvas) {
      await runAiSegmentation();
    }
    renderActiveBadgeCanvas();
  });

  // LiteRT-LM & MediaPipe WebGPU AI Badge Designer Controls
  const syncAiPillsUI = () => {
    const activeTheme = state.aiLayout.enabled ? state.aiLayout.layoutTheme : 'classic';
    const activeBackdrop = state.aiLayout.enabled ? state.aiLayout.backdropPattern : 'orig';
    $$('.ai-theme-pill').forEach((b) =>
      b.classList.toggle('active', b.getAttribute('data-aitheme') === activeTheme)
    );
    $$('.ai-backdrop-pill').forEach((b) =>
      b.classList.toggle('active', b.getAttribute('data-aibackdrop') === activeBackdrop)
    );
    const resetBtn = $('#btnResetClassicLayout');
    if (resetBtn) resetBtn.hidden = !state.aiLayout.enabled;
    const customizeRow = $('#aiCustomizeRow');
    if (customizeRow) customizeRow.hidden = !state.aiLayout.enabled;
  };

  const applyAiDesignSpecToStudio = async (spec, engineUsed) => {
    state.aiLayout = {
      enabled: true,
      layoutTheme: spec.layoutTheme,
      backdropPattern: spec.backdropPattern,
      accentInk: spec.accentInk || 'yellow',
      headerBadge: spec.headerBadge,
      tags: spec.tags || [],
      reasoning: spec.reasoning || '',
    };

    // Sync Dither & Gamut Sliders
    state.ditherMode = spec.ditherMode;
    state.contrast = spec.contrast;
    state.brightness = spec.brightness;
    state.warmthBlend = spec.warmthBlend;
    state.sharpness = spec.sharpness;
    $$('.mode-chip').forEach((b) =>
      b.classList.toggle('active', b.getAttribute('data-dither') === state.ditherMode)
    );
    $('#rngContrast').value = String(state.contrast);
    $('#valContrast').textContent = state.contrast.toFixed(2);
    $('#rngBrightness').value = String(state.brightness);
    $('#valBrightness').textContent = state.brightness.toFixed(2);
    $('#rngWarmth').value = String(state.warmthBlend);
    $('#valWarmth').textContent = `${Math.round(state.warmthBlend * 100)}%`;
    $('#rngSharpness').value = String(state.sharpness);
    $('#valSharpness').textContent = state.sharpness.toFixed(2);

    // Sync Framing Preset
    const preset = SMART_CROP_PRESETS[spec.cropPreset];
    if (preset) {
      state.zoom = preset.zoom;
      state.panX = preset.panX;
      state.panY = preset.panY;
      $$('.preset-chip').forEach((b) =>
        b.classList.toggle('active', b.getAttribute('data-crop') === spec.cropPreset)
      );
      syncCropSliders();
    }

    // Sync Background Cutout
    state.useAiCutout = Boolean(spec.useAiCutout);
    $('#btnToggleAiCutout').classList.toggle('active', state.useAiCutout);
    $('#aiCutoutStateText').textContent = state.useAiCutout ? 'ON' : 'OFF';
    if (state.useAiCutout && !state.segmentedCanvas) {
      await runAiSegmentation();
    }

    // Sync Firmware Counter Format & NeoPixel LED Accent
    state.counterFormat = spec.counterFormat;
    $$('.fmt-chip').forEach((b) =>
      b.classList.toggle('active', b.getAttribute('data-fmt') === state.counterFormat)
    );
    state.ledColor = spec.ledColor;
    $$('.led-chip').forEach((b) => {
      const match = b.getAttribute('data-ledcolor') === state.ledColor;
      b.classList.toggle('active', match);
      if (match) {
        const cssCol = b.style.getPropertyValue('--c') || '#2563eb';
        document.documentElement.style.setProperty('--led-active', cssCol);
      }
    });

    // Sync 2nd Screen Template
    state.secondScreenTemplate = spec.secondScreenTemplate;
    $$('.second-tpl-chip').forEach((b) =>
      b.classList.toggle('active', b.getAttribute('data-secondtpl') === state.secondScreenTemplate)
    );

    syncAiPillsUI();
    const reasonBox = $('#aiReasoningBox');
    const reasonTxt = $('#aiReasoningText');
    if (reasonBox && reasonTxt) {
      reasonBox.hidden = false;
      reasonTxt.textContent = `[${engineUsed}] ${spec.reasoning}`;
    }
    $('#llmEngineStatus').textContent = `${engineUsed} • ${spec.layoutTheme}`;
    triggerEpaperRefreshAnimation();
    renderActiveBadgeCanvas();
    drawNetworkConstellation(state.connections);
  };

  const runAiBadgeGeneration = async () => {
    const btnGen = $('#btnGenerateAiDesign');
    const userPrompt = $('#inpAiPrompt')?.value || '';
    if (btnGen) btnGen.disabled = true;
    try {
      const photoTelemetry = computeCurrentPhotoTelemetry();
      const { spec, engineUsed } = await llmEngine.generateBadgeDesign({
        userPrompt,
        currentState: state,
        photoTelemetry,
        onStreamText: (partial) => {
          const reasonBox = $('#aiReasoningBox');
          const reasonTxt = $('#aiReasoningText');
          if (reasonBox && reasonTxt) {
            reasonBox.hidden = false;
            reasonTxt.textContent = `Streaming LiteRT/MediaPipe JSON: ${partial.slice(-110)}`;
          }
        },
      });
      await applyAiDesignSpecToStudio(spec, engineUsed);
      pulseNeoPixelChaseRef?.();
      appendConsoleLog({
        time: new Date().toLocaleTimeString(),
        msg: `AI Design applied (${engineUsed}): theme=${spec.layoutTheme}, backdrop=${spec.backdropPattern}, dither=${spec.ditherMode}.`,
        type: 'ok',
      });
    } catch (err) {
      appendConsoleLog({
        time: new Date().toLocaleTimeString(),
        msg: `AI Designer error: ${err.message || err}`,
        type: 'warn',
      });
    } finally {
      if (btnGen) btnGen.disabled = false;
    }
  };

  $('#btnGenerateAiDesign')?.addEventListener('click', runAiBadgeGeneration);
  $('#inpAiPrompt')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      runAiBadgeGeneration();
    }
  });

  $$('.ai-vibe-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $$('.ai-vibe-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const prompt = chip.getAttribute('data-prompt') || '';
      const inp = $('#inpAiPrompt');
      if (inp) inp.value = prompt;
      runAiBadgeGeneration();
    });
  });

  $('#btnLoadLiteRtModel')?.addEventListener('click', async () => {
    const sel = $('#selLiteRtModel')?.value || 'qwen3-0.6b-litert';
    if (sel === 'local-file') {
      $('#inputLocalLlmFile')?.click();
      return;
    }
    const btn = $('#btnLoadLiteRtModel');
    if (btn) btn.disabled = true;
    try {
      await llmEngine.loadModel(sel);
      if (btn) btn.textContent = '✓ WebGPU LLM Loaded';
    } catch (err) {
      setLlmProgress(null);
      $('#llmEngineStatus').textContent = 'Smart Copilot Fallback';
      appendConsoleLog({
        time: new Date().toLocaleTimeString(),
        msg: `WebGPU Model Load Note: ${err.message || err}`,
        type: 'warn',
      });
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('#inputLocalLlmFile')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await llmEngine.loadModel('local-file', file);
      const btn = $('#btnLoadLiteRtModel');
      if (btn) btn.textContent = `✓ ${file.name.slice(0, 16)}`;
    } catch (err) {
      setLlmProgress(null);
      appendConsoleLog({
        time: new Date().toLocaleTimeString(),
        msg: `Local .litertlm/.task load error: ${err.message || err}`,
        type: 'warn',
      });
    }
  });

  $$('.ai-theme-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      const theme = pill.getAttribute('data-aitheme');
      if (theme === 'classic') {
        state.aiLayout.enabled = false;
        $('#llmEngineStatus').textContent = 'Classic Layout Active';
      } else {
        state.aiLayout.enabled = true;
        state.aiLayout.layoutTheme = theme;
        $('#llmEngineStatus').textContent = `AI Theme • ${theme}`;
      }
      syncAiPillsUI();
      triggerEpaperRefreshAnimation();
      renderActiveBadgeCanvas();
    });
  });

  $$('.ai-backdrop-pill').forEach((pill) => {
    pill.addEventListener('click', async () => {
      const bg = pill.getAttribute('data-aibackdrop');
      state.aiLayout.backdropPattern = bg;
      if (bg !== 'orig') {
        state.aiLayout.enabled = true;
        if (!state.useAiCutout) {
          state.useAiCutout = true;
          $('#btnToggleAiCutout').classList.add('active');
          $('#aiCutoutStateText').textContent = 'ON';
          if (!state.segmentedCanvas) await runAiSegmentation();
        }
      }
      syncAiPillsUI();
      triggerEpaperRefreshAnimation();
      renderActiveBadgeCanvas();
    });
  });

  $('#btnResetClassicLayout')?.addEventListener('click', () => {
    state.aiLayout.enabled = false;
    const reasonBox = $('#aiReasoningBox');
    if (reasonBox) reasonBox.hidden = true;
    $('#llmEngineStatus').textContent = 'Classic Layout Restored';
    syncAiPillsUI();
    syncAiCustomizeRow();
    triggerEpaperRefreshAnimation();
    renderActiveBadgeCanvas();
  });

  // Live-editable AI banner, tags, and accent ink
  const syncAiCustomizeRow = () => {
    const row = $('#aiCustomizeRow');
    if (!row) return;
    row.hidden = !state.aiLayout.enabled;
    if (state.aiLayout.enabled) {
      $('#inpAiHeader').value = state.aiLayout.headerBadge || '';
      $('#inpAiTag1').value = state.aiLayout.tags?.[0] || '';
      $('#inpAiTag2').value = state.aiLayout.tags?.[1] || '';
      $$('.ai-ink-pill').forEach((p) =>
        p.classList.toggle('active', p.getAttribute('data-aiink') === (state.aiLayout.accentInk || 'yellow'))
      );
    }
  };

  $('#inpAiHeader')?.addEventListener('input', (e) => {
    state.aiLayout.headerBadge = e.target.value.toUpperCase().slice(0, 26);
    renderActiveBadgeCanvas();
  });
  $('#inpAiTag1')?.addEventListener('input', (e) => {
    state.aiLayout.tags[0] = e.target.value.toUpperCase().slice(0, 14);
    renderActiveBadgeCanvas();
  });
  $('#inpAiTag2')?.addEventListener('input', (e) => {
    state.aiLayout.tags[1] = e.target.value.toUpperCase().slice(0, 14);
    renderActiveBadgeCanvas();
  });
  $$('.ai-ink-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      state.aiLayout.accentInk = pill.getAttribute('data-aiink');
      $$('.ai-ink-pill').forEach((p) =>
        p.classList.toggle('active', p === pill)
      );
      renderActiveBadgeCanvas();
    });
  });

  // Sticker Outline Toggle (die-cut 4-ink border around cutout subject)
  $('#btnToggleStickerOutline')?.addEventListener('click', () => {
    state.stickerOutline = !state.stickerOutline;
    $('#btnToggleStickerOutline').classList.toggle('active', state.stickerOutline);
    $('#stickerOutlineStateText').textContent = state.stickerOutline ? 'ON' : 'OFF';
    renderActiveBadgeCanvas();
  });

  // Direct Drag-to-Pan & Wheel-Zoom on the badge photo box
  const setupCanvasPanZoom = () => {
    const bezel = $('#epaperBezel');
    const previewCanvas = $('#badgePreviewCanvas');
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const inPhotoBox = (ev) => {
      const rect = bezel.getBoundingClientRect();
      const rx = (ev.clientX - rect.left) / rect.width;
      const ry = (ev.clientY - rect.top) / rect.height;
      // PHOTO_BOX upright coords: x 47..433, y 17..406
      const bx = rx * 480;
      const by = ry * 800;
      return bx >= 47 && bx <= 433 && by >= 17 && by <= 406;
    };

    bezel.addEventListener('mousemove', (ev) => {
      if (dragging) return;
      bezel.classList.toggle('pan-ready', inPhotoBox(ev));
    });

    bezel.addEventListener('mousedown', (ev) => {
      if (!inPhotoBox(ev)) return;
      dragging = true;
      lastX = ev.clientX;
      lastY = ev.clientY;
      bezel.classList.add('panning');
      bezel.classList.remove('pan-ready');
      ev.preventDefault();
    });

    window.addEventListener('mousemove', (ev) => {
      if (!dragging) return;
      const rect = bezel.getBoundingClientRect();
      const dx = ((ev.clientX - lastX) / rect.width) * 480 / 480;
      const dy = ((ev.clientY - lastY) / rect.height) * 800 / 800;
      lastX = ev.clientX;
      lastY = ev.clientY;
      state.panX = Math.max(-0.6, Math.min(0.6, state.panX + dx));
      state.panY = Math.max(-0.6, Math.min(0.6, state.panY + dy));
      syncCropSliders();
      renderActiveBadgeCanvas();
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      bezel.classList.remove('panning');
    });

    bezel.addEventListener('wheel', (ev) => {
      if (!inPhotoBox(ev)) return;
      ev.preventDefault();
      const delta = ev.deltaY < 0 ? 0.08 : -0.08;
      state.zoom = Math.max(0.8, Math.min(3.0, state.zoom + delta));
      syncCropSliders();
      renderActiveBadgeCanvas();
    }, { passive: false });
  };

  setupCanvasPanZoom();

  // Hold-to-Compare Classic preview
  const holdCompare = $('#btnHoldCompare');
  let holdTimer = null;
  const startHold = (ev) => {
    ev.preventDefault();
    if (holdTimer) return;
    holdTimer = setTimeout(() => {
      const saved = { ...state, aiLayout: { ...state.aiLayout } };
      state._holdSaved = saved;
      state.aiLayout.enabled = false;
      state.useAiCutout = false;
      state.stickerOutline = false;
      state.name = 'Rabimba Karanjai';
      state.company = 'PayPal / GDE';
      state.handle = '@rabimba';
      state.forceCustomCard = false;
      latestPrimaryResult = composePrimaryBadge(assets, state);
      const pctx = $('#badgePreviewCanvas').getContext('2d');
      pctx.clearRect(0, 0, 480, 800);
      pctx.drawImage(latestPrimaryResult.previewCanvas, 0, 0);
      $('#llmEngineStatus').textContent = 'Holding Classic Preview...';
    }, 180);
  };
  const endHold = () => {
    if (!holdTimer) return;
    clearTimeout(holdTimer);
    holdTimer = null;
    if (state._holdSaved) {
      const saved = state._holdSaved;
      state.aiLayout = saved.aiLayout;
      state.useAiCutout = saved.useAiCutout;
      state.stickerOutline = saved.stickerOutline;
      state.name = saved.name;
      state.company = saved.company;
      state.handle = saved.handle;
      state._holdSaved = null;
      $('#llmEngineStatus').textContent = state.aiLayout.enabled
        ? `AI Theme • ${state.aiLayout.layoutTheme}`
        : 'Classic Layout Active';
      renderActiveBadgeCanvas();
    }
  };
  holdCompare?.addEventListener('mousedown', startHold);
  holdCompare?.addEventListener('touchstart', startHold, { passive: false });
  holdCompare?.addEventListener('mouseup', endHold);
  holdCompare?.addEventListener('mouseleave', endHold);
  holdCompare?.addEventListener('touchend', endHold);

  // NeoPixel perimeter chase animation
  const pulseNeoPixelChaseImpl = () => {
    const leds = $$('.neopixel');
    leds.forEach((led, i) => {
      setTimeout(() => {
        led.classList.remove('chase');
        void led.offsetWidth;
        led.classList.add('chase');
      }, i * 90);
    });
  };
  pulseNeoPixelChaseRef = pulseNeoPixelChaseImpl;

  // Identity Inputs
  $('#inpName').addEventListener('input', (e) => {
    state.name = e.target.value;
    renderActiveBadgeCanvas();
  });
  $('#inpCompany').addEventListener('input', (e) => {
    state.company = e.target.value;
    renderActiveBadgeCanvas();
  });
  $('#inpHandle').addEventListener('input', (e) => {
    state.handle = e.target.value;
    renderActiveBadgeCanvas();
  });

  // QR Mode Pills & Inputs
  $$('.qr-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.qr-pill').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.getAttribute('data-qrmode');
      state.qrMode = mode;
      state.qrEnabled = mode !== 'off';
      $('#qrFieldsUrl').hidden = mode !== 'url';
      $('#qrFieldsVcard').hidden = mode !== 'vcard';
      $('#qrFieldsWifi').hidden = mode !== 'wifi';
      renderActiveBadgeCanvas();
    });
  });

  $('#inpQrUrl').addEventListener('input', (e) => {
    state.qrUrl = e.target.value;
    renderActiveBadgeCanvas();
  });
  $('#inpQrEmail').addEventListener('input', (e) => {
    state.qrEmail = e.target.value;
    renderActiveBadgeCanvas();
  });
  $('#inpQrVcardUrl').addEventListener('input', (e) => {
    state.qrUrl = e.target.value;
    renderActiveBadgeCanvas();
  });
  $('#inpWifiSsid').addEventListener('input', (e) => {
    state.wifiSsid = e.target.value;
    renderActiveBadgeCanvas();
  });
  $('#inpWifiPass').addEventListener('input', (e) => {
    state.wifiPassword = e.target.value;
    renderActiveBadgeCanvas();
  });

  // 2nd Screen Templates
  $$('.second-tpl-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.second-tpl-chip').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.secondScreenTemplate = btn.getAttribute('data-secondtpl');
      setScreenView('second');
    });
  });

  $('#inpSecondTalk').addEventListener('input', (e) => {
    state.secondScreenTalk = e.target.value;
    renderActiveBadgeCanvas();
  });

  // Firmware Counter Format & LED Chips
  $$('.fmt-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.fmt-chip').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.counterFormat = btn.getAttribute('data-fmt');
      renderActiveBadgeCanvas();
      drawNetworkConstellation(state.connections);
    });
  });

  $('#inpConnectionCount').addEventListener('input', (e) => {
    state.connectionCount = Math.max(0, Math.min(399, parseInt(e.target.value || '0', 10)));
    renderActiveBadgeCanvas();
  });

  $$('.led-chip').forEach((btn) => {
    btn.addEventListener('click', async () => {
      $$('.led-chip').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.ledColor = btn.getAttribute('data-ledcolor');
      const cssCol = btn.style.getPropertyValue('--c') || '#2563eb';
      document.documentElement.style.setProperty('--led-active', cssCol);
      updateFirmwareInspector();
      if (badgeClient.isConnected) {
        await badgeClient.setLEDs(state.ledColor);
      }
    });
  });

  // Downloads (.epaper, .png, programme.epaper, .bootcde, .zip)
  $('#btnDownloadEpaper').addEventListener('click', () => {
    if (!latestPrimaryResult) return;
    triggerDownload(latestPrimaryResult.encoded.bytes, 'badge.epaper');
  });

  $('#btnDownloadPng').addEventListener('click', () => {
    const canvas = $('#badgePreviewCanvas');
    canvas.toBlob((blob) => {
      if (blob) triggerDownload(blob, 'webai-badge-preview.png', 'image/png');
    }, 'image/png');
  });

  $('#btnDownloadProgramme').addEventListener('click', () => {
    if (!latestSecondResult) return;
    triggerDownload(latestSecondResult.encoded.bytes, 'programme.epaper');
  });

  $('#btnDownloadBootcde').addEventListener('click', () => {
    if (!assets.origBootcdeBytes) return;
    const patched = patchBootcde(assets.origBootcdeBytes, {
      counterFormat: state.counterFormat,
      ledColor: state.ledColor,
    });
    triggerDownload(patched.bytes, '.bootcde');
  });

  // Connections Search & Export
  $('#inpSearchConn').addEventListener('input', (e) => {
    renderConnectionsUI(e.target.value);
  });

  $('#btnExportJson').addEventListener('click', () => {
    const str = JSON.stringify(state.connections, null, 2);
    triggerDownload(new TextEncoder().encode(str), 'webai2026-connections.json', 'application/json');
  });

  $('#btnExportCsv').addEventListener('click', () => {
    const headers = ['index', 'roman', 'name', 'company', 'linkedin', 'github', 'other', 'notes'];
    const esc = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
    const rows = [
      headers.join(','),
      ...state.connections.map((c, i) =>
        [
          i + 1,
          formatCounterPreview(i + 1, 'roman'),
          esc(c.name),
          esc(c.company),
          esc(c.linkedin),
          esc(c.github),
          esc(c.other),
          esc(c.notes),
        ].join(',')
      ),
    ];
    triggerDownload(new TextEncoder().encode(rows.join('\n')), 'webai2026-connections.csv', 'text/csv');
  });

  // Full Device ZIP Backup & Restore
  $('#btnDownloadFullZip').addEventListener('click', () => {
    const files = [];
    if (latestPrimaryResult) {
      files.push({ name: 'badge.epaper', data: latestPrimaryResult.encoded.bytes });
    }
    if (latestSecondResult) {
      files.push({ name: 'programme.epaper', data: latestSecondResult.encoded.bytes });
    }
    if (assets.origBootcdeBytes) {
      const patched = patchBootcde(assets.origBootcdeBytes, {
        counterFormat: state.counterFormat,
        ledColor: state.ledColor,
      });
      files.push({ name: '.bootcde', data: patched.bytes });
    }
    files.push({ name: 'connections.json', data: JSON.stringify(state.connections, null, 2) });
    files.push({ name: 'scans.txt', data: state.scanIds.slice(0, state.connectionCount).join('\n') + '\n' });
    files.push({
      name: 'id.json',
      data: JSON.stringify(
        state.deviceInfo?.id || {
          id: 236809134,
          name: state.name,
          company: state.company,
          serial: '90da729c-e8d4',
        },
        null,
        2
      ),
    });
    const zipBytes = createZipArchive(files);
    triggerDownload(zipBytes, 'webai-badge-full-backup.zip', 'application/zip');
  });

  $('#inputRestoreFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    if (file.name.endsWith('.epaper')) {
      const rgba = decodeEpaperToRGBA(new Uint8Array(buf));
      const c = document.createElement('canvas');
      c.width = 480;
      c.height = 800;
      c.getContext('2d').putImageData(new ImageData(rgba, 480, 800), 0, 0);
      $('#badgePreviewCanvas').getContext('2d').drawImage(c, 0, 0);
      appendConsoleLog({
        time: new Date().toLocaleTimeString(),
        msg: `Loaded raw ${file.name} (96,000 bytes) into preview.`,
        type: 'ok',
      });
    } else if (file.name.endsWith('.zip')) {
      const entries = await parseZipArchive(buf);
      if (entries['connections.json']) {
        state.connections = JSON.parse(new TextDecoder().decode(entries['connections.json']));
        state.connectionCount = state.connections.length;
        $('#inpConnectionCount').value = String(state.connectionCount);
        renderConnectionsUI();
      }
      renderActiveBadgeCanvas();
      appendConsoleLog({
        time: new Date().toLocaleTimeString(),
        msg: `Restored ${Object.keys(entries).length} files from ${file.name}.`,
        type: 'ok',
      });
    }
  });

  $('#btnRestoreFactory').addEventListener('click', () => {
    assets.currentPhoto = assets.stagePhoto;
    state.useAiCutout = false;
    state.segmentedCanvas = null;
    $('#btnToggleAiCutout').classList.remove('active');
    $('#aiCutoutStateText').textContent = 'OFF';
    state.zoom = 1.0;
    state.panX = 0.0;
    state.panY = -0.05;
    state.name = 'Rabimba Karanjai';
    state.company = 'PayPal / GDE';
    state.handle = '@rabimba';
    state.qrMode = 'url';
    state.qrEnabled = true;
    state.qrUrl = 'https://www.linkedin.com/in/rabimba/';
    state.counterFormat = 'roman';
    state.connectionCount = 14;
    $('#inpName').value = state.name;
    $('#inpCompany').value = state.company;
    $('#inpHandle').value = state.handle;
    $('#inpQrUrl').value = state.qrUrl;
    $('#inpConnectionCount').value = '14';
    state.aiLayout.enabled = false;
    const reasonBox = $('#aiReasoningBox');
    if (reasonBox) reasonBox.hidden = true;
    syncAiPillsUI();
    syncCropSliders();
    renderActiveBadgeCanvas();
  });

  // Web Serial & Web Bluetooth Connections + Live Flashing
  const handlePostConnect = async (info) => {
    state.deviceInfo = info;
    if (info.id?.serial) {
      $('#pcbSerialStamp').innerHTML = `SN: ${info.id.serial} • CRC32: <span id="crcReadout">${latestPrimaryResult?.encoded.crc || ''}</span>`;
    }
    if (Array.isArray(info.connections) && info.connections.length > 0) {
      state.connections = info.connections;
      renderConnectionsUI();
    }
    if (Array.isArray(info.scanLines) && info.scanLines.length > 0) {
      state.scanIds = info.scanLines;
      state.connectionCount = info.scanLines.length;
      $('#inpConnectionCount').value = String(state.connectionCount);
      renderActiveBadgeCanvas();
    }
    await saveSafetySnapshot(info.id?.serial || 'latest', {
      connections: state.connections,
      scanIds: state.scanIds,
    });
  };

  $('#btnConnectSerial').addEventListener('click', async () => {
    try {
      const info = await badgeClient.connectSerial();
      await handlePostConnect(info);
    } catch (err) {
      appendConsoleLog({
        time: new Date().toLocaleTimeString(),
        msg: `Serial connection error: ${err.message || err}`,
        type: 'warn',
      });
    }
  });

  $('#btnConnectBle').addEventListener('click', async () => {
    try {
      const info = await badgeClient.connectBluetooth();
      await handlePostConnect(info);
    } catch (err) {
      appendConsoleLog({
        time: new Date().toLocaleTimeString(),
        msg: `Bluetooth connection error: ${err.message || err}`,
        type: 'warn',
      });
    }
  });

  const ensureConnectedForFlash = async () => {
    if (!badgeClient.isConnected) {
      const info = await badgeClient.connectSerial();
      await handlePostConnect(info);
    }
  };

  // ===== Wi-Fi Provisioning (wifi.json over Web Serial/BLE) =====
  const setWifiProvStatus = (msg, type = 'ok') => {
    const el = $('#wifiProvStatus');
    if (el) el.textContent = msg;
    appendConsoleLog({ time: new Date().toLocaleTimeString(), msg: `[wifi] ${msg}`, type });
  };

  const fillWifiProvForm = (obj) => {
    $('#inpProvSsid').value = obj.ssid || '';
    $('#inpProvPass').value = obj.options?.password || '';
    $('#inpProvBackupSsid').value = obj.backup_ssid || '';
    $('#inpProvBackupPass').value = obj.backup_options?.password || '';
  };

  $('#btnProvShowPass')?.addEventListener('click', () => {
    const pass = $('#inpProvPass');
    pass.type = pass.type === 'password' ? 'text' : 'password';
  });

  $('#btnWifiRead')?.addEventListener('click', async () => {
    try {
      // wifi.json is a small variable-length file; read a generous fixed window
      // and trim the Espruino padding (empty string fills) before parsing.
      const raw = await badgeClient.readStorageFile('wifi.json', 4096);
      const text = new TextDecoder().decode(raw);
      const obj = parseWifiJson(text);
      fillWifiProvForm(obj);
      setWifiProvStatus(
        `Read from badge: SSID '${obj.ssid}'${obj.backup_ssid ? ` (backup: '${obj.backup_ssid}')` : ''}`
      );
    } catch (err) {
      setWifiProvStatus(`Read failed: ${err.message || err}`, 'warn');
    }
  });

  $('#btnWifiWrite')?.addEventListener('click', async () => {
    try {
      const { json, obj } = buildWifiJson({
        ssid: $('#inpProvSsid').value,
        password: $('#inpProvPass').value,
        backupSsid: $('#inpProvBackupSsid').value,
        backupPassword: $('#inpProvBackupPass').value,
      });
      setWifiProvStatus(`Writing wifi.json (${json.length}B, SSID '${obj.ssid}')...`, 'cmd');
      await badgeClient.writeStorageFile('wifi.json', new TextEncoder().encode(json));
      setWifiProvStatus(`Written + CRC32 verified: SSID '${obj.ssid}' — badge will use it on next Wi-Fi connect`);
      pulseNeoPixelChaseRef?.();
    } catch (err) {
      setWifiProvStatus(`Write failed: ${err.message || err}`, 'warn');
    }
  });

  $('#btnFlashBadge').addEventListener('click', async () => {
    try {
      await ensureConnectedForFlash();
      $('#consoleBody').hidden = false;
      setFlashProgress(0, '0%');
      await badgeClient.writeStorageFile(
        'badge.epaper',
        latestPrimaryResult.encoded.bytes,
        (frac, done, total) => setFlashProgress(frac, `${Math.round(frac * 100)}% (${done}/${total}B)`)
      );
      if (assets.origBootcdeBytes) {
        const patched = patchBootcde(assets.origBootcdeBytes, {
          counterFormat: state.counterFormat,
          ledColor: state.ledColor,
        });
        await badgeClient.writeStorageFile('.bootcde', patched.bytes, (frac) =>
          setFlashProgress(frac, `.bootcde ${Math.round(frac * 100)}%`)
        );
      }
      await badgeClient.writeScansCount(state.scanIds, state.connectionCount);
      setFlashProgress(1, 'Refreshing ePaper...');
      await badgeClient.refreshBadgeDisplay({
        counterFormat: state.counterFormat,
        ledColor: state.ledColor,
        keepBlueLEDs: state.ledColor === '#00f',
      });
      await badgeClient.setLEDs(state.ledColor);
      triggerEpaperRefreshAnimation();
      pulseNeoPixelChaseRef?.();
      setTimeout(() => setFlashProgress(null), 2500);
    } catch (err) {
      setFlashProgress(null);
      appendConsoleLog({
        time: new Date().toLocaleTimeString(),
        msg: `Flash failed: ${err.message || err}`,
        type: 'warn',
      });
    }
  });

  $('#btnFlashProgramme').addEventListener('click', async () => {
    try {
      await ensureConnectedForFlash();
      $('#consoleBody').hidden = false;
      setFlashProgress(0, '0%');
      await badgeClient.writeStorageFile(
        'programme.epaper',
        latestSecondResult.encoded.bytes,
        (frac, done, total) => setFlashProgress(frac, `${Math.round(frac * 100)}% (${done}/${total}B)`)
      );
      setFlashProgress(1, 'Refreshing 2nd Screen...');
      await badgeClient.refreshProgrammeDisplay();
      triggerEpaperRefreshAnimation();
      setTimeout(() => setFlashProgress(null), 2500);
    } catch (err) {
      setFlashProgress(null);
      appendConsoleLog({
        time: new Date().toLocaleTimeString(),
        msg: `2nd Screen flash failed: ${err.message || err}`,
        type: 'warn',
      });
    }
  });

  $('#btnFlashFirmware').addEventListener('click', async () => {
    try {
      await ensureConnectedForFlash();
      $('#consoleBody').hidden = false;
      const patched = patchBootcde(assets.origBootcdeBytes, {
        counterFormat: state.counterFormat,
        ledColor: state.ledColor,
      });
      setFlashProgress(0, 'Flashing .bootcde...');
      await badgeClient.writeStorageFile('.bootcde', patched.bytes, (frac) =>
        setFlashProgress(frac, `.bootcde ${Math.round(frac * 100)}%`)
      );
      await badgeClient.writeScansCount(state.scanIds, state.connectionCount);
      setFlashProgress(1, 'Refreshing ePaper...');
      await badgeClient.refreshBadgeDisplay({
        counterFormat: state.counterFormat,
        ledColor: state.ledColor,
        keepBlueLEDs: state.ledColor === '#00f',
      });
      await badgeClient.setLEDs(state.ledColor);
      triggerEpaperRefreshAnimation();
      pulseNeoPixelChaseRef?.();
      setTimeout(() => setFlashProgress(null), 2500);
    } catch (err) {
      setFlashProgress(null);
      appendConsoleLog({
        time: new Date().toLocaleTimeString(),
        msg: `Firmware flash failed: ${err.message || err}`,
        type: 'warn',
      });
    }
  });

  // Console Drawer Toggle & Custom REPL One-Liner
  const toggleConsole = () => {
    const body = $('#consoleBody');
    body.hidden = !body.hidden;
    $('#btnToggleConsole').textContent = body.hidden ? 'Expand Console ▲' : 'Collapse Console ▼';
  };
  $('#consoleToggleBar').addEventListener('click', toggleConsole);

  $('#formReplCmd').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const inp = $('#inpReplCmd');
    const expr = inp.value.trim();
    if (!expr) return;
    inp.value = '';
    try {
      await ensureConnectedForFlash();
      appendConsoleLog({ time: new Date().toLocaleTimeString(), msg: `> ${expr}`, type: 'cmd' });
      const res = await badgeClient.runCommand(
        `print("<<<START>>>"+JSON.stringify((function(){return eval(${JSON.stringify(expr)});})())+"<<<END>>>")`
      );
      appendConsoleLog({ time: new Date().toLocaleTimeString(), msg: res, type: 'ok' });
    } catch (err) {
      appendConsoleLog({
        time: new Date().toLocaleTimeString(),
        msg: `REPL Error: ${err.message || err}`,
        type: 'warn',
      });
    }
  });
}

async function initStudio() {
  try {
    bindEvents();
    setupPixelLoupe();

  const [cleanBase, rabimbaBase, photoBackdrop, stagePhoto, bootResp, connResp] =
    await Promise.all([
      loadImage('./public/templates/webai_clean_base.png').catch(() =>
        loadImage('./templates/webai_clean_base.png')
      ),
      loadImage('./public/templates/webai_rabimba_base.png').catch(() =>
        loadImage('./templates/webai_rabimba_base.png')
      ),
      loadImage('./public/templates/webai_photo_backdrop.png').catch(() =>
        loadImage('./templates/webai_photo_backdrop.png')
      ),
      loadImage('./public/templates/stage_source.jpg').catch(() =>
        loadImage('./templates/stage_source.jpg')
      ),
      fetch('./public/templates/orig_bootcde.bin')
        .then((r) => (r.ok ? r : fetch('./templates/orig_bootcde.bin')))
        .then((r) => r.arrayBuffer()),
      fetch('./public/templates/sample_connections.json')
        .then((r) => (r.ok ? r : fetch('./templates/sample_connections.json')))
        .then((r) => r.json()),
    ]);

  assets.cleanBase = cleanBase;
  assets.rabimbaBase = rabimbaBase;
  assets.photoBackdrop = photoBackdrop;
  assets.stagePhoto = stagePhoto;
  assets.currentPhoto = stagePhoto;
  assets.origBootcdeBytes = new Uint8Array(bootResp);
  state.connections = connResp;
  state.connectionCount = connResp.length;

  renderConnectionsUI();
  renderActiveBadgeCanvas();

  appendConsoleLog({
    time: new Date().toLocaleTimeString(),
    msg: 'WebAI Badge Studio initialized. Preset: Rabimba Karanjai (PayPal / GDE) + @rabimba + LinkedIn QR + Roman Counter (XIV).',
    type: 'ok',
  });
  } catch (err) {
    // Never die silently: a failed init leaves a black badge preview with no clue why.
    appendConsoleLog({
      time: new Date().toLocaleTimeString(),
      msg: `Studio init failed: ${err.message || err}`,
      type: 'warn',
    });
    console.error('[initStudio]', err);
  }
}

initStudio();
