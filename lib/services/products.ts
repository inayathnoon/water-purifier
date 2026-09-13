import { google } from 'googleapis';
import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';
import { sheetCredentials, quotedTab, writeSheetsClient, permissionAwareError, columnLetter } from './googleSheets';

// §9.1 (revised): the business restructured the sheet around variants —
// the same product (e.g. "Krystal TRP") gets one row per variant (e.g.
// "RO+UV" vs "RO+UV+AL"). `sku` is the fully-qualified, unique code for
// that exact variant — it's what this table's `code` column keys off.
// §9.5: spare parts live in the same sheet under their own category, so
// this schema doesn't distinguish "product" from "part" — category does.
//
// `master_sku` and `list_price` are optional columns, not required ones:
// the sheet has gone through two shapes now (with master_sku and no
// price, then without master_sku and with price) — rather than break on
// the next reshuffle too, only sku/category/brand/product_name/variant
// are actually required, and whichever of the other two are present get
// read; whichever aren't get left out of the upsert entirely (so an
// existing value already in the DB is preserved, not nulled).
const REQUIRED_HEADERS = ['sku', 'category', 'brand', 'product_name', 'variant'];
const SHEET_RANGE = process.env.GOOGLE_SHEETS_RANGE || "'Product List'!A:F";

interface ParsedRow {
  productName: string;
  category: string;
  brand: string;
  masterSku?: string;
  variant: string;
  sku: string;
  listPrice?: number | null;
}

// The tab name is whatever comes before "!" in GOOGLE_SHEETS_RANGE, minus
// any surrounding quotes — pulled out once so both the read path (fetch)
// and the write path (append, for "+ Add Product") always target the same
// tab, however it's named.
function sheetTabName(): string {
  const bang = SHEET_RANGE.indexOf('!');
  let tab = bang >= 0 ? SHEET_RANGE.slice(0, bang) : SHEET_RANGE;
  if (tab.startsWith("'") && tab.endsWith("'")) tab = tab.slice(1, -1);
  return tab;
}

async function fetchSheetRows(): Promise<string[][]> {
  const { sheetId, credentials } = sheetCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  // UNFORMATTED_VALUE — see the same fix in spareParts.ts: a comma-
  // formatted list_price cell would otherwise come back as the literal
  // display string ("1,200"), and Number() on that is NaN. Not currently
  // hit here (checked live: this sheet's list_price column isn't
  // comma-formatted), but there's nothing stopping someone from applying
  // that format later the same way it happened on the Spare Parts tab.
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: SHEET_RANGE,
    valueRenderOption: 'UNFORMATTED_VALUE',
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
  const missing = REQUIRED_HEADERS.filter((h) => !actual.includes(h));

  if (missing.length > 0) {
    throw new ApiError(
      422,
      `Product sheet columns don't match what's expected. Missing: ${missing.join(', ')}. ` +
        `Found: ${actual.join(', ') || '(empty sheet)'}. Nothing was synced.`
    );
  }
}

