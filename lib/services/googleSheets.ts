import { google } from 'googleapis';
import { ApiError } from '../api-auth';

// Shared across every sheet this app talks to (Product List, Sales, ...) —
// all live as tabs in one spreadsheet, one shared service account.
export function sheetCredentials(): { sheetId: string; credentials: Record<string, unknown> } {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!sheetId || !credentialsJson) {
    throw new ApiError(500, 'Google Sheets is not configured (GOOGLE_SHEETS_ID / GOOGLE_SERVICE_ACCOUNT_JSON)');
  }
  return { sheetId, credentials: JSON.parse(credentialsJson) };
}

// A tab name needs to be wrapped in single quotes for the Sheets API only
// when it isn't a bare word (has a space, etc.) — "Product List" does, a
// hypothetical "Products" wouldn't.
export function quotedTab(tab: string): string {
  return /^[A-Za-z0-9_]+$/.test(tab) ? tab : `'${tab}'`;
}

// 0-indexed column number → spreadsheet letter (A, B, ... Z, AA, AB, ...).
export function columnLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function permissionAwareError(e: unknown, action: string): ApiError {
  const message = (e as Error).message || 'Unknown error';
  if (/permission/i.test(message)) {
    return new ApiError(
      500,
      'Google Sheets refused the write — the service account has Viewer access on the sheet but needs ' +
        `Editor access to ${action}. Share the sheet with it as an Editor and try again.`
    );
  }
  return new ApiError(500, `Failed to ${action}: ${message}`);
}

/** Read-only client — for pulling data in (product sync, reading a header row before a write). */
export function readSheetsClient() {
  const { sheetId, credentials } = sheetCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return { sheets: google.sheets({ version: 'v4', auth }), sheetId };
}

/**
 * Full read-write — only for the handful of calls that actually write
 * (appending a new product/sale row, editing a price). The sheet must
 * share Editor (not just Viewer) access with this service account, or
 * Google refuses the write.
 */
export function writeSheetsClient() {
  const { sheetId, credentials } = sheetCredentials();
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return { sheets: google.sheets({ version: 'v4', auth }), sheetId };
}

/**
 * Appends one row to `tab`, placed under whichever columns the sheet's
 * own header row actually has (by name, not position) — so this doesn't
 * need to assume or hard-code a column order for a sheet a human can
 * reorder at any time. Silently drops values whose column doesn't exist
 * in the sheet.
 */
export async function appendRowByHeader(tab: string, valuesByColumn: Record<string, string>): Promise<void> {
  const { sheets, sheetId } = writeSheetsClient();
  const qtab = quotedTab(tab);

  let headerRow: string[];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${qtab}!1:1` });
    headerRow = (res.data.values?.[0] ?? []).map((h) => h.trim().toLowerCase());
  } catch (e) {
    throw new ApiError(500, `Could not read the "${tab}" sheet's header row: ${(e as Error).message}`);
  }
  if (headerRow.length === 0) {
    throw new ApiError(422, `The "${tab}" sheet's header row is empty — nothing to append against.`);
  }

  const row = headerRow.map((h) => valuesByColumn[h] ?? '');

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${qtab}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
  } catch (e) {
    throw permissionAwareError(e, `add a row to "${tab}"`);
  }
}
