/**
 * Chemistry AI Tutor — Frontend Logic
 *
 * Vanilla JS only. No external libraries.
 *
 * Responsibilities:
 *  - PDF drag-and-drop upload with multi-file support
 *  - Sequential upload with per-file progress feedback
 *  - Chat-style Q&A interface with conversation history
 *  - Rendering answers, source chips, related topics
 *  - Context drawer (shows raw retrieved chunks)
 *  - Toast notification system
 *  - Auto-resize textarea
 */

'use strict';

// ══════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════

const state = {
  sessionId: null,
  /** @type {File[]} */
  selectedFiles: [],
  isUploading: false,
  isAsking: false,
  /** @type {Array<{role:'user'|'assistant', content:string, sources:[], topics:[]}>} */
  conversation: [],
  /** Stores last retrieved sources for the drawer */
  lastSources: [],
};

// ══════════════════════════════════════════════════════
// DOM REFERENCES
// ══════════════════════════════════════════════════════

const dom = {
  dropZone:          () => document.getElementById('drop-zone'),
  fileInput:         () => document.getElementById('file-input'),
  fileListPreview:   () => document.getElementById('file-list-preview'),
  fileList:          () => document.getElementById('file-list'),
  fileCountBadge:    () => document.getElementById('file-count-badge'),
  addMoreBtn:        () => document.getElementById('add-more-btn'),
  clearAllBtn:       () => document.getElementById('clear-all-btn'),
  uploadBtn:         () => document.getElementById('upload-btn'),
  uploadStatus:      () => document.getElementById('upload-status'),
  sessionCard:       () => document.getElementById('session-card'),
  statFile:          () => document.getElementById('stat-file'),
  statPages:         () => document.getElementById('stat-pages'),
  statChunks:        () => document.getElementById('stat-chunks'),
  statSession:       () => document.getElementById('stat-session'),
  emptyState:        () => document.getElementById('empty-state'),
  chatContainer:     () => document.getElementById('chat-container'),
  questionInput:     () => document.getElementById('question-input'),
  askBtn:            () => document.getElementById('ask-btn'),
  statusIndicator:   () => document.getElementById('status-indicator'),
  contextDrawer:     () => document.getElementById('context-drawer'),
  drawerOverlay:     () => document.getElementById('drawer-overlay'),
  drawerContent:     () => document.getElementById('drawer-content'),
  closeDrawerBtn:    () => document.getElementById('close-drawer-btn'),
  toastContainer:    () => document.getElementById('toast-container'),
};

// ══════════════════════════════════════════════════════
// UPLOAD — DRAG & DROP (Multi-file)
// ══════════════════════════════════════════════════════

function initDropZone() {
  const zone = dom.dropZone();
  const input = dom.fileInput();

  // Click to browse
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });

  // Drag events
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  ['dragleave', 'dragend'].forEach((evt) =>
    zone.addEventListener(evt, () => zone.classList.remove('drag-over'))
  );
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) handleFilesSelected(files);
  });

  // File input change (supports multiple)
  input.addEventListener('change', () => {
    const files = Array.from(input.files || []);
    if (files.length > 0) handleFilesSelected(files);
  });

  // Add More button
  dom.addMoreBtn().addEventListener('click', () => {
    input.click();
  });

  // Clear All button
  dom.clearAllBtn().addEventListener('click', clearFiles);
}

/**
 * Handle multiple files being selected.
 * Validates each file and adds valid ones to the state.
 * @param {File[]} files
 */
function handleFilesSelected(files) {
  let added = 0;
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      showToast(`"${file.name}" is not a PDF — skipped.`, 'error');
      continue;
    }
    if (file.size > 50 * 1024 * 1024) {
      showToast(`"${file.name}" exceeds the 50 MB limit — skipped.`, 'error');
      continue;
    }
    // Avoid duplicate files by name
    if (state.selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
      continue;
    }
    state.selectedFiles.push(file);
    added++;
  }

  if (added > 0) {
    renderFileList();
    dom.uploadBtn().disabled = false;
    dom.uploadBtn().removeAttribute('aria-disabled');
  }

  // Reset the file input so re-selecting the same file works
  dom.fileInput().value = '';
}

/**
 * Render the file list preview showing all selected files.
 */
function renderFileList() {
  const list = dom.fileList();
  const preview = dom.fileListPreview();
  const badge = dom.fileCountBadge();

  list.innerHTML = '';

  if (state.selectedFiles.length === 0) {
    preview.classList.add('hidden');
    dom.dropZone().classList.remove('hidden');
    dom.uploadBtn().disabled = true;
    dom.uploadBtn().setAttribute('aria-disabled', 'true');
    return;
  }

  dom.dropZone().classList.add('hidden');
  preview.classList.remove('hidden');
  badge.textContent = state.selectedFiles.length;

  state.selectedFiles.forEach((file, idx) => {
    const li = document.createElement('li');
    li.className = 'file-list-item';
    li.innerHTML = `
      <span class="file-list-item__icon" aria-hidden="true">📄</span>
      <div class="file-list-item__info">
        <span class="file-list-item__name">${escapeHtml(file.name)}</span>
        <span class="file-list-item__size">${formatBytes(file.size)}</span>
      </div>
      <button class="file-list-item__remove icon-btn" data-index="${idx}" aria-label="Remove ${escapeHtml(file.name)}" title="Remove">✕</button>
    `;
    list.appendChild(li);
  });

  // Attach remove handlers
  list.querySelectorAll('.file-list-item__remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      state.selectedFiles.splice(idx, 1);
      renderFileList();
    });
  });
}

/**
 * Clear all selected files and reset the upload UI.
 * @param {boolean} keepStatus - If true, don't hide the status message.
 */
function clearFiles(keepStatus = false) {
  state.selectedFiles = [];
  dom.fileInput().value = '';
  renderFileList();
  if (!keepStatus) hideStatus();
}

// ══════════════════════════════════════════════════════
// UPLOAD — API CALL (Sequential multi-file)
// ══════════════════════════════════════════════════════

async function handleUpload() {
  if (state.selectedFiles.length === 0 || state.isUploading) return;

  state.isUploading = true;
  const totalFiles = state.selectedFiles.length;
  const isBatch = totalFiles > 1;

  setIndicator('loading');
  dom.uploadBtn().disabled = true;

  // Determine if we should append to an existing session
  const appendCheckbox = document.getElementById('append-checkbox');
  const shouldAppend = state.sessionId && appendCheckbox && appendCheckbox.checked;
  let currentSessionId = shouldAppend ? state.sessionId : null;
  let lastData = null;

  try {
    for (let i = 0; i < totalFiles; i++) {
      const file = state.selectedFiles[i];
      const progressLabel = isBatch
        ? `Uploading file ${i + 1}/${totalFiles}: ${file.name}`
        : `Uploading and indexing your document…`;

      setStatus('loading', `<span class="spinner"></span> ${escapeHtml(progressLabel)}`);

      // Highlight current file in the list
      highlightFileInList(i);

      const formData = new FormData();
      formData.append('file', file);

      // After first upload, append subsequent files to the same session
      if (currentSessionId) {
        formData.append('session_id', currentSessionId);
      }

      const res = await fetch('/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || `Upload failed for ${file.name}.`);
      }

      // Capture session_id from first upload
      if (!currentSessionId) {
        currentSessionId = data.session_id;
      }

      lastData = data;

      // Mark file as uploaded in the list
      markFileUploaded(i);
    }

    // All files uploaded successfully
    state.sessionId = currentSessionId;

    // Update session card with aggregate data
    dom.statFile().textContent    = lastData.file_name;
    dom.statPages().textContent   = lastData.page_count.toLocaleString();
    dom.statChunks().textContent  = lastData.chunk_count.toLocaleString();
    dom.statSession().textContent = lastData.session_id;
    dom.statSession().title       = lastData.session_id;
    dom.sessionCard().classList.remove('hidden');

    // Show append checkbox now that a session is active
    const appendOption = document.getElementById('append-option-container');
    if (appendOption) appendOption.classList.remove('hidden');

    const message = isBatch
      ? `✅ All ${totalFiles} files indexed! ${lastData.chunk_count} chunks across ${lastData.page_count} pages.`
      : `✅ ${lastData.message} — ${lastData.chunk_count} chunks indexed across ${lastData.page_count} pages.`;

    setStatus('success', message);
    setIndicator('ready');
    showToast(
      isBatch
        ? `${totalFiles} documents indexed! You can now ask questions.`
        : 'Document indexed! You can now ask questions.',
      'success'
    );

    // Enable chat
    dom.questionInput().disabled = false;
    dom.askBtn().disabled = false;

    // Show chat, hide empty state
    dom.emptyState().classList.add('hidden');
    dom.chatContainer().classList.remove('hidden');

    // Clear file selection but keep success message
    clearFiles(true);

  } catch (err) {
    setStatus('error', `❌ ${err.message}`);
    setIndicator('error');
    showToast(err.message, 'error');
    dom.uploadBtn().disabled = false;
  } finally {
    state.isUploading = false;
  }
}

/**
 * Highlight the currently uploading file in the list.
 */
function highlightFileInList(index) {
  const items = dom.fileList()?.querySelectorAll('.file-list-item');
  if (!items) return;
  items.forEach((item, i) => {
    item.classList.toggle('file-list-item--uploading', i === index);
    if (i < index) {
      item.classList.add('file-list-item--done');
    }
  });
}

/**
 * Mark a file as successfully uploaded in the list.
 */
function markFileUploaded(index) {
  const items = dom.fileList()?.querySelectorAll('.file-list-item');
  if (!items || !items[index]) return;
  items[index].classList.remove('file-list-item--uploading');
  items[index].classList.add('file-list-item--done');

  // Replace the remove button with a check mark
  const removeBtn = items[index].querySelector('.file-list-item__remove');
  if (removeBtn) {
    removeBtn.outerHTML = '<span class="file-list-item__check" aria-hidden="true">✓</span>';
  }
}

// ══════════════════════════════════════════════════════
// ASK — API CALL
// ══════════════════════════════════════════════════════

async function handleAsk() {
  const question = dom.questionInput().value.trim();
  if (!question || !state.sessionId || state.isAsking) return;

  state.isAsking = true;
  dom.askBtn().disabled = true;
  dom.questionInput().value = '';
  autoResizeTextarea(dom.questionInput());

  // Append user message
  appendUserMessage(question);

  // Append skeleton loading indicator
  const skeletonId = appendSkeleton();
  setIndicator('loading');

  const externalExamplesToggle = document.getElementById('external-examples-toggle');
  const allowExternalExamples = externalExamplesToggle ? externalExamplesToggle.checked : false;

  try {
    const res = await fetch('/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        session_id: state.sessionId,
        top_k: 5,
        allow_external_examples: allowExternalExamples,
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || 'Failed to get an answer.');
    }

    removeSkeleton(skeletonId);
    state.lastSources = data.sources || [];
    appendAssistantMessage(
      data.answer,
      data.sources || [],
      data.related_topics || [],
      data.equations || [],
      data.structures || []
    );
    setIndicator('ready');

  } catch (err) {
    removeSkeleton(skeletonId);
    appendErrorMessage(err.message);
    setIndicator('error');
    showToast(err.message, 'error');
  } finally {
    state.isAsking = false;
    dom.askBtn().disabled = false;
    dom.questionInput().focus();
  }
}

// ══════════════════════════════════════════════════════
// CHAT — RENDER FUNCTIONS
// ══════════════════════════════════════════════════════

function appendUserMessage(text) {
  const div = document.createElement('div');
  div.className = 'message message--user';
  div.innerHTML = `<div class="message__bubble">${escapeHtml(text)}</div>`;
  dom.chatContainer().appendChild(div);
  scrollToBottom();
}

function appendSkeleton() {
  const id = 'skel-' + Date.now();
  const div = document.createElement('div');
  div.id = id;
  div.className = 'message message--assistant';
  div.innerHTML = `
    <div class="skeleton-bubble">
      <div class="skeleton-line" style="width:85%"></div>
      <div class="skeleton-line" style="width:65%"></div>
      <div class="skeleton-line"></div>
    </div>`;
  dom.chatContainer().appendChild(div);
  scrollToBottom();
  return id;
}

function removeSkeleton(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

/**
 * Appends an assistant response bubble with answer, reactions, structures, sources, and topics.
 * @param {string} answer
 * @param {Array} sources
 * @param {Array<string>} topics
 * @param {Array<{equation:string, label:string}>} equations
 * @param {Array} structures
 */
function appendAssistantMessage(answer, sources, topics, equations = [], structures = []) {
  const isFallback = answer.toLowerCase().includes('not present in the provided chapter') ||
                     answer.toLowerCase().includes("couldn't find this information") ||
                     answer.toLowerCase().includes("could not find this information");

  const div = document.createElement('div');
  div.className = `message message--assistant${isFallback ? ' message--fallback' : ''}`;

  // ── Answer bubble HTML
  const bubbleHtml = `<div class="message__bubble">${formatAnswer(answer)}</div>`;

  // ── Molecular Geometry & Hybridisation Cards
  let structuresHtml = '';
  if (structures.length > 0 && !isFallback) {
    const cards = structures.map((st, sIndex) => {
      const molRendered = renderChemEquation(st.molecule || '');
      const hybrid = st.hybridisation
        ? `<span class="structure-badge structure-badge--hybrid"><span class="badge-icon">⚡</span> Hybridisation: <strong>${escapeHtml(st.hybridisation)}</strong></span>`
        : '';
      const geom = st.geometry
        ? `<span class="structure-badge structure-badge--geom"><span class="badge-icon">📐</span> Geometry: <strong>${escapeHtml(st.geometry)}</strong></span>`
        : '';
      const angle = st.bond_angles
        ? `<span class="structure-badge structure-badge--angle"><span class="badge-icon">∠</span> Bond Angle: <strong>${escapeHtml(st.bond_angles)}</strong></span>`
        : '';
      const central = st.central_atom
        ? `<div class="spec-item"><span class="spec-label">Central Atom</span><span class="spec-value">${escapeHtml(st.central_atom)}</span></div>`
        : '';
      const steric = st.steric_number != null
        ? `<div class="spec-item"><span class="spec-label">Steric Number</span><span class="spec-value">${st.steric_number}</span></div>`
        : '';
      const bp = st.bond_pairs != null
        ? `<div class="spec-item"><span class="spec-label">Bond Pairs (σ)</span><span class="spec-value">${st.bond_pairs}</span></div>`
        : '';
      const lp = st.lone_pairs != null
        ? `<div class="spec-item"><span class="spec-label">Lone Pairs</span><span class="spec-value">${st.lone_pairs}</span></div>`
        : '';

      const uid = 'mol3d_' + Date.now() + '_' + sIndex;
      let diagramHtml = buildStructureDiagram(st, uid);

      return `
        <div class="molecular-structure-card">
          <div class="structure-card-header">
            <div class="structure-mol-title">${molRendered}</div>
            <div class="structure-badges-row">
              ${hybrid}
              ${geom}
              ${angle}
            </div>
          </div>
          <div class="structure-specs-grid">
            ${central}
            ${steric}
            ${bp}
            ${lp}
          </div>
          ${diagramHtml}
        </div>`;
    }).join('');

    structuresHtml = `
      <div class="structures-section">
        <p class="chips-label">🧬 Molecular Geometry & Hybridisation</p>
        <div class="structures-grid">${cards}</div>
      </div>`;
  }

  // ── Equation cards (only show actual reactions with arrows)
  let equationsHtml = '';
  const reactionArrows = ['→', '⇌', '⟶', '←', '->', '<=>', '=>'];
  const realReactions = equations.filter(eq =>
    reactionArrows.some(arrow => eq.equation.includes(arrow))
  );
  if (realReactions.length > 0 && !isFallback) {
    const cards = realReactions.map((eq, i) => {
      const rendered = renderChemEquation(eq.equation);
      const labelHtml = eq.label ? `<span class="equation-card__label">${escapeHtml(eq.label)}</span>` : '';
      return `
        <div class="equation-card" data-eq-index="${i}">
          <div class="equation-card__formula">${rendered}</div>
          <div class="equation-card__footer">
            ${labelHtml}
            <button class="equation-card__copy" title="Copy equation" aria-label="Copy equation">
              <span class="copy-icon">📋</span>
              <span class="copy-done hidden">✓</span>
            </button>
          </div>
        </div>`;
    }).join('');
    equationsHtml = `
      <div class="equations-section">
        <p class="chips-label">⚗️ Key Chemical Reactions</p>
        <div class="equations-grid">${cards}</div>
      </div>`;
  }

  // ── Source chips
  let sourcesHtml = '';
  if (sources.length > 0 && !isFallback) {
    const chips = sources.map((s, i) => `
      <button class="source-chip" data-index="${i}"
        title="Page ${s.page} — Score: ${s.score}"
        aria-label="Source: Page ${s.page}, relevance score ${s.score}">
        📄 Page ${s.page}
        <span class="source-chip__score">${(s.score * 100).toFixed(0)}%</span>
      </button>`).join('');
    sourcesHtml = `
      <div>
        <p class="chips-label">Sources</p>
        <div class="sources-row">${chips}</div>
      </div>`;
  }

  // ── Related topics
  let topicsHtml = '';
  if (topics.length > 0 && !isFallback) {
    const chips = topics.map((t) => `<span class="topic-chip">🔗 ${escapeHtml(t)}</span>`).join('');
    topicsHtml = `
      <div>
        <p class="chips-label">Explore next</p>
        <div class="topics-row">${chips}</div>
      </div>`;
  }

  div.innerHTML = bubbleHtml + structuresHtml + equationsHtml + sourcesHtml + topicsHtml;

  dom.chatContainer().appendChild(div);

  // Mount 3Dmol.js viewers for any 3D molecular structures
  mount3DViewers(div);

  // Attach click handlers for source chips
  div.querySelectorAll('.source-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index, 10);
      openDrawer(sources, idx);
    });
  });

  // Attach copy handlers for equation cards
  div.querySelectorAll('.equation-card__copy').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.equation-card');
      const idx = parseInt(card.dataset.eqIndex, 10);
      const eqText = realReactions[idx]?.equation || '';
      copyEquationToClipboard(eqText, btn);
    });
  });

  // Attach copy handlers for in-text reaction box overlays
  div.querySelectorAll('.reaction-box-copy').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rawEq = decodeURIComponent(btn.dataset.rawEq || '');
      copyEquationToClipboard(rawEq, btn);
    });
  });

  scrollToBottom();
}

