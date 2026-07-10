/* ============================================================
   PF CENSUS APP — Main Application Logic
   ============================================================ */

'use strict';

// ── State ─────────────────────────────────────────────────────
const state = {
  scriptUrl:           '',
  sheetName:           CONFIG.SHEET_NAME,
  columns:             { ...CONFIG.COLUMNS },
  headerRow:           CONFIG.HEADER_ROW,
  sessionLog:          [],
  sessionCount:        0,
  totalFiles:          0,
  presentCount:        0,
  missingCount:        0,
  currentResult:       null,
  isListening:         false,
  recognition:         null,
  logExpanded:         false,
  selectedFileStatus:  'ACTIVE',
  selectedCensusRound: getMonthLabel(), // Auto-set to current month
};

// Returns current month label e.g. "July 2026"
function getMonthLabel() {
  return new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  initVoiceRecognition();

  // Always update the month badge to current month
  state.selectedCensusRound = getMonthLabel();
  const badge = document.getElementById('month-badge');
  if (badge) badge.textContent = state.selectedCensusRound;

  if (!state.scriptUrl) {
    showSetupScreen();
  } else {
    showMainApp();
    loadStats();
  }
});

// ── Settings (localStorage) ───────────────────────────────────
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('pfcensus_settings') || '{}');
    state.scriptUrl  = saved.scriptUrl  || CONFIG.SCRIPT_URL  || '';
    state.sheetName  = saved.sheetName  || CONFIG.SHEET_NAME  || 'Sheet1';
    state.headerRow  = saved.headerRow  || CONFIG.HEADER_ROW  || 1;
    state.columns    = { ...CONFIG.COLUMNS, ...(saved.columns || {}) };
  } catch (e) { /* use defaults */ }
}

function saveSettings() {
  const s = {
    scriptUrl: document.getElementById('setup-url-input')?.value.trim() || state.scriptUrl,
    sheetName: document.getElementById('sheet-name-input')?.value.trim() || state.sheetName,
    headerRow: parseInt(document.getElementById('header-row-input')?.value) || state.headerRow,
    columns: {
      PF_NUMBER:     (document.getElementById('col-pf')?.value    || state.columns.PF_NUMBER).toUpperCase(),
      EMPLOYEE_NAME: (document.getElementById('col-name')?.value   || state.columns.EMPLOYEE_NAME).toUpperCase(),
      DEPARTMENT:    (document.getElementById('col-dept')?.value   || state.columns.DEPARTMENT || '').toUpperCase() || null,
      DESIGNATION:   (document.getElementById('col-desig')?.value  || state.columns.DESIGNATION || '').toUpperCase() || null,
      DATE_TIME:     (document.getElementById('col-datetime')?.value || state.columns.DATE_TIME).toUpperCase(),
      STATUS:        (document.getElementById('col-status')?.value  || state.columns.STATUS).toUpperCase(),
    },
  };
  localStorage.setItem('pfcensus_settings', JSON.stringify(s));
  state.scriptUrl = s.scriptUrl;
  state.sheetName = s.sheetName;
  state.headerRow = s.headerRow;
  state.columns   = s.columns;
  closeSettings();
  showToast('Settings saved', 'success', '✓');
  if (state.scriptUrl) {
    showMainApp();
    loadStats();
  }
}

function clearAllSettings() {
  localStorage.removeItem('pfcensus_settings');
  location.reload();
}

// ── Setup Screen ──────────────────────────────────────────────
function showSetupScreen() {
  document.getElementById('auth-overlay').classList.add('active');
  document.getElementById('main-app').classList.add('hidden');
  renderSetupOverlay();
}

