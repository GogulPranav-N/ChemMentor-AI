/**
 * Chemistry AI Tutor — Frontend Logic
 *
 * Vanilla JS only. No external libraries.
 *
 * Responsibilities:
 *  - PDF drag-and-drop upload with progress feedback
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
  selectedFile: null,
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
  filePreview:       () => document.getElementById('file-preview'),
  fileName:          () => document.getElementById('file-name'),
  fileSize:          () => document.getElementById('file-size'),
  clearFileBtn:      () => document.getElementById('clear-file-btn'),
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
// UPLOAD — DRAG & DROP
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
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFileSelected(file);
  });

  // File input change
  input.addEventListener('change', () => {
    if (input.files?.[0]) handleFileSelected(input.files[0]);
  });

  // Clear file
  dom.clearFileBtn().addEventListener('click', clearFile);
}

function handleFileSelected(file) {
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    showToast('Please select a PDF file.', 'error');
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    showToast('File exceeds the 50 MB limit.', 'error');
    return;
  }
  state.selectedFile = file;
  dom.fileName().textContent = file.name;
  dom.fileSize().textContent = formatBytes(file.size);
  dom.filePreview().classList.remove('hidden');
  dom.dropZone().classList.add('hidden');
  dom.uploadBtn().disabled = false;
  dom.uploadBtn().removeAttribute('aria-disabled');
}

function clearFile(keepStatus = false) {
  state.selectedFile = null;
  dom.fileInput().value = '';
  dom.filePreview().classList.add('hidden');
  dom.dropZone().classList.remove('hidden');
  dom.uploadBtn().disabled = true;
  dom.uploadBtn().setAttribute('aria-disabled', 'true');
  if (!keepStatus) hideStatus();
}

// ══════════════════════════════════════════════════════
// UPLOAD — API CALL
// ══════════════════════════════════════════════════════

async function handleUpload() {
  if (!state.selectedFile || state.isUploading) return;

  state.isUploading = true;
  setStatus('loading', '<span class="spinner"></span> Uploading and indexing your document…');
  setIndicator('loading');
  dom.uploadBtn().disabled = true;

  const formData = new FormData();
  formData.append('file', state.selectedFile);

  // Send session_id if appending is checked
  const appendCheckbox = document.getElementById('append-checkbox');
  if (state.sessionId && appendCheckbox && appendCheckbox.checked) {
    formData.append('session_id', state.sessionId);
  }

  try {
    const res = await fetch('/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || 'Upload failed.');
    }

    state.sessionId = data.session_id;

    // Update session card
    dom.statFile().textContent    = data.file_name;
    dom.statPages().textContent   = data.page_count.toLocaleString();
    dom.statChunks().textContent  = data.chunk_count.toLocaleString();
    dom.statSession().textContent = data.session_id;
    dom.statSession().title       = data.session_id;
    dom.sessionCard().classList.remove('hidden');

    // Show append checkbox option now that a session is active
    const appendOption = document.getElementById('append-option-container');
    if (appendOption) appendOption.classList.remove('hidden');

    setStatus('success', `✅ ${data.message} — ${data.chunk_count} chunks indexed across ${data.page_count} pages.`);
    setIndicator('ready');
    showToast('Document indexed! You can now ask questions.', 'success');

    // Enable chat
    dom.questionInput().disabled = false;
    dom.askBtn().disabled = false;

    // Show chat, hide empty state
    dom.emptyState().classList.add('hidden');
    dom.chatContainer().classList.remove('hidden');

    // Clear file selection but keep success message status
    clearFile(true);

  } catch (err) {
    setStatus('error', `❌ ${err.message}`);
    setIndicator('error');
    showToast(err.message, 'error');
    dom.uploadBtn().disabled = false;
  } finally {
    state.isUploading = false;
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

  try {
    const res = await fetch('/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        session_id: state.sessionId,
        top_k: 5,
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
 * Render the assistant's answer with source chips and related topic chips.
 * @param {string} answer
 * @param {Array} sources
 * @param {Array<string>} topics
 */
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

  // ── Equation cards
  let equationsHtml = '';
  if (equations.length > 0 && !isFallback) {
    const cards = equations.map((eq, i) => {
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
        <p class="chips-label">⚗️ Key Equations</p>
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
      const eqText = equations[idx]?.equation || '';
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
 * Converts chemistry-style notation to LaTeX-compatible format.
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
      .replace(/Δ/g, '\\Delta ');

    // Wrap in \text{} for proper chemistry-style upright text rendering
    // But preserve _{} and ^{} as math mode
    // Use \mathrm for chemistry (upright letters)
    latex = '\\mathrm{' + latex + '}';

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

/**
 * Minimal markdown-like formatting for the answer text.
 * Converts **bold**, line breaks, page citations, and $$equation$$ blocks.
 */
function formatAnswer(text) {
  let html = escapeHtml(text);

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

  return html;
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
  clearFile();
  showToast('Session cleared. Start fresh by uploading a new PDF.', 'info');
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
