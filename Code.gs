// ============================================================
// Code.gs  –  Google Apps Script Backend for PF Census App
// ============================================================
// HOW TO INSTALL:
//   1. Open your Google Sheet
//   2. Click Extensions > Apps Script
//   3. Delete any existing code and paste this entire file
//   4. Click Save, then Deploy > New deployment
//   5. Web app | Execute as: Me | Who has access: Anyone
// ============================================================

// ── Configuration ─────────────────────────────────────────────
const SPREADSHEET_ID  = '1-MpfWf3JqVAxdwo59eV6wd2Lv37YN-wa';
const SHEET_NAME      = 'Sheet1';     // ← Your main biodata sheet tab name
const HISTORY_SHEET   = 'Census History'; // ← Auto-created history tab name
const HEADER_ROW      = 1;
const DATA_START_ROW  = 2;

// Column numbers in the MAIN sheet (1=A, 2=B … 10=J)
const COL_PF       = 1;   // A – PF Number
const COL_NAME     = 2;   // B – Employee Name
const COL_DEPT     = 3;   // C – Department
const COL_DESIG    = 4;   // D – Designation
const COL_DATETIME = 5;   // E – Date & Time of last mark
const COL_STATUS   = 6;   // F – Last status (PRESENT/ABSENT)
const COL_FILE_ACT = 7;   // G – File Status (ACTIVE / EXIT)
const COL_CUSTODY  = 8;   // H – Custody location
const COL_ROUND    = 9;   // I – Last census month (e.g. "July 2026")
const COL_FLAG     = 10;  // J – Census flag (PRESENT / MISSING)

// ── GET handler ───────────────────────────────────────────────
function doGet(e) {
  const action = (e.parameter.action || 'ping').toLowerCase();
  try {
    let result;
    if      (action === 'search') result = searchPF(e.parameter.pf || '');
    else if (action === 'stats')  result = getStats(e.parameter.round || currentMonth());
    else if (action === 'ping')   result = { status: 'ok', message: 'PF Census backend is running ✓' };
    else                          result = { error: 'Unknown action: ' + action };
    return jsonOk(result);
  } catch (err) {
    return jsonError(err.message);
  }
}

// ── POST handler ──────────────────────────────────────────────
function doPost(e) {
  try {
    const data   = JSON.parse(e.postData.contents || '{}');
    const action = (data.action || '').toLowerCase();
    let result;
    if      (action === 'mark')  result = markPresent(data);
    else if (action === 'audit') result = runAudit(data.round || currentMonth());
    else                         result = { error: 'Unknown action: ' + action };
    return jsonOk(result);
  } catch (err) {
    return jsonError(err.message);
  }
}

// ── Current Month helper ──────────────────────────────────────
// Returns e.g. "July 2026"
function currentMonth() {
  const now = new Date();
  return Utilities.formatDate(now, Session.getScriptTimeZone(), 'MMMM yyyy');
}

// ── Search for a PF number ────────────────────────────────────
function searchPF(pfInput) {
  if (!pfInput) return { found: false, error: 'No PF number provided' };
  const sheet = getSheet(SHEET_NAME);
  const data  = sheet.getDataRange().getValues();
  const query = normalize(pfInput);

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const rowPF = normalize(String(data[i][COL_PF - 1]));
    if (rowPF === query || rowPF === padPF(query)) {
      const status   = normalize(data[i][COL_STATUS   - 1] || '');
      const fileAct  = normalize(data[i][COL_FILE_ACT - 1] || 'ACTIVE') || 'ACTIVE';
      const custody  = normalize(data[i][COL_CUSTODY  - 1] || 'REGISTRY') || 'REGISTRY';
      const lastDT   = data[i][COL_DATETIME - 1];
      const flag     = normalize(data[i][COL_FLAG     - 1] || '');
      const round    = String(data[i][COL_ROUND - 1] || '').trim();

      return {
        found:        true,
        rowIndex:     i + 1,
        pf:           String(data[i][COL_PF    - 1]).trim(),
        name:         String(data[i][COL_NAME  - 1] || '').trim(),
        department:   String(data[i][COL_DEPT  - 1] || '').trim(),
        designation:  String(data[i][COL_DESIG - 1] || '').trim(),
        status:       status,
        isPresent:    status === 'PRESENT',
        lastDateTime: lastDT ? formatDate(lastDT) : '',
        fileStatus:   fileAct,
        custody:      custody,
        flag:         flag,
        lastRound:    round,
      };
    }
  }
  return { found: false, pf: pfInput };
}

