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
  const isFallback = answer.toLowerCase().includes('not present in the provided chapter');

  const div = document.createElement('div');
  div.className = `message message--assistant${isFallback ? ' message--fallback' : ''}`;

  // ── Auto-synthesize MO structure cards if not provided by LLM
  if ((!structures || structures.length === 0) && !isFallback) {
    const hasMO = /molecular orbital|mo theory|energy level diagram|energy level order|orbital mixing|homonuclear|heteronuclear/i.test(answer) ||
                  /bond order|paramagnetic|diamagnetic/i.test(answer);
    if (hasMO) {
      const moCards = [];
      if (/\bO_?2\b|oxygen/i.test(answer)) {
        moCards.push({
          molecule: 'O_{2}',
          geometry: 'Linear (MO Theory: > 14e⁻, No sp-mixing shift)',
          bond_angles: 'Bond Order = 2.0 (Paramagnetic: 2 unpaired e⁻ in π*2p)',
          central_atom: 'O-O',
          diagram_ascii: 'MO_DIAGRAM:O2'
        });
      }
      if (/\bN_?2\b|nitrogen/i.test(answer)) {
        moCards.push({
          molecule: 'N_{2}',
          geometry: 'Linear (MO Theory: ≤ 14e⁻, With sp-mixing shift)',
          bond_angles: 'Bond Order = 3.0 (Diamagnetic: 0 unpaired e⁻)',
          central_atom: 'N-N',
          diagram_ascii: 'MO_DIAGRAM:N2'
        });
      }
      if (/\bF_?2\b|fluorine/i.test(answer)) {
        moCards.push({
          molecule: 'F_{2}',
          geometry: 'Linear (MO Theory: > 14e⁻)',
          bond_angles: 'Bond Order = 1.0 (Diamagnetic)',
          central_atom: 'F-F',
          diagram_ascii: 'MO_DIAGRAM:F2'
        });
      }
      if (/\b(C_?2|B_?2|Be_?2|Li_?2|H_?2|He_?2|CO|NO)\b/i.test(answer)) {
        const mMatch = answer.match(/\b(C_?2|B_?2|Be_?2|Li_?2|H_?2|He_?2|CO|NO)\b/i);
        if (mMatch && !moCards.some(m => m.molecule.includes(mMatch[1]))) {
          moCards.push({
            molecule: mMatch[1].replace(/_?2/, '_{2}'),
            geometry: 'Linear (MO Theory)',
            bond_angles: 'Molecular Orbital Energy Configuration',
            central_atom: mMatch[1],
            diagram_ascii: `MO_DIAGRAM:${mMatch[1]}`
          });
        }
      }
      if (moCards.length > 0) {
        structures = moCards;
      }
    }
  }

  // ── Answer bubble HTML
  const bubbleHtml = `<div class="message__bubble">${formatAnswer(answer)}</div>`;

  // ── Molecular Geometry & Hybridisation Cards
  let structuresHtml = '';
  if (structures.length > 0 && !isFallback) {
    const cards = structures.map((st) => {
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

      let diagramHtml = buildStructureDiagram(st);

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

  // Normalize LaTeX expressions for orbitals, asterisks, subscripts, and arrows
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
    // 1. If contains \sigma, \pi, or comparison operators (<, >, =), render directly with KaTeX Math mode
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

    // 2. If already wrapped in \ce{...}, render directly with mhchem
    if (trimmed.startsWith('\\ce{') && trimmed.endsWith('}')) {
      try {
        return katex.renderToString(trimmed, {
          throwOnError: false,
          displayMode: true,
          trust: true,
        });
      } catch (e) { /* fallback below */ }
    }

    // 3. Try wrapping in \ce{...} for mhchem if it looks like a chemical formula/reaction
    if (!/\\sigma|\\pi|<|>/.test(trimmed)) {
      try {
        let mhchemInput = trimmed
          .replace(/\\rightarrow/g, '->')
          .replace(/\\rightleftharpoons/g, '<=>')
          .replace(/\\longrightarrow/g, '->')
          .replace(/\\leftarrow/g, '<-')
          .replace(/\\Delta/g, '\\Delta ')
          .replace(/→/g, '->')
          .replace(/⇌/g, '<=>')
          .replace(/⟶/g, '->')
          .replace(/←/g, '<-')
          .replace(/_{([0-9a-zA-Z]+)}/g, '$1')
          .replace(/\^{([0-9a-zA-Z+-]+)}/g, '^$1');

        return katex.renderToString(`\\ce{${mhchemInput}}`, {
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
        displayMode: false,
        trust: true,
      });
    } catch (e) { /* fallback to styled HTML below */ }
  }

  return renderChemEquationFallback(trimmed);
}

/**
 * Fallback renderer when KaTeX is unavailable or fails.
 * Converts LaTeX symbols (\sigma, \pi, \Delta), _{} to <sub>, and ^{} to <sup> tags.
 */
function renderChemEquationFallback(eq) {
  return escapeHtml(eq)
    .replace(/\\ce\{([^}]+)\}/g, '$1')
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
function buildStructureDiagram(st) {
  const mol = st.molecule || '';
  const ascii = st.diagram_ascii || '';

  // Check if this is an MO / orbital energy level diagram
  const isMODiagram = /MO_DIAGRAM|[σπ]\*?\s*\d[spdf]/i.test(ascii) ||
                      /sigma|pi|bonding|antibonding|energy|homonuclear/i.test(ascii) ||
                      /O_?2|N_?2|F_?2|C_?2|B_?2|Be_?2|Li_?2|H_?2|He_?2|CO|NO/i.test(mol);

  if (isMODiagram) {
    return buildMOEnergyDiagram(st);
  }

  if (ascii.trim()) {
    return `
      <div class="structure-diagram-box">
        <span class="structure-diagram-label">🧬 Lewis / 2D Spatial Structure</span>
        <pre class="structure-diagram-pre">${escapeHtml(ascii)}</pre>
      </div>`;
  }
  return '';
}

/**
 * Build a visual MO Energy Level Diagram using HTML/CSS.
 * Creates colored orbital level bars with electron fill indicators.
 */
function buildMOEnergyDiagram(st) {
  // Parse molecule to determine electron count and orbital configuration
  const molecule = (st.molecule || '').replace(/[_{}]/g, '');

  // Define standard MO levels (low energy → high energy)
  // For ≤14e- molecules (Li2, Be2, B2, C2, N2): π before σ2p due to sp-mixing
  // For >14e- molecules (O2, F2, Ne2): σ2p before π (no sp-mixing inversion)
  const isOver14 = /O[_]?2|F[_]?2|Ne[_]?2/i.test(molecule);

  const moLevelsStandard = [
    { label: 'σ 1s', type: 'bond', degenerate: false },
    { label: 'σ* 1s', type: 'antibond', degenerate: false },
    { label: 'σ 2s', type: 'bond', degenerate: false },
    { label: 'σ* 2s', type: 'antibond', degenerate: false },
    { label: 'π 2p', type: 'bond', degenerate: true, sublabels: ['π 2pₓ', 'π 2p_y'] },
    { label: 'σ 2p_z', type: 'bond', degenerate: false },
    { label: 'π* 2p', type: 'antibond', degenerate: true, sublabels: ['π* 2pₓ', 'π* 2p_y'] },
    { label: 'σ* 2p_z', type: 'antibond', degenerate: false },
  ];

  const moLevelsOver14 = [
    { label: 'σ 1s', type: 'bond', degenerate: false },
    { label: 'σ* 1s', type: 'antibond', degenerate: false },
    { label: 'σ 2s', type: 'bond', degenerate: false },
    { label: 'σ* 2s', type: 'antibond', degenerate: false },
    { label: 'σ 2p_z', type: 'bond', degenerate: false },
    { label: 'π 2p', type: 'bond', degenerate: true, sublabels: ['π 2pₓ', 'π 2p_y'] },
    { label: 'π* 2p', type: 'antibond', degenerate: true, sublabels: ['π* 2pₓ', 'π* 2p_y'] },
    { label: 'σ* 2p_z', type: 'antibond', degenerate: false },
  ];

  const levels = isOver14 ? moLevelsOver14 : moLevelsStandard;

  const rows = levels.map((level, idx) => {
    const energyPct = Math.round(((idx + 1) / levels.length) * 100);
    const typeClass = level.type === 'antibond' ? 'mo-level--antibond' : 'mo-level--bond';
    const degClass = level.degenerate ? 'mo-level--degenerate' : '';

    const labelHtml = level.degenerate
      ? `<span class="mo-sublabels">${level.sublabels.map(s => `<span>${renderChemEquationFallback(s)}</span>`).join(' ')}</span>`
      : `<span>${renderChemEquationFallback(level.label)}</span>`;

    return `
      <div class="mo-level ${typeClass} ${degClass}" style="--energy: ${energyPct}%">
        <span class="mo-level-label">${labelHtml}</span>
        <div class="mo-level-bar">
          ${level.degenerate ? '<div class="mo-bar-segment"></div><div class="mo-bar-segment"></div>' : '<div class="mo-bar-segment"></div>'}
        </div>
        <span class="mo-level-type">${level.type === 'antibond' ? 'Antibonding (*)' : 'Bonding'}</span>
      </div>`;
  }).reverse().join('');

  const mixingNote = isOver14
    ? '<span class="mo-note-badge">⚡ > 14e⁻ System: σ 2p_z is lower in energy than π 2p (no sp-mixing shift)</span>'
    : '<span class="mo-note-badge">⚡ ≤ 14e⁻ System: π 2p is lower in energy than σ 2p_z (due to sp-orbital mixing)</span>';

  return `
    <div class="structure-diagram-box mo-diagram-box">
      <div class="mo-diagram-header">
        <span class="structure-diagram-label">⚛️ Molecular Orbital Energy Level Diagram</span>
        ${mixingNote}
      </div>
      <div class="mo-diagram">
        <div class="mo-energy-axis">
          <span class="mo-axis-label-top">↑ Energy</span>
          <div class="mo-axis-line"></div>
        </div>
        <div class="mo-levels-container">
          ${rows}
        </div>
      </div>
      <div class="mo-legend">
        <span class="mo-legend-item mo-legend--bond">● Bonding</span>
        <span class="mo-legend-item mo-legend--antibond">● Antibonding (*)</span>
        <span class="mo-legend-item mo-legend--degen">═ Degenerate Pair (π_x, π_y)</span>
      </div>
    </div>`;
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
