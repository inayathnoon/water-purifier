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

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A cell written as "2026-09-02" (USER_ENTERED) comes back from a later
 * read as "Sep 2, 2026" — Sheets recognizes it as a real date and
 * reformats it for display. Matching a freshly-computed "YYYY-MM-DD"
 * against that reformatted string with plain equality never succeeds, so
 * date-shaped match columns (bill_date, etc.) go through this first.
 * Deliberately does its own string parsing rather than `new Date(...)` —
 * that constructor treats a bare "YYYY-MM-DD" as UTC midnight but
 * "Sep 2, 2026" as *local* midnight (spec behavior), which would
 * silently disagree by a day outside UTC — the exact class of bug
 * documented in CLAUDE.md's historical-import timezone note.
 * Anything not matching either shape is returned unchanged (lowercased).
 */
export function normalizeForMatch(value: string): string {
  const v = (value ?? '').trim();
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const display = v.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})$/);
  if (display) {
    const monthIdx = MONTHS.indexOf(display[1].toLowerCase());
    if (monthIdx !== -1) {
      return `${display[3]}-${String(monthIdx + 1).padStart(2, '0')}-${display[2].padStart(2, '0')}`;
    }
  }

  return v.toLowerCase();
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

// Every one-way sheet (Sales/Service/Enquiry) uses this exact header name
// for the column it matches rows on.
const PHONE_HEADER = 'phone_number';

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
 * Reads a tab's header row and truncates it at the first blank cell —
 * some of this spreadsheet's tabs have old, no-longer-used formula
 * columns sitting past the real header (blank cell, then leftover
 * labels), which confuses both column-by-name lookups and (worse)
 * Sheets' own values.append table-detection into misaligning an
 * appended row's columns entirely. Truncating gives every write path a
 * single, reliable idea of how wide the real table actually is.
 */
async function readRealHeader(tab: string): Promise<{ headers: string[]; qtab: string; sheets: ReturnType<typeof writeSheetsClient>['sheets']; sheetId: string }> {
  const { sheets, sheetId } = writeSheetsClient();
  const qtab = quotedTab(tab);

  let rawHeader: string[];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${qtab}!1:1` });
    rawHeader = (res.data.values?.[0] ?? []).map((h) => h.trim().toLowerCase());
  } catch (e) {
    throw new ApiError(500, `Could not read the "${tab}" sheet's header row: ${(e as Error).message}`);
  }
  const blankAt = rawHeader.findIndex((h) => h === '');
  const headers = blankAt === -1 ? rawHeader : rawHeader.slice(0, blankAt);
  if (headers.length === 0) {
    throw new ApiError(422, `The "${tab}" sheet's header row is empty — nothing to write against.`);
  }
  return { headers, qtab, sheets, sheetId };
}

/**
 * Like appendRowByHeader, but first looks for an existing row matching on
 * `matchColumns` (e.g. phone_number + bill_date + sold_price for a sale)
 * and updates it in place instead of adding a duplicate — for a sheet
 * that's meant to track one row per real-world thing (a sale) as it
 * changes over time (a payment recorded, warranty dates stamped later),
 * rather than one row per event.
 */
