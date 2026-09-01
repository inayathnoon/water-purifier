'use client';

import { useEffect, useState, use as usePromise } from 'react';
import { useRouter } from 'next/navigation';

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

const ACTION_LABEL: Record<string, string> = {
  call_back_later: 'Call Back Later',
  pass_to_owner: 'Pass To Owner',
  mark_inactive: 'Mark Inactive',
  convert: 'Convert',
};

// Convert and Mark Inactive are the two outcomes worth a glance from
// across the room — everything else stays neutral.
const ACTION_SELECTED_STYLE: Record<string, string> = {
  call_back_later: 'bg-blue-600 text-white border-blue-600',
  pass_to_owner: 'bg-blue-600 text-white border-blue-600',
  mark_inactive: 'bg-red-600 text-white border-red-600',
  convert: 'bg-green-600 text-white border-green-600',
};

export default function EnquiryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const router = useRouter();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [callNote, setCallNote] = useState('');
  const [action, setAction] = useState<'call_back_later' | 'pass_to_owner' | 'mark_inactive' | ''>('');
  const [explanation, setExplanation] = useState('');
  const [callbackDate, setCallbackDate] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

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
      body: JSON.stringify({ action, explanation, callbackDate }),
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
            <div className="flex gap-2 mb-3 flex-wrap">
              {(['call_back_later', 'pass_to_owner', 'mark_inactive'] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => setAction(a)}
                  className={`px-3 py-1.5 rounded-md text-sm border ${
                    action === a ? ACTION_SELECTED_STYLE[a] : 'bg-white border-gray-300 text-gray-900'
                  }`}
                >
                  {ACTION_LABEL[a]}
                </button>
              ))}
              {/* Convert doesn't reveal an inline form like the others — it goes
                  straight to placing the order (see handleConvertClick above). */}
              <button
                onClick={handleConvertClick}
                className={`px-3 py-1.5 rounded-md text-sm border ${ACTION_SELECTED_STYLE.convert}`}
              >
                {ACTION_LABEL.convert}
              </button>
            </div>

            {action && (
              <form onSubmit={handleClose} className="space-y-3">
                {action === 'call_back_later' && (
                  <input
                    type="date"
                    required
                    className="border rounded px-3 py-2"
                    value={callbackDate}
                    onChange={(e) => setCallbackDate(e.target.value)}
                  />
                )}

                {(action === 'pass_to_owner' || action === 'mark_inactive') && (
                  <div>
                    <textarea
                      required
                      rows={4}
                      placeholder="Written explanation (30+ words)"
                      className="w-full border rounded px-3 py-2"
                      value={explanation}
                      onChange={(e) => setExplanation(e.target.value)}
                    />
                    <p
                      className={`text-xs mt-1 ${wordCount(explanation) < 30 ? 'text-red-600' : 'text-green-600'}`}
                    >
                      {wordCount(explanation)} / 30 words minimum
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
