At Google's WebAI Summit in Sunnyvale (huge thank you to Jason Mayes for bringing the client-side AI community together), every attendee got handed one of the coolest pieces of conference hardware ever built: an Espruino-powered 4-color ePaper badge (ESP32-C3, 480x800 Black/White/Yellow/Red e-ink, 10 WS2812B NeoPixels, and BLE badge-to-badge scanning).

There was just one catch: the line at the photo booth to get your custom portrait flashed onto the badge stretched across the hall.

So instead of waiting in the queue, I pulled out my laptop, plugged a USB-C cable into the exposed J1 header, opened an Espruino serial REPL at 115200 baud, and reverse-engineered the 96,000-byte 2bpp framebuffer and .bootcde startup firmware on the spot. Twenty minutes later I had a stage selfie with Jason, a pixel-aligned LinkedIn QR code, and a Roman numeral connection counter (XIV) running on my lanyard.

After sharing that quick hallway hack, dozens of attendees asked how they could customize their own badges, update their Wi-Fi credentials after leaving the venue, or repurpose the second screen (BTN1) without bricking the flash filesystem.

So I turned those raw REPL scripts into the open-source WebAI Badge Studio:
-> Live Studio: https://rabimba.github.io/webai-badge/
-> Source & Hardware Specs: https://github.com/rabimba/webai-badge

And because this is the WebAI Summit, the badge studio itself is a pure client-side WebAI app running over WebGPU with zero cloud calls:
1. In-Browser WebGPU LLM Art Director (@litert-lm/core & @mediapipe/tasks-genai): Runs lightweight .litertlm / .task models (Qwen3-0.6B-INT4, SmolLM-135M, Gemma-4-E2B-Web) locally in Chrome to synthesize 4-ink architectural themes (Cyber PCB, Sunburst Pop, Bauhaus Grid, Retro Terminal, Editorial) and procedural backdrops from your prompt + live portrait luminance telemetry.
2. MediaPipe Selfie Segmenter on WebGPU: Cuts you out of cluttered backgrounds and adds a 4-ink die-cut sticker outline over the geometric sunburst backdrop before Atkinson dithering.
3. Zero-Noise 1-Bit QR Engine: Bypasses error diffusion to stamp pixel-snapped URL, vCard, or Wi-Fi QR codes that phone cameras scan immediately.
4. Surgical .bootcde Firmware Modder & Wi-Fi Provisioner: Patches showBadge() for Roman (XIV), Hex (0xE), or Binary (1110) counters (widening the render strip from 48px to 64px so wide numerals never clip while preserving the 144-byte transparent person icon), updates wifi.json, backs up your BLE attendee constellation to a single .ZIP, and flashes over Web Serial or Web Bluetooth with IEEE 802.3 CRC32 verification.

If you have a WebAI Summit badge sitting on your desk, grab a USB-C cable (or connect over BLE) and take it for a spin. I also wrote up the full reverse-engineering breakdown on my blog (link in comments).

#WebAI #WebGPU #Espruino #OnDeviceAI