function appendErrorMessage(text) {
  const div = document.createElement('div');
  div.className = 'message message--assistant message--fallback';
  div.innerHTML = `<div class="message__bubble">⚠️ ${escapeHtml(text)}</div>`;
  dom.chatContainer().appendChild(div);
  scrollToBottom();
}

// ══════════════════════════════════════════════════════
// CONTEXT DRAWER
// ══════════════════════════════════════════════════════

function openDrawer(sources, highlightIndex = 0) {
  const content = dom.drawerContent();
  content.innerHTML = '';

  sources.forEach((src, i) => {
    const chunk = document.createElement('div');
    chunk.className = 'context-chunk';
    if (i === highlightIndex) {
      chunk.style.borderColor = 'rgba(99,102,241,0.5)';
      chunk.style.background  = 'rgba(99,102,241,0.06)';
    }
    chunk.innerHTML = `
      <div class="context-chunk__header">
        <span class="context-chunk__page">📄 Page ${src.page}</span>
        <span class="context-chunk__score">Score: ${(src.score * 100).toFixed(1)}%</span>
      </div>
      <p class="context-chunk__text">${escapeHtml(src.content)}</p>`;
    content.appendChild(chunk);
  });

  dom.contextDrawer().classList.remove('hidden');
  dom.drawerOverlay().classList.remove('hidden');
  // Trigger CSS transition
  requestAnimationFrame(() => {
    dom.contextDrawer().classList.add('open');
    dom.drawerOverlay().classList.add('open');
  });
}

function closeDrawer() {
  dom.contextDrawer().classList.remove('open');
  dom.drawerOverlay().classList.remove('open');
  setTimeout(() => {
    dom.contextDrawer().classList.add('hidden');
    dom.drawerOverlay().classList.add('hidden');
  }, 400); // match CSS transition duration
}

// ══════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ══════════════════════════════════════════════════════

/**
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 * @param {number} duration ms
 */
function showToast(message, type = 'info', duration = 4000) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `<span aria-hidden="true">${icons[type]}</span> ${escapeHtml(message)}`;

  dom.toastContainer().appendChild(toast);

  setTimeout(() => {
    toast.style.animation = `toast-out 300ms forwards`;
    setTimeout(() => toast.remove(), 320);
  }, duration);
}

// ══════════════════════════════════════════════════════
// STATUS & INDICATOR HELPERS
// ══════════════════════════════════════════════════════

function setStatus(type, html) {
  const el = dom.uploadStatus();
  el.className = `status-area ${type}`;
  el.innerHTML = html;
  el.classList.remove('hidden');
}

function hideStatus() {
  dom.uploadStatus().classList.add('hidden');
}

function setIndicator(state) {
  const dot = dom.statusIndicator();
  dot.className = `status-dot status-dot--${state}`;
  const labels = { idle: 'Idle', loading: 'Processing…', ready: 'Ready', error: 'Error' };
  dot.title = labels[state] || state;
  dot.setAttribute('aria-label', labels[state] || state);
}

// ══════════════════════════════════════════════════════
// TEXTAREA AUTO-RESIZE
// ══════════════════════════════════════════════════════

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

// ══════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════

function scrollToBottom() {
  const chat = dom.chatContainer();
  requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; });
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Renders a chemistry equation or molecular orbital expression via KaTeX or styled fallback.
 * Handles \sigma, \pi, orbitals (\sigma 1s < \sigma^*1s), chemical reactions, and formulas.
 * @param {string} eq - The equation string
 * @returns {string} HTML string with rendered equation
 */
function renderChemEquation(eq) {
  if (!eq) return '';
  const trimmed = String(eq).trim();

  // Normalize LaTeX expressions for orbitals, asterisks, subscripts, triple bonds, and arrows
  let normalized = trimmed
    // Fix \+sigma^* or \+pi^* -> \sigma^{*}, \pi^{*}
    .replace(/\\+sigma\s*\^\s*\{\s*\*\s*\}/g, '\\sigma^{*}')
    .replace(/\\+sigma\s*\^\s*\*/g, '\\sigma^{*}')
    .replace(/\\+sigma\s*\*/g, '\\sigma^{*}')
    .replace(/\\+sigma\s*/g, '\\sigma ')
    .replace(/\\+pi\s*\^\s*\{\s*\*\s*\}/g, '\\pi^{*}')
    .replace(/\\+pi\s*\^\s*\*/g, '\\pi^{*}')
    .replace(/\\+pi\s*\*/g, '\\pi^{*}')
    .replace(/\\+pi\s*/g, '\\pi ')
    // Fix triple bonds
    .replace(/\\+equiv/g, '\\equiv ')
    // Fix subscripts like _x, _y, _z, _g, _u -> _{x}, _{y}, etc.
    .replace(/_([xyzgu0-9])/g, '_{$1}')
    // Fix Unicode Greek/math to LaTeX commands for KaTeX math mode
    .replace(/σ\*/g, '\\sigma^{*}')
    .replace(/π\*/g, '\\pi^{*}')
    .replace(/σ/g, '\\sigma ')
    .replace(/π/g, '\\pi ')
    .replace(/⇌/g, '\\rightleftharpoons ')
    .replace(/⟶/g, '\\longrightarrow ')
    .replace(/→/g, '\\rightarrow ')
    .replace(/←/g, '\\leftarrow ')
    .replace(/Δ/g, '\\Delta ')
    .replace(/∝/g, '\\propto ');

  if (typeof katex !== 'undefined') {
    // 1. If equation contains complex organic reactions (e.g. \xrightarrow, \equiv, intermediate complexes [ ])
    if (/\\xrightarrow|\\xleftarrow|\\equiv|\\rightleftharpoons|\\longrightarrow|\\rightarrow|->/.test(normalized)) {
      try {
        return katex.renderToString(normalized, {
          throwOnError: false,
          displayMode: true,
          trust: true,
        });
      } catch (e) { /* fallback below */ }
    }

    // 2. If contains \sigma, \pi, or comparison operators (<, >, =), render directly with KaTeX Math mode
    const isOrbitalOrMath = /\\sigma|\\pi|<|>|=|\+|-|\\Delta|\\frac|\^|\*/.test(normalized) &&
                           !/->|<=>|\\rightleftharpoons|\\rightarrow/.test(normalized);

    if (isOrbitalOrMath) {
      try {
        return katex.renderToString(normalized, {
          throwOnError: false,
          displayMode: false,
          trust: true,
        });
      } catch (e) { /* fallback below */ }
    }

    // 3. If already wrapped in \ce{...}, render directly with mhchem
    if (trimmed.startsWith('\\ce{') && trimmed.endsWith('}')) {
      try {
        return katex.renderToString(trimmed, {
          throwOnError: false,
          displayMode: true,
          trust: true,
        });
      } catch (e) { /* fallback below */ }
    }

    // 4. Try standard KaTeX math rendering
    try {
      return katex.renderToString(normalized, {
        throwOnError: false,
        displayMode: true,
        trust: true,
      });
    } catch (e) { /* fallback to styled HTML below */ }
  }

  return renderChemEquationFallback(trimmed);
}

/**
 * Fallback renderer when KaTeX is unavailable or fails.
 * Converts LaTeX symbols (\sigma, \pi, \Delta, \equiv, \xrightarrow), _{} to <sub>, and ^{} to <sup> tags.
 */
function renderChemEquationFallback(eq) {
  return escapeHtml(eq)
    .replace(/\\ce\{([^}]+)\}/g, '$1')
    .replace(/\\equiv/g, '<span style="font-weight:bold;margin:0 0.25rem;">≡</span>')
    .replace(/\\text\{([^}]+)\}/g, '<span style="font-style:italic;">$1</span>')
    .replace(/\\xrightarrow\[(.*?)\]\{(.*?)\}/g, '<span style="display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;margin:0 0.35rem;"><span style="font-size:0.75rem;color:#38bdf8;">$2</span><span class="chem-arrow" style="line-height:1;">⟶</span><span style="font-size:0.75rem;color:#94a3b8;">$1</span></span>')
    .replace(/\\xrightarrow\{(.*?)\}/g, '<span style="display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;margin:0 0.35rem;"><span style="font-size:0.75rem;color:#38bdf8;">$1</span><span class="chem-arrow" style="line-height:1;">⟶</span></span>')
    .replace(/\\+sigma\s*\^\s*\{\s*\*\s*\}/g, 'σ*')
    .replace(/\\+sigma\s*\^\s*\*/g, 'σ*')
    .replace(/\\+sigma\s*\*/g, 'σ*')
    .replace(/\\+sigma\s*/g, 'σ ')
    .replace(/\\+pi\s*\^\s*\{\s*\*\s*\}/g, 'π*')
    .replace(/\\+pi\s*\^\s*\*/g, 'π*')
    .replace(/\\+pi\s*\*/g, 'π*')
    .replace(/\\+pi\s*/g, 'π ')
    .replace(/\\+Delta\s*/g, 'Δ ')
    .replace(/\\+alpha\s*/g, 'α ')
    .replace(/\\+beta\s*/g, 'β ')
    .replace(/_{([^}]+)}/g, '<sub>$1</sub>')
    .replace(/_([xyzgu0-9])/g, '<sub>$1</sub>')
    .replace(/\^{([^}]+)}/g, '<sup>$1</sup>')
    .replace(/\^([0-9*+-])/g, '<sup>$1</sup>')
    .replace(/\\rightleftharpoons/g, '<span class="chem-arrow">⇌</span>')
    .replace(/\\longrightarrow/g, '<span class="chem-arrow">⟶</span>')
    .replace(/\\rightarrow/g, '<span class="chem-arrow">→</span>')
    .replace(/\\leftarrow/g, '<span class="chem-arrow">←</span>')
    .replace(/→/g, '<span class="chem-arrow">→</span>')
    .replace(/⇌/g, '<span class="chem-arrow">⇌</span>')
    .replace(/⟶/g, '<span class="chem-arrow">⟶</span>')
    .replace(/->/g, '<span class="chem-arrow">→</span>')
    .replace(/<=>/g, '<span class="chem-arrow">⇌</span>');
}

/**
 * Sanitize any residual LaTeX commands that Gemini might still output
 * in the answer text (outside of $$ blocks). Converts them to readable text.
 */
function sanitizeLatexFromText(text) {
  return text
    // \text{something} → something
    .replace(/\\text\{([^}]*)\}/g, '$1')
    // \mathrm{something} → something
    .replace(/\\mathrm\{([^}]*)\}/g, '$1')
    // \propto → ∝
    .replace(/\\propto/g, '∝')
    // \infty → ∞
    .replace(/\\infty/g, '∞')
    // \approx → ≈
    .replace(/\\approx/g, '≈')
    // \neq → ≠
    .replace(/\\neq/g, '≠')
    // \rightarrow → →
    .replace(/\\rightarrow/g, '→')
    // \leftarrow → ←
    .replace(/\\leftarrow/g, '←')
    // \rightleftharpoons → ⇌
    .replace(/\\rightleftharpoons/g, '⇌')
    // \Delta → Δ
    .replace(/\\Delta/g, 'Δ')
    // \\sigma^{*} → σ*, \\sigma^* → σ*, \\sigma* → σ*, \\sigma → σ
    .replace(/\\+sigma\s*\^\s*\{\s*\*\s*\}/g, 'σ*')
    .replace(/\\+sigma\s*\^\s*\*/g, 'σ*')
    .replace(/\\+sigma\s*\*/g, 'σ*')
    .replace(/\\+sigma/g, 'σ')
    .replace(/\\+pi\s*\^\s*\{\s*\*\s*\}/g, 'π*')
    .replace(/\\+pi\s*\^\s*\*/g, 'π*')
    .replace(/\\+pi\s*\*/g, 'π*')
    .replace(/\\+pi/g, 'π')
    // Clean up any remaining backslashes before common words
    .replace(/\\([a-zA-Z]+)\{([^}]*)\}/g, '$2')
    // Remove stray backslashes
    .replace(/\\\\/g, '');
}

/**
 * Build a visual diagram for a molecular structure card.
 * For orbital/MO diagrams, renders a visual HTML energy level diagram.
 * For regular Lewis structures, renders ASCII art.
 */
/**
 * ══════════════════════════════════════════════════════════════════════
 * 3DMOL.JS INTERACTIVE 3D MOLECULAR VIEWER & NCERT SUITE
 * ══════════════════════════════════════════════════════════════════════
 */

