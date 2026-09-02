'use client';

import { useEffect, useState } from 'react';
import HomeLink from '@/components/HomeLink';

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

const emptyNewProduct = { sku: '', category: '', brand: '', productName: '', variant: '', listPrice: '' };

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [lastResult, setLastResult] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProduct, setNewProduct] = useState(emptyNewProduct);
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);

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

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (adding) return; // a fast double-click must never add the product twice
    if (products.some((p) => p.code.toLowerCase() === newProduct.sku.trim().toLowerCase())) {
      if (!window.confirm(`SKU "${newProduct.sku}" already exists — add it anyway?`)) return;
    }
    setAdding(true);
    setAddError('');
    const res = await fetch('/api/admin/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newProduct),
    });
    const data = await res.json();
    setAdding(false);
    if (!res.ok) {
      setAddError(data.error ?? 'Failed to add product');
      return;
    }
    setNewProduct(emptyNewProduct);
    setShowAddForm(false);
    setLastResult(`Added ${data.added} to the sheet and synced it in.`);
    load();
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <HomeLink />
      <div className="flex flex-wrap justify-between items-center gap-2 mb-1 mt-2">
        <h1 className="text-2xl font-bold">Products</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAddForm((s) => !s)}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
          >
            {showAddForm ? 'Cancel' : '+ Add Product'}
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {syncing ? 'Syncing...' : 'Sync now'}
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-900 mb-6">
        Copied nightly from the product spreadsheet, or on demand here (§9.2). Adding one here
        writes it into the spreadsheet too, so the sheet stays the single source of truth.
      </p>

      {showAddForm && (
        <form onSubmit={handleAddProduct} className="bg-white p-4 rounded-lg shadow mb-6 space-y-3">
          {addError && <p className="text-red-600 text-sm">{addError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <input
              required
              placeholder="SKU (e.g. AQUA-JADE-UV)"
              className="border rounded px-3 py-2 text-gray-900 font-mono text-sm"
              value={newProduct.sku}
              onChange={(e) => setNewProduct({ ...newProduct, sku: e.target.value })}
            />
            <input
              required
              placeholder="Category (e.g. Kitchen)"
              className="border rounded px-3 py-2 text-gray-900"
              value={newProduct.category}
              onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
            />
            <input
              required
              placeholder="Brand"
              className="border rounded px-3 py-2 text-gray-900"
              value={newProduct.brand}
              onChange={(e) => setNewProduct({ ...newProduct, brand: e.target.value })}
            />
            <input
              required
              placeholder="Product name"
              className="border rounded px-3 py-2 text-gray-900"
              value={newProduct.productName}
              onChange={(e) => setNewProduct({ ...newProduct, productName: e.target.value })}
            />
            <input
              placeholder="Variant (optional)"
              className="border rounded px-3 py-2 text-gray-900"
              value={newProduct.variant}
              onChange={(e) => setNewProduct({ ...newProduct, variant: e.target.value })}
            />
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="List price (optional)"
              className="border rounded px-3 py-2 text-gray-900"
              value={newProduct.listPrice}
              onChange={(e) => setNewProduct({ ...newProduct, listPrice: e.target.value })}
            />
          </div>
          <button
            type="submit"
            disabled={adding}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            {adding ? 'Adding...' : 'Add to sheet'}
          </button>
        </form>
      )}

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
        <p className="text-gray-900">No products yet — press Sync now to pull from the spreadsheet.</p>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
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
                <tr key={p.id} className={`border-t ${!p.active ? 'text-gray-900' : ''}`}>
                  <td className="p-3 font-mono">{p.code}</td>
                  <td className="p-3">{p.category}</td>
                  <td className="p-3">{p.brand}</td>
                  <td className="p-3">{p.name}</td>
                  <td className="p-3">{p.variant || '—'}</td>
                  <td className="p-3 text-right">{p.list_price != null ? `₹${p.list_price}` : '—'}</td>
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
