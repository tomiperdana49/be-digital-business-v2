/**
 * Web app penerima feedback Salesboard, ditempel di Apps Script milik spreadsheet feedback
 * (Extensions > Apps Script). Backend memanggilnya dari FeedbackRepository.
 *
 * Setup:
 * 1. Project Settings > Script Properties: tambah FEEDBACK_SECRET (sama dengan FEEDBACK_APPS_SCRIPT_SECRET di .env backend)
 * 2. Deploy > New deployment > Web app: Execute as "Me", Who has access "Anyone"
 * 3. Salin URL web app (.../exec) ke FEEDBACK_APPS_SCRIPT_URL di .env backend
 * Setiap kali kode ini diubah, buat versi baru di Deploy > Manage deployments supaya URL yang sama ikut terupdate.
 */

const HEADER = ['Tanggal', 'Employee ID', 'Nama', 'Tipe', 'Halaman', 'Deskripsi', 'Lampiran'];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const secret = PropertiesService.getScriptProperties().getProperty('FEEDBACK_SECRET');

    if (!secret || body.secret !== secret) {
      return json({ success: false, message: 'Unauthorized' });
    }

    const row = [
      body.createdAt,
      body.employeeId,
      body.name,
      body.type,
      body.url,
      body.message,
      (body.images || []).join('\n'),
    ].map(asText);

    // insertRow + setValues tidak atomik seperti appendRow, jadi kunci supaya request bersamaan tidak saling timpa
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      // Sheet (tab) pertama, sama dengan gid=0
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(HEADER);
      }

      // Feedback terbaru paling atas: sisipkan tepat di bawah header
      sheet.insertRowAfter(1);
      const range = sheet.getRange(2, 1, 1, row.length);
      // Baris sisipan mewarisi format header (mis. bold); samakan dengan baris data di bawahnya
      if (sheet.getLastRow() >= 3) {
        sheet.getRange(3, 1, 1, row.length).copyTo(range, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      } else {
        range.clearFormat();
      }
      range.setValues([row]);
    } finally {
      lock.releaseLock();
    }

    return json({ success: true });
  } catch (err) {
    return json({ success: false, message: String(err) });
  }
}

// Simpan sebagai teks apa adanya: awalan ' mencegah "=..." dijalankan sebagai formula
// dan Employee ID seperti "0201507" berubah jadi angka 201507
function asText(value) {
  const text = value == null ? '' : String(value);
  return /^([=+\-@]|\d+$)/.test(text) ? "'" + text : text;
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
