/**
 * ============================================================================
 * GOOGLE APPS SCRIPT — RSVP Backend for Jazzy's Birthday Party
 * ============================================================================
 *
 * SETUP INSTRUCTIONS:
 *
 * 1. Go to https://sheets.google.com and create a new Google Sheet.
 *
 * 2. In the Google Sheet, go to Extensions → Apps Script
 *
 * 3. Delete any code in the editor and paste this entire file.
 *
 * 4. Click the 💾 Save button (or Ctrl+S).
 *
 * 5. Deploy as a web app:
 *    a. Click "Deploy" → "New deployment"
 *    b. Click the gear icon next to "Select type" → choose "Web app"
 *    c. Set "Execute as" → "Me"
 *    d. Set "Who has access" → "Anyone"
 *    e. Click "Deploy"
 *    f. Authorize when prompted (click through the "unsafe" warning —
 *       this is your own script running under your own account)
 *    g. Copy the Web App URL
 *
 * 6. Paste the Web App URL into index.html, replacing:
 *    const GOOGLE_SCRIPT_URL = 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE';
 *
 * 7. Test it! Submit an RSVP and check your Google Sheet.
 *
 * NOTE: If you update this script later, you must create a "New deployment"
 * (not just save) for changes to take effect on the live URL. Alternatively,
 * you can re-deploy the existing deployment.
 *
 * ============================================================================
 */

// ----- Configuration -----
var SHEET_NAME = 'RSVPs';

// Colors
var HEADER_BG = '#1a1a1a';
var HEADER_FG = '#d4af37';
var YES_BG = '#1b3a1b';
var YES_FG = '#4caf50';
var NO_BG = '#3a1b1b';
var NO_FG = '#e57373';
var ROW_EVEN = '#f9f6ef';
var ROW_ODD = '#ffffff';
var BORDER_COLOR = '#d4af37';

/**
 * Handles POST requests from the RSVP form.
 */
function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = createFormattedSheet();
    }

    var data = JSON.parse(e.postData.contents);

    // Format timestamp as readable date
    var ts = data.timestamp ? new Date(data.timestamp) : new Date();
    var formattedDate = Utilities.formatDate(ts, Session.getScriptTimeZone(), 'MMM d, yyyy h:mm a');

    // Capitalize responses
    var att1 = capitalize(data.attending1 || '');
    var att2 = capitalize(data.attending2 || '');

    var newRow = sheet.getLastRow() + 1;

    sheet.getRange(newRow, 1, 1, 7).setValues([[
      formattedDate,
      data.inviteId || 'unknown',
      capitalize(data.type || ''),
      data.name1 || '',
      att1,
      data.name2 || '',
      att2
    ]]);

    // Format the new row
    formatRow(sheet, newRow, att1, att2);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    Logger.log('Error in doPost: ' + error.toString());

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Handles GET requests — useful for testing that the script is deployed.
 */
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'ok',
      message: 'Jazzy\'s Birthday RSVP backend is running. Use POST to submit RSVPs.'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Creates the RSVPs sheet with formatted headers.
 */
function createFormattedSheet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(SHEET_NAME);

  var headers = ['Timestamp', 'Invite ID', 'Type', 'Name 1', 'Attending 1', 'Name 2', 'Attending 2'];
  var headerRange = sheet.getRange(1, 1, 1, 7);

  headerRange.setValues([headers]);
  headerRange.setFontWeight('bold');
  headerRange.setFontSize(11);
  headerRange.setBackground(HEADER_BG);
  headerRange.setFontColor(HEADER_FG);
  headerRange.setHorizontalAlignment('center');
  headerRange.setBorder(true, true, true, true, true, true, BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);

  sheet.setFrozenRows(1);

  // Set column widths
  sheet.setColumnWidth(1, 170); // Timestamp
  sheet.setColumnWidth(2, 120); // Invite ID
  sheet.setColumnWidth(3, 80);  // Type
  sheet.setColumnWidth(4, 150); // Name 1
  sheet.setColumnWidth(5, 110); // Attending 1
  sheet.setColumnWidth(6, 150); // Name 2
  sheet.setColumnWidth(7, 110); // Attending 2

  return sheet;
}

/**
 * Formats a data row with color-coded attendance and alternating row colors.
 */
function formatRow(sheet, row, att1, att2) {
  var rowRange = sheet.getRange(row, 1, 1, 7);

  // Alternating row background
  var bgColor = (row % 2 === 0) ? ROW_EVEN : ROW_ODD;
  rowRange.setBackground(bgColor);
  rowRange.setVerticalAlignment('middle');
  rowRange.setFontSize(10);

  // Center the Type, Attending columns
  sheet.getRange(row, 3).setHorizontalAlignment('center');
  sheet.getRange(row, 5).setHorizontalAlignment('center');
  sheet.getRange(row, 7).setHorizontalAlignment('center');

  // Color-code Attending 1
  if (att1) {
    var cell1 = sheet.getRange(row, 5);
    if (att1.toLowerCase() === 'yes') {
      cell1.setBackground(YES_BG);
      cell1.setFontColor(YES_FG);
      cell1.setFontWeight('bold');
    } else if (att1.toLowerCase() === 'no') {
      cell1.setBackground(NO_BG);
      cell1.setFontColor(NO_FG);
      cell1.setFontWeight('bold');
    }
  }

  // Color-code Attending 2
  if (att2) {
    var cell2 = sheet.getRange(row, 7);
    if (att2.toLowerCase() === 'yes') {
      cell2.setBackground(YES_BG);
      cell2.setFontColor(YES_FG);
      cell2.setFontWeight('bold');
    } else if (att2.toLowerCase() === 'no') {
      cell2.setBackground(NO_BG);
      cell2.setFontColor(NO_FG);
      cell2.setFontWeight('bold');
    }
  }

  // Light border
  rowRange.setBorder(null, null, true, null, null, null, '#e0e0e0', SpreadsheetApp.BorderStyle.SOLID);
}

/**
 * Capitalize first letter of a string.
 */
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Run this once manually to format any existing data in the sheet.
 * In the Apps Script editor: select this function and click Run.
 */
function formatExistingData() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  // Format header
  var headerRange = sheet.getRange(1, 1, 1, 7);
  headerRange.setFontWeight('bold');
  headerRange.setFontSize(11);
  headerRange.setBackground(HEADER_BG);
  headerRange.setFontColor(HEADER_FG);
  headerRange.setHorizontalAlignment('center');
  headerRange.setBorder(true, true, true, true, true, true, BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);
  sheet.setFrozenRows(1);

  // Set column widths
  sheet.setColumnWidth(1, 170);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 80);
  sheet.setColumnWidth(4, 150);
  sheet.setColumnWidth(5, 110);
  sheet.setColumnWidth(6, 150);
  sheet.setColumnWidth(7, 110);

  // Format each data row
  for (var row = 2; row <= lastRow; row++) {
    var att1 = sheet.getRange(row, 5).getValue().toString();
    var att2 = sheet.getRange(row, 7).getValue().toString();
    formatRow(sheet, row, att1, att2);
  }
}
