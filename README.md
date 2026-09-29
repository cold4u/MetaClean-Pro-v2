# MetaClean Pro v2.2 — Universal Privacy & Metadata Eliminator

> **100% Client-Side • Zero Network Transmission • Zero Quality Loss**

Live Deployment: [https://cold4u.github.io/MetaClean-Pro-v2/](https://cold4u.github.io/MetaClean-Pro-v2/)

---

## 🌟 What is MetaClean Pro v2.2?

MetaClean Pro v2.2 is an enterprise-grade, browser-based digital sanitization suite designed to inspect, audit, and strip tracking payloads, exact physical GPS coordinates, hardware serial numbers, author identities, and hidden metadata from **Images, Audio, Documents, and Videos** without server uploads or loss of media fidelity.

---

## 🚀 Key Capabilities

### 1. Multi-Format Universal Engine
* **Images**:
  * **JPEG / JPG**: True binary lossless scrubbing of APP1–APP15 segments (EXIF, XMP, Photoshop IRB/IPTC) & COM markers without touching DCT coefficient tables.
  * **PNG**: Lossless chunk stripping (`tEXt`, `zTXt`, `iTXt`, `eXIf`, `tIME`, `pHYs`, `dSIG`) preserving critical rendering structures.
  * **WebP**: Scrubbing of Extended WebP `EXIF` and `XMP ` RIFF sub-chunks with header flag normalization.
  * **SVG**: Full XML DOM sanitizer eliminating `<metadata>`, `<desc>`, `<title>`, `<script>`, and namespace editor leakage (Inkscape/Illustrator).
* **Audio**:
  * **MP3**: Header and frame-level stripping of ID3v2 (v2.2, v2.3, v2.4), embedded album art (`APIC`), distributor/tracking tags, trailing ID3v1 tags, and APE markers.
  * **FLAC**: Metadata block parser preserving audio stream while removing Vorbis comments and embedded cover art.
  * **WAV**: RIFF container parser scrubbing `LIST - INFO` and `id3 ` chunks.
* **Documents**:
  * **PDF**: Offset-preserving `/Info` dictionary sanitizer (`/Author`, `/Creator`, `/Producer`, `/CreationDate`, `/ModDate`) and `/Metadata` XMP stream nullification.
* **Videos**:
  * **MP4 / QuickTime / MOV**: Zero-transcode removal of `udta` (User Data) GPS coordinates (`©xyz`) and device metadata with `mvhd`/`tkhd` timestamp sanitization.

### 2. Dual Scrubbing Modes
* **Lossless Binary Scrub (Default)**: Bit-exact, instant sanitization that retains 100% of original image/audio clarity.
* **Deep Raster Re-render (Visual Anti-Steganography)**: Reconstructs pixel arrays from scratch onto an in-memory canvas to defeat hidden steganographic payloads.

### 3. Cyber Forensics & Telemetry Matrix
* Detailed tag extraction: Camera Make/Model, Lens, Shutter Speed, Aperture, ISO, Serial Numbers.
* **Live GPS Geolocation Telemetry**: Decodes GPS latitude/longitude/altitude and provides safe one-click OpenStreetMap visualization.
* **Threat Score Radar**:
  * 🔴 **CRITICAL**: Physical GPS Location Detected
  * 🟠 **HIGH**: Device Serial Number or Owner Identity Detected
  * 🟡 **MEDIUM**: Modification Timestamps or Editing Software Detected
  * 🟢 **SECURE**: Zero Tracking Metadata Remaining

### 4. Batch Operations & Built-in ZIP Archiving
* Drag-and-drop dozens of mixed files or paste directly from clipboard (<kbd>Ctrl</kbd>+<kbd>V</kbd> / <kbd>⌘</kbd>+<kbd>V</kbd>).
* Built-in zero-dependency client-side ZIP generator (`zip.js`) for one-click bulk sanitized downloads.
* Anonymize Filenames option to strip timestamp leaks from camera file names (e.g. `IMG_20240929_1423.jpg` → `photo_clean_7a3f.jpg`).

### 5. 29-Game Built-in Cyber Arcade Hub
* Integrated 29-game retro arcade cabinet powered by Web Audio synthesizers, procedural game loops, and responsive controls for breaks during heavy batch workflows.

---

## 🔒 Privacy & Security Guarantee

1. **Air-Gapped Operation**: All processing occurs strictly within your browser's local memory (`ArrayBuffer` & `Uint8Array`).
2. **Zero Telemetry**: No third-party tracking, analytics, cookies, or external CDN dependencies.
3. **Open Source & Auditable**: Every byte-level parser is inspectable in [`engine.js`](./engine.js).
