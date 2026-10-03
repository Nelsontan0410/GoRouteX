/*
 * Google Apps Script for BJS Delivery Route History Sync
 * 
 * SETUP INSTRUCTIONS:
 * 1. Go to https://<apps-script-console-removed>
 * 2. Create a new project
 * 3. Replace the default code with this code
 * 4. Deploy as Web App with access to "Anyone"
 * 5. Copy the deployment URL and use it in sheets-sync.js
 * 
 * This will automatically create a Google Sheet to store route history
 */

// Configuration
const SHEET_NAME = 'BJS_Route_History';

// Get or create the spreadsheet
function getOrCreateSheet() {
  let sheet = SpreadsheetApp.getActiveSheet();
  
  // Check if this is a new script or if we need to create a new sheet
  if (sheet.getName() !== SHEET_NAME) {
    // Try to find existing sheet
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    sheet = spreadsheet.getSheetByName(SHEET_NAME);
    
    if (!sheet) {
      // Create new sheet
      sheet = spreadsheet.insertSheet(SHEET_NAME);
      
      // Set up headers
      const headers = [
        'ID', 'Username', 'Route Name', 'Route Data', 'Timestamp', 
        'Device Info', 'Stops Count', 'Created Date'
      ];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  
  return sheet;
}

// Main function to handle web app requests
function doGet(e) {
  try {
    const action = e.parameter.action;
    const username = e.parameter.username || 'anonymous';
    
    console.log('GET Request received:', { action, username });
    
    if (action === 'loadRoutes') {
      return loadRoutes(username);
    }
    
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'Invalid action', received: action }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeaders({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
      });
      
  } catch (error) {
    console.error('doGet error:', error);
    return ContentService
      .createTextOutput(JSON.stringify({ error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeaders({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
      });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    
    console.log('POST Request received:', { action, username: data.username });
    
    switch (action) {
      case 'saveRoute':
        return saveRoute(data);
      case 'deleteRoute':
        return deleteRoute(data);
      default:
        throw new Error('Invalid action: ' + action);
    }
    
  } catch (error) {
    console.error('doPost error:', error);
    return ContentService
      .createTextOutput(JSON.stringify({ error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeaders({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
      });
  }
}

// Save route to sheet
function saveRoute(data) {
  const sheet = getOrCreateSheet();
  const routeData = JSON.parse(data.routeData);
  
  // Generate unique ID if not provided
  const routeId = routeData.id || Utilities.getUuid();
  
  // Check if route already exists
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  let existingRowIndex = -1;
  
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === routeId && values[i][1] === data.username) {
      existingRowIndex = i + 1; // Sheet rows are 1-indexed
      break;
    }
  }
  
  const rowData = [
    routeId,
    data.username,
    routeData.routeName || 'Unnamed Route',
    data.routeData,
    data.timestamp,
    data.deviceInfo || '',
    routeData.totalStops || 0,
    new Date().toISOString()
  ];
  
  if (existingRowIndex > 0) {
    // Update existing route
    sheet.getRange(existingRowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    // Add new route
    sheet.appendRow(rowData);
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, id: routeId }))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
    });
}

// Load routes for a user
function loadRoutes(username) {
  try {
    console.log('Loading routes for username:', username);
    const sheet = getOrCreateSheet();
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    
    console.log('Total rows in sheet:', values.length);
    
    const routes = [];
    
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      if (row[1] === username) { // Check username
        try {
          const routeData = JSON.parse(row[3]); // Parse route data
          routeData.id = row[0]; // Ensure ID is set
          routeData.timestamp = row[4]; // Ensure timestamp is set
          routes.push(routeData);
          console.log('Found route for user:', routeData.id);
        } catch (error) {
          console.error('Error parsing route data for row', i, error);
        }
      }
    }
    
    console.log('Returning', routes.length, 'routes for', username);
    
    return ContentService
      .createTextOutput(JSON.stringify({ routes: routes, count: routes.length }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeaders({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
      });
  } catch (error) {
    console.error('Error in loadRoutes:', error);
    return ContentService
      .createTextOutput(JSON.stringify({ error: error.toString(), routes: [] }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeaders({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
      });
  }
}

// Delete route
function deleteRoute(data) {
  const sheet = getOrCreateSheet();
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === data.routeId && values[i][1] === data.username) {
      sheet.deleteRow(i + 1); // Sheet rows are 1-indexed
      break;
    }
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
    });
}

// Utility function to clean up old routes (optional)
function cleanupOldRoutes() {
  const sheet = getOrCreateSheet();
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  for (let i = values.length - 1; i >= 1; i--) {
    const timestamp = new Date(values[i][4]);
    if (timestamp < thirtyDaysAgo) {
      sheet.deleteRow(i + 1);
    }
  }
} 