function parseRows(rows: string[][]): { parsed: ParsedRow[]; hasMasterSku: boolean; hasListPrice: boolean } {
  const [headerRow, ...dataRows] = rows;
  validateHeaders(headerRow);

  const normalizedHeaders = headerRow.map((h) => h.trim().toLowerCase());
  const colIndex = (name: string) => normalizedHeaders.indexOf(name);
  const hasMasterSku = normalizedHeaders.includes('master_sku');
  const hasListPrice = normalizedHeaders.includes('list_price');

  const idx = {
    productName: colIndex('product_name'),
    category: colIndex('category'),
    brand: colIndex('brand'),
    masterSku: colIndex('master_sku'),
    variant: colIndex('variant'),
    sku: colIndex('sku'),
    listPrice: colIndex('list_price'),
  };

  const parsed: ParsedRow[] = [];
  for (const row of dataRows) {
    const sku = (row[idx.sku] ?? '').trim();
    if (!sku) continue; // skip blank trailing rows

    const entry: ParsedRow = {
      productName: (row[idx.productName] ?? '').trim(),
      category: (row[idx.category] ?? '').trim(),
      brand: (row[idx.brand] ?? '').trim(),
      variant: (row[idx.variant] ?? '').trim(),
      sku,
    };
    if (hasMasterSku) entry.masterSku = (row[idx.masterSku] ?? '').trim();
    if (hasListPrice) {
      // Unlike the text columns above, this one can legitimately come
      // back as a JS number (not a string) now that the sheet is read
      // with UNFORMATTED_VALUE — a bare .trim() would throw on that.
      const cell = row[idx.listPrice];
      const raw = typeof cell === 'number' ? String(cell) : (cell ?? '').trim();
      entry.listPrice = raw === '' ? null : Number(raw);
    }
    parsed.push(entry);
  }

  return { parsed, hasMasterSku, hasListPrice };
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
  // throws loudly on any structural problem — nothing partial gets written
  const { parsed, hasMasterSku, hasListPrice } = parseRows(rows);

  if (parsed.length === 0) {
    throw new ApiError(422, 'Sheet parsed to zero product rows — refusing to sync (would deactivate everything)');
  }

  const now = new Date().toISOString();

  // master_sku/list_price only included in the upsert when the sheet
  // actually carries that column — omitting a key entirely (rather than
  // writing null) leaves any existing value untouched instead of wiping it.
  const { error: upsertError } = await supabaseAdmin.from('products').upsert(
    parsed.map((p) => ({
      code: p.sku,
      category: p.category,
      brand: p.brand,
      name: p.productName,
      variant: p.variant,
      active: true,
      last_synced_at: now,
      ...(hasMasterSku ? { master_sku: p.masterSku } : {}),
      ...(hasListPrice ? { list_price: p.listPrice } : {}),
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

/**
 * The spreadsheet stays the source of truth — adding a product in the app
 * writes the row into the sheet first (not straight into `products`), then
 * immediately re-syncs so it shows up right away instead of waiting for
 * the next nightly pull. Keeps there being exactly one place products
 * actually live, same as every product added by hand in the sheet.
 *
 * Reads the sheet's real header row and places each value under its
 * matching column by name, rather than assuming a fixed column order —
 * the same reasoning as parseRows() reading columns by name, not position.
 */
/**
 * Fixes a price on an existing product — same "sheet stays the source of
 * truth" rule, so this finds the product's actual row by SKU and edits
 * the list_price cell in place, then re-syncs, rather than writing
 * straight to the `products` table and leaving the sheet out of date.
 * (Adding a brand-new product from the app was removed 2026-09-05 — new
 * products are only ever added by editing the sheet directly, then
 * syncing.)
 */
export async function updateProductListPriceInSheet(sku: string, listPrice: number | null): Promise<void> {
  const { sheets, sheetId } = writeSheetsClient();
  const tab = quotedTab(sheetTabName());

  let allRows: string[][];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${tab}!A:Z` });
    allRows = res.data.values ?? [];
  } catch (e) {
    throw new ApiError(500, `Could not read the product sheet: ${(e as Error).message}`);
  }

  const [headerRow, ...dataRows] = allRows;
  const normalizedHeaders = (headerRow ?? []).map((h) => h.trim().toLowerCase());
  const skuCol = normalizedHeaders.indexOf('sku');
  const priceCol = normalizedHeaders.indexOf('list_price');
  if (skuCol === -1) throw new ApiError(422, "The product sheet has no 'sku' column to match against.");
  if (priceCol === -1) throw new ApiError(422, "The product sheet has no 'list_price' column to edit.");

  const rowIdx = dataRows.findIndex((r) => (r[skuCol] ?? '').trim().toLowerCase() === sku.trim().toLowerCase());
  if (rowIdx === -1) throw new ApiError(404, `SKU "${sku}" was not found in the product sheet.`);

  const sheetRowNumber = rowIdx + 2; // +1 for the header row, +1 for 1-indexing
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tab}!${columnLetter(priceCol)}${sheetRowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[listPrice != null ? String(listPrice) : '']] },
    });
  } catch (e) {
    throw permissionAwareError(e, 'edit this price');
  }
}
