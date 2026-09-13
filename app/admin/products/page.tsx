'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { toStartCase } from '@/lib/format';

interface Product {
  id: string;
  code: string;
  category: string;
  brand: string;
  name: string;
  master_sku: string | null;
  variant: string | null;
  list_price: number | null;
  active: boolean;
  last_synced_at: string | null;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);

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

  const startEditPrice = (p: Product) => {
    setEditingSku(p.code);
    setEditPrice(p.list_price != null ? String(p.list_price) : '');
    setError('');
  };

  const handleSavePrice = async (sku: string) => {
    if (savingPrice) return;
    setSavingPrice(true);
    setError('');
    const res = await fetch('/api/admin/products', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, listPrice: editPrice === '' ? null : Number(editPrice) }),
    });
    const data = await res.json();
    setSavingPrice(false);
    if (!res.ok) {
      setError(data.error ?? 'Failed to update price');
      return;
    }
    setEditingSku(null);
    load();
  };

  return (
    <AppShell title="Products">
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-1 mt-2">
      </div>
      <p className="text-sm text-ink-2 mb-6">
        The spreadsheet is the source of truth — new products are added there, and pulled in via
        the Developer panel's sync. Editing a price here writes into the sheet directly, so the
        two never drift apart.
      </p>

      {error && (
        <div className="bg-danger-tint border border-danger text-danger p-4 rounded-lg mb-4">
          <p className="font-medium">Failed to save</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      )}

      {loading ? (
        <p>Loading...</p>
      ) : products.length === 0 ? (
        <p className="text-ink">No products yet — ask the developer to sync from the spreadsheet.</p>
      ) : (
        <div className="bg-surface rounded-lg shadow-sm border border-rule overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-inset text-left">
              <tr>
                <th className="p-3">Code (SKU)</th>
                <th className="p-3">Category</th>
                <th className="p-3">Brand</th>
                <th className="p-3">Name</th>
                <th className="p-3">Variant</th>
                <th className="p-3 text-right">List price</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className={`border-t ${!p.active ? 'text-ink' : ''}`}>
                  <td className="p-3 font-mono">{p.code}</td>
                  <td className="p-3">{toStartCase(p.category)}</td>
                  <td className="p-3">{toStartCase(p.brand)}</td>
                  <td className="p-3">{toStartCase(p.name)}</td>
                  <td className="p-3">{p.variant || '—'}</td>
                  <td className="p-3 text-right">
                    {editingSku === p.code ? (
                      <div className="flex items-center justify-end gap-1">
                        <input
                          autoFocus
                          type="number"
                          step="0.01"
                          min="0"
                          className="w-24 border rounded px-2 py-1 text-right text-ink"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSavePrice(p.code);
                            if (e.key === 'Escape') setEditingSku(null);
                          }}
                        />
                        <button
                          onClick={() => handleSavePrice(p.code)}
                          disabled={savingPrice}
                          className="text-xs text-ok hover:underline disabled:opacity-50"
                        >
                          {savingPrice ? '...' : 'Save'}
                        </button>
                        <button onClick={() => setEditingSku(null)} className="text-xs text-ink-2 hover:underline">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => startEditPrice(p)} className="hover:underline">
                        {p.list_price != null ? `₹${p.list_price}` : '— (edit)'}
                      </button>
                    )}
                  </td>
                  <td className="p-3">{p.active ? 'Active' : 'Discontinued'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </AppShell>
  );
}
