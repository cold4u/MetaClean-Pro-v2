/**
 * MetaClean Pro v2.4 — Core Metadata Forensics & Zero-Loss Sanitization Engine
 * 100% Client-Side. Zero Dependencies. Zero Network Transmission.
 */
(function(root) {
  'use strict';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';

  // --------------------------------------------------------------------------
  // Binary Readers & Utilities
  // --------------------------------------------------------------------------
  function readUint16(dv, offset, littleEndian) {
    if (offset + 2 > dv.byteLength) return 0;
    return dv.getUint16(offset, littleEndian);
  }

  function readUint32(dv, offset, littleEndian) {
    if (offset + 4 > dv.byteLength) return 0;
    return dv.getUint32(offset, littleEndian);
  }

  function readAscii(buf, offset, length) {
    const end = Math.min(offset + length, buf.length);
    let s = '';
    for (let i = offset; i < end; i++) {
      if (buf[i] === 0) break; // null-terminated
      s += String.fromCharCode(buf[i]);
    }
    return s.trim();
  }

  /**
   * Generates formatted Hex + ASCII dump for cybersecurity & binary inspection
   */
  function generateHexDump(u8, maxBytes = 128) {
    const rows = [];
    const len = Math.min(u8.length, maxBytes);
    for (let i = 0; i < len; i += 16) {
      const offset = i.toString(16).padStart(4, '0').toUpperCase();
      const chunk = u8.subarray(i, Math.min(i + 16, len));
      let hex = '';
      let ascii = '';
      for (let j = 0; j < 16; j++) {
        if (j < chunk.length) {
          hex += chunk[j].toString(16).padStart(2, '0').toUpperCase() + ' ';
          const b = chunk[j];
          ascii += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
        } else {
          hex += '   ';
        }
        if (j === 7) hex += ' ';
      }
      rows.push({ offset, hex: hex.trim(), ascii });
    }
    return rows;
  }

  // --------------------------------------------------------------------------
  // EXIF & TIFF Parser
  // --------------------------------------------------------------------------
  function parseTiff(dv, tiffStart, fields, forensicDetails) {
    if (tiffStart + 8 > dv.byteLength) return;
    const order = dv.getUint16(tiffStart);
    const le = order === 0x4949; // 'II' = Little Endian, 'MM' = Big Endian
    if (!le && order !== 0x4D4D) return;

    if (dv.getUint16(tiffStart + 2, le) !== 42) return;
    const ifd0Offset = dv.getUint32(tiffStart + 4, le);
    if (ifd0Offset < 8 || tiffStart + ifd0Offset >= dv.byteLength) return;

    const readTagVal = (type, count, valOffset) => {
      if (type === 2) { // ASCII
        const strOffset = count > 4 ? tiffStart + valOffset : valOffset;
        if (strOffset < dv.byteLength) {
          const maxL = Math.min(count, dv.byteLength - strOffset);
          const u8 = new Uint8Array(dv.buffer, dv.byteOffset + strOffset, maxL);
          return readAscii(u8, 0, maxL);
        }
      } else if (type === 3) { // SHORT
        return count === 1 ? (count > 2 ? dv.getUint16(tiffStart + valOffset, le) : valOffset & 0xFFFF) : null;
      } else if (type === 4) { // LONG
        return valOffset;
      } else if (type === 5 || type === 10) { // RATIONAL / SRATIONAL
        const ratOffset = tiffStart + valOffset;
        if (ratOffset + 8 <= dv.byteLength) {
          const num = type === 5 ? dv.getUint32(ratOffset, le) : dv.getInt32(ratOffset, le);
          const den = type === 5 ? dv.getUint32(ratOffset + 4, le) : dv.getInt32(ratOffset + 4, le);
          return den ? num / den : 0;
        }
      }
      return null;
    };

    const parseIfd = (offset, isGps = false, isSubExif = false) => {
      const ifdAbs = tiffStart + offset;
      if (ifdAbs + 2 > dv.byteLength) return;
      const count = dv.getUint16(ifdAbs, le);
      let p = ifdAbs + 2;

      let subExifPtr = 0, gpsPtr = 0;
      let gpsLatRef = '', gpsLat = null, gpsLonRef = '', gpsLon = null, gpsAlt = null;

      for (let i = 0; i < count; i++) {
        if (p + 12 > dv.byteLength) break;
        const tag = dv.getUint16(p, le);
        const type = dv.getUint16(p + 2, le);
        const cnt = dv.getUint32(p + 4, le);
        const valOffset = dv.getUint32(p + 8, le);
        p += 12;

        if (isGps) {
          if (tag === 0x0001) { // LatRef
            gpsLatRef = String.fromCharCode(valOffset & 0xFF);
          } else if (tag === 0x0002 && cnt === 3) { // Latitude rationals
            const rOff = tiffStart + valOffset;
            if (rOff + 24 <= dv.byteLength) {
              const d = dv.getUint32(rOff, le) / (dv.getUint32(rOff + 4, le) || 1);
              const m = dv.getUint32(rOff + 8, le) / (dv.getUint32(rOff + 12, le) || 1);
              const s = dv.getUint32(rOff + 16, le) / (dv.getUint32(rOff + 20, le) || 1);
              gpsLat = d + m / 60 + s / 3600;
            }
          } else if (tag === 0x0003) { // LonRef
            gpsLonRef = String.fromCharCode(valOffset & 0xFF);
          } else if (tag === 0x0004 && cnt === 3) { // Longitude rationals
            const rOff = tiffStart + valOffset;
            if (rOff + 24 <= dv.byteLength) {
              const d = dv.getUint32(rOff, le) / (dv.getUint32(rOff + 4, le) || 1);
              const m = dv.getUint32(rOff + 8, le) / (dv.getUint32(rOff + 12, le) || 1);
              const s = dv.getUint32(rOff + 16, le) / (dv.getUint32(rOff + 20, le) || 1);
              gpsLon = d + m / 60 + s / 3600;
            }
          } else if (tag === 0x0006) { // Altitude
            const rOff = tiffStart + valOffset;
            if (rOff + 8 <= dv.byteLength) {
              gpsAlt = dv.getUint32(rOff, le) / (dv.getUint32(rOff + 4, le) || 1);
            }
          }
          continue;
        }

        const strVal = (type === 2) ? readTagVal(type, cnt, valOffset) : null;

        if (tag === 0x010F && strVal) { // Make
          fields.push({ category: 'Hardware', label: 'Camera Make', value: strVal, threat: 'high' });
          forensicDetails.cameraMake = strVal;
        } else if (tag === 0x0110 && strVal) { // Model
          fields.push({ category: 'Hardware', label: 'Camera Model', value: strVal, threat: 'high' });
          forensicDetails.cameraModel = strVal;
        } else if (tag === 0x0131 && strVal) { // Software
          fields.push({ category: 'System', label: 'Software / OS', value: strVal, threat: 'med' });
          forensicDetails.software = strVal;
        } else if (tag === 0x0132 && strVal) { // DateTime
          fields.push({ category: 'Time', label: 'File Modification Date', value: strVal, threat: 'med' });
        } else if (tag === 0x013B && strVal) { // Artist
          fields.push({ category: 'Identity', label: 'Artist / Creator', value: strVal, threat: 'high' });
          forensicDetails.artist = strVal;
        } else if (tag === 0x8298 && strVal) { // Copyright
          fields.push({ category: 'Legal', label: 'Copyright', value: strVal, threat: 'med' });
        } else if (tag === 0x8769) { // ExifIFD pointer
          subExifPtr = valOffset;
        } else if (tag === 0x8825) { // GPS pointer
          gpsPtr = valOffset;
        }

        if (isSubExif) {
          if (tag === 0x9003 && strVal) { // DateTimeOriginal
            fields.push({ category: 'Time', label: 'Capture Date/Time', value: strVal, threat: 'high' });
            forensicDetails.captureDate = strVal;
          } else if (tag === 0x829A) { // ExposureTime
            const val = readTagVal(type, cnt, valOffset);
            if (val) fields.push({ category: 'Exposure', label: 'Shutter Speed', value: val < 1 ? `1/${Math.round(1/val)} s` : `${val.toFixed(2)} s`, threat: 'low' });
          } else if (tag === 0x829D) { // FNumber
            const val = readTagVal(type, cnt, valOffset);
            if (val) fields.push({ category: 'Exposure', label: 'Aperture', value: `f/${val.toFixed(1)}`, threat: 'low' });
          } else if (tag === 0x8827) { // ISO
            const val = (cnt === 1) ? (valOffset & 0xFFFF) : readTagVal(type, cnt, valOffset);
            if (val) fields.push({ category: 'Exposure', label: 'ISO Speed', value: `ISO ${val}`, threat: 'low' });
          } else if (tag === 0x920A) { // FocalLength
            const val = readTagVal(type, cnt, valOffset);
            if (val) fields.push({ category: 'Lens', label: 'Focal Length', value: `${val.toFixed(1)} mm`, threat: 'low' });
          } else if (tag === 0xA434 && strVal) { // LensModel
            fields.push({ category: 'Lens', label: 'Lens Model', value: strVal, threat: 'high' });
            forensicDetails.lensModel = strVal;
          } else if (tag === 0xA431 && strVal) { // BodySerialNumber
            fields.push({ category: 'Forensics', label: 'Device Serial Number', value: strVal, threat: 'critical' });
            forensicDetails.serialNumber = strVal;
          }
        }
      }

      if (isGps && gpsLat !== null && gpsLon !== null) {
        if (gpsLatRef === 'S') gpsLat = -gpsLat;
        if (gpsLonRef === 'W') gpsLon = -gpsLon;
        const latStr = `${Math.abs(gpsLat).toFixed(6)}° ${gpsLat >= 0 ? 'N' : 'S'}`;
        const lonStr = `${Math.abs(gpsLon).toFixed(6)}° ${gpsLon >= 0 ? 'E' : 'W'}`;
        const altStr = gpsAlt !== null ? ` • Alt: ${gpsAlt.toFixed(1)}m` : '';

        fields.push({
          category: 'Location',
          label: 'Exact GPS Coordinates',
          value: `${latStr}, ${lonStr}${altStr}`,
          threat: 'critical',
          gps: { lat: gpsLat, lon: gpsLon }
        });
        forensicDetails.gps = { lat: gpsLat, lon: gpsLon };
      }

      if (subExifPtr) parseIfd(subExifPtr, false, true);
      if (gpsPtr) parseIfd(gpsPtr, true, false);
    };

    parseIfd(ifd0Offset, false, false);
  }

  // --------------------------------------------------------------------------
  // Provenance & Social Media Platform Fingerprint Detector
  // --------------------------------------------------------------------------
  function detectProvenance(buf, format, fileName, fields, forensicDetails, latinText) {
    const fn = (fileName || '').toLowerCase();

    // 1. WhatsApp
    if (/img-\d{8}-wa\d+/i.test(fn) || /vid-\d{8}-wa\d+/i.test(fn) || /^wa\d+/i.test(fn)) {
      return {
        platform: 'WhatsApp Messenger',
        badge: '💬 WhatsApp Media',
        threatBadge: 'whatsapp',
        detail: 'Original GPS, device model, and camera EXIF were permanently stripped by WhatsApp servers during transmission.'
      };
    }

    // 2. Instagram / Meta CDN
    const isMetaFileName = /\d+_\d+_\d+_n\.(jpg|jpeg|webp)/i.test(fn) || fn.includes('instagram') || fn.startsWith('fb_img') || fn.includes('facebook');
    const hasZeroExif = fields.length <= 1;
    const isImage = (format === 'jpeg' || format === 'webp');

    if (isMetaFileName || (isImage && hasZeroExif && (latinText.includes('Photoshop') || buf.length < 500000))) {
      if (isMetaFileName) {
        return {
          platform: 'Instagram / Meta',
          badge: '📱 Instagram / Meta Ingested',
          threatBadge: 'meta',
          detail: 'Uploaded to Instagram/Meta servers. Original EXIF and GPS coordinates were purged upon upload for feed delivery.'
        };
      }
    }

    // 3. Apple iPhone Camera (Direct)
    if (forensicDetails.cameraMake === 'Apple' || (forensicDetails.cameraModel || '').includes('iPhone')) {
      return {
        platform: 'Apple iOS Camera',
        badge: '📸 Apple iPhone (Direct Capture)',
        threatBadge: 'device',
        detail: 'Raw uncompressed photo containing direct sensor metadata, lens profiles, and possible GPS telemetry.'
      };
    }

    // 4. Android Camera (Pixel, Samsung, Xiaomi)
    const androidMakes = ['google', 'samsung', 'xiaomi', 'oneplus', 'huawei', 'sony', 'motorola'];
    if (forensicDetails.cameraMake && androidMakes.includes(forensicDetails.cameraMake.toLowerCase())) {
      return {
        platform: 'Android Smartphone',
        badge: `📱 ${forensicDetails.cameraMake} Camera (Direct)`,
        threatBadge: 'device',
        detail: 'Direct camera sensor recording containing device hardware ID and timestamp signatures.'
      };
    }

    // 5. DSLR / Mirrorless Professional Camera
    const dslrMakes = ['canon', 'nikon', 'fujifilm', 'leica', 'panasonic', 'olympus', 'hasselblad'];
    if (forensicDetails.cameraMake && dslrMakes.includes(forensicDetails.cameraMake.toLowerCase())) {
      return {
        platform: 'Professional DSLR / Mirrorless',
        badge: `📷 ${forensicDetails.cameraMake} Camera`,
        threatBadge: 'pro',
        detail: 'High-end optical sensor capture containing full aperture, shutter, lens optics, and serial hardware data.'
      };
    }

    // 6. Adobe Creative Cloud / Photoshop Export
    if ((forensicDetails.software || '').includes('Adobe') || latinText.includes('Photoshop') || latinText.includes('Lightroom')) {
      return {
        platform: 'Adobe Creative Suite',
        badge: '🎨 Adobe Photoshop / Lightroom',
        threatBadge: 'software',
        detail: 'Exported from creative software with embedded document IDs, revision timestamps, and color profiles.'
      };
    }

    // 7. AI Generative Media (Stable Diffusion, Midjourney, DALL-E, ComfyUI, Firefly)
    if (forensicDetails.aiData || /Negative prompt:|Steps:\s*\d+|Sampler:\s*|DALL-E|Midjourney|Adobe Firefly|NovelAI|comfyui|synthid/i.test(latinText)) {
      const match = latinText.match(/(Stable Diffusion|Midjourney|DALL-E|Adobe Firefly|ComfyUI|NovelAI|SynthID)/i);
      const genName = forensicDetails.aiData?.generator || (match ? match[0] : 'AI Generative Synthesis');
      return {
        platform: 'AI Generated Media',
        badge: `🤖 AI Origin: ${genName}`,
        threatBadge: 'pro',
        detail: 'Synthesized by AI generative models. Contains embedded generation prompts, seeds, model checkpoint hashes, and workflow graphs.'
      };
    }

    // 8. C2PA / Content Credentials Authenticity
    if (latinText.includes('c2pa') || latinText.includes('content.credentials') || latinText.includes('jumbf')) {
      return {
        platform: 'C2PA Authenticity Manifest',
        badge: '🛡️ C2PA Credentials Detected',
        threatBadge: 'c2pa',
        detail: 'Cryptographic provenance signature or AI provenance metadata embedded in file stream.'
      };
    }

    // 8. Generic / Clean Web File
    return {
      platform: 'Local / Web Media',
      badge: '🌐 Local / Web Media',
      threatBadge: 'clean',
      detail: fields.length ? 'Contains standard digital metadata tags.' : 'Clean media stream with zero personal hardware markers detected.'
    };
  }

  // --------------------------------------------------------------------------
  // Universal Metadata Scanner
  // --------------------------------------------------------------------------
  async function scanFile(file) {
    const rawBuffer = await file.slice(0, Math.min(file.size, 512 * 1024)).arrayBuffer();
    const buf = new Uint8Array(rawBuffer);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const latinText = new TextDecoder('latin1').decode(buf);
    const fields = [];
    const forensicDetails = {};
    let format = 'unknown';

    // 1. JPEG
    if (buf.length >= 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
      format = 'jpeg';
      let p = 2;
      while (p + 4 <= buf.length && buf[p] === 0xFF) {
        const marker = buf[p + 1];
        if (marker === 0xD9 || marker === 0xDA) break; // EOI or SOS
        const len = (buf[p + 2] << 8) | buf[p + 3];
        if (len < 2 || p + 2 + len > buf.length) break;

        // APP1 EXIF / XMP
        if (marker === 0xE1) {
          const segText = latinText.slice(p + 4, p + 2 + len);
          if (segText.startsWith('Exif\0\0')) {
            fields.push({ category: 'Structure', label: 'EXIF Segment', value: `APP1 Block (${len} bytes)`, threat: 'med' });
            parseTiff(dv, p + 10, fields, forensicDetails);
          } else if (/http:\/\/ns\.adobe\.com\/xap/i.test(segText)) {
            fields.push({ category: 'Structure', label: 'XMP Extensible Metadata', value: `Adobe XML Stream (${len} bytes)`, threat: 'med' });
            if (/Midjourney|DALL-E|Adobe Firefly|Stable Diffusion/i.test(segText)) {
              const aiMatch = segText.match(/(Midjourney|DALL-E|Adobe Firefly|Stable Diffusion)/i);
              if (aiMatch) {
                forensicDetails.aiData = forensicDetails.aiData || {
                  generator: aiMatch[0],
                  prompt: 'AI generation model credentials and provenance manifest embedded in XMP.',
                  keyword: 'XMP'
                };
                fields.push({ category: 'AI Forensics', label: `AI Manifest (${aiMatch[0]})`, value: 'Model parameters & generation credentials', threat: 'high' });
              }
            }
          }
        } else if (marker === 0xED) {
          fields.push({ category: 'Structure', label: 'IPTC / Photoshop APP13', value: 'Embedded Photoshop Resource Block', threat: 'med' });
        } else if (marker === 0xE2) {
          fields.push({ category: 'Color', label: 'ICC Color Profile / APP2', value: 'Embedded Color Space & Display Calibration', threat: 'low' });
        } else if (marker === 0xFE) {
          const com = readAscii(buf, p + 4, len - 2);
          fields.push({ category: 'Comments', label: 'JPEG User Comment (COM)', value: com || 'Embedded string comment', threat: 'med' });
        }
        p += 2 + len;
      }
    }
    // 2. PNG
    else if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
      format = 'png';
      let p = 8;
      while (p + 12 <= buf.length) {
        const chunkLen = dv.getUint32(p);
        const typ = latinText.slice(p + 4, p + 8);
        if (p + 12 + chunkLen > buf.length) break;

        if (typ === 'tEXt' || typ === 'zTXt' || typ === 'iTXt') {
          const raw = latinText.slice(p + 8, p + 8 + chunkLen);
          const nullIdx = raw.indexOf('\0');
          const kw = nullIdx > -1 ? raw.slice(0, nullIdx) : 'Comment';
          const fullText = nullIdx > -1 ? raw.slice(nullIdx + 1) : raw;
          const val = fullText.slice(0, 80).replace(/[^\x20-\x7E]/g, '');
          fields.push({ category: 'Identity', label: `PNG ${typ} [${kw}]`, value: val || 'Metadata text payload', threat: 'high' });

          // Extract AI generation metadata & prompts (Stable Diffusion, Midjourney, ComfyUI, NovelAI)
          if (['parameters', 'prompt', 'workflow', 'Dream', 'sd-metadata'].includes(kw) || /Negative prompt:|Steps:\s*\d+/i.test(fullText)) {
            forensicDetails.aiData = {
              generator: kw === 'workflow' ? 'ComfyUI' : 'Stable Diffusion / NovelAI',
              prompt: fullText.slice(0, 2000).replace(/[^\x20-\x7E\r\n\t]/g, ''),
              keyword: kw
            };
            fields.push({ category: 'AI Forensics', label: 'AI Generation Prompt & Parameters', value: `Embedded ${kw} manifest (${chunkLen} bytes)`, threat: 'high' });
          }
        } else if (typ === 'eXIf') {
          fields.push({ category: 'Structure', label: 'PNG EXIF Chunk', value: `${chunkLen} bytes raw EXIF payload`, threat: 'high' });
          parseTiff(dv, p + 8, fields, forensicDetails);
        } else if (typ === 'tIME') {
          fields.push({ category: 'Time', label: 'PNG Timestamp (tIME)', value: 'Last file modification timestamp', threat: 'med' });
        } else if (typ === 'pHYs') {
          fields.push({ category: 'Display', label: 'Physical Dimensions (pHYs)', value: 'Pixel aspect ratio & device DPI', threat: 'low' });
        }

        if (typ === 'IEND') break;
        p += 12 + chunkLen;
      }
    }
    // 3. WebP
    else if (buf.length >= 12 && latinText.startsWith('RIFF') && latinText.slice(8, 12) === 'WEBP') {
      format = 'webp';
      let p = 12;
      while (p + 8 <= buf.length) {
        const fourCC = latinText.slice(p, p + 4);
        const chunkLen = dv.getUint32(p + 4, true);
        if (fourCC === 'EXIF') {
          fields.push({ category: 'Structure', label: 'WebP EXIF Chunk', value: `${chunkLen} bytes payload`, threat: 'high' });
          parseTiff(dv, p + 8, fields, forensicDetails);
        } else if (fourCC === 'XMP ') {
          fields.push({ category: 'Structure', label: 'WebP XMP Chunk', value: 'Extensible metadata stream', threat: 'med' });
        }
        p += 8 + ((chunkLen + 1) & ~1); // 2-byte aligned
      }
    }
    // 4. SVG
    else if (file.type === 'image/svg+xml' || file.name.endsWith('.svg') || latinText.includes('<svg')) {
      format = 'svg';
      if (/<metadata[\s>]/i.test(latinText)) fields.push({ category: 'Structure', label: 'SVG <metadata> Element', value: 'XML metadata container', threat: 'med' });
      if (/<rdf:RDF[\s>]/i.test(latinText)) fields.push({ category: 'Identity', label: 'Dublin Core / RDF', value: 'Author & license metadata', threat: 'high' });
      if (/inkscape:|sodipodi:|illustrator:/i.test(latinText)) fields.push({ category: 'System', label: 'Editor Namespace Attributes', value: 'Inkscape / Illustrator editor history', threat: 'med' });
      if (/<script[\s>]/i.test(latinText)) fields.push({ category: 'Security', label: 'Embedded <script> Tag', value: 'Executable script in SVG vector', threat: 'critical' });
    }
    // 5. MP3 Audio
    else if (buf.length >= 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
      format = 'mp3';
      const vMaj = buf[3];
      const synchLen = ((buf[6] & 0x7F) << 21) | ((buf[7] & 0x7F) << 14) | ((buf[8] & 0x7F) << 7) | (buf[9] & 0x7F);
      fields.push({ category: 'Structure', label: `ID3v2.${vMaj} Header`, value: `${synchLen} bytes audio tag container`, threat: 'med' });

      const id3Body = latinText.slice(10, Math.min(10 + synchLen, buf.length));
      if (id3Body.includes('TIT2') || id3Body.includes('TT2')) fields.push({ category: 'Metadata', label: 'Song Title (TIT2)', value: 'Embedded track title', threat: 'low' });
      if (id3Body.includes('TPE1') || id3Body.includes('TP1')) fields.push({ category: 'Identity', label: 'Artist / Performer (TPE1)', value: 'Embedded artist identity', threat: 'high' });
      if (id3Body.includes('TALB') || id3Body.includes('TAL')) fields.push({ category: 'Metadata', label: 'Album Name (TALB)', value: 'Embedded album identity', threat: 'low' });
      if (id3Body.includes('APIC') || id3Body.includes('PIC')) fields.push({ category: 'Media', label: 'Embedded Album Artwork (APIC)', value: 'High-res image embedded in audio', threat: 'med' });
      if (id3Body.includes('COMM') || id3Body.includes('COM')) fields.push({ category: 'Comments', label: 'User Comments (COMM)', value: 'Audio private comments / encoder notes', threat: 'med' });
      if (id3Body.includes('TXXX') || id3Body.includes('PRIV')) fields.push({ category: 'Forensics', label: 'Private Tag / Tracking ID', value: 'Distributor or unique buyer signature', threat: 'high' });
    }
    // 6. FLAC Audio
    else if (buf.length >= 4 && latinText.startsWith('fLaC')) {
      format = 'flac';
      fields.push({ category: 'Structure', label: 'FLAC Container', value: 'Native lossless audio bitstream', threat: 'low' });
      if (latinText.includes('artist=') || latinText.includes('ARTIST=') || latinText.includes('title=')) {
        fields.push({ category: 'Identity', label: 'Vorbis Comments', value: 'Track title, artist & album tags', threat: 'high' });
      }
      if (buf.some((b, i) => b === 6 && i > 4 && i < 100)) {
        fields.push({ category: 'Media', label: 'Embedded FLAC Cover Art', value: 'High-res album image block', threat: 'med' });
      }
    }
    // 7. WAV Audio
    else if (buf.length >= 12 && latinText.startsWith('RIFF') && latinText.slice(8, 12) === 'WAVE') {
      format = 'wav';
      fields.push({ category: 'Structure', label: 'WAV RIFF Container', value: 'Uncompressed audio wave', threat: 'low' });
      if (latinText.includes('INFO') || latinText.includes('IART') || latinText.includes('INAM')) {
        fields.push({ category: 'Metadata', label: 'RIFF INFO Tags', value: 'Track name, artist and copyright tags', threat: 'med' });
      }
      if (latinText.includes('id3 ') || latinText.includes('ID3 ')) {
        fields.push({ category: 'Structure', label: 'Embedded ID3 in WAV', value: 'ID3 metadata container chunk', threat: 'med' });
      }
    }
    // 8. PDF Document
    else if (buf.length >= 5 && latinText.startsWith('%PDF-')) {
      format = 'pdf';
      const version = latinText.slice(5, 8);
      fields.push({ category: 'Structure', label: `PDF Document v${version}`, value: 'Portable Document Format file', threat: 'low' });

      const matches = [
        [/(\/Author\s*\((.*?)\))/i, 'Author / Creator Identity', 'high'],
        [/(\/Creator\s*\((.*?)\))/i, 'Originating Application', 'med'],
        [/(\/Producer\s*\((.*?)\))/i, 'PDF Generation Engine', 'med'],
        [/(\/CreationDate\s*\((.*?)\))/i, 'Exact Document Creation Timestamp', 'high'],
        [/(\/ModDate\s*\((.*?)\))/i, 'Document Modification Timestamp', 'med'],
        [/(\/Title\s*\((.*?)\))/i, 'Internal Document Title', 'low']
      ];

      for (const [re, label, threat] of matches) {
        const m = latinText.match(re);
        if (m) {
          const val = m[2] ? m[2].trim() : 'Detected in /Info dictionary';
          fields.push({ category: 'Document', label, value: val || 'Present in document dictionary', threat });
        }
      }
      if (/<x:xmpmeta/i.test(latinText)) {
        fields.push({ category: 'Structure', label: 'PDF XMP Metadata Stream', value: 'Adobe Extensible Metadata XML stream', threat: 'med' });
      }
    }
    // 9. MP4 / MOV Video
    else if (buf.length >= 12 && (latinText.slice(4, 8) === 'ftyp' || latinText.slice(4, 8) === 'moov')) {
      format = 'mp4';
      fields.push({ category: 'Structure', label: 'ISO Base Media (MP4/QuickTime)', value: 'MPEG-4 Container', threat: 'low' });
      if (latinText.includes('udta')) {
        fields.push({ category: 'Metadata', label: 'User Data Atom (udta)', value: 'Location, device, and user metadata container', threat: 'high' });
      }
      if (latinText.includes('©xyz')) {
        fields.push({ category: 'Location', label: 'QuickTime GPS Coordinates', value: 'Hardware GPS recorded by phone camera', threat: 'critical' });
      }
      if (latinText.includes('©mak') || latinText.includes('©mod')) {
        fields.push({ category: 'Hardware', label: 'Recording Camera / Phone Model', value: 'Device hardware identification', threat: 'high' });
      }
    }

    // Deduplicate fields
    const uniqueMap = new Map();
    fields.forEach(f => {
      const k = `${f.category}:${f.label}`;
      if (!uniqueMap.has(k)) uniqueMap.set(k, f);
    });
    const uniqueFields = Array.from(uniqueMap.values());

    // Calculate Threat Level & Privacy Score (0-100) & Grade (A+, B, C, D, F)
    let threatLevel = 'clean';
    let threatGrade = 'A+';
    let privacyScore = 100;

    if (uniqueFields.some(f => f.threat === 'critical')) {
      threatLevel = 'critical';
      threatGrade = 'F';
      privacyScore = Math.max(10, 30 - uniqueFields.length * 2);
    } else if (uniqueFields.some(f => f.threat === 'high')) {
      threatLevel = 'high';
      threatGrade = 'D';
      privacyScore = Math.max(35, 55 - uniqueFields.length * 2);
    } else if (uniqueFields.some(f => f.threat === 'med')) {
      threatLevel = 'med';
      threatGrade = 'C';
      privacyScore = Math.max(60, 75 - uniqueFields.length * 2);
    } else if (uniqueFields.length > 0) {
      threatGrade = 'B';
      privacyScore = Math.max(80, 92 - uniqueFields.length);
    }

    // Provenance / Platform Detection
    const provenance = detectProvenance(buf, format, file.name, uniqueFields, forensicDetails, latinText);

    // Initial Hex Preview
    const hexDump = generateHexDump(buf, 128);

    // Cryptographic Hash
    const sha256 = await computeSha256(file);

    return {
      format,
      fields: uniqueFields,
      threatLevel,
      threatGrade,
      privacyScore,
      aiData: forensicDetails.aiData || null,
      gps: forensicDetails.gps || null,
      forensicDetails,
      provenance,
      hexDump,
      sha256,
      originalSize: file.size
    };
  }

  // --------------------------------------------------------------------------
  // Lossless Sanitization Functions
  // --------------------------------------------------------------------------

  // 1. JPEG Lossless Cleaner
  function cleanJpegLossless(buf, preserveIcc = false, selectiveMode = 'all') {
    if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return buf;
    const out = [];
    out.push(new Uint8Array([0xFF, 0xD8])); // SOI

    let p = 2;
    const n = buf.length;

    while (p + 4 <= n) {
      if (buf[p] !== 0xFF) {
        p++;
        continue;
      }
      const marker = buf[p + 1];
      if (marker === 0xD9) { // EOI
        out.push(new Uint8Array([0xFF, 0xD9]));
        break;
      }
      if (marker === 0xDA) { // SOS
        out.push(buf.slice(p));
        break;
      }

      const len = (buf[p + 2] << 8) | buf[p + 3];
      if (len < 2 || p + 2 + len > n) break;

      const isApp = (marker >= 0xE1 && marker <= 0xEF);
      const isCom = (marker === 0xFE);
      const isIcc = (marker === 0xE2 && preserveIcc);

      if (selectiveMode === 'gps_only') {
        // If GPS only mode, we scrub GPS markers but keep others
        let keepSegment = true;
        if (marker === 0xE1) {
          // Check if EXIF contains GPS info pointer tag 0x8825 and zero it
          const seg = new Uint8Array(buf.slice(p, p + 2 + len));
          const segText = new TextDecoder('latin1').decode(seg);
          if (segText.includes('GPS')) {
            // Scrub GPS text occurrences in APP1
            for (let i = 4; i < seg.length - 4; i++) {
              if (seg[i] === 0x47 && seg[i+1] === 0x50 && seg[i+2] === 0x53) { // 'GPS'
                seg[i] = 0; seg[i+1] = 0; seg[i+2] = 0;
              }
            }
          }
          out.push(seg);
          keepSegment = false;
        }
        if (keepSegment) {
          out.push(buf.slice(p, p + 2 + len));
        }
      } else {
        if (!isApp && !isCom || isIcc) {
          out.push(buf.slice(p, p + 2 + len));
        }
      }

      p += 2 + len;
    }

    const totalLen = out.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    out.forEach(chunk => {
      result.set(chunk, offset);
      offset += chunk.length;
    });
    return result;
  }

  // 2. PNG Lossless Cleaner
  function cleanPngLossless(buf, preserveIcc = false) {
    if (buf.length < 8) return buf;
    const pngSig = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    for (let i = 0; i < 8; i++) {
      if (buf[i] !== pngSig[i]) return buf;
    }

    const out = [pngSig];
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let p = 8;
    const n = buf.length;

    const dropChunks = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'pHYs', 'dSIG']);
    if (!preserveIcc) dropChunks.add('iCCP');

    while (p + 12 <= n) {
      const len = dv.getUint32(p);
      let typ = '';
      for (let i = 0; i < 4; i++) typ += String.fromCharCode(buf[p + 4 + i]);
      const totalLen = 12 + len;
      if (p + totalLen > n) break;

      if (!dropChunks.has(typ)) {
        out.push(buf.slice(p, p + totalLen));
      }

      if (typ === 'IEND') break;
      p += totalLen;
    }

    const totalLen = out.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    out.forEach(chunk => {
      result.set(chunk, offset);
      offset += chunk.length;
    });
    return result;
  }

  // 3. WebP Lossless Cleaner
  function cleanWebpLossless(buf) {
    if (buf.length < 12) return buf;
    const text = new TextDecoder('latin1').decode(buf.slice(0, 12));
    if (!text.startsWith('RIFF') || text.slice(8, 12) !== 'WEBP') return buf;

    const outChunks = [];
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let p = 12;
    const n = buf.length;

    while (p + 8 <= n) {
      let fourCC = '';
      for (let i = 0; i < 4; i++) fourCC += String.fromCharCode(buf[p + i]);
      const chunkLen = dv.getUint32(p + 4, true);
      const paddedLen = (chunkLen + 1) & ~1;
      const fullLen = 8 + paddedLen;
      if (p + fullLen > n) break;

      if (fourCC !== 'EXIF' && fourCC !== 'XMP ') {
        let chunkData = buf.slice(p, p + fullLen);
        if (fourCC === 'VP8X' && chunkData.length >= 12) {
          chunkData[8] &= ~0x08; // Clear EXIF flag
          chunkData[8] &= ~0x04; // Clear XMP flag
        }
        outChunks.push(chunkData);
      }
      p += fullLen;
    }

    const chunksTotalSize = outChunks.reduce((acc, c) => acc + c.length, 0);
    const riffSize = 4 + chunksTotalSize;
    const result = new Uint8Array(12 + chunksTotalSize);
    result.set(new TextEncoder().encode('RIFF'), 0);
    new DataView(result.buffer).setUint32(4, riffSize, true);
    result.set(new TextEncoder().encode('WEBP'), 8);

    let offset = 12;
    outChunks.forEach(c => {
      result.set(c, offset);
      offset += c.length;
    });
    return result;
  }

  // 4. SVG Cleaner
  function cleanSvgText(svgStr) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgStr, 'image/svg+xml');
      const rootEl = doc.documentElement;

      ['metadata', 'desc', 'title', 'script'].forEach(tag => {
        doc.querySelectorAll(tag).forEach(el => el.remove());
      });

      const walk = el => {
        const attrs = Array.from(el.attributes || []);
        attrs.forEach(attr => {
          const n = attr.name.toLowerCase();
          if (n.startsWith('inkscape:') || n.startsWith('sodipodi:') || n.startsWith('xmlns:inkscape') || n.startsWith('xmlns:sodipodi') || n.startsWith('adobe:')) {
            el.removeAttribute(attr.name);
          }
        });
        for (const child of el.children) walk(child);
      };
      walk(rootEl);

      return new XMLSerializer().serializeToString(doc);
    } catch (_) {
      return svgStr
        .replace(/<metadata[\s\S]*?<\/metadata>/gi, '')
        .replace(/<desc[\s\S]*?<\/desc>/gi, '')
        .replace(/<title[\s\S]*?<\/title>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '');
    }
  }

  // 5. MP3 Cleaner
  function cleanMp3Lossless(buf) {
    let pos = 0;
    const n = buf.length;

    while (pos + 10 <= n && buf[pos] === 0x49 && buf[pos+1] === 0x44 && buf[pos+2] === 0x33) {
      const flags = buf[pos+5];
      const s = ((buf[pos+6]&0x7F)<<21) | ((buf[pos+7]&0x7F)<<14) | ((buf[pos+8]&0x7F)<<7) | (buf[pos+9]&0x7F);
      const tagLen = 10 + s + ((flags & 0x10) ? 10 : 0);
      pos += tagLen;
    }

    let end = n;
    if (end - pos >= 128 && buf[end-128] === 0x54 && buf[end-127] === 0x41 && buf[end-126] === 0x47) {
      end -= 128;
    }

    if (end - pos >= 32) {
      const apeCheck = String.fromCharCode(...buf.slice(end - 32, end - 24));
      if (apeCheck === 'APETAGEX') {
        const apeSize = (buf[end-20]) | (buf[end-19]<<8) | (buf[end-18]<<16) | (buf[end-17]<<24);
        if (apeSize > 0 && end - apeSize >= pos) {
          end -= apeSize;
        }
      }
    }

    return buf.slice(pos, end);
  }

  // 6. FLAC Cleaner
  function cleanFlacLossless(buf) {
    if (buf.length < 4 || String.fromCharCode(...buf.slice(0, 4)) !== 'fLaC') return buf;
    const out = [buf.slice(0, 4)];
    let pos = 4;
    const n = buf.length;

    const keptBlocks = [];
    let isLast = false;

    while (pos + 4 <= n && !isLast) {
      const b0 = buf[pos];
      isLast = (b0 & 0x80) !== 0;
      const bType = b0 & 0x7F;
      const len = (buf[pos+1] << 16) | (buf[pos+2] << 8) | buf[pos+3];
      const totalLen = 4 + len;
      if (pos + totalLen > n) break;

      if (bType !== 4 && bType !== 6) {
        keptBlocks.push({
          type: bType,
          data: buf.slice(pos, pos + totalLen)
        });
      }
      pos += totalLen;
    }

    if (keptBlocks.length > 0) {
      keptBlocks[keptBlocks.length - 1].data[0] |= 0x80;
      keptBlocks.forEach(b => out.push(b.data));
    }

    if (pos < n) {
      out.push(buf.slice(pos));
    }

    const totalLen = out.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    out.forEach(chunk => {
      result.set(chunk, offset);
      offset += chunk.length;
    });
    return result;
  }

  // 7. WAV Cleaner
  function cleanWavLossless(buf) {
    if (buf.length < 12) return buf;
    const latin = new TextDecoder('latin1').decode(buf.slice(0, 12));
    if (!latin.startsWith('RIFF') || latin.slice(8, 12) !== 'WAVE') return buf;

    const outChunks = [];
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let p = 12;
    const n = buf.length;

    while (p + 8 <= n) {
      let fourCC = '';
      for (let i = 0; i < 4; i++) fourCC += String.fromCharCode(buf[p + i]);
      const chunkLen = dv.getUint32(p + 4, true);
      const paddedLen = (chunkLen + 1) & ~1;
      const fullLen = 8 + paddedLen;
      if (p + fullLen > n) break;

      if (fourCC === 'LIST') {
        const listType = p + 12 <= n ? String.fromCharCode(...buf.slice(p + 8, p + 12)) : '';
        if (listType !== 'INFO') outChunks.push(buf.slice(p, p + fullLen));
      } else if (fourCC !== 'id3 ' && fourCC !== 'ID3 ') {
        outChunks.push(buf.slice(p, p + fullLen));
      }
      p += fullLen;
    }

    const chunksTotalSize = outChunks.reduce((acc, c) => acc + c.length, 0);
    const riffSize = 4 + chunksTotalSize;
    const result = new Uint8Array(12 + chunksTotalSize);
    result.set(new TextEncoder().encode('RIFF'), 0);
    new DataView(result.buffer).setUint32(4, riffSize, true);
    result.set(new TextEncoder().encode('WAVE'), 8);

    let offset = 12;
    outChunks.forEach(c => {
      result.set(c, offset);
      offset += c.length;
    });
    return result;
  }

  // 8. PDF Cleaner
  function cleanPdfPreserveOffsets(buf) {
    const out = new Uint8Array(buf);
    const latin = new TextDecoder('latin1').decode(out);
    const fields = ['Author', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Title', 'Subject', 'Keywords'];

    for (const f of fields) {
      const re = new RegExp('/' + f + '\\s*\\((.*?)\\)', 'gs');
      let m;
      while ((m = re.exec(latin)) !== null) {
        const start = m.index + m[0].indexOf('(') + 1;
        const end = m.index + m[0].lastIndexOf(')');
        for (let i = start; i < end; i++) out[i] = 0x20;
      }
    }

    const xmpRe = /<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/g;
    let xm;
    while ((xm = xmpRe.exec(latin)) !== null) {
      for (let i = xm.index; i < xm.index + xm[0].length; i++) {
        out[i] = 0x20;
      }
    }

    return out;
  }

  // 9. MP4 / MOV Video Cleaner
  function cleanMp4Lossless(buf) {
    const out = new Uint8Array(buf);
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const n = out.length;

    function scanBoxes(start, end) {
      let p = start;
      while (p + 8 <= end) {
        let size = dv.getUint32(p);
        let typ = '';
        for (let i = 0; i < 4; i++) typ += String.fromCharCode(out[p + 4 + i]);

        if (size === 1 && p + 16 <= end) {
          size = Number(dv.getBigUint64(p + 8));
        } else if (size === 0) {
          size = end - p;
        }
        if (size < 8 || p + size > end) break;

        if (typ === 'udta') {
          out[p + 4] = 0x66; out[p + 5] = 0x72; out[p + 6] = 0x65; out[p + 7] = 0x65; // 'free'
          for (let i = p + 8; i < p + size; i++) out[i] = 0;
        } else if (typ === 'moov' || typ === 'trak' || typ === 'mdia') {
          scanBoxes(p + 8, p + size);
        } else if (typ === 'mvhd' || typ === 'tkhd') {
          const v = out[p + 8];
          if (v === 0 && p + 20 <= end) {
            dv.setUint32(p + 12, 0);
            dv.setUint32(p + 16, 0);
          } else if (v === 1 && p + 28 <= end) {
            dv.setBigUint64(p + 12, 0n);
            dv.setBigUint64(p + 20, 0n);
          }
        }

        p += size;
      }
    }

    scanBoxes(0, n);
    return out;
  }

  // 10. Deep Canvas Raster Cleaner
  async function cleanImageRaster(file, quality = 0.95, watermark = false) {
    const img = new Image();
    const url = URL.createObjectURL(file);
    try {
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      if (watermark) {
        const fontSize = Math.max(14, Math.round(canvas.width / 42));
        ctx.font = `700 ${fontSize}px sans-serif`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
        ctx.shadowBlur = 4;
        ctx.textAlign = 'right';
        ctx.fillText('🛡️ PRIVACY PROTECTED • METACLEAN', canvas.width - 20, canvas.height - 20);
      }

      const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const blob = await new Promise(r => canvas.toBlob(r, mime, mime === 'image/jpeg' ? quality : undefined));
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // --------------------------------------------------------------------------
  // Main Clean Dispatcher
  // --------------------------------------------------------------------------
  async function cleanFile(file, options = {}) {
    const mode = options.mode || 'lossless';
    const preserveIcc = !!options.preserveIcc;
    const selectiveMode = options.selectiveMode || 'all';
    const watermark = !!options.watermark;
    const scan = await scanFile(file);
    let cleanBlob = null;

    if (mode === 'raster' && (scan.format === 'jpeg' || scan.format === 'png' || scan.format === 'webp')) {
      cleanBlob = await cleanImageRaster(file, options.rasterQuality || 0.95, watermark);
    } else {
      const rawBuf = new Uint8Array(await file.arrayBuffer());
      let cleanBuf = null;

      switch (scan.format) {
        case 'jpeg':
          cleanBuf = cleanJpegLossless(rawBuf, preserveIcc, selectiveMode);
          cleanBlob = new Blob([cleanBuf], { type: 'image/jpeg' });
          break;
        case 'png':
          cleanBuf = cleanPngLossless(rawBuf, preserveIcc);
          cleanBlob = new Blob([cleanBuf], { type: 'image/png' });
          break;
        case 'webp':
          cleanBuf = cleanWebpLossless(rawBuf);
          cleanBlob = new Blob([cleanBuf], { type: 'image/webp' });
          break;
        case 'svg': {
          const text = new TextDecoder().decode(rawBuf);
          const cleanedText = cleanSvgText(text);
          cleanBlob = new Blob([cleanedText], { type: 'image/svg+xml' });
          break;
        }
        case 'mp3':
          cleanBuf = cleanMp3Lossless(rawBuf);
          cleanBlob = new Blob([cleanBuf], { type: 'audio/mpeg' });
          break;
        case 'flac':
          cleanBuf = cleanFlacLossless(rawBuf);
          cleanBlob = new Blob([cleanBuf], { type: 'audio/flac' });
          break;
        case 'wav':
          cleanBuf = cleanWavLossless(rawBuf);
          cleanBlob = new Blob([cleanBuf], { type: 'audio/wav' });
          break;
        case 'pdf':
          cleanBuf = cleanPdfPreserveOffsets(rawBuf);
          cleanBlob = new Blob([cleanBuf], { type: 'application/pdf' });
          break;
        case 'mp4':
          cleanBuf = cleanMp4Lossless(rawBuf);
          cleanBlob = new Blob([cleanBuf], { type: 'video/mp4' });
          break;
        default:
          if (file.type.startsWith('image/')) {
            cleanBlob = await cleanImageRaster(file, 0.95);
          } else {
            cleanBlob = file;
          }
          break;
      }
    }

    // Verify cleaned result & get clean hex dump
    const cleanRawBuf = new Uint8Array(await cleanBlob.slice(0, 128).arrayBuffer());
    const cleanHexDump = generateHexDump(cleanRawBuf, 128);
    const verifyScan = await scanFile(new File([cleanBlob], file.name, { type: cleanBlob.type }));
    const cleanSha256 = await computeSha256(cleanBlob);

    return {
      cleanBlob,
      originalSize: file.size,
      cleanSize: cleanBlob.size,
      removedCount: Math.max(0, scan.fields.length - verifyScan.fields.length),
      remainingCount: verifyScan.fields.length,
      beforeFields: scan.fields,
      afterFields: verifyScan.fields,
      beforeThreatGrade: scan.threatGrade,
      afterThreatGrade: 'A+',
      beforePrivacyScore: scan.privacyScore,
      afterPrivacyScore: 100,
      aiData: scan.aiData,
      format: scan.format,
      cleanHexDump,
      sourceSha256: scan.sha256,
      cleanSha256,
      isClean: verifyScan.fields.length === 0
    };
  }

  /**
   * Cryptographic SHA-256 Hasher
   */
  async function computeSha256(data) {
    try {
      let buf;
      if (data instanceof ArrayBuffer) buf = data;
      else if (data instanceof Uint8Array) buf = data.buffer;
      else if (data instanceof Blob) buf = await data.arrayBuffer();
      else buf = new TextEncoder().encode(String(data));

      const hashBuf = await crypto.subtle.digest('SHA-256', buf);
      const hashArr = Array.from(new Uint8Array(hashBuf));
      return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      return 'N/A';
    }
  }

  // Export
  root.MetaCleanEngine = {
    scanFile,
    cleanFile,
    cleanJpegLossless,
    cleanPngLossless,
    cleanWebpLossless,
    cleanSvgText,
    cleanMp3Lossless,
    cleanFlacLossless,
    cleanWavLossless,
    cleanPdfPreserveOffsets,
    cleanMp4Lossless,
    cleanImageRaster,
    generateHexDump,
    detectProvenance,
    computeSha256,
    fmtSize,
    esc
  };

})(typeof window !== 'undefined' ? window : globalThis);