// ── Built-in High-Accuracy 3D XYZ Molecular Coordinate Database ────────
const MOL_3D_XYZ_DATABASE = {
  'CH4': `5\nMethane\nC 0.0000 0.0000 0.0000\nH 0.6291 0.6291 0.6291\nH -0.6291 -0.6291 0.6291\nH -0.6291 0.6291 -0.6291\nH 0.6291 -0.6291 -0.6291`,
  'NH3': `4\nAmmonia\nN 0.0000 0.0000 0.1165\nH 0.0000 0.9397 -0.2718\nH 0.8138 -0.4699 -0.2718\nH -0.8138 -0.4699 -0.2718`,
  'H2O': `3\nWater\nO 0.0000 0.0000 0.1173\nH 0.0000 0.7572 -0.4692\nH 0.0000 -0.7572 -0.4692`,
  'PCL5': `6\nPhosphorus Pentachloride\nP 0.0000 0.0000 0.0000\nCl 0.0000 0.0000 2.1400\nCl 0.0000 0.0000 -2.1400\nCl 2.0200 0.0000 0.0000\nCl -1.0100 1.7494 0.0000\nCl -1.0100 -1.7494 0.0000`,
  'SF6': `7\nSulfur Hexafluoride\nS 0.0000 0.0000 0.0000\nF 1.5640 0.0000 0.0000\nF -1.5640 0.0000 0.0000\nF 0.0000 1.5640 0.0000\nF 0.0000 -1.5640 0.0000\nF 0.0000 0.0000 1.5640\nF 0.0000 0.0000 -1.5640`,
  'XEF4': `5\nXenon Tetrafluoride\nXe 0.0000 0.0000 0.0000\nF 1.9500 0.0000 0.0000\nF -1.9500 0.0000 0.0000\nF 0.0000 1.9500 0.0000\nF 0.0000 -1.9500 0.0000`,
  'SF4': `5\nSulfur Tetrafluoride\nS 0.0000 0.0000 0.0000\nF 0.0000 0.0000 1.6460\nF 0.0000 0.0000 -1.6460\nF 1.5450 0.0000 0.0000\nF -1.5450 0.0000 0.0000`,
  'CLF3': `4\nChlorine Trifluoride\nCl 0.0000 0.0000 0.0000\nF 0.0000 0.0000 1.6980\nF 0.0000 0.0000 -1.6980\nF 1.5980 0.0000 0.0000`,
  'BF3': `4\nBoron Trifluoride\nB 0.0000 0.0000 0.0000\nF 0.0000 1.3130 0.0000\nF 1.1371 -0.6565 0.0000\nF -1.1371 -0.6565 0.0000`,
  'CO2': `3\nCarbon Dioxide\nC 0.0000 0.0000 0.0000\nO 1.1600 0.0000 0.0000\nO -1.1600 0.0000 0.0000`,
  'BECL2': `3\nBeryllium Chloride\nBe 0.0000 0.0000 0.0000\nCl 1.7700 0.0000 0.0000\nCl -1.7700 0.0000 0.0000`,
  'CCL4': `5\nCarbon Tetrachloride\nC 0.0000 0.0000 0.0000\nCl 1.0200 1.0200 1.0200\nCl -1.0200 -1.0200 1.0200\nCl -1.0200 1.0200 -1.0200\nCl 1.0200 -1.0200 -1.0200`,
  'C2H6': `8\nEthane\nC 0.0000 0.0000 0.7650\nC 0.0000 0.0000 -0.7650\nH 0.0000 1.0200 1.1600\nH 0.8833 -0.5100 1.1600\nH -0.8833 -0.5100 1.1600\nH 0.0000 -1.0200 -1.1600\nH -0.8833 0.5100 -1.1600\nH 0.8833 0.5100 -1.1600`,
  'C2H4': `6\nEthene\nC 0.0000 0.0000 0.6695\nC 0.0000 0.0000 -0.6695\nH 0.0000 0.9230 1.2320\nH 0.0000 -0.9230 1.2320\nH 0.0000 0.9230 -1.2320\nH 0.0000 -0.9230 -1.2320`,
  'C2H2': `4\nEthyne\nC 0.0000 0.0000 0.6030\nC 0.0000 0.0000 -0.6030\nH 0.0000 0.0000 1.6660\nH 0.0000 0.0000 -1.6660`,
  'C6H6': `12\nBenzene\nC 1.3970 0.0000 0.0000\nC 0.6985 1.2098 0.0000\nC -0.6985 1.2098 0.0000\nC -1.3970 0.0000 0.0000\nC -0.6985 -1.2098 0.0000\nC 0.6985 -1.2098 0.0000\nH 2.4770 0.0000 0.0000\nH 1.2385 2.1451 0.0000\nH -1.2385 2.1451 0.0000\nH -2.4770 0.0000 0.0000\nH -1.2385 -2.1451 0.0000\nH 1.2385 -2.1451 0.0000`,
  'SO2': `3\nSulfur Dioxide\nS 0.0000 0.0000 0.1250\nO 0.0000 1.2800 -0.4900\nO 0.0000 -1.2800 -0.4900`,
  'SO3': `4\nSulfur Trioxide\nS 0.0000 0.0000 0.0000\nO 0.0000 1.4200 0.0000\nO 1.2297 -0.7100 0.0000\nO -1.2297 -0.7100 0.0000`,
  'BRF5': `6\nBromine Pentafluoride\nBr 0.0000 0.0000 0.0000\nF 0.0000 0.0000 1.6890\nF 1.7740 0.0000 0.0000\nF -1.7740 0.0000 0.0000\nF 0.0000 1.7740 0.0000\nF 0.0000 -1.7740 0.0000`,
  'IF7': `8\nIodine Heptafluoride\nI 0.0000 0.0000 0.0000\nF 0.0000 0.0000 1.7800\nF 0.0000 0.0000 -1.7800\nF 1.8300 0.0000 0.0000\nF 0.5655 1.7404 0.0000\nF -1.4805 1.0756 0.0000\nF -1.4805 -1.0756 0.0000\nF 0.5655 -1.7404 0.0000`
};

/**
 * Main dispatcher for all molecular structure visualizations:
 * 1. Special 12th Grade Inorganic Structures (Banana bonds, Butterfly peroxides, Ozone resonance)
 * 2. NCERT 3-Column Molecular Orbital (MO) Energy Level Diagrams
 * 3. 3Dmol.js Interactive 3D Molecular Model (Ball & Stick, Space-Fill, Stick)
 */
function buildStructureDiagram(st, uniqueId) {
  const mol = (st.molecule || '').replace(/[_{}]/g, '').toUpperCase();
  const rawMol = st.molecule || '';
  const ascii = st.diagram_ascii || '';
  const geom = (st.geometry || '').toLowerCase();
  const uid = uniqueId || 'mol3d_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

  // 1. Check for Special NCERT Inorganic Structures
  if (/B2H6|DIBORANE/i.test(mol)) {
    return buildDiboraneBananaBondSVG();
  }
  if (/CRO5|CHROMIUM.*PEROXIDE/i.test(mol)) {
    return buildCrO5ButterflySVG();
  }
  if (/O3|OZONE/i.test(mol) && !/MO_DIAGRAM/i.test(ascii)) {
    return buildOzoneResonanceSVG();
  }
  if (/H2S2O8|MARSHALL/i.test(mol)) {
    return buildMarshallsAcidSVG();
  }
  if (/KHF2|BIFLUORIDE/i.test(mol)) {
    return buildKHF2HydrogenBondSVG();
  }

  // 2. Check for Molecular Orbital (MO) Theory questions / diatomic molecules
  const isMODiagram = /MO_DIAGRAM|[σπ]\*?\s*\d[spdf]/i.test(ascii) ||
                      /sigma|pi|bonding|antibonding|energy|homonuclear/i.test(ascii) ||
                      /^(H2|HE2|LI2|BE2|B2|C2|N2|O2|F2|NE2|CO|NO|O2\+|O2\-)$/i.test(mol);

  if (isMODiagram) {
    return buildNCERTMODiagram(st);
  }

  // 3. Check for Resonance Structures (2D SVG diagrams — canonical forms with ↔ arrows)
  if (/BENZENE|C6H6/i.test(mol)) return buildBenzeneResonanceSVG();
  if (/CO3|CARBONATE/i.test(mol)) return buildCarbonateResonanceSVG();
  if (/NO3|NITRATE/i.test(mol)) return buildNitrateResonanceSVG();
  if (/SO3.*2|SULPHITE|SULFITE/i.test(mol) && !/SO3[^2]/i.test(mol)) return buildSulphiteResonanceSVG();
  if (/^SO2$|SULFUR.*DIOXIDE|SULPHUR.*DIOXIDE/i.test(mol)) return buildSO2ResonanceSVG();
  if (/NO2|NITRITE/i.test(mol) && !/NO3/i.test(mol)) return buildNitriteResonanceSVG();
  if (/CH3COO|ACETATE|CARBOXYLATE/i.test(mol)) return buildAcetateResonanceSVG();
  if (/CLO4|PERCHLORATE/i.test(mol)) return buildPerchlorateResonanceSVG();

  // 4. Render 3Dmol.js Interactive 3D Viewer for Molecular Geometry & Hybridisation
  if (st.geometry && st.geometry !== 'N/A' && st.geometry !== 'Linear (MO Theory)') {
    return build3DMolecularViewer(st, uid);
  }

  // 4. Fallback to ASCII / Clean formatted code block if available
  if (ascii.trim()) {
    return `
      <div class="structure-diagram-box">
        <span class="structure-diagram-label">🧬 Chemical Structure Diagram</span>
        <pre class="structure-diagram-pre">${escapeHtml(ascii)}</pre>
      </div>`;
  }
  return '';
}

/**
 * ── 3DMOL.JS INTERACTIVE 3D MOLECULAR VIEWER CARD ─────────────────
 * Generates an interactive 3D WebGL viewport with student-friendly controls.
 */
function build3DMolecularViewer(st, uid) {
  const molRaw = st.molecule || '';
  const molKey = molRaw.toUpperCase().replace(/[_{}]/g, '');
  const geomText = st.geometry || 'Molecular Geometry';
  const hybridText = st.hybridisation ? ` • ${st.hybridisation}` : '';

  return `
    <div class="structure-diagram-box viewer-3d-card" data-viewer-id="${uid}">
      <div class="viewer-3d-header">
        <div class="viewer-3d-title">
          <span class="viewer-3d-badge">🌐 3D Interactive Model</span>
          <span class="viewer-3d-molname">${renderChemEquationFallback(molRaw)} (${escapeHtml(geomText)}${escapeHtml(hybridText)})</span>
        </div>
        <div class="viewer-3d-controls">
          <button class="btn-3d-ctrl btn-3d-spin active" data-target="${uid}" title="Toggle Auto-Rotation">🔄 Spin</button>
          <div class="btn-3d-group">
            <button class="btn-3d-ctrl btn-3d-style active" data-target="${uid}" data-style="ballandstick" title="Ball & Stick">Ball & Stick</button>
            <button class="btn-3d-ctrl btn-3d-style" data-target="${uid}" data-style="sphere" title="Space-Filling (CPK)">Space-Fill</button>
            <button class="btn-3d-ctrl btn-3d-style" data-target="${uid}" data-style="stick" title="Stick / Wireframe">Stick</button>
          </div>
          <button class="btn-3d-ctrl btn-3d-reset" data-target="${uid}" title="Reset View Orientation">🎯 Reset</button>
        </div>
      </div>

      <!-- 3D Viewport Container -->
      <div id="${uid}" class="viewer-3d-viewport" data-molkey="${molKey}" data-molraw="${escapeHtml(molRaw)}">
        <div class="viewer-3d-loading">
          <span class="loading-spinner"></span> Loading 3D Molecular Model...
        </div>
      </div>

      <div class="viewer-3d-footer">
        <span class="viewer-3d-hint">👆 Left Click + Drag to rotate • Scroll to zoom • Right Click to pan</span>
      </div>
    </div>`;
}

// Active 3Dmol viewer instances stored by container ID
const active3DViewers = new Map();

/**
 * Mount all 3Dmol.js viewers inside a parent DOM container
 */
function mount3DViewers(parentEl) {
  if (!parentEl) return;
  const viewports = parentEl.querySelectorAll('.viewer-3d-viewport');
  if (viewports.length === 0) return;

  viewports.forEach((vp) => {
    const id = vp.id;
    const molKey = vp.dataset.molkey;
    const molRaw = vp.dataset.molraw;

    // Check if $3Dmol library is loaded in window
    if (typeof window.$3Dmol === 'undefined') {
      console.warn('3Dmol.js not loaded, rendering 2D VSEPR fallback.');
      vp.innerHTML = buildVSEPRGeometryDiagram({ molecule: molRaw, geometry: '3D Shape' });
      return;
    }

    try {
      // Clear loading indicator
      vp.innerHTML = '';

      // Initialize 3Dmol viewer
      const config = { backgroundColor: '#090e1a' };
      const viewer = window.$3Dmol.createViewer(vp, config);

      // Fetch or use built-in XYZ coordinates
      let xyzData = MOL_3D_XYZ_DATABASE[molKey];
      if (!xyzData) {
        // Find best match in DB
        const matchKey = Object.keys(MOL_3D_XYZ_DATABASE).find(k => molKey.includes(k) || k.includes(molKey));
        xyzData = matchKey ? MOL_3D_XYZ_DATABASE[matchKey] : MOL_3D_XYZ_DATABASE['CH4'];
      }

      // Add model to viewer
      const model = viewer.addModel(xyzData, 'xyz');

      // Default style: Ball & Stick with CPK Jmol coloring
      viewer.setStyle({}, {
        stick: { radius: 0.14, colorscheme: 'Jmol' },
        sphere: { scale: 0.28, colorscheme: 'Jmol' }
      });

      // Add element property labels for students
      viewer.addPropertyLabels('elem', {}, {
        fontSize: 11,
        fontColor: '#f8fafc',
        backgroundOpacity: 0.65,
        backgroundColor: '#0f172a',
        inFront: true
      });

      viewer.zoomTo();
      viewer.render();

      // Enable auto-rotation
      viewer.spin(true, 0.6);

      // Store instance and state
      active3DViewers.set(id, {
        viewer,
        isSpinning: true,
        currentStyle: 'ballandstick'
      });

      // Attach button controls for this viewer card
      const card = vp.closest('.viewer-3d-card');
      if (card) {
        // 1. Spin Button
        const spinBtn = card.querySelector('.btn-3d-spin');
        if (spinBtn) {
          spinBtn.addEventListener('click', () => {
            const inst = active3DViewers.get(id);
            if (!inst) return;
            inst.isSpinning = !inst.isSpinning;
            inst.viewer.spin(inst.isSpinning, 0.6);
            spinBtn.classList.toggle('active', inst.isSpinning);
            spinBtn.textContent = inst.isSpinning ? '🔄 Spin' : '⏸ Pause';
          });
        }

        // 2. Style Buttons (Ball & Stick, Space-Fill, Stick)
        card.querySelectorAll('.btn-3d-style').forEach((btn) => {
          btn.addEventListener('click', () => {
            const inst = active3DViewers.get(id);
            if (!inst) return;
            const style = btn.dataset.style;
            card.querySelectorAll('.btn-3d-style').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            if (style === 'sphere') {
              // Space-Filling (CPK radii)
              inst.viewer.setStyle({}, { sphere: { scale: 0.85, colorscheme: 'Jmol' } });
            } else if (style === 'stick') {
              // Stick / Wireframe
              inst.viewer.setStyle({}, { stick: { radius: 0.22, colorscheme: 'Jmol' } });
            } else {
              // Ball & Stick
              inst.viewer.setStyle({}, {
                stick: { radius: 0.14, colorscheme: 'Jmol' },
                sphere: { scale: 0.28, colorscheme: 'Jmol' }
              });
            }
            inst.viewer.render();
            inst.currentStyle = style;
          });
        });

        // 3. Reset Button
        const resetBtn = card.querySelector('.btn-3d-reset');
        if (resetBtn) {
          resetBtn.addEventListener('click', () => {
            const inst = active3DViewers.get(id);
            if (!inst) return;
            inst.viewer.zoomTo();
            inst.viewer.render();
          });
        }
      }
    } catch (err) {
      console.error('Error initializing 3Dmol viewer:', err);
      vp.innerHTML = buildVSEPRGeometryDiagram({ molecule: molRaw, geometry: '3D Shape' });
    }
  });
}

/**
 * ── 1. AUTHENTIC 3-COLUMN NCERT MOLECULAR ORBITAL DIAGRAM ──────────
 * Left: Atom A (AO) | Center: Molecule (MO) | Right: Atom B (AO)
 * Features electron spins (↑↓), dashed correlation lines, bond order calculation,
 * magnetic property indicators, and HOMO/LUMO tags.
 */
