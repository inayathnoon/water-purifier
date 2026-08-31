'use client';

import { useEffect, useState } from 'react';

interface Product {
  id: string;
  code: string;
  category: string;
  type: string;
  brand: string;
  name: string;
  list_price: number;
  active: boolean;
  last_synced_at: string | null;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [lastResult, setLastResult] = useState('');

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/admin/products');
    const data = await res.json();
    setProducts(data.products ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setError('');
    setLastResult('');
    const res = await fetch('/api/admin/products/sync-now', { method: 'POST' });
    const data = await res.json();
    setSyncing(false);
    if (!res.ok) {
      // §9.6: fail loudly — this is the loud part.
      setError(data.error ?? 'Sync failed');
      return;
    }
    setLastResult(`Synced ${data.upserted} product(s), deactivated ${data.deactivated}.`);
    load();
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="flex justify-between items-center mb-1">
        <h1 className="text-2xl font-bold">Products</h1>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {syncing ? 'Syncing...' : 'Sync now'}
        </button>
      </div>
      <p className="text-sm text-gray-600 mb-6">
        Copied nightly from the product spreadsheet, or on demand here (§9.2).
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-lg mb-4">
          <p className="font-medium">Sync failed — nothing was written</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      )}
      {lastResult && <p className="text-green-700 bg-green-50 p-3 rounded mb-4">{lastResult}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : products.length === 0 ? (
        <p className="text-gray-600">No products yet — press Sync now to pull from the spreadsheet.</p>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="p-3">Code</th>
                <th className="p-3">Category</th>
                <th className="p-3">Type</th>
                <th className="p-3">Brand</th>
                <th className="p-3">Name</th>
                <th className="p-3 text-right">List price</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className={`border-t ${!p.active ? 'text-gray-600' : ''}`}>
                  <td className="p-3 font-mono">{p.code}</td>
                  <td className="p-3">{p.category}</td>
                  <td className="p-3">{p.type}</td>
                  <td className="p-3">{p.brand}</td>
                  <td className="p-3">{p.name}</td>
                  <td className="p-3 text-right">₹{p.list_price}</td>
                  <td className="p-3">{p.active ? 'Active' : 'Discontinued'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