function renderSetupOverlay() {
  const overlay = document.getElementById('auth-overlay');
  overlay.innerHTML = `
    <div class="overlay-content">
      <div class="app-logo">
        <span class="logo-icon">📁</span>
        <h1 class="logo-title">PF Census</h1>
        <p class="logo-subtitle">Physical File Tracker</p>
      </div>

      <div class="setup-form">
        <label for="setup-url-input">Apps Script URL</label>
        <textarea
          id="setup-url-input"
          class="setup-url-input"
          rows="3"
          placeholder="https://script.google.com/macros/s/AKfycb…/exec"
          spellcheck="false"
        ></textarea>
        <p class="setup-url-hint">
          Don't have this URL yet?
          <a href="SETUP.md" target="_blank">Follow the 5-minute setup guide →</a>
        </p>
      </div>

      <button class="btn-primary" onclick="connectScript()">
        Connect to Google Sheet
      </button>
      <p class="auth-note">Your sheet data is accessed securely via Google Apps Script</p>
    </div>
  `;
}

async function connectScript() {
  const url = document.getElementById('setup-url-input')?.value.trim();
  if (!url || !url.includes('script.google.com')) {
    showToast('Please enter a valid Apps Script URL', 'error', '⚠️');
    return;
  }

  showLoading('Connecting to your sheet…');
  const originalUrl = state.scriptUrl;
  state.scriptUrl = url; // Temporarily set to allow apiFetch to use it

  try {
    const res = await apiFetch('ping');
    // If it succeeded without throwing, we're good
    localStorage.setItem('pfcensus_settings', JSON.stringify({
      ...JSON.parse(localStorage.getItem('pfcensus_settings') || '{}'),
      scriptUrl: url
    }));
    hideLoading();
    showMainApp();
    loadStats();
    showToast('Connected successfully!', 'success', '✓');
  } catch (e) {
    state.scriptUrl = originalUrl; // Restore original on failure
    hideLoading();
    showToast('Could not connect: ' + e.message, 'error', '✕');
  }
}

// ── Show Main App ─────────────────────────────────────────────
function showMainApp() {
  document.getElementById('auth-overlay').classList.remove('active');
  document.getElementById('main-app').classList.remove('hidden');
  document.getElementById('sheet-info').textContent =
    state.sheetName + ' · ' + CONFIG.SPREADSHEET_ID.slice(0, 10) + '…';
  document.getElementById('user-initial').textContent = '👤';

  // Always ensure current month is set
  state.selectedCensusRound = getMonthLabel();
  const badge = document.getElementById('month-badge');
  if (badge) badge.textContent = state.selectedCensusRound;
}


