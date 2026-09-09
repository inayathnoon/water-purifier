/**
 * §13 hard-rule regression tests — one per rule, run against the real
 * Supabase project (see CLAUDE.md's "Stop testing against production"
 * note: a second project was considered and deferred, so this still
 * hits production like every manual verification script this project
 * has ever run — every test creates its own rows and deletes them in
 * a `finally`, including the Sales/Enquiry sheet rows some of these
 * writes trigger, matching that same discipline).
 *
 * Each rule is checked at both layers where one exists: the
 * service-layer guard (a clean, catchable error) and, where a DB
 * trigger/constraint also enforces it, a direct table write proving
 * the database refuses it independently of the application code.
 *
 * Run with: npm test  (loads .env.local, needs real Supabase credentials)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

import { createDirectPurchase, bookJob, completeJob, createEnquiry, closeEnquiry } from '../lib/services/tickets';
import { closeOrder } from '../lib/services/orders';
import { recordSparePartSale } from '../lib/services/sparePartSales';
import { clearMatchingRowByHeader, writeSheetsClient, quotedTab } from '../lib/services/googleSheets';
import { SALES_TAB } from '../lib/services/salesSheet';
import { ENQUIRY_TAB } from '../lib/services/enquirySheet';
import { PAYMENTS_TAB } from '../lib/services/paymentsSheet';
import { SPARE_PART_SALES_TAB } from '../lib/services/sparePartSalesSheet';

// Payments rows are matched on their own generated id (append-only, never
// upserted in place — see CLAUDE.md), so there's no business key to hand
// clearMatchingRowByHeader() the way Sales/Enquiry have; find and delete
// by phone number directly instead.
async function deletePaymentsRowsForPhone(phone: string): Promise<void> {
  const { sheets, sheetId } = writeSheetsClient();
  const qtab = quotedTab(PAYMENTS_TAB);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${qtab}!A:G` });
  const rows = res.data.values ?? [];
  const idxs = rows.map((r, i) => (i > 0 && r[2] === phone ? i : -1)).filter((i) => i >= 0).sort((a, b) => b - a);
  if (idxs.length === 0) return;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const tabSheetId = meta.data.sheets?.find((s) => s.properties?.title === PAYMENTS_TAB)?.properties?.sheetId;
  for (const idx of idxs) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ deleteDimension: { range: { sheetId: tabSheetId, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 } } }] },
    });
  }
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// Spare Part Sales sheet rows are matched on the sale's own id, not a
// business key — clear each one directly rather than via clearMatchingRowByHeader's phone/date matching.
async function deleteSparePartSaleSheetRows(saleIds: string[]): Promise<void> {
  for (const id of saleIds) {
    await clearMatchingRowByHeader(SPARE_PART_SALES_TAB, { id }, ['id']);
  }
}

async function makeCustomer(phone: string) {
  const { data } = await supabase
    .from('customers')
    .insert({ phone_number: phone, name: 'TEST HARD RULES', address: 'TEST', area: 'TEST' })
    .select()
    .single();
  return data;
}

async function realStaffId(): Promise<string> {
  const { data } = await supabase.from('users').select('id').eq('role', 'service_staff').eq('active', true).limit(1).single();
  if (!data) throw new Error('No active service_staff account found to run this test against');
  return data.id;
}

async function realAdminId(): Promise<string> {
  const { data } = await supabase.from('users').select('id').eq('role', 'admin').limit(1).single();
  if (!data) throw new Error('No admin account found to run this test against');
  return data.id;
}

async function cleanupCustomer(customerId: string) {
  const { data: ticketRows } = await supabase.from('tickets').select('id').eq('customer_id', customerId);
  await supabase.from('orders').delete().in('ticket_id', (ticketRows ?? []).map((t) => t.id));
  await supabase.from('tickets').delete().eq('customer_id', customerId);
  await supabase.from('customers').delete().eq('id', customerId);
}

// Any order/ticket a test's own inserts produce comes back typed as
// `unknown` from these service functions' generic return shapes —
// tests know their own real shape, so a narrow local cast is fine here.
interface TestOrder {
  id: string;
  created_at: string;
}

// §13.1 — order cannot close while money is owed.
test('§13.1: order cannot close while money is owed', async () => {
  const cust = await makeCustomer('9990000001');
  try {
    const [purchase] = await createDirectPurchase({
      customerId: cust.id,
      items: [{ productDetails: 'TEST', price: 1000, paidAmount: 400 }],
    });
    const order = purchase.order as TestOrder;

    // Service-layer guard.
    await assert.rejects(() => closeOrder(order.id), /still owed/i);

    // DB trigger, bypassing the service layer entirely.
    const { error } = await supabase.from('orders').update({ status: 'closed' }).eq('id', order.id);
    assert.ok(error, 'expected the DB trigger to refuse closing an order with a balance owed');

    // Sheet syncs run fire-and-forget now (2026-09-08, see CLAUDE.md's
    // speed-fix note) — createDirectPurchase()'s own sync may not have
    // landed yet, so this cleanup has to wait for it rather than racing
    // it, or the row it's meant to clear won't exist yet to be cleared.
    await new Promise((r) => setTimeout(r, 3000));
    await clearMatchingRowByHeader(
      SALES_TAB,
      { phone_number: cust.phone_number, bill_date: order.created_at.slice(0, 10), sold_price: '1000' },
      ['phone_number', 'bill_date', 'sold_price']
    );
    // The ₹400 paid up front also logs a "Purchase" row to the Payments sheet.
    await deletePaymentsRowsForPhone(cust.phone_number);
  } finally {
    await cleanupCustomer(cust.id);
  }
});

// §13.2/§5.4/§5.5 — enquiry closure needs a 5+ word explanation, and
// "pass to owner" needs at least one prior call logged.
test('§13.2: enquiry closure requires a real explanation and a prior call', async () => {
  const cust = await makeCustomer('9990000002');
  const adminId = await realAdminId();
  try {
    const enquiry = (await createEnquiry({ customerId: cust.id, productInterest: 'Kitchen', createdBy: adminId })) as { id: string; created_at: string };

    await assert.rejects(
      () => closeEnquiry(enquiry.id, 'mark_inactive', { explanation: 'too short' }),
      /at least 5 words/i
    );

    await assert.rejects(
      () => closeEnquiry(enquiry.id, 'pass_to_owner', { explanation: 'a perfectly reasonable five word explanation here' }),
      /never been called/i
    );

    // See the §13.1 test above — same fire-and-forget-sync wait.
    await new Promise((r) => setTimeout(r, 3000));
    await clearMatchingRowByHeader(
      ENQUIRY_TAB,
      { phone_number: cust.phone_number, date: enquiry.created_at.slice(0, 10) },
      ['phone_number', 'date']
    );
  } finally {
    await cleanupCustomer(cust.id);
  }
});

// §13.3 — no charge inside the warranty year, regardless of what's
// selected; the charge is preserved once outside it. Since 2026-09-09,
// this enforcement lives in recordSparePartSale() (spare parts sold when
// admin confirms a job, from /admin/spare-parts) rather than completeJob()
// — see CLAUDE.md's staff-portal-removal note.
test('§13.3: warranty override forces an in-warranty sale to zero', async () => {
  const cust = await makeCustomer('9990000003');
  const adminId = await realAdminId();
  try {
    const withinWarranty = new Date();
    withinWarranty.setMonth(withinWarranty.getMonth() - 6); // 6 months ago — still under warranty

    const { data: inWarrantyTicket } = await supabase
      .from('tickets')
      .insert({ customer_id: cust.id, kind: 'service_visit', status: 'completed', installation_date: withinWarranty.toISOString().slice(0, 10) })
      .select()
      .single();

    const [inWarrantySale] = await recordSparePartSale({
      items: [{ partName: 'Solenoid valve', unitPrice: 600, quantity: 1 }], // selected anyway — must be overridden to 0
      soldBy: adminId,
      ticketId: inWarrantyTicket.id,
    });
    assert.equal(Number(inWarrantySale.total), 0, 'a price selected inside warranty must be forced to 0');

    const outsideWarranty = new Date();
    outsideWarranty.setFullYear(outsideWarranty.getFullYear() - 2); // 2 years ago — well outside warranty

    const { data: outsideTicket } = await supabase
      .from('tickets')
      .insert({ customer_id: cust.id, kind: 'service_visit', status: 'completed', installation_date: outsideWarranty.toISOString().slice(0, 10) })
      .select()
      .single();

    const [outsideSale] = await recordSparePartSale({
      items: [{ partName: 'Solenoid valve', unitPrice: 600, quantity: 1 }],
      soldBy: adminId,
      ticketId: outsideTicket.id,
    });
    assert.equal(Number(outsideSale.total), 600, 'a price selected outside warranty must be preserved');

    // Both sales above also sync to the Spare Part Sales sheet and (the
    // out-of-warranty one) the Payments sheet — all fire-and-forget, so
    // cleanup has to wait for them to land first, same as every other
    // sheet-touching test in this file.
    await new Promise((r) => setTimeout(r, 3000));
    await Promise.all([
      supabase.from('spare_part_sales').delete().eq('id', inWarrantySale.id),
      supabase.from('spare_part_sales').delete().eq('id', outsideSale.id),
    ]);
    await deleteSparePartSaleSheetRows([inWarrantySale.id, outsideSale.id]);
    await deletePaymentsRowsForPhone(cust.phone_number);
  } finally {
    await cleanupCustomer(cust.id);
  }
});

// §13.4 — a technician's own completed-job response must never carry
// the sale price, even though it lives on the same underlying ticket row.
test('§13.4: completeJob response never includes a sale price', async () => {
  const cust = await makeCustomer('9990000004');
  const staffId = await realStaffId();
  try {
    const { data: ticket } = await supabase
      .from('tickets')
      .insert({
        customer_id: cust.id,
        kind: 'installation',
        status: 'booked',
        assigned_to_id: staffId,
        agreed_price: 15000, // the sale price this test must never see come back
        booked_date: new Date().toISOString().slice(0, 10),
        booked_half_day: 'morning',
      })
      .select()
      .single();

    const completed = await completeJob(ticket.id, staffId, {
      actualDate: new Date().toISOString().slice(0, 10),
      actualStartTime: '09:00',
      actualEndTime: '11:00',
      notes: 'installed fine',
    });

    assert.equal('agreed_price' in completed, false, 'completeJob() must never return agreed_price to a technician');
    assert.equal('sold_price' in completed, false, 'completeJob() must never return sold_price to a technician');
  } finally {
    await cleanupCustomer(cust.id);
  }
});

// §13.5 — a job can only ever be assigned to an active service_staff account.
test('§13.5: jobs can only be assigned to service staff', async () => {
  const cust = await makeCustomer('9990000005');
  const adminId = await realAdminId();
  try {
    const { data: ticket } = await supabase
      .from('tickets')
      .insert({ customer_id: cust.id, kind: 'service_visit', status: 'open' })
      .select()
      .single();

    // Service-layer guard.
    await assert.rejects(
      () =>
        bookJob(ticket.id, {
          assignedToId: adminId,
          bookedDate: new Date().toISOString().slice(0, 10),
          bookedHalfDay: 'morning',
          location: 'home',
        }),
      /service staff/i
    );

    // DB trigger, bypassing the service layer entirely.
    const { error } = await supabase.from('tickets').update({ assigned_to_id: adminId }).eq('id', ticket.id);
    assert.ok(error, 'expected the DB trigger to refuse assigning a job to a non-service_staff account');
  } finally {
    await cleanupCustomer(cust.id);
  }
});
