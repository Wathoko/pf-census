// ============================================================
// Code.gs  –  Google Apps Script Backend  |  PF Census App
// ============================================================
// Sheet structure expected (per-user tab):
//   A = PF Number          B = HR Status (Active/Exited)
//   C = Employee Name      D = Phone
//   E = Date/Time Stamp    F = Census Flag (PRESENT / MISSING / LOCATED)
//   G = Custody Location   H = Census Round (e.g. "July 2026")
//   I = File Status (ACTIVE / EXIT)  J = Missing Count (0,1,2,…)
//
// Global tabs (auto-created):
//   "Census History"       – every mark event log
//   "File Movement History"– every location change log
// ============================================================

const COL_PF           = 1;   // A
const COL_HR_STATUS    = 2;   // B
const COL_NAME         = 3;   // C
const COL_PHONE        = 4;   // D
const COL_DATETIME     = 5;   // E
const COL_FLAG         = 6;   // F  PRESENT / MISSING / LOCATED
const COL_CUSTODY      = 7;   // G
const COL_ROUND        = 8;   // H  "July 2026"
const COL_FILE_STATUS  = 9;   // I  ACTIVE / EXIT
const COL_MISSING_CNT  = 10;  // J  cumulative missing-census count

const DATA_START_ROW   = 2;   // row 1 = header

// ── Super Admin List ────────────────────────────────────────
// These users can view ALL sheets and access the compiled report.
const SUPER_ADMINS = ['MARGARET', 'SARAH', 'MACHARIA'];

function isSuperAdmin(username) {
  return SUPER_ADMINS.includes((username || '').toUpperCase().trim());
}

// Returns all user sheet names (excludes system tabs)
function getUserSheetNames() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const SYSTEM_TABS = ['Main DBase', 'Census History', 'File Movement History'];
  return ss.getSheets()
    .map(s => s.getName())
    .filter(n => !SYSTEM_TABS.includes(n));
}

// ── Helpers ─────────────────────────────────────────────────
function normalizePF(v) {
  return String(v || '').trim().replace(/[^0-9]/g, '').padStart(4, '0');
}

function fmtDate(d) {
  if (!d) return '';
  try {
    const dt = (d instanceof Date) ? d : new Date(d);
    return Utilities.formatDate(dt, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
  } catch (e) { return String(d); }
}

function currentMonth() {
  const now = new Date();
  const mo  = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
  return mo[now.getMonth()] + ' ' + now.getFullYear();
}

function ts() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
}

// ── CORS Headers ─────────────────────────────────────────────
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

function ok(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, ...data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function err(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: String(msg) }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── doGet ────────────────────────────────────────────────────
function doGet(e) {
  try {
    const p        = e.parameter || {};
    const action   = (p.action   || '').toLowerCase();
    const username = (p.username || '').trim();
    const pf       = (p.pf       || '').trim();
    const round    = (p.round    || currentMonth()).trim();

    if (action === 'lookup')          return ok(lookupPF(pf, username));
    if (action === 'getstats')         return ok(getStats(username, round));
    if (action === 'getregistry')      return ok(getRegistry(username));
    if (action === 'report')           return ok(getReport(username, round));
    if (action === 'missingalerts')    return ok(getMissingAlerts(username));
    if (action === 'movementlog')      return ok(getMovementLog(pf));
    if (action === 'censustimeline')   return ok(getCensusTimeline(pf));
    if (action === 'compiledreport')   return ok(getCompiledReport(username, round));
    if (action === 'getallpfs')         return ok(getAllPFs());
    if (action === 'ping')             return ok({ message: 'PF Census backend is online', month: currentMonth(), isAdmin: isSuperAdmin(username) });


    return err('Unknown action: ' + action);
  } catch (ex) {
    return err(ex.message);
  }
}

// ── doPost ───────────────────────────────────────────────────
function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents || '{}');
    const action = (body.action || '').toLowerCase();

    if (action === 'register')        return ok(registerUser(body));
    if (action === 'login')           return ok(loginUser(body));
    if (action === 'markpresent')     return ok(markPresent(body));
    if (action === 'runaudit')        return ok(runAudit(body));
    if (action === 'updatelocation')  return ok(updateLocation(body));
    if (action === 'updatebatches')    return ok(updateBatches(body));

    return err('Unknown action: ' + action);
  } catch (ex) {
    return err(ex.message);
  }
}


