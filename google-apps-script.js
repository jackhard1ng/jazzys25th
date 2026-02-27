/**
 * ============================================================================
 * GOOGLE APPS SCRIPT — RSVP Backend for Jazzy's Birthday Party
 * ============================================================================
 *
 * SETUP INSTRUCTIONS:
 *
 * 1. Go to https://sheets.google.com and create a new Google Sheet.
 *
 * 2. Name the sheet tab "RSVPs" (or whatever you prefer — just update
 *    SHEET_NAME below if you change it).
 *
 * 3. Add these headers to Row 1:
 *    A1: Timestamp
 *    B1: Invite ID
 *    C1: Type
 *    D1: Name 1
 *    E1: Attending 1
 *    F1: Name 2
 *    G1: Attending 2
 *
 * 4. In the Google Sheet, go to Extensions → Apps Script
 *
 * 5. Delete any code in the editor and paste this entire file.
 *
 * 6. Click the 💾 Save button (or Ctrl+S).
 *
 * 7. Deploy as a web app:
 *    a. Click "Deploy" → "New deployment"
 *    b. Click the gear icon next to "Select type" → choose "Web app"
 *    c. Set "Execute as" → "Me"
 *    d. Set "Who has access" → "Anyone"
 *    e. Click "Deploy"
 *    f. Authorize when prompted (click through the "unsafe" warning —
 *       this is your own script running under your own account)
 *    g. Copy the Web App URL
 *
 * 8. Paste the Web App URL into index.html, replacing:
 *    const GOOGLE_SCRIPT_URL = 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE';
 *
 * 9. Test it! Submit an RSVP and check your Google Sheet.
 *
 * NOTE: If you update this script later, you must create a "New deployment"
 * (not just save) for changes to take effect on the live URL. Alternatively,
 * you can re-deploy the existing deployment.
 *
 * ============================================================================
 */

// ----- Configuration -----
var SHEET_NAME = 'RSVPs';

/**
 * Handles POST requests from the RSVP form.
 */
function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

    if (!sheet) {
      // Create the sheet if it doesn't exist
      sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(SHEET_NAME);
      // Add headers
      sheet.getRange(1, 1, 1, 7).setValues([[
        'Timestamp',
        'Invite ID',
        'Type',
        'Name 1',
        'Attending 1',
        'Name 2',
        'Attending 2'
      ]]);
      // Bold headers
      sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
      // Freeze header row
      sheet.setFrozenRows(1);
    }

    var data = JSON.parse(e.postData.contents);

    // Append the RSVP row
    sheet.appendRow([
      data.timestamp || new Date().toISOString(),
      data.inviteId || 'unknown',
      data.type || '',
      data.name1 || '',
      data.attending1 || '',
      data.name2 || '',
      data.attending2 || ''
    ]);

    // Return success (note: with no-cors mode the client can't read this,
    // but it's good practice to return a proper response)
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    // Log the error for debugging in Apps Script
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