function buildNCERTMODiagram(st) {
  const molKey = (st.molecule || '').toUpperCase().replace(/[_{}]/g, '');
  
  // High-accuracy molecular orbital database for 1st & 2nd row diatomics
  const moDatabase = {
    'H2':  { name: 'H₂',  totalE: 2,  nb: 2, na: 0, bo: '1.0', mag: 'Diamagnetic', isOver14: false, s1s: '↑↓', s1s_s: '',   s2s: '',   s2s_s: '',   p2px: '',   p2py: '',   s2pz: '',   p2px_s: '', p2py_s: '', s2pz_s: '', ao1_1s: '↑',  ao1_2s: '',   ao1_2p: ['', '', ''], ao2_1s: '↑',  ao2_2s: '',   ao2_2p: ['', '', ''] },
    'HE2': { name: 'He₂', totalE: 4,  nb: 2, na: 2, bo: '0.0', mag: 'Diamagnetic (Unstable)', isOver14: false, s1s: '↑↓', s1s_s: '↑↓', s2s: '',   s2s_s: '',   p2px: '',   p2py: '',   s2pz: '',   p2px_s: '', p2py_s: '', s2pz_s: '', ao1_1s: '↑↓', ao1_2s: '',   ao1_2p: ['', '', ''], ao2_1s: '↑↓', ao2_2s: '',   ao2_2p: ['', '', ''] },
    'LI2': { name: 'Li₂', totalE: 6,  nb: 4, na: 2, bo: '1.0', mag: 'Diamagnetic', isOver14: false, s1s: '↑↓', s1s_s: '↑↓', s2s: '↑↓', s2s_s: '',   p2px: '',   p2py: '',   s2pz: '',   p2px_s: '', p2py_s: '', s2pz_s: '', ao1_1s: '↑↓', ao1_2s: '↑',  ao1_2p: ['', '', ''], ao2_1s: '↑↓', ao2_2s: '↑',  ao2_2p: ['', '', ''] },
    'BE2': { name: 'Be₂', totalE: 8,  nb: 4, na: 4, bo: '0.0', mag: 'Diamagnetic (Unstable)', isOver14: false, s1s: '↑↓', s1s_s: '↑↓', s2s: '↑↓', s2s_s: '↑↓', p2px: '',   p2py: '',   s2pz: '',   p2px_s: '', p2py_s: '', s2pz_s: '', ao1_1s: '↑↓', ao1_2s: '↑↓', ao1_2p: ['', '', ''], ao2_1s: '↑↓', ao2_2s: '↑↓', ao2_2p: ['', '', ''] },
    'B2':  { name: 'B₂',  totalE: 10, nb: 6, na: 4, bo: '1.0', mag: 'Paramagnetic (2 unpaired e⁻)', isOver14: false, s1s: '↑↓', s1s_s: '↑↓', s2s: '↑↓', s2s_s: '↑↓', p2px: '↑',  p2py: '↑',  s2pz: '',   p2px_s: '', p2py_s: '', s2pz_s: '', ao1_1s: '↑↓', ao1_2s: '↑↓', ao1_2p: ['↑', '', ''], ao2_1s: '↑↓', ao2_2s: '↑↓', ao2_2p: ['↑', '', ''] },
    'C2':  { name: 'C₂',  totalE: 12, nb: 8, na: 4, bo: '2.0', mag: 'Diamagnetic (Contains only π-bonds)', isOver14: false, s1s: '↑↓', s1s_s: '↑↓', s2s: '↑↓', s2s_s: '↑↓', p2px: '↑↓', p2py: '↑↓', s2pz: '',   p2px_s: '', p2py_s: '', s2pz_s: '', ao1_1s: '↑↓', ao1_2s: '↑↓', ao1_2p: ['↑', '↑', ''], ao2_1s: '↑↓', ao2_2s: '↑↓', ao2_2p: ['↑', '↑', ''] },
    'N2':  { name: 'N₂',  totalE: 14, nb: 10, na: 4, bo: '3.0', mag: 'Diamagnetic (1 σ + 2 π bonds)', isOver14: false, s1s: '↑↓', s1s_s: '↑↓', s2s: '↑↓', s2s_s: '↑↓', p2px: '↑↓', p2py: '↑↓', s2pz: '↑↓', p2px_s: '', p2py_s: '', s2pz_s: '', ao1_1s: '↑↓', ao1_2s: '↑↓', ao1_2p: ['↑', '↑', '↑'], ao2_1s: '↑↓', ao2_2s: '↑↓', ao2_2p: ['↑', '↑', '↑'] },
    'O2':  { name: 'O₂',  totalE: 16, nb: 10, na: 6, bo: '2.0', mag: 'Paramagnetic (2 unpaired e⁻ in π*)', isOver14: true,  s1s: '↑↓', s1s_s: '↑↓', s2s: '↑↓', s2s_s: '↑↓', s2pz: '↑↓', p2px: '↑↓', p2py: '↑↓', p2px_s: '↑', p2py_s: '↑', s2pz_s: '', ao1_1s: '↑↓', ao1_2s: '↑↓', ao1_2p: ['↑↓', '↑', '↑'], ao2_1s: '↑↓', ao2_2s: '↑↓', ao2_2p: ['↑↓', '↑', '↑'] },
    'F2':  { name: 'F₂',  totalE: 18, nb: 10, na: 8, bo: '1.0', mag: 'Diamagnetic (Single F–F bond)', isOver14: true,  s1s: '↑↓', s1s_s: '↑↓', s2s: '↑↓', s2s_s: '↑↓', s2pz: '↑↓', p2px: '↑↓', p2py: '↑↓', p2px_s: '↑↓', p2py_s: '↑↓', s2pz_s: '', ao1_1s: '↑↓', ao1_2s: '↑↓', ao1_2p: ['↑↓', '↑↓', '↑'], ao2_1s: '↑↓', ao2_2s: '↑↓', ao2_2p: ['↑↓', '↑↓', '↑'] },
    'CO':  { name: 'CO',  totalE: 14, nb: 10, na: 4, bo: '3.0', mag: 'Diamagnetic', isOver14: false, s1s: '↑↓', s1s_s: '↑↓', s2s: '↑↓', s2s_s: '↑↓', p2px: '↑↓', p2py: '↑↓', s2pz: '↑↓', p2px_s: '', p2py_s: '', s2pz_s: '', ao1_1s: '↑↓', ao1_2s: '↑↓', ao1_2p: ['↑', '↑', ''], ao2_1s: '↑↓', ao2_2s: '↑↓', ao2_2p: ['↑↓', '↑', '↑'] },
    'NO':  { name: 'NO',  totalE: 15, nb: 10, na: 5, bo: '2.5', mag: 'Paramagnetic (1 unpaired e⁻ in π*)', isOver14: true,  s1s: '↑↓', s1s_s: '↑↓', s2s: '↑↓', s2s_s: '↑↓', s2pz: '↑↓', p2px: '↑↓', p2py: '↑↓', p2px_s: '↑', p2py_s: '', s2pz_s: '', ao1_1s: '↑↓', ao1_2s: '↑↓', ao1_2p: ['↑', '↑', '↑'], ao2_1s: '↑↓', ao2_2s: '↑↓', ao2_2p: ['↑↓', '↑', '↑'] }
  };

  const data = moDatabase[molKey] || moDatabase['O2'];
  const isOver14 = data.isOver14;
  const isParamagnetic = data.mag.toLowerCase().includes('paramagnetic');

  // SVG dimensions
  const W = 620;
  const H = 450;

  // Box positions
  // Left AO center X = 95, Center MO center X = 310, Right AO center X = 525
  const lx = 95;
  const cx = 310;
  const rx = 525;

  // Y levels for 2p, 2s
  const y_2p_AO = 135;
  const y_s2pz_star = 50;
  const y_p2p_star = 95;
  const y_upper_center = isOver14 ? 175 : 140; // in O2, pi is above sigma; in N2, sigma is above pi
  const y_lower_center = isOver14 ? 140 : 175; // in O2, sigma is below pi; in N2, pi is below sigma
  const y_2s_AO = 310;
  const y_s2s_star = 265;
  const y_s2s = 355;

  // Labels for upper/lower center
  const label_upper = isOver14 ? 'π 2pₓ  π 2p_y' : 'σ 2p_z';
  const label_lower = isOver14 ? 'σ 2p_z' : 'π 2pₓ  π 2p_y';
  const fill_upper = isOver14 ? `${data.p2px || ' '}  ${data.p2py || ' '}` : (data.s2pz || ' ');
  const fill_lower = isOver14 ? (data.s2pz || ' ') : `${data.p2px || ' '}  ${data.p2py || ' '}`;

  return `
    <div class="structure-diagram-box ncert-mo-card">
      <div class="mo-diagram-header">
        <div class="mo-title-group">
          <span class="structure-diagram-label">⚛️ NCERT Molecular Orbital Energy Level Diagram (${data.name})</span>
          <span class="mo-badge-electrons">${data.totalE} Total Electrons</span>
        </div>
        <span class="mo-note-badge ${isOver14 ? 'mo-note--over14' : 'mo-note--under14'}">
          ${isOver14 ? '⚡ > 14e⁻: σ 2p_z is lower than π 2p' : '⚡ ≤ 14e⁻: π 2p is lower than σ 2p_z (sp-mixing)'}
        </span>
      </div>

      <!-- SVG 3-Column Diagram -->
      <div class="ncert-mo-canvas-wrap">
        <svg viewBox="0 0 ${W} ${H}" class="ncert-mo-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="moAxisGrad" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.2"/>
              <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.9"/>
            </linearGradient>
            <filter id="boxGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2" result="blur"/>
              <feComposite in="SourceGraphic" in2="blur" operator="over"/>
            </filter>
          </defs>

          <!-- Column Titles -->
          <text x="${lx}" y="24" fill="#94a3b8" font-size="12" font-weight="700" text-anchor="middle">Atom A Orbitals</text>
          <text x="${cx}" y="24" fill="#38bdf8" font-size="13" font-weight="700" text-anchor="middle">${data.name} Molecular Orbitals</text>
          <text x="${rx}" y="24" fill="#94a3b8" font-size="12" font-weight="700" text-anchor="middle">Atom B Orbitals</text>

          <!-- Energy Axis -->
          <line x1="22" y1="390" x2="22" y2="40" stroke="url(#moAxisGrad)" stroke-width="2.5"/>
          <polygon points="22,32 17,44 27,44" fill="#38bdf8"/>
          <text x="22" y="24" fill="#38bdf8" font-size="11" font-weight="800" text-anchor="middle">↑ Energy</text>

          <!-- Dashed Correlation Lines -->
          <!-- 2p connections -->
          <line x1="${lx + 35}" y1="${y_2p_AO}" x2="${cx - 25}" y2="${y_s2pz_star}" stroke="#64748b" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>
          <line x1="${rx - 35}" y1="${y_2p_AO}" x2="${cx + 25}" y2="${y_s2pz_star}" stroke="#64748b" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>
          <line x1="${lx + 35}" y1="${y_2p_AO}" x2="${cx - 40}" y2="${y_p2p_star}" stroke="#64748b" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>
          <line x1="${rx - 35}" y1="${y_2p_AO}" x2="${cx + 40}" y2="${y_p2p_star}" stroke="#64748b" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>
          <line x1="${lx + 35}" y1="${y_2p_AO}" x2="${cx - 40}" y2="${y_upper_center}" stroke="#64748b" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>
          <line x1="${rx - 35}" y1="${y_2p_AO}" x2="${cx + 40}" y2="${y_upper_center}" stroke="#64748b" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>
          <line x1="${lx + 35}" y1="${y_2p_AO}" x2="${cx - 25}" y2="${y_lower_center}" stroke="#64748b" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>
          <line x1="${rx - 35}" y1="${y_2p_AO}" x2="${cx + 25}" y2="${y_lower_center}" stroke="#64748b" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>

          <!-- 2s connections -->
          <line x1="${lx + 20}" y1="${y_2s_AO}" x2="${cx - 25}" y2="${y_s2s_star}" stroke="#64748b" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>
          <line x1="${rx - 20}" y1="${y_2s_AO}" x2="${cx + 25}" y2="${y_s2s_star}" stroke="#64748b" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>
          <line x1="${lx + 20}" y1="${y_2s_AO}" x2="${cx - 25}" y2="${y_s2s}" stroke="#64748b" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>
          <line x1="${rx - 20}" y1="${y_2s_AO}" x2="${cx + 25}" y2="${y_s2s}" stroke="#64748b" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>

          <!-- ── ATOMIC ORBITALS (LEFT: ATOM A) ── -->
          <!-- 2p (3 boxes) -->
          <g class="ao-group">
            <rect x="${lx - 36}" y="${y_2p_AO - 12}" width="24" height="24" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1.5"/>
            <text x="${lx - 24}" y="${y_2p_AO + 5}" fill="#f8fafc" font-size="12" font-weight="bold" text-anchor="middle">${data.ao1_2p[0] || ''}</text>
            <rect x="${lx - 12}" y="${y_2p_AO - 12}" width="24" height="24" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1.5"/>
            <text x="${lx}" y="${y_2p_AO + 5}" fill="#f8fafc" font-size="12" font-weight="bold" text-anchor="middle">${data.ao1_2p[1] || ''}</text>
            <rect x="${lx + 12}" y="${y_2p_AO - 12}" width="24" height="24" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1.5"/>
            <text x="${lx + 24}" y="${y_2p_AO + 5}" fill="#f8fafc" font-size="12" font-weight="bold" text-anchor="middle">${data.ao1_2p[2] || ''}</text>
            <text x="${lx}" y="${y_2p_AO + 26}" fill="#94a3b8" font-size="11" text-anchor="middle">2p</text>
          </g>

          <!-- 2s (1 box) -->
          <g class="ao-group">
            <rect x="${lx - 14}" y="${y_2s_AO - 12}" width="28" height="24" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1.5"/>
            <text x="${lx}" y="${y_2s_AO + 5}" fill="#f8fafc" font-size="12" font-weight="bold" text-anchor="middle">${data.ao1_2s || ''}</text>
            <text x="${lx}" y="${y_2s_AO + 26}" fill="#94a3b8" font-size="11" text-anchor="middle">2s</text>
          </g>

          <!-- ── ATOMIC ORBITALS (RIGHT: ATOM B) ── -->
          <!-- 2p (3 boxes) -->
          <g class="ao-group">
            <rect x="${rx - 36}" y="${y_2p_AO - 12}" width="24" height="24" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1.5"/>
            <text x="${rx - 24}" y="${y_2p_AO + 5}" fill="#f8fafc" font-size="12" font-weight="bold" text-anchor="middle">${data.ao2_2p[0] || ''}</text>
            <rect x="${rx - 12}" y="${y_2p_AO - 12}" width="24" height="24" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1.5"/>
            <text x="${rx}" y="${y_2p_AO + 5}" fill="#f8fafc" font-size="12" font-weight="bold" text-anchor="middle">${data.ao2_2p[1] || ''}</text>
            <rect x="${rx + 12}" y="${y_2p_AO - 12}" width="24" height="24" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1.5"/>
            <text x="${rx + 24}" y="${y_2p_AO + 5}" fill="#f8fafc" font-size="12" font-weight="bold" text-anchor="middle">${data.ao2_2p[2] || ''}</text>
            <text x="${rx}" y="${y_2p_AO + 26}" fill="#94a3b8" font-size="11" text-anchor="middle">2p</text>
          </g>

          <!-- 2s (1 box) -->
          <g class="ao-group">
            <rect x="${rx - 14}" y="${y_2s_AO - 12}" width="28" height="24" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1.5"/>
            <text x="${rx}" y="${y_2s_AO + 5}" fill="#f8fafc" font-size="12" font-weight="bold" text-anchor="middle">${data.ao2_2s || ''}</text>
            <text x="${rx}" y="${y_2s_AO + 26}" fill="#94a3b8" font-size="11" text-anchor="middle">2s</text>
          </g>

          <!-- ── CENTER MOLECULAR ORBITALS ── -->
          <!-- 1. σ* 2p_z (Level 8 - Top) -->
          <g class="mo-box mo-box--antibond">
            <rect x="${cx - 18}" y="${y_s2pz_star - 12}" width="36" height="24" rx="4" fill="rgba(248, 113, 113, 0.15)" stroke="#f87171" stroke-width="2"/>
            <text x="${cx}" y="${y_s2pz_star + 5}" fill="#fca5a5" font-size="12" font-weight="bold" text-anchor="middle">${data.s2pz_s || ''}</text>
            <text x="${cx + 32}" y="${y_s2pz_star + 4}" fill="#f87171" font-size="11" font-weight="600">σ* 2p_z</text>
          </g>

          <!-- 2. π* 2p_x, π* 2p_y (Level 7 - Degenerate Antibonding) -->
          <g class="mo-box mo-box--antibond">
            <rect x="${cx - 36}" y="${y_p2p_star - 12}" width="32" height="24" rx="4" fill="rgba(248, 113, 113, 0.15)" stroke="#f87171" stroke-width="2"/>
            <text x="${cx - 20}" y="${y_p2p_star + 5}" fill="#fca5a5" font-size="12" font-weight="bold" text-anchor="middle">${data.p2px_s || ''}</text>
            <rect x="${cx + 4}" y="${y_p2p_star - 12}" width="32" height="24" rx="4" fill="rgba(248, 113, 113, 0.15)" stroke="#f87171" stroke-width="2"/>
            <text x="${cx + 20}" y="${y_p2p_star + 5}" fill="#fca5a5" font-size="12" font-weight="bold" text-anchor="middle">${data.p2py_s || ''}</text>
            <text x="${cx + 48}" y="${y_p2p_star + 4}" fill="#f87171" font-size="11" font-weight="600">π* 2p_x, π* 2p_y</text>
          </g>

          <!-- 3. Upper Center (Level 6) -->
          <g class="mo-box ${isOver14 ? 'mo-box--bond' : 'mo-box--bond'}">
            ${isOver14
              ? `<rect x="${cx - 36}" y="${y_upper_center - 12}" width="32" height="24" rx="4" fill="rgba(56, 189, 248, 0.15)" stroke="#38bdf8" stroke-width="2"/>
                 <text x="${cx - 20}" y="${y_upper_center + 5}" fill="#38bdf8" font-size="12" font-weight="bold" text-anchor="middle">${data.p2px || ''}</text>
                 <rect x="${cx + 4}" y="${y_upper_center - 12}" width="32" height="24" rx="4" fill="rgba(56, 189, 248, 0.15)" stroke="#38bdf8" stroke-width="2"/>
                 <text x="${cx + 20}" y="${y_upper_center + 5}" fill="#38bdf8" font-size="12" font-weight="bold" text-anchor="middle">${data.p2py || ''}</text>
                 <text x="${cx + 48}" y="${y_upper_center + 4}" fill="#38bdf8" font-size="11" font-weight="600">π 2p_x, π 2p_y</text>`
              : `<rect x="${cx - 18}" y="${y_upper_center - 12}" width="36" height="24" rx="4" fill="rgba(56, 189, 248, 0.15)" stroke="#38bdf8" stroke-width="2"/>
                 <text x="${cx}" y="${y_upper_center + 5}" fill="#38bdf8" font-size="12" font-weight="bold" text-anchor="middle">${data.s2pz || ''}</text>
                 <text x="${cx + 32}" y="${y_upper_center + 4}" fill="#38bdf8" font-size="11" font-weight="600">σ 2p_z</text>`
            }
          </g>

          <!-- 4. Lower Center (Level 5) -->
          <g class="mo-box mo-box--bond">
            ${isOver14
              ? `<rect x="${cx - 18}" y="${y_lower_center - 12}" width="36" height="24" rx="4" fill="rgba(56, 189, 248, 0.15)" stroke="#38bdf8" stroke-width="2"/>
                 <text x="${cx}" y="${y_lower_center + 5}" fill="#38bdf8" font-size="12" font-weight="bold" text-anchor="middle">${data.s2pz || ''}</text>
                 <text x="${cx + 32}" y="${y_lower_center + 4}" fill="#38bdf8" font-size="11" font-weight="600">σ 2p_z</text>`
              : `<rect x="${cx - 36}" y="${y_lower_center - 12}" width="32" height="24" rx="4" fill="rgba(56, 189, 248, 0.15)" stroke="#38bdf8" stroke-width="2"/>
                 <text x="${cx - 20}" y="${y_lower_center + 5}" fill="#38bdf8" font-size="12" font-weight="bold" text-anchor="middle">${data.p2px || ''}</text>
                 <rect x="${cx + 4}" y="${y_lower_center - 12}" width="32" height="24" rx="4" fill="rgba(56, 189, 248, 0.15)" stroke="#38bdf8" stroke-width="2"/>
                 <text x="${cx + 20}" y="${y_lower_center + 5}" fill="#38bdf8" font-size="12" font-weight="bold" text-anchor="middle">${data.p2py || ''}</text>
                 <text x="${cx + 48}" y="${y_lower_center + 4}" fill="#38bdf8" font-size="11" font-weight="600">π 2p_x, π 2p_y</text>`
            }
          </g>

          <!-- 5. σ* 2s (Level 4) -->
          <g class="mo-box mo-box--antibond">
            <rect x="${cx - 18}" y="${y_s2s_star - 12}" width="36" height="24" rx="4" fill="rgba(248, 113, 113, 0.15)" stroke="#f87171" stroke-width="2"/>
            <text x="${cx}" y="${y_s2s_star + 5}" fill="#fca5a5" font-size="12" font-weight="bold" text-anchor="middle">${data.s2s_s || ''}</text>
            <text x="${cx + 32}" y="${y_s2s_star + 4}" fill="#f87171" font-size="11" font-weight="600">σ* 2s</text>
          </g>

          <!-- 6. σ 2s (Level 3) -->
          <g class="mo-box mo-box--bond">
            <rect x="${cx - 18}" y="${y_s2s - 12}" width="36" height="24" rx="4" fill="rgba(56, 189, 248, 0.15)" stroke="#38bdf8" stroke-width="2"/>
            <text x="${cx}" y="${y_s2s + 5}" fill="#38bdf8" font-size="12" font-weight="bold" text-anchor="middle">${data.s2s || ''}</text>
            <text x="${cx + 32}" y="${y_s2s + 4}" fill="#38bdf8" font-size="11" font-weight="600">σ 2s</text>
          </g>
        </svg>
      </div>

      <!-- NCERT MO Stats Summary Card -->
      <div class="mo-stats-grid">
        <div class="mo-stat-card">
          <span class="mo-stat-label">Bond Order Calculation</span>
          <div class="mo-stat-calc">
            <span>Bond Order = <span class="mo-stat-formula">(N<sub>b</sub> - N<sub>a</sub>) / 2</span></span>
            <span class="mo-stat-val">= (${data.nb} - ${data.na}) / 2 = <strong>${data.bo}</strong></span>
          </div>
        </div>
        <div class="mo-stat-card">
          <span class="mo-stat-label">Magnetic Property</span>
          <div class="mo-mag-badge ${isParamagnetic ? 'mo-mag--paramagnetic' : 'mo-mag--diamagnetic'}">
            <span>${isParamagnetic ? '🧲 Paramagnetic' : '🛡️ Diamagnetic'}</span>
            <small>${data.mag}</small>
          </div>
        </div>
      </div>
    </div>`;
}

