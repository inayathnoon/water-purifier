import { google } from 'googleapis';
import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';

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
const OPTIONAL_HEADERS = ['master_sku', 'list_price'];
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

function sheetCredentials(): { sheetId: string; credentials: Record<string, unknown> } {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!sheetId || !credentialsJson) {
    throw new ApiError(500, 'Google Sheets is not configured (GOOGLE_SHEETS_ID / GOOGLE_SERVICE_ACCOUNT_JSON)');
  }
  return { sheetId, credentials: JSON.parse(credentialsJson) };
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

// A tab name needs to be wrapped in single quotes for the Sheets API only
// when it isn't a bare word (has a space, etc.) — "Product List" does, a
// hypothetical "Products" wouldn't.
function quotedTab(tab: string): string {
  return /^[A-Za-z0-9_]+$/.test(tab) ? tab : `'${tab}'`;
}

async function fetchSheetRows(): Promise<string[][]> {
  const { sheetId, credentials } = sheetCredentials();
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
      const raw = (row[idx.listPrice] ?? '').trim();
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
export async function appendProductToSheet(product: {
  sku: string;
  category: string;
  brand: string;
  productName: string;
  variant: string;
  listPrice?: number | null;
}): Promise<void> {
  const { sheetId, credentials } = sheetCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    // Full read-write — unlike every other call in this file, which only
    // ever reads. The sheet must also share Editor (not just Viewer)
    // access with this service account, or Google refuses the write.
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const tab = quotedTab(sheetTabName());

  let headerRow: string[];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${tab}!1:1` });
    headerRow = (res.data.values?.[0] ?? []).map((h) => h.trim().toLowerCase());
  } catch (e) {
    throw new ApiError(500, `Could not read the product sheet's header row: ${(e as Error).message}`);
  }
  if (headerRow.length === 0) {
    throw new ApiError(422, "The product sheet's header row is empty — nothing to append against.");
  }

  const valuesByColumn: Record<string, string> = {
    sku: product.sku,
    category: product.category,
    brand: product.brand,
    product_name: product.productName,
    variant: product.variant,
    list_price: product.listPrice != null ? String(product.listPrice) : '',
    // master_sku deliberately left blank — nothing here computes one, and
    // an empty cell is safer than a guessed value in someone's sheet.
  };
  const row = headerRow.map((h) => valuesByColumn[h] ?? '');

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${tab}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
  } catch (e) {
    const message = (e as Error).message || 'Unknown error';
    if (/permission/i.test(message)) {
      throw new ApiError(
        500,
        'Google Sheets refused the write — the service account has Viewer access on the sheet but needs ' +
          'Editor access to add rows. Share the sheet with it as an Editor and try again.'
      );
    }
    throw new ApiError(500, `Failed to add the product to the sheet: ${message}`);
  }
}