export async function upsertRowByHeader(
  tab: string,
  valuesByColumn: Record<string, string>,
  matchColumns: string[]
): Promise<'inserted' | 'updated'> {
  const { headers, qtab, sheets, sheetId } = await readRealHeader(tab);
  const lastCol = columnLetter(headers.length - 1);

  const matchIdx = matchColumns.map((c) => headers.indexOf(c));
  const missingMatchCols = matchColumns.filter((_, i) => matchIdx[i] === -1);
  if (missingMatchCols.length > 0) {
    throw new ApiError(422, `The "${tab}" sheet is missing column(s) needed to match rows: ${missingMatchCols.join(', ')}`);
  }

  let dataRows: string[][];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${qtab}!A2:${lastCol}` });
    dataRows = res.data.values ?? [];
  } catch (e) {
    throw new ApiError(500, `Could not read the "${tab}" sheet: ${(e as Error).message}`);
  }

  const rowIdx = dataRows.findIndex((r) =>
    matchColumns.every(
      (col, i) => normalizeForMatch(r[matchIdx[i]] ?? '') === normalizeForMatch(valuesByColumn[col] ?? '')
    )
  );

  const row = headers.map((h) => valuesByColumn[h] ?? '');
  const targetRow = rowIdx === -1 ? dataRows.length + 2 : rowIdx + 2; // +1 header, +1 1-indexing

  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${qtab}!A${targetRow}:${lastCol}${targetRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
  } catch (e) {
    throw permissionAwareError(e, rowIdx === -1 ? `add a row to "${tab}"` : `update a row in "${tab}"`);
  }
  return rowIdx === -1 ? 'inserted' : 'updated';
}

/**
 * Blanks the one existing row matching `matchColumns` — for un-writing a
 * sheet row after its underlying record is deleted (a voided purchase).
 * Unlike upsertRowByHeader, this never creates a row — a miss is a no-op,
 * since there's nothing to un-write.
 */
export async function clearMatchingRowByHeader(
  tab: string,
  matchValues: Record<string, string>,
  matchColumns: string[]
): Promise<boolean> {
  const { headers, qtab, sheets, sheetId } = await readRealHeader(tab);
  const lastCol = columnLetter(headers.length - 1);

  const matchIdx = matchColumns.map((c) => headers.indexOf(c));
  const missingMatchCols = matchColumns.filter((_, i) => matchIdx[i] === -1);
  if (missingMatchCols.length > 0) {
    throw new ApiError(422, `The "${tab}" sheet is missing column(s) needed to match rows: ${missingMatchCols.join(', ')}`);
  }

  let dataRows: string[][];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${qtab}!A2:${lastCol}` });
    dataRows = res.data.values ?? [];
  } catch (e) {
    throw new ApiError(500, `Could not read the "${tab}" sheet: ${(e as Error).message}`);
  }

  const rowIdx = dataRows.findIndex((r) =>
    matchColumns.every(
      (col, i) => normalizeForMatch(r[matchIdx[i]] ?? '') === normalizeForMatch(matchValues[col] ?? '')
    )
  );
  if (rowIdx === -1) return false;

  const targetRow = rowIdx + 2; // +1 header, +1 1-indexing
  try {
    await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: `${qtab}!A${targetRow}:${lastCol}${targetRow}` });
  } catch (e) {
    throw permissionAwareError(e, `clear a row in "${tab}"`);
  }
  return true;
}

/**
 * Corrects every existing row in one tab that's keyed on `oldPhone`,
 * in place — for when a customer's phone number itself was wrong and
 * gets fixed. The normal upsert functions can't handle this on their
 * own: after the DB is corrected they'd look up rows by the *new*
 * number, never find the old row, and insert a duplicate next to it
 * (exactly what happened once with a real customer's corrected number,
 * before this existed). A tab with no `phone_number` column (Product
 * List, Spare Parts) is a no-op, not an error.
 */
export async function renamePhoneNumberInSheet(tab: string, oldPhone: string, newPhone: string): Promise<number> {
  const { headers, qtab, sheets, sheetId } = await readRealHeader(tab);
  const phoneIdx = headers.indexOf(PHONE_HEADER);
  if (phoneIdx === -1) return 0;

  const col = columnLetter(phoneIdx);
  let column: string[][];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${qtab}!${col}2:${col}` });
    column = res.data.values ?? [];
  } catch (e) {
    throw new ApiError(500, `Could not read the "${tab}" sheet: ${(e as Error).message}`);
  }

  const matchedRows = column
    .map((r, i) => (normalizeForMatch(r[0] ?? '') === normalizeForMatch(oldPhone) ? i : -1))
    .filter((i) => i !== -1);
  if (matchedRows.length === 0) return 0;

  try {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: matchedRows.map((i) => ({ range: `${qtab}!${col}${i + 2}`, values: [[newPhone]] })),
      },
    });
  } catch (e) {
    throw permissionAwareError(e, `rename a phone number in "${tab}"`);
  }
  return matchedRows.length;
}
