/* ============================================================
   PF CENSUS APP — Main Application Logic (Phase 4)
   ============================================================ */

'use strict';

// ── State ─────────────────────────────────────────────────────
const state = {
  scriptUrl:           CONFIG.SCRIPT_URL,
  sheetName:           CONFIG.SHEET_NAME,
  columns:             { ...CONFIG.COLUMNS },
  headerRow:           CONFIG.HEADER_ROW,
  sessionLog:          [],
  sessionCount:        0,
  totalFiles:          0,
  presentCount:        0,
  missingCount:        0,
  unmarkedCount:       0,
  currentResult:       null,
  isListening:         false,
  recognition:         null,
  logExpanded:         false,
  selectedFileStatus:  'ACTIVE',
  selectedCensusRound: getMonthLabel(),
  currentUser:         null,
  isAdmin:             false,         // true for MARGARET, SARAH, MACHARIA
  reportData:          null,
  compiledData:        null,
  activeReportTab:     'summary',
  movementHistoryLoaded:    false,
  censusTimelineLoaded:     false,
};

function getMonthLabel() {
  return new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  initVoiceRecognition();

  state.selectedCensusRound = getMonthLabel();
  const badge = document.getElementById('month-badge');
  if (badge) badge.textContent = state.selectedCensusRound;

  // Permanent URL is always in CONFIG — skip setup screen
  if (!state.currentUser) {
    showLoginScreen();
  } else {
    showMainApp();
    loadStats();
    checkMissingAlerts();
  }
});

// ── Settings ──────────────────────────────────────────────────
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('pfcensus_settings') || '{}');
    state.scriptUrl  = CONFIG.SCRIPT_URL;
    state.sheetName  = saved.sheetName  || CONFIG.SHEET_NAME  || 'Main DBase';
    state.headerRow  = saved.headerRow  || CONFIG.HEADER_ROW  || 1;
    state.columns    = { ...CONFIG.COLUMNS, ...(saved.columns || {}) };

    const savedUser = JSON.parse(localStorage.getItem('pfcensus_user') || 'null');
    state.currentUser = savedUser;
    if (savedUser) {
      state.isAdmin = savedUser.isAdmin ||
        ['MARGARET','SARAH','MACHARIA'].includes((savedUser.name || '').toUpperCase());
    }
  } catch (e) { /* use defaults */ }
}

function saveSettings() {
  const s = {
    sheetName: document.getElementById('sheet-name-input')?.value.trim() || state.sheetName,
    headerRow: parseInt(document.getElementById('header-row-input')?.value) || state.headerRow,
    columns: {
      PF_NUMBER:     (document.getElementById('col-pf')?.value     || state.columns.PF_NUMBER).toUpperCase(),
      EMPLOYEE_NAME: (document.getElementById('col-name')?.value   || state.columns.EMPLOYEE_NAME).toUpperCase(),
      DEPARTMENT:    (document.getElementById('col-dept')?.value   || '').toUpperCase() || null,
      DESIGNATION:   (document.getElementById('col-desig')?.value  || '').toUpperCase() || null,
      DATE_TIME:     (document.getElementById('col-datetime')?.value || state.columns.DATE_TIME).toUpperCase(),
      STATUS:        (document.getElementById('col-status')?.value  || state.columns.STATUS).toUpperCase(),
    },
  };
  localStorage.setItem('pfcensus_settings', JSON.stringify(s));
  state.sheetName = s.sheetName;
  state.headerRow = s.headerRow;
  state.columns   = s.columns;
  closeSettings();
  showToast('Settings saved', 'success', '✓');
}

function clearAllSettings() {
  localStorage.removeItem('pfcensus_settings');
  localStorage.removeItem('pfcensus_user');
  location.reload();
}

// ── Login / Register Screens ───────────────────────────────────
function showLoginScreen() {
  document.getElementById('auth-overlay').classList.add('active');
  document.getElementById('main-app').classList.add('hidden');
  renderLoginOverlay();
}

function renderLoginOverlay() {
  const overlay = document.getElementById('auth-overlay');
  overlay.innerHTML = `
    <div class="overlay-content">
      <div class="app-logo" style="display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 24px;">
        <img src="mtrh_logo.png" alt="MTRH Logo" class="mtrh-brand-logo" style="width: 72px; height: 72px; filter: drop-shadow(0 0 20px rgba(26,94,168,0.3));" onerror="this.style.display='none'" />
        <h1 class="logo-title">PF Census</h1>
        <p class="logo-subtitle">Physical File Tracker — ${getMonthLabel()}</p>
      </div>

      <div class="setup-form">
        <div class="input-group">
          <label for="login-name">First Name</label>
          <input type="text" id="login-name" class="form-input" placeholder="e.g. MACHARIA" autocomplete="given-name" />
        </div>
        <div class="input-group" style="margin-top: 12px;">
          <label for="login-pf">Your PF Number</label>
          <input type="text" id="login-pf" class="form-input" placeholder="e.g. 4420" inputmode="numeric" />
        </div>
        <div class="input-group" style="margin-top: 12px;">
          <label for="login-id">ID Number</label>
          <input type="password" id="login-id" class="form-input" placeholder="Enter National ID Number" />
        </div>
        <p class="setup-url-hint" style="margin-top:16px;">
          First time using the app?
          <a href="#" onclick="showRegisterScreen(); return false;">Register here →</a>
        </p>
      </div>

      <button class="btn-primary" onclick="handleLogin()">
        Log In
      </button>
      <p class="auth-note">Your data is secured by Google Apps Script authentication</p>
    </div>
  `;
}

async function showRegisterScreen() {
  document.getElementById('auth-overlay').classList.add('active');
  document.getElementById('main-app').classList.add('hidden');
  
  // Show loading spinner inside auth-overlay while fetching PFs
  const overlay = document.getElementById('auth-overlay');
  overlay.innerHTML = `
    <div class="overlay-content" style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding: 40px 0;">
      <div class="report-spinner"></div>
      <p style="margin-top:16px; color:var(--text-secondary); font-size:14px;">Fetching PF list for batch configuration…</p>
    </div>
  `;

  try {
    const data = await apiFetch('getallpfs');
    state.allPfs = data.pfs || [];
  } catch (e) {
    console.warn('Could not load PFs for dropdowns, falling back to manual text input:', e.message);
    state.allPfs = [];
  }
  renderRegisterOverlay();
}


