// Unified Web Serial (USB-C) & Web Bluetooth (Nordic UART) Espruino REPL Client
// Implements 64-byte / 3ms throttled packet pacing for ESP32-C3 USB-JTAG FIFO + CRC32 verification.

import { crc32 } from '../epaper/codec.js';
import { buildLiveShowBadgeJS } from '../epaper/bootcde-patcher.js';

const NORDIC_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_TX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_RX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WAKE_HINT =
  'press BTN1 to wake it (or hold BTN2 until the LEDs turn blue for connectable mode), then click Connect USB-C again within a few seconds.';

// Runs once right after the USB-C handshake. RAM-only; reverted by load() on disconnect.
// _ka() is an idle watchdog: if the Studio sends nothing for 10 min (tab closed, cable pulled),
// the badge reloads its firmware and resumes the normal sleep cycle instead of draining the battery.
const KEEP_AWAKE_IDLE_MS = 600000;
const KEEP_AWAKE_JS =
  'clearInterval();clearTimeout();clearWatch();' +
  `global._ka=function(){if(global._kaT)clearTimeout(_kaT);_kaT=setTimeout(load,${KEEP_AWAKE_IDLE_MS});};_ka();` +
  'if(global.Badge)Badge.sleep=function(){print("[Studio] Badge.sleep() suppressed while USB-C connected");};' +
  'print("<<<START>>>OK<<<END>>>")';

