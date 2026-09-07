import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';
import { renamePhoneNumberInSheet } from './googleSheets';
import { logNotification } from './notifications';
import { SALES_TAB } from './salesSheet';
import { SERVICE_TAB } from './serviceSheet';
import { ENQUIRY_TAB } from './enquirySheet';

/**
 * §4.1/§4.2 (revised): phone number is still how staff look a customer
 * up, but one number can now have more than one address on file (a
 * customer who moved, or two households sharing a number) — so it's no
 * longer a guarantee of exactly one customer record.
 *
 * - `customerId` set: the admin already picked a specific address from
 *   the lookup UI — just use that record directly.
 * - `forceNewAddress` true: the admin explicitly chose "add a new
 *   address" for a number that already has one (or more) on file.
 * - Neither set: the common case — reuse the one existing match if
 *   there's exactly one, same as before multiple addresses existed.
 *   Zero matches, or an unexpected multiple-match tie with nothing to
 *   disambiguate on, both fall through to creating a new record rather
 *   than guessing which existing one was meant.
 *
 * Name/address/area are stored uppercase by a DB trigger (§4.4), not here —
 * so it holds no matter what other code path writes to this table later.
 */
export async function findOrCreateCustomer(input: {
  phoneNumber: string;
  name: string;
  address: string;
  area: string;
  customerId?: string;
  forceNewAddress?: boolean;
}) {
  if (input.customerId) {
    const { data, error } = await supabaseAdmin.from('customers').select('*').eq('id', input.customerId).single();
    if (error || !data) throw new ApiError(404, 'Selected customer not found');
    return data;
  }

  const phoneNumber = input.phoneNumber.trim();
  if (!phoneNumber) {
    throw new ApiError(400, 'Phone number is required');
  }

  if (!input.forceNewAddress) {
    const { data: matches, error: findError } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('phone_number', phoneNumber);

    if (findError) throw new ApiError(500, findError.message);
    if (matches && matches.length === 1) return matches[0];
  }

  const { data: created, error: createError } = await supabaseAdmin
    .from('customers')
    .insert({
      phone_number: phoneNumber,
      name: input.name,
      address: input.address,
      area: input.area,
    })
    .select('*')
    .single();

  if (createError) throw new ApiError(500, createError.message);
  return created;
}

/** Every address on file for a phone number — backs the "which address?" picker. */
export async function findCustomersByPhone(phoneNumber: string) {
  const { data, error } = await supabaseAdmin
    .from('customers')
    .select('id, phone_number, name, address, area')
    .eq('phone_number', phoneNumber.trim());

  if (error) throw new ApiError(500, error.message);
  return data ?? [];
}

/**
 * Corrects a customer's own record — a typo'd phone number (the primary
 * lookup key everywhere, §4.1) chief among them. Phone number no longer
 * has to be unique (§4.1 revised, migration 007), so this never conflicts
 * with another customer record the way a naive uniqueness check might
 * suggest.
 *
 * If the phone number itself changes, this also re-keys that customer's
 * existing Sales/Service/Enquiry sheet rows in place (§9's one-way sync
 * uses phone_number as its match key) — done here, in the same operation,
 * specifically because doing it by a direct database write instead once
 * broke the Service sheet sync for a real customer: the corrected row
 * couldn't find its original under the new number and inserted a
 * duplicate next to it.
 */
export async function updateCustomer(
  customerId: string,
  updates: { phoneNumber?: string; name?: string; address?: string; area?: string }
) {
  const { data: existing, error: findError } = await supabaseAdmin
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .single();
  if (findError || !existing) throw new ApiError(404, 'Customer not found');

  const patch: Record<string, string> = {};
  if (updates.phoneNumber !== undefined) {
    const phoneNumber = updates.phoneNumber.trim();
    if (!phoneNumber) throw new ApiError(400, 'Phone number is required');
    if (phoneNumber !== existing.phone_number) patch.phone_number = phoneNumber;
  }
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.address !== undefined) patch.address = updates.address;
  if (updates.area !== undefined) patch.area = updates.area;

  if (Object.keys(patch).length === 0) return existing;

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('customers')
    .update(patch)
    .eq('id', customerId)
    .select('*')
    .single();
  if (updateError) throw new ApiError(500, updateError.message);

  if (patch.phone_number) {
    await rekeyCustomerPhoneInSheetsSafely(existing.phone_number, patch.phone_number);
  }

  return updated;
}

