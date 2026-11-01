// Wi-Fi Provisioning helpers — build/parse the badge's wifi.json storage file.
// Firmware reads it at boot via require("Storage").readJSON("wifi.json", 1).
// Schema (matches the WebAI 2026 firmware contract):
//   { ssid, options: { password }, backup_ssid, backup_options: { password }, badgeURL }
// We emit strict JSON (quoted keys) — Espruino readJSON accepts it, and it
// round-trips safely through JSON.parse in the studio's read-back path.

export const DEFAULT_BADGE_URL = 'https://www.espruino.com/webai2026';

/**
 * Build and validate a wifi.json payload.
 * @param {object} cfg - { ssid, password, backupSsid?, backupPassword?, badgeUrl? }
 * @returns {{ json: string, obj: object }} json: strict JSON string to write to
 *   badge storage; obj: the parsed form (useful for UI confirmation).
 * @throws {Error} on invalid SSID or WPA password length.
 */
export function buildWifiJson(cfg) {
  const ssid = String(cfg?.ssid ?? '').trim();
  const password = String(cfg?.password ?? '');
  const backupSsid = String(cfg?.backupSsid ?? '').trim();
  const backupPassword = String(cfg?.backupPassword ?? '');
  const badgeUrl = String(cfg?.badgeUrl || DEFAULT_BADGE_URL);

  if (ssid.length < 1 || ssid.length > 32) {
    throw new Error(`Wi-Fi SSID must be 1-32 characters (got ${ssid.length})`);
  }
  // Open networks legitimately carry an empty password; anything else must be
  // a plausible WPA/WPA2 passphrase (IEEE 802.11i: 8-63 characters).
  if (password.length > 0 && password.length < 8) {
    throw new Error('Wi-Fi password must be at least 8 characters (or empty for an open network)');
  }
  if (backupSsid.length > 32) {
    throw new Error(`Backup Wi-Fi SSID must be at most 32 characters (got ${backupSsid.length})`);
  }

  const obj = {
    ssid,
    options: { password },
    backup_ssid: backupSsid,
    backup_options: { password: backupPassword },
    badgeURL: badgeUrl,
  };
  return { json: JSON.stringify(obj), obj };
}

/**
 * Parse a wifi.json file read back from badge storage.
 * Tolerates trailing NUL/whitespace padding from fixed-size chunk reads.
 * @param {string} text - raw file contents
 * @returns {object} parsed wifi.json
 * @throws {Error} on invalid JSON or a payload without an ssid field.
 */
export function parseWifiJson(text) {
  let obj;
  try {
    obj = JSON.parse(String(text).replace(/\0+$/, '').trim());
  } catch (err) {
    throw new Error(`Badge wifi.json is not valid JSON: ${err.message}`);
  }
  if (!obj || typeof obj !== 'object' || typeof obj.ssid !== 'string' || obj.ssid.length === 0) {
    throw new Error('Badge wifi.json is missing a valid ssid field');
  }
  return obj;
}