export function uint8ToBase64(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8(b64) {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export class EspruinoBadgeClient {
  constructor({ onLog, onStatusChange } = {}) {
    this.mode = null; // 'serial' | 'bluetooth' | null
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.bleDevice = null;
    this.bleTxChar = null;
    this.rxBuffer = '';
    this.busy = false;
    this.onLog = onLog || (() => {});
    this.onStatusChange = onStatusChange || (() => {});
  }

  get isConnected() {
    return this.mode !== null;
  }

  log(msg, type = 'info') {
    this.onLog({ time: new Date().toLocaleTimeString(), msg, type });
  }

  async connectSerial() {
    if (!('serial' in navigator)) {
      throw new Error('Web Serial API is not supported in this browser. Use Chrome or Edge over HTTPS / localhost.');
    }
    if (this.isConnected) await this.disconnect();

    this.log('Requesting USB-C serial port (115200 baud)...', 'cmd');
    let port;
    try {
      port = await navigator.serial.requestPort();
    } catch (err) {
      if (err && err.name === 'NotFoundError') {
        throw new Error(
          `No serial port selected. If the badge is not listed it is in deep sleep (USB is off while asleep): ${WAKE_HINT}`
        );
      }
      throw err;
    }
    try {
      await port.open({ baudRate: 115200, bufferSize: 65536 });
    } catch (err) {
      throw new Error(
        `Could not open the badge serial port (${err.message || err}). Close any other app using it (Espruino Web IDE, screen, Arduino serial monitor, another Studio tab) and retry.`
      );
    }

    this.port = port;
    this.writer = port.writable.getWriter();
    this.mode = 'serial';
    this.rxBuffer = '';
    this._readLoopDone = this._startSerialReadLoop();

    try {
      // Send Ctrl+C twice to clear any partial REPL line without resetting
      await this._writeRawBytes(new Uint8Array([0x03, 0x03, 0x0a]));
      await sleep(150);
      this.rxBuffer = '';

      // The firmware deep-sleeps (Badge.sleep) after every screen update and after a ~10s idle
      // animation. ESP32-C3 deep sleep powers down USB-Serial-JTAG, so the port goes dead mid-session.
      // Cancel pending firmware timers/watches and no-op Badge.sleep in RAM; disconnect() runs load()
      // to restore the normal firmware cycle. This handshake doubles as a fast "is it awake?" probe.
      try {
        await this.runCommand(KEEP_AWAKE_JS, { timeout: 3000 });
      } catch {
        throw new Error(`Badge did not respond over USB-C. It is most likely asleep: ${WAKE_HINT}`);
      }
      this._sleepSuppressed = true;

      const info = await this.fetchDeviceInfo();
      this.onStatusChange({ connected: true, mode: 'serial' });
      this.log('Connected via USB-C Web Serial (ESP32-C3 CDC).', 'ok');
      return info;
    } catch (err) {
      await this.disconnect({ silent: true });
      throw err;
    }
  }

  async connectBluetooth() {
    if (!('bluetooth' in navigator)) {
      throw new Error('Web Bluetooth API is not supported in this browser. Use Chrome or Edge.');
    }
    if (this.isConnected) await this.disconnect();

    this.log('Scanning for Espruino / WebAI Badge over BLE...', 'cmd');
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: 'Espruino' },
        { namePrefix: 'Badge' },
        { services: [NORDIC_SERVICE] },
      ],
      optionalServices: [NORDIC_SERVICE],
    });

    device.addEventListener('gattserverdisconnected', () => {
      this.mode = null;
      this.onStatusChange({ connected: false, mode: null });
      this.log('Bluetooth device disconnected.', 'warn');
    });

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(NORDIC_SERVICE);
    const txChar = await service.getCharacteristic(NORDIC_TX);
    const rxChar = await service.getCharacteristic(NORDIC_RX);

    await rxChar.startNotifications();
    const decoder = new TextDecoder();
    rxChar.addEventListener('characteristicvaluechanged', (ev) => {
      const chunk = decoder.decode(ev.target.value);
      this.rxBuffer += chunk;
    });

    this.bleDevice = device;
    this.bleTxChar = txChar;
    this.mode = 'bluetooth';
    this.rxBuffer = '';

    await this._writeRawBytes(new Uint8Array([0x03, 0x03, 0x0a]));
    await sleep(200);
    this.rxBuffer = '';

    this.onStatusChange({ connected: true, mode: 'bluetooth' });
    this.log(`Connected via Web Bluetooth (${device.name || 'Espruino Badge'}).`, 'ok');
    return this.fetchDeviceInfo();
  }

  async _startSerialReadLoop() {
    const decoder = new TextDecoder();
    try {
      while (this.port && this.port.readable && this.mode === 'serial') {
        this.reader = this.port.readable.getReader();
        try {
          while (true) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value) {
              this.rxBuffer += decoder.decode(value, { stream: true });
            }
          }
        } finally {
          this.reader.releaseLock();
          this.reader = null;
        }
      }
    } catch (err) {
      if (this.mode === 'serial') {
        this.mode = null;
        this.onStatusChange({ connected: false, mode: null });
        this.log(`USB Serial disconnected: ${err.message || err}`, 'warn');
      }
    }
  }

  async disconnect({ silent = false } = {}) {
    const prevMode = this.mode;
    if (this._sleepSuppressed && prevMode === 'serial' && this.writer) {
      // Reload firmware so the badge resumes its normal display/sleep cycle (saves battery).
      try {
        await this._writeRawBytes(new TextEncoder().encode('\x10load()\n'));
        await sleep(50);
      } catch {}
    }
    this._sleepSuppressed = false;
    this.mode = null;
    try {
      if (this.reader) await this.reader.cancel();
    } catch {}
    // Wait for the read loop to release its lock; port.close() rejects while a stream is locked,
    // which previously left the port open and made the next connect fail with "port is already open".
    try {
      if (this._readLoopDone) await this._readLoopDone;
    } catch {}
    this._readLoopDone = null;
    try {
      if (this.writer) {
        this.writer.releaseLock();
        this.writer = null;
      }
    } catch {}
    try {
      if (this.port) await this.port.close();
    } catch {}
    this.port = null;
    try {
      if (this.bleDevice && this.bleDevice.gatt.connected) {
        this.bleDevice.gatt.disconnect();
      }
    } catch {}
    this.onStatusChange({ connected: false, mode: null });
    if (prevMode && !silent) this.log(`Disconnected (${prevMode}).`, 'info');
  }

  async _writeRawBytes(bytes) {
    if (this.mode === 'serial' && this.writer) {
      // 64-byte USB packet pacing with 3ms pause so ESP32-C3 USB-JTAG RX FIFO never drops bytes
      const packetSize = 64;
      for (let i = 0; i < bytes.length; i += packetSize) {
        const slice = bytes.subarray(i, Math.min(i + packetSize, bytes.length));
        await this.writer.write(slice);
        if (i + packetSize < bytes.length) await sleep(3);
      }
    } else if (this.mode === 'bluetooth' && this.bleTxChar) {
      const packetSize = 20;
      for (let i = 0; i < bytes.length; i += packetSize) {
        const slice = bytes.subarray(i, Math.min(i + packetSize, bytes.length));
        if (this.bleTxChar.writeValueWithoutResponse) {
          await this.bleTxChar.writeValueWithoutResponse(slice);
        } else {
          await this.bleTxChar.writeValue(slice);
        }
        await sleep(8);
      }
    } else {
      throw new Error('Badge is not connected');
    }
  }

  async runCommand(js, { startMarker = '<<<START>>>', endMarker = '<<<END>>>', timeout = 12000 } = {}) {
    if (!this.isConnected) throw new Error('Badge is not connected');
    this.rxBuffer = '';
    const encoder = new TextEncoder();
    const keepAlive = this._sleepSuppressed ? 'if(global._ka)_ka();' : '';
    const payload = encoder.encode('\x10' + keepAlive + js + '\n');
    await this._writeRawBytes(payload);

    const t0 = performance.now();
    while (performance.now() - t0 < timeout) {
      const endIdx = this.rxBuffer.indexOf(endMarker);
      if (endIdx !== -1) {
        if (!startMarker) {
          const out = this.rxBuffer.slice(0, endIdx);
          this.rxBuffer = this.rxBuffer.slice(endIdx + endMarker.length);
          return out;
        }
        const startIdx = this.rxBuffer.indexOf(startMarker);
        if (startIdx !== -1 && startIdx < endIdx) {
          const out = this.rxBuffer.slice(startIdx + startMarker.length, endIdx);
          this.rxBuffer = this.rxBuffer.slice(endIdx + endMarker.length);
          return out;
        }
      }
      await sleep(20);
    }
    throw new Error(`Command timed out waiting for ${endMarker}. Buffer: ${this.rxBuffer.slice(-180)}`);
  }

  async fetchDeviceInfo() {
    this.log('Reading badge Storage, id.json, connections.json, and scans.txt...', 'cmd');
    const js =
      'print("<<<START>>>"+JSON.stringify({env:process.env,files:require("Storage").list().map(f=>({name:f,len:(require("Storage").read(f)||"").length})),id:require("Storage").readJSON("id.json",1),wifi:require("Storage").readJSON("wifi.json",1),connections:require("Storage").readJSON("connections.json",1),scans:(require("Storage").open("scans.txt","r").read(4096)||""),showing:require("Storage").read("showing")})+"<<<END>>>")';
    const raw = await this.runCommand(js, { timeout: 10000 });
    const info = JSON.parse(raw);
    const scanLines = (info.scans || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    info.scanLines = scanLines;
    this.log(
      `Badge ${info.id?.serial || info.env?.SERIAL || 'EPAPER_BADGE'} (${info.env?.VERSION}): ${info.files?.length || 0} files, ${scanLines.length} scans, ${(info.connections || []).length} connections.`,
      'ok'
    );
    return info;
  }

  async readStorageFile(filename, totalSize = 96000, onProgress = () => {}) {
    this.log(`Downloading ${filename} (${totalSize} bytes) from badge...`, 'cmd');
    const chunkSize = this.mode === 'bluetooth' ? 1024 : 3000;
    const out = new Uint8Array(totalSize);
    let offset = 0;

    while (offset < totalSize) {
      const len = Math.min(chunkSize, totalSize - offset);
      const js = `print("<<<START>>>"+btoa(require("Storage").read(${JSON.stringify(filename)},${offset},${len})||"")+"<<<END>>>")`;
      const b64 = await this.runCommand(js, { timeout: 12000 });
      const chunk = base64ToUint8(b64);
      out.set(chunk, offset);
      offset += len;
      onProgress(Math.min(1, offset / totalSize), offset, totalSize);
    }
    this.log(`Downloaded ${filename} (${out.length} bytes, CRC32: ${crc32(out)}).`, 'ok');
    return out;
  }

  async writeStorageFile(filename, bytes, onProgress = () => {}) {
    const totalSize = bytes.length;
    const expectedCrc = crc32(bytes);
    this.log(`Flashing ${filename} (${totalSize} bytes, CRC32: ${expectedCrc})...`, 'cmd');

    await this.runCommand(
      `global._w=function(d,o,s){require("Storage").write(${JSON.stringify(filename)},atob(d),o,s);print("<<<START>>>OK<<<END>>>");};print("<<<START>>>OK<<<END>>>")`
    );

    const chunkSize = this.mode === 'bluetooth' ? 384 : 768;
    let offset = 0;

    while (offset < totalSize) {
      const slice = bytes.subarray(offset, Math.min(offset + chunkSize, totalSize));
      const b64 = uint8ToBase64(slice);
      const cmd = offset === 0 ? `_w("${b64}",0,${totalSize})` : `_w("${b64}",${offset})`;
      await this.runCommand(cmd, { timeout: offset === 0 ? 18000 : 8000 });
      offset += slice.length;
      onProgress(Math.min(1, offset / totalSize), offset, totalSize);
    }

    const verifyRaw = await this.runCommand(
      `delete global._w;print("<<<START>>>"+JSON.stringify({len:require("Storage").read(${JSON.stringify(filename)}).length,crc:E.CRC32(require("Storage").read(${JSON.stringify(filename)}))})+"<<<END>>>")`
    );
    const verify = JSON.parse(verifyRaw);
    if (verify.crc !== expectedCrc || verify.len !== totalSize) {
      throw new Error(
        `CRC32 verification mismatch on ${filename}: expected ${expectedCrc} (${totalSize}B), got ${verify.crc} (${verify.len}B)`
      );
    }
    this.log(`Verified ${filename}: ${verify.len}B, CRC32 ${verify.crc} match 100%!`, 'ok');
    return verify;
  }

  async writeJsonFile(filename, dataObj) {
    const str = JSON.stringify(dataObj);
    const b64 = uint8ToBase64(new TextEncoder().encode(str));
    await this.runCommand(
      `require("Storage").write(${JSON.stringify(filename)},atob("${b64}"));print("<<<START>>>OK<<<END>>>")`
    );
    this.log(`Updated ${filename} (${str.length} bytes).`, 'ok');
  }

  async writeScansCount(existingScanIds, targetCount) {
    const lines = [...existingScanIds.filter((id) => id && id !== '0')];
    const desired = Math.max(0, Math.min(999, Math.floor(Number(targetCount) || 0)));
    while (lines.length > desired) lines.pop();
    while (lines.length < desired) lines.push('0');
    const content = lines.length ? lines.join('\n') + '\n' : '';
    const b64 = uint8ToBase64(new TextEncoder().encode(content));
    await this.runCommand(
      `let sf=require("Storage").open("scans.txt","r");sf.erase();if(${content.length}>0)require("Storage").open("scans.txt","w").write(atob("${b64}"));print("<<<START>>>OK<<<END>>>")`
    );
    this.log(`Updated scans.txt counter to ${desired} lines.`, 'ok');
    return lines;
  }

  async refreshBadgeDisplay({ counterFormat = 'roman', ledColor = '#730', keepBlueLEDs = true } = {}) {
    this.log(`Refreshing physical ePaper display (counter: ${counterFormat.toUpperCase()})...`, 'cmd');
    const patchRam = buildLiveShowBadgeJS({ counterFormat, ledColor });
    await this.runCommand(`${patchRam}print("<<<START>>>OK<<<END>>>")`);
    await this.runCommand(
      `showBadge({noLEDs:${keepBlueLEDs ? 'true' : 'false'}}).then(()=>print("<<<START>>>DONE<<<END>>>"))`,
      { timeout: 30000 }
    );
    this.log('Physical ePaper display refresh complete!', 'ok');
  }

  async refreshProgrammeDisplay() {
    this.log('Switching physical ePaper display to 2nd screen (programme.epaper)...', 'cmd');
    await this.runCommand(
      'Badge.showImageFile("programme.epaper").then(()=>{require("Storage").write("showing","programme");print("<<<START>>>DONE<<<END>>>");})',
      { timeout: 30000 }
    );
    this.log('2nd screen (programme.epaper) displayed on badge!', 'ok');
  }

  async setLEDs(hexColor) {
    if (!this.isConnected) return;
    await this.runCommand(`Badge.setLEDs(${JSON.stringify(hexColor)});print("<<<START>>>OK<<<END>>>")`);
    this.log(`Set badge NeoPixel LEDs to ${hexColor}`, 'ok');
  }
}
