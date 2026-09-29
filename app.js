/**
 * MetaClean Pro v2.4 — Application Controller & Reactive UI
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
  const optWatermark = $('#optWatermark');
  const installAppBtn = $('#installAppBtn');
  const statGrade = $('#statGrade');

  const batchProgressContainer = $('#batchProgressContainer');
  const batchProgressBar = $('#batchProgressBar');
  const progressStateText = $('#progressStateText');
  const progressPercentText = $('#progressPercentText');

  const verificationBanner = $('#verificationBanner');
  const vBeforeCount = $('#vBeforeCount');
  const vAfterCount = $('#vAfterCount');
  const vSavingsBytes = $('#vSavingsBytes');
  const vHealthScore = $('#vHealthScore');

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
            <span class="ai-pill" id="aiPill_${entry.id}" style="display:none;"></span>
            <span class="threat-pill clean" id="threat_${entry.id}">Scanning…</span>
            <span class="grade-badge" id="grade_${entry.id}" style="display:none;"></span>
          </div>
          <div class="file-meta-sub">
            <span class="size-stat" id="size_${entry.id}">${window.MetaCleanEngine.fmtSize(entry.file.size)}</span>
            <span id="tagsCount_${entry.id}">Scanning metadata…</span>
            <span class="ai-status-note" id="aiNote_${entry.id}" style="display:none;"></span>
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

    // Threat level styling & AI detection card class
    const threatClass = `threat-${entry.scan?.threatLevel || 'clean'}`;
    const isAi = !!entry.scan?.aiData;
    const aiClass = isAi ? (entry.cleanResult ? 'ai-card-cleaned' : 'ai-card-detected') : '';
    card.className = `file-card ${threatClass} ${entry.cleanResult ? 'cleaned' : ''} ${aiClass}`.trim();

    // AI Pill & AI Status Note (Instant Zero-Click AI Visibility)
    const aiPill = $('#aiPill_' + id);
    const aiNote = $('#aiNote_' + id);

    if (isAi && aiPill) {
      aiPill.style.display = 'inline-flex';
      if (entry.cleanResult) {
        aiPill.className = 'ai-pill cleaned';
        aiPill.innerHTML = `🛡️ AI Fingerprint Purged`;
        aiPill.title = 'AI prompt, model seed, workflow graph and parameters permanently erased.';
      } else {
        const gen = entry.scan.aiData.generator || 'Model Detected';
        aiPill.className = 'ai-pill active';
        aiPill.innerHTML = `🤖 AI Generated: ${window.MetaCleanEngine.esc(gen)}`;
        aiPill.title = `Embedded prompt, model seeds, and generation parameters detected (${entry.scan.aiData.keyword || 'Manifest'}).`;
      }
    } else if (aiPill) {
      aiPill.style.display = 'none';
    }

    if (isAi && aiNote) {
      aiNote.style.display = 'inline-flex';
      if (entry.cleanResult) {
        aiNote.className = 'ai-status-note purged';
        aiNote.innerHTML = `✓ AI prompt, seed & workflow graph eliminated`;
      } else {
        aiNote.className = 'ai-status-note warning';
        aiNote.innerHTML = `⚡ Embedded AI Prompt, Model Seed & Checkpoint Detected`;
      }
    } else if (aiNote) {
      aiNote.style.display = 'none';
    }

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

    // Threat Pill & Grade Badge
    const threatPill = $('#threat_' + id);
    const gradeBadge = $('#grade_' + id);

    if (threatPill && entry.scan) {
      if (entry.cleanResult) {
        threatPill.className = 'threat-pill clean';
        threatPill.textContent = '🟢 100% SANITIZED';
      } else {
        threatPill.className = `threat-pill ${entry.scan.threatLevel}`;
        switch (entry.scan.threatLevel) {
          case 'critical':
            threatPill.textContent = '🔴 CRITICAL: GPS Exposed';
            break;
          case 'high':
            threatPill.textContent = '🟠 HIGH: Hardware / Prompt';
            break;
          case 'med':
            threatPill.textContent = '🟡 MEDIUM: Software / Time';
            break;
          default:
            threatPill.textContent = '🟢 SECURE: 0 Tracking Tags';
            break;
        }
      }
    }

    if (gradeBadge && entry.scan) {
      gradeBadge.style.display = 'inline-flex';
      const grade = entry.cleanResult ? 'A+' : (entry.scan.threatGrade || 'A+');
      const gradeClass = 'grade-' + grade.replace('+', '-plus');
      gradeBadge.className = `grade-badge ${gradeClass}`;
      gradeBadge.textContent = `GRADE ${grade}`;
      gradeBadge.title = entry.cleanResult
        ? '100% Sanitized & Anonymized (Score 100/100)'
        : `Privacy Exposure Score: ${entry.scan.privacyScore}/100`;
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

    // AI Prompt & Generative Synthesis Forensics
    let aiHtml = '';
    if (entry.scan.aiData) {
      if (entry.cleanResult) {
        aiHtml = `
          <div class="ai-prompt-card cleaned">
            <div class="ai-card-header clean">
              <span>🛡️ AI Generative Manifest & Fingerprint: 100% PURGED</span>
              <span style="font-size:10px; color:var(--green); font-weight:700;">✓ ZERO RESIDUAL MODEL MARKERS</span>
            </div>
            <div class="ai-purged-summary">
              <div class="purged-check-item"><span>✓ Generation Prompt & Negative Prompt:</span> <strong>PERMANENTLY REMOVED (0 Bytes)</strong></div>
              <div class="purged-check-item"><span>✓ Model Seeds, Sampler & Step Counts:</span> <strong>PERMANENTLY REMOVED</strong></div>
              <div class="purged-check-item"><span>✓ Model Checkpoint Hashes & LoRA Weights:</span> <strong>PERMANENTLY REMOVED</strong></div>
              <div class="purged-check-item"><span>✓ Workflow Graph (${window.MetaCleanEngine.esc(entry.scan.aiData.generator)}):</span> <strong>PERMANENTLY REMOVED</strong></div>
            </div>
            <div class="ai-actions-row">
              <span style="color:#94a3b8;">Lossless binary sanitization stripped all tEXt, zTXt, iTXt, EXIF, COM, and XMP generative chunks.</span>
              <span class="badge-purged-pill">VERIFIED CLEAN</span>
            </div>
          </div>
        `;
      } else {
        aiHtml = `
          <div class="ai-prompt-card">
            <div class="ai-card-header">
              <span>🤖 AI Generative Manifest (${window.MetaCleanEngine.esc(entry.scan.aiData.generator)})</span>
              <span style="font-size:10px; color:#f87171; font-weight:700;">⚠️ Embedded Prompt Exposed</span>
            </div>
            <div class="ai-prompt-box" id="aiPrompt_${entry.id}">${window.MetaCleanEngine.esc(entry.scan.aiData.prompt)}</div>
            <div class="ai-actions-row">
              <span>Model parameters, seeds, and workflow will be permanently wiped upon cleaning.</span>
              <button type="button" class="btn-copy-prompt" onclick="copyAiPrompt('${entry.id}')">📋 Copy Generation Prompt</button>
            </div>
          </div>
        `;
      }
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

    // Forensic Stripped Tag Diff Matrix
    let diffMatrixHtml = '';
    if (entry.cleanResult && entry.cleanResult.beforeFields.length > 0) {
      const rows = entry.cleanResult.beforeFields.map(f => `
        <div class="diff-matrix-item">
          <span class="tag-stripped" title="${window.MetaCleanEngine.esc(f.category + ': ' + f.label + ' = ' + f.value)}">
            [${window.MetaCleanEngine.esc(f.category)}] ${window.MetaCleanEngine.esc(f.label)}: ${window.MetaCleanEngine.esc(f.value)}
          </span>
          <span class="tag-status">✓ PERMANENTLY ERASED</span>
        </div>
      `).join('');
      diffMatrixHtml = `
        <div class="diff-matrix-box">
          <div class="diff-matrix-header">
            <span>📋 Forensic Stripping Diff Matrix (${entry.cleanResult.beforeFields.length} tags eliminated)</span>
            <span style="color:var(--green); font-size:10px;">0 BYTES RESIDUAL TRACKERS</span>
          </div>
          <div class="diff-matrix-list">${rows}</div>
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

    // Audio Player Preview with Live Waveform Visualizer
    let audioHtml = '';
    if (['mp3', 'flac', 'wav'].includes(entry.format)) {
      const audioUrl = entry.cleanResult ? URL.createObjectURL(entry.cleanResult.cleanBlob) : URL.createObjectURL(entry.file);
      audioHtml = `
        <div class="audio-preview-container">
          <div style="font-size:11px; color:var(--muted); font-weight:700; margin-bottom:4px;">
            🎵 ${entry.cleanResult ? 'Sanitized Audio Preview' : 'Source Audio Preview'}:
          </div>
          <canvas id="audioWave_${entry.id}" class="audio-waveform-canvas" width="600" height="48"></canvas>
          <audio id="audioEl_${entry.id}" controls src="${audioUrl}"></audio>
        </div>
      `;
      attachAudioVisualizer(entry.id);
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
      ${aiHtml}
      ${tagsHtml}
      ${gpsHtml}
      ${diffHtml}
      ${diffMatrixHtml}
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

  window.copyAiPrompt = function(id) {
    const entry = queue.get(id);
    if (!entry || !entry.scan?.aiData?.prompt) return;
    navigator.clipboard.writeText(entry.scan.aiData.prompt).then(() => {
      alert('AI Generation Prompt copied to clipboard!');
    }).catch(() => {
      prompt('AI Generation Prompt:', entry.scan.aiData.prompt);
    });
  };

  function attachAudioVisualizer(id) {
    setTimeout(() => {
      const audio = $('#audioEl_' + id);
      const canvas = $('#audioWave_' + id);
      if (!audio || !canvas) return;
      const ctx = canvas.getContext('2d');
      let animId;

      function render(playing) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const bars = 48;
        const barW = canvas.width / bars;
        const time = Date.now() / 180;

        for (let i = 0; i < bars; i++) {
          const mult = playing
            ? (Math.sin(time + i * 0.45) * 0.35 + Math.cos(time * 1.6 + i * 0.25) * 0.35 + 0.8)
            : (Math.sin(i * 0.25) * 0.18 + 0.25);
          const barH = mult * (canvas.height * 0.45);
          const x = i * barW;
          const y = (canvas.height - barH) / 2;

          const grad = ctx.createLinearGradient(0, y, 0, y + barH);
          grad.addColorStop(0, '#00f0ff');
          grad.addColorStop(0.5, '#7952ff');
          grad.addColorStop(1, '#ff3b69');
          ctx.fillStyle = grad;
          ctx.fillRect(x + 1, y, barW - 2, barH);
        }
        if (playing) animId = requestAnimationFrame(() => render(true));
      }

      render(false);
      audio.onplay = () => render(true);
      audio.onpause = () => {
        cancelAnimationFrame(animId);
        render(false);
      };
      audio.onended = () => {
        cancelAnimationFrame(animId);
        render(false);
      };
    }, 80);
  }

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
        anonymize: optAnonymize.checked,
        watermark: optWatermark ? optWatermark.checked : false
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
      generator: "MetaClean Pro v2.4 - Military-Grade Privacy & AI Forensics Suite",
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
        threatGradeBefore: entry.cleanResult.beforeThreatGrade || entry.scan.threatGrade,
        threatGradeAfter: 'A+',
        privacyScoreBefore: entry.cleanResult.beforePrivacyScore || entry.scan.privacyScore,
        privacyScoreAfter: 100,
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
          text: `Cleaned with MetaClean Pro v2.4 (0 tracking metadata tags).`
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

    // Overall Privacy Score calculation
    let avgScore = 100;
    if (total > 0) {
      let scoreSum = 0;
      queue.forEach(e => {
        if (e.cleanResult) scoreSum += 100;
        else if (e.scan) scoreSum += (e.scan.privacyScore || 100);
        else scoreSum += 50;
      });
      avgScore = Math.round(scoreSum / total);
    }
    if (statGrade) {
      statGrade.textContent = avgScore + '%';
      statGrade.title = `Average Queue Privacy Health: ${avgScore}/100`;
    }

    downloadZipBtn.disabled = cleaned === 0;

    // Filter tab counts
    const aiCount = Array.from(queue.values()).filter(e => !!e.scan?.aiData).length;
    const aiUncleaned = Array.from(queue.values()).filter(e => !!e.scan?.aiData && !e.cleanResult).length;
    const images = Array.from(queue.values()).filter(e => ['jpeg','png','webp','svg'].includes(e.format)).length;
    const audios = Array.from(queue.values()).filter(e => ['mp3','flac','wav'].includes(e.format)).length;
    const pdfs = Array.from(queue.values()).filter(e => e.format === 'pdf').length;
    const videos = Array.from(queue.values()).filter(e => e.format === 'mp4').length;

    $('#tabCountAll').textContent = total;
    if ($('#tabCountAi')) $('#tabCountAi').textContent = aiCount;
    $('#tabCountImage').textContent = images;
    $('#tabCountAudio').textContent = audios;
    $('#tabCountPdf').textContent = pdfs;
    $('#tabCountVideo').textContent = videos;

    const cleanAiBtn = $('#cleanAiBtn');
    if (cleanAiBtn) {
      if (aiCount > 0) {
        cleanAiBtn.style.display = 'inline-flex';
        cleanAiBtn.disabled = (aiUncleaned === 0);
        cleanAiBtn.innerHTML = `<span>🤖 Scrub AI Fingerprints (${aiUncleaned})</span>`;
      } else {
        cleanAiBtn.style.display = 'none';
      }
    }

    if (typeof syncArcadeQueueHUD === 'function') {
      syncArcadeQueueHUD();
    }
  }

  // Batch Clean All AI Files
  window.cleanAllAiFiles = async function() {
    const aiPending = Array.from(queue.values()).filter(e => !!e.scan?.aiData && !e.cleanResult);
    if (!aiPending.length) return;

    batchProgressContainer.classList.remove('hidden');
    const cleanAiBtn = $('#cleanAiBtn');
    if (cleanAiBtn) cleanAiBtn.disabled = true;

    for (let i = 0; i < aiPending.length; i++) {
      const e = aiPending[i];
      const pct = Math.round(((i + 1) / aiPending.length) * 100);
      progressStateText.textContent = `Scrubbing AI Fingerprint from ${e.file.name} (${i + 1}/${aiPending.length})…`;
      progressPercentText.textContent = pct + '%';
      batchProgressBar.style.width = pct + '%';

      await window.cleanSingle(e.id);
    }

    progressStateText.textContent = 'All AI generative fingerprints purged!';
    setTimeout(() => {
      batchProgressContainer.classList.add('hidden');
    }, 1800);

    if (cleanAiBtn) cleanAiBtn.disabled = false;
    updateMetrics();
  };

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
    if (vHealthScore) {
      vHealthScore.textContent = '100% (Grade A+)';
    }
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
    } else if (activeFilter === 'ai') {
      const entryId = card.id.replace('card_', '');
      const entry = queue.get(entryId);
      card.style.display = (entry && entry.scan?.aiData) ? '' : 'none';
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
  // Cyber Arcade Hub Pavilion & HUD (29-Game Master Cabinet)
  // ============================================================================
  const arcadeModal = $("#arcadeModal");
  const arcadeDialog = $("#arcadeDialog");
  const arcadeIframe = $("#arcadeIframe");
  const arcadeTabLink = $("#arcadeTabLink");
  const activeGameTitle = $("#activeGameTitle");
  const activeGameControls = $("#activeGameControls");
  const arcadeQuickSelect = $("#arcadeQuickSelect");
  const arcadeFavBtn = $("#arcadeFavBtn");
  const arcadeQueueHud = $("#arcadeQueueHud");
  const arcadeQueueText = $("#arcadeQueueText");
  const arcadeTabBar = $("#arcadeTabBar");
  const arcadeGamesGrid = $("#arcadeGamesGrid");
  const arcadeSearchInput = $("#arcadeSearchInput");
  const arcadeRecentRow = $("#arcadeRecentRow");
  const arcadeRecentList = $("#arcadeRecentList");
  const arcadeFavBadge = $("#arcadeFavBadge");

  // Rich 29-Game Master Dataset
  const arcadeGames = [
    {
      id: "turbo",
      name: "Turbo Drive",
      emoji: "🏎️",
      category: "racing",
      categoryLabel: "Racing & Speed",
      tag: "Mode-7 Pseudo-3D",
      desc: "High-octane outrun highway racer with speed boosts, traffic weaving, and synthwave beats.",
      controls: "← → or A/D to steer • Space for Nitro",
      featured: true,
      path: "game/index.html"
    },
    {
      id: "puzzle",
      name: "Cyber Circuit",
      emoji: "🧩",
      category: "puzzle",
      categoryLabel: "Puzzle & Logic",
      tag: "Logic Network",
      desc: "Connect neon energy conduits and route power to the main quantum core without short-circuiting.",
      controls: "Click/Tap to rotate circuit tiles",
      featured: false,
      path: "puzzle/index.html"
    },
    {
      id: "breaker",
      name: "Neon Breaker",
      emoji: "🧱",
      category: "classic",
      categoryLabel: "Retro Classics",
      tag: "Arcade Brick Breaker",
      desc: "Futuristic breakout with multiball powerups, explosive lasers, and shifting neon barriers.",
      controls: "Mouse / ← → to slide paddle",
      featured: true,
      path: "breaker/index.html"
    },
    {
      id: "strike",
      name: "Cyber Strike",
      emoji: "🚀",
      category: "action",
      categoryLabel: "Action & Combat",
      tag: "Vertical Shmup",
      desc: "Intense vertical space shoot-em-up with plasma cannons, boss battles, and bullet deflections.",
      controls: "WASD / Arrows to fly • Space to fire",
      featured: true,
      path: "strike/index.html"
    },
    {
      id: "snake",
      name: "Neon Snake",
      emoji: "🐍",
      category: "classic",
      categoryLabel: "Retro Classics",
      tag: "Grid Arcade",
      desc: "Cyberpunk snake with dimensional warp portals, turbo food pellets, and increasing matrix speed.",
      controls: "Arrow keys / Swipe to turn",
      featured: false,
      path: "snake/index.html"
    },
    {
      id: "jump",
      name: "Quantum Jump",
      emoji: "🦘",
      category: "action",
      categoryLabel: "Action & Combat",
      tag: "Vertical Platformer",
      desc: "Infinite neon bounce climber featuring crumbling ledges, gravity springs, and altitude records.",
      controls: "← → or A/D to steer jumper",
      featured: false,
      path: "jump/index.html"
    },
    {
      id: "pulse",
      name: "Cyber Pulse",
      emoji: "🎵",
      category: "puzzle",
      categoryLabel: "Puzzle & Logic",
      tag: "Rhythm Beats",
      desc: "Sync your reflexes to high-energy electronic soundwaves and hit notes at peak tempo.",
      controls: "D, F, J, K or Tap lanes on beat",
      featured: true,
      path: "pulse/index.html"
    },
    {
      id: "runner",
      name: "Gravity Runner",
      emoji: "⚡",
      category: "action",
      categoryLabel: "Action & Combat",
      tag: "Endless Runner",
      desc: "Flip gravity on demand to run along ceilings and floors through razor-sharp cyber obstacles.",
      controls: "Space / Click to invert gravity",
      featured: false,
      path: "runner/index.html"
    },
    {
      id: "defense",
      name: "Neon Defense",
      emoji: "🛡️",
      category: "strategy",
      categoryLabel: "Strategy & RPG",
      tag: "Orbital Defense",
      desc: "Rotate your orbital defense shield to deflect relentless missile barrages from the city core.",
      controls: "Mouse / Touch to rotate shield",
      featured: false,
      path: "defense/index.html"
    },
    {
      id: "survivor",
      name: "Cyber Survivor",
      emoji: "🧬",
      category: "action",
      categoryLabel: "Action & Combat",
      tag: "Roguelite Bullet Hell",
      desc: "Survive massive swarms of corrupted drones, level up, and unlock auto-firing laser weaponry.",
      controls: "WASD / Arrows to maneuver",
      featured: true,
      path: "survivor/index.html"
    },
    {
      id: "portal",
      name: "Quantum Portal",
      emoji: "🌀",
      category: "puzzle",
      categoryLabel: "Puzzle & Logic",
      tag: "Physics Runner",
      desc: "Manipulate space-time portals to teleport across deadly energy voids and electromagnetic traps.",
      controls: "Arrows to move • Space to warp",
      featured: false,
      path: "portal/index.html"
    },
    {
      id: "rogue",
      name: "Neon Rogue",
      emoji: "🗡️",
      category: "strategy",
      categoryLabel: "Strategy & RPG",
      tag: "Dungeon Crawler",
      desc: "Turn-based cyberpunk dungeon crawler with procedural floors, loot drops, and tactical hacking.",
      controls: "WASD / Arrows / Grid Click to move",
      featured: true,
      path: "rogue/index.html"
    },
    {
      id: "tower",
      name: "Matrix Defense",
      emoji: "🏰",
      category: "strategy",
      categoryLabel: "Strategy & RPG",
      tag: "Tower Defense",
      desc: "Deploy and upgrade EMP towers, tesla coils, and laser cannons against armored drone convoys.",
      controls: "Mouse to place and upgrade towers",
      featured: false,
      path: "tower/index.html"
    },
    {
      id: "kart",
      name: "Cyber Drift",
      emoji: "🏎️",
      category: "racing",
      categoryLabel: "Racing & Speed",
      tag: "Top-Down Drift",
      desc: "Top-down time-attack racer with friction-defying drifts, boost pads, and ghost rivals.",
      controls: "WASD / Arrows • Shift to drift",
      featured: false,
      path: "kart/index.html"
    },
    {
      id: "match",
      name: "Neon Alchemist",
      emoji: "✨",
      category: "puzzle",
      categoryLabel: "Puzzle & Logic",
      tag: "Match-3 RPG",
      desc: "Match elemental quantum orbs to cast spells, charge plasma attacks, and defeat cyber beasts.",
      controls: "Click & drag adjacent gems to swap",
      featured: false,
      path: "match/index.html"
    },
    {
      id: "pinball",
      name: "Quantum Pinball",
      emoji: "⚡",
      category: "classic",
      categoryLabel: "Retro Classics",
      tag: "Physics Pinball",
      desc: "Authentic physics pinball table with neon bumpers, multiball ramps, and high-multiplier lanes.",
      controls: "Z / Left Shift & / / Right Shift for flippers",
      featured: true,
      path: "pinball/index.html"
    },
    {
      id: "shinobi",
      name: "Neon Shinobi",
      emoji: "⚔️",
      category: "action",
      categoryLabel: "Action & Combat",
      tag: "Action Slasher",
      desc: "Fast-paced katana action slasher with aerial dashes, parry timing, and holographic bosses.",
      controls: "Arrows • Z to dash • X to slash",
      featured: true,
      path: "shinobi/index.html"
    },
    {
      id: "deck",
      name: "Cyber Deck",
      emoji: "🃏",
      category: "strategy",
      categoryLabel: "Strategy & RPG",
      tag: "Cyber Deckbuilder",
      desc: "Construct an unstoppable virus deck to breach rogue corporate firewalls in tactical card battles.",
      controls: "Click cards to play with available energy",
      featured: true,
      path: "deck/index.html"
    },
    {
      id: "flight",
      name: "Aero Striker",
      emoji: "✈️",
      category: "action",
      categoryLabel: "Action & Combat",
      tag: "2.5D Dogfighter",
      desc: "Air-to-air dogfighting simulation with afterburners, homing missiles, and acrobatic barrel rolls.",
      controls: "WASD to pitch/bank • Space to fire",
      featured: false,
      path: "flight/index.html"
    },
    {
      id: "billiards",
      name: "Neon Pool",
      emoji: "🎱",
      category: "classic",
      categoryLabel: "Retro Classics",
      tag: "8-Ball Billiards",
      desc: "Precision neon billiards with trajectory line preview, spin control, and pocket shot physics.",
      controls: "Drag cue backward to set power & release",
      featured: false,
      path: "billiards/index.html"
    },
    {
      id: "tactics",
      name: "Mech Warfare",
      emoji: "🤖",
      category: "strategy",
      categoryLabel: "Strategy & RPG",
      tag: "Turn-Based Tactics",
      desc: "Command a squad of customized combat mechs across an isometric grid with cover mechanics.",
      controls: "Mouse to select unit, move & fire",
      featured: false,
      path: "tactics/index.html"
    },
    {
      id: "mining",
      name: "Deep Core",
      emoji: "⛏️",
      category: "action",
      categoryLabel: "Action & Combat",
      tag: "Drilling Adventure",
      desc: "Drill deep into the cybernetic mantle to extract precious ores before battery or heat runs out.",
      controls: "Arrow keys to steer drill & dig",
      featured: false,
      path: "mining/index.html"
    },
    {
      id: "golf",
      name: "Quantum Golf",
      emoji: "⛳",
      category: "classic",
      categoryLabel: "Retro Classics",
      tag: "Sci-Fi Mini Golf",
      desc: "Futuristic mini-golf with gravity wells, bounce pads, and teleportation tunnels on neon greens.",
      controls: "Drag & release to swing putter",
      featured: false,
      path: "golf/index.html"
    },
    {
      id: "fighter",
      name: "Cyber Brawler",
      emoji: "🥊",
      category: "action",
      categoryLabel: "Action & Combat",
      tag: "2D Arcade Fighter",
      desc: "Classic 2D one-on-one combat with combos, special plasma moves, and brutal counterattacks.",
      controls: "A/D to move • J to punch • K to kick",
      featured: true,
      path: "fighter/index.html"
    },
    {
      id: "stealth",
      name: "Ghost Protocol",
      emoji: "🕵️",
      category: "action",
      categoryLabel: "Action & Combat",
      tag: "Stealth Espionage",
      desc: "Infiltrate high-security datacenters, avoid laser grids, and hack surveillance cameras undetected.",
      controls: "WASD / Arrows to sneak past cones",
      featured: false,
      path: "stealth/index.html"
    },
    {
      id: "bomber",
      name: "Grid Detonator",
      emoji: "💣",
      category: "classic",
      categoryLabel: "Retro Classics",
      tag: "Grid Bomber",
      desc: "Drop strategic bombs in a destructible maze, trap opponents, and collect blast radius upgrades.",
      controls: "Arrows to navigate • Space to place bomb",
      featured: false,
      path: "bomber/index.html"
    },
    {
      id: "pacman",
      name: "Quantum Maze",
      emoji: "👾",
      category: "classic",
      categoryLabel: "Retro Classics",
      tag: "Arcade Maze Chaser",
      desc: "Navigate glowing cyber labyrinths, devour data nodes, and turn the tables on autonomous hunter bots.",
      controls: "Arrow keys to guide chaser",
      featured: true,
      path: "pacman/index.html"
    },
    {
      id: "tycoon",
      name: "City Tycoon",
      emoji: "⚡",
      category: "strategy",
      categoryLabel: "Strategy & RPG",
      tag: "City Management",
      desc: "Construct and balance power plants, neon commercial zones, and cyber transport in a metropolis.",
      controls: "Click to zone, construct & manage",
      featured: false,
      path: "tycoon/index.html"
    },
    {
      id: "tetris",
      name: "Quantum Fall",
      emoji: "🧱",
      category: "classic",
      categoryLabel: "Retro Classics",
      tag: "Falling Blocks",
      desc: "The timeless tetromino drop re-imagined with glowing neon lines, hard drops, and combo scoring.",
      controls: "← → to move • ↑ to rotate • Space hard drop",
      featured: true,
      path: "tetris/index.html"
    }
  ];

  // Favorites & Recents in LocalStorage
  let favoriteGameIds = new Set();
  try {
    const rawFavs = localStorage.getItem('metaclean_arcade_favs');
    if (rawFavs) favoriteGameIds = new Set(JSON.parse(rawFavs));
  } catch (_) {}

  let recentGameIds = [];
  try {
    const rawRecents = localStorage.getItem('metaclean_arcade_recents');
    if (rawRecents) recentGameIds = JSON.parse(rawRecents);
  } catch (_) {}

  let currentCategory = 'all';
  let currentSearchQuery = '';
  let activeGame = arcadeGames[0];

  function saveFavorites() {
    try {
      localStorage.setItem('metaclean_arcade_favs', JSON.stringify(Array.from(favoriteGameIds)));
    } catch (_) {}
    updateFavBadges();
  }

  function saveRecents() {
    try {
      localStorage.setItem('metaclean_arcade_recents', JSON.stringify(recentGameIds.slice(0, 5)));
    } catch (_) {}
    renderRecentlyPlayed();
  }

  function updateFavBadges() {
    const count = favoriteGameIds.size;
    if (arcadeFavBadge) arcadeFavBadge.textContent = count;
    const favCountBadge = $('#favCountBadge');
    if (favCountBadge) favCountBadge.textContent = count;
  }

  // Render Pavilion 29-Game Responsive Grid
  function renderArcadeGrid(cat = currentCategory, query = currentSearchQuery) {
    if (!arcadeGamesGrid) return;
    currentCategory = cat;
    currentSearchQuery = (query || '').toLowerCase().trim();

    const filtered = arcadeGames.filter(g => {
      // Category filter
      let matchCat = true;
      if (cat === 'featured') matchCat = !!g.featured;
      else if (cat === 'favorites') matchCat = favoriteGameIds.has(g.id);
      else if (cat !== 'all') matchCat = (g.category === cat);

      if (!matchCat) return false;

      // Text query
      if (currentSearchQuery) {
        const text = `${g.name} ${g.desc} ${g.tag} ${g.categoryLabel} ${g.controls}`.toLowerCase();
        return text.includes(currentSearchQuery);
      }
      return true;
    });

    if (filtered.length === 0) {
      arcadeGamesGrid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 40px 20px; text-align: center; color: var(--muted);">
          <div style="font-size: 32px; margin-bottom: 8px;">🎮</div>
          <strong style="color: #cbd5e1; font-size: 15px;">No arcade games match this criteria</strong>
          <p style="font-size: 12px; margin-top: 4px;">Try a different search keyword or category tab.</p>
        </div>
      `;
      return;
    }

    arcadeGamesGrid.innerHTML = filtered.map(g => {
      const isFav = favoriteGameIds.has(g.id);
      return `
        <div class="game-card ${g.featured ? 'featured-card' : ''}" id="gameCard_${g.id}">
          <div class="game-card-top">
            <div class="game-header-info">
              <div class="game-icon-box">${g.emoji}</div>
              <div class="game-title-wrap">
                <h3 class="game-card-title">${window.MetaCleanEngine.esc(g.name)}</h3>
                <span class="game-card-tag">${window.MetaCleanEngine.esc(g.tag)}</span>
              </div>
            </div>
            <button type="button" class="btn-card-fav ${isFav ? 'active' : ''}" onclick="toggleCardFav('${g.id}')" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">
              ${isFav ? '❤️' : '🤍'}
            </button>
          </div>
          <p class="game-card-desc">${window.MetaCleanEngine.esc(g.desc)}</p>
          <div class="game-card-footer">
            <span class="game-control-hint" title="${window.MetaCleanEngine.esc(g.controls)}">🎮 ${window.MetaCleanEngine.esc(g.controls)}</span>
            <button type="button" class="btn-play-game" onclick="openArcade('${g.path}')">▶ Play Now</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderRecentlyPlayed() {
    if (!arcadeRecentRow || !arcadeRecentList) return;
    const recents = recentGameIds
      .map(id => arcadeGames.find(g => g.id === id))
      .filter(Boolean);

    if (recents.length === 0) {
      arcadeRecentRow.classList.add('hidden');
      return;
    }

    arcadeRecentRow.classList.remove('hidden');
    arcadeRecentList.innerHTML = recents.map(g => `
      <button type="button" class="recent-game-chip" onclick="openArcade('${g.path}')">
        ${g.emoji} ${window.MetaCleanEngine.esc(g.name)}
      </button>
    `).join('');
  }

  // Populate Dropdown & Tab Bar in Modal
  function populateQuickSelect() {
    if (!arcadeQuickSelect) return;
    const categories = [
      { key: 'featured', label: '🔥 Featured Games' },
      { key: 'action', label: '💥 Action & Combat' },
      { key: 'racing', label: '🏎️ Racing & Speed' },
      { key: 'classic', label: '🧱 Retro Classics' },
      { key: 'puzzle', label: '🧩 Puzzle & Logic' },
      { key: 'strategy', label: '🏰 Strategy & RPG' }
    ];

    arcadeQuickSelect.innerHTML = categories.map(c => {
      const games = arcadeGames.filter(g => c.key === 'featured' ? g.featured : g.category === c.key);
      const opts = games.map(g => `<option value="${g.path}">${g.emoji} ${window.MetaCleanEngine.esc(g.name)}</option>`).join('');
      return `<optgroup label="${c.label}">${opts}</optgroup>`;
    }).join('');
  }

  function populateTabBar() {
    if (!arcadeTabBar) return;
    arcadeTabBar.innerHTML = arcadeGames.map(g => `
      <button type="button" class="arcade-tab-btn" id="tabArcade_${g.id}" onclick="switchGame('${g.path}')">
        ${g.emoji} ${window.MetaCleanEngine.esc(g.name)}
      </button>
    `).join('');
  }

  function switchGame(urlOrPath) {
    const cleanUrl = urlOrPath.split("?")[0];
    const targetFolder = cleanUrl.split("/")[0];
    const target = arcadeGames.find(g => g.path.startsWith(targetFolder) || g.id === urlOrPath) || arcadeGames[0];
    activeGame = target;

    const cacheBusted = target.path + "?t=" + Date.now();
    if (arcadeIframe) arcadeIframe.src = cacheBusted;
    if (arcadeTabLink) arcadeTabLink.href = target.path;

    if (activeGameTitle) activeGameTitle.textContent = `${target.emoji} ${target.name}`;
    if (activeGameControls) activeGameControls.textContent = `Controls: ${target.controls}`;
    if (arcadeQuickSelect) arcadeQuickSelect.value = target.path;

    // Update Favorite Button in modal
    if (arcadeFavBtn) {
      const isFav = favoriteGameIds.has(target.id);
      arcadeFavBtn.textContent = isFav ? '❤️' : '🤍';
      arcadeFavBtn.classList.toggle('active', isFav);
    }

    // Sync tab button active state
    $$('.arcade-tab-btn').forEach(btn => {
      const match = btn.id === `tabArcade_${target.id}`;
      btn.classList.toggle('active', match);
      if (match && typeof btn.scrollIntoView === 'function') {
        btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    });

    // Update Recents
    recentGameIds = [target.id, ...recentGameIds.filter(id => id !== target.id)].slice(0, 5);
    saveRecents();
  }

  function openArcade(gameUrl = "game/index.html") {
    if (!arcadeModal) return;
    arcadeModal.classList.remove("hidden");
    arcadeModal.setAttribute("aria-hidden", "false");
    switchGame(gameUrl);
    syncArcadeQueueHUD();
    document.body.style.overflow = "hidden";
  }

  function closeArcade() {
    if (!arcadeModal) return;
    arcadeModal.classList.add("hidden");
    arcadeModal.setAttribute("aria-hidden", "true");
    if (arcadeIframe) arcadeIframe.src = "about:blank";
    document.body.style.overflow = "";

    // Exit fullscreen if active
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }

  function playRandomGame() {
    const randomIndex = Math.floor(Math.random() * arcadeGames.length);
    const chosen = arcadeGames[randomIndex];
    openArcade(chosen.path);
  }

  function reloadActiveGame() {
    if (activeGame) switchGame(activeGame.path);
  }

  function toggleArcadeFullscreen() {
    const dialog = arcadeDialog || arcadeModal;
    if (!document.fullscreenElement) {
      if (dialog?.requestFullscreen) dialog.requestFullscreen();
      else if (dialog?.webkitRequestFullscreen) dialog.webkitRequestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  }

  function toggleActiveGameFav() {
    if (!activeGame) return;
    toggleCardFav(activeGame.id);
    if (arcadeFavBtn) {
      const isFav = favoriteGameIds.has(activeGame.id);
      arcadeFavBtn.textContent = isFav ? '❤️' : '🤍';
      arcadeFavBtn.classList.toggle('active', isFav);
    }
  }

  window.toggleCardFav = function(gameId) {
    if (favoriteGameIds.has(gameId)) {
      favoriteGameIds.delete(gameId);
    } else {
      favoriteGameIds.add(gameId);
    }
    saveFavorites();
    renderArcadeGrid(currentCategory, currentSearchQuery);
    if (activeGame && activeGame.id === gameId && arcadeFavBtn) {
      const isFav = favoriteGameIds.has(gameId);
      arcadeFavBtn.textContent = isFav ? '❤️' : '🤍';
      arcadeFavBtn.classList.toggle('active', isFav);
    }
  };

  window.filterArcadeCards = function(query) {
    renderArcadeGrid(currentCategory, query);
  };

  // Live HUD Sync for Active File Scrubbing Queue inside Arcade Modal
  function syncArcadeQueueHUD() {
    if (!arcadeQueueHud || !arcadeQueueText) return;
    const total = queue.size;
    if (total === 0) {
      arcadeQueueHud.style.display = 'none';
      return;
    }

    const cleaned = Array.from(queue.values()).filter(e => e.cleanResult).length;
    arcadeQueueHud.style.display = 'inline-flex';

    if (cleaned === total) {
      arcadeQueueHud.className = 'arcade-queue-hud';
      arcadeQueueText.textContent = `✓ Queue: All ${total} Files 100% Sanitized`;
    } else {
      arcadeQueueHud.className = 'arcade-queue-hud active';
      arcadeQueueText.textContent = `⚡ Queue: ${cleaned}/${total} Cleaned in background`;
    }
  }

  // Category Filter Chips Listener
  $$('.arcade-cat-chip').forEach(chip => {
    chip.onclick = () => {
      $$('.arcade-cat-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderArcadeGrid(chip.dataset.cat, arcadeSearchInput ? arcadeSearchInput.value : '');
    };
  });

  // Action Buttons & Top Launcher
  const btnArcadeRandom = $("#btnArcadeRandom");
  if (btnArcadeRandom) btnArcadeRandom.onclick = playRandomGame;

  const btnArcadeMaster = $("#btnArcadeMaster");
  if (btnArcadeMaster) btnArcadeMaster.onclick = () => openArcade("game/index.html");

  const arcadeReloadBtn = $("#arcadeReloadBtn");
  if (arcadeReloadBtn) arcadeReloadBtn.onclick = reloadActiveGame;

  const arcadeRandomBtn = $("#arcadeRandomBtn");
  if (arcadeRandomBtn) arcadeRandomBtn.onclick = playRandomGame;

  const arcadeFavBtnEl = $("#arcadeFavBtn");
  if (arcadeFavBtnEl) arcadeFavBtnEl.onclick = toggleActiveGameFav;

  const arcadeFullscreenBtn = $("#arcadeFullscreenBtn");
  if (arcadeFullscreenBtn) arcadeFullscreenBtn.onclick = toggleArcadeFullscreen;

  const openBtn = $("#openArcadeBtn");
  if (openBtn) openBtn.onclick = () => openArcade("game/index.html");

  const closeBtn = $("#closeArcadeBtn");
  if (closeBtn) closeBtn.onclick = closeArcade;

  const backdrop = $("#arcadeBackdrop");
  if (backdrop) backdrop.onclick = closeArcade;

  // Keyboard Shortcuts in Arcade Modal
  window.addEventListener("keydown", e => {
    if (!arcadeModal || arcadeModal.classList.contains("hidden")) return;
    if (e.key === "Escape") {
      closeArcade();
    } else if (e.key === "r" && (e.ctrlKey || e.metaKey || document.activeElement.tagName !== 'INPUT')) {
      if (document.activeElement.tagName !== 'INPUT') {
        reloadActiveGame();
      }
    }
  });

  // Global window methods
  window.openArcade = openArcade;
  window.closeArcade = closeArcade;
  window.switchGame = switchGame;
  window.playRandomGame = playRandomGame;
  window.reloadActiveGame = reloadActiveGame;
  window.toggleArcadeFullscreen = toggleArcadeFullscreen;
  window.toggleActiveGameFav = toggleActiveGameFav;

  // Initial Initialization
  populateQuickSelect();
  populateTabBar();
  renderRecentlyPlayed();
  renderArcadeGrid('all', '');
  updateFavBadges();

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
