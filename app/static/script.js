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
    appendAssistantMessage(data.answer, data.sources || [], data.related_topics || [], data.equations || []);
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
  document.getElementById(id)?.remove();
}

/**
 * Render the assistant's answer with source chips, equation cards, and related topic chips.
 * @param {string} answer
 * @param {Array} sources
 * @param {Array<string>} topics
 * @param {Array<{equation:string, label:string}>} equations
 */
function appendAssistantMessage(answer, sources, topics, equations = []) {
  const isFallback = answer.toLowerCase().includes('not present in the provided chapter');

  const div = document.createElement('div');
  div.className = `message message--assistant${isFallback ? ' message--fallback' : ''}`;

  // ── Answer bubble
  const bubble = document.createElement('div');
  bubble.className = 'message__bubble';
  bubble.innerHTML = formatAnswer(answer);

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
        <p class="chips-label">⚗️ Key Reactions</p>
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

  div.appendChild(bubble);
  div.innerHTML += equationsHtml + sourcesHtml + topicsHtml;

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
 * Renders a chemistry equation string via KaTeX.
 * Only handles actual chemical formulas — no \text{} wrapping.
 * @param {string} eq - The equation string (e.g. "2H_{2} + O_{2} → 2H_{2}O")
 * @returns {string} HTML string with rendered equation
 */
function renderChemEquation(eq) {
  try {
    // Convert chemistry arrows to LaTeX commands
    let latex = eq
      .replace(/⇌/g, '\\rightleftharpoons ')
      .replace(/⟶/g, '\\longrightarrow ')
      .replace(/→/g, '\\rightarrow ')
      .replace(/←/g, '\\leftarrow ')
      .replace(/Δ/g, '\\Delta ')
      .replace(/∝/g, '\\propto ');

    // Don't wrap in \mathrm{} — it breaks \text{} and complex expressions.
    // KaTeX handles chemistry subscripts/superscripts natively.

    if (typeof katex !== 'undefined') {
      return katex.renderToString(latex, {
        throwOnError: false,
        displayMode: true,
        trust: true,
      });
    }
  } catch (e) {
    // KaTeX failed — fall back to styled HTML
  }
  return renderChemEquationFallback(eq);
}

/**
 * Fallback renderer when KaTeX is unavailable.
 * Converts _{} to <sub> and ^{} to <sup> tags.
 */
function renderChemEquationFallback(eq) {
  return escapeHtml(eq)
    .replace(/_{([^}]+)}/g, '<sub>$1</sub>')
    .replace(/\^{([^}]+)}/g, '<sup>$1</sup>')
    .replace(/→/g, '<span class="chem-arrow">→</span>')
    .replace(/⇌/g, '<span class="chem-arrow">⇌</span>')
    .replace(/⟶/g, '<span class="chem-arrow">⟶</span>');
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
    // \sigma → σ, \pi → π
    .replace(/\\sigma/g, 'σ')
    .replace(/\\pi/g, 'π')
    // Clean up any remaining backslashes before common words
    .replace(/\\([a-zA-Z]+)\{([^}]*)\}/g, '$2')
    // Remove stray backslashes
    .replace(/\\\\/g, '');
}

/**
 * Minimal markdown-like formatting for the answer text.
 * Converts **bold**, line breaks, page citations, and $$equation$$ blocks.
 * Also sanitizes any residual LaTeX commands.
 */
function formatAnswer(text) {
  // First, sanitize any LaTeX that appears OUTSIDE of $$ blocks
  // Split by $$, sanitize non-equation parts, rejoin
  const parts = text.split(/(\$\$[^$]+?\$\$)/g);
  const processed = parts.map((part, i) => {
    if (part.startsWith('$$') && part.endsWith('$$')) {
      return part; // keep equation blocks as-is
    }
    return sanitizeLatexFromText(part); // sanitize plain text parts
  }).join('');

  let html = escapeHtml(processed);

  // Render $$...$$ equation blocks via KaTeX
  html = html.replace(/\$\$([^$]+?)\$\$/g, (_, eq) => {
    // Unescape HTML entities back for KaTeX processing
    const raw = eq
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'");
    const rendered = renderChemEquation(raw.trim());
    return `<span class="chem-equation-inline">${rendered}</span>`;
  });

  // Standard formatting
  html = html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br />')
    .replace(/\(Page (\d+)\)/g, '<span style="color:var(--clr-primary-glow);font-weight:600">(Page $1)</span>');

  // Handle _{} and ^{} in plain text (outside of KaTeX rendered blocks)
  // This catches inline formulas that weren't wrapped in $$
  html = html
    .replace(/_{([^}]+)}/g, '<sub>$1</sub>')
    .replace(/\^{([^}]+)}/g, '<sup>$1</sup>');

  return html;
}

/**
 * Copy equation text to clipboard and show feedback.
 */
function copyEquationToClipboard(text, btn) {
  // Convert _{} and ^{} to Unicode subscripts/superscripts for readable clipboard
  const readable = text
    .replace(/_{([^}]+)}/g, (_, s) => subscriptify(s))
    .replace(/\^{([^}]+)}/g, (_, s) => superscriptify(s));

  navigator.clipboard.writeText(readable).then(() => {
    const icon = btn.querySelector('.copy-icon');
    const done = btn.querySelector('.copy-done');
    if (icon) icon.classList.add('hidden');
    if (done) done.classList.remove('hidden');
    setTimeout(() => {
      if (icon) icon.classList.remove('hidden');
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
