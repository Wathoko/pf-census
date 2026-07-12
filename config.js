// ============================================================
// PF CENSUS APP - CONFIGURATION
// ============================================================
const CONFIG = {

  // ── Permanent Apps Script URL (no setup required) ──────────
  SCRIPT_URL: 'https://script.google.com/a/macros/mtrh.go.ke/s/AKfycbxHykLZtEsIZcRvz54uybXtWSsaNHI_px6xkn1fTT2YCX6OSh4NYbpxXrk9m89IrCdn/exec',

  // ── Sheet Tab Names ────────────────────────────────────────
  SHEET_NAME:  'Main DBase',   // Master database tab

  // ── PF Format ──────────────────────────────────────────────
  PF_FORMAT: 'numeric',
  PF_DIGITS: 4,

  // ── Column Mappings (column LETTERS) ──────────────────────
  COLUMNS: {
    PF_NUMBER:     'A',
    EMPLOYEE_NAME: 'C',
    DATE_TIME:     'E',
    STATUS:        'F',
  },

  HEADER_ROW:    1,
  DATA_START_ROW: 2,

  // ── Custody Locations ─────────────────────────────────────
  LOCATIONS: [
    'REGISTRY',
    'CEO\'S OFFICE',
    'DIRECTOR HR OFFICE',
    'DISCIPLINE',
    'RESOURCING',
    'AUDIT',
    'SALARIES',
    'PROMOTION',
    'DEPUTY HR',
    'FELIX KOSGEY OFFICE',
    'EMPLOYEE RELATIONS',
    'FINANCE',
    'HOD RM',
    'DEPUTY CEO AF',
    'DEPUTY CEO CS',
    'DIRECTOR NURSING',
    'DEPUTY DIRECTOR NURSING - CAROLINE SANG',
    'DEPUTY DIRECTOR NURSING - MARGARET MUNGAI',
    'OAS OFFICE',
    'CHERES OFFICE',
  ],

  // ── App Info ──────────────────────────────────────────────
  STATUS_PRESENT: 'PRESENT',
  VOICE_LANGUAGE: 'en-US',
  APP_NAME:       'PF Census',
  ORG_NAME:       'Physical File Tracker',
};