// ── registerUser ─────────────────────────────────────────────
function registerUser(p) {
  const firstName = String(p.firstName || '').trim().toUpperCase();
  const pf        = normalizePF(p.pf);
  const mobile    = String(p.mobile || '').trim();
  const idNo      = String(p.idNo   || '').trim();
  const batches   = (p.batches || []).map(b => ({
    from: normalizePF(b.from),
    to:   normalizePF(b.to)
  }));

  if (!firstName || !pf || !mobile || !idNo)
    throw new Error('All fields are required');
  if (!batches.length)
    throw new Error('At least one batch range is required');

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Check duplicate PF across other users (excluding this user)
  const allSheets = ss.getSheets();
  for (const sh of allSheets) {
    if (sh.getName().toUpperCase() === firstName) continue; // skip own sheet
    const meta = sh.getDeveloperMetadata();
    for (const m of meta) {
      if (m.getKey() === 'pf' && m.getValue() === pf)
        throw new Error('PF ' + pf + ' is already registered under another user.');
    }
  }

  // Find user sheet case-insensitively
  let userSheet = null;
  for (const sh of allSheets) {
    if (sh.getName().toUpperCase() === firstName) {
      userSheet = sh;
      break;
    }
  }

  // Backup existing markings if the sheet already exists
  const markingsBackup = {};
  if (userSheet) {
    const existingData = userSheet.getDataRange().getValues();
    // Start from row 2 (row index 1)
    for (let i = 1; i < existingData.length; i++) {
      const rowPF = normalizePF(existingData[i][COL_PF - 1]);
      if (!rowPF) continue;
      markingsBackup[rowPF] = {
        datetime:     existingData[i][COL_DATETIME - 1],
        flag:         existingData[i][COL_FLAG - 1],
        custody:      existingData[i][COL_CUSTODY - 1],
        round:        existingData[i][COL_ROUND - 1],
        fileStatus:   existingData[i][COL_FILE_STATUS - 1],
        missingCount: existingData[i][COL_MISSING_CNT - 1],
      };
    }
  }

  const master = ss.getSheetByName('Main DBase');
  if (!master) throw new Error('"Main DBase" tab not found');
  const masterData = master.getDataRange().getValues();
  if (masterData.length < 2) throw new Error('"Main DBase" sheet contains no data rows');

  // Filter master rows matching the user's batches
  const filteredRows = [];
  // Row 1 = header row
  const masterHeader = masterData[0];
  
  for (let i = 1; i < masterData.length; i++) {
    const empPF = normalizePF(masterData[i][COL_PF - 1]);
    const empVal = parseInt(empPF, 10);
    if (isNaN(empVal)) continue;

    // Check if employee falls inside any of the user's batch ranges
    const match = batches.some(b => empVal >= parseInt(b.from, 10) && empVal <= parseInt(b.to, 10));
    if (!match) continue;

    const backup = markingsBackup[empPF] || {};
    
    // Construct the 10-column row format:
    // A=PF, B=HR Status, C=Name, D=Phone, E=DateTime, F=Flag, G=Custody, H=Round, I=FileStatus, J=MissingCount
    const row = new Array(10).fill('');
    row[COL_PF - 1]          = masterData[i][COL_PF - 1];          // A
    row[COL_HR_STATUS - 1]   = masterData[i][COL_HR_STATUS - 1];   // B
    row[COL_NAME - 1]        = masterData[i][COL_NAME - 1];        // C
    row[COL_PHONE - 1]       = masterData[i][COL_PHONE - 1];       // D
    row[COL_DATETIME - 1]    = backup.datetime || '';              // E
    row[COL_FLAG - 1]        = backup.flag || '';                  // F
    row[COL_CUSTODY - 1]     = backup.custody || '';               // G
    row[COL_ROUND - 1]       = backup.round || '';                 // H
    row[COL_FILE_STATUS - 1] = backup.fileStatus || 'ACTIVE';      // I
    row[COL_MISSING_CNT - 1] = backup.missingCount !== undefined ? backup.missingCount : 0; // J

    filteredRows.push(row);
  }

  // Create or clear userSheet
  if (!userSheet) {
    // Insert sheet with camel-cased name for better aesthetics (e.g. Margaret vs MARGARET)
    const formattedName = firstName.charAt(0) + firstName.slice(1).toLowerCase();
    userSheet = ss.insertSheet(formattedName);
  } else {
    // If it exists, clear everything to rebuild it
    userSheet.clear();
  }

  // Write headers
  const newHeader = new Array(10).fill('');
  newHeader[COL_PF - 1]          = masterHeader[COL_PF - 1] || 'PF Number';
  newHeader[COL_HR_STATUS - 1]   = masterHeader[COL_HR_STATUS - 1] || 'HR Status';
  newHeader[COL_NAME - 1]        = masterHeader[COL_NAME - 1] || 'Employee Name';
  newHeader[COL_PHONE - 1]       = masterHeader[COL_PHONE - 1] || 'Phone';
  newHeader[COL_DATETIME - 1]    = 'DATE_TIME';
  newHeader[COL_FLAG - 1]        = 'CENSUS FLAG';
  newHeader[COL_CUSTODY - 1]     = 'CUSTODY LOCATION';
  newHeader[COL_ROUND - 1]       = 'CENSUS ROUND';
  newHeader[COL_FILE_STATUS - 1] = 'FILE STATUS';
  newHeader[COL_MISSING_CNT - 1] = 'MISSING COUNT';

  userSheet.getRange(1, 1, 1, 10).setValues([newHeader]);

  // Write filtered rows (if any)
  if (filteredRows.length > 0) {
    userSheet.getRange(2, 1, filteredRows.length, 10).setValues(filteredRows);
  }

  // Store metadata (delete existing metadata of the same key first to prevent duplicates)
  userSheet.getDeveloperMetadata().forEach(m => m.remove());
  userSheet.addDeveloperMetadata('pf',       pf);
  userSheet.addDeveloperMetadata('mobile',   mobile);
  userSheet.addDeveloperMetadata('idNo',     idNo);
  userSheet.addDeveloperMetadata('batches',  JSON.stringify(batches));
  userSheet.addDeveloperMetadata('firstName',firstName);

  // Write batch ranges to L1
  const batchStr = batches.map(b => 'PF ' + b.from + '–' + b.to).join(', ');
  userSheet.getRange(1, 12).setValue('Batches: ' + batchStr);

  // Style header row
  userSheet.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#1a2035').setFontColor('#ffffff');

  SpreadsheetApp.flush();
  return { username: firstName, batches: batchStr, count: filteredRows.length };
}