/**
 * Renames this customer's existing sheet rows from the old phone number
 * to the new one, across every one-way sheet that's keyed on it. Skips
 * the rename (loudly, not silently) if another customer record still
 * holds the old number — a blind rename in that case would wrongly move
 * a different customer's rows too, since the sheets have no customer id
 * to disambiguate on, only the phone number itself.
 */
async function rekeyCustomerPhoneInSheetsSafely(oldPhone: string, newPhone: string) {
  try {
    const { data: stillOnOldNumber, error } = await supabaseAdmin
      .from('customers')
      .select('id')
      .eq('phone_number', oldPhone);
    if (error) throw error;
    if ((stillOnOldNumber?.length ?? 0) > 0) {
      await logNotification(
        'customer_phone_rekey_failed',
        'failed',
        `Skipped: ${oldPhone} → ${newPhone} — another customer record still uses ${oldPhone}, so sheet rows were left as-is to avoid moving their data too. Rename manually in the sheet if needed.`
      );
      return;
    }

    // §9.6/§10.5: silent on success, same as every other sheet sync — a
    // failure is what needs to stay visible, not the routine case.
    await Promise.all([
      renamePhoneNumberInSheet(SALES_TAB, oldPhone, newPhone),
      renamePhoneNumberInSheet(SERVICE_TAB, oldPhone, newPhone),
      renamePhoneNumberInSheet(ENQUIRY_TAB, oldPhone, newPhone),
    ]);
  } catch (e) {
    // §9.6/§10.5: never blocks the customer edit that triggered this —
    // the DB is already correct either way, this just keeps the sheets
    // in step, and a failure here must stay visible, not swallowed.
    await logNotification('customer_phone_rekey_failed', 'failed', (e as Error).message);
  }
}

export async function getCustomerWithHistory(customerId: string) {
  const { data: customer, error: customerError } = await supabaseAdmin
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .single();

  if (customerError) throw new ApiError(404, 'Customer not found');

  // §4.3: full ticket history visible on one page — orders joined in too
  // (payment_history column included for free), so "what they bought"
  // and "when did each payment come in" both show without a second trip.
  // call_log embedded too (§7.3's payment-call notes), newest first — so
  // a payment-call history shows here without yet another round trip.
  const { data: tickets, error: ticketsError } = await supabaseAdmin
    .from('tickets')
    .select('*, orders(*), call_log(id, note, created_at)')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .order('created_at', { ascending: false, referencedTable: 'call_log' });

  if (ticketsError) throw new ApiError(500, ticketsError.message);

  return { customer, tickets: tickets ?? [] };
}

/**
 * Warns the admin before they create a second enquiry/purchase for a
 * number that already has one in flight — an already-open enquiry, or a
 * purchase recorded in the last 7 days. Covers every customer record
 * sharing this phone number, not just one address.
 */
export async function getDuplicateWarnings(phoneNumber: string) {
  const phone = phoneNumber.trim();
  if (!phone) return { openEnquiries: [], recentPurchases: [] };

  const matches = await findCustomersByPhone(phone);
  if (matches.length === 0) return { openEnquiries: [], recentPurchases: [] };
  const customerIds = matches.map((c) => c.id);

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [{ data: openEnquiries, error: enquiryError }, { data: recentPurchases, error: purchaseError }] =
    await Promise.all([
      supabaseAdmin
        .from('tickets')
        .select('id, created_at, enquiry_product_interest')
        .in('customer_id', customerIds)
        .eq('kind', 'enquiry')
        .eq('status', 'open'),
      supabaseAdmin
        .from('tickets')
        .select('id, created_at, agreed_price, enquiry_product_interest')
        .in('customer_id', customerIds)
        .eq('kind', 'installation')
        .gte('created_at', sevenDaysAgo),
    ]);

  if (enquiryError) throw new ApiError(500, enquiryError.message);
  if (purchaseError) throw new ApiError(500, purchaseError.message);

  return { openEnquiries: openEnquiries ?? [], recentPurchases: recentPurchases ?? [] };
}

/**
 * Backs the admin customer directory search — phone number or name,
 * either partial. A phone number can now have more than one address on
 * file (§4.1 revised), so this returns every matching customer record,
 * not just one.
 */
export async function searchCustomers(query: string) {
  const q = query.trim();
  if (!q) return [];

  const { data, error } = await supabaseAdmin
    .from('customers')
    .select('*')
    .or(`phone_number.ilike.%${q}%,name.ilike.%${q}%`)
    .order('name')
    .limit(30);

  if (error) throw new ApiError(500, error.message);
  return data ?? [];
}