function renderRegisterOverlay() {
  const overlay = document.getElementById('auth-overlay');
  const hasPfs = Array.isArray(state.allPfs) && state.allPfs.length > 0;

  let batchSelectorHTML = '';
  if (hasPfs) {
    batchSelectorHTML = `
      <div class="input-group" style="margin-top: 8px;">
        <label>Assigned Batch Ranges</label>
        <div id="batch-ranges-container" class="batch-ranges-container">
          <!-- Dynamic batch rows will be injected here -->
        </div>
        <button type="button" class="btn-secondary" style="width:100%; margin-top:8px; font-size:12px; padding:6px 12px;" onclick="addRegisterBatchRow()">
          ＋ Add Batch Range
        </button>
      </div>
    `;
  } else {
    batchSelectorHTML = `
      <div class="input-group" style="margin-top: 8px;">
        <label for="reg-batches">Assigned Batch Ranges</label>
        <input type="text" id="reg-batches" class="form-input" placeholder="e.g. 3001-3500, 4000-4560" />
        <p class="field-hint">Comma-separated ranges (From PF - To PF). Cannot overlap with other users.</p>
      </div>
    `;
  }

  overlay.innerHTML = `
    <div class="overlay-content" style="max-height: 90vh; overflow-y: auto; padding-bottom: 24px; width: 100%; max-width: 440px;">
      <div class="app-logo" style="display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 24px;">
        <img src="mtrh_logo.png" alt="MTRH Logo" class="mtrh-brand-logo" style="width: 72px; height: 72px; filter: drop-shadow(0 0 20px rgba(26,94,168,0.3));" onerror="this.style.display='none'" />
        <h1 class="logo-title">Register</h1>
        <p class="logo-subtitle">Create your census account</p>
      </div>

      <div class="setup-form">
        <div class="input-group">
          <label for="reg-name">First Name</label>
          <input type="text" id="reg-name" class="form-input" placeholder="e.g. MACHARIA" />
        </div>
        <div class="input-group" style="margin-top: 8px;">
          <label for="reg-pf">Your Personal PF Number</label>
          <input type="text" id="reg-pf" class="form-input" placeholder="Your own PF (used for login)" inputmode="numeric" />
        </div>
        <div class="input-group" style="margin-top: 8px;">
          <label for="reg-id">National ID Number</label>
          <input type="text" id="reg-id" class="form-input" placeholder="Your ID card number" />
        </div>
        <div class="input-group" style="margin-top: 8px;">
          <label for="reg-mobile">Mobile Number</label>
          <input type="text" id="reg-mobile" class="form-input" placeholder="e.g. 0724333780" inputmode="numeric" />
        </div>
        
        ${batchSelectorHTML}

        <p class="setup-url-hint" style="margin-top:16px;">
          Already registered?
          <a href="#" onclick="showLoginScreen(); return false;">Log in here →</a>
        </p>
      </div>

      <button class="btn-primary" style="margin-top:16px;" onclick="handleRegister()">
        Register &amp; Create Tab
      </button>
    </div>
  `;

  // Initialize with one batch row if dropdown mode is active
  if (hasPfs) {
    addRegisterBatchRow();
  }
}

// Dynamic batch rows manager
function addRegisterBatchRow() {
  const container = document.getElementById('batch-ranges-container');
  if (!container) return;

  const rowId = 'batch-row-' + Date.now();
  const div = document.createElement('div');
  div.className = 'batch-row';
  div.id = rowId;
  div.style.display = 'flex';
  div.style.alignItems = 'center';
  div.style.gap = '8px';
  div.style.marginTop = '6px';

  // Build options list
  let optionsHTML = '';
  state.allPfs.forEach(pf => {
    optionsHTML += `<option value="${pf}">PF ${pf}</option>`;
  });

  div.innerHTML = `
    <select class="form-select batch-select-from" style="flex:1; padding:8px; font-size:13px;" aria-label="From PF">
      ${optionsHTML}
    </select>
    <span style="color:var(--text-secondary); font-size:12px;">to</span>
    <select class="form-select batch-select-to" style="flex:1; padding:8px; font-size:13px;" aria-label="To PF">
      ${optionsHTML}
    </select>
    <button type="button" class="btn-remove-row" style="background:transparent; border:none; color:var(--danger); font-size:18px; padding:4px 8px; cursor:pointer;" onclick="document.getElementById('${rowId}').remove()" aria-label="Remove range">✕</button>
  `;

  container.appendChild(div);
  
  // Set default selection of the "To PF" select box to the last item
  const toSelect = div.querySelector('.batch-select-to');
  if (toSelect && toSelect.options.length > 0) {
    toSelect.selectedIndex = toSelect.options.length - 1;
  }
}


async function handleLogin() {
  const firstName = (document.getElementById('login-name')?.value.trim() || '').toUpperCase();
  const pfNumber  = (document.getElementById('login-pf')?.value.trim()   || '');
  const idNumber  = (document.getElementById('login-id')?.value.trim()   || '');

  if (!firstName || !pfNumber || !idNumber) {
    showToast('Name, PF Number, and ID required', 'warning', '⚠️');
    return;
  }

  showLoading('Verifying credentials…');
  try {
    const data = await apiPost('login', { firstName, pf: pfNumber, idNo: idNumber });

    const user = {
      name:    firstName,
      batches: data.batches || [],
      round:   data.round || getMonthLabel(),
    };
    state.currentUser = user;
    state.isAdmin = ['MARGARET','SARAH','MACHARIA'].includes(firstName.toUpperCase());
    state.totalFiles   = data.total   || 0;
    state.presentCount = data.present || 0;
    state.missingCount = data.missing || 0;
    state.unmarkedCount= data.unmarked|| 0;

    localStorage.setItem('pfcensus_user', JSON.stringify({ ...user, isAdmin: state.isAdmin }));
    hideLoading();
    showMainApp();
    updateStatsUI();
    checkMissingAlerts();
    const greeting = state.isAdmin ? '👑 Welcome, Admin ' + firstName + '!' : 'Welcome, ' + firstName + '!';
    showToast(greeting, 'success', '🎉');
  } catch (e) {
    hideLoading();
    showToast('Login failed: ' + e.message, 'error', '✕');
  }
}

async function handleRegister() {
  const firstName = (document.getElementById('reg-name')?.value.trim()    || '').toUpperCase();
  const pfNumber  = (document.getElementById('reg-pf')?.value.trim()      || '');
  const idNumber  = (document.getElementById('reg-id')?.value.trim()      || '');
  const mobile    = (document.getElementById('reg-mobile')?.value.trim()  || '');

  if (!firstName || !pfNumber || !idNumber || !mobile) {
    showToast('All fields are required', 'warning', '⚠️');
    return;
  }

  let batches = [];
  const container = document.getElementById('batch-ranges-container');

  if (container) {
    // Dropdown mode
    const rows = container.querySelectorAll('.batch-row');
    for (const row of rows) {
      const fromPF = row.querySelector('.batch-select-from')?.value;
      const toPF   = row.querySelector('.batch-select-to')?.value;
      if (!fromPF || !toPF) {
        showToast('Please select From and To PFs for all ranges', 'warning', '⚠️');
        return;
      }
      if (parseInt(fromPF, 10) > parseInt(toPF, 10)) {
        showToast('Invalid range: PF ' + fromPF + ' is larger than PF ' + toPF, 'error', '✕');
        return;
      }
      batches.push({ from: fromPF, to: toPF });
    }
    if (batches.length === 0) {
      showToast('At least one batch range is required', 'warning', '⚠️');
      return;
    }
  } else {
    // Fallback textbox mode
    const batchStr = document.getElementById('reg-batches')?.value.trim() || '';
    if (!batchStr) {
      showToast('Assigned batch ranges are required', 'warning', '⚠️');
      return;
    }
    try {
      batches = batchStr.split(',').map(part => {
        const m = part.trim().match(/(\d+)\s*[-–]\s*(\d+)/);
        if (!m) throw new Error('Invalid range style. Use e.g. 3001-3500');
        return { from: m[1], to: m[2] };
      });
    } catch (e) {
      showToast(e.message, 'error', '✕');
      return;
    }
  }

  // Check for overlapping ranges in the list itself
  for (let i = 0; i < batches.length; i++) {
    for (let j = i + 1; j < batches.length; j++) {
      const a = batches[i], b = batches[j];
      if (parseInt(a.from, 10) <= parseInt(b.to, 10) && parseInt(b.from, 10) <= parseInt(a.to, 10)) {
        showToast('Batch ranges overlap each other: ' + a.from + '-' + a.to + ' and ' + b.from + '-' + b.to, 'error', '✕');
        return;
      }
    }
  }

  showLoading('Registering and creating your sheet tab…');
  try {
    const data = await apiPost('register', { firstName, pf: pfNumber, idNo: idNumber, mobile, batches });
    hideLoading();
    
    const count = data.count || 0;
    showToast('Success! Created tab with ' + count + ' batch files.', 'success', '🎉');
    showLoginScreen();
  } catch (e) {
    hideLoading();
    showToast('Registration failed: ' + e.message, 'error', '✕');
  }
}