/**
 * ── 2. VSEPR 2D/3D VECTOR GEOMETRY ENGINE (SVG) ───────────────────
 * Renders high-precision geometric shape drawings with wedge/dash bonds,
 * lone pair orbital lobes, and exact bond angles.
 */
function buildVSEPRGeometryDiagram(st) {
  const mol = (st.molecule || '').replace(/[_{}]/g, '');
  const geom = (st.geometry || '').toLowerCase();
  const central = st.central_atom || 'A';
  const angle = st.bond_angles || '';

  // SVG dimensions
  const W = 360;
  const H = 240;
  const cx = 180;
  const cy = 120;

  let shapeSvg = '';

  if (geom.includes('linear')) {
    // Linear (180°)
    shapeSvg = `
      <line x1="${cx - 80}" y1="${cy}" x2="${cx + 80}" y2="${cy}" stroke="#94a3b8" stroke-width="3"/>
      <circle cx="${cx - 80}" cy="${cy}" r="14" fill="#38bdf8"/>
      <text x="${cx - 80}" y="${cy + 4}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">X</text>
      <circle cx="${cx + 80}" cy="${cy}" r="14" fill="#38bdf8"/>
      <text x="${cx + 80}" y="${cy + 4}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">X</text>
      <circle cx="${cx}" cy="${cy}" r="18" fill="#818cf8"/>
      <text x="${cx}" y="${cy + 5}" fill="#ffffff" font-size="12" font-weight="bold" text-anchor="middle">${central}</text>
      <!-- Angle Arc -->
      <path d="M ${cx - 30} ${cy} A 30 30 0 0 1 ${cx + 30} ${cy}" fill="none" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="2,2"/>
      <text x="${cx}" y="${cy - 35}" fill="#fbbf24" font-size="11" font-weight="bold" text-anchor="middle">180°</text>`;
  }
  else if (geom.includes('trigonal planar')) {
    // Trigonal Planar (120°)
    shapeSvg = `
      <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - 70}" stroke="#94a3b8" stroke-width="3"/>
      <line x1="${cx}" y1="${cy}" x2="${cx - 65}" y2="${cy + 40}" stroke="#94a3b8" stroke-width="3"/>
      <line x1="${cx}" y1="${cy}" x2="${cx + 65}" y2="${cy + 40}" stroke="#94a3b8" stroke-width="3"/>
      <circle cx="${cx}" cy="${cy - 70}" r="13" fill="#38bdf8"/><text x="${cx}" y="${cy - 66}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">X</text>
      <circle cx="${cx - 65}" cy="${cy + 40}" r="13" fill="#38bdf8"/><text x="${cx - 65}" y="${cy + 44}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">X</text>
      <circle cx="${cx + 65}" cy="${cy + 40}" r="13" fill="#38bdf8"/><text x="${cx + 65}" y="${cy + 44}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">X</text>
      <circle cx="${cx}" cy="${cy}" r="18" fill="#818cf8"/><text x="${cx}" y="${cy + 5}" fill="#ffffff" font-size="12" font-weight="bold" text-anchor="middle">${central}</text>
      <text x="${cx + 38}" y="${cy - 20}" fill="#fbbf24" font-size="11" font-weight="bold">120°</text>`;
  }
  else if (geom.includes('bent') || geom.includes('v-shaped')) {
    // Bent / V-Shaped (e.g. H2O, SO2) with 2 Lone Pair lobes
    shapeSvg = `
      <!-- Lone pair lobes -->
      <path d="M ${cx - 5} ${cy - 10} C ${cx - 30} ${cy - 60}, ${cx - 5} ${cy - 75}, ${cx} ${cy - 40} Z" fill="rgba(167, 139, 250, 0.25)" stroke="#a78bfa" stroke-width="1.5"/>
      <circle cx="${cx - 14}" cy="${cy - 52}" r="2" fill="#c084fc"/><circle cx="${cx - 8}" cy="${cy - 56}" r="2" fill="#c084fc"/>
      <path d="M ${cx + 5} ${cy - 10} C ${cx + 30} ${cy - 60}, ${cx + 5} ${cy - 75}, ${cx} ${cy - 40} Z" fill="rgba(167, 139, 250, 0.25)" stroke="#a78bfa" stroke-width="1.5"/>
      <circle cx="${cx + 14}" cy="${cy - 52}" r="2" fill="#c084fc"/><circle cx="${cx + 8}" cy="${cy - 56}" r="2" fill="#c084fc"/>
      <!-- Bonds -->
      <line x1="${cx}" y1="${cy}" x2="${cx - 60}" y2="${cy + 50}" stroke="#94a3b8" stroke-width="3"/>
      <line x1="${cx}" y1="${cy}" x2="${cx + 60}" y2="${cy + 50}" stroke="#94a3b8" stroke-width="3"/>
      <circle cx="${cx - 60}" cy="${cy + 50}" r="13" fill="#38bdf8"/><text x="${cx - 60}" y="${cy + 54}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">H</text>
      <circle cx="${cx + 60}" cy="${cy + 50}" r="13" fill="#38bdf8"/><text x="${cx + 60}" y="${cy + 54}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">H</text>
      <circle cx="${cx}" cy="${cy}" r="18" fill="#f87171"/><text x="${cx}" y="${cy + 5}" fill="#ffffff" font-size="12" font-weight="bold" text-anchor="middle">${central}</text>
      <text x="${cx}" y="${cy + 40}" fill="#fbbf24" font-size="11" font-weight="bold" text-anchor="middle">104.5°</text>`;
  }
  else if (geom.includes('trigonal pyramidal')) {
    // Trigonal Pyramidal (e.g. NH3) with 1 top lone pair lobe
    shapeSvg = `
      <!-- Top lone pair lobe -->
      <path d="M ${cx - 12} ${cy - 10} C ${cx - 20} ${cy - 65}, ${cx + 20} ${cy - 65}, ${cx + 12} ${cy - 10} Z" fill="rgba(167, 139, 250, 0.25)" stroke="#a78bfa" stroke-width="1.5"/>
      <circle cx="${cx - 4}" cy="${cy - 48}" r="2" fill="#c084fc"/><circle cx="${cx + 4}" cy="${cy - 48}" r="2" fill="#c084fc"/>
      <!-- In plane bond -->
      <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy + 65}" stroke="#94a3b8" stroke-width="3"/>
      <!-- Wedge bond -->
      <polygon points="${cx},${cy} ${cx - 65},${cy + 45} ${cx - 50},${cy + 55}" fill="#38bdf8"/>
      <!-- Dash bond -->
      <line x1="${cx}" y1="${cy}" x2="${cx + 60}" y2="${cy + 45}" stroke="#94a3b8" stroke-width="3" stroke-dasharray="4,4"/>
      <circle cx="${cx}" cy="${cy + 65}" r="13" fill="#38bdf8"/><text x="${cx}" y="${cy + 69}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">H</text>
      <circle cx="${cx - 60}" cy="${cy + 50}" r="13" fill="#38bdf8"/><text x="${cx - 60}" y="${cy + 54}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">H</text>
      <circle cx="${cx + 60}" cy="${cy + 45}" r="13" fill="#38bdf8"/><text x="${cx + 60}" y="${cy + 49}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">H</text>
      <circle cx="${cx}" cy="${cy}" r="18" fill="#818cf8"/><text x="${cx}" y="${cy + 5}" fill="#ffffff" font-size="12" font-weight="bold" text-anchor="middle">${central}</text>
      <text x="${cx + 35}" y="${cy + 30}" fill="#fbbf24" font-size="11" font-weight="bold">107°</text>`;
  }
  else if (geom.includes('tetrahedral')) {
    // Tetrahedral (109.5°)
    shapeSvg = `
      <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - 70}" stroke="#94a3b8" stroke-width="3"/>
      <line x1="${cx}" y1="${cy}" x2="${cx - 65}" y2="${cy + 35}" stroke="#94a3b8" stroke-width="3"/>
      <polygon points="${cx},${cy} ${cx - 25},${cy + 65} ${cx - 40},${cy + 70}" fill="#38bdf8"/>
      <line x1="${cx}" y1="${cy}" x2="${cx + 65}" y2="${cy + 45}" stroke="#94a3b8" stroke-width="3" stroke-dasharray="4,4"/>
      <circle cx="${cx}" cy="${cy - 70}" r="13" fill="#38bdf8"/><text x="${cx}" y="${cy - 66}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">X</text>
      <circle cx="${cx - 65}" cy="${cy + 35}" r="13" fill="#38bdf8"/><text x="${cx - 65}" y="${cy + 39}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">X</text>
      <circle cx="${cx - 30}" cy="${cy + 68}" r="13" fill="#38bdf8"/><text x="${cx - 30}" y="${cy + 72}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">X</text>
      <circle cx="${cx + 65}" cy="${cy + 45}" r="13" fill="#38bdf8"/><text x="${cx + 65}" y="${cy + 49}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">X</text>
      <circle cx="${cx}" cy="${cy}" r="18" fill="#818cf8"/><text x="${cx}" y="${cy + 5}" fill="#ffffff" font-size="12" font-weight="bold" text-anchor="middle">${central}</text>
      <text x="${cx + 30}" y="${cy - 20}" fill="#fbbf24" font-size="11" font-weight="bold">109.5°</text>`;
  }
  else if (geom.includes('trigonal bipyramidal')) {
    // Trigonal Bipyramidal (PCl5) with Axial vs Equatorial annotations
    shapeSvg = `
      <!-- Axial bonds (Vertical, 180°) -->
      <line x1="${cx}" y1="${cy - 80}" x2="${cx}" y2="${cy + 80}" stroke="#f87171" stroke-width="3.5"/>
      <!-- Equatorial bonds (120°) -->
      <line x1="${cx}" y1="${cy}" x2="${cx + 70}" y2="${cy}" stroke="#38bdf8" stroke-width="3"/>
      <polygon points="${cx},${cy} ${cx - 45},${cy + 45} ${cx - 55},${cy + 35}" fill="#38bdf8"/>
      <line x1="${cx}" y1="${cy}" x2="${cx - 45}" y2="${cy - 35}" stroke="#38bdf8" stroke-width="3" stroke-dasharray="4,4"/>
      <!-- Axial Ligands -->
      <circle cx="${cx}" cy="${cy - 80}" r="13" fill="#f87171"/><text x="${cx}" y="${cy - 76}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">Cl<tspan font-size="8">ax</tspan></text>
      <circle cx="${cx}" cy="${cy + 80}" r="13" fill="#f87171"/><text x="${cx}" y="${cy + 84}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">Cl<tspan font-size="8">ax</tspan></text>
      <!-- Equatorial Ligands -->
      <circle cx="${cx + 70}" cy="${cy}" r="13" fill="#38bdf8"/><text x="${cx + 70}" y="${cy + 4}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">Cl<tspan font-size="8">eq</tspan></text>
      <circle cx="${cx - 50}" cy="${cy + 40}" r="13" fill="#38bdf8"/><text x="${cx - 50}" y="${cy + 44}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">Cl<tspan font-size="8">eq</tspan></text>
      <circle cx="${cx - 45}" cy="${cy - 35}" r="13" fill="#38bdf8"/><text x="${cx - 45}" y="${cy - 31}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">Cl<tspan font-size="8">eq</tspan></text>
      <!-- Central Atom -->
      <circle cx="${cx}" cy="${cy}" r="18" fill="#f59e0b"/><text x="${cx}" y="${cy + 5}" fill="#ffffff" font-size="12" font-weight="bold" text-anchor="middle">${central}</text>
      <text x="${cx + 25}" y="${cy - 45}" fill="#f87171" font-size="10" font-weight="bold">Axial (Longer, 90°)</text>
      <text x="${cx + 35}" y="${cy + 30}" fill="#38bdf8" font-size="10" font-weight="bold">Equatorial (120°)</text>`;
  }
  else if (geom.includes('octahedral') || geom.includes('square planar')) {
    // Octahedral / Square Planar (SF6, XeF4)
    const isSquarePlanar = geom.includes('square planar');
    shapeSvg = `
      ${isSquarePlanar
        ? `<!-- Top & Bottom Lone Pair Lobes -->
           <path d="M ${cx - 10} ${cy - 10} C ${cx - 15} ${cy - 60}, ${cx + 15} ${cy - 60}, ${cx + 10} ${cy - 10} Z" fill="rgba(167, 139, 250, 0.25)" stroke="#a78bfa" stroke-width="1.5"/>
           <circle cx="${cx - 3}" cy="${cy - 45}" r="2" fill="#c084fc"/><circle cx="${cx + 3}" cy="${cy - 45}" r="2" fill="#c084fc"/>
           <path d="M ${cx - 10} ${cy + 10} C ${cx - 15} ${cy + 60}, ${cx + 15} ${cy + 60}, ${cx + 10} ${cy + 10} Z" fill="rgba(167, 139, 250, 0.25)" stroke="#a78bfa" stroke-width="1.5"/>
           <circle cx="${cx - 3}" cy="${cy + 45}" r="2" fill="#c084fc"/><circle cx="${cx + 3}" cy="${cy + 45}" r="2" fill="#c084fc"/>`
        : `<!-- Top & Bottom Axial Bonds -->
           <line x1="${cx}" y1="${cy - 75}" x2="${cx}" y2="${cy + 75}" stroke="#94a3b8" stroke-width="3"/>
           <circle cx="${cx}" cy="${cy - 75}" r="13" fill="#38bdf8"/><text x="${cx}" y="${cy - 71}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">F</text>
           <circle cx="${cx}" cy="${cy + 75}" r="13" fill="#38bdf8"/><text x="${cx}" y="${cy + 79}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">F</text>`
      }
      <!-- Equatorial square base -->
      <line x1="${cx - 65}" y1="${cy}" x2="${cx + 65}" y2="${cy}" stroke="#94a3b8" stroke-width="3"/>
      <polygon points="${cx},${cy} ${cx - 40},${cy + 35} ${cx - 50},${cy + 25}" fill="#38bdf8"/>
      <line x1="${cx}" y1="${cy}" x2="${cx + 45}" y2="${cy - 25}" stroke="#94a3b8" stroke-width="3" stroke-dasharray="4,4"/>
      <circle cx="${cx - 65}" cy="${cy}" r="13" fill="#38bdf8"/><text x="${cx - 65}" y="${cy + 4}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">F</text>
      <circle cx="${cx + 65}" cy="${cy}" r="13" fill="#38bdf8"/><text x="${cx + 65}" y="${cy + 4}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">F</text>
      <circle cx="${cx - 45}" cy="${cy + 30}" r="13" fill="#38bdf8"/><text x="${cx - 45}" y="${cy + 34}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">F</text>
      <circle cx="${cx + 45}" cy="${cy - 25}" r="13" fill="#38bdf8"/><text x="${cx + 45}" y="${cy - 21}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">F</text>
      <circle cx="${cx}" cy="${cy}" r="18" fill="#818cf8"/><text x="${cx}" y="${cy + 5}" fill="#ffffff" font-size="12" font-weight="bold" text-anchor="middle">${central}</text>
      <text x="${cx + 35}" y="${cy + 55}" fill="#fbbf24" font-size="11" font-weight="bold">90°</text>`;
  }
  else {
    // Default 3D Representation
    shapeSvg = `
      <line x1="${cx}" y1="${cy}" x2="${cx - 60}" y2="${cy - 50}" stroke="#94a3b8" stroke-width="3"/>
      <line x1="${cx}" y1="${cy}" x2="${cx + 60}" y2="${cy - 50}" stroke="#94a3b8" stroke-width="3"/>
      <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy + 60}" stroke="#94a3b8" stroke-width="3"/>
      <circle cx="${cx - 60}" cy="${cy - 50}" r="13" fill="#38bdf8"/><text x="${cx - 60}" y="${cy - 46}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">X</text>
      <circle cx="${cx + 60}" cy="${cy - 50}" r="13" fill="#38bdf8"/><text x="${cx + 60}" y="${cy - 46}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">X</text>
      <circle cx="${cx}" cy="${cy + 60}" r="13" fill="#38bdf8"/><text x="${cx}" y="${cy + 64}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">X</text>
      <circle cx="${cx}" cy="${cy}" r="18" fill="#818cf8"/><text x="${cx}" y="${cy + 5}" fill="#ffffff" font-size="12" font-weight="bold" text-anchor="middle">${central}</text>`;
  }

  return `
    <div class="structure-diagram-box vsepr-diagram-card">
      <div class="mo-diagram-header">
        <span class="structure-diagram-label">📐 3D VSEPR Vector Molecular Shape</span>
        <span class="mo-note-badge" style="color:#a78bfa;border-color:rgba(167,139,250,0.3)">
          ${escapeHtml(st.geometry || '')}
        </span>
      </div>
      <div class="vsepr-canvas-wrap">
        <svg viewBox="0 0 ${W} ${H}" class="vsepr-svg" xmlns="http://www.w3.org/2000/svg">
          <rect width="${W}" height="${H}" rx="8" fill="rgba(8, 15, 28, 0.6)"/>
          ${shapeSvg}
        </svg>
      </div>
    </div>`;
}

