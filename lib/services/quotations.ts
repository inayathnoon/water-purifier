import crypto from 'crypto';
import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';
import { todayIST } from '../dates';
import { syncQuotationToSheetSafely } from './quotationSheet';

export interface QuotationItemInput {
  particulars: string;
  details?: string | null;
  qty: number;
  rate: number;
  productCode?: string | null;
}

export interface QuotationInput {
  customerId?: string | null;
  customerName: string;
  phoneNumber: string;
  email?: string | null;
  address: string;
  area: string;
  quoteDate: string;
  notes?: string | null;
  terms?: string | null;
  deliveryDate?: string | null;
  discount?: number;
  items: QuotationItemInput[];
  status?: 'open' | 'won' | 'lost';
}

// ~22-char urlsafe token — the only credential /q/[token] accepts. Never
// the row id, so a customer-facing link can't be turned into an
// enumeration of every quotation just by incrementing a number.
function generatePublicToken(): string {
  return crypto.randomBytes(16).toString('base64url');
}

function computeTotals(items: QuotationItemInput[], discount: number) {
  const subtotal = items.reduce((sum, it) => sum + it.qty * it.rate, 0);
  // Never stored negative — a customer-facing document must never show a
  // negative grand total, so the clamp applies at write time too, not
  // just in the form's own display.
  const total = Math.max(0, subtotal - discount);
  return { subtotal, total };
}

export async function createQuotation(input: QuotationInput, createdBy: string) {
  if (input.items.length === 0) throw new ApiError(400, 'At least one item is required');
  if (input.quoteDate > todayIST()) throw new ApiError(400, 'Quote date cannot be in the future');
  const discount = Math.max(0, input.discount ?? 0);
  const { subtotal, total } = computeTotals(input.items, discount);

  const { data: quotation, error } = await supabaseAdmin
    .from('quotations')
    .insert({
      public_token: generatePublicToken(),
      quote_date: input.quoteDate,
      customer_id: input.customerId ?? null,
      customer_name: input.customerName,
      phone_number: input.phoneNumber,
      email: input.email ?? null,
      address: input.address,
      area: input.area,
      notes: input.notes ?? null,
      terms: input.terms ?? null,
      delivery_date: input.deliveryDate ?? null,
      subtotal,
      discount,
      total,
      status: input.status ?? 'open',
      created_by: createdBy,
    })
    .select('*')
    .single();
  if (error) throw new ApiError(500, error.message);

  const itemRows = input.items.map((it, i) => ({
    quotation_id: quotation.id,
    position: i,
    particulars: it.particulars,
    details: it.details ?? null,
    qty: it.qty,
    rate: it.rate,
    amount: it.qty * it.rate,
    product_code: it.productCode ?? null,
  }));
  const { error: itemsError } = await supabaseAdmin.from('quotation_items').insert(itemRows);
  if (itemsError) throw new ApiError(500, itemsError.message);

  // Fire-and-forget, same fail-safe pattern as every other sheet sync in
  // this app — a Sheets outage must never block or fail a quotation save.
  syncQuotationToSheetSafely(quotation.id).catch(() => {});

  return getQuotation(quotation.id);
}

export async function updateQuotation(id: string, input: QuotationInput) {
  if (input.items.length === 0) throw new ApiError(400, 'At least one item is required');
  if (input.quoteDate > todayIST()) throw new ApiError(400, 'Quote date cannot be in the future');
  const discount = Math.max(0, input.discount ?? 0);
  const { subtotal, total } = computeTotals(input.items, discount);

  const { error } = await supabaseAdmin
    .from('quotations')
    .update({
      quote_date: input.quoteDate,
      customer_id: input.customerId ?? null,
      customer_name: input.customerName,
      phone_number: input.phoneNumber,
      email: input.email ?? null,
      address: input.address,
      area: input.area,
      notes: input.notes ?? null,
      terms: input.terms ?? null,
      delivery_date: input.deliveryDate ?? null,
      subtotal,
      discount,
      total,
      status: input.status ?? undefined,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new ApiError(500, error.message);

  // Replace the item set wholesale — simpler and safer than diffing
  // add/remove/reorder for a form that always submits the full list.
  const { error: deleteError } = await supabaseAdmin.from('quotation_items').delete().eq('quotation_id', id);
  if (deleteError) throw new ApiError(500, deleteError.message);
  const itemRows = input.items.map((it, i) => ({
    quotation_id: id,
    position: i,
    particulars: it.particulars,
    details: it.details ?? null,
    qty: it.qty,
    rate: it.rate,
    amount: it.qty * it.rate,
    product_code: it.productCode ?? null,
  }));
  const { error: itemsError } = await supabaseAdmin.from('quotation_items').insert(itemRows);
  if (itemsError) throw new ApiError(500, itemsError.message);

  syncQuotationToSheetSafely(id).catch(() => {});

  return getQuotation(id);
}

export async function setQuotationStatus(id: string, status: 'open' | 'won' | 'lost') {
  const { data, error } = await supabaseAdmin
    .from('quotations')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new ApiError(500, error.message);
  syncQuotationToSheetSafely(id).catch(() => {});
  return data;
}

async function attachItems<T extends { id: string }>(quotation: T) {
  const { data: items, error } = await supabaseAdmin
    .from('quotation_items')
    .select('*')
    .eq('quotation_id', quotation.id)
    .order('position', { ascending: true });
  if (error) throw new ApiError(500, error.message);
  return { ...quotation, items: items ?? [] };
}

export async function getQuotation(id: string) {
  const { data, error } = await supabaseAdmin.from('quotations').select('*').eq('id', id).single();
  if (error || !data) throw new ApiError(404, 'Quotation not found');
  return attachItems(data);
}

// The only lookup /q/[token] is allowed to use — never falls back to id,
// so the public route can't be probed with a raw uuid.
export async function getQuotationByToken(token: string) {
  const { data, error } = await supabaseAdmin.from('quotations').select('*').eq('public_token', token).single();
  if (error || !data) throw new ApiError(404, 'Quotation not found');
  return attachItems(data);
}

export async function listQuotations() {
  const { data, error } = await supabaseAdmin
    .from('quotations')
    .select('*, quotation_items(particulars)')
    .order('created_at', { ascending: false });
  if (error) throw new ApiError(500, error.message);
  return data;
}

export async function getQuotationDefaults() {
  const { data, error } = await supabaseAdmin.from('quotation_defaults').select('*').eq('id', 1).single();
  if (error) throw new ApiError(500, error.message);
  return data;
}

export async function updateQuotationDefaults(input: Partial<{
  businessName: string;
  address: string;
  phone: string;
  mobile: string;
  email: string;
  notes: string;
  terms: string;
  deliveryDateLabel: string;
  signatoryLine: string;
  quotePrefix: string;
  printMode: 'blank' | 'letterhead';
}>) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.businessName !== undefined) patch.business_name = input.businessName;
  if (input.address !== undefined) patch.address = input.address;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.mobile !== undefined) patch.mobile = input.mobile;
  if (input.email !== undefined) patch.email = input.email;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.terms !== undefined) patch.terms = input.terms;
  if (input.deliveryDateLabel !== undefined) patch.delivery_date_label = input.deliveryDateLabel;
  if (input.signatoryLine !== undefined) patch.signatory_line = input.signatoryLine;
  if (input.quotePrefix !== undefined) patch.quote_prefix = input.quotePrefix;
  if (input.printMode !== undefined) patch.print_mode = input.printMode;

  const { data, error } = await supabaseAdmin.from('quotation_defaults').update(patch).eq('id', 1).select('*').single();
  if (error) throw new ApiError(500, error.message);
  return data;
}
