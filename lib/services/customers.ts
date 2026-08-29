import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';

/**
 * §4.1/§4.2: a customer is identified only by phone number. Typing a
 * number that already exists attaches the new ticket to that customer;
 * an unknown number creates one on the spot. Nobody should ever type or
 * remember a customer code.
 *
 * Name/address/area are stored uppercase by a DB trigger (§4.4), not here —
 * so it holds no matter what other code path writes to this table later.
 */
export async function findOrCreateCustomer(input: {
  phoneNumber: string;
  name: string;
  address: string;
  area: string;
}) {
  const phoneNumber = input.phoneNumber.trim();
  if (!phoneNumber) {
    throw new ApiError(400, 'Phone number is required');
  }

  const { data: existing, error: findError } = await supabaseAdmin
    .from('customers')
    .select('*')
    .eq('phone_number', phoneNumber)
    .maybeSingle();

  if (findError) throw new ApiError(500, findError.message);
  if (existing) return existing;

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