// ── updateBatches ────────────────────────────────────────────
// Standard colleague can update their batch ranges. Rebuilds sheet, preserves markings.
function updateBatches(p) {
  const username = String(p.username || '').trim().toUpperCase();
  const batches  = (p.batches  || []).map(b => ({
    from: normalizePF(b.from),
    to:   normalizePF(b.to)
  }));

  if (!username) throw new Error('Username required');
  if (!batches.length) throw new Error('At least one batch range is required');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const allSheets = ss.getSheets();

  // Find user sheet case-insensitively
  let userSheet = null;
  for (const sh of allSheets) {
    if (sh.getName().toUpperCase() === username) {
      userSheet = sh;
      break;
    }
  }
  if (!userSheet) throw new Error('User sheet not found');

  // Verify batches don't overlap with OTHER users
  for (const sh of allSheets) {
    if (sh.getName().toUpperCase() === username) continue; // skip own sheet
    const meta = sh.getDeveloperMetadata();
    for (const m of meta) {
      if (m.getKey() === 'batches') {
        const otherBatches = JSON.parse(m.getValue() || '[]');
        for (const a of batches) {
          for (const b of otherBatches) {
            if (parseInt(a.from, 10) <= parseInt(b.to, 10) && parseInt(b.from, 10) <= parseInt(a.to, 10)) {
              throw new Error('Batch range ' + a.from + '-' + a.to + ' overlaps with ' + sh.getName() + '\'s batch: ' + b.from + '-' + b.to);
            }
          }
        }
      }
    }
  }

  // Backup existing markings
  const markingsBackup = {};
  const existingData = userSheet.getDataRange().getValues();
  for (let i = 1; i < existingData.length; i++) {
    const rowPF = normalizePF(existingData[i][COL_PF - 1]);
    if (!rowPF) continue;
    markingsBackup[rowPF] = {
      datetime:     existingData[i][COL_DATETIME - 1],
      flag:         existingData[i][COL_FLAG - 1],
      custody:      existingData[i][COL_CUSTODY - 1],
      round:        existingData[i][COL_ROUND - 1],
      fileStatus:   existingData[i][COL_FILE_STATUS - 1],
      missingCount: existingData[i][COL_MISSING_CNT - 1],
    };
  }

  const master = ss.getSheetByName('Main DBase');
  if (!master) throw new Error('"Main DBase" tab not found');
  const masterData = master.getDataRange().getValues();
  const masterHeader = masterData[0];

  // Re-filter master rows matching the new batches
  const filteredRows = [];
  for (let i = 1; i < masterData.length; i++) {
    const empPF = normalizePF(masterData[i][COL_PF - 1]);
    const empVal = parseInt(empPF, 10);
    if (isNaN(empVal)) continue;

    const match = batches.some(b => empVal >= parseInt(b.from, 10) && empVal <= parseInt(b.to, 10));
    if (!match) continue;

    const backup = markingsBackup[empPF] || {};
    const row = new Array(10).fill('');
    row[COL_PF - 1]          = masterData[i][COL_PF - 1];
    row[COL_HR_STATUS - 1]   = masterData[i][COL_HR_STATUS - 1];
    row[COL_NAME - 1]        = masterData[i][COL_NAME - 1];
    row[COL_PHONE - 1]       = masterData[i][COL_PHONE - 1];
    row[COL_DATETIME - 1]    = backup.datetime || '';
    row[COL_FLAG - 1]        = backup.flag || '';
    row[COL_CUSTODY - 1]     = backup.custody || '';
    row[COL_ROUND - 1]       = backup.round || '';
    row[COL_FILE_STATUS - 1] = backup.fileStatus || 'ACTIVE';
    row[COL_MISSING_CNT - 1] = backup.missingCount !== undefined ? backup.missingCount : 0;

    filteredRows.push(row);
  }

  // Clear userSheet content
  userSheet.clear();

  // Write headers
  const newHeader = new Array(10).fill('');
  newHeader[COL_PF - 1]          = masterHeader[COL_PF - 1] || 'PF Number';
  newHeader[COL_HR_STATUS - 1]   = masterHeader[COL_HR_STATUS - 1] || 'HR Status';
  newHeader[COL_NAME - 1]        = masterHeader[COL_NAME - 1] || 'Employee Name';
  newHeader[COL_PHONE - 1]       = masterHeader[COL_PHONE - 1] || 'Phone';
  newHeader[COL_DATETIME - 1]    = 'DATE_TIME';
  newHeader[COL_FLAG - 1]        = 'CENSUS FLAG';
  newHeader[COL_CUSTODY - 1]     = 'CUSTODY LOCATION';
  newHeader[COL_ROUND - 1]       = 'CENSUS ROUND';
  newHeader[COL_FILE_STATUS - 1] = 'FILE STATUS';
  newHeader[COL_MISSING_CNT - 1] = 'MISSING COUNT';
  userSheet.getRange(1, 1, 1, 10).setValues([newHeader]);

  // Write filtered rows
  if (filteredRows.length > 0) {
    userSheet.getRange(2, 1, filteredRows.length, 10).setValues(filteredRows);
  }

  // Update batches metadata
  userSheet.getDeveloperMetadata().forEach(m => {
    if (m.getKey() === 'batches') m.remove();
  });
  userSheet.addDeveloperMetadata('batches', JSON.stringify(batches));

  // Write batch ranges to L1
  const batchStr = batches.map(b => 'PF ' + b.from + '–' + b.to).join(', ');
  userSheet.getRange(1, 12).setValue('Batches: ' + batchStr);

  // Style header row
  userSheet.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#1a2035').setFontColor('#ffffff');

  SpreadsheetApp.flush();
  return { batches: batchStr, count: filteredRows.length };
}


