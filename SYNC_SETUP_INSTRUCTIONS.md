# 🔄 Google Sheets Cross-Device Sync Setup

## Why Google Sheets Instead of Firebase?

✅ **Simpler** - No complex configuration
✅ **Free** - No usage limits or billing
✅ **Reliable** - Google's infrastructure
✅ **Transparent** - You can see and edit your data directly
✅ **Familiar** - You already use Google Sheets for customers

---

## 📋 Setup Instructions

### Step 1: Create Google Apps Script

1. Go to [https://<apps-script-console-removed>](https://<apps-script-console-removed>)
2. Click **"New Project"**
3. Delete the default code and paste the code from `google-apps-script.js`
4. Save the project (Ctrl+S) - name it "BJS Route History Sync"

### Step 2: Deploy Web App

1. Click **"Deploy"** → **"New deployment"**
2. Choose type: **"Web app"**
3. Execute as: **"Me (your email)"**
4. Who has access: **"Anyone"** (required for your app to access it)
5. Click **"Deploy"**
6. **Copy the deployment URL** - you'll need this next!

### Step 3: Configure Your App

1. Open `sheets-sync.js`
2. Replace `YOUR_SCRIPT_ID` with your deployment URL:
   ```javascript
   const ROUTE_HISTORY_SHEET_URL = "https://<apps-script-endpoint-removed>";
   ```

### Step 4: Test the Setup

1. Open your delivery app
2. Create a test route
3. Check the Google Apps Script dashboard - a new spreadsheet should be created
4. Your route history should now sync across devices!

---

## 🔧 Alternative Options

If you prefer different solutions:

### Option 2: Simple Export/Import
- Add manual export/import buttons
- Users can save routes to files and share them
- No setup required, works offline

### Option 3: Other Cloud Services
- **Supabase** - Free PostgreSQL database
- **Airtable** - Spreadsheet-database hybrid
- **GitHub Gist** - Version-controlled data storage

---

## 🎯 Benefits of Google Sheets Sync

1. **Cross-device sync** - Access routes from any device
2. **Data backup** - Never lose your route history
3. **Easy management** - View/edit data directly in sheets
4. **No costs** - Completely free solution
5. **Reliable** - Google's infrastructure

---

## 🛠️ Technical Details

The system works by:
1. Saving routes to Google Sheets via Google Apps Script
2. Loading routes from sheets on app startup
3. Merging local and cloud data intelligently
4. Falling back to localStorage if sheets are unavailable

Your data is stored in a structured format with columns:
- ID, Username, Route Name, Route Data, Timestamp, Device Info, Stops Count

---

## 📞 Need Help?

If you encounter issues:
1. Check the browser console for error messages
2. Verify the deployment URL is correct
3. Ensure the Google Apps Script has proper permissions
4. Test with a simple route first

**The app will still work locally even if sync fails!** 

