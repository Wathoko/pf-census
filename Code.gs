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
const COL_PF       = 1;  // A  – PF Number
const COL_NAME     = 2;  // B  – Employee Name
const COL_DEPT     = 3;  // C  – Department
const COL_DESIG    = 4;  // D  – Designation
const COL_DATETIME = 5;  // E  – Date & Time stamp
const COL_STATUS   = 6;  // F  – PRESENT / ABSENT

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
    else if (action === 'stats')  result = getStats();
    else if (action === 'list')   result = getMarkedList();
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
    if      (action === 'mark')   result = markPresent(data.pf || '', data.markedBy || '');
    else if (action === 'unmark') result = unmarkPF(data.pf || '');
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
      const status    = String(data[i][COL_STATUS - 1] || '').toUpperCase().trim();
      const lastDT    = data[i][COL_DATETIME - 1];
      return {
        found:       true,
        rowIndex:    i + 1,
        pf:          String(data[i][COL_PF - 1]).trim(),
        name:        String(data[i][COL_NAME - 1]  || '').trim(),
        department:  String(data[i][COL_DEPT - 1]  || '').trim(),
        designation: String(data[i][COL_DESIG - 1] || '').trim(),
        status:      status,
        isPresent:   status === 'PRESENT',
        lastDateTime: lastDT ? formatDate(lastDT) : '',
      };
    }
  }

  return { found: false, pf: pfInput };
}

// ── Mark a PF as PRESENT ──────────────────────────────────────
function markPresent(pfInput, markedBy) {
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

      SpreadsheetApp.flush();   // force immediate write

      return {
        success:   true,
        pf:        String(data[i][COL_PF - 1]).trim(),
        name:      String(data[i][COL_NAME - 1] || '').trim(),
        timestamp: timestamp,
        row:       i + 1,
      };
    }
  }

  return { success: false, error: 'PF not found: ' + pfInput };
}

// ── Unmark a PF (remove PRESENT status) ──────────────────────
function unmarkPF(pfInput) {
  if (!pfInput) return { success: false, error: 'No PF number provided' };

  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();
  const query = normalize(pfInput);

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const rowPF = normalize(String(data[i][COL_PF - 1]));
    if (rowPF === query || rowPF === padPF(query)) {
      sheet.getRange(i + 1, COL_DATETIME).setValue('');
      sheet.getRange(i + 1, COL_STATUS).setValue('');
      SpreadsheetApp.flush();
      return { success: true, pf: pfInput };
    }
  }

  return { success: false, error: 'PF not found: ' + pfInput };
}

// ── Get census statistics ─────────────────────────────────────
function getStats() {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();

  let total = 0, present = 0;

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const pf = String(data[i][COL_PF - 1]).trim();
    if (!pf || pf === '') continue;
    total++;
    const status = String(data[i][COL_STATUS - 1] || '').toUpperCase().trim();
    if (status === 'PRESENT') present++;
  }

  return {
    total:   total,
    present: present,
    absent:  total - present,
    percent: total > 0 ? Math.round((present / total) * 100) : 0,
  };
}

// ── Get list of all marked-present files ──────────────────────
function getMarkedList() {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();
  const items = [];

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const status = String(data[i][COL_STATUS - 1] || '').toUpperCase().trim();
    if (status === 'PRESENT') {
      items.push({
        pf:         String(data[i][COL_PF - 1]).trim(),
        name:       String(data[i][COL_NAME - 1] || '').trim(),
        department: String(data[i][COL_DEPT - 1] || '').trim(),
        datetime:   String(data[i][COL_DATETIME - 1] || '').trim(),
      });
    }
  }

  return { items: items, count: items.length };
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
  // Pad numeric PF numbers to 4 digits: "42" → "0042"
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
