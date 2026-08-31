import { google } from 'googleapis';
import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';

// §9.1 (revised): the business restructured the sheet around variants —
// the same product (e.g. "Krystal TRP") gets one row per variant (e.g.
// "RO+UV" vs "RO+UV+AL"), grouped by a shared master_sku. `sku` is the
// fully-qualified, unique code for that exact variant — it's what this
// table's `code` column keys off. There's no price column any more; it
// was never actually read anywhere besides this page.
// §9.5: spare parts live in the same sheet under their own category, so
// this schema doesn't distinguish "product" from "part" — category does.
const EXPECTED_HEADERS = ['product_name', 'category', 'brand', 'master_sku', 'variant', 'sku'];
const SHEET_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'Products!A:F';

interface ParsedRow {
  productName: string;
  category: string;
  brand: string;
  masterSku: string;
  variant: string;
  sku: string;
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
    productName: colIndex('product_name'),
    category: colIndex('category'),
    brand: colIndex('brand'),
    masterSku: colIndex('master_sku'),
    variant: colIndex('variant'),
    sku: colIndex('sku'),
  };

  const parsed: ParsedRow[] = [];
  for (const row of dataRows) {
    const sku = (row[idx.sku] ?? '').trim();
    if (!sku) continue; // skip blank trailing rows

    parsed.push({
      productName: (row[idx.productName] ?? '').trim(),
      category: (row[idx.category] ?? '').trim(),
      brand: (row[idx.brand] ?? '').trim(),
      masterSku: (row[idx.masterSku] ?? '').trim(),
      variant: (row[idx.variant] ?? '').trim(),
      sku,
    });
  }

  return parsed;
}

/**
 * §9.2: pull a fresh copy from the sheet (nightly + on-demand "Sync now").
 * §9.3: products removed from the sheet are switched off, never deleted —
 * so historical orders that reference them still resolve.
 * §9.4: sku (stored as `code`) is the stable key; renaming a product's
 * name/category in the sheet updates the existing row rather than
 * creating a duplicate.
 */
export async function syncProductsFromSheet(): Promise<{ upserted: number; deactivated: number }> {
  const rows = await fetchSheetRows();
  const parsed = parseRows(rows); // throws loudly on any structural problem — nothing partial gets written

  if (parsed.length === 0) {
    throw new ApiError(422, 'Sheet parsed to zero product rows — refusing to sync (would deactivate everything)');
  }

  const now = new Date().toISOString();

  // list_price deliberately omitted — the sheet doesn't carry one, and
  // leaving it out of the upsert payload means an existing value (if one
  // is ever set some other way) is left untouched rather than nulled.
  const { error: upsertError } = await supabaseAdmin.from('products').upsert(
    parsed.map((p) => ({
      code: p.sku,
      category: p.category,
      brand: p.brand,
      name: p.productName,
      master_sku: p.masterSku,
      variant: p.variant,
      active: true,
      last_synced_at: now,
    })),
    { onConflict: 'code' }
  );
  if (upsertError) throw new ApiError(500, `Upsert failed: ${upsertError.message}`);

  const currentCodes = parsed.map((p) => p.sku);
  const { data: deactivated, error: deactivateError } = await supabaseAdmin
    .from('products')
    .update({ active: false })
    .not('code', 'in', `(${currentCodes.map((c) => `"${c}"`).join(',')})`)
    .eq('active', true)
    .select('id');
  if (deactivateError) throw new ApiError(500, `Deactivation failed: ${deactivateError.message}`);

  return { upserted: parsed.length, deactivated: deactivated?.length ?? 0 };
}
