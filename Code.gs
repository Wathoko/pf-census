// ============================================================
// Code.gs  –  Google Apps Script Backend for PF Census App
// ============================================================
// HOW TO INSTALL:
//   1. Open your Google Sheet
//   2. Click Extensions > Apps Script
//   3. Delete any existing code
//   4. Paste this entire file
//   5. Click Save (💾), then Deploy > New deployment
//   6. Type: Web app | Execute as: Me | Who has access: Anyone
//   7. Click Deploy, copy the URL, paste it into the mobile app
// ============================================================

// ── Configuration ────────────────────────────────────────────
const SPREADSHEET_ID  = '1-MpfWf3JqVAxdwo59eV6wd2Lv37YN-wa';
const SHEET_NAME      = 'Sheet1';   // ← Change to your exact tab name if different
const HEADER_ROW      = 1;
const DATA_START_ROW  = 2;

// Column numbers (1 = A, 2 = B, 3 = C, 4 = D, 5 = E, 6 = F …)
const COL_PF       = 1;  // A – PF Number
const COL_NAME     = 2;  // B – Employee Name
const COL_DEPT     = 3;  // C – Department
const COL_DESIG    = 4;  // D – Designation
const COL_DATETIME = 5;  // E – Date & Time stamp
const COL_STATUS   = 6;  // F – PRESENT / ABSENT
const COL_FILE_ACT = 7;  // G – File Status (ACTIVE / EXIT)
const COL_CUSTODY  = 8;  // H – Custody (CEOS OFFICE, etc.)
const COL_ROUND    = 9;  // I – Census Round (1st Census, 2nd Census)
const COL_FLAG     = 10; // J – Census Flag (PRESENT / MISSING)

// ── CORS Headers helper ───────────────────────────────────────
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// ── GET handler ───────────────────────────────────────────────
function doGet(e) {
  const action = (e.parameter.action || 'ping').toLowerCase();

  try {
    let result;
    if      (action === 'search') result = searchPF(e.parameter.pf || '');
    else if (action === 'stats')  result = getStats(e.parameter.round || '1st Census');
    else if (action === 'ping')   result = { status: 'ok', message: 'PF Census backend is running ✓' };
    else                          result = { error: 'Unknown action: ' + action };
    return jsonOk(result);
  } catch (err) {
    return jsonError(err.message);
  }
}

// ── POST handler ─────────────────────────────────────────────
function doPost(e) {
  try {
    const data   = JSON.parse(e.postData.contents || '{}');
    const action = (data.action || '').toLowerCase();

    let result;
    if      (action === 'mark')   result = markPresent(data);
    else if (action === 'audit')  result = runAudit(data.round || '2nd Census');
    else                          result = { error: 'Unknown action: ' + action };

    return jsonOk(result);
  } catch (err) {
    return jsonError(err.message);
  }
}

// ── Search for a PF number ────────────────────────────────────
function searchPF(pfInput) {
  if (!pfInput) return { found: false, error: 'No PF number provided' };

  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();
  const query = normalize(pfInput);

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const rowPF = normalize(String(data[i][COL_PF - 1]));
    if (rowPF === query || rowPF === padPF(query)) {
      const status     = String(data[i][COL_STATUS - 1] || '').toUpperCase().trim();
      const fileAct    = String(data[i][COL_FILE_ACT - 1] || 'ACTIVE').toUpperCase().trim();
      const custody    = String(data[i][COL_CUSTODY - 1] || 'REGISTRY').toUpperCase().trim();
      const lastDT     = data[i][COL_DATETIME - 1];
      const flag       = String(data[i][COL_FLAG - 1] || '').toUpperCase().trim();
      const round      = String(data[i][COL_ROUND - 1] || '').trim();

      return {
        found:        true,
        rowIndex:     i + 1,
        pf:           String(data[i][COL_PF - 1]).trim(),
        name:         String(data[i][COL_NAME - 1]  || '').trim(),
        department:   String(data[i][COL_DEPT - 1]  || '').trim(),
        designation:  String(data[i][COL_DESIG - 1] || '').trim(),
        status:       status,
        isPresent:    status === 'PRESENT',
        lastDateTime: lastDT ? formatDate(lastDT) : '',
        fileStatus:   fileAct,
        custody:      custody,
        flag:         flag,
        round:        round
      };
    }
  }

  return { found: false, pf: pfInput };
}