/**
 * ── 3. SPECIAL 12TH GRADE INORGANIC STRUCTURES ─────────────────────
 */

function buildDiboraneBananaBondSVG() {
  return `
    <div class="structure-diagram-box special-struct-card">
      <div class="mo-diagram-header">
        <span class="structure-diagram-label">🍌 Diborane (B₂H₆) — 3-Center-2-Electron (3c-2e) Banana Bonds</span>
        <span class="mo-note-badge" style="color:#fbbf24">NCERT High-Yield</span>
      </div>
      <div class="vsepr-canvas-wrap">
        <svg viewBox="0 0 420 220" class="vsepr-svg" xmlns="http://www.w3.org/2000/svg">
          <rect width="420" height="220" rx="8" fill="rgba(8, 15, 28, 0.7)"/>
          <!-- Terminal Bonds -->
          <line x1="80" y1="50" x2="140" y2="110" stroke="#38bdf8" stroke-width="3"/>
          <line x1="80" y1="170" x2="140" y2="110" stroke="#38bdf8" stroke-width="3"/>
          <line x1="340" y1="50" x2="280" y2="110" stroke="#38bdf8" stroke-width="3"/>
          <line x1="340" y1="170" x2="280" y2="110" stroke="#38bdf8" stroke-width="3"/>
          <!-- Banana Bridge Curves -->
          <path d="M 140 110 Q 210 20 280 110" fill="none" stroke="#fbbf24" stroke-width="4.5" stroke-linecap="round"/>
          <path d="M 140 110 Q 210 200 280 110" fill="none" stroke="#fbbf24" stroke-width="4.5" stroke-linecap="round"/>
          <!-- Bridge Hydrogens -->
          <circle cx="210" cy="55" r="14" fill="#fbbf24"/><text x="210" y="59" fill="#0f172a" font-size="11" font-weight="bold" text-anchor="middle">H<tspan font-size="8">br</tspan></text>
          <circle cx="210" cy="165" r="14" fill="#fbbf24"/><text x="210" y="169" fill="#0f172a" font-size="11" font-weight="bold" text-anchor="middle">H<tspan font-size="8">br</tspan></text>
          <!-- Terminal Hydrogens -->
          <circle cx="80" cy="50" r="12" fill="#38bdf8"/><text x="80" y="54" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">H<tspan font-size="7">t</tspan></text>
          <circle cx="80" cy="170" r="12" fill="#38bdf8"/><text x="80" y="174" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">H<tspan font-size="7">t</tspan></text>
          <circle cx="340" cy="50" r="12" fill="#38bdf8"/><text x="340" y="54" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">H<tspan font-size="7">t</tspan></text>
          <circle cx="340" cy="170" r="12" fill="#38bdf8"/><text x="340" y="174" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">H<tspan font-size="7">t</tspan></text>
          <!-- Boron Centers -->
          <circle cx="140" cy="110" r="18" fill="#818cf8"/><text x="140" y="115" fill="#ffffff" font-size="13" font-weight="bold" text-anchor="middle">B</text>
          <circle cx="280" cy="110" r="18" fill="#818cf8"/><text x="280" y="115" fill="#ffffff" font-size="13" font-weight="bold" text-anchor="middle">B</text>
          <!-- Annotations -->
          <text x="210" y="115" fill="#fbbf24" font-size="11" font-weight="bold" text-anchor="middle">3c–2e Banana Bond</text>
        </svg>
      </div>
    </div>`;
}

function buildCrO5ButterflySVG() {
  return `
    <div class="structure-diagram-box special-struct-card">
      <div class="mo-diagram-header">
        <span class="structure-diagram-label">🦋 Chromium Pentoxide (CrO₅) — Butterfly Structure</span>
        <span class="mo-note-badge" style="color:#38bdf8">Cr(+6) with 2 Peroxide Linkages</span>
      </div>
      <div class="vsepr-canvas-wrap">
        <svg viewBox="0 0 380 220" class="vsepr-svg" xmlns="http://www.w3.org/2000/svg">
          <rect width="380" height="220" rx="8" fill="rgba(8, 15, 28, 0.7)"/>
          <!-- Double bond to Oxo -->
          <line x1="187" y1="110" x2="187" y2="40" stroke="#f87171" stroke-width="3"/>
          <line x1="193" y1="110" x2="193" y2="40" stroke="#f87171" stroke-width="3"/>
          <circle cx="190" cy="35" r="14" fill="#f87171"/><text x="190" y="39" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">O<tspan font-size="7">(-2)</tspan></text>
          <!-- Left Wing Peroxide (O-O) -->
          <line x1="190" y1="110" x2="100" y2="70" stroke="#38bdf8" stroke-width="2.5"/>
          <line x1="190" y1="110" x2="100" y2="150" stroke="#38bdf8" stroke-width="2.5"/>
          <line x1="100" y1="70" x2="100" y2="150" stroke="#fbbf24" stroke-width="3"/>
          <circle cx="100" cy="70" r="13" fill="#38bdf8"/><text x="100" y="74" fill="#0f172a" font-size="9" font-weight="bold" text-anchor="middle">O<tspan font-size="7">(-1)</tspan></text>
          <circle cx="100" cy="150" r="13" fill="#38bdf8"/><text x="100" y="154" fill="#0f172a" font-size="9" font-weight="bold" text-anchor="middle">O<tspan font-size="7">(-1)</tspan></text>
          <!-- Right Wing Peroxide (O-O) -->
          <line x1="190" y1="110" x2="280" y2="70" stroke="#38bdf8" stroke-width="2.5"/>
          <line x1="190" y1="110" x2="280" y2="150" stroke="#38bdf8" stroke-width="2.5"/>
          <line x1="280" y1="70" x2="280" y2="150" stroke="#fbbf24" stroke-width="3"/>
          <circle cx="280" cy="70" r="13" fill="#38bdf8"/><text x="280" y="74" fill="#0f172a" font-size="9" font-weight="bold" text-anchor="middle">O<tspan font-size="7">(-1)</tspan></text>
          <circle cx="280" cy="150" r="13" fill="#38bdf8"/><text x="280" y="154" fill="#0f172a" font-size="9" font-weight="bold" text-anchor="middle">O<tspan font-size="7">(-1)</tspan></text>
          <!-- Central Cr(+6) -->
          <circle cx="190" cy="110" r="20" fill="#a855f7"/><text x="190" y="115" fill="#ffffff" font-size="12" font-weight="bold" text-anchor="middle">Cr<tspan font-size="8">+6</tspan></text>
          <text x="190" y="200" fill="#fbbf24" font-size="11" font-weight="bold" text-anchor="middle">2 Peroxide Rings (O–O) + 1 Oxo (=O)</text>
        </svg>
      </div>
    </div>`;
}

function buildOzoneResonanceSVG() {
  return `
    <div class="structure-diagram-box special-struct-card">
      <div class="mo-diagram-header">
        <span class="structure-diagram-label">⚡ Ozone (O₃) — Resonance & Formal Charges</span>
        <span class="mo-note-badge" style="color:#a78bfa">Formal Charge: +1 (Center), -1 (Single), 0 (Double)</span>
      </div>
      <div class="vsepr-canvas-wrap">
        <svg viewBox="0 0 460 180" class="vsepr-svg" xmlns="http://www.w3.org/2000/svg">
          <rect width="460" height="180" rx="8" fill="rgba(8, 15, 28, 0.7)"/>
          <!-- Canonical Form 1 (Left) -->
          <g transform="translate(40, 20)">
            <line x1="60" y1="40" x2="20" y2="100" stroke="#f87171" stroke-width="2.5"/>
            <line x1="63" y1="40" x2="103" y2="100" stroke="#38bdf8" stroke-width="2"/>
            <line x1="57" y1="40" x2="97" y2="100" stroke="#38bdf8" stroke-width="2"/>
            <circle cx="60" cy="40" r="16" fill="#818cf8"/><text x="60" y="44" fill="#ffffff" font-size="11" font-weight="bold" text-anchor="middle">O<tspan font-size="8" fill="#fbbf24">⁺¹</tspan></text>
            <circle cx="20" cy="100" r="14" fill="#f87171"/><text x="20" y="104" fill="#ffffff" font-size="10" font-weight="bold" text-anchor="middle">O<tspan font-size="8" fill="#fbbf24">⁻¹</tspan></text>
            <circle cx="100" cy="100" r="14" fill="#38bdf8"/><text x="100" y="104" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">O<tspan font-size="8">⁰</tspan></text>
          </g>
          <!-- Double-headed arrow -->
          <text x="230" y="95" fill="#fbbf24" font-size="22" font-weight="bold" text-anchor="middle">⟷</text>
          <!-- Canonical Form 2 (Right) -->
          <g transform="translate(260, 20)">
            <line x1="63" y1="40" x2="23" y2="100" stroke="#38bdf8" stroke-width="2"/>
            <line x1="57" y1="40" x2="17" y2="100" stroke="#38bdf8" stroke-width="2"/>
            <line x1="60" y1="40" x2="100" y2="100" stroke="#f87171" stroke-width="2.5"/>
            <circle cx="60" cy="40" r="16" fill="#818cf8"/><text x="60" y="44" fill="#ffffff" font-size="11" font-weight="bold" text-anchor="middle">O<tspan font-size="8" fill="#fbbf24">⁺¹</tspan></text>
            <circle cx="20" cy="100" r="14" fill="#38bdf8"/><text x="20" y="104" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">O<tspan font-size="8">⁰</tspan></text>
            <circle cx="100" cy="100" r="14" fill="#f87171"/><text x="100" y="104" fill="#ffffff" font-size="10" font-weight="bold" text-anchor="middle">O<tspan font-size="8" fill="#fbbf24">⁻¹</tspan></text>
          </g>
          <text x="230" y="160" fill="#94a3b8" font-size="11" text-anchor="middle">Resonance Hybrid: Bond order = 1.5, Bond length = 128 pm (Equal)</text>
        </svg>
      </div>
    </div>`;
}

