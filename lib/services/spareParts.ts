import { readSheetsClient, quotedTab } from './googleSheets';
import { ApiError } from '../api-auth';

// A separate, much simpler tab from the main product catalog — just
// "Parts | Price", no code/category/brand. What a tech actually carries
// and might sell during a service visit (§8.4), read fresh on every
// completion form load rather than synced into the DB, since there's
// nothing else in the app that needs to query or join against it.
const SPARE_PARTS_TAB = process.env.GOOGLE_SPARE_PARTS_SHEET_TAB || 'Spare Parts';

export interface SparePart {
  name: string;
  price: number;
}

export async function getSpareParts(): Promise<SparePart[]> {
  const { sheets, sheetId } = readSheetsClient();
  const qtab = quotedTab(SPARE_PARTS_TAB);

  let rows: string[][];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${qtab}!A:B` });
    rows = res.data.values ?? [];
  } catch (e) {
    throw new ApiError(500, `Could not read the "${SPARE_PARTS_TAB}" sheet: ${(e as Error).message}`);
  }

  return rows
    .slice(1) // header row
    .filter((r) => (r[0] ?? '').trim())
    .map((r) => ({ name: r[0].trim(), price: Number(r[1]) || 0 }));
}