// ── getAllPFs ────────────────────────────────────────────────
// Returns a sorted list of all unique PF numbers in Main DBase.
function getAllPFs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const master = ss.getSheetByName('Main DBase');
  if (!master) return { pfs: [] };

  const data = master.getDataRange().getValues();
  const pfs = [];
  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const pf = normalizePF(data[i][COL_PF - 1]);
    if (pf && !pfs.includes(pf)) {
      pfs.push(pf);
    }
  }
  pfs.sort((a, b) => parseInt(a) - parseInt(b));
  return { pfs };
}


// ── loginUser ────────────────────────────────────────────────
function loginUser(p) {
  const firstName = String(p.firstName || '').trim().toUpperCase();
  const pf        = normalizePF(p.pf);
  const idNo      = String(p.idNo || '').trim();

  if (!firstName || !pf || !idNo) throw new Error('All login fields required');

  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName(firstName);
  if (!userSheet) throw new Error('User "' + firstName + '" not registered.');

  // Verify PF and ID
  const metaList = userSheet.getDeveloperMetadata();
  let storedPF = '', storedId = '', storedBatches = '';
  for (const m of metaList) {
    if (m.getKey() === 'pf')      storedPF = m.getValue();
    if (m.getKey() === 'idNo')    storedId = m.getValue();
    if (m.getKey() === 'batches') storedBatches = m.getValue();
  }
  if (storedPF !== pf)   throw new Error('PF Number does not match our records.');
  if (storedId !== idNo) throw new Error('ID Number does not match our records.');

  const batches = JSON.parse(storedBatches || '[]');
  const round   = currentMonth();

  // Stats for greeting
  const stats = getStats(firstName, round);
  return { username: firstName, batches, round, ...stats };
}

// ── lookupPF ─────────────────────────────────────────────────
function lookupPF(pfInput, username) {
  if (!pfInput)  throw new Error('PF is required');
  if (!username) throw new Error('Username is required');

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(username);
  if (!sheet) throw new Error('User tab "' + username + '" not found');

  const query = normalizePF(pfInput);
  const data  = sheet.getDataRange().getValues();

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    if (normalizePF(String(data[i][COL_PF - 1])) !== query) continue;

    const hrStatus   = String(data[i][COL_HR_STATUS  - 1] || '').trim();
    const flag       = String(data[i][COL_FLAG       - 1] || '').toUpperCase().trim();
    const missingCnt = parseInt(data[i][COL_MISSING_CNT - 1] || '0') || 0;

    return {
      found:       true,
      pf:          String(data[i][COL_PF    - 1]).trim(),
      name:        String(data[i][COL_NAME  - 1] || '').trim(),
      hrStatus:    hrStatus,
      phone:       String(data[i][COL_PHONE - 1] || '').trim(),
      lastMarked:  fmtDate(data[i][COL_DATETIME - 1]),
      flag:        flag,
      custody:     String(data[i][COL_CUSTODY     - 1] || '').toUpperCase().trim(),
      round:       String(data[i][COL_ROUND       - 1] || '').trim(),
      fileStatus:  String(data[i][COL_FILE_STATUS - 1] || 'ACTIVE').toUpperCase().trim(),
      missingCount:missingCnt,
      row:         i + 1,
    };
  }
  return { found: false };
}