function buildMarshallsAcidSVG() {
  return `
    <div class="structure-diagram-box special-struct-card">
      <div class="mo-diagram-header">
        <span class="structure-diagram-label">🧪 Marshall's Acid (H₂S₂O₈) — Peroxodisulfuric Acid</span>
        <span class="mo-note-badge" style="color:#fbbf24">Peroxide (–O–O–) Bridge</span>
      </div>
      <div class="vsepr-canvas-wrap">
        <svg viewBox="0 0 440 180" class="vsepr-svg" xmlns="http://www.w3.org/2000/svg">
          <rect width="440" height="180" rx="8" fill="rgba(8, 15, 28, 0.7)"/>
          <!-- Center Peroxy Linkage -->
          <line x1="190" y1="90" x2="250" y2="90" stroke="#fbbf24" stroke-width="3.5"/>
          <line x1="130" y1="90" x2="190" y2="90" stroke="#38bdf8" stroke-width="2.5"/>
          <line x1="250" y1="90" x2="310" y2="90" stroke="#38bdf8" stroke-width="2.5"/>
          <!-- Left S(=O)2(OH) -->
          <line x1="130" y1="90" x2="130" y2="40" stroke="#f87171" stroke-width="3"/>
          <line x1="130" y1="90" x2="130" y2="140" stroke="#f87171" stroke-width="3"/>
          <line x1="130" y1="90" x2="70" y2="90" stroke="#38bdf8" stroke-width="2.5"/>
          <circle cx="70" cy="90" r="12" fill="#38bdf8"/><text x="70" y="94" fill="#0f172a" font-size="9" font-weight="bold" text-anchor="middle">OH</text>
          <circle cx="130" cy="40" r="12" fill="#f87171"/><text x="130" y="44" fill="#0f172a" font-size="9" font-weight="bold" text-anchor="middle">O</text>
          <circle cx="130" cy="140" r="12" fill="#f87171"/><text x="130" y="144" fill="#0f172a" font-size="9" font-weight="bold" text-anchor="middle">O</text>
          <circle cx="130" cy="90" r="16" fill="#f59e0b"/><text x="130" y="95" fill="#ffffff" font-size="11" font-weight="bold" text-anchor="middle">S</text>
          <!-- Peroxy Oxygens -->
          <circle cx="190" cy="90" r="13" fill="#fbbf24"/><text x="190" y="94" fill="#0f172a" font-size="9" font-weight="bold" text-anchor="middle">O</text>
          <circle cx="250" cy="90" r="13" fill="#fbbf24"/><text x="250" y="94" fill="#0f172a" font-size="9" font-weight="bold" text-anchor="middle">O</text>
          <!-- Right S(=O)2(OH) -->
          <line x1="310" y1="90" x2="310" y2="40" stroke="#f87171" stroke-width="3"/>
          <line x1="310" y1="90" x2="310" y2="140" stroke="#f87171" stroke-width="3"/>
          <line x1="310" y1="90" x2="370" y2="90" stroke="#38bdf8" stroke-width="2.5"/>
          <circle cx="310" cy="90" r="16" fill="#f59e0b"/><text x="310" y="95" fill="#ffffff" font-size="11" font-weight="bold" text-anchor="middle">S</text>
          <circle cx="310" cy="40" r="12" fill="#f87171"/><text x="310" y="44" fill="#0f172a" font-size="9" font-weight="bold" text-anchor="middle">O</text>
          <circle cx="310" cy="140" r="12" fill="#f87171"/><text x="310" y="144" fill="#0f172a" font-size="9" font-weight="bold" text-anchor="middle">O</text>
          <circle cx="370" cy="90" r="12" fill="#38bdf8"/><text x="370" y="94" fill="#0f172a" font-size="9" font-weight="bold" text-anchor="middle">OH</text>
          <text x="220" y="165" fill="#fbbf24" font-size="11" font-weight="bold" text-anchor="middle">Peroxy Linkage: –O–O– (Oxidation state of S is +6)</text>
        </svg>
      </div>
    </div>`;
}

function buildKHF2HydrogenBondSVG() {
  return `
    <div class="structure-diagram-box special-struct-card">
      <div class="mo-diagram-header">
        <span class="structure-diagram-label">🔗 Potassium Bifluoride (KHF₂) — Strong Symmetric H-Bond</span>
        <span class="mo-note-badge" style="color:#38bdf8">Strongest Known H-Bond [F···H···F]⁻</span>
      </div>
      <div class="vsepr-canvas-wrap">
        <svg viewBox="0 0 380 140" class="vsepr-svg" xmlns="http://www.w3.org/2000/svg">
          <rect width="380" height="140" rx="8" fill="rgba(8, 15, 28, 0.7)"/>
          <circle cx="60" cy="70" r="18" fill="#818cf8"/><text x="60" y="75" fill="#ffffff" font-size="12" font-weight="bold" text-anchor="middle">K⁺</text>
          <!-- Bifluoride Complex [F...H...F]- -->
          <rect x="110" y="30" width="240" height="80" rx="8" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="4,4"/>
          <text x="340" y="48" fill="#38bdf8" font-size="12" font-weight="bold">⁻</text>
          <line x1="150" y1="70" x2="230" y2="70" stroke="#38bdf8" stroke-width="3" stroke-dasharray="5,3"/>
          <line x1="230" y1="70" x2="310" y2="70" stroke="#38bdf8" stroke-width="3" stroke-dasharray="5,3"/>
          <circle cx="150" cy="70" r="15" fill="#38bdf8"/><text x="150" y="74" fill="#0f172a" font-size="11" font-weight="bold" text-anchor="middle">F</text>
          <circle cx="230" cy="70" r="11" fill="#f8fafc"/><text x="230" y="74" fill="#0f172a" font-size="9" font-weight="bold" text-anchor="middle">H</text>
          <circle cx="310" cy="70" r="15" fill="#38bdf8"/><text x="310" y="74" fill="#0f172a" font-size="11" font-weight="bold" text-anchor="middle">F</text>
          <text x="230" y="100" fill="#fbbf24" font-size="10" font-weight="bold" text-anchor="middle">Symmetric Hydrogen Bond (113 pm each)</text>
        </svg>
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// 2D RESONANCE STRUCTURE SVG DIAGRAMS
// Clean canonical forms with ↔ arrows, formal charges, and resonance hybrids
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Helper: generates the wrapper card HTML for all resonance SVGs.
 */
function _resonanceCard(title, badgeText, svgContent, footerText) {
  return `
    <div class="structure-diagram-box special-struct-card">
      <div class="mo-diagram-header">
        <span class="structure-diagram-label">🔄 ${title}</span>
        <span class="mo-note-badge" style="color:#a78bfa">${badgeText}</span>
      </div>
      <div class="vsepr-canvas-wrap">
        ${svgContent}
      </div>
      ${footerText ? `<div style="text-align:center;margin-top:0.4rem;font-size:0.72rem;color:#94a3b8">${footerText}</div>` : ''}
    </div>`;
}

/** Helper: draw a single atom circle with label + optional formal charge */
function _atom(cx, cy, r, fill, label, charge) {
  const chargeText = charge ? `<tspan font-size="8" fill="#fbbf24">${charge}</tspan>` : '';
  const textFill = ['#38bdf8','#fbbf24','#34d399'].includes(fill) ? '#0f172a' : '#ffffff';
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>` +
    `<text x="${cx}" y="${cy + 4}" fill="${textFill}" font-size="${r > 13 ? 11 : 9}" font-weight="bold" text-anchor="middle">${label}${chargeText}</text>`;
}

/** Helper: single bond line */
function _single(x1, y1, x2, y2, color) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color || '#94a3b8'}" stroke-width="2.5"/>`;
}

/** Helper: double bond (two parallel lines) */
function _double(x1, y1, x2, y2, color) {
  const c = color || '#38bdf8';
  const dx = y2 - y1, dy = -(x2 - x1);
  const len = Math.sqrt(dx * dx + dy * dy);
  const ox = (dx / len) * 2.5, oy = (dy / len) * 2.5;
  return `<line x1="${x1 + ox}" y1="${y1 + oy}" x2="${x2 + ox}" y2="${y2 + oy}" stroke="${c}" stroke-width="2"/>` +
    `<line x1="${x1 - ox}" y1="${y1 - oy}" x2="${x2 - ox}" y2="${y2 - oy}" stroke="${c}" stroke-width="2"/>`;
}

/** Helper: dashed bond for resonance hybrid */
function _dashed(x1, y1, x2, y2, color) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color || '#a78bfa'}" stroke-width="2" stroke-dasharray="5,3"/>`;
}

/** Helper: double-headed resonance arrow ⟷ */
function _arrow(x, y) {
  return `<text x="${x}" y="${y}" fill="#fbbf24" font-size="20" font-weight="bold" text-anchor="middle">⟷</text>`;
}

/** Helper: equivalence sign ≡ */
function _equiv(x, y) {
  return `<text x="${x}" y="${y}" fill="#fbbf24" font-size="18" font-weight="bold" text-anchor="middle">≡</text>`;
}

// ── Benzene (C₆H₆) ──────────────────────────────────────────────────────────
function buildBenzeneResonanceSVG() {
  // Two Kekulé structures ↔ hybrid with delocalized circle
  const W = 520, H = 170;
  const r = 38; // hexagon radius

  function hexagon(cx, cy, rad, bonds) {
    // bonds = array of 6 booleans: true = double bond on that edge
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2;
      pts.push({ x: cx + rad * Math.cos(angle), y: cy + rad * Math.sin(angle) });
    }
    let svg = '';
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      if (bonds[i]) {
        svg += _double(pts[i].x, pts[i].y, pts[j].x, pts[j].y, '#38bdf8');
      } else {
        svg += _single(pts[i].x, pts[i].y, pts[j].x, pts[j].y, '#94a3b8');
      }
    }
    // C labels at vertices
    for (let i = 0; i < 6; i++) {
      svg += _atom(pts[i].x, pts[i].y, 8, '#334155', 'C', '');
    }
    return svg;
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" class="vsepr-svg" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" rx="8" fill="rgba(8, 15, 28, 0.7)"/>
    <!-- Kekulé I -->
    <text x="75" y="18" fill="#94a3b8" font-size="10" text-anchor="middle">Kekulé I</text>
    ${hexagon(75, 88, r, [true, false, true, false, true, false])}
    ${_arrow(160, 90)}
    <!-- Kekulé II -->
    <text x="245" y="18" fill="#94a3b8" font-size="10" text-anchor="middle">Kekulé II</text>
    ${hexagon(245, 88, r, [false, true, false, true, false, true])}
    ${_equiv(330, 90)}
    <!-- Resonance Hybrid with circle -->
    <text x="415" y="18" fill="#a78bfa" font-size="10" font-weight="600" text-anchor="middle">Hybrid</text>
    ${(() => {
      const cx = 415, cy = 88;
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 2;
        pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
      }
      let s = '';
      for (let i = 0; i < 6; i++) s += _single(pts[i].x, pts[i].y, pts[(i+1)%6].x, pts[(i+1)%6].y, '#94a3b8');
      for (let i = 0; i < 6; i++) s += _atom(pts[i].x, pts[i].y, 8, '#334155', 'C', '');
      s += `<circle cx="${cx}" cy="${cy}" r="22" fill="none" stroke="#a78bfa" stroke-width="2" stroke-dasharray="4,3"/>`;
      return s;
    })()}
    <text x="${W/2}" y="${H - 8}" fill="#94a3b8" font-size="10" text-anchor="middle">All C–C bonds equal: 139 pm (intermediate between single 154 pm and double 134 pm)</text>
  </svg>`;

  return _resonanceCard('Benzene (C₆H₆) — Resonance Structures', 'Delocalized π electrons', svg,
    'Bond Order = 1.5 per C–C bond • Planar hexagonal • sp² hybridised');
}

// ── Carbonate CO₃²⁻ ─────────────────────────────────────────────────────────
function buildCarbonateResonanceSVG() {
  const W = 520, H = 160;
  // Each canonical: C center with 2 single (O⁻) + 1 double (O)

  function carbonateForm(cx, cy, doubleIdx) {
    // 3 oxygens arranged trigonally around C
    const opos = [
      { x: cx, y: cy - 40 },        // top
      { x: cx - 36, y: cy + 24 },   // bottom-left
      { x: cx + 36, y: cy + 24 }    // bottom-right
    ];
    let s = '';
    for (let i = 0; i < 3; i++) {
      if (i === doubleIdx) {
        s += _double(cx, cy, opos[i].x, opos[i].y, '#38bdf8');
        s += _atom(opos[i].x, opos[i].y, 11, '#38bdf8', 'O', '');
      } else {
        s += _single(cx, cy, opos[i].x, opos[i].y, '#f87171');
        s += _atom(opos[i].x, opos[i].y, 11, '#f87171', 'O', '⁻');
      }
    }
    s += _atom(cx, cy, 13, '#818cf8', 'C', '');
    return s;
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" class="vsepr-svg" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" rx="8" fill="rgba(8, 15, 28, 0.7)"/>
    <text x="12" y="16" fill="#94a3b8" font-size="10">[CO₃]²⁻</text>
    ${carbonateForm(70, 82, 0)}
    ${_arrow(140, 82)}
    ${carbonateForm(210, 82, 1)}
    ${_arrow(280, 82)}
    ${carbonateForm(350, 82, 2)}
    ${_equiv(420, 82)}
    <!-- Hybrid: all dashed -->
    ${_dashed(480, 82, 480, 42)}
    ${_dashed(480, 82, 444, 106)}
    ${_dashed(480, 82, 516, 106)}
    ${_atom(480, 42, 10, '#a78bfa', 'O', '')}
    ${_atom(444, 106, 10, '#a78bfa', 'O', '')}
    ${_atom(516, 106, 10, '#a78bfa', 'O', '')}
    ${_atom(480, 82, 12, '#818cf8', 'C', '')}
    <text x="${W/2}" y="${H - 6}" fill="#94a3b8" font-size="10" text-anchor="middle">All 3 C–O bonds equal: 129 pm • Bond order = 1.33</text>
  </svg>`;

  return _resonanceCard('Carbonate Ion (CO₃²⁻) — Resonance', '3 equivalent canonical forms', svg, '');
}