// ── Mark a PF as PRESENT ──────────────────────────────────────
function markPresent(params) {
  const pfInput    = params.pf;
  const fileStatus = params.fileStatus || 'ACTIVE';
  const custody    = params.custody    || 'REGISTRY';
  const round      = params.round      || currentMonth();

  if (!pfInput) return { success: false, error: 'No PF number provided' };

  const sheet = getSheet(SHEET_NAME);
  const data  = sheet.getDataRange().getValues();
  const tz    = Session.getScriptTimeZone();
  const now   = new Date();
  const timestamp = Utilities.formatDate(now, tz, 'dd/MM/yyyy HH:mm:ss');
  const query = normalize(pfInput);

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const rowPF = normalize(String(data[i][COL_PF - 1]));
    if (rowPF === query || rowPF === padPF(query)) {
      const name = String(data[i][COL_NAME - 1] || '').trim();

      // Write to main sheet
      sheet.getRange(i + 1, COL_DATETIME).setValue(timestamp);
      sheet.getRange(i + 1, COL_STATUS).setValue('PRESENT');
      sheet.getRange(i + 1, COL_FILE_ACT).setValue(fileStatus);
      sheet.getRange(i + 1, COL_CUSTODY).setValue(custody);
      sheet.getRange(i + 1, COL_ROUND).setValue(round);
      sheet.getRange(i + 1, COL_FLAG).setValue('PRESENT');

      // Append to history sheet for permanent tracking
      logToHistory(pfInput, name, fileStatus, custody, round, timestamp);

      SpreadsheetApp.flush();

      return {
        success:    true,
        pf:         String(data[i][COL_PF - 1]).trim(),
        name:       name,
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

// ── Log every mark event to "Census History" sheet ────────────
function logToHistory(pf, name, fileStatus, custody, round, timestamp) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let hist = ss.getSheetByName(HISTORY_SHEET);

    // Create the history sheet if it doesn't exist
    if (!hist) {
      hist = ss.insertSheet(HISTORY_SHEET);
      hist.appendRow(['Timestamp', 'PF Number', 'Employee Name',
                      'File Status', 'Custody', 'Census Month']);
      hist.getRange(1, 1, 1, 6).setFontWeight('bold');
    }

    hist.appendRow([timestamp, pf, name, fileStatus, custody, round]);
  } catch (e) {
    // History logging failure should not block marking
    Logger.log('History log error: ' + e.message);
  }
}

// ── Run Audit: flag active files missing in the current month ──
function runAudit(currentRound) {
  const sheet = getSheet(SHEET_NAME);
  const data  = sheet.getDataRange().getValues();
  let flaggedCount = 0;
  let alreadyPresent = 0;

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const pf      = String(data[i][COL_PF      - 1]).trim();
    const fileAct = normalize(data[i][COL_FILE_ACT - 1] || 'ACTIVE') || 'ACTIVE';
    const rowRound = String(data[i][COL_ROUND   - 1] || '').trim();
    const flag     = normalize(data[i][COL_FLAG  - 1] || '');

    if (!pf) continue;

    // Only audit ACTIVE files
    if (fileAct !== 'ACTIVE') continue;

    if (rowRound === currentRound && flag === 'PRESENT') {
      alreadyPresent++;
    } else {
      // Not seen in this month's census → MISSING
      sheet.getRange(i + 1, COL_FLAG).setValue('MISSING');
      flaggedCount++;
    }
  }

  SpreadsheetApp.flush();
  return { success: true, flaggedCount: flaggedCount, alreadyPresent: alreadyPresent };
}

// ── Get census statistics for the given month ─────────────────
function getStats(round) {
  const sheet = getSheet(SHEET_NAME);
  const data  = sheet.getDataRange().getValues();
  let total = 0, present = 0, missing = 0;

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const pf = String(data[i][COL_PF - 1]).trim();
    if (!pf) continue;
    total++;

    const rowRound = String(data[i][COL_ROUND - 1] || '').trim();
    const flag     = normalize(data[i][COL_FLAG - 1] || '');

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
    absent:  total - present - missing,
    percent: total > 0 ? Math.round((present / total) * 100) : 0,
    round:   round,
  };
}

// ── Utilities ──────────────────────────────────────────────────
function getSheet(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(name) || ss.getSheets()[0];
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
