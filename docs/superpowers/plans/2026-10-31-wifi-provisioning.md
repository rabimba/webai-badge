# Wi-Fi Provisioning Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users read and write the badge's `wifi.json` credentials from the Studio UI over Web Serial/BLE, and strip hardcoded Wi-Fi passwords from the repo.

**Architecture:** Pure helper module (`src/transport/wifi-provisioning.js`) builds/validates the Espruino `wifi.json` schema; `main.js` wires a new Tab 3 card to the existing CRC-verified `badgeClient.readStorageFile`/`writeStorageFile`. Firmware already reads `require("Storage").readJSON("wifi.json",1)` — no firmware change.

**Tech Stack:** Vanilla ES modules (zero dependencies), Node assert test suite in `scripts/verify.mjs`.

**Spec:** Design doc in conversation, 2026-10-31 (approved): full provisioning card in Tab 3 (Firmware), blank defaults replacing hardcoded passwords.

## Global Constraints

- Zero npm dependencies; browser-targeted ES modules only.
- `wifi.json` schema (exact, matches `backup/wifi.json` firmware contract): `{ssid, options:{password}, backup_ssid, backup_options:{password}, badgeURL}`.
- Espruino `readJSON(x, 1)` accepts unquoted keys but we emit valid JSON (quoted keys) — safe both ways.
- Never push to git; commits only.
- Test suite stays `node scripts/verify.mjs` (12 tests after this plan).

## Review Focus

- SSID with `;`, `"`, or `,` characters — must round-trip through `JSON.stringify` without corrupting `wifi.json` (pinned in Task 1 test).
- WPA password shorter than 8 chars — must be rejected for WPA/WPA2 but allowed empty for Open (pinned in Task 1 test).
- Read-back of a corrupted/missing `wifi.json` on badge — must throw a readable error, not populate the form with garbage (pinned in Task 1 test).
- Write while badge disconnected — buttons disabled with explanatory tooltip (manual UI check, Task 3).
- Password field on read-back — masked until show-toggle clicked (manual UI check, Task 3).

---

### Task 1: `buildWifiJson`/`parseWifiJson` helpers (TDD)

**Files:**
- Create: `src/transport/wifi-provisioning.js`
- Modify: `scripts/verify.mjs` (append test 12 + import)
- Test: `scripts/verify.mjs` test 12

**Interfaces:**
- Produces: `buildWifiJson({ ssid, password, backupSsid = '', backupPassword = '', badgeUrl = 'https://www.espruino.com/webai2026' })` → `{ json: string, obj: object }`. Throws `Error` on invalid input. `parseWifiJson(text)` → object, throws `Error` on missing `ssid` or non-object.
- Consumes: nothing.

- [ ] **Step 1: Write failing test 12 in `scripts/verify.mjs`**

Import `buildWifiJson, parseWifiJson` from `../src/transport/wifi-provisioning.js`. Assert:
1. Full build: `buildWifiJson({ssid:'Badge24', password:'x'.repeat(8), backupSsid:'ALPHABET-GUEST', backupPassword:''}).obj` deep-equals `{ssid:'Badge24', options:{password:'x'.repeat(8)}, backup_ssid:'ALPHABET-GUEST', backup_options:{password:''}, badgeURL:'https://www.espruino.com/webai2026'}`; `JSON.parse(json)` round-trips.
2. Special chars: SSID `My;Net,work"` and password with `"` round-trip via `JSON.parse(buildWifiJson(...).json)`.
3. Open network: `password:''` → `options:{password:''}` present, no throw.
4. Rejections: SSID >32 chars throws; WPA password 1–7 chars throws; SSID `''` throws.
5. Parse: `parseWifiJson('{"ssid":"Badge24","options":{"password":"p"}}')` → object with `.ssid === 'Badge24'`; `parseWifiJson('{}')` throws; `parseWifiJson('not json')` throws.

- [ ] **Step 2: Run to verify failure**

Run: `npm test 2>&1 | tail -3`
Expected: SyntaxError — export named `buildWifiJson` not provided.

- [ ] **Step 3: Implement `src/transport/wifi-provisioning.js`**

Module doc comment + two named exports. `buildWifiJson` validates (ssid 1–32, password '' or ≥8 when `options` present — no enc knob since firmware infers), assembles obj, returns `{ json: JSON.stringify(obj), obj }`. `parseWifiJson` uses `JSON.parse`, checks object + `typeof ssid === 'string'`.

