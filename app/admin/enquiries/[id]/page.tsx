'use client';

import { useEffect, useState, use as usePromise } from 'react';
import { useRouter } from 'next/navigation';
import HomeLink from '@/components/HomeLink';

interface Call {
  id: string;
  note: string;
  created_at: string;
}

interface Ticket {
  id: string;
  status: string;
  call_count: number;
  enquiry_product_interest: string;
  customers: { name: string; phone_number: string; address: string; area: string };
}

interface RecentPurchase {
  id: string;
  status: string;
  agreed_price: number;
  created_at: string;
  customers: { name: string; phone_number: string };
}

const ACTION_LABEL: Record<string, string> = {
  pass_to_owner: 'Pass To Owner',
  mark_inactive: 'Mark Inactive',
  convert: 'Convert',
};

// Every outcome gets its own color, always visible, not just once
// clicked: yellow for "still open, decide later" (pass to owner), red
// for the lost sale, green for a sale (convert / link to an existing
// purchase).
const ACTION_STYLE: Record<string, string> = {
  pass_to_owner: 'bg-yellow-500 text-white border-yellow-500',
  mark_inactive: 'bg-red-600 text-white border-red-600',
  convert: 'bg-green-600 text-white border-green-600',
  link_existing: 'bg-green-600 text-white border-green-600',
};