// ── markPresent ──────────────────────────────────────────────
function markPresent(p) {
  const pfInput    = String(p.pf          || '').trim();
  const username   = String(p.username    || '').trim();
  const fileStatus = String(p.fileStatus  || 'ACTIVE').toUpperCase().trim();
  const custody    = String(p.custody     || 'REGISTRY').toUpperCase().trim();
  const round      = String(p.round       || currentMonth()).trim();

  if (!pfInput || !username) throw new Error('PF and username required');

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(username);
  if (!sheet) throw new Error('User tab "' + username + '" not found');

  const query    = normalizePF(pfInput);
  const data     = sheet.getDataRange().getValues();
  const now      = ts();

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    if (normalizePF(String(data[i][COL_PF - 1])) !== query) continue;

    const name = String(data[i][COL_NAME - 1] || '').trim();

    sheet.getRange(i + 1, COL_DATETIME).setValue(now);
    sheet.getRange(i + 1, COL_FLAG).setValue('PRESENT');
    sheet.getRange(i + 1, COL_CUSTODY).setValue(custody);
    sheet.getRange(i + 1, COL_ROUND).setValue(round);
    sheet.getRange(i + 1, COL_FILE_STATUS).setValue(fileStatus);
    sheet.getRange(i + 1, COL_MISSING_CNT).setValue(0);  // reset missing counter

    SpreadsheetApp.flush();

    // Log to Census History
    logCensusHistory(pfInput, name, 'PRESENT', custody, fileStatus, round, username, now);

    return {
      pf:        pfInput,
      name:      name,
      flag:      'PRESENT',
      custody:   custody,
      fileStatus:fileStatus,
      round:     round,
      timestamp: now,
    };
  }

  throw new Error('PF ' + pfInput + ' not found in your sheet.');
}

// ── runAudit ─────────────────────────────────────────────────
function runAudit(p) {
  const username = String(p.username || '').trim();
  const round    = String(p.round    || currentMonth()).trim();

  if (!username) throw new Error('Username required');

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(username);
  if (!sheet) throw new Error('User tab "' + username + '" not found');

  const data   = sheet.getDataRange().getValues();
  const now    = ts();
  let flagged  = 0;
  let alreadyPresent = 0;

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const pf       = String(data[i][COL_PF - 1]).trim();
    const hrStatus = String(data[i][COL_HR_STATUS - 1] || '').toLowerCase();
    if (!pf || hrStatus === 'exited') continue;

    const rowRound = String(data[i][COL_ROUND - 1] || '').trim();
    const flag     = String(data[i][COL_FLAG  - 1] || '').toUpperCase();

    if (rowRound === round && flag === 'PRESENT') {
      alreadyPresent++;
      continue;
    }

    // Flag as MISSING and increment counter
    const name       = String(data[i][COL_NAME - 1] || '').trim();
    const currentCnt = parseInt(data[i][COL_MISSING_CNT - 1] || '0') || 0;
    const newCnt     = currentCnt + 1;

    sheet.getRange(i + 1, COL_FLAG).setValue('MISSING');
    sheet.getRange(i + 1, COL_ROUND).setValue(round);
    sheet.getRange(i + 1, COL_MISSING_CNT).setValue(newCnt);

    logCensusHistory(pf, name, 'MISSING', '', '', round, username, now);
    flagged++;
  }

  SpreadsheetApp.flush();
  return { flagged, alreadyPresent, round };
}