function handleLogout() {
  closeUserMenu();
  if (confirm('Logout ' + (state.currentUser ? state.currentUser.name : '') + '?')) {
    localStorage.removeItem('pfcensus_user');
    state.currentUser = null;
    state.reportData  = null;
    showLoginScreen();
  }
}

// ── Show Main App ─────────────────────────────────────────────
function showMainApp() {
  document.getElementById('auth-overlay').classList.remove('active');
  document.getElementById('main-app').classList.remove('hidden');

  if (state.currentUser) {
    const batchLabel = Array.isArray(state.currentUser.batches)
      ? state.currentUser.batches.map(b => 'PF ' + b.from + '–' + b.to).join(', ')
      : (state.currentUser.batches || '—');

    const nameLabel = state.isAdmin
      ? '👑 ' + state.currentUser.name + ' (Admin)'
      : state.currentUser.name;

    document.getElementById('header-user-name').textContent    = nameLabel;
    document.getElementById('header-user-batches').textContent = state.isAdmin
      ? 'Super Admin — All Sheets'
      : 'Batches: ' + batchLabel;
    document.getElementById('sheet-info').textContent  = 'Tab: ' + state.currentUser.name;
    document.getElementById('user-initial').textContent = state.isAdmin ? '👑' : state.currentUser.name[0].toUpperCase();
  } else {
    document.getElementById('header-user-name').textContent    = 'PF Census';
    document.getElementById('header-user-batches').textContent = 'Batches: —';
    document.getElementById('sheet-info').textContent          = 'Connecting…';
    document.getElementById('user-initial').textContent        = '👤';
  }

  state.selectedCensusRound = getMonthLabel();
  const badge = document.getElementById('month-badge');
  if (badge) badge.textContent = state.selectedCensusRound;

  // Show/hide admin tab
  const adminTab = document.getElementById('tab-compiled');
  if (adminTab) adminTab.classList.toggle('hidden', !state.isAdmin);
}

// ── API Helpers ───────────────────────────────────────────────
async function apiFetch(action, params = {}) {
  const url = new URL(state.scriptUrl);
  url.searchParams.set('action', action);
  if (state.currentUser) url.searchParams.set('username', state.currentUser.name);
  url.searchParams.set('round', state.selectedCensusRound);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));

  const resp = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
  if (!resp.ok) throw new Error('Server error HTTP ' + resp.status);
  const json = await resp.json();
  if (json.success === false) throw new Error(json.error || 'Unknown server error');
  return json;          // backend returns { success:true, ...data }
}

