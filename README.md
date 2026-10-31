# WebAI Badge Studio (`EPAPER_BADGE`)

End-to-end browser studio and firmware modder for the **WebAI Summit 2026 Espruino 4-Color ePaper Badge** (`ESP32-C3`, `480×800` portrait / `800×480` raw buffer, 2bpp Black/White/Yellow/Red).

Zero external build dependencies — runs anywhere and deploys directly to **GitHub Pages**.

---

## ✨ Features

1. **Interactive `EPAPER_BADGE` Hardware Simulator**
   - Physical PCB enclosure with 10 addressable WS2812B NeoPixel perimeter LEDs, e-ink refresh inversion animation, tactile `BTN1` (Screen Toggle) and `BTN2` (BLE Scan `+1`) buttons, and a floating **8× Pixel Dither Loupe** showing exact `(X,Y)` coordinates and 2-bit ink codes (`00` Black, `01` White, `10` Yellow, `11` Red).
   - Live **4-Ink Telemetry Bar** displaying exact percentage breakdown across the 384,000 pixels (`96,000` bytes) and IEEE 802.3 `CRC32` checksum (matching `E.CRC32` on Espruino).

2. **WebGPU AI Badge Designer (`LiteRT-LM` + `MediaPipe GenAI`)**
   - Opt-in in-browser LLM Art Director powered by `@litert-lm/core` (`.litertlm`) and `@mediapipe/tasks-genai` (`.task`) over WebGPU (`Qwen3-0.6B-INT4`, `SmolLM-135M`, `Qwen2.5-0.5B`, `Gemma-4-E2B-Web`, or local `.litertlm`/`.task` files).
   - Combines user prompts with live portrait luminance/contrast telemetry to compose 4-ink architectural themes (`cyber-pcb`, `sunburst-pop`, `bauhaus-grid`, `retro-terminal`, `editorial-minimal`), procedural 4-ink backdrops (`circuit`, `sunburst`, `halftone`, `bauhaus`, `matrix-grid`), and gamut-tuned dithering. Default layout remains untouched until activated.

3. **Portrait Studio & In-Browser WebAI Background Cutout**
   - Upload any photo, snap live from your webcam, or re-crop the WebAI Summit stage shot with smart framing presets (`Full Stage + Logo`, `Two-Shot + Peace`, `Faces Close-Up`, `Solo Portrait`).
   - Toggle **WebAI Background Cutout** (MediaPipe SelfieSegmenter WebGPU/WASM with offline portrait matte fallback) to isolate people in front of the WebAI geometric yellow/red sunburst backdrop before dithering.
   - 4 dithering algorithms tailored for warm BWYR ePaper: **Atkinson**, **Floyd–Steinberg**, **Ordered Bayer 4×4**, and **Posterized 4-Ink**, with live Contrast, Brightness, Warm Gamut Blend, and Edge Sharpness sliders.

3. **Crisp 1-Bit Pixel-Aligned QR Code Generator**
   - Self-contained ISO/IEC 18004 QR encoder (`src/epaper/qrcode.js`) that renders monochrome pixel-snapped modules directly onto the 2bpp buffer (bypassing dithering so phone cameras scan instantaneously).
   - Supports **LinkedIn / URL**, **vCard Contact**, and **Wi-Fi Network** payloads.

4. **Second Screen Designer (`programme.epaper` / `BTN1`)**
   - Customize the secondary screen toggled by pressing physical **BTN1** on the badge:
     - **Giant QR Speaker Card**
     - **WebAI Summit Live Agenda**
     - **Full-Bleed 4-Ink Poster**

5. **Firmware & Dynamic Counter Modder (`.bootcde`)**
   - Binary patcher (`src/epaper/bootcde-patcher.js`) for `.bootcde` that modifies `showBadge()` to render the bottom-left connection counter in **Roman Numerals (`XIV`)**, **Arabic (`14`)**, **Hexadecimal (`0xE`)**, or **Binary (`1110`)**.
   - Automatically widens the `Badge.showImageFileRendering("badge.epaper", 64, ...)` strip from `48px` to `64px` so wide Roman numerals never clip, and preserves the exact 144-byte `[32, 35, 129, 0, ...]` transparent 1-bit person silhouette icon.

6. **Web Serial (USB-C) & Web Bluetooth (BLE) Live Flashing + Full Backup**
   - Connects directly from Chrome/Edge over **Web Serial** (`115200` baud with `64-byte / 3ms` packet pacing so the ESP32-C3 USB-JTAG FIFO never drops bytes) or **Web Bluetooth** (Nordic UART `6e400001-b5a3-f393-e0a9-e50e24dcca9e`).
   - Verifies every flashed file with `E.CRC32(require("Storage").read(...))`.
   - Interactive **Attendee Connection Constellation Graph** + searchable table + CSV/JSON export + one-click **Full Flash PKZIP (`.zip`) Backup & Restore**.

---

## 🔧 Hardware Specifications Reverse-Engineered

| Property | Specification |
| :--- | :--- |
| **Board / MCU** | `EPAPER_BADGE` (ESP32-C3, Espruino `2v29.490`) |
| **Display** | `480×800` portrait (`800×480` raw buffer, `-90°` rotation, 2 bits/pixel = `96,000` bytes) |
| **2-Bit Color Palette** | `00` (`0`) = `#000000` Black, `01` (`1`) = `#FFFFFF` White, `10` (`2`) = `#FFCC33` Yellow, `11` (`3`) = `#DB3727` Red |
| **Top Photo Frame** | Upright `x = 47..432`, `y = 17..405` (`386×389` px, corner radius `30px`) |
| **Center Identity Card** | Upright `x = 33..446`, `y = 430..575` (`414×146` px, corner radius `26px`) |
| **Dynamic Counter Overlay** | Drawn at runtime by `showBadge()` in `.bootcde` using line count of `scans.txt` at `(24, 745)` above a `32×35` 1-bit transparent person icon at `(8, 759)` |

---

## 🚀 Quick Start & GitHub Pages Deployment

```bash
# Run automated verification suite (.epaper codec, CRC32, dithering, QR, .bootcde patcher, ZIP)
npm test

# Start local development server at http://localhost:4173
npm run dev

# Build static production bundle into ./dist for GitHub Pages
npm run build
```

Push to `main` (or trigger the included `.github/workflows/deploy.yml` workflow) to publish automatically to **GitHub Pages**.

> **One-time setup:** In the repository go to **Settings → Pages → Build and deployment → Source: "GitHub Actions"**. Every subsequent push to `main` then runs tests, builds `./dist`, and deploys automatically.