// ── updateLocation ───────────────────────────────────────────
function updateLocation(p) {
  const pfInput     = String(p.pf          || '').trim();
  const username    = String(p.username    || '').trim();
  const newLocation = String(p.newLocation || '').toUpperCase().trim();

  if (!pfInput || !username || !newLocation)
    throw new Error('PF, username, and new location required');

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(username);
  if (!sheet) throw new Error('User tab "' + username + '" not found');

  const query = normalizePF(pfInput);
  const data  = sheet.getDataRange().getValues();
  const now   = ts();

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    if (normalizePF(String(data[i][COL_PF - 1])) !== query) continue;

    const oldLocation = String(data[i][COL_CUSTODY - 1] || 'REGISTRY').toUpperCase().trim();
    const name        = String(data[i][COL_NAME    - 1] || '').trim();
    const flag        = String(data[i][COL_FLAG    - 1] || '').toUpperCase();

    sheet.getRange(i + 1, COL_CUSTODY).setValue(newLocation);

    // If file was MISSING, mark as LOCATED now
    if (flag === 'MISSING') {
      sheet.getRange(i + 1, COL_FLAG).setValue('LOCATED');
      sheet.getRange(i + 1, COL_DATETIME).setValue(now);
    }

    SpreadsheetApp.flush();
    logMovement(pfInput, name, oldLocation, newLocation, username, now);

    return { success: true, pf: pfInput, name, oldLocation, newLocation, timestamp: now };
  }

  throw new Error('PF not found in your sheet');
}

// ── getStats ─────────────────────────────────────────────────
function getStats(username, round) {
  if (!username) throw new Error('Username required');
  round = round || currentMonth();

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(username);
  if (!sheet) return { total: 0, present: 0, missing: 0, unmarked: 0, percent: 0 };

  const data = sheet.getDataRange().getValues();
  let total = 0, present = 0, missing = 0, unmarked = 0;

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const pf       = String(data[i][COL_PF - 1]).trim();
    const hrStatus = String(data[i][COL_HR_STATUS - 1] || '').toLowerCase();
    if (!pf || hrStatus === 'exited') continue;
    total++;

    const rowRound = String(data[i][COL_ROUND - 1] || '').trim();
    const flag     = String(data[i][COL_FLAG  - 1] || '').toUpperCase();

    if (rowRound === round && flag === 'PRESENT') present++;
    else if (flag === 'MISSING') missing++;
    else unmarked++;
  }

  const percent = total > 0 ? Math.round((present / total) * 100) : 0;
  return { total, present, missing, unmarked, percent, round };
}

// ── getRegistry ──────────────────────────────────────────────
function getRegistry(username) {
  if (!username) throw new Error('Username required');
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(username);
  if (!sheet) return { files: [] };

  const data  = sheet.getDataRange().getValues();
  const files = [];

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const pf = String(data[i][COL_PF - 1]).trim();
    if (!pf) continue;
    files.push({
      pf,
      name:       String(data[i][COL_NAME  - 1] || '').trim(),
      hrStatus:   String(data[i][COL_HR_STATUS - 1] || '').trim(),
      flag:       String(data[i][COL_FLAG  - 1] || '').toUpperCase(),
      custody:    String(data[i][COL_CUSTODY - 1] || '').toUpperCase(),
      round:      String(data[i][COL_ROUND  - 1] || '').trim(),
      lastMarked: fmtDate(data[i][COL_DATETIME - 1]),
      missingCount: parseInt(data[i][COL_MISSING_CNT - 1] || '0') || 0,
    });
  }
  return { files };
}

// ── getReport ────────────────────────────────────────────────
function getReport(username, round) {
  if (!username) throw new Error('Username required');
  round = round || currentMonth();

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(username);
  if (!sheet) return { total:0, marked:0, unmarked:0, missing:0, flagged:0, markedList:[], unmarkedList:[], missingList:[] };

  const data = sheet.getDataRange().getValues();
  let total = 0, marked = 0, unmarked = 0, missing = 0;
  const markedList = [], unmarkedList = [], missingList = [];

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const pf       = String(data[i][COL_PF - 1]).trim();
    const hrStatus = String(data[i][COL_HR_STATUS - 1] || '').toLowerCase();
    if (!pf || hrStatus === 'exited') continue;
    total++;

    const name       = String(data[i][COL_NAME       - 1] || '').trim();
    const rowRound   = String(data[i][COL_ROUND      - 1] || '').trim();
    const flag       = String(data[i][COL_FLAG       - 1] || '').toUpperCase();
    const custody    = String(data[i][COL_CUSTODY    - 1] || '').toUpperCase();
    const fileStatus = String(data[i][COL_FILE_STATUS- 1] || '').toUpperCase();
    const lastDT     = data[i][COL_DATETIME - 1];
    const missingCnt = parseInt(data[i][COL_MISSING_CNT - 1] || '0') || 0;

    if (rowRound === round && flag === 'PRESENT') {
      marked++;
      markedList.push({ pf, name, custody, fileStatus, timestamp: fmtDate(lastDT) });
    } else if (flag === 'MISSING' || flag === 'LOCATED') {
      missing++;
      missingList.push({ pf, name, custody, missingCount: missingCnt, flag, lastSeen: fmtDate(lastDT) || 'Never' });
    } else {
      unmarked++;
      unmarkedList.push({ pf, name, hrStatus: String(data[i][COL_HR_STATUS - 1] || '').trim() });
    }
  }

  // Sort: missing count descending
  missingList.sort((a, b) => b.missingCount - a.missingCount);

  return { total, marked, unmarked, missing, round, markedList, unmarkedList, missingList };
}

