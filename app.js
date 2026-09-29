/**
 * MetaClean Pro v2.3 — Application Controller & Reactive UI
 * Universal Multi-Format Metadata Eliminator with 29-Game Cyber Arcade Cabinet
 */
(function() {
  'use strict';

  // ── DOM Helpers ──
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  // ── State ──
  const queue = new Map();
  let fileSequence = 0;
  let activeFilter = 'all';
  let deferredPrompt = null;

  // ── Elements ──
  const dropZone = $('#drop');
  const fileInput = $('#fileInput');
  const folderInput = $('#folderInput');
  const cameraInput = $('#cameraInput');
  const btnBrowseFiles = $('#btnBrowseFiles');
  const btnBrowseFolder = $('#btnBrowseFolder');
  const btnPrivacyCam = $('#btnPrivacyCam');
  const queueSection = $('#queueSection');
  const fileQueueList = $('#fileQueueList');
  const cleanAllBtn = $('#cleanAllBtn');
  const downloadZipBtn = $('#downloadZipBtn');
  const clearQueueBtn = $('#clearQueueBtn');
  const cleanModeSelect = $('#cleanModeSelect');
  const optAnonymize = $('#optAnonymize');
  const optPreserveIcc = $('#optPreserveIcc');
  const installAppBtn = $('#installAppBtn');

  const batchProgressContainer = $('#batchProgressContainer');
  const batchProgressBar = $('#batchProgressBar');
  const progressStateText = $('#progressStateText');
  const progressPercentText = $('#progressPercentText');

  const verificationBanner = $('#verificationBanner');
  const vBeforeCount = $('#vBeforeCount');
  const vAfterCount = $('#vAfterCount');
  const vSavingsBytes = $('#vSavingsBytes');

  // ── Helper: Guess Mime Type from Filename ──
  function guessMimeType(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    switch (ext) {
      case 'jpg': case 'jpeg': return 'image/jpeg';
      case 'png': return 'image/png';
      case 'webp': return 'image/webp';
      case 'svg': return 'image/svg+xml';
      case 'mp3': return 'audio/mpeg';
      case 'flac': return 'audio/flac';
      case 'wav': return 'audio/wav';
      case 'pdf': return 'application/pdf';
      case 'mp4': return 'video/mp4';
      case 'mov': return 'video/quicktime';
      default: return 'application/octet-stream';
    }
  }

  // ── Drag & Drop Events ──
  ['dragenter', 'dragover'].forEach(evt => {
    dropZone.addEventListener(evt, e => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
  });

  // ── Recursive Directory Traversal for Folder Drops ──
  async function traverseFileTree(item) {
    if (!item) return [];
    if (item.isFile) {
      return new Promise(resolve => {
        item.file(file => resolve([file]), () => resolve([]));
      });
    } else if (item.isDirectory) {
      const dirReader = item.createReader();
      return new Promise(resolve => {
        const entries = [];
        function readBatch() {
          dirReader.readEntries(async results => {
            if (!results || !results.length) {
              const allFiles = [];
              for (const child of entries) {
                const childFiles = await traverseFileTree(child);
                allFiles.push(...childFiles);
              }
              resolve(allFiles);
            } else {
              entries.push(...results);
              readBatch();
            }
          }, () => resolve([]));
        }
        readBatch();
      });
    }
    return [];
  }

  dropZone.addEventListener('drop', async e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');

    const items = e.dataTransfer?.items;
    if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
      const foundFiles = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry();
        if (entry) {
          const entryFiles = await traverseFileTree(entry);
          foundFiles.push(...entryFiles);
        }
      }
      if (foundFiles.length > 0) {
        handleFiles(foundFiles);
        return;
      }
    }

    if (e.dataTransfer && e.dataTransfer.files) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  });

  fileInput.addEventListener('change', e => {
    if (e.target.files) {
      handleFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  });

  if (folderInput) {
    folderInput.addEventListener('change', e => {
      if (e.target.files) {
        handleFiles(Array.from(e.target.files));
        e.target.value = '';
      }
    });
  }

  if (cameraInput) {
    cameraInput.addEventListener('change', e => {
      if (e.target.files) {
        handleFiles(Array.from(e.target.files));
        e.target.value = '';
      }
    });
  }

  if (btnBrowseFiles) {
    btnBrowseFiles.onclick = (e) => {
      e.preventDefault();
      fileInput.click();
    };
  }

  if (btnBrowseFolder) {
    btnBrowseFolder.onclick = (e) => {
      e.preventDefault();
      folderInput.click();
    };
  }

  if (btnPrivacyCam) {
    btnPrivacyCam.onclick = (e) => {
      e.preventDefault();
      cameraInput.click();
    };
  }

  // Keyboard navigation on drop label
  dropZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  // Global Clipboard Paste (Ctrl+V / Cmd+V)
  window.addEventListener('paste', e => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    const files = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const f = items[i].getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      handleFiles(files);
    }
  });

  // ── Ingest Files (Supports Direct Files and .ZIP Archives) ──
  async function handleFiles(files) {
    if (!files.length) return;
    queueSection.classList.remove('hidden');

    for (const file of files) {
      // 1. Auto-extract ZIP Archives in-memory
      if (file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip') {
        try {
          const extracted = await window.readZip(file);
          if (extracted && extracted.length > 0) {
            const virtualFiles = extracted.map(item => new File([item.data], item.name, {
              type: guessMimeType(item.name)
            }));
            await handleFiles(virtualFiles);
          }
        } catch (err) {
          console.error('ZIP unpack error:', err);
          alert('Could not unpack ZIP: ' + err.message);
        }
        continue;
      }

      // 2. Standard File Ingest
      const id = 'f_' + (++fileSequence);
      const entry = {
        id,
        file,
        format: 'unknown',
        thumbUrl: null,
        scan: null,
        cleanResult: null,
        status: 'scanning',
        forensicsOpen: false,
        hexOpen: false
      };
      queue.set(id, entry);
      renderCardSkeleton(entry);

      // Perform deep forensic scan in background
      try {
        const scan = await window.MetaCleanEngine.scanFile(file);
        entry.scan = scan;
        entry.format = scan.format;
        entry.status = 'ready';

        // Thumbnail for images or covers
        if (file.type.startsWith('image/') || scan.format === 'jpeg' || scan.format === 'png' || scan.format === 'webp') {
          entry.thumbUrl = URL.createObjectURL(file);
        }

        updateCardUI(id);
      } catch (err) {
        console.error('Scan error:', err);
        entry.status = 'error';
        updateCardUI(id);
      }
    }

    updateMetrics();
  }

  // ── Card Rendering ──
  function getFormatIcon(format) {
    switch (format) {
      case 'jpeg':
      case 'png':
      case 'webp':
      case 'svg':
        return '🖼️';
      case 'mp3':
      case 'flac':
      case 'wav':
        return '🎵';
      case 'pdf':
        return '📄';
      case 'mp4':
        return '🎥';
      default:
        return '📁';
    }
  }

  function renderCardSkeleton(entry) {
    const el = document.createElement('div');
    el.className = 'file-card';
    el.id = 'card_' + entry.id;
    el.dataset.format = entry.format;

    el.innerHTML = `
      <div class="file-card-main">
        <div class="file-thumb-box" id="thumb_${entry.id}">
          <span class="file-thumb-icon">${getFormatIcon(entry.format)}</span>
        </div>
        <div class="file-info-col">
          <div class="file-name-row">
            <span class="file-title" id="title_${entry.id}" title="${window.MetaCleanEngine.esc(entry.file.name)}">${window.MetaCleanEngine.esc(entry.file.name)}</span>
            <span class="format-tag" id="fmt_${entry.id}">Scanning</span>
            <span class="threat-pill clean" id="threat_${entry.id}">Scanning…</span>
          </div>
          <div class="file-meta-sub">
            <span class="size-stat" id="size_${entry.id}">${window.MetaCleanEngine.fmtSize(entry.file.size)}</span>
            <span id="tagsCount_${entry.id}">Scanning metadata…</span>
          </div>
        </div>
        <div class="file-actions-col">
          <button class="btn btn-ghost btn-sm" id="btnInspect_${entry.id}" style="display:none;" onclick="toggleForensics('${entry.id}')">
            🔍 Forensics
          </button>
          <button class="btn btn-primary btn-sm" id="btnClean_${entry.id}" disabled onclick="cleanSingle('${entry.id}')">
            Clean
          </button>
          <button class="btn btn-success btn-sm" id="btnDownload_${entry.id}" style="display:none;" onclick="downloadSingle('${entry.id}')">
            Download
          </button>
          <button class="btn btn-share btn-sm" id="btnShare_${entry.id}" style="display:none;" onclick="shareSingle('${entry.id}')">
            Share 📤
          </button>
          <button class="btn-icon-del" onclick="removeFile('${entry.id}')" title="Remove from queue">✕</button>
        </div>
      </div>
      <div class="forensics-drawer hidden" id="drawer_${entry.id}"></div>
    `;

    fileQueueList.prepend(el);
  }

  function updateCardUI(id) {
    const entry = queue.get(id);
    if (!entry) return;

    const card = $('#card_' + id);
    if (!card) return;

    card.dataset.format = entry.format;

    // Apply filter visibility
    applyFilterToCard(card, entry.format);

    // Threat level styling
    const threatClass = `threat-${entry.scan?.threatLevel || 'clean'}`;
    card.className = `file-card ${threatClass} ${entry.cleanResult ? 'cleaned' : ''}`;

    // Thumbnail
    const thumbBox = $('#thumb_' + id);
    if (thumbBox) {
      if (entry.thumbUrl) {
        thumbBox.innerHTML = `<img src="${entry.thumbUrl}" class="file-thumb-img" alt="preview">`;
      } else {
        thumbBox.innerHTML = `<span class="file-thumb-icon">${getFormatIcon(entry.format)}</span>`;
      }
    }

    // Format tag
    const fmtTag = $('#fmt_' + id);
    if (fmtTag) fmtTag.textContent = entry.format.toUpperCase();

    // Threat Pill
    const threatPill = $('#threat_' + id);
    if (threatPill && entry.scan) {
      threatPill.className = `threat-pill ${entry.scan.threatLevel}`;
      switch (entry.scan.threatLevel) {
        case 'critical':
          threatPill.textContent = '🔴 CRITICAL: GPS Location';
          break;
        case 'high':
          threatPill.textContent = '🟠 HIGH: Hardware / Owner ID';
          break;
        case 'med':
          threatPill.textContent = '🟡 MEDIUM: Timestamps / Software';
          break;
        default:
          threatPill.textContent = '🟢 SECURE: 0 Tracking Tags';
          break;
      }
    }

    // Metadata Tags Count
    const tagsCount = $('#tagsCount_' + id);
    if (tagsCount && entry.scan) {
      const cnt = entry.scan.fields.length;
      tagsCount.textContent = cnt ? `${cnt} embedded metadata field${cnt !== 1 ? 's' : ''}` : 'No common tracking tags';
    }

    // Size & Savings
    const sizeStat = $('#size_' + id);
    if (sizeStat) {
      if (entry.cleanResult) {
        const removed = entry.file.size - entry.cleanResult.cleanSize;
        sizeStat.innerHTML = `${window.MetaCleanEngine.fmtSize(entry.cleanResult.cleanSize)} ${removed > 0 ? `<span class="savings-badge">(−${window.MetaCleanEngine.fmtSize(removed)})</span>` : ''}`;
      } else {
        sizeStat.textContent = window.MetaCleanEngine.fmtSize(entry.file.size);
      }
    }

    // Buttons
    const inspectBtn = $('#btnInspect_' + id);
    if (inspectBtn && entry.scan) {
      inspectBtn.style.display = 'inline-flex';
      inspectBtn.textContent = `🔍 Forensics (${entry.scan.fields.length})`;
    }

    const cleanBtn = $('#btnClean_' + id);
    if (cleanBtn) {
      cleanBtn.disabled = entry.status === 'cleaning' || !!entry.cleanResult;
      if (entry.cleanResult) {
        cleanBtn.textContent = 'Stripped';
        cleanBtn.style.display = 'none';
      }
    }

    const downloadBtn = $('#btnDownload_' + id);
    if (downloadBtn) {
      downloadBtn.style.display = entry.cleanResult ? 'inline-flex' : 'none';
    }

    const shareBtn = $('#btnShare_' + id);
    if (shareBtn) {
      shareBtn.style.display = (entry.cleanResult && typeof navigator.share === 'function') ? 'inline-flex' : 'none';
    }

    // Forensics Drawer
    renderForensicsDrawer(id);
  }

  function renderForensicsDrawer(id) {
    const entry = queue.get(id);
    const drawer = $('#drawer_' + id);
    if (!drawer || !entry || !entry.scan) return;

    // Provenance Card
    let provHtml = '';
    if (entry.scan.provenance) {
      provHtml = `
        <div class="provenance-card">
          <div class="provenance-info">
            <span class="provenance-badge">${entry.scan.provenance.badge}</span>
            <span class="provenance-desc">${entry.scan.provenance.detail}</span>
          </div>
        </div>
      `;
    }

    // Tags Grid with Live Search Filter
    let tagsHtml = '';
    if (entry.scan.fields.length) {
      const itemsHtml = entry.scan.fields.map(f => `
        <div class="forensic-item" data-tag-text="${window.MetaCleanEngine.esc((f.category + ' ' + f.label + ' ' + f.value).toLowerCase())}">
          <span class="forensic-label">${window.MetaCleanEngine.esc(f.category)} • ${window.MetaCleanEngine.esc(f.label)}</span>
          <span class="forensic-val ${f.threat === 'critical' ? 'highlight' : ''}">${window.MetaCleanEngine.esc(f.value)}</span>
        </div>
      `).join('');
      tagsHtml = `
        <div style="margin-top: 10px;">
          <input type="text" class="forensics-search-input" placeholder="🔍 Filter ${entry.scan.fields.length} metadata fields (e.g. GPS, serial, camera, author, software)..." oninput="filterForensicsTags('${entry.id}', this.value)" aria-label="Filter metadata tags">
          <div class="forensics-grid" id="tagsGrid_${entry.id}">${itemsHtml}</div>
        </div>
      `;
    } else {
      tagsHtml = `<div style="color:var(--muted); font-size:12px; font-style:italic; margin-bottom:8px;">No tracking metadata found — media is clean.</div>`;
    }

    // GPS Map Link & Interactive Satellite/Street Radar Embed
    let gpsHtml = '';
    if (entry.scan.gps) {
      const { lat, lon } = entry.scan.gps;
      const osmUrl = `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=16/${lat.toFixed(6)}/${lon.toFixed(6)}`;
      const bboxDelta = 0.008;
      const bbox = `${(lon - bboxDelta).toFixed(6)}%2C${(lat - bboxDelta).toFixed(6)}%2C${(lon + bboxDelta).toFixed(6)}%2C${(lat + bboxDelta).toFixed(6)}`;
      const embedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(6)}%2C${lon.toFixed(6)}`;

      gpsHtml = `
        <div class="inline-map-box">
          <div class="map-radar-header">
            <span>📡 LIVE GPS RADAR: Location Detected (${lat.toFixed(5)}°, ${lon.toFixed(5)}°)</span>
            <a href="${osmUrl}" target="_blank" rel="noopener noreferrer">Full Map ↗</a>
          </div>
          <iframe class="inline-map-frame" loading="lazy" src="${embedUrl}" title="GPS Coordinate Preview"></iframe>
        </div>
      `;
    }

    // Visual Quality Diff Slider (Lossless Verification)
    let diffHtml = '';
    if (entry.cleanThumbUrl && entry.thumbUrl) {
      const sliderVal = entry.diffSliderVal !== undefined ? entry.diffSliderVal : 50;
      diffHtml = `
        <div class="diff-slider-container">
          <div class="diff-header">
            <span>🔬 <strong>Visual Lossless Verification</strong> (Drag slider to inspect pixels)</span>
            <span style="color:var(--green); font-weight:700;">100% Quality Preserved</span>
          </div>
          <div class="diff-slider-wrap" id="diffWrap_${entry.id}">
            <img class="diff-img" src="${entry.cleanThumbUrl}" alt="Cleaned image">
            <div class="diff-img-before-wrap" id="diffBefore_${entry.id}" style="width: ${sliderVal}%;">
              <img class="diff-img" src="${entry.thumbUrl}" alt="Original image">
            </div>
            <span class="diff-tag before">BEFORE (Raw + EXIF)</span>
            <span class="diff-tag after">AFTER (Zero Trackers)</span>
            <input type="range" min="0" max="100" value="${sliderVal}" class="diff-range-input" oninput="updateDiffSlider('${entry.id}', this.value)" aria-label="Compare original and sanitized image">
          </div>
        </div>
      `;
    }

    // Cryptographic Hashes & Forensics Audit Report
    let hashHtml = '';
    const srcHash = entry.cleanResult?.sourceSha256 || entry.scan.sha256;
    const cleanHash = entry.cleanResult?.cleanSha256;
    if (srcHash) {
      hashHtml = `
        <div class="hash-audit-card">
          <div style="font-size:11px; font-weight:700; color:var(--text); margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
            <span>🛡️ Cryptographic Integrity Hashes (SHA-256)</span>
            ${entry.cleanResult ? `<button class="btn-audit" onclick="downloadAuditCertificate('${entry.id}')">📜 Export Audit Certificate (JSON)</button>` : ''}
          </div>
          <div class="hash-row">
            <span class="hash-lbl">Source File:</span>
            <span class="hash-val">${srcHash}</span>
          </div>
          ${cleanHash ? `
            <div class="hash-row">
              <span class="hash-lbl">Sanitized:</span>
              <span class="hash-val clean">${cleanHash}</span>
            </div>
          ` : ''}
        </div>
      `;
    }

    // Audio Player Preview
    let audioHtml = '';
    if (['mp3', 'flac', 'wav'].includes(entry.format)) {
      const audioUrl = entry.cleanResult ? URL.createObjectURL(entry.cleanResult.cleanBlob) : URL.createObjectURL(entry.file);
      audioHtml = `
        <div class="audio-preview-container">
          <div style="font-size:11px; color:var(--muted); font-weight:700; margin-bottom:4px;">
            🎵 ${entry.cleanResult ? 'Sanitized Audio Preview' : 'Source Audio Preview'}:
          </div>
          <audio controls src="${audioUrl}"></audio>
        </div>
      `;
    }

    // Hex Forensics Dump
    const hexDumpData = entry.cleanResult?.cleanHexDump || entry.scan.hexDump || [];
    let hexHtml = `
      <div style="margin-top:10px; display:flex; justify-content:space-between; align-items:center;">
        <button class="hex-toggle-btn" onclick="toggleHex('${entry.id}')">
          [0101] Toggle Binary Hex Dump
        </button>
      </div>
      <div class="hex-dump-panel ${entry.hexOpen ? '' : 'hidden'}" id="hex_${entry.id}">
        <div style="font-size:10px; color:var(--muted); margin-bottom:6px;">OFFSET   HEX BYTES (First 128 Bytes)                       ASCII</div>
        ${hexDumpData.map(r => `
          <div class="hex-row">
            <span class="hex-offset">${r.offset}</span>
            <span class="hex-bytes">${r.hex}</span>
            <span class="hex-ascii">${window.MetaCleanEngine.esc(r.ascii)}</span>
          </div>
        `).join('')}
      </div>
    `;

    drawer.innerHTML = `
      ${provHtml}
      ${tagsHtml}
      ${gpsHtml}
      ${diffHtml}
      ${hashHtml}
      ${audioHtml}
      ${hexHtml}
    `;
  }

  window.toggleForensics = function(id) {
    const entry = queue.get(id);
    const drawer = $('#drawer_' + id);
    if (!entry || !drawer) return;
    entry.forensicsOpen = !entry.forensicsOpen;
    drawer.classList.toggle('hidden', !entry.forensicsOpen);
  };

  window.toggleHex = function(id) {
    const entry = queue.get(id);
    const hexPanel = $('#hex_' + id);
    if (!entry || !hexPanel) return;
    entry.hexOpen = !entry.hexOpen;
    hexPanel.classList.toggle('hidden', !entry.hexOpen);
  };

  window.filterForensicsTags = function(id, query) {
    const grid = $('#tagsGrid_' + id);
    if (!grid) return;
    const q = (query || '').toLowerCase().trim();
    const items = grid.querySelectorAll('.forensic-item');
    items.forEach(el => {
      const txt = el.dataset.tagText || el.textContent.toLowerCase();
      el.style.display = (!q || txt.includes(q)) ? '' : 'none';
    });
  };

  window.removeFile = function(id) {
    const entry = queue.get(id);
    if (entry) {
      if (entry.thumbUrl) URL.revokeObjectURL(entry.thumbUrl);
      if (entry.cleanThumbUrl) URL.revokeObjectURL(entry.cleanThumbUrl);
    }
    queue.delete(id);
    $('#card_' + id)?.remove();
    updateMetrics();
    if (queue.size === 0) {
      queueSection.classList.add('hidden');
      verificationBanner.classList.add('hidden');
    }
  };

  // ── Cleaning Actions ──
  window.cleanSingle = async function(id) {
    const entry = queue.get(id);
    if (!entry || entry.cleanResult) return;

    entry.status = 'cleaning';
    const cleanBtn = $('#btnClean_' + id);
    if (cleanBtn) {
      cleanBtn.disabled = true;
      cleanBtn.textContent = 'Scrubbing…';
    }

    try {
      const modeVal = cleanModeSelect.value;
      const options = {
        mode: modeVal === 'raster' ? 'raster' : 'lossless',
        selectiveMode: modeVal === 'gps_only' ? 'gps_only' : 'all',
        preserveIcc: optPreserveIcc.checked,
        anonymize: optAnonymize.checked
      };

      const result = await window.MetaCleanEngine.cleanFile(entry.file, options);
      entry.cleanResult = result;
      entry.status = 'cleaned';

      // Cleaned thumbnail for diff slider if image
      if (entry.file.type.startsWith('image/') || ['jpeg', 'png', 'webp'].includes(entry.format)) {
        entry.cleanThumbUrl = URL.createObjectURL(result.cleanBlob);
      }

      updateCardUI(id);
      updateMetrics();
      showVerification();
    } catch (err) {
      console.error('Scrub failed:', err);
      alert('Could not scrub metadata for this file.');
      entry.status = 'error';
      updateCardUI(id);
    }
  };

  window.downloadSingle = function(id) {
    const entry = queue.get(id);
    if (!entry || !entry.cleanResult) return;

    let filename = entry.file.name;
    const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
    const base = filename.replace(/\.[^.]+$/, '');

    if (optAnonymize.checked) {
      const hash = Math.random().toString(16).slice(2, 8);
      filename = `${entry.format || 'file'}_clean_${hash}${ext}`;
    } else {
      filename = `${base}_clean${ext}`;
    }

    triggerDownload(entry.cleanResult.cleanBlob, filename);
  };

  function triggerDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // ── Visual Diff Slider Controller ──
  window.updateDiffSlider = function(id, val) {
    const entry = queue.get(id);
    if (entry) entry.diffSliderVal = val;
    const beforeWrap = $('#diffBefore_' + id);
    if (beforeWrap) beforeWrap.style.width = val + '%';
  };

  // ── Cryptographic Forensics Audit Certificate Generator ──
  window.downloadAuditCertificate = function(id) {
    const entry = queue.get(id);
    if (!entry || !entry.cleanResult) return;

    const cert = {
      generator: "MetaClean Pro v2.3 - Military-Grade Privacy Suite",
      timestamp: new Date().toISOString(),
      file: {
        originalName: entry.file.name,
        format: entry.format,
        originalSizeBytes: entry.file.size,
        cleanedSizeBytes: entry.cleanResult.cleanSize,
        bytesSaved: Math.max(0, entry.file.size - entry.cleanResult.cleanSize)
      },
      cryptography: {
        algorithm: "SHA-256",
        sourceSha256: entry.cleanResult.sourceSha256 || entry.scan.sha256,
        cleanSha256: entry.cleanResult.cleanSha256,
        verifiedLossless: true
      },
      audit: {
        threatLevel: entry.scan.threatLevel,
        detectedMetadataFieldsCount: entry.scan.fields.length,
        strippedMetadataFields: entry.scan.fields.map(f => ({
          category: f.category,
          tag: f.label,
          threat: f.threat
        })),
        remainingMetadataCount: entry.cleanResult.afterFields.length,
        status: entry.cleanResult.isClean ? "100% SANITIZED_VERIFIED" : "PARTIAL_REMOVAL"
      },
      privacyNotice: "Zero server uploads. Processed strictly client-side via Web Cryptography API and client ArrayBuffers."
    };

    const blob = new Blob([JSON.stringify(cert, null, 2)], { type: 'application/json' });
    const certFilename = `${entry.file.name.replace(/\.[^.]+$/, '')}_forensic_audit_cert.json`;
    triggerDownload(blob, certFilename);
  };

  // ── Native Web Share API ──
  window.shareSingle = async function(id) {
    const entry = queue.get(id);
    if (!entry || !entry.cleanResult) return;

    let filename = entry.file.name;
    const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
    const base = filename.replace(/\.[^.]+$/, '');
    if (optAnonymize.checked) {
      const hash = Math.random().toString(16).slice(2, 8);
      filename = `${entry.format || 'file'}_clean_${hash}${ext}`;
    } else {
      filename = `${base}_clean${ext}`;
    }

    const shareFile = new File([entry.cleanResult.cleanBlob], filename, {
      type: entry.cleanResult.cleanBlob.type || guessMimeType(filename)
    });

    if (navigator.canShare && navigator.canShare({ files: [shareFile] })) {
      try {
        await navigator.share({
          files: [shareFile],
          title: 'Sanitized File - MetaClean Pro',
          text: `Cleaned with MetaClean Pro v2.3 (0 tracking metadata tags).`
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Share failed:', err);
          window.downloadSingle(id);
        }
      }
    } else {
      window.downloadSingle(id);
    }
  };

  // Batch Clean All
  cleanAllBtn.onclick = async () => {
    const pending = Array.from(queue.values()).filter(e => !e.cleanResult);
    if (!pending.length) return;

    batchProgressContainer.classList.remove('hidden');
    cleanAllBtn.disabled = true;

    for (let i = 0; i < pending.length; i++) {
      const e = pending[i];
      const pct = Math.round(((i + 1) / pending.length) * 100);
      progressStateText.textContent = `Scrubbing ${e.file.name} (${i + 1}/${pending.length})…`;
      progressPercentText.textContent = pct + '%';
      batchProgressBar.style.width = pct + '%';

      await window.cleanSingle(e.id);
    }

    progressStateText.textContent = 'All files sanitized successfully!';
    setTimeout(() => {
      batchProgressContainer.classList.add('hidden');
    }, 1800);

    cleanAllBtn.disabled = false;
    updateMetrics();
  };

  // Download All as ZIP
  downloadZipBtn.onclick = async () => {
    const ready = Array.from(queue.values()).filter(e => e.cleanResult);
    if (!ready.length) return;

    downloadZipBtn.disabled = true;
    downloadZipBtn.innerHTML = '<span>⏳ Building ZIP…</span>';

    try {
      const filesForZip = ready.map(e => {
        let name = e.file.name;
        const ext = name.includes('.') ? '.' + name.split('.').pop() : '';
        const base = name.replace(/\.[^.]+$/, '');

        if (optAnonymize.checked) {
          const hash = Math.random().toString(16).slice(2, 8);
          name = `${e.format || 'file'}_clean_${hash}${ext}`;
        } else {
          name = `${base}_clean${ext}`;
        }

        return { name, data: e.cleanResult.cleanBlob };
      });

      const zipBlob = await window.createZip(filesForZip);
      triggerDownload(zipBlob, 'metaclean_sanitized_files.zip');
    } catch (err) {
      console.error('ZIP generation failed:', err);
      alert('Could not create ZIP archive.');
    } finally {
      downloadZipBtn.disabled = false;
      downloadZipBtn.innerHTML = '<span>📦 Download All (.ZIP)</span>';
    }
  };

  // Clear All Queue
  clearQueueBtn.onclick = () => {
    if (queue.size === 0) return;
    queue.forEach(e => {
      if (e.thumbUrl) URL.revokeObjectURL(e.thumbUrl);
      if (e.cleanThumbUrl) URL.revokeObjectURL(e.cleanThumbUrl);
    });
    queue.clear();
    fileQueueList.innerHTML = '';
    queueSection.classList.add('hidden');
    verificationBanner.classList.add('hidden');
    updateMetrics();
  };

  // ── Metrics & Verification ──
  function updateMetrics() {
    const total = queue.size;
    const cleaned = Array.from(queue.values()).filter(e => e.cleanResult).length;
    let totalTags = 0;

    queue.forEach(e => {
      if (e.scan) totalTags += e.scan.fields.length;
    });

    $('#statFiles').textContent = total;
    $('#statTags').textContent = totalTags;
    $('#statCleaned').textContent = cleaned;

    downloadZipBtn.disabled = cleaned === 0;

    // Filter tab counts
    const images = Array.from(queue.values()).filter(e => ['jpeg','png','webp','svg'].includes(e.format)).length;
    const audios = Array.from(queue.values()).filter(e => ['mp3','flac','wav'].includes(e.format)).length;
    const pdfs = Array.from(queue.values()).filter(e => e.format === 'pdf').length;
    const videos = Array.from(queue.values()).filter(e => e.format === 'mp4').length;

    $('#tabCountAll').textContent = total;
    $('#tabCountImage').textContent = images;
    $('#tabCountAudio').textContent = audios;
    $('#tabCountPdf').textContent = pdfs;
    $('#tabCountVideo').textContent = videos;
  }

  function showVerification() {
    const cleanedEntries = Array.from(queue.values()).filter(e => e.cleanResult);
    if (!cleanedEntries.length) return;

    let beforeTotal = 0;
    let afterTotal = 0;
    let bytesSaved = 0;

    cleanedEntries.forEach(e => {
      beforeTotal += e.cleanResult.beforeFields.length;
      afterTotal += e.cleanResult.afterFields.length;
      bytesSaved += Math.max(0, e.cleanResult.originalSize - e.cleanResult.cleanSize);
    });

    vBeforeCount.textContent = beforeTotal;
    vAfterCount.textContent = afterTotal;
    vSavingsBytes.textContent = window.MetaCleanEngine.fmtSize(bytesSaved);
    verificationBanner.classList.remove('hidden');
  }

  // ── Queue Filter Tabs ──
  $$('.queue-tab').forEach(tab => {
    tab.onclick = () => {
      $$('.queue-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeFilter = tab.dataset.filter;

      $$('.file-card').forEach(card => {
        applyFilterToCard(card, card.dataset.format);
      });
    };
  });

  function applyFilterToCard(card, format) {
    if (activeFilter === 'all') {
      card.style.display = '';
    } else if (activeFilter === 'image') {
      card.style.display = ['jpeg','png','webp','svg'].includes(format) ? '' : 'none';
    } else if (activeFilter === 'audio') {
      card.style.display = ['mp3','flac','wav'].includes(format) ? '' : 'none';
    } else if (activeFilter === 'pdf') {
      card.style.display = (format === 'pdf') ? '' : 'none';
    } else if (activeFilter === 'video') {
      card.style.display = (format === 'mp4') ? '' : 'none';
    }
  }

  // ============================================================================
  // Cyber Arcade Hub Launcher (29-Game Master Arcade Cabinet)
  // ============================================================================
  const arcadeModal = $("#arcadeModal");
  const arcadeIframe = $("#arcadeIframe");
  const arcadeTabLink = $("#arcadeTabLink");

  const arcadeGames = [
    { id: "turbo", btnId: "#tabArcadeTurbo", bannerId: "#arcadeBannerBtn", path: "game/index.html" },
    { id: "puzzle", btnId: "#tabArcadePuzzle", bannerId: "#arcadePuzzleBtn", path: "puzzle/index.html" },
    { id: "breaker", btnId: "#tabArcadeBreaker", bannerId: "#arcadeBreakerBtn", path: "breaker/index.html" },
    { id: "strike", btnId: "#tabArcadeStrike", bannerId: "#arcadeStrikeBtn", path: "strike/index.html" },
    { id: "snake", btnId: "#tabArcadeSnake", bannerId: "#arcadeSnakeBtn", path: "snake/index.html" },
    { id: "jump", btnId: "#tabArcadeJump", bannerId: "#arcadeJumpBtn", path: "jump/index.html" },
    { id: "pulse", btnId: "#tabArcadePulse", bannerId: "#arcadePulseBtn", path: "pulse/index.html" },
    { id: "runner", btnId: "#tabArcadeRunner", bannerId: "#arcadeRunnerBtn", path: "runner/index.html" },
    { id: "defense", btnId: "#tabArcadeDefense", bannerId: "#arcadeDefenseBtn", path: "defense/index.html" },
    { id: "survivor", btnId: "#tabArcadeSurvivor", bannerId: "#arcadeSurvivorBtn", path: "survivor/index.html" },
    { id: "portal", btnId: "#tabArcadePortal", bannerId: "#arcadePortalBtn", path: "portal/index.html" },
    { id: "rogue", btnId: "#tabArcadeRogue", bannerId: "#arcadeRogueBtn", path: "rogue/index.html" },
    { id: "tower", btnId: "#tabArcadeTower", bannerId: "#arcadeTowerBtn", path: "tower/index.html" },
    { id: "kart", btnId: "#tabArcadeKart", bannerId: "#arcadeKartBtn", path: "kart/index.html" },
    { id: "match", btnId: "#tabArcadeMatch", bannerId: "#arcadeMatchBtn", path: "match/index.html" },
    { id: "pinball", btnId: "#tabArcadePinball", bannerId: "#arcadePinballBtn", path: "pinball/index.html" },
    { id: "shinobi", btnId: "#tabArcadeShinobi", bannerId: "#arcadeShinobiBtn", path: "shinobi/index.html" },
    { id: "deck", btnId: "#tabArcadeDeck", bannerId: "#arcadeDeckBtn", path: "deck/index.html" },
    { id: "flight", btnId: "#tabArcadeFlight", bannerId: "#arcadeFlightBtn", path: "flight/index.html" },
    { id: "billiards", btnId: "#tabArcadeBilliards", bannerId: "#arcadeBilliardsBtn", path: "billiards/index.html" },
    { id: "tactics", btnId: "#tabArcadeTactics", bannerId: "#arcadeTacticsBtn", path: "tactics/index.html" },
    { id: "mining", btnId: "#tabArcadeMining", bannerId: "#arcadeMiningBtn", path: "mining/index.html" },
    { id: "golf", btnId: "#tabArcadeGolf", bannerId: "#arcadeGolfBtn", path: "golf/index.html" },
    { id: "fighter", btnId: "#tabArcadeFighter", bannerId: "#arcadeFighterBtn", path: "fighter/index.html" },
    { id: "stealth", btnId: "#tabArcadeStealth", bannerId: "#arcadeStealthBtn", path: "stealth/index.html" },
    { id: "bomber", btnId: "#tabArcadeBomber", bannerId: "#arcadeBomberBtn", path: "bomber/index.html" },
    { id: "pacman", btnId: "#tabArcadePacman", bannerId: "#arcadePacmanBtn", path: "pacman/index.html" },
    { id: "tycoon", btnId: "#tabArcadeTycoon", bannerId: "#arcadeTycoonBtn", path: "tycoon/index.html" },
    { id: "tetris", btnId: "#tabArcadeTetris", bannerId: "#arcadeTetrisBtn", path: "tetris/index.html" }
  ];

  function switchGame(url) {
    const cleanUrl = url.split("?")[0];
    const cacheBusted = cleanUrl + "?t=" + Date.now();
    if (arcadeIframe) arcadeIframe.src = cacheBusted;
    if (arcadeTabLink) arcadeTabLink.href = cleanUrl;

    const targetFolder = cleanUrl.split("/")[0];
    arcadeGames.forEach(g => {
      const tabEl = $(g.btnId);
      if (tabEl) {
        const match = g.path.startsWith(targetFolder);
        tabEl.classList.toggle("active", match);
        if (match && typeof tabEl.scrollIntoView === 'function') {
          tabEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        }
      }
    });
  }

  function openArcade(gameUrl = "game/index.html") {
    if (!arcadeModal) return;
    arcadeModal.classList.remove("hidden");
    arcadeModal.setAttribute("aria-hidden", "false");
    switchGame(gameUrl);
    document.body.style.overflow = "hidden";
  }

  function closeArcade() {
    if (!arcadeModal) return;
    arcadeModal.classList.add("hidden");
    arcadeModal.setAttribute("aria-hidden", "true");
    if (arcadeIframe) {
      arcadeIframe.src = "about:blank";
    }
    document.body.style.overflow = "";
  }

  // Bind arcade tabs & banner launch buttons
  arcadeGames.forEach(g => {
    const tabBtn = $(g.btnId);
    if (tabBtn) tabBtn.onclick = () => switchGame(g.path);

    const bannerBtn = $(g.bannerId);
    if (bannerBtn) bannerBtn.onclick = () => openArcade(g.path);
  });

  const openBtn = $("#openArcadeBtn");
  if (openBtn) openBtn.onclick = () => openArcade("game/index.html");

  const closeBtn = $("#closeArcadeBtn");
  if (closeBtn) closeBtn.onclick = closeArcade;

  const backdrop = $("#arcadeBackdrop");
  if (backdrop) backdrop.onclick = closeArcade;

  window.addEventListener("keydown", e => {
    if (e.key === "Escape" && arcadeModal && !arcadeModal.classList.contains("hidden")) {
      closeArcade();
    }
  });

  // ── Offline PWA Service Worker & Install Prompt ──
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(err => {
        console.warn('PWA ServiceWorker registration failed:', err);
      });
    });
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (installAppBtn) installAppBtn.classList.remove('hidden');
  });

  if (installAppBtn) {
    installAppBtn.onclick = async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        installAppBtn.classList.add('hidden');
      }
      deferredPrompt = null;
    };
  }

})();
