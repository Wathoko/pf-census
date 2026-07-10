// ============================================================
// Code.gs  –  Google Apps Script Backend for PF Census App
// ============================================================
// HOW TO USE:
//   1. Open your Google Sheet
//   2. Click Extensions > Apps Script
//   3. Delete all existing code, paste this entire file
//   4. Click Save (Ctrl+S)
//   5. Click Deploy > New deployment > Web app
//      Execute as: Me | Who has access: Anyone
//   6. Copy the new Web app URL into the mobile app
// ============================================================

// ── Configuration ──────────────────────────────────────────────
// ⚠ SPREADSHEET ID: copy from your sheet's browser URL bar
//   URL looks like: docs.google.com/spreadsheets/d/XXXXX/edit
//   Paste the XXXXX part below:
const SPREADSHEET_ID = '1OYm38agHG4Dg6Dlxmv_8atXKuqF_da4jCksmNBBKLDY';
const SHEET_NAME     = 'Employee Biodata'; // ← exact tab name at bottom of your sheet
const HISTORY_SHEET  = 'Census History';   // auto-created log tab
const DATA_START_ROW = 2;                  // row 1 = headers, data starts row 2

// ── Column numbers (1=A, 2=B, 3=C …) ──────────────────────────
// READ-ONLY columns (already in your sheet):
const COL_PF          = 1;  // A – PF Number
const COL_HR_STATUS   = 2;  // B – HR Status (Active / Exited)
const COL_NAME        = 3;  // C – Employee Name
const COL_PHONE       = 4;  // D – Phone Number

// WRITE columns (app fills these in during census):
const COL_DATETIME    = 5;  // E – Date & Time of last mark
const COL_PRESENT     = 6;  // F – PRESENT status
const COL_CUSTODY     = 7;  // G – Custody location
const COL_ROUND       = 8;  // H – Census month (e.g. "July 2026")
const COL_FLAG        = 9;  // I – Census flag: PRESENT or MISSING

// ── GET handler ────────────────────────────────────────────────
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

// ── POST handler ───────────────────────────────────────────────
function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents || '{}');
    const action = (body.action || '').toLowerCase();
    let result;
    if      (action === 'mark')  result = markPresent(body);
    else if (action === 'audit') result = runAudit(body.round || currentMonth());
    else                         result = { error: 'Unknown action: ' + action };
    return jsonOk(result);
  } catch (err) {
    return jsonError(err.message);
  }
}

// ── Returns current month label e.g. "July 2026" ───────────────
function currentMonth() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM yyyy');
}

// ── Search for a PF number ─────────────────────────────────────
function searchPF(pfInput) {
  if (!pfInput) return { found: false, error: 'No PF number provided' };

  const sheet = getMainSheet();
  const data  = sheet.getDataRange().getValues();
  const query = normalizePF(pfInput);

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const rowPF = normalizePF(String(data[i][COL_PF - 1]));
    if (rowPF !== query) continue;

    const hrStatus  = String(data[i][COL_HR_STATUS - 1] || '').trim();
    const name      = String(data[i][COL_NAME      - 1] || '').trim();
    const phone     = String(data[i][COL_PHONE     - 1] || '').trim();
    const lastDT    = data[i][COL_DATETIME - 1];
    const present   = String(data[i][COL_PRESENT   - 1] || '').trim().toUpperCase();
    const custody   = String(data[i][COL_CUSTODY   - 1] || 'REGISTRY').trim().toUpperCase();
    const round     = String(data[i][COL_ROUND     - 1] || '').trim();
    const flag      = String(data[i][COL_FLAG      - 1] || '').trim().toUpperCase();

    return {
      found:        true,
      pf:           String(data[i][COL_PF - 1]).trim(),
      name:         name,
      hrStatus:     hrStatus,   // Active / Exited (from Column B)
      phone:        phone,
      isPresent:    present === 'PRESENT',
      lastDateTime: lastDT ? formatDate(lastDT) : '',
      custody:      custody || 'REGISTRY',
      lastRound:    round,
      flag:         flag,
    };
  }

  return { found: false, pf: pfInput };
}

