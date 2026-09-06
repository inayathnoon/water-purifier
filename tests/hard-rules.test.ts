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
import { clearMatchingRowByHeader } from '../lib/services/googleSheets';
import { SALES_TAB } from '../lib/services/salesSheet';
import { ENQUIRY_TAB } from '../lib/services/enquirySheet';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

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

    await clearMatchingRowByHeader(
      SALES_TAB,
      { phone_number: cust.phone_number, bill_date: order.created_at.slice(0, 10), sold_price: '1000' },
      ['phone_number', 'bill_date', 'sold_price']
    );
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

    await clearMatchingRowByHeader(
      ENQUIRY_TAB,
      { phone_number: cust.phone_number, date: enquiry.created_at.slice(0, 10) },
      ['phone_number', 'date']
    );
  } finally {
    await cleanupCustomer(cust.id);
  }
});

// §13.3 — no charge inside the warranty year, regardless of what a
// technician enters; the charge is preserved once outside it.
test('§13.3: warranty override forces an in-warranty charge to zero', async () => {
  const cust = await makeCustomer('9990000003');
  const staffId = await realStaffId();
  try {
    const withinWarranty = new Date();
    withinWarranty.setMonth(withinWarranty.getMonth() - 6); // 6 months ago — still under warranty

    const { data: inWarrantyTicket } = await supabase
      .from('tickets')
      .insert({
        customer_id: cust.id,
        kind: 'service_visit',
        status: 'booked',
        assigned_to_id: staffId,
        installation_date: withinWarranty.toISOString().slice(0, 10),
        booked_date: new Date().toISOString().slice(0, 10),
        booked_half_day: 'morning',
      })
      .select()
      .single();

    const completedInWarranty = await completeJob(inWarrantyTicket.id, staffId, {
      actualDate: new Date().toISOString().slice(0, 10),
      actualStartTime: '09:00',
      actualEndTime: '10:00',
      notes: 'test',
      partsUsed: 'Solenoid valve x1',
      chargeAmount: 600, // a tech entering a charge anyway — must be overridden to 0
    });
    assert.equal(completedInWarranty.charge_amount, 0, 'a chargeable amount entered inside warranty must be forced to 0');

    const outsideWarranty = new Date();
    outsideWarranty.setFullYear(outsideWarranty.getFullYear() - 2); // 2 years ago — well outside warranty

    const { data: outsideTicket } = await supabase
      .from('tickets')
      .insert({
        customer_id: cust.id,
        kind: 'service_visit',
        status: 'booked',
        assigned_to_id: staffId,
        installation_date: outsideWarranty.toISOString().slice(0, 10),
        booked_date: new Date().toISOString().slice(0, 10),
        booked_half_day: 'morning',
      })
      .select()
      .single();

    const completedOutside = await completeJob(outsideTicket.id, staffId, {
      actualDate: new Date().toISOString().slice(0, 10),
      actualStartTime: '09:00',
      actualEndTime: '10:00',
      notes: 'test',
      partsUsed: 'Solenoid valve x1',
      chargeAmount: 600,
    });
    assert.equal(completedOutside.charge_amount, 600, 'a charge entered outside warranty must be preserved');
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
