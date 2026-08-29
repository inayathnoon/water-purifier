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

export default function EnquiryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const router = useRouter();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [callNote, setCallNote] = useState('');
  const [action, setAction] = useState<'call_back_later' | 'pass_to_owner' | 'mark_inactive' | 'convert' | ''>('');
  const [explanation, setExplanation] = useState('');
  const [callbackDate, setCallbackDate] = useState('');
  const [agreedPrice, setAgreedPrice] = useState('');
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
      body: JSON.stringify({
        action,
        explanation,
        callbackDate,
        agreedPrice: agreedPrice ? Number(agreedPrice) : undefined,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error);
      return;
    }
    const data = await res.json();
    if (action === 'convert') {
      router.push('/admin/installations');
    } else {
      router.push('/admin/enquiries');
    }
  };

  if (loading || !ticket) return <p className="p-8">Loading...</p>;

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{ticket.customers.name}</h1>
        <p className="text-gray-600">
          {ticket.customers.phone_number} · {ticket.customers.address}, {ticket.customers.area}
        </p>
        <p className="text-sm text-gray-500 mt-1">Interested in: {ticket.enquiry_product_interest || '—'}</p>
        <p className="text-sm text-gray-500">Status: {ticket.status} · {ticket.call_count} call(s) made</p>
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
              {(['call_back_later', 'pass_to_owner', 'mark_inactive', 'convert'] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => setAction(a)}
                  className={`px-3 py-1.5 rounded-md text-sm border ${
                    action === a ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300'
                  }`}
                >
                  {a.replace(/_/g, ' ')}
                </button>
              ))}
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

                {action === 'convert' && (
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="Agreed price"
                    className="border rounded px-3 py-2"
                    value={agreedPrice}
                    onChange={(e) => setAgreedPrice(e.target.value)}
                  />
                )}

                <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                  Confirm: {action.replace(/_/g, ' ')}
                </button>
              </form>
            )}
          </div>
        </>
      )}

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="font-semibold mb-2">Call history</h2>
        {calls.length === 0 ? (
          <p className="text-sm text-gray-500">No calls logged yet.</p>
        ) : (
          <ul className="space-y-2">
            {calls.map((c) => (
              <li key={c.id} className="text-sm border-b pb-2">
                <p>{c.note}</p>
                <p className="text-gray-400 text-xs">{new Date(c.created_at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
