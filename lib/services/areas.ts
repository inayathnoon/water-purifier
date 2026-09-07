import { readSheetsClient, quotedTab } from './googleSheets';
import { ApiError } from '../api-auth';

// A plain flat list — one area name per row — backing every AreaSelect
// autocomplete in the app (New Purchase/Enquiry/Service, the Customer
// Directory's edit form). Previously hardcoded in AreaSelect.tsx itself
// (curated from Wikipedia's "Political divisions of Kannur district");
// moved here so the business can add a place it actually encounters
// (a "Pandakkal") without needing a code change, same reasoning as the
// Product List and Spare Parts sheets. Barely ever changes, so this is
// cached the same way those are — long TTL as a safety net, the real
// refresh path is the Developer panel's "Sync areas" button.
const AREAS_TAB = process.env.GOOGLE_AREAS_SHEET_TAB || 'Areas';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let cache: { areas: string[]; fetchedAt: number } | null = null;

async function fetchAreas(): Promise<string[]> {
  const { sheets, sheetId } = readSheetsClient();
  const qtab = quotedTab(AREAS_TAB);

  let rows: string[][];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${qtab}!A:A` });
    rows = res.data.values ?? [];
  } catch (e) {
    throw new ApiError(500, `Could not read the "${AREAS_TAB}" sheet: ${(e as Error).message}`);
  }

  return rows
    .slice(1) // header row
    .map((r) => (r[0] ?? '').trim())
    .filter(Boolean);
}

export async function getAreas(): Promise<string[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.areas;
  }
  const areas = await fetchAreas();
  cache = { areas, fetchedAt: Date.now() };
  return areas;
}

/** Developer panel's "Sync areas" — forces a fresh read regardless of
 * how old the cache is, the moment someone's actually edited the sheet. */
export async function syncAreas(): Promise<string[]> {
  const areas = await fetchAreas();
  cache = { areas, fetchedAt: Date.now() };
  return areas;
}
