import { readSheetsClient, quotedTab } from './googleSheets';
import { ApiError } from '../api-auth';

// A separate, much simpler tab from the main product catalog — just
// "Parts | Price", no code/category/brand. What a tech actually carries
// and might sell during a service visit (§8.4). Barely ever changes, so
// rather than hit the Sheets API on every single load of the completion
// form (real quota cost, and a slower load for a tech on their phone),
// this is cached in memory for a while — Railway runs this as a
// persistent Node process (`next start`), not a per-request serverless
// function, so a plain module-level variable survives between requests
// on the same instance.
const SPARE_PARTS_TAB = process.env.GOOGLE_SPARE_PARTS_SHEET_TAB || 'Spare Parts';
// This list barely ever changes, so refreshing it is a manual action (the
// Developer panel's "Sync spare parts" button) rather than a short TTL —
// the long TTL here is only a safety net in case nobody remembers to
// sync after an edit, not the intended way changes reach the app.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface SparePart {
  name: string;
  price: number;
}

let cache: { parts: SparePart[]; fetchedAt: number } | null = null;

async function fetchSpareParts(): Promise<SparePart[]> {
  const { sheets, sheetId } = readSheetsClient();
  const qtab = quotedTab(SPARE_PARTS_TAB);

  let rows: string[][];
  try {
    // UNFORMATTED_VALUE (default is FORMATTED_VALUE) — without this, a
    // price the sheet displays with a thousands separator (e.g. "1,200")
    // comes back as that literal string, `Number("1,200")` is NaN, and
    // the `|| 0` fallback below silently turned every such part free.
    // Confirmed live: UV Chamber/RO Membrane/Alkaline Filter/SMPS (all
    // 4+ digit prices) were reading ₹0 while every 3-digit price (no
    // comma) read correctly.
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${qtab}!A:B`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    rows = res.data.values ?? [];
  } catch (e) {
    throw new ApiError(500, `Could not read the "${SPARE_PARTS_TAB}" sheet: ${(e as Error).message}`);
  }

  return rows
    .slice(1) // header row
    .filter((r) => (r[0] ?? '').trim())
    .map((r) => ({ name: String(r[0]).trim(), price: Number(r[1]) || 0 }));
}

export async function getSpareParts(): Promise<SparePart[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.parts;
  }
  const parts = await fetchSpareParts();
  cache = { parts, fetchedAt: Date.now() };
  return parts;
}

/** Developer panel's "Sync spare parts" — forces a fresh read regardless
 * of how old the cache is, the moment someone's actually edited the sheet. */
export async function syncSpareParts(): Promise<SparePart[]> {
  const parts = await fetchSpareParts();
  cache = { parts, fetchedAt: Date.now() };
  return parts;
}