// ── getMissingAlerts ─────────────────────────────────────────
function getMissingAlerts(username) {
  if (!username) throw new Error('Username required');

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(username);
  if (!sheet) return { alerts: [] };

  const data   = sheet.getDataRange().getValues();
  const alerts = [];

  for (let i = DATA_START_ROW - 1; i < data.length; i++) {
    const pf         = String(data[i][COL_PF - 1]).trim();
    const flag       = String(data[i][COL_FLAG - 1] || '').toUpperCase();
    const missingCnt = parseInt(data[i][COL_MISSING_CNT - 1] || '0') || 0;
    if (!pf) continue;

    if (flag === 'MISSING' && missingCnt >= 2) {
      alerts.push({
        pf,
        name:        String(data[i][COL_NAME    - 1] || '').trim(),
        missingCount:missingCnt,
        lastSeen:    fmtDate(data[i][COL_DATETIME - 1]) || 'Never',
        custody:     String(data[i][COL_CUSTODY  - 1] || '').toUpperCase(),
      });
    }
  }

  alerts.sort((a, b) => b.missingCount - a.missingCount);
  return { alerts };
}

// ── getMovementLog ───────────────────────────────────────────
function getMovementLog(pf) {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const moveSheet = ss.getSheetByName('File Movement History');
  if (!moveSheet) return { history: [] };

  const query   = normalizePF(pf);
  const data    = moveSheet.getDataRange().getValues();
  const history = [];

  for (let i = 1; i < data.length; i++) {
    if (normalizePF(String(data[i][1])) !== query) continue;
    history.push({
      timestamp:   String(data[i][0]),
      from:        String(data[i][3]),
      to:          String(data[i][4]),
      updatedBy:   String(data[i][5]),
    });
  }
  history.reverse();  // newest first
  return { history };
}

// ── logCensusHistory ─────────────────────────────────────────
function logCensusHistory(pf, name, flag, custody, fileStatus, round, operator, timestamp) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const HIST = 'Census History';
    let h = ss.getSheetByName(HIST);
    if (!h) {
      h = ss.insertSheet(HIST);
      h.appendRow(['Timestamp','PF Number','Employee Name','Census Flag','Custody','File Status','Round','Operator']);
      h.getRange(1,1,1,8).setFontWeight('bold').setBackground('#1a2035').setFontColor('#ffffff');
    }
    h.appendRow([timestamp, pf, name, flag, custody, fileStatus, round, operator]);
  } catch (e) { Logger.log('Census history log error: ' + e.message); }
}

// ── logMovement ──────────────────────────────────────────────
function logMovement(pf, name, fromLoc, toLoc, operator, timestamp) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const MOVE = 'File Movement History';
    let m = ss.getSheetByName(MOVE);
    if (!m) {
      m = ss.insertSheet(MOVE);
      m.appendRow(['Timestamp','PF Number','Employee Name','From Location','To Location','Updated By']);
      m.getRange(1,1,1,6).setFontWeight('bold').setBackground('#1a2035').setFontColor('#ffffff');
    }
    m.appendRow([timestamp, pf, name, fromLoc, toLoc, operator]);
  } catch (e) { Logger.log('Movement log error: ' + e.message); }
}