// ── API Fetch Helper ──────────────────────────────────────────
async function apiFetch(action, params = {}) {
  if (!state.scriptUrl) throw new Error('No script URL configured');

  const url = new URL(state.scriptUrl);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const resp = await fetch(url.toString(), {
    method: 'GET',
    redirect: 'follow',
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const json = await resp.json();
  if (!json.ok) throw new Error(json.error || 'Unknown error');
  return json.data;
}

async function apiPost(action, body = {}) {
  if (!state.scriptUrl) throw new Error('No script URL configured');
  const resp = await fetch(state.scriptUrl, {
    method: 'POST',
    redirect: 'follow',
    body: JSON.stringify({ action, ...body }),
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const json = await resp.json();
  if (!json.ok) throw new Error(json.error || 'Unknown error');
  return json.data;
}

// ── Load Stats ────────────────────────────────────────────────
async function loadStats() {
  try {
    const data = await apiFetch('stats', { round: state.selectedCensusRound });
    state.totalFiles   = data.total;
    state.presentCount = data.present;
    state.missingCount = data.missing || 0;
    updateStatsUI();
  } catch (e) {
    console.error('Stats error:', e);
  }
}

function updateStatsUI() {
  const total   = state.totalFiles;
  const present = state.presentCount;
  const missing = state.missingCount || 0;
  const pct     = total > 0 ? Math.round((present / total) * 100) : 0;

  const el = (id) => document.getElementById(id);
  if (el('stat-total'))   el('stat-total').textContent   = total   || '—';
  if (el('stat-present')) el('stat-present').textContent = present;
  if (el('stat-missing')) el('stat-missing').textContent = missing;
  // fallback for old cached HTML
  if (el('stat-session')) el('stat-session').textContent = missing;
  if (el('stat-percent')) el('stat-percent').textContent = pct + '%';
  const fill = el('progress-fill');
  if (fill) fill.style.width = pct + '%';
}

async function refreshData() {
  closeUserMenu();
  showLoading('Refreshing data…');
  try {
    await loadStats();
    hideLoading();
    showToast('Data refreshed', 'success', '🔄');
  } catch (e) {
    hideLoading();
    showToast('Refresh failed', 'error', '✕');
  }
}

// ── Search PF ─────────────────────────────────────────────────
async function searchPF() {
  const raw = document.getElementById('pf-input').value.trim();
  if (!raw) {
    showToast('Enter a PF number first', 'warning', '⚠️');
    return;
  }
  await doSearch(raw);
}

async function doSearch(pfRaw) {
  const pf = normalizePF(pfRaw);
  if (!pf) {
    showToast('Invalid PF number', 'error', '✕');
    return;
  }

  showLoading('Searching for PF ' + pf + '…');
  hideResultCard();

  try {
    const data = await apiFetch('search', { pf });
    hideLoading();

    if (data.found) {
      state.currentResult = data;
      showFoundResult(data);
    } else {
      showNotFoundResult(pf);
    }
  } catch (e) {
    hideLoading();
    showToast('Search error: ' + e.message, 'error', '✕');
  }
}

function normalizePF(raw) {
  // Remove any non-alphanumeric prefix/suffix
  const cleaned = String(raw).trim().replace(/[^a-zA-Z0-9]/g, '');
  if (!cleaned) return null;
  // If purely numeric, pad to 4 digits
  if (/^\d+$/.test(cleaned)) return cleaned.padStart(CONFIG.PF_DIGITS || 4, '0');
  return cleaned.toUpperCase();
}

// ── Show Results ──────────────────────────────────────────────
function showFoundResult(data) {
  const card = document.getElementById('result-card');
  card.classList.remove('hidden');

  document.getElementById('result-not-found').classList.add('hidden');
  document.getElementById('result-success').classList.add('hidden');
  const found = document.getElementById('result-found');
  found.classList.remove('hidden');

  // Avatar letter
  const nameStr = data.name || data.pf || '?';
  document.getElementById('emp-avatar-letter').textContent = nameStr[0].toUpperCase();

  // Employee info
  document.getElementById('emp-name').textContent = data.name || '(No name)';
  document.getElementById('emp-pf').textContent   = 'PF: ' + data.pf;

  // Status badge
  const badge = document.getElementById('current-status-badge');
  if (data.isPresent) {
    badge.textContent = '✓ PRESENT';
    badge.className   = 'result-badge badge-present';
  } else {
    badge.textContent = 'ABSENT';
    badge.className   = 'result-badge badge-absent';
  }

  // Detail rows
  const statusRow = document.getElementById('status-row');
  if (data.hrStatus) {
    statusRow.classList.remove('hidden');
    document.getElementById('emp-hr-status').textContent = data.hrStatus;
  } else {
    statusRow.classList.add('hidden');
  }

  const phoneRow = document.getElementById('phone-row');
  if (data.phone) {
    phoneRow.classList.remove('hidden');
    document.getElementById('emp-phone').textContent = data.phone;
  } else {
    phoneRow.classList.add('hidden');
  }

  const lastRow = document.getElementById('last-marked-row');
  if (data.lastDateTime) {
    lastRow.classList.remove('hidden');
    document.getElementById('emp-last-marked').textContent = data.lastDateTime;
  } else {
    lastRow.classList.add('hidden');
  }

  // Pre-fill Custody and Status from database
  setFileStatus(data.fileStatus || 'ACTIVE');
  const custodySelect = document.getElementById('custody-select');
  if (custodySelect) {
    custodySelect.value = data.custody || 'REGISTRY';
  }

  // Mark button
  const markBtn = document.getElementById('mark-btn');
  if (data.isPresent) {
    markBtn.innerHTML = '<span class="mark-icon">✓</span> Already PRESENT — Re-mark?';
    markBtn.className = 'btn-mark-present already-present';
  } else {
    markBtn.innerHTML = '<span class="mark-icon">✓</span> Mark as PRESENT';
    markBtn.className = 'btn-mark-present';
  }

  // Scroll into view
  setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}

function showNotFoundResult(pf) {
  const card = document.getElementById('result-card');
  card.classList.remove('hidden');

  document.getElementById('result-found').classList.add('hidden');
  document.getElementById('result-success').classList.add('hidden');
  const notFound = document.getElementById('result-not-found');
  notFound.classList.remove('hidden');

  document.getElementById('not-found-msg').textContent =
    'PF ' + pf + ' was not found in the sheet.';

  setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}

function hideResultCard() {
  document.getElementById('result-card').classList.add('hidden');
}

function clearResult() {
  hideResultCard();
  state.currentResult = null;
}

function clearInput() {
  document.getElementById('pf-input').value = '';
  clearResult();
}

function clearForNext() {
  clearInput();
  hideResultCard();
  document.getElementById('pf-input').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Mark Present ──────────────────────────────────────────────
async function markPresent() {
  if (!state.currentResult) return;
  const pf = state.currentResult.pf;

  // Retrieve selected options from form
  const fileStatus = state.selectedFileStatus;
  const custody    = document.getElementById('custody-select')?.value || 'REGISTRY';
  const round      = state.selectedCensusRound;

  showLoading('Marking PF ' + pf + ' as PRESENT…');

  try {
    const data = await apiPost('mark', {
      pf,
      fileStatus,
      custody,
      round,
      markedBy: 'Census App'
    });
    hideLoading();

    if (data.success) {
      // Update stats
      if (!state.currentResult.isPresent) {
        state.presentCount++;
        state.sessionCount++;
      }
      state.sessionCount = state.sessionCount || 1;
      updateStatsUI();

      // Add to session log
      addToLog({
        pf:        data.pf,
        name:      data.name,
        timestamp: data.timestamp,
        custody:   data.custody,
      });

      // Show success state
      showSuccessResult(data);
    } else {
      throw new Error(data.error || 'Mark failed');
    }
  } catch (e) {
    hideLoading();
    showToast('Error: ' + e.message, 'error', '✕');
  }
}

function showSuccessResult(data) {
  document.getElementById('result-found').classList.add('hidden');
  document.getElementById('result-not-found').classList.add('hidden');
  const success = document.getElementById('result-success');
  success.classList.remove('hidden');

  const icon = document.querySelector('.result-icon-success');
  if (icon) icon.classList.add('success-pulse');

  document.getElementById('success-msg').textContent =
    (data.name || data.pf) + ' marked as PRESENT';
  document.getElementById('success-time').textContent = '🕐 ' + data.timestamp;
}

// ── Session Log ───────────────────────────────────────────────
function addToLog(entry) {
  state.sessionLog.unshift(entry);

  const count = document.getElementById('log-count');
  if (count) count.textContent = state.sessionLog.length + ' marked';

  const empty = document.getElementById('log-empty');
  const list  = document.getElementById('log-list');
  if (empty) empty.style.display = 'none';

  if (list) {
    const li = document.createElement('li');
    li.className = 'log-item';
    li.innerHTML = `
      <span class="log-pf">${escHtml(entry.pf)}</span>
      <span class="log-name">${escHtml(entry.name || '—')}</span>
      <span class="log-time">${escHtml(shortTime(entry.timestamp))}</span>
    `;
    list.prepend(li);
  }
}

function toggleLog() {
  state.logExpanded = !state.logExpanded;
  const body = document.getElementById('log-body');
  const icon = document.getElementById('log-toggle-icon');
  body.classList.toggle('expanded', state.logExpanded);
  icon.classList.toggle('open', state.logExpanded);
}

// ── Voice Recognition ─────────────────────────────────────────
function initVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Speech Recognition not supported');
    const btn = document.getElementById('voice-btn');
    if (btn) {
      btn.title = 'Voice not supported in this browser';
      btn.style.opacity = '0.4';
      btn.onclick = () => showToast('Voice recognition not supported in this browser. Use Chrome or Safari.', 'warning', '⚠️');
    }
    return;
  }

  const rec = new SpeechRecognition();
  rec.continuous    = false;
  rec.interimResults = true;
  rec.lang          = CONFIG.VOICE_LANGUAGE || 'en-US';
  rec.maxAlternatives = 3;

  rec.onstart = () => {
    state.isListening = true;
    setVoiceButtonState('listening');
    document.getElementById('transcript-display').classList.remove('hidden');
    document.getElementById('transcript-text').textContent = '…';
    document.getElementById('voice-hint').textContent = 'Listening… speak the PF number';
  };

  rec.onend = () => {
    state.isListening = false;
    setVoiceButtonState('idle');
    document.getElementById('voice-hint').textContent = 'Tap the mic and speak the PF Number';
  };

  rec.onerror = (e) => {
    state.isListening = false;
    setVoiceButtonState('idle');
    if (e.error === 'no-speech') {
      showToast('No speech detected. Try again.', 'warning', '🎤');
    } else if (e.error === 'not-allowed') {
      showToast('Microphone access denied. Please allow mic permission.', 'error', '🚫');
    } else {
      showToast('Voice error: ' + e.error, 'error', '✕');
    }
  };

  rec.onresult = (e) => {
    let interim = '';
    let final   = '';

    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t;
    }

    const display = final || interim;
    document.getElementById('transcript-text').textContent = display;

    if (final) {
      const pf = extractPFFromSpeech(final);
      if (pf) {
        document.getElementById('pf-input').value = pf;
        document.getElementById('transcript-text').textContent = display + ' → ' + pf;
        setTimeout(() => doSearch(pf), 400);
      } else {
        showToast('Could not extract PF number from: "' + final + '"', 'warning', '🎤');
      }
    }
  };

  state.recognition = rec;
}

function toggleVoice() {
  if (!state.recognition) {
    showToast('Voice recognition not available. Use Chrome or Safari.', 'warning', '⚠️');
    return;
  }
  if (state.isListening) {
    state.recognition.stop();
  } else {
    clearResult();
    state.recognition.start();
  }
}

function setVoiceButtonState(mode) {
  const btn    = document.getElementById('voice-btn');
  const label  = document.getElementById('voice-status-text');
  if (!btn) return;

  if (mode === 'listening') {
    btn.classList.add('listening');
    if (label) label.textContent = 'LISTENING…';
  } else {
    btn.classList.remove('listening');
    if (label) label.textContent = 'TAP TO SPEAK';
  }
}

// ── PF Extraction from Speech ─────────────────────────────────
function extractPFFromSpeech(transcript) {
  const text = transcript.toLowerCase().trim();

  // 1. Direct 4-digit sequence (most common)
  const directDigits = text.match(/\b(\d{4})\b/);
  if (directDigits) return directDigits[1];

  // 2. PF followed by number: "PF 4420", "PF number 4420"
  const pfPattern = text.match(/\bpf\s*(?:number\s*)?(\d{1,6})\b/i);
  if (pfPattern) return pfPattern[1].padStart(4, '0');

  // 3. Word-form digits: "four four two zero" → "4420"
  const wordMap = {
    'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
    'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9',
  };
  const words = text.split(/\s+/);
  let digitStr = '';
  for (const w of words) {
    if (wordMap[w] !== undefined) {
      digitStr += wordMap[w];
    } else if (/^\d+$/.test(w)) {
      digitStr += w;
    } else if (digitStr.length >= 3) {
      break; // stop collecting once we have enough and hit a non-digit word
    } else {
      if (digitStr.length > 0) break;
    }
  }
  if (digitStr.length >= 4) return digitStr.slice(0, 4);
  if (digitStr.length > 0)  return digitStr.padStart(4, '0');

  // 4. Any sequence of digits (fallback)
  const anyDigits = text.replace(/\s/g, '').match(/\d{1,6}/);
  if (anyDigits) return anyDigits[0].slice(0, 4).padStart(4, '0');

  return null;
}

// ── Input Keyboard Handler ────────────────────────────────────
function handleInputKey(e) {
  if (e.key === 'Enter') searchPF();
}

// ── Settings Modal ────────────────────────────────────────────
function openSettings() {
  closeUserMenu();
  const modal = document.getElementById('settings-modal');
  modal.classList.remove('hidden');

  // Pre-fill current values
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };
  setVal('col-pf',           state.columns.PF_NUMBER    || 'A');
  setVal('col-name',         state.columns.EMPLOYEE_NAME|| 'B');
  setVal('col-dept',         state.columns.DEPARTMENT   || 'C');
  setVal('col-desig',        state.columns.DESIGNATION  || 'D');
  setVal('col-datetime',     state.columns.DATE_TIME    || 'E');
  setVal('col-status',       state.columns.STATUS       || 'F');
  setVal('sheet-name-input', state.sheetName || 'Sheet1');
  setVal('header-row-input', state.headerRow || 1);
}

function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
}