// ── Mark a PF as PRESENT ───────────────────────────────────────
function markPresent(params) {
  const pfInput = params.pf;
  const custody = (params.custody || 'REGISTRY').toString().trim().toUpperCase();
  const round   = (params.round   || currentMonth()).toString().trim();

  if (!pfInput) return { success: false, error: 'No PF number provided' };

  const sheet = getMainSheet();
  const data  = sheet.getDataRange().getValues();
  const tz    = Session.getScriptTimeZone();
  const now   = new Date();
  const ts    = Utilities.formatDate(now, tz, 'dd/MM/yyyy HH:mm:ss');
  const query = normalizePF(pfInput);

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const rowPF = normalizePF(String(data[i][COL_PF - 1]));
    if (rowPF !== query) continue;

    const name    = String(data[i][COL_NAME - 1] || '').trim();
    const hrStatus = String(data[i][COL_HR_STATUS - 1] || '').trim();

    // Write census data to the sheet immediately
    sheet.getRange(i + 1, COL_DATETIME).setValue(ts);
    sheet.getRange(i + 1, COL_PRESENT).setValue('PRESENT');
    sheet.getRange(i + 1, COL_CUSTODY).setValue(custody);
    sheet.getRange(i + 1, COL_ROUND).setValue(round);
    sheet.getRange(i + 1, COL_FLAG).setValue('PRESENT');

    // Force Google Sheets to write immediately (real-time update fix)
    SpreadsheetApp.flush();

    // Log to history tab
    logToHistory(String(data[i][COL_PF - 1]).trim(), name, hrStatus, custody, round, ts);

    return {
      success:   true,
      pf:        String(data[i][COL_PF - 1]).trim(),
      name:      name,
      timestamp: ts,
      custody:   custody,
      round:     round,
    };
  }

  return { success: false, error: 'PF ' + pfInput + ' not found in sheet' };
}

// ── Append every mark to the Census History tab ────────────────
function logToHistory(pf, name, hrStatus, custody, round, timestamp) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let hist = ss.getSheetByName(HISTORY_SHEET);
    if (!hist) {
      hist = ss.insertSheet(HISTORY_SHEET);
      hist.appendRow(['Timestamp', 'PF Number', 'Employee Name',
                      'HR Status', 'Custody', 'Census Month']);
      hist.getRange(1, 1, 1, 6).setFontWeight('bold');
    }
    hist.appendRow([timestamp, pf, name, hrStatus, custody, round]);
  } catch (e) {
    Logger.log('History log error: ' + e.message);
  }
}

// ── Audit: flag ACTIVE files not yet seen this month as MISSING ─
function runAudit(currentRound) {
  const sheet = getMainSheet();
  const data  = sheet.getDataRange().getValues();
  let flagged = 0, alreadyPresent = 0;

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const pf       = String(data[i][COL_PF - 1]).trim();
    const hrStatus = String(data[i][COL_HR_STATUS - 1] || '').trim().toLowerCase();
    const rowRound = String(data[i][COL_ROUND - 1] || '').trim();
    const flag     = String(data[i][COL_FLAG  - 1] || '').trim().toUpperCase();

    if (!pf) continue;
    if (hrStatus === 'exited') continue; // Skip exited employees

    if (rowRound === currentRound && flag === 'PRESENT') {
      alreadyPresent++;
    } else {
      sheet.getRange(i + 1, COL_FLAG).setValue('MISSING');
      flagged++;
    }
  }

  SpreadsheetApp.flush();
  return { success: true, flaggedCount: flagged, alreadyPresent: alreadyPresent };
}

// ── Get census statistics ──────────────────────────────────────
function getStats(round) {
  const sheet = getMainSheet();
  const data  = sheet.getDataRange().getValues();
  let total = 0, present = 0, missing = 0;

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const pf       = String(data[i][COL_PF - 1]).trim();
    const hrStatus = String(data[i][COL_HR_STATUS - 1] || '').trim().toLowerCase();
    if (!pf || hrStatus === 'exited') continue;
    total++;

    const rowRound = String(data[i][COL_ROUND - 1] || '').trim();
    const flag     = String(data[i][COL_FLAG  - 1] || '').trim().toUpperCase();

    if (rowRound === round && flag === 'PRESENT') present++;
    else if (flag === 'MISSING') missing++;
  }

  return {
    total:   total,
    present: present,
    missing: missing,
    percent: total > 0 ? Math.round((present / total) * 100) : 0,
    round:   round,
  };
}

// ── Helpers ────────────────────────────────────────────────────
function getMainSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
}

// Normalize PF: trim, uppercase, pad numbers to 4 digits
function normalizePF(raw) {
  const s = String(raw).trim().toUpperCase();
  return /^\d+$/.test(s) ? s.padStart(4, '0') : s;
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

function jsonError(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