// ── getCensusTimeline ──────────────────────────────────────────
// Returns a month-by-month sighting history for a given PF number
// from the "Census History" sheet (cross-user).
// Example result:
//   { pf:'3888', name:'KOECH CHEBII MARGARET',
//     timeline: [
//       { round:'July 2026', flag:'PRESENT', custody:'RESOURCING', operator:'MARGARET', timestamp:'10/07/2026 07:45:44' },
//       { round:'August 2026', flag:'MISSING', custody:'', operator:'', timestamp:'' }
//     ],
//     lastSeen:'July 2026', declaredMissing:'August 2026' }
function getCensusTimeline(pf) {
  if (!pf) throw new Error('PF required');

  const query = normalizePF(pf);
  const ss    = SpreadsheetApp.getActiveSpreadsheet();

  // ── 1. Pull all marks from Census History ─────────────────
  const HIST = 'Census History';
  const histSheet = ss.getSheetByName(HIST);

  // Census History columns (from logCensusHistory):
  // A=Timestamp, B=PF Number, C=Employee Name, D=Census Flag,
  // E=Custody, F=File Status, G=Round, H=Operator
  const CH_TS      = 0;
  const CH_PF      = 1;
  const CH_NAME    = 2;
  const CH_FLAG    = 3;
  const CH_CUSTODY = 4;
  const CH_ROUND   = 6;
  const CH_OP      = 7;

  const byRound = {};   // round → { flag, custody, operator, timestamp }
  let empName   = '';

  if (histSheet) {
    const rows = histSheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (normalizePF(String(rows[i][CH_PF])) !== query) continue;
      const round = String(rows[i][CH_ROUND] || '').trim();
      if (!round) continue;
      if (!empName) empName = String(rows[i][CH_NAME] || '').trim();

      // Keep only the last/most-significant entry per round
      // (PRESENT overrides MISSING for the same round)
      const flag = String(rows[i][CH_FLAG] || '').toUpperCase();
      if (!byRound[round] || flag === 'PRESENT') {
        byRound[round] = {
          round,
          flag,
          custody:   String(rows[i][CH_CUSTODY] || '').toUpperCase(),
          operator:  String(rows[i][CH_OP] || ''),
          timestamp: fmtDate(rows[i][CH_TS]),
        };
      }
    }
  }

  // ── 2. Build a sorted timeline ────────────────────────────
  // Parse "Month YYYY" into a sortable value
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  function monthSortKey(roundStr) {
    const parts = roundStr.split(' ');
    const mo  = MONTHS.indexOf(parts[0]);
    const yr  = parseInt(parts[1] || '0');
    return yr * 12 + (mo >= 0 ? mo : 0);
  }

  const timeline = Object.values(byRound)
    .sort((a, b) => monthSortKey(a.round) - monthSortKey(b.round));

  // ── 3. Determine last seen and declared missing ────────────
  let lastSeen        = '';
  let declaredMissing = '';
  for (const t of timeline) {
    if (t.flag === 'PRESENT' || t.flag === 'LOCATED') lastSeen = t.round;
    else if (t.flag === 'MISSING' && !lastSeen)        declaredMissing = t.round;
    else if (t.flag === 'MISSING' && lastSeen)         declaredMissing = t.round;
  }

  return { pf: query, name: empName, timeline, lastSeen, declaredMissing };
}

// ── getCompiledReport ─────────────────────────────────────────
// Super admin only: aggregate stats across ALL user sheets for a given round.
function getCompiledReport(username, round) {
  if (!isSuperAdmin(username))
    throw new Error('Access denied — super admin only');

  round = round || currentMonth();
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const sheets   = getUserSheetNames();
  const perUser  = [];
  let   grandTotal = 0, grandPresent = 0, grandMissing = 0, grandUnmarked = 0;

  for (const sheetName of sheets) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;

    const data    = sheet.getDataRange().getValues();
    let total = 0, present = 0, missing = 0, unmarked = 0;

    for (let i = DATA_START_ROW - 1; i < data.length; i++) {
      const pf       = String(data[i][COL_PF - 1]).trim();
      const hrStatus = String(data[i][COL_HR_STATUS - 1] || '').toLowerCase();
      if (!pf || hrStatus === 'exited') continue;
      total++;

      const rowRound = String(data[i][COL_ROUND - 1] || '').trim();
      const flag     = String(data[i][COL_FLAG  - 1] || '').toUpperCase();

      if (rowRound === round && flag === 'PRESENT') present++;
      else if (flag === 'MISSING') missing++;
      else unmarked++;
    }

    const pct = total > 0 ? Math.round((present / total) * 100) : 0;
    perUser.push({ user: sheetName, total, present, missing, unmarked, pct });

    grandTotal   += total;
    grandPresent += present;
    grandMissing += missing;
    grandUnmarked+= unmarked;
  }

  // Sort by % complete descending
  perUser.sort((a, b) => b.pct - a.pct);

  const grandPct = grandTotal > 0 ? Math.round((grandPresent / grandTotal) * 100) : 0;

  // ── Cross-month missing files (missing 2+ rounds) ─────────
  // Scan all user sheets for critical missing files
  const criticalMissing = [];
  for (const sheetName of sheets) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;
    const data = sheet.getDataRange().getValues();
    for (let i = DATA_START_ROW - 1; i < data.length; i++) {
      const pf         = String(data[i][COL_PF - 1]).trim();
      const flag       = String(data[i][COL_FLAG - 1] || '').toUpperCase();
      const missingCnt = parseInt(data[i][COL_MISSING_CNT - 1] || '0') || 0;
      if (!pf) continue;
      if (flag === 'MISSING' && missingCnt >= 2) {
        criticalMissing.push({
          pf,
          name:        String(data[i][COL_NAME  - 1] || '').trim(),
          user:        sheetName,
          missingCount:missingCnt,
          lastSeen:    fmtDate(data[i][COL_DATETIME - 1]) || 'Never',
          custody:     String(data[i][COL_CUSTODY - 1] || '').toUpperCase(),
        });
      }
    }
  }
  criticalMissing.sort((a, b) => b.missingCount - a.missingCount);

  return {
    round,
    perUser,
    grandTotal,
    grandPresent,
    grandMissing,
    grandUnmarked,
    grandPct,
    criticalMissing,
    userCount: sheets.length,
  };
}

