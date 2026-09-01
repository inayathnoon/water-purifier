import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';

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

export async function getCustomerWithHistory(customerId: string) {
  const { data: customer, error: customerError } = await supabaseAdmin
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .single();

  if (customerError) throw new ApiError(404, 'Customer not found');

  // §4.3: full ticket history visible on one page
  const { data: tickets, error: ticketsError } = await supabaseAdmin
    .from('tickets')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });

  if (ticketsError) throw new ApiError(500, ticketsError.message);

  return { customer, tickets: tickets ?? [] };
}