// ── Nitrate NO₃⁻ ────────────────────────────────────────────────────────────
function buildNitrateResonanceSVG() {
  const W = 520, H = 160;

  function nitrateForm(cx, cy, doubleIdx) {
    const opos = [
      { x: cx, y: cy - 40 },
      { x: cx - 36, y: cy + 24 },
      { x: cx + 36, y: cy + 24 }
    ];
    let s = '';
    for (let i = 0; i < 3; i++) {
      if (i === doubleIdx) {
        s += _double(cx, cy, opos[i].x, opos[i].y, '#38bdf8');
        s += _atom(opos[i].x, opos[i].y, 11, '#38bdf8', 'O', '');
      } else {
        s += _single(cx, cy, opos[i].x, opos[i].y, '#f87171');
        s += _atom(opos[i].x, opos[i].y, 11, '#f87171', 'O', '⁻');
      }
    }
    s += _atom(cx, cy, 13, '#34d399', 'N', '⁺');
    return s;
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" class="vsepr-svg" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" rx="8" fill="rgba(8, 15, 28, 0.7)"/>
    <text x="12" y="16" fill="#94a3b8" font-size="10">[NO₃]⁻</text>
    ${nitrateForm(70, 82, 0)}
    ${_arrow(140, 82)}
    ${nitrateForm(210, 82, 1)}
    ${_arrow(280, 82)}
    ${nitrateForm(350, 82, 2)}
    ${_equiv(420, 82)}
    ${_dashed(480, 82, 480, 42)}
    ${_dashed(480, 82, 444, 106)}
    ${_dashed(480, 82, 516, 106)}
    ${_atom(480, 42, 10, '#a78bfa', 'O', '')}
    ${_atom(444, 106, 10, '#a78bfa', 'O', '')}
    ${_atom(516, 106, 10, '#a78bfa', 'O', '')}
    ${_atom(480, 82, 12, '#34d399', 'N', '')}
    <text x="${W/2}" y="${H - 6}" fill="#94a3b8" font-size="10" text-anchor="middle">All 3 N–O bonds equal: 124 pm • Bond order = 1.33</text>
  </svg>`;

  return _resonanceCard('Nitrate Ion (NO₃⁻) — Resonance', '3 equivalent canonical forms', svg, '');
}

// ── Sulphite SO₃²⁻ ──────────────────────────────────────────────────────────
function buildSulphiteResonanceSVG() {
  const W = 520, H = 160;

  function sulphiteForm(cx, cy, doubleIdx) {
    const opos = [
      { x: cx, y: cy - 40 },
      { x: cx - 36, y: cy + 24 },
      { x: cx + 36, y: cy + 24 }
    ];
    let s = '';
    for (let i = 0; i < 3; i++) {
      if (i === doubleIdx) {
        s += _double(cx, cy, opos[i].x, opos[i].y, '#38bdf8');
        s += _atom(opos[i].x, opos[i].y, 11, '#38bdf8', 'O', '');
      } else {
        s += _single(cx, cy, opos[i].x, opos[i].y, '#f87171');
        s += _atom(opos[i].x, opos[i].y, 11, '#f87171', 'O', '⁻');
      }
    }
    s += _atom(cx, cy, 13, '#fbbf24', 'S', '');
    return s;
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" class="vsepr-svg" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" rx="8" fill="rgba(8, 15, 28, 0.7)"/>
    <text x="12" y="16" fill="#94a3b8" font-size="10">[SO₃]²⁻</text>
    ${sulphiteForm(70, 82, 0)}
    ${_arrow(140, 82)}
    ${sulphiteForm(210, 82, 1)}
    ${_arrow(280, 82)}
    ${sulphiteForm(350, 82, 2)}
    ${_equiv(420, 82)}
    ${_dashed(480, 82, 480, 42)}
    ${_dashed(480, 82, 444, 106)}
    ${_dashed(480, 82, 516, 106)}
    ${_atom(480, 42, 10, '#a78bfa', 'O', '')}
    ${_atom(444, 106, 10, '#a78bfa', 'O', '')}
    ${_atom(516, 106, 10, '#a78bfa', 'O', '')}
    ${_atom(480, 82, 12, '#fbbf24', 'S', '')}
    <text x="${W/2}" y="${H - 6}" fill="#94a3b8" font-size="10" text-anchor="middle">All 3 S–O bonds equal • Bond order = 1.33 • Trigonal pyramidal (lone pair on S)</text>
  </svg>`;

  return _resonanceCard('Sulphite Ion (SO₃²⁻) — Resonance', '3 equivalent canonical forms', svg, '');
}

// ── SO₂ ──────────────────────────────────────────────────────────────────────
function buildSO2ResonanceSVG() {
  const W = 400, H = 140;

  const svg = `<svg viewBox="0 0 ${W} ${H}" class="vsepr-svg" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" rx="8" fill="rgba(8, 15, 28, 0.7)"/>
    <text x="12" y="16" fill="#94a3b8" font-size="10">SO₂</text>
    <!-- Form 1: S=O (left) and S-O⁻ (right), S has +1 -->
    ${_double(60, 65, 20, 105, '#38bdf8')}
    ${_single(60, 65, 100, 105, '#f87171')}
    ${_atom(20, 105, 12, '#38bdf8', 'O', '')}
    ${_atom(100, 105, 12, '#f87171', 'O', '⁻')}
    ${_atom(60, 65, 14, '#fbbf24', 'S', '⁺')}
    <!-- lone pair dots on S -->
    <text x="60" y="46" fill="#94a3b8" font-size="10" text-anchor="middle">••</text>
    ${_arrow(150, 85)}
    <!-- Form 2: S-O⁻ (left) and S=O (right), S has +1 -->
    ${_single(240, 65, 200, 105, '#f87171')}
    ${_double(240, 65, 280, 105, '#38bdf8')}
    ${_atom(200, 105, 12, '#f87171', 'O', '⁻')}
    ${_atom(280, 105, 12, '#38bdf8', 'O', '')}
    ${_atom(240, 65, 14, '#fbbf24', 'S', '⁺')}
    <text x="240" y="46" fill="#94a3b8" font-size="10" text-anchor="middle">••</text>
    ${_equiv(330, 85)}
    <!-- Hybrid -->
    ${_dashed(370, 65, 345, 105, '#a78bfa')}
    ${_dashed(370, 65, 395, 105, '#a78bfa')}
    ${_atom(345, 105, 10, '#a78bfa', 'O', '')}
    ${_atom(395, 105, 10, '#a78bfa', 'O', '')}
    ${_atom(370, 65, 12, '#fbbf24', 'S', '')}
    <text x="${W/2}" y="${H - 6}" fill="#94a3b8" font-size="10" text-anchor="middle">S–O bond order = 1.5 • Bent shape (119.5°) • sp² hybridised</text>
  </svg>`;

  return _resonanceCard('Sulfur Dioxide (SO₂) — Resonance', '2 canonical forms • Lone pair on S', svg, '');
}

// ── Nitrite NO₂⁻ ─────────────────────────────────────────────────────────────
function buildNitriteResonanceSVG() {
  const W = 400, H = 140;

  const svg = `<svg viewBox="0 0 ${W} ${H}" class="vsepr-svg" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" rx="8" fill="rgba(8, 15, 28, 0.7)"/>
    <text x="12" y="16" fill="#94a3b8" font-size="10">[NO₂]⁻</text>
    <!-- Form 1: N=O (left) and N-O⁻ (right) -->
    ${_double(60, 65, 20, 105, '#38bdf8')}
    ${_single(60, 65, 100, 105, '#f87171')}
    ${_atom(20, 105, 12, '#38bdf8', 'O', '')}
    ${_atom(100, 105, 12, '#f87171', 'O', '⁻')}
    ${_atom(60, 65, 14, '#34d399', 'N', '')}
    <text x="60" y="46" fill="#94a3b8" font-size="10" text-anchor="middle">••</text>
    ${_arrow(150, 85)}
    <!-- Form 2: N-O⁻ (left) and N=O (right) -->
    ${_single(240, 65, 200, 105, '#f87171')}
    ${_double(240, 65, 280, 105, '#38bdf8')}
    ${_atom(200, 105, 12, '#f87171', 'O', '⁻')}
    ${_atom(280, 105, 12, '#38bdf8', 'O', '')}
    ${_atom(240, 65, 14, '#34d399', 'N', '')}
    <text x="240" y="46" fill="#94a3b8" font-size="10" text-anchor="middle">••</text>
    ${_equiv(330, 85)}
    <!-- Hybrid -->
    ${_dashed(370, 65, 345, 105, '#a78bfa')}
    ${_dashed(370, 65, 395, 105, '#a78bfa')}
    ${_atom(345, 105, 10, '#a78bfa', 'O', '')}
    ${_atom(395, 105, 10, '#a78bfa', 'O', '')}
    ${_atom(370, 65, 12, '#34d399', 'N', '')}
    <text x="${W/2}" y="${H - 6}" fill="#94a3b8" font-size="10" text-anchor="middle">Both N–O bonds equal: 124 pm • Bond order = 1.5 • Bent shape</text>
  </svg>`;

  return _resonanceCard('Nitrite Ion (NO₂⁻) — Resonance', '2 equivalent canonical forms', svg, '');
}

// ── Acetate CH₃COO⁻ ─────────────────────────────────────────────────────────
function buildAcetateResonanceSVG() {
  const W = 420, H = 150;

  const svg = `<svg viewBox="0 0 ${W} ${H}" class="vsepr-svg" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" rx="8" fill="rgba(8, 15, 28, 0.7)"/>
    <text x="12" y="16" fill="#94a3b8" font-size="10">[CH₃COO]⁻</text>
    <!-- Form 1: C=O top, C-O⁻ bottom -->
    <text x="20" y="75" fill="#94a3b8" font-size="10" text-anchor="middle">CH₃</text>
    ${_single(34, 72, 65, 72, '#94a3b8')}
    ${_double(65, 72, 100, 42, '#38bdf8')}
    ${_single(65, 72, 100, 102, '#f87171')}
    ${_atom(65, 72, 12, '#818cf8', 'C', '')}
    ${_atom(100, 42, 11, '#38bdf8', 'O', '')}
    ${_atom(100, 102, 11, '#f87171', 'O', '⁻')}
    ${_arrow(155, 75)}
    <!-- Form 2: C-O⁻ top, C=O bottom -->
    <text x="190" y="75" fill="#94a3b8" font-size="10" text-anchor="middle">CH₃</text>
    ${_single(204, 72, 235, 72, '#94a3b8')}
    ${_single(235, 72, 270, 42, '#f87171')}
    ${_double(235, 72, 270, 102, '#38bdf8')}
    ${_atom(235, 72, 12, '#818cf8', 'C', '')}
    ${_atom(270, 42, 11, '#f87171', 'O', '⁻')}
    ${_atom(270, 102, 11, '#38bdf8', 'O', '')}
    ${_equiv(320, 75)}
    <!-- Hybrid -->
    <text x="340" y="75" fill="#94a3b8" font-size="10" text-anchor="middle">CH₃</text>
    ${_single(354, 72, 375, 72, '#94a3b8')}
    ${_dashed(375, 72, 405, 42, '#a78bfa')}
    ${_dashed(375, 72, 405, 102, '#a78bfa')}
    ${_atom(375, 72, 11, '#818cf8', 'C', '')}
    ${_atom(405, 42, 10, '#a78bfa', 'O', '')}
    ${_atom(405, 102, 10, '#a78bfa', 'O', '')}
    <text x="${W/2}" y="${H - 6}" fill="#94a3b8" font-size="10" text-anchor="middle">Both C–O bonds equal: 127 pm • Bond order = 1.5</text>
  </svg>`;

  return _resonanceCard('Acetate Ion (CH₃COO⁻) — Resonance', '2 equivalent canonical forms', svg, '');
}

// ── Perchlorate ClO₄⁻ ───────────────────────────────────────────────────────
function buildPerchlorateResonanceSVG() {
  const W = 480, H = 160;

  function perchlorateForm(cx, cy, doubleIdx) {
    // 4 oxygens tetrahedral (shown as 2D cross)
    const opos = [
      { x: cx, y: cy - 38 },        // top
      { x: cx - 38, y: cy },        // left
      { x: cx + 38, y: cy },        // right
      { x: cx, y: cy + 38 }          // bottom
    ];
    let s = '';
    for (let i = 0; i < 4; i++) {
      if (i === doubleIdx) {
        s += _double(cx, cy, opos[i].x, opos[i].y, '#38bdf8');
        s += _atom(opos[i].x, opos[i].y, 10, '#38bdf8', 'O', '');
      } else {
        s += _single(cx, cy, opos[i].x, opos[i].y, '#f87171');
        s += _atom(opos[i].x, opos[i].y, 10, '#f87171', 'O', '⁻');
      }
    }
    s += _atom(cx, cy, 12, '#34d399', 'Cl', '⁺');
    return s;
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" class="vsepr-svg" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" rx="8" fill="rgba(8, 15, 28, 0.7)"/>
    <text x="12" y="16" fill="#94a3b8" font-size="10">[ClO₄]⁻</text>
    ${perchlorateForm(60, 80, 0)}
    ${_arrow(118, 80)}
    ${perchlorateForm(170, 80, 1)}
    ${_arrow(228, 80)}
    ${perchlorateForm(280, 80, 2)}
    ${_arrow(338, 80)}
    ${perchlorateForm(390, 80, 3)}
    <!-- Hybrid note -->
    <text x="${W/2}" y="${H - 6}" fill="#94a3b8" font-size="10" text-anchor="middle">4 equivalent resonating structures • Cl–O bond order = 1.25 • Tetrahedral</text>
  </svg>`;

  return _resonanceCard('Perchlorate Ion (ClO₄⁻) — Resonance', '4 equivalent canonical forms', svg, '');
}

/**
 * Format the answer text:
 * - Markdown headers (###, ##, #)
 * - Full chemical reactions with arrows become standalone Reaction Box Overlays
 * - Double dollar $$...$$ and Single dollar $...$ expressions become rendered chemistry pills
 * - Bold, line breaks, page citations, and fallback subscript/superscripts
 */
function formatAnswer(text) {
  if (!text) return '';

  // 1. Process headers first (###, ##, #)
  let processed = text
    .replace(/^### (.*?)$/gm, '<h4 class="answer-h4">$1</h4>')
    .replace(/^## (.*?)$/gm, '<h3 class="answer-h3">$1</h3>')
    .replace(/^# (.*?)$/gm, '<h2 class="answer-h2">$1</h2>');

  // Regex to detect if an equation contains a reaction arrow
  const reactionArrowRegex = /→|⇌|⟶|←|->|<=>|=>|\\rightarrow|\\rightleftharpoons|\\ce/;

  // 2. Render $$...$$ equation blocks
  processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (_, eq) => {
    const raw = eq.trim();
    const isReaction = reactionArrowRegex.test(raw);
    const rendered = renderChemEquation(raw);

    if (isReaction) {
      const encodedRaw = encodeURIComponent(raw);
      return `
        <div class="reaction-box-overlay">
          <div class="reaction-box-header">
            <span class="reaction-box-badge">
              <span class="reaction-icon" aria-hidden="true">⚗️</span> Chemical Reaction
            </span>
            <button class="reaction-box-copy" title="Copy reaction" aria-label="Copy reaction" data-raw-eq="${encodedRaw}">
              <span class="copy-icon" aria-hidden="true">📋</span>
              <span class="copy-text">Copy</span>
              <span class="copy-done hidden">✓ Copied</span>
            </button>
          </div>
          <div class="reaction-box-formula">${rendered}</div>
        </div>`;
    } else {
      return `<span class="chem-equation-inline">${rendered}</span>`;
    }
  });

  // 3. Render $...$ single dollar inline math / formulas (e.g. $\sigma_g(2p)$, $\pi 2p_x$)
  processed = processed.replace(/\$([^\$\n]+?)\$/g, (_, math) => {
    const raw = math.trim();
    const rendered = renderChemEquation(raw);
    return `<span class="chem-equation-inline">${rendered}</span>`;
  });

  // 4. Sanitize any residual LaTeX commands in plain text
  processed = sanitizeLatexFromText(processed);

  // 5. Standard markdown formatting
  processed = processed
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br />')
    .replace(/\(Page (\d+)\)/g, '<span style="color:var(--clr-primary-glow);font-weight:600">(Page $1)</span>')
    .replace(/_{([^}]+)}/g, '<sub>$1</sub>')
    .replace(/\^{([^}]+)}/g, '<sup>$1</sup>');

  return processed;
}

/**
 * Copy equation text to clipboard and show visual feedback.
 */
function copyEquationToClipboard(text, btn) {
  // Convert LaTeX/mhchem markup to readable Unicode subscripts/superscripts
  const readable = text
    .replace(/\\ce\{([^}]+)\}/g, '$1')
    .replace(/_{([^}]+)}/g, (_, s) => subscriptify(s))
    .replace(/\^{([^}]+)}/g, (_, s) => superscriptify(s))
    .replace(/->/g, '→')
    .replace(/<=>/g, '⇌');

  navigator.clipboard.writeText(readable).then(() => {
    const icon = btn.querySelector('.copy-icon');
    const textSpan = btn.querySelector('.copy-text');
    const done = btn.querySelector('.copy-done');
    if (icon) icon.classList.add('hidden');
    if (textSpan) textSpan.classList.add('hidden');
    if (done) done.classList.remove('hidden');
    setTimeout(() => {
      if (icon) icon.classList.remove('hidden');
      if (textSpan) textSpan.classList.remove('hidden');
      if (done) done.classList.add('hidden');
    }, 1500);
  }).catch(() => {
    showToast('Failed to copy equation.', 'error');
  });
}

/** Convert digit chars to Unicode subscript equivalents. */
function subscriptify(s) {
  const map = { '0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉','+':'₊','-':'₋','(':'₍',')':'₎' };
  return s.split('').map(c => map[c] || c).join('');
}

/** Convert digit chars to Unicode superscript equivalents. */
function superscriptify(s) {
  const map = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','+':'⁺','-':'⁻','(':'⁽',')':'⁾' };
  return s.split('').map(c => map[c] || c).join('');
}

// ══════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════

function initKeyboardShortcuts() {
  dom.questionInput().addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!dom.askBtn().disabled) handleAsk();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });
}

function resetSession() {
  state.sessionId = null;
  state.conversation = [];
  dom.sessionCard().classList.add('hidden');
  const appendOption = document.getElementById('append-option-container');
  if (appendOption) appendOption.classList.add('hidden');
  dom.chatContainer().innerHTML = '';
  dom.chatContainer().classList.add('hidden');
  dom.emptyState().classList.remove('hidden');
  dom.questionInput().disabled = true;
  dom.askBtn().disabled = true;
  clearFiles();
  showToast('Session cleared. Start fresh by uploading new PDFs.', 'info');
}

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════

function init() {
  initDropZone();
  initKeyboardShortcuts();

  dom.uploadBtn().addEventListener('click', handleUpload);
  dom.askBtn().addEventListener('click', handleAsk);
  dom.closeDrawerBtn().addEventListener('click', closeDrawer);
  dom.drawerOverlay().addEventListener('click', closeDrawer);

  const resetBtn = document.getElementById('reset-session-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetSession);
  }

  dom.questionInput().addEventListener('input', function () {
    autoResizeTextarea(this);
  });
}

document.addEventListener('DOMContentLoaded', init);