export default function EnquiryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const router = useRouter();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [callNote, setCallNote] = useState('');
  const [action, setAction] = useState<'pass_to_owner' | 'mark_inactive' | ''>('');
  const [explanation, setExplanation] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const [recentPurchases, setRecentPurchases] = useState<RecentPurchase[]>([]);
  const [linking, setLinking] = useState(false);

  const load = async () => {
    const res = await fetch(`/api/admin/enquiries/${id}`);
    const data = await res.json();
    setTicket(data.ticket);
    setCalls(data.calls ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [id]);

  const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

  const handleLogCall = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const res = await fetch(`/api/admin/enquiries/${id}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: callNote }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error);
      return;
    }
    setCallNote('');
    load();
  };

  const handleClose = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const res = await fetch(`/api/admin/enquiries/${id}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, explanation }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error);
      return;
    }
    router.push('/admin/enquiries');
  };

  // Convert doesn't close anything here — it takes the admin straight to
  // placing the order, pre-filled with this customer. The enquiry stays
  // open and visible in the list until that purchase actually goes
  // through (see fromEnquiry handling in the Installations page); only
  // then does it move out of Enquiries for real.
  const handleConvertClick = () => {
    if (!ticket) return;
    const params = new URLSearchParams({
      new: '1',
      fromEnquiry: id,
      phoneNumber: ticket.customers.phone_number,
      name: ticket.customers.name,
      address: ticket.customers.address,
      area: ticket.customers.area,
    });
    router.push(`/admin/installations?${params.toString()}`);
  };

  const handleToggleLinkPicker = async () => {
    const opening = !showLinkPicker;
    setShowLinkPicker(opening);
    if (opening && recentPurchases.length === 0) {
      const res = await fetch('/api/admin/installations/recent');
      const data = await res.json();
      setRecentPurchases(data.installations ?? []);
    }
  };

  const handleLinkToPurchase = async (purchase: RecentPurchase) => {
    if (!ticket) return;
    const phoneMatches = purchase.customers.phone_number === ticket.customers.phone_number;
    const nameMatches = purchase.customers.name.trim().toLowerCase() === ticket.customers.name.trim().toLowerCase();
    if (!phoneMatches || !nameMatches) {
      const mismatch = !phoneMatches ? 'phone number' : 'name';
      const ok = window.confirm(
        `Heads up — the ${mismatch} doesn't match.\n\nThis enquiry: ${ticket.customers.name}, ${ticket.customers.phone_number}\nSelected purchase: ${purchase.customers.name}, ${purchase.customers.phone_number}\n\nLink anyway?`
      );
      if (!ok) return;
    }

    setLinking(true);
    setError('');
    const res = await fetch(`/api/admin/enquiries/${id}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'convert',
        linkedPurchaseNote: `Linked to existing purchase for ${purchase.customers.name} (${purchase.customers.phone_number})`,
      }),
    });
    setLinking(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? 'Failed to link');
      return;
    }
    router.push('/admin/enquiries');
  };

  const handleDelete = async () => {
    if (
      !window.confirm(
        `Delete the enquiry for ${ticket?.customers.name}? This removes it and its call history permanently — it cannot be undone.`
      )
    ) {
      return;
    }
    setError('');
    const res = await fetch(`/api/admin/enquiries/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? 'Failed to delete enquiry');
      return;
    }
    router.push('/admin/enquiries');
  };

  if (loading || !ticket) return <p className="p-8">Loading...</p>;

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <HomeLink />
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">{ticket.customers.name}</h1>
          <p className="text-gray-900">
            {ticket.customers.phone_number} · {ticket.customers.address}, {ticket.customers.area}
          </p>
          <p className="text-sm text-gray-900 mt-1">Interested in: {ticket.enquiry_product_interest || '—'}</p>
          <p className="text-sm text-gray-900">Status: {ticket.status} · {ticket.call_count} call(s) made</p>
        </div>
        <button
          onClick={handleDelete}
          className="px-3 py-1.5 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100"
        >
          Delete enquiry
        </button>
      </div>

      {error && <p className="text-red-600 bg-red-50 p-3 rounded">{error}</p>}

      {ticket.status === 'open' && (
        <>
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="font-semibold mb-2">Log a call</h2>
            <form onSubmit={handleLogCall} className="flex gap-2">
              <input
                required
                placeholder="What was said?"
                className="flex-1 border rounded px-3 py-2"
                value={callNote}
                onChange={(e) => setCallNote(e.target.value)}
              />
              <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Log</button>
            </form>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="font-semibold mb-3">Close this enquiry</h2>

            {/* Mark Inactive and Convert are the two outcomes that actually
                happen most of the time — large and always visible. Call
                Back Later / Pass To Owner are for a still-undecided
                enquiry, tucked under "Other" so they don't compete for
                attention with the two real outcomes. */}
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setAction('mark_inactive')}
                className={`flex-1 py-3 rounded-md text-base font-semibold border ${ACTION_STYLE.mark_inactive} ${
                  action === 'mark_inactive' ? 'ring-2 ring-offset-1 ring-gray-900' : ''
                }`}
              >
                Mark Inactive
              </button>
              {/* Convert doesn't reveal an inline form like the others — it goes
                  straight to placing the order (see handleConvertClick above). */}
              <button
                onClick={handleConvertClick}
                className={`flex-1 py-3 rounded-md text-base font-semibold border ${ACTION_STYLE.convert}`}
              >
                Convert
              </button>
            </div>
            <button
              onClick={handleToggleLinkPicker}
              className="text-xs text-green-700 hover:underline mb-3"
            >
              {showLinkPicker ? 'Hide' : 'This turned out to already be a purchase — link to it instead'}
            </button>

            <div className="border-t pt-3">
              <button
                onClick={() => setShowOther((s) => !s)}
                className="text-sm text-gray-900 hover:underline flex items-center gap-1"
              >
                Other {showOther ? '▾' : '▸'}
              </button>
              {showOther && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  {(['pass_to_owner'] as const).map((a) => (
                    <button
                      key={a}
                      onClick={() => setAction(a)}
                      className={`px-3 py-1.5 rounded-md text-sm border ${ACTION_STYLE[a]} ${
                        action === a ? 'ring-2 ring-offset-1 ring-gray-900' : ''
                      }`}
                    >
                      {ACTION_LABEL[a]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {showLinkPicker && (
              <div className="border rounded-md">
                <p className="text-xs text-gray-600 p-2 border-b bg-gray-50">
                  This turned out to already be a purchase recorded separately — pick it below instead of creating a new one.
                </p>
                <div className="max-h-72 overflow-y-auto divide-y">
                  {recentPurchases.length === 0 ? (
                    <p className="text-sm text-gray-600 p-3">No recent purchases yet.</p>
                  ) : (
                    recentPurchases.map((p) => (
                      <button
                        key={p.id}
                        disabled={linking}
                        onClick={() => handleLinkToPurchase(p)}
                        className="w-full text-left p-3 hover:bg-gray-50 flex justify-between items-center disabled:opacity-50"
                      >
                        <div>
                          <p className="font-medium text-sm">{p.customers.name}</p>
                          <p className="text-xs text-gray-600">{p.customers.phone_number} · ₹{p.agreed_price}</p>
                        </div>
                        <p className="text-xs text-gray-600">{new Date(p.created_at).toLocaleDateString()}</p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {action && (
              <form onSubmit={handleClose} className="space-y-3">
                {(action === 'pass_to_owner' || action === 'mark_inactive') && (
                  <div>
                    <textarea
                      required
                      rows={4}
                      placeholder="Written explanation (5+ words)"
                      className="w-full border rounded px-3 py-2"
                      value={explanation}
                      onChange={(e) => setExplanation(e.target.value)}
                    />
                    <p
                      className={`text-xs mt-1 ${wordCount(explanation) < 5 ? 'text-red-600' : 'text-green-600'}`}
                    >
                      {wordCount(explanation)} / 5 words minimum
                    </p>
                    {action === 'pass_to_owner' && ticket.call_count < 1 && (
                      <p className="text-xs text-red-600 mt-1">
                        This enquiry has never been called — try calling first.
                      </p>
                    )}
                  </div>
                )}

                <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                  Confirm: {ACTION_LABEL[action]}
                </button>
              </form>
            )}
          </div>
        </>
      )}

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="font-semibold mb-2">Call history</h2>
        {calls.length === 0 ? (
          <p className="text-sm text-gray-900">No calls logged yet.</p>
        ) : (
          <ul className="space-y-2">
            {calls.map((c) => (
              <li key={c.id} className="text-sm border-b pb-2">
                <p>{c.note}</p>
                <p className="text-gray-900 text-xs">{new Date(c.created_at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
