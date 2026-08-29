import { google } from 'googleapis';
import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';

// §9.1: category, type, brand, name, code, list price — in this order.
// §9.5: spare parts live in the same sheet under their own category, so
// this schema doesn't distinguish "product" from "part" — category does.
const EXPECTED_HEADERS = ['category', 'type', 'brand', 'name', 'code', 'list price'];
const SHEET_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'Products!A:F';

interface ParsedRow {
  category: string;
  type: string;
  brand: string;
  name: string;
  code: string;
  listPrice: number;
}

async function fetchSheetRows(): Promise<string[][]> {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!sheetId || !credentialsJson) {
    throw new ApiError(500, 'Google Sheets is not configured (GOOGLE_SHEETS_ID / GOOGLE_SERVICE_ACCOUNT_JSON)');
  }

  const credentials = JSON.parse(credentialsJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: SHEET_RANGE,
  });

  return res.data.values ?? [];
}

/**
 * §9.6: if someone renames a column, this must fail loudly and tell
 * somebody — never silently write blanks. This check is the enforcement
 * point: it runs before a single row is parsed, so a rename can't corrupt
 * data even partially.
 */
function validateHeaders(headerRow: string[] | undefined): void {
  const actual = (headerRow ?? []).map((h) => h.trim().toLowerCase());
  const missing = EXPECTED_HEADERS.filter((h) => !actual.includes(h));

  if (missing.length > 0) {
    throw new ApiError(
      422,
      `Product sheet columns don't match what's expected. Missing: ${missing.join(', ')}. ` +
        `Found: ${actual.join(', ') || '(empty sheet)'}. Nothing was synced.`
    );
  }
}

function parseRows(rows: string[][]): ParsedRow[] {
  const [headerRow, ...dataRows] = rows;
  validateHeaders(headerRow);

  const normalizedHeaders = headerRow.map((h) => h.trim().toLowerCase());
  const colIndex = (name: string) => normalizedHeaders.indexOf(name);

  const idx = {
    category: colIndex('category'),
    type: colIndex('type'),
    brand: colIndex('brand'),
    name: colIndex('name'),
    code: colIndex('code'),
    listPrice: colIndex('list price'),
  };

  const parsed: ParsedRow[] = [];
  for (const row of dataRows) {
    const code = (row[idx.code] ?? '').trim();
    if (!code) continue; // skip blank trailing rows

    const rawPrice = (row[idx.listPrice] ?? '').replace(/[^0-9.]/g, '');
    const listPrice = parseFloat(rawPrice);
    if (!code || isNaN(listPrice)) {
      throw new ApiError(422, `Row for code "${code || '(blank)'}" has an invalid list price: "${row[idx.listPrice]}". Nothing was synced.`);
    }

    parsed.push({
      category: (row[idx.category] ?? '').trim(),
      type: (row[idx.type] ?? '').trim(),
      brand: (row[idx.brand] ?? '').trim(),
      name: (row[idx.name] ?? '').trim(),
      code,
      listPrice,
    });
  }

  return parsed;
}

/**
 * §9.2: pull a fresh copy from the sheet (nightly + on-demand "Sync now").
 * §9.3: products removed from the sheet are switched off, never deleted —
 * so historical orders that reference them still resolve.
 * §9.4: code is the stable key; renaming a product's name/category in the
 * sheet updates the existing row rather than creating a duplicate.
 */
export async function syncProductsFromSheet(): Promise<{ upserted: number; deactivated: number }> {
  const rows = await fetchSheetRows();
  const parsed = parseRows(rows); // throws loudly on any structural problem — nothing partial gets written

  if (parsed.length === 0) {
    throw new ApiError(422, 'Sheet parsed to zero product rows — refusing to sync (would deactivate everything)');
  }

  const now = new Date().toISOString();

  const { error: upsertError } = await supabaseAdmin.from('products').upsert(
    parsed.map((p) => ({
      code: p.code,
      category: p.category,
      type: p.type,
      brand: p.brand,
      name: p.name,
      list_price: p.listPrice,
      active: true,
      last_synced_at: now,
    })),
    { onConflict: 'code' }
  );
  if (upsertError) throw new ApiError(500, `Upsert failed: ${upsertError.message}`);

  const currentCodes = parsed.map((p) => p.code);
  const { data: deactivated, error: deactivateError } = await supabaseAdmin
    .from('products')
    .update({ active: false })
    .not('code', 'in', `(${currentCodes.map((c) => `"${c}"`).join(',')})`)
    .eq('active', true)
    .select('id');
  if (deactivateError) throw new ApiError(500, `Deactivation failed: ${deactivateError.message}`);

  return { upserted: parsed.length, deactivated: deactivated?.length ?? 0 };
}
