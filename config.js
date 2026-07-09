// ============================================================
// PF CENSUS APP - CONFIGURATION
// ============================================================
// These are the default column settings for your sheet.
// You can also change them inside the app via Settings.
// ============================================================

const CONFIG = {

  // --- Google Sheet & Apps Script ---
  SPREADSHEET_ID: '1-MpfWf3JqVAxdwo59eV6wd2Lv37YN-wa',

  // This will be set by the user on first launch (Apps Script URL)
  SCRIPT_URL: '',

  // --- Sheet Tab Name ---
  // The name of the tab at the bottom of your Google Sheet
  SHEET_NAME: 'Sheet1',

  // --- Column Mappings (column LETTERS) ---
  COLUMNS: {
    PF_NUMBER:     'A',   // ✅ PF Number column
    EMPLOYEE_NAME: 'B',   // Employee name (adjust if needed)
    DEPARTMENT:    'C',   // Department (adjust or leave empty)
    DESIGNATION:   'D',   // Designation (adjust or leave empty)
    DATE_TIME:     'E',   // ✅ Date & Time stamp column
    STATUS:        'F',   // ✅ PRESENT status column
  },

  // --- Row Settings ---
  HEADER_ROW: 1,
  DATA_START_ROW: 2,

  // --- PF Number Format ---
  // 'numeric'  = 4 digits like 4420 (pad with zeros if needed)
  // 'text'     = match exactly as typed/spoken
  PF_FORMAT: 'numeric',
  PF_DIGITS: 4,   // expected length, e.g. 4 for "4420"

  // --- Status Labels ---
  STATUS_PRESENT: 'PRESENT',

  // --- Voice Recognition ---
  VOICE_LANGUAGE: 'en-US',

  // --- App Info ---
  APP_NAME: 'PF Census',
  ORG_NAME: 'Physical File Tracker',
};
