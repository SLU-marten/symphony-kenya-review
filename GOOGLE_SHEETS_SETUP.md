# Google Sheets Sync — Setup

Every time a reviewer hits **Submit review**, the app does a fire-and-forget POST to a Google Apps Script web app URL. The script appends a row to a Google Sheet you control. No backend, no auth keys, no recurring cost.

You only need to do this **once per project**.

---

## 1. Create the Google Sheet

1. Open <https://sheets.google.com> and create a new blank spreadsheet.
2. Rename it to something like **"Symphony Kenya Reviews"**.
3. Leave the sheet empty — the script writes the header row automatically on the first submit.

---

## 2. Paste the Apps Script

In the same Sheet:

1. **Extensions → Apps Script**.
2. Replace the default `Code.gs` content with the script below.
3. Press **Save** (Ctrl + S). Name the project "Symphony Kenya Sync".

```javascript
const HEADERS = [
  'timestamp',
  'layer_key',
  'flag',
  'comment',
  'focus_areas',
  'other_focus',
  'has_better_data',
  'better_data_source',
  'reviewer_name',
  'reviewer_email',
  'reviewer_expertise',
  'reviewer_consent',
];

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  // Write header row on first POST (sheet is empty).
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  const data = JSON.parse(e.postData.contents);

  sheet.appendRow([
    data.timestamp,
    data.layer_key,
    data.flag,
    data.comment,
    Array.isArray(data.focus_areas) ? data.focus_areas.join(', ') : (data.focus_areas || ''),
    data.other_focus,
    data.has_better_data,
    data.better_data_source,
    data.reviewer_name,
    data.reviewer_email,
    data.reviewer_expertise,
    data.reviewer_consent === true ? 'TRUE' : 'FALSE',
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

---

## 3. Deploy as a Web App

1. Click **Deploy → New deployment**.
2. Click the ⚙ gear next to **Select type** → choose **Web app**.
3. Fill in:
   - **Description**: `Symphony Kenya Reviews` (or anything)
   - **Execute as**: **Me** (your Google account)
   - **Who has access**: **Anyone** (required so reviewers' browsers can POST without authentication)
4. **Deploy** → Google will prompt for authorization. Click through — review the access scope and grant it. (The script only writes to this one sheet.)
5. Copy the **Web app URL** at the end. It looks like:
   `https://script.google.com/macros/s/AKfycb…/exec`

> **Updating the script later?** Use **Deploy → Manage deployments → ✏ Edit** on the existing deployment and set **Version: New version**. Don't create a new deployment — that gives a new URL and you'd have to update the app again.

---

## 4. Wire the URL into the app

You have two options. **Option A** is simpler, **Option B** keeps the URL out of the source files.

### A. Direct edit (simplest)

Open `src/services/reviewService.js` and paste the URL:

```javascript
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycb…/exec';
```

### B. `.env.local` (keeps URL out of git)

Create `symphony_kenya_review/.env.local` (already gitignored by Vite by default):

```
VITE_SHEETS_URL=https://script.google.com/macros/s/AKfycb…/exec
```

Restart `npm run dev` — Vite reads `.env.local` on startup, not via HMR.

The code in `reviewService.js` checks the env var first, then falls back to the constant.

---

## 5. Test it

1. With `npm run dev` running, open the app.
2. Submit a test review on any layer.
3. Open the Google Sheet — a row should appear within a second or two with the timestamp, layer key, flag, comment, focus areas, reviewer info, etc.

If nothing shows up:

- **Check the browser console.** A `Failed to submit to Google Sheets` warning means the POST itself failed (URL typo, deployment not active).
- **Check Apps Script execution log**: in the script editor, **Executions** tab. A failure with `Authorization required` means the deployment is set to **Execute as: User accessing the web app** instead of **Me**, or **Who has access: Only myself** instead of **Anyone**. Re-edit the deployment.
- **Verify the URL** ends with `/exec`. The `/dev` URL is for editor previews only and won't accept anonymous POSTs.

---

## Sheet schema

One row per submit (re-submits append, giving you a full audit trail). Columns:

| # | Column                | Type     | Notes |
|---|-----------------------|----------|-------|
| A | timestamp             | ISO 8601 | When the reviewer clicked Submit |
| B | layer_key             | text     | e.g. `ecosystem:mangrove` |
| C | flag                  | text     | `green` / `yellow` / `red` |
| D | comment               | text     | Free-text justification |
| E | focus_areas           | text     | Comma-joined list, e.g. `data_accuracy, visualization` |
| F | other_focus           | text     | Free text only if "Other" was ticked |
| G | has_better_data       | text     | `yes` / `no` |
| H | better_data_source    | text     | Link or citation if Yes |
| I | reviewer_name         | text     | From the setup modal |
| J | reviewer_email        | text     | From the setup modal |
| K | reviewer_expertise    | text     | From the setup modal |
| L | reviewer_consent      | text     | `TRUE` / `FALSE` |

To get the **latest** review per `(reviewer, layer)` use a pivot or this formula in another sheet:

```
=QUERY(Sheet1!A:L, "SELECT B, MAX(A), I, C, D WHERE A IS NOT NULL GROUP BY B, I, C, D ORDER BY MAX(A) DESC LABEL MAX(A) 'latest'", 1)
```

---

## Privacy notes

- Reviewer email is sent on **every submit** (so each row carries who said what). The setup modal asks for explicit consent — column L records the answer. Honour the consent flag before reaching out.
- Apps Script logs every execution for ~30 days (visible to you in the **Executions** tab); the body of each request is logged too. If you'd rather keep zero server-side log of reviewer info, switch to the JSON export flow (re-add the export button) instead of Sheets.
- The web-app URL itself is a shared secret. Anyone with the URL can append rows to your sheet. Don't put it in a public README or commit it to git — that's why **Option B** above is recommended.
