// Zero-dependency PKZIP (.zip) Writer & Reader + IndexedDB Safety Snapshot Store
import { crc32 } from '../epaper/codec.js';

/**
 * Creates a standard uncompressed PKZIP (.zip) Uint8Array from an array of { name: string, data: Uint8Array | string }
 */
export function createZipArchive(files) {
  const encoder = new TextEncoder();
  const entries = files.map((f) => {
    const nameBytes = encoder.encode(f.name);
    const dataBytes = typeof f.data === 'string' ? encoder.encode(f.data) : new Uint8Array(f.data);
    const crc = crc32(dataBytes);
    return { nameBytes, dataBytes, crc };
  });

  let localSize = 0;
  let centralSize = 0;
  for (const e of entries) {
    localSize += 30 + e.nameBytes.length + e.dataBytes.length;
    centralSize += 46 + e.nameBytes.length;
  }

  const totalSize = localSize + centralSize + 22;
  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);

  let offset = 0;
  for (const e of entries) {
    e.localHeaderOffset = offset;
    view.setUint32(offset, 0x04034b50, true); // Local file header signature
    view.setUint16(offset + 4, 20, true);     // Version needed
    view.setUint16(offset + 6, 0, true);      // Flags
    view.setUint16(offset + 8, 0, true);      // Compression: 0 (STORED)
    view.setUint16(offset + 10, 0, true);     // Mod time
    view.setUint16(offset + 12, 0x5d9e, true);// Mod date
    view.setUint32(offset + 14, e.crc, true); // CRC32
    view.setUint32(offset + 18, e.dataBytes.length, true);
    view.setUint32(offset + 22, e.dataBytes.length, true);
    view.setUint16(offset + 26, e.nameBytes.length, true);
    view.setUint16(offset + 28, 0, true);
    buf.set(e.nameBytes, offset + 30);
    buf.set(e.dataBytes, offset + 30 + e.nameBytes.length);
    offset += 30 + e.nameBytes.length + e.dataBytes.length;
  }

  const centralDirOffset = offset;
  for (const e of entries) {
    view.setUint32(offset, 0x02014b50, true); // Central directory signature
    view.setUint16(offset + 4, 20, true);     // Version made by
    view.setUint16(offset + 6, 20, true);     // Version needed
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, 0, true);     // STORED
    view.setUint16(offset + 12, 0, true);
    view.setUint16(offset + 14, 0x5d9e, true);
    view.setUint32(offset + 16, e.crc, true);
    view.setUint32(offset + 20, e.dataBytes.length, true);
    view.setUint32(offset + 24, e.dataBytes.length, true);
    view.setUint16(offset + 28, e.nameBytes.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, e.localHeaderOffset, true);
    buf.set(e.nameBytes, offset + 46);
    offset += 46 + e.nameBytes.length;
  }

  // End of central directory record
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, centralSize, true);
  view.setUint32(offset + 16, centralDirOffset, true);
  view.setUint16(offset + 20, 0, true);

  return buf;
}

/**
 * Reads STORED or DEFLATED entries from a .zip ArrayBuffer
 */
export async function parseZipArchive(arrayBuffer) {
  const buf = new Uint8Array(arrayBuffer);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const decoder = new TextDecoder();
  const out = {};

  // Find End of Central Directory (0x06054b50)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('Invalid ZIP file (EOCD not found)');

  const count = view.getUint16(eocd + 8, true);
  let cdOffset = view.getUint32(eocd + 16, true);

  for (let i = 0; i < count; i++) {
    if (view.getUint32(cdOffset, true) !== 0x02014b50) break;
    const method = view.getUint16(cdOffset + 10, true);
    const compSize = view.getUint32(cdOffset + 20, true);
    const nameLen = view.getUint16(cdOffset + 28, true);
    const extraLen = view.getUint16(cdOffset + 30, true);
    const commentLen = view.getUint16(cdOffset + 32, true);
    const localOffset = view.getUint32(cdOffset + 42, true);
    const name = decoder.decode(buf.subarray(cdOffset + 46, cdOffset + 46 + nameLen));

    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const rawSlice = buf.slice(dataStart, dataStart + compSize);

    if (method === 0) {
      out[name] = rawSlice;
    } else if (method === 8 && typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(rawSlice);
      writer.close();
      const resp = new Response(ds.readable);
      out[name] = new Uint8Array(await resp.arrayBuffer());
    }

    cdOffset += 46 + nameLen + extraLen + commentLen;
  }

  return out;
}

const DB_NAME = 'webai_badge_studio_db';
const STORE_NAME = 'snapshots';

function openSnapshotDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSafetySnapshot(serial, filesMap) {
  try {
    const db = await openSnapshotDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({
        id: serial || 'latest',
        serial: serial || 'unknown',
        timestamp: new Date().toISOString(),
        files: filesMap,
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return false;
  }
}

export async function loadSafetySnapshot(serial = 'latest') {
  try {
    const db = await openSnapshotDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(serial);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