// ── User Menu ─────────────────────────────────────────────────
function toggleUserMenu() {
  const menu = document.getElementById('user-menu');
  menu.classList.toggle('hidden');
}

function closeUserMenu() {
  const menu = document.getElementById('user-menu');
  if (menu) menu.classList.add('hidden');
}

// Close menu when clicking elsewhere
document.addEventListener('click', (e) => {
  const menu  = document.getElementById('user-menu');
  const badge = document.querySelector('.user-badge');
  if (menu && !menu.contains(e.target) && badge && !badge.contains(e.target)) {
    menu.classList.add('hidden');
  }
});

function handleSignOut() {
  if (confirm('Sign out and clear settings?')) {
    clearAllSettings();
  }
}

// ── Loading Overlay ───────────────────────────────────────────
function showLoading(text = 'Loading…') {
  const overlay = document.getElementById('loading-overlay');
  const label   = document.getElementById('loading-text');
  if (overlay) overlay.classList.remove('hidden');
  if (label)   label.textContent = text;
}

function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.add('hidden');
}

// ── Toast Notifications ───────────────────────────────────────
function showToast(msg, type = 'info', icon = 'ℹ️') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${escHtml(msg)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// ── Helpers ───────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shortTime(ts) {
  if (!ts) return '';
  // ts format: "09/07/2026 22:20:43"
  const parts = ts.split(' ');
  return parts[1] || ts; // just show time portion
}

