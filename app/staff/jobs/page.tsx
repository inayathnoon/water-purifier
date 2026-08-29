'use client';

import { useEffect, useState } from 'react';

interface Job {
  id: string;
  kind: string;
  status: string;
  booked_date: string;
  booked_half_day: string;
  location: string;
  customers: { name: string; address: string; area: string; phone_number: string };
}

export default function StaffJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [form, setForm] = useState({ actualDate: '', actualStartTime: '', actualEndTime: '', notes: '' });
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/staff/jobs');
    const data = await res.json();
    setJobs(data.jobs ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleComplete = async (jobId: string) => {
    setError('');
    const res = await fetch(`/api/staff/jobs/${jobId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      setError((await res.json()).error);
      return;
    }
    setCompletingId(null);
    setForm({ actualDate: '', actualStartTime: '', actualEndTime: '', notes: '' });
    load();
  };

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold mb-6">My Jobs</h1>
      {error && <p className="text-red-600 bg-red-50 p-3 rounded mb-4">{error}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : jobs.length === 0 ? (
        <p className="text-gray-500">No jobs assigned.</p>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => (
            <div key={job.id} className="bg-white rounded-lg shadow p-4">
              <p className="font-semibold text-lg">{job.customers.name}</p>
              <p className="text-gray-600">{job.customers.address}, {job.customers.area}</p>
              <p className="text-gray-600">{job.customers.phone_number}</p>
              <p className="text-sm mt-2">
                {job.booked_date} ({job.booked_half_day}) · {job.location} · <span className="capitalize">{job.status}</span>
              </p>

              {job.status === 'booked' && (
                <>
                  {completingId !== job.id ? (
                    <button
                      onClick={() => setCompletingId(job.id)}
                      className="mt-3 w-full py-3 bg-green-600 text-white rounded-md font-medium hover:bg-green-700"
                    >
                      Mark Done
                    </button>
                  ) : (
                    <div className="mt-3 pt-3 border-t space-y-2">
                      <input
                        type="date"
                        required
                        className="w-full border rounded px-3 py-2"
                        value={form.actualDate}
                        onChange={(e) => setForm({ ...form, actualDate: e.target.value })}
                      />
                      <div className="flex gap-2">
                        <input
                          type="time"
                          required
                          className="flex-1 border rounded px-3 py-2"
                          value={form.actualStartTime}
                          onChange={(e) => setForm({ ...form, actualStartTime: e.target.value })}
                        />
                        <input
                          type="time"
                          required
                          className="flex-1 border rounded px-3 py-2"
                          value={form.actualEndTime}
                          onChange={(e) => setForm({ ...form, actualEndTime: e.target.value })}
                        />
                      </div>
                      <textarea
                        placeholder="What did you do?"
                        className="w-full border rounded px-3 py-2"
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      />
                      <button
                        onClick={() => handleComplete(job.id)}
                        className="w-full py-3 bg-green-600 text-white rounded-md font-medium hover:bg-green-700"
                      >
                        Submit
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