- [ ] **Step 4: Run to verify pass**

Run: `npm test 2>&1 | tail -3`
Expected: 12 [PASS] lines.

- [ ] **Step 5: Commit**

```bash
git add src/transport/wifi-provisioning.js scripts/verify.mjs
git commit -m "feat(wifi): validated wifi.json build/parse helpers"
```

### Task 2: UI card in Tab 3 + main.js wiring

**Files:**
- Modify: `index.html` (new card at top of `#tab-firmware`)
- Modify: `src/main.js` (bindings near other tab-firmware wiring)
- Modify: `src/styles.css` (minor: `.wifi-prov-row`, show-pass button)

**Interfaces:**
- Consumes: `buildWifiJson`, `parseWifiJson` (Task 1); `badgeClient.readStorageFile(name, totalSize, onProgress)`, `badgeClient.writeStorageFile(name, bytes, onProgress)`; connection-state flag used by existing connect handlers.
- Produces: DOM ids `inpProvSsid, inpProvPass, btnProvShowPass, inpProvBackupSsid, inpProvBackupPass, btnWifiRead, btnWifiWrite, wifiProvStatus`.

- [ ] **Step 1: Add card markup in `index.html` inside `#tab-firmware`, before the counter `panel-card`**

Card: header "Wi-Fi Provisioning (`wifi.json`)" + sub explaining badge reads `wifi.json` at boot; grid: SSID, password (type=password) with 👁 toggle button, backup SSID, backup password; action bar: `btnWifiRead` (⇩ Read from Badge), `btnWifiWrite` (⚡ Write to Badge); status `<code id="wifiProvStatus">`. Both buttons `disabled` initially with `title="Connect the badge first"`.

- [ ] **Step 2: Wire in `src/main.js`**

- Placeholders, no `value=` defaults; set `inpProvPass.placeholder = 'Password (min 8 chars)'` in markup.
- Helper `setWifiProvEnabled(connected)` toggling both buttons; call from existing Serial and BLE connect-success handlers and disconnect paths.
- `btnProvShowPass`: toggle `inpProvPass.type` between `password`/`text`, swap icon.
- `btnWifiRead` handler: `readStorageFile('wifi.json', <size of current file>)` — read via `runCommand`-backed size probe: read 512B first, JSON.parse trimmed result (see note), populate fields, mask password, set status `Read from badge: SSID '…'`. Errors → status + console log, not throw.

  Note: `wifi.json` is a small variable-length file; implement read as `badgeClient.readStorageFile('wifi.json', 4096)` then trim trailing NULs/whitespace before `parseWifiJson`; if the badge rejects a size over the file length, fall back to `readStorageFile('wifi.json', 512)` chunks — pick whichever the existing client tolerates and log the chosen path.
- `btnWifiWrite` handler: `buildWifiJson({...form fields})` → `writeStorageFile('wifi.json', new TextEncoder().encode(json))` → status `Written + CRC verified: 'ssid'` → `pulseNeoPixelChaseRef?.()`. Errors caught → status + console log.
- Read/write handlers log into existing console card via `appendConsoleLog`.

- [ ] **Step 3: Full verify**

Run: `npm test 2>&1 | tail -3 && npm run build 2>&1 | tail -2`
Expected: 12/12 PASS, build OK.

### Task 3: Strip hardcoded credentials

**Files:**
- Modify: `src/main.js:64-65` → `wifiSsid: '', wifiPassword: ''`
- Modify: `index.html:516,520` → remove `value=` attrs on `inpWifiSsid`/`inpWifiPass` (QR Wi-Fi mode), keep placeholders

- [ ] **Step 1: Apply edits**
- [ ] **Step 2: Verify** — `npm test 2>&1 | tail -3` (12/12), `grep -rn "Hornet-Leading-Showman" src index.html public` → 0 matches.
- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(wifi): UI provisioning card + strip hardcoded credentials"
```

### Task 4: Manual browser smoke check (user-assisted)

- [ ] Load studio, connect badge over Serial, read existing `wifi.json`, edit SSID, write, confirm CRC-verified log; verify QR Wi-Fi mode still renders with blank defaults.