// ── New Phase 2 Helpers ───────────────────────────────────────
function setFileStatus(status) {
  state.selectedFileStatus = status;
  const activeBtn = document.getElementById('status-active-btn');
  const exitBtn   = document.getElementById('status-exit-btn');
  if (activeBtn && exitBtn) {
    if (status === 'ACTIVE') {
      activeBtn.classList.add('active');
      exitBtn.classList.remove('active');
    } else {
      activeBtn.classList.remove('active');
      exitBtn.classList.add('active');
    }
  }
}


// changeCensusRound is no longer needed — round is auto-set to current month.



async function triggerAudit() {
  closeUserMenu();
  const confirmAudit = confirm(
    'Warning: This will audit all ACTIVE files in the sheet.\n' +
    'Any file that is NOT marked present in the current round (' + state.selectedCensusRound + ') ' +
    'will be flagged as MISSING. Continue?'
  );
  if (!confirmAudit) return;

  showLoading('Running missing file audit…');
  try {
    const data = await apiPost('audit', { round: state.selectedCensusRound });
    hideLoading();
    if (data.success) {
      await loadStats();
      showToast(
        'Audit complete! Flagged ' + data.flaggedCount + ' files as MISSING.',
        'warning',
        '⚠️'
      );
    } else {
      throw new Error(data.error || 'Audit failed');
    }
  } catch (e) {
    hideLoading();
    showToast('Audit failed: ' + e.message, 'error', '✕');
  }
}