// ── Mark a PF as PRESENT ──────────────────────────────────────
function markPresent(params) {
  const pfInput     = params.pf;
  const fileStatus  = params.fileStatus || 'ACTIVE';
  const custody     = params.custody || 'REGISTRY';
  const round       = params.round || '1st Census';

  if (!pfInput) return { success: false, error: 'No PF number provided' };

  const sheet     = getSheet();
  const data      = sheet.getDataRange().getValues();
  const query     = normalize(pfInput);
  const tz        = Session.getScriptTimeZone();
  const now       = new Date();
  const timestamp = Utilities.formatDate(now, tz, 'dd/MM/yyyy HH:mm:ss');

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const rowPF = normalize(String(data[i][COL_PF - 1]));
    if (rowPF === query || rowPF === padPF(query)) {
      sheet.getRange(i + 1, COL_DATETIME).setValue(timestamp);
      sheet.getRange(i + 1, COL_STATUS).setValue('PRESENT');
      sheet.getRange(i + 1, COL_FILE_ACT).setValue(fileStatus);
      sheet.getRange(i + 1, COL_CUSTODY).setValue(custody);
      sheet.getRange(i + 1, COL_ROUND).setValue(round);
      sheet.getRange(i + 1, COL_FLAG).setValue('PRESENT');

      SpreadsheetApp.flush(); // Force immediate update

      return {
        success:    true,
        pf:         String(data[i][COL_PF - 1]).trim(),
        name:       String(data[i][COL_NAME - 1] || '').trim(),
        timestamp:  timestamp,
        fileStatus: fileStatus,
        custody:    custody,
        round:      round,
        row:        i + 1,
      };
    }
  }

  return { success: false, error: 'PF not found: ' + pfInput };
}

// ── Run Audit to flag missing files ───────────────────────────
// Flags active files that are NOT marked PRESENT in the current round
function runAudit(currentRound) {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();
  let flaggedCount = 0;

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const pf        = String(data[i][COL_PF - 1]).trim();
    const fileAct   = String(data[i][COL_FILE_ACT - 1] || 'ACTIVE').toUpperCase().trim();
    const rowRound  = String(data[i][COL_ROUND - 1] || '').trim();
    const flag      = String(data[i][COL_FLAG - 1] || '').toUpperCase().trim();

    if (!pf) continue;

    // If file is ACTIVE, but not marked PRESENT in the current round
    if (fileAct === 'ACTIVE' && (rowRound !== currentRound || flag !== 'PRESENT')) {
      sheet.getRange(i + 1, COL_FLAG).setValue('MISSING');
      flaggedCount++;
    }
  }

  SpreadsheetApp.flush();
  return { success: true, flaggedCount: flaggedCount };
}

// ── Get census statistics ─────────────────────────────────────
function getStats(round) {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();

  let total = 0, present = 0, missing = 0;

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const pf = String(data[i][COL_PF - 1]).trim();
    if (!pf) continue;
    total++;

    const rowRound = String(data[i][COL_ROUND - 1] || '').trim();
    const flag     = String(data[i][COL_FLAG - 1] || '').toUpperCase().trim();

    if (rowRound === round && flag === 'PRESENT') {
      present++;
    } else if (flag === 'MISSING') {
      missing++;
    }
  }

  return {
    total:   total,
    present: present,
    missing: missing,
    absent:  total - present,
    percent: total > 0 ? Math.round((present / total) * 100) : 0,
  };
}

// ── Utilities ─────────────────────────────────────────────────
function getSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
}

function normalize(str) {
  return String(str).trim().toUpperCase();
}

function padPF(str) {
  if (/^\d+$/.test(str)) return str.padStart(4, '0');
  return str;
}

function formatDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
  }
  return String(val);
}

function jsonOk(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError(message) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: message }))
    .setMimeType(ContentService.MimeType.JSON);
}