async function apiPost(action, body = {}) {
  const payload = { action, ...body };
  if (state.currentUser && !payload.username) payload.username = state.currentUser.name;

  const resp = await fetch(state.scriptUrl, {
    method: 'POST',
    redirect: 'follow',
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error('Server error HTTP ' + resp.status);
  const json = await resp.json();
  if (json.success === false) throw new Error(json.error || 'Unknown server error');
  return json;
}

// ── Load Stats ────────────────────────────────────────────────
async function loadStats() {
  try {
    const data = await apiFetch('getstats');
    state.totalFiles    = data.total    || 0;
    state.presentCount  = data.present  || 0;
    state.missingCount  = data.missing  || 0;
    state.unmarkedCount = data.unmarked || 0;
    updateStatsUI();
  } catch (e) {
    console.error('Stats error:', e);
  }
}

function updateStatsUI() {
  const el = (id) => document.getElementById(id);
  const pct = state.totalFiles > 0
    ? Math.round((state.presentCount / state.totalFiles) * 100) : 0;

  if (el('stat-total'))    el('stat-total').textContent   = state.totalFiles   || '—';
  if (el('stat-present'))  el('stat-present').textContent = state.presentCount;
  if (el('stat-missing'))  el('stat-missing').textContent = state.missingCount;
  if (el('stat-unmarked')) el('stat-unmarked').textContent= state.unmarkedCount;
  if (el('stat-percent'))  el('stat-percent').textContent = pct + '%';
  const fill = el('progress-fill');
  if (fill) fill.style.width = pct + '%';
}

async function refreshData() {
  closeUserMenu();
  showLoading('Refreshing data…');
  try {
    await loadStats();
    await checkMissingAlerts();
    hideLoading();
    showToast('Data refreshed', 'success', '🔄');
  } catch (e) {
    hideLoading();
    showToast('Refresh failed', 'error', '✕');
  }
}

// ── Missing Alerts Check ──────────────────────────────────────
async function checkMissingAlerts() {
  if (!state.currentUser) return;
  try {
    const data = await apiFetch('missingalerts');
    const alerts = data.alerts || [];
    const badge  = document.getElementById('missing-alert-badge');
    const cnt    = document.getElementById('missing-alert-count');
    if (badge) {
      if (alerts.length > 0) {
        badge.classList.remove('hidden');
        if (cnt) cnt.textContent = alerts.length;
      } else {
        badge.classList.add('hidden');
      }
    }
  } catch (e) {
    console.warn('Missing alerts check failed:', e.message);
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

  // Client-side batch check
  if (state.currentUser && Array.isArray(state.currentUser.batches)) {
    const pfVal = parseInt(pf);
    const inRange = state.currentUser.batches.some(b =>
      pfVal >= parseInt(b.from) && pfVal <= parseInt(b.to)
    );
    if (!inRange) {
      const batchLabel = state.currentUser.batches.map(b => 'PF ' + b.from + '–' + b.to).join(', ');
      showToast('PF ' + pf + ' is outside your batches: ' + batchLabel, 'error', '✕');
      return;
    }
  }

  showLoading('Searching for PF ' + pf + '…');
  hideResultCard();

  try {
    const data = await apiFetch('lookup', { pf });
    hideLoading();

    if (data.found) {
      state.currentResult = data;
      state.movementHistoryLoaded = false;
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
  const cleaned = String(raw).trim().replace(/[^a-zA-Z0-9]/g, '');
  if (!cleaned) return null;
  if (/^\d+$/.test(cleaned)) return cleaned.padStart(CONFIG.PF_DIGITS || 4, '0');
  return cleaned.toUpperCase();
}

// ── Show Results ──────────────────────────────────────────────
function showFoundResult(data) {
  const card = document.getElementById('result-card');
  card.classList.remove('hidden');
  document.getElementById('result-not-found').classList.add('hidden');
  document.getElementById('result-success').classList.add('hidden');
  document.getElementById('result-found').classList.remove('hidden');

  // Avatar
  const nameStr = data.name || data.pf || '?';
  document.getElementById('emp-avatar-letter').textContent = nameStr[0].toUpperCase();

  // Basic info
  document.getElementById('emp-name').textContent = data.name || '(No name)';
  document.getElementById('emp-pf').textContent   = 'PF: ' + data.pf;

  // Status badge
  const badge = document.getElementById('current-status-badge');
  if (data.flag === 'PRESENT') {
    badge.textContent = '✓ PRESENT';
    badge.className   = 'result-badge badge-present';
  } else if (data.flag === 'MISSING') {
    badge.textContent = '⚠ MISSING';
    badge.className   = 'result-badge badge-missing';
  } else if (data.flag === 'LOCATED') {
    badge.textContent = '📍 LOCATED';
    badge.className   = 'result-badge badge-located';
  } else {
    badge.textContent = 'NOT MARKED';
    badge.className   = 'result-badge badge-absent';
  }

  // Missing alert banner
  const warnBanner = document.getElementById('missing-warn-banner');
  if (warnBanner) {
    if (data.flag === 'MISSING' && (data.missingCount || 0) >= 2) {
      warnBanner.classList.remove('hidden');
      const cnt = document.getElementById('missing-warn-count');
      if (cnt) cnt.textContent = data.missingCount;
    } else {
      warnBanner.classList.add('hidden');
    }
  }

  // Detail rows
  setDetailRow('status-row',      'emp-hr-status',    data.hrStatus);
  setDetailRow('phone-row',       'emp-phone',         data.phone);
  setDetailRow('last-marked-row', 'emp-last-marked',  data.lastMarked || data.lastDateTime);

  // Current custody location display
  const custodyDisplayRow = document.getElementById('custody-display-row');
  const custodyDisplayVal = document.getElementById('emp-current-custody');
  if (data.custody) {
    if (custodyDisplayRow) custodyDisplayRow.style.display = '';
    if (custodyDisplayVal) custodyDisplayVal.textContent = data.custody;
  } else {
    if (custodyDisplayRow) custodyDisplayRow.style.display = 'none';
  }

  // Pre-fill form fields
  setFileStatus(data.fileStatus || 'ACTIVE');
  const custodySelect = document.getElementById('custody-select');
  if (custodySelect) {
    const loc = (data.custody || 'REGISTRY').toUpperCase();
    const found = [...custodySelect.options].some(o => o.value === loc);
    custodySelect.value = found ? loc : 'REGISTRY';
  }

  // Show "Update Location Only" for located/missing files
  const updateLocRow = document.getElementById('update-location-row');
  const moveHistoryToggle = document.getElementById('movement-history-toggle');
  if (updateLocRow) updateLocRow.style.display = (data.flag === 'MISSING' || data.flag === 'LOCATED') ? '' : 'none';
  if (moveHistoryToggle) moveHistoryToggle.style.display = '';

  // Reset movement history
  const moveBody = document.getElementById('movement-history-body');
  if (moveBody) moveBody.classList.add('hidden');
  const moveIcon = document.getElementById('movement-toggle-icon');
  if (moveIcon) moveIcon.textContent = '▼';

  // Always show census timeline toggle and reset it
  const ctToggle = document.getElementById('census-timeline-toggle');
  const ctBody   = document.getElementById('census-timeline-body');
  const ctIcon   = document.getElementById('census-timeline-icon');
  if (ctToggle) ctToggle.style.display = '';
  if (ctBody)   ctBody.classList.add('hidden');
  if (ctIcon)   ctIcon.textContent = '▼';
  state.censusTimelineLoaded = false;



  // Mark button label
  const markBtn = document.getElementById('mark-btn');
  if (data.flag === 'PRESENT' && data.round === state.selectedCensusRound) {
    markBtn.innerHTML = '<span class="mark-icon">✓</span> Already PRESENT — Re-mark?';
    markBtn.className = 'btn-mark-present already-present';
  } else {
    markBtn.innerHTML = '<span class="mark-icon">✓</span> Mark as PRESENT';
    markBtn.className = 'btn-mark-present';
  }

  setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}

function setDetailRow(rowId, valueId, value) {
  const row = document.getElementById(rowId);
  const val = document.getElementById(valueId);
  if (!row || !val) return;
  if (value) {
    row.classList.remove('hidden');
    row.style.display = '';
    val.textContent = value;
  } else {
    row.style.display = 'none';
  }
}

function showNotFoundResult(pf) {
  const card = document.getElementById('result-card');
  card.classList.remove('hidden');
  document.getElementById('result-found').classList.add('hidden');
  document.getElementById('result-success').classList.add('hidden');
  document.getElementById('result-not-found').classList.remove('hidden');
  document.getElementById('not-found-msg').textContent = 'PF ' + pf + ' was not found in your sheet.';
  setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}

function hideResultCard() { document.getElementById('result-card').classList.add('hidden'); }
function clearResult()    { hideResultCard(); state.currentResult = null; }
function clearInput()     { document.getElementById('pf-input').value = ''; clearResult(); }
function clearForNext()   {
  clearInput();
  hideResultCard();
  document.getElementById('pf-input').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Mark Present ──────────────────────────────────────────────
async function markPresent() {
  if (!state.currentResult) return;
  const pf         = state.currentResult.pf;
  const fileStatus = state.selectedFileStatus;
  const custody    = document.getElementById('custody-select')?.value || 'REGISTRY';
  const round      = state.selectedCensusRound;

  showLoading('Marking PF ' + pf + ' as PRESENT…');

  try {
    const data = await apiPost('markpresent', { pf, fileStatus, custody, round });
    hideLoading();

    // Update local state
    if (state.currentResult.flag !== 'PRESENT') state.presentCount++;
    if (state.currentResult.flag === 'MISSING')  state.missingCount = Math.max(0, state.missingCount - 1);
    state.sessionCount++;
    updateStatsUI();

    addToLog({ pf: data.pf, name: data.name, timestamp: data.timestamp, custody: data.custody });
    showSuccessResult(data);
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
  const icon = success.querySelector('.result-icon-success');
  if (icon) icon.classList.add('success-pulse');

  const msg = document.getElementById('success-msg');
  const time = document.getElementById('success-time');
  if (msg)  msg.textContent  = (data.name || data.pf) + ' marked as PRESENT at ' + (data.custody || '');
  if (time) time.textContent = '🕐 ' + (data.timestamp || '');
}

// ── Update File Location ──────────────────────────────────────
async function updateFileLocation() {
  if (!state.currentResult) return;
  const pf          = state.currentResult.pf;
  const newLocation = document.getElementById('custody-select')?.value || 'REGISTRY';

  showLoading('Updating location for PF ' + pf + '…');
  try {
    const data = await apiPost('updatelocation', { pf, newLocation });
    hideLoading();

    // Update local result
    state.currentResult.custody = newLocation;
    if (state.currentResult.flag === 'MISSING') {
      state.currentResult.flag = 'LOCATED';
      state.missingCount = Math.max(0, state.missingCount - 1);
      updateStatsUI();
    }

    const custDisplay = document.getElementById('emp-current-custody');
    if (custDisplay) custDisplay.textContent = newLocation;

    showToast('Location updated: ' + data.oldLocation + ' → ' + newLocation, 'success', '📍');

    // Reload movement history (invalidate cache)
    state.movementHistoryLoaded = false;
    const moveBody = document.getElementById('movement-history-body');
    if (moveBody && !moveBody.classList.contains('hidden')) {
      loadMovementHistory(pf);
    }
  } catch (e) {
    hideLoading();
    showToast('Update failed: ' + e.message, 'error', '✕');
  }
}

// ── Movement History ─────────────────────────────────────────
function toggleMovementHistory() {
  const body = document.getElementById('movement-history-body');
  const icon = document.getElementById('movement-toggle-icon');
  if (!body) return;

  const isHidden = body.classList.contains('hidden');
  body.classList.toggle('hidden', !isHidden);
  if (icon) icon.textContent = isHidden ? '▲' : '▼';

  if (isHidden && !state.movementHistoryLoaded && state.currentResult) {
    loadMovementHistory(state.currentResult.pf);
  }
}

async function loadMovementHistory(pf) {
  const list    = document.getElementById('movement-list');
  const loading = document.getElementById('movement-loading');
  if (!list) return;

  if (loading) loading.style.display = '';
  list.innerHTML = '';

  try {
    const data = await apiFetch('movementlog', { pf });
    if (loading) loading.style.display = 'none';
    const history = data.history || [];
    state.movementHistoryLoaded = true;

    if (!history.length) {
      list.innerHTML = '<li class="move-empty">No location changes recorded yet.</li>';
      return;
    }
    history.forEach(h => {
      const li = document.createElement('li');
      li.className = 'move-item';
      li.innerHTML = `
        <span class="move-time">${escHtml(h.timestamp)}</span>
        <span class="move-arrow">${escHtml(h.from)} → ${escHtml(h.to)}</span>
        <span class="move-by">by ${escHtml(h.updatedBy)}</span>
      `;
      list.appendChild(li);
    });
  } catch (e) {
    if (loading) loading.style.display = 'none';
    list.innerHTML = '<li class="move-empty">Could not load history.</li>';
  }
}

// ── Report Screen ─────────────────────────────────────────────
async function openReportScreen(tab = 'summary') {
  closeUserMenu();
  const overlay = document.getElementById('report-overlay');
  if (overlay) overlay.classList.remove('hidden');

  state.activeReportTab = tab;
  switchReportTab(tab);

  // Always refresh report data when opening
  await loadReport();
}

function closeReportScreen() {
  const overlay = document.getElementById('report-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function switchReportTab(tab) {
  state.activeReportTab = tab;
  ['summary','missing','unmarked','marked','compiled'].forEach(t => {
    const btn     = document.getElementById('tab-' + t);
    const content = document.getElementById('tab-content-' + t);
    if (btn)     btn.classList.toggle('active', t === tab);
    if (content) content.classList.toggle('hidden', t !== tab);
  });
  // Lazy-load compiled report when admin switches to that tab
  if (tab === 'compiled' && state.isAdmin && !state.compiledData) {
    loadCompiledReport();
  }
}

async function loadReport() {
  const loading = document.getElementById('report-loading');
  if (loading) loading.style.display = '';

  try {
    const data = await apiFetch('report');
    state.reportData = data;
    if (loading) loading.style.display = 'none';
    renderReportData(data);
  } catch (e) {
    if (loading) loading.style.display = 'none';
    showToast('Report failed: ' + e.message, 'error', '✕');
  }
}

function renderReportData(data) {
  if (!data) return;

  const u = state.currentUser;
  const nameStr = u ? u.name : 'Your';

  // Header
  const titleEl    = document.getElementById('report-title');
  const subtitleEl = document.getElementById('report-subtitle');
  const monthEl    = document.getElementById('report-month-label');
  if (titleEl)    titleEl.textContent    = '📊 ' + nameStr + ' — Weeding Report';
  if (subtitleEl) subtitleEl.textContent = 'Census Round: ' + (data.round || state.selectedCensusRound);
  if (monthEl)    monthEl.textContent    = data.round || state.selectedCensusRound;

  // Summary stats
  setEl('rsc-total',   data.total   || 0);
  setEl('rsc-marked',  data.marked  || 0);
  setEl('rsc-unmarked',data.unmarked|| 0);
  setEl('rsc-missing', data.missing || 0);

  const pct = data.total > 0 ? Math.round((data.marked / data.total) * 100) : 0;
  setEl('rsc-percent', pct + '%');
  const fill = document.getElementById('rsc-progress-fill');
  if (fill) fill.style.width = pct + '%';

  // Missing tab
  const missingNote = document.getElementById('missing-note');
  if (missingNote) {
    const cnt2plus = (data.missingList || []).filter(f => f.missingCount >= 2).length;
    missingNote.textContent = (data.missing || 0) + ' file(s) flagged as MISSING — '
      + cnt2plus + ' flagged in 2+ census rounds (critical).';
  }
  renderFileList('missing-file-list', 'missing-empty', data.missingList || [], 'missing');

  // Unmarked tab
  const unmarkedNote = document.getElementById('unmarked-note');
  if (unmarkedNote) {
    unmarkedNote.textContent = (data.unmarked || 0) + ' file(s) not yet marked this month.';
  }
  renderFileList('unmarked-file-list', 'unmarked-empty', data.unmarkedList || [], 'unmarked');

  // Marked tab
  const markedNote = document.getElementById('marked-note');
  if (markedNote) {
    markedNote.textContent = (data.marked || 0) + ' file(s) marked as PRESENT this round.';
  }
  renderFileList('marked-file-list', 'marked-empty', data.markedList || [], 'marked');
}

function renderFileList(listId, emptyId, items, type) {
  const list  = document.getElementById(listId);
  const empty = document.getElementById(emptyId);
  if (!list) return;

  list.innerHTML = '';

  if (!items.length) {
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  items.forEach(item => {
    const li = document.createElement('li');
    li.className = 'report-file-item rfi-' + type;

    if (type === 'missing') {
      const isCritical = (item.missingCount || 0) >= 2;
      li.innerHTML = `
        <div class="rfi-main">
          <span class="rfi-pf">PF ${escHtml(item.pf)}</span>
          <span class="rfi-name">${escHtml(item.name || '—')}</span>
          ${isCritical ? '<span class="rfi-critical">🚨 CRITICAL</span>' : ''}
        </div>
        <div class="rfi-meta">
          <span>Missing: ${escHtml(String(item.missingCount || 0))} round(s)</span>
          ${item.custody ? '<span>Last: ' + escHtml(item.custody) + '</span>' : ''}
          ${item.lastSeen ? '<span>' + escHtml(item.lastSeen) + '</span>' : ''}
        </div>
      `;
    } else if (type === 'unmarked') {
      li.innerHTML = `
        <div class="rfi-main">
          <span class="rfi-pf">PF ${escHtml(item.pf)}</span>
          <span class="rfi-name">${escHtml(item.name || '—')}</span>
        </div>
        <div class="rfi-meta">
          <span>Status: ${escHtml(item.hrStatus || 'Active')}</span>
        </div>
      `;
    } else {   // marked
      li.innerHTML = `
        <div class="rfi-main">
          <span class="rfi-pf">PF ${escHtml(item.pf)}</span>
          <span class="rfi-name">${escHtml(item.name || '—')}</span>
        </div>
        <div class="rfi-meta">
          <span>${escHtml(item.custody || 'REGISTRY')}</span>
          <span>${escHtml(item.fileStatus || '')}</span>
          <span>${escHtml(item.timestamp || '')}</span>
        </div>
      `;
    }

    list.appendChild(li);
  });
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
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
  document.getElementById('log-body')?.classList.toggle('expanded', state.logExpanded);
  const icon = document.getElementById('log-toggle-icon');
  if (icon) icon.classList.toggle('open', state.logExpanded);
}

// ── Audit ─────────────────────────────────────────────────────
async function triggerAudit() {
  closeUserMenu();
  const round = state.selectedCensusRound;
  if (!confirm(
    'Run Audit for ' + round + '?\n\n' +
    'All ACTIVE files NOT yet marked PRESENT in this round will be flagged as MISSING.\n' +
    'Their missing count will be incremented. Files missing 2+ rounds will trigger alerts.\n\n' +
    'Continue?'
  )) return;

  showLoading('Running missing file audit…');
  try {
    const data = await apiPost('runaudit', { round });
    hideLoading();
    await loadStats();
    await checkMissingAlerts();
    showToast(
      'Audit done! ' + (data.flagged || 0) + ' flagged MISSING, ' + (data.alreadyPresent || 0) + ' already present.',
      'warning', '⚠️'
    );
  } catch (e) {
    hideLoading();
    showToast('Audit failed: ' + e.message, 'error', '✕');
  }
}

// ── Voice Recognition ─────────────────────────────────────────
function initVoiceRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    const btn = document.getElementById('voice-btn');
    if (btn) {
      btn.title   = 'Voice not supported in this browser';
      btn.style.opacity = '0.4';
      btn.onclick = () => showToast('Use Chrome or Edge for voice recognition', 'warning', '⚠️');
    }
    return;
  }

  const rec = new SR();
  rec.continuous     = false;
  rec.interimResults = true;
  rec.lang           = CONFIG.VOICE_LANGUAGE || 'en-US';
  rec.maxAlternatives = 3;

  rec.onstart  = () => {
    state.isListening = true;
    setVoiceButtonState('listening');
    document.getElementById('transcript-display').classList.remove('hidden');
    document.getElementById('transcript-text').textContent = '…';
    document.getElementById('voice-hint').textContent = 'Listening… speak the PF number';
  };
  rec.onend    = () => {
    state.isListening = false;
    setVoiceButtonState('idle');
    document.getElementById('voice-hint').textContent = 'Tap the mic and speak the PF Number';
  };
  rec.onerror  = (e) => {
    state.isListening = false;
    setVoiceButtonState('idle');
    if      (e.error === 'no-speech')   showToast('No speech detected. Try again.', 'warning', '🎤');
    else if (e.error === 'not-allowed') showToast('Microphone access denied.', 'error', '🚫');
    else                                showToast('Voice error: ' + e.error, 'error', '✕');
  };
  rec.onresult = (e) => {
    let final = '', interim = '';
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
        document.getElementById('transcript-text').textContent = display + ' → PF ' + pf;
        setTimeout(() => doSearch(pf), 400);
      } else {
        showToast('Could not read PF from: "' + final + '"', 'warning', '🎤');
      }
    }
  };

  state.recognition = rec;
}

function toggleVoice() {
  if (!state.recognition) {
    showToast('Voice recognition not available. Use Chrome or Edge.', 'warning', '⚠️');
    return;
  }
  if (state.isListening) state.recognition.stop();
  else { clearResult(); state.recognition.start(); }
}

function setVoiceButtonState(mode) {
  const btn   = document.getElementById('voice-btn');
  const label = document.getElementById('voice-status-text');
  if (!btn) return;
  btn.classList.toggle('listening', mode === 'listening');
  if (label) label.textContent = mode === 'listening' ? 'LISTENING…' : 'TAP TO SPEAK';
}

function extractPFFromSpeech(transcript) {
  const text = transcript.toLowerCase().trim();
  const direct = text.match(/\b(\d{4})\b/);
  if (direct) return direct[1];

  const pfPat = text.match(/\bpf\s*(?:number\s*)?(\d{1,6})\b/i);
  if (pfPat) return pfPat[1].padStart(4, '0');

  const wordMap = { zero:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9' };
  let ds = '';
  for (const w of text.split(/\s+/)) {
    if (wordMap[w]) ds += wordMap[w];
    else if (/^\d+$/.test(w)) ds += w;
    else if (ds.length >= 3) break;
    else if (ds.length > 0) break;
  }
  if (ds.length >= 4) return ds.slice(0, 4);
  if (ds.length > 0)  return ds.padStart(4, '0');

  const any = text.replace(/\s/g,'').match(/\d{1,6}/);
  if (any) return any[0].slice(0,4).padStart(4,'0');
  return null;
}

// ── Keyboard Handler ──────────────────────────────────────────
function handleInputKey(e) { if (e.key === 'Enter') searchPF(); }

// ── File Status Toggle ────────────────────────────────────────
function setFileStatus(status) {
  state.selectedFileStatus = status;
  const activeBtn = document.getElementById('status-active-btn');
  const exitBtn   = document.getElementById('status-exit-btn');
  if (activeBtn && exitBtn) {
    activeBtn.classList.toggle('active', status === 'ACTIVE');
    exitBtn.classList.toggle('active',   status === 'EXIT');
  }
}

// ── Settings Modal ────────────────────────────────────────────
function openSettings() {
  closeUserMenu();
  document.getElementById('settings-modal').classList.remove('hidden');
  const setVal = (id, val) => { const e = document.getElementById(id); if (e) e.value = val || ''; };
  setVal('col-pf',           state.columns.PF_NUMBER     || 'A');
  setVal('col-name',         state.columns.EMPLOYEE_NAME || 'C');
  setVal('col-dept',         state.columns.DEPARTMENT    || '');
  setVal('col-desig',        state.columns.DESIGNATION   || '');
  setVal('col-datetime',     state.columns.DATE_TIME     || 'E');
  setVal('col-status',       state.columns.STATUS        || 'F');
  setVal('sheet-name-input', state.sheetName             || 'Main DBase');
  setVal('header-row-input', state.headerRow             || 1);
}

function closeSettings() { document.getElementById('settings-modal').classList.add('hidden'); }

// ── User Menu ─────────────────────────────────────────────────
function toggleUserMenu() { document.getElementById('user-menu')?.classList.toggle('hidden'); }
function closeUserMenu()   { document.getElementById('user-menu')?.classList.add('hidden'); }

document.addEventListener('click', (e) => {
  const menu  = document.getElementById('user-menu');
  const badge = document.querySelector('.user-badge');
  if (menu && !menu.contains(e.target) && badge && !badge.contains(e.target)) {
    menu.classList.add('hidden');
  }
  // Close report on backdrop click (outside report card)
  const report  = document.getElementById('report-overlay');
  if (report && !report.classList.contains('hidden')) {
    const inner = report.querySelector('.report-header, .report-tabs, .report-body');
    if (inner && !report.querySelector('.report-header').contains(e.target) &&
        !report.querySelector('.report-tabs').contains(e.target) &&
        !report.querySelector('.report-body').contains(e.target)) {
      // Don't auto-close — user uses the ✕ button
    }
  }
});

// ── Loading Overlay ───────────────────────────────────────────
function showLoading(text = 'Loading…') {
  const overlay = document.getElementById('loading-overlay');
  const label   = document.getElementById('loading-text');
  if (overlay) overlay.classList.remove('hidden');
  if (label)   label.textContent = text;
}

function hideLoading() {
  document.getElementById('loading-overlay')?.classList.add('hidden');
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
  }, 3500);
}

// ── Helpers ───────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function shortTime(ts) {
  if (!ts) return '';
  return ts.split(' ')[1] || ts;
}

// ── Compiled Report (Super Admin) ─────────────────────────────
async function loadCompiledReport() {
  if (!state.isAdmin) return;
  const chart  = document.getElementById('compiled-chart');
  const grand  = document.getElementById('compiled-grand');
  if (chart) chart.innerHTML = '<div style="color:var(--text-muted);padding:16px 0">Loading compiled report…</div>';

  try {
    const data = await apiFetch('compiledreport');
    state.compiledData = data;
    renderCompiledReport(data);
  } catch (e) {
    if (chart) chart.innerHTML = '<div style="color:var(--danger);padding:16px 0">Error: ' + escHtml(e.message) + '</div>';
    showToast('Compiled report failed: ' + e.message, 'error', '✕');
  }
}

function renderCompiledReport(data) {
  if (!data) return;

  // Grand totals
  setEl('cg-total',   data.grandTotal    || 0);
  setEl('cg-present', data.grandPresent  || 0);
  setEl('cg-unmarked',data.grandUnmarked || 0);
  setEl('cg-missing', data.grandMissing  || 0);
  setEl('cg-pct',     (data.grandPct || 0) + '%');
  const pctFill = document.getElementById('cg-pct-fill');
  if (pctFill) pctFill.style.width = (data.grandPct || 0) + '%';

  // Per-user bar chart
  const chart = document.getElementById('compiled-chart');
  if (chart) {
    chart.innerHTML = '';
    (data.perUser || []).forEach(u => {
      const row = document.createElement('div');
      row.className = 'cc-row';

      const pctPresent  = u.total > 0 ? (u.present  / u.total * 100) : 0;
      const pctUnmarked = u.total > 0 ? (u.unmarked / u.total * 100) : 0;
      const pctMissing  = u.total > 0 ? (u.missing  / u.total * 100) : 0;

      row.innerHTML = `
        <div class="cc-label">
          <span class="cc-name">${escHtml(u.user)}</span>
          <span class="cc-pct">${u.pct}%</span>
        </div>
        <div class="cc-bar-wrap">
          <div class="cc-bar">
            <div class="cc-seg cc-seg-present"  style="width:${pctPresent.toFixed(1)}%"  title="${u.present} Present"></div>
            <div class="cc-seg cc-seg-unmarked" style="width:${pctUnmarked.toFixed(1)}%" title="${u.unmarked} Unmarked"></div>
            <div class="cc-seg cc-seg-missing"  style="width:${pctMissing.toFixed(1)}%"  title="${u.missing} Missing"></div>
          </div>
        </div>
        <div class="cc-nums">
          <span class="cc-n present">${u.present}✓</span>
          <span class="cc-n unmarked">${u.unmarked}⏳</span>
          <span class="cc-n missing">${u.missing}🚨</span>
          <span class="cc-n total">${u.total} total</span>
        </div>
      `;
      chart.appendChild(row);
    });

    // Legend
    const legend = document.createElement('div');
    legend.className = 'cc-legend';
    legend.innerHTML = `
      <span><span class="cc-dot cc-dot-present"></span>Present</span>
      <span><span class="cc-dot cc-dot-unmarked"></span>Unmarked</span>
      <span><span class="cc-dot cc-dot-missing"></span>Missing</span>
    `;
    chart.appendChild(legend);
  }

  // Critical missing
  const missListEl = document.getElementById('compiled-missing-list');
  const missEmpty  = document.getElementById('compiled-missing-empty');
  if (missListEl) {
    missListEl.innerHTML = '';
    const critical = data.criticalMissing || [];
    if (!critical.length) {
      if (missEmpty) missEmpty.classList.remove('hidden');
    } else {
      if (missEmpty) missEmpty.classList.add('hidden');
      critical.forEach(item => {
        const li = document.createElement('li');
        li.className = 'report-file-item rfi-missing';
        li.innerHTML = `
          <div class="rfi-main">
            <span class="rfi-pf">PF ${escHtml(item.pf)}</span>
            <span class="rfi-name">${escHtml(item.name || '—')}</span>
            <span class="rfi-critical">🚨 ${item.missingCount} rounds</span>
          </div>
          <div class="rfi-meta">
            <span>User: ${escHtml(item.user)}</span>
            ${item.custody ? '<span>' + escHtml(item.custody) + '</span>' : ''}
            <span>Last seen: ${escHtml(item.lastSeen)}</span>
          </div>
        `;
        missListEl.appendChild(li);
      });
    }
  }
}

// ── Census Timeline ───────────────────────────────────────────
function toggleCensusTimeline() {
  const body = document.getElementById('census-timeline-body');
  const icon = document.getElementById('census-timeline-icon');
  if (!body) return;

  const isHidden = body.classList.contains('hidden');
  body.classList.toggle('hidden', !isHidden);
  if (icon) icon.textContent = isHidden ? '▲' : '▼';

  if (isHidden && !state.censusTimelineLoaded && state.currentResult) {
    loadCensusTimeline(state.currentResult.pf);
  }
}

async function loadCensusTimeline(pf) {
  const wrap    = document.getElementById('census-timeline-wrap');
  const loading = document.getElementById('census-timeline-loading');
  if (!wrap) return;

  if (loading) loading.style.display = '';
  wrap.innerHTML = '';

  try {
    const data = await apiFetch('censustimeline', { pf });
    if (loading) loading.style.display = 'none';
    state.censusTimelineLoaded = true;
    renderCensusTimeline(data);
  } catch (e) {
    if (loading) loading.style.display = 'none';
    wrap.innerHTML = '<div class="move-empty">Could not load census history.</div>';
  }
}

function renderCensusTimeline(data) {
  const wrap = document.getElementById('census-timeline-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  const timeline = data.timeline || [];
  if (!timeline.length) {
    wrap.innerHTML = '<div class="move-empty">No census history recorded for this file.</div>';
    return;
  }

  // Summary header
  const summary = document.createElement('div');
  summary.className = 'ct-summary';
  const lastSeen  = data.lastSeen        ? '✓ Last seen: <strong>' + escHtml(data.lastSeen)        + '</strong>' : '';
  const declared  = data.declaredMissing ? ' | 🚨 Missing from: <strong>' + escHtml(data.declaredMissing) + '</strong>' : '';
  summary.innerHTML = lastSeen + declared;
  wrap.appendChild(summary);

  // Timeline rail
  const rail = document.createElement('div');
  rail.className = 'ct-rail';

  timeline.forEach((entry, idx) => {
    const dot = document.createElement('div');
    dot.className = 'ct-item';

    const isPresent = entry.flag === 'PRESENT' || entry.flag === 'LOCATED';
    const isMissing = entry.flag === 'MISSING';
    const isLast    = idx === timeline.length - 1;

    dot.innerHTML = `
      <div class="ct-dot ${isPresent ? 'ct-dot-present' : isMissing ? 'ct-dot-missing' : 'ct-dot-neutral'}">
        ${isPresent ? '✓' : isMissing ? '✗' : '?'}
      </div>
      <div class="ct-info">
        <div class="ct-round">${escHtml(entry.round)}</div>
        <div class="ct-flag ct-flag-${entry.flag.toLowerCase()}">${escHtml(entry.flag)}</div>
        ${entry.custody  ? '<div class="ct-detail">' + escHtml(entry.custody) + '</div>' : ''}
        ${entry.operator ? '<div class="ct-detail">by ' + escHtml(entry.operator) + '</div>' : ''}
        ${entry.timestamp? '<div class="ct-detail ct-ts">' + escHtml(entry.timestamp) + '</div>' : ''}
      </div>
      ${!isLast ? '<div class="ct-line"></div>' : ''}
    `;
    rail.appendChild(dot);
  });

  wrap.appendChild(rail);
}

// ── Edit Batches Modal ────────────────────────────────────────
async function openEditBatchesModal() {
  closeUserMenu();
  const modal = document.getElementById('edit-batches-modal');
  if (!modal) return;

  const container = document.getElementById('edit-batch-ranges-container');
  if (container) container.innerHTML = '';

  modal.classList.remove('hidden');

  // Load PFs if not already loaded
  if (!Array.isArray(state.allPfs) || state.allPfs.length === 0) {
    showLoading('Fetching PF list for batch configuration…');
    try {
      const data = await apiFetch('getallpfs');
      state.allPfs = data.pfs || [];
    } catch (e) {
      console.warn('Could not load PFs for dropdowns, using textboxes:', e.message);
      state.allPfs = [];
    }
    hideLoading();
  }

  // Populate container with current user batches
  if (state.currentUser && Array.isArray(state.currentUser.batches)) {
    state.currentUser.batches.forEach(b => {
      addEditBatchRow(b.from, b.to);
    });
  }

  // Fallback: If no ranges exist yet, add one blank row
  if (container && container.children.length === 0) {
    addEditBatchRow();
  }
}

function closeEditBatchesModal() {
  document.getElementById('edit-batches-modal')?.classList.add('hidden');
}

function addEditBatchRow(fromVal = '', toVal = '') {
  const container = document.getElementById('edit-batch-ranges-container');
  if (!container) return;

  const hasPfs = Array.isArray(state.allPfs) && state.allPfs.length > 0;
  const rowId = 'edit-batch-row-' + Date.now();
  const div = document.createElement('div');
  div.className = 'batch-row';
  div.id = rowId;
  div.style.display = 'flex';
  div.style.alignItems = 'center';
  div.style.gap = '8px';
  div.style.marginTop = '6px';

  if (hasPfs) {
    let optionsFrom = '';
    let optionsTo   = '';
    state.allPfs.forEach(pf => {
      const isSelFrom = pf === fromVal ? 'selected' : '';
      const isSelTo   = pf === toVal ? 'selected' : '';
      optionsFrom += `<option value="${pf}" ${isSelFrom}>PF ${pf}</option>`;
      optionsTo   += `<option value="${pf}" ${isSelTo}>PF ${pf}</option>`;
    });

    div.innerHTML = `
      <select class="form-select batch-select-from" style="flex:1; padding:8px; font-size:13px;" aria-label="From PF">
        ${optionsFrom}
      </select>
      <span style="color:var(--text-secondary); font-size:12px;">to</span>
      <select class="form-select batch-select-to" style="flex:1; padding:8px; font-size:13px;" aria-label="To PF">
        ${optionsTo}
      </select>
      <button type="button" class="btn-remove-row" style="background:transparent; border:none; color:var(--danger); font-size:18px; padding:4px 8px; cursor:pointer;" onclick="document.getElementById('${rowId}').remove()" aria-label="Remove range">✕</button>
    `;
  } else {
    div.innerHTML = `
      <input type="text" class="form-input batch-select-from" style="flex:1; padding:8px; font-size:13px;" placeholder="From e.g. 3001" value="${escHtml(fromVal)}" aria-label="From PF" />
      <span style="color:var(--text-secondary); font-size:12px;">to</span>
      <input type="text" class="form-input batch-select-to" style="flex:1; padding:8px; font-size:13px;" placeholder="To e.g. 3500" value="${escHtml(toVal)}" aria-label="To PF" />
      <button type="button" class="btn-remove-row" style="background:transparent; border:none; color:var(--danger); font-size:18px; padding:4px 8px; cursor:pointer;" onclick="document.getElementById('${rowId}').remove()" aria-label="Remove range">✕</button>
    `;
  }

  container.appendChild(div);

  // Set defaults for blank dropdowns
  if (hasPfs && !fromVal && !toVal) {
    const fromSelect = div.querySelector('.batch-select-from');
    const toSelect   = div.querySelector('.batch-select-to');
    if (fromSelect && toSelect && toSelect.options.length > 0) {
      toSelect.selectedIndex = toSelect.options.length - 1;
    }
  }
}

async function saveMyBatches() {
  const container = document.getElementById('edit-batch-ranges-container');
  if (!container) return;

  const rows = container.querySelectorAll('.batch-row');
  const batches = [];

  for (const row of rows) {
    const fromPF = row.querySelector('.batch-select-from')?.value.trim();
    const toPF   = row.querySelector('.batch-select-to')?.value.trim();
    if (!fromPF || !toPF) {
      showToast('All fields in ranges are required', 'warning', '⚠️');
      return;
    }
    const cleanFrom = normalizePF(fromPF);
    const cleanTo   = normalizePF(toPF);
    if (!cleanFrom || !cleanTo) {
      showToast('Invalid PF number format', 'error', '✕');
      return;
    }
    if (parseInt(cleanFrom, 10) > parseInt(cleanTo, 10)) {
      showToast('Invalid range: PF ' + cleanFrom + ' is larger than PF ' + cleanTo, 'error', '✕');
      return;
    }
    batches.push({ from: cleanFrom, to: cleanTo });
  }

  if (batches.length === 0) {
    showToast('At least one batch range is required', 'warning', '⚠️');
    return;
  }

  // Check for overlaps in the list itself
  for (let i = 0; i < batches.length; i++) {
    for (let j = i + 1; j < batches.length; j++) {
      const a = batches[i], b = batches[j];
      if (parseInt(a.from, 10) <= parseInt(b.to, 10) && parseInt(b.from, 10) <= parseInt(a.to, 10)) {
        showToast('Ranges overlap each other: ' + a.from + '-' + a.to + ' and ' + b.from + '-' + b.to, 'error', '✕');
        return;
      }
    }
  }

  showLoading('Saving new batch configurations…');
  try {
    const data = await apiPost('updatebatches', { batches });
    hideLoading();

    // Update state and localStorage
    if (state.currentUser) {
      state.currentUser.batches = batches;
      localStorage.setItem('pfcensus_user', JSON.stringify(state.currentUser));
    }

    closeEditBatchesModal();
    showMainApp();
    await loadStats();

    showToast('Success! Loaded ' + data.count + ' files in new batches.', 'success', '🎉');
  } catch (e) {
    hideLoading();
    showToast('Failed to save: ' + e.message, 'error', '✕');
  }
}

// ── Remove PF from Batch ──────────────────────────────────────
function confirmRemovePF() {
  if (!state.currentResult) return;
  const pf   = state.currentResult.pf;
  const name = state.currentResult.name || 'this file';
  
  const msg = `⚠️ WARNING: This will permanently REMOVE PF ${pf} (${name}) from your batch sheet. \n\nUse this only if the PF was incorrectly included in your range or belongs to another colleague.\n\nAre you sure you want to proceed?`;
  
  if (window.confirm(msg)) {
    removePF(pf);
  }
}

async function removePF(pf) {
  showLoading('Removing PF ' + pf + ' from your sheet…');
  try {
    const data = await apiPost('removepf', { pf });
    hideLoading();
    
    // Clear result card
    clearResult();
    
    // Show success toast
    showToast(`PF ${pf} (${data.name || ''}) successfully removed from your batch!`, 'success', '🗑');
    
    // Refresh the app stats and search context
    await loadStats();
  } catch (e) {
    hideLoading();
    showToast('Error removing PF: ' + e.message, 'error', '✕');
  }
}



