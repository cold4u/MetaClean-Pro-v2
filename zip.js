/**
 * MetaClean Pro v2.2 — Client-side ZIP Archiver & Reader (Zero External Dependencies)
 * 100% Offline standard PKWARE ZIP builder and in-memory unpacker.
 */
(function(root) {
  'use strict';

  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[i] = c >>> 0;
  }

  function crc32(uint8) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < uint8.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ uint8[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  async function toUint8Array(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data instanceof Blob) {
      const buf = await data.arrayBuffer();
      return new Uint8Array(buf);
    }
    if (typeof data === 'string') {
      return new TextEncoder().encode(data);
    }
    return new Uint8Array(0);
  }

  /**
   * Decompresses raw Deflate byte stream in modern browsers using native DecompressionStream
   */
  async function decompressRaw(bytes) {
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const stream = new Response(bytes).body.pipeThrough(new DecompressionStream('deflate-raw'));
        const ab = await new Response(stream).arrayBuffer();
        return new Uint8Array(ab);
      } catch (e) {
        console.warn('DecompressionStream error:', e);
      }
    }
    return bytes;
  }

  /**
   * Creates a ZIP file Blob from an array of entries: [{ name: string, data: Uint8Array|Blob|ArrayBuffer }]
   */
  async function createZip(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const cdParts = [];
    let offset = 0;

    for (const item of files) {
      const nameBytes = encoder.encode(item.name);
      const dataBytes = await toUint8Array(item.data);
      const size = dataBytes.byteLength;
      const crc = crc32(dataBytes);

      // Local File Header (30 bytes + name + data)
      const lh = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034B50, true); // Local header signature
      lv.setUint16(4, 10, true);         // Version needed: 1.0
      lv.setUint16(6, 0x0800, true);     // General purpose bit flag: UTF-8
      lv.setUint16(8, 0, true);          // Compression method: 0 (Stored)
      lv.setUint16(10, 0, true);         // Last mod file time
      lv.setUint16(12, 0x21, true);      // Last mod file date (1980)
      lv.setUint32(14, crc, true);       // CRC-32
      lv.setUint32(18, size, true);      // Compressed size
      lv.setUint32(22, size, true);      // Uncompressed size
      lv.setUint16(26, nameBytes.length, true); // File name length
      lv.setUint16(28, 0, true);         // Extra field length
      lh.set(nameBytes, 30);

      localParts.push(lh);
      localParts.push(dataBytes);

      // Central Directory Header (46 bytes + name)
      const cd = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014B50, true); // Central directory signature
      cv.setUint16(4, 0x0314, true);     // Version made by: Unix 2.0
      cv.setUint16(6, 10, true);         // Version needed: 1.0
      cv.setUint16(8, 0x0800, true);     // Flags: UTF-8
      cv.setUint16(10, 0, true);         // Compression: 0
      cv.setUint16(12, 0, true);         // Mod time
      cv.setUint16(14, 0x21, true);      // Mod date
      cv.setUint32(16, crc, true);       // CRC-32
      cv.setUint32(20, size, true);      // Compressed size
      cv.setUint32(24, size, true);      // Uncompressed size
      cv.setUint16(28, nameBytes.length, true); // File name length
      cv.setUint16(30, 0, true);         // Extra field length
      cv.setUint16(32, 0, true);         // File comment length
      cv.setUint16(34, 0, true);         // Disk number start
      cv.setUint16(36, 0, true);         // Internal file attributes
      cv.setUint32(38, (0o644 << 16) >>> 0, true); // External file attributes
      cv.setUint32(42, offset, true);    // Relative offset of local header
      cd.set(nameBytes, 46);

      cdParts.push(cd);
      offset += lh.length + size;
    }

    // End of Central Directory Record (22 bytes)
    const cdTotalSize = cdParts.reduce((acc, p) => acc + p.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054B50, true); // EOCD signature
    ev.setUint16(4, 0, true);          // Number of this disk
    ev.setUint16(6, 0, true);          // Disk where CD starts
    ev.setUint16(8, files.length, true); // Entries on this disk
    ev.setUint16(10, files.length, true);// Total entries
    ev.setUint32(12, cdTotalSize, true); // Size of central directory
    ev.setUint32(16, offset, true);      // Offset of central directory
    ev.setUint16(20, 0, true);          // Comment length

    const finalParts = [...localParts, ...cdParts, eocd];
    return new Blob(finalParts, { type: 'application/zip' });
  }

  /**
   * Reads and unpacks a ZIP archive in-memory.
   * Returns array of: [{ name: string, data: Uint8Array, size: number }]
   */
  async function readZip(source) {
    const raw = await toUint8Array(source);
    const n = raw.length;
    if (n < 22) throw new Error('File too small to be a valid ZIP archive.');

    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

    // Locate EOCD signature 0x06054B50 from end of file
    let eocdPos = -1;
    const searchLimit = Math.max(0, n - 65557);
    for (let i = n - 22; i >= searchLimit; i--) {
      if (dv.getUint32(i, true) === 0x06054B50) {
        eocdPos = i;
        break;
      }
    }

    if (eocdPos === -1) {
      throw new Error('ZIP End of Central Directory (EOCD) signature not found.');
    }

    const totalEntries = dv.getUint16(eocdPos + 10, true);
    const cdOffset = dv.getUint32(eocdPos + 16, true);

    const extractedFiles = [];
    const decoder = new TextDecoder('utf-8');
    let pos = cdOffset;

    for (let idx = 0; idx < totalEntries; idx++) {
      if (pos + 46 > n) break;
      const sig = dv.getUint32(pos, true);
      if (sig !== 0x02014B50) break; // End or corrupted CD

      const compMethod = dv.getUint16(pos + 10, true);
      const compSize = dv.getUint32(pos + 20, true);
      const uncompSize = dv.getUint32(pos + 24, true);
      const nameLen = dv.getUint16(pos + 28, true);
      const extraLen = dv.getUint16(pos + 30, true);
      const commentLen = dv.getUint16(pos + 32, true);
      const lhOffset = dv.getUint32(pos + 42, true);

      const nameBytes = raw.subarray(pos + 46, pos + 46 + nameLen);
      const filename = decoder.decode(nameBytes);

      pos += 46 + nameLen + extraLen + commentLen;

      // Skip directory entries and OS metadata
      if (filename.endsWith('/') || filename.startsWith('__MACOSX') || filename.includes('.DS_Store')) {
        continue;
      }

      // Read local header to get precise data offset
      if (lhOffset + 30 > n) continue;
      const lhNameLen = dv.getUint16(lhOffset + 26, true);
      const lhExtraLen = dv.getUint16(lhOffset + 28, true);
      const dataStart = lhOffset + 30 + lhNameLen + lhExtraLen;
      const compressedData = raw.subarray(dataStart, dataStart + compSize);

      let fileData;
      if (compMethod === 0) { // Stored
        fileData = compressedData;
      } else if (compMethod === 8) { // Deflated
        fileData = await decompressRaw(compressedData);
      } else {
        // Unsupported compression method, fallback raw
        fileData = compressedData;
      }

      extractedFiles.push({
        name: filename.split('/').pop() || filename,
        path: filename,
        data: fileData,
        size: uncompSize || fileData.length
      });
    }

    return extractedFiles;
  }

  root.createZip = createZip;
  root.readZip = readZip;
})(typeof window !== 'undefined' ? window : globalThis);
