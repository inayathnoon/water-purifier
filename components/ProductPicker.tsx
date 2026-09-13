'use client';

import { useEffect, useMemo, useState } from 'react';

export interface PickableProduct {
  id: string;
  code: string;
  name: string;
  brand: string;
  variant: string | null;
  active: boolean;
  list_price: number | null;
}

/**
 * Brand → Product name → Variant, in that order — the products sheet
 * groups variants of the same product (e.g. "Krystal TRP" RO+UV vs
 * RO+UV+AL) under one name/brand, so picking a product means narrowing
 * down through all three rather than a single flat list.
 *
 * Optional: the field this feeds (enquiry interest, purchase details) has
 * never required a product to be picked, so this can be left blank.
 */
export default function ProductPicker({
  onChange,
  required = false,
}: {
  onChange: (value: { display: string; code: string; listPrice: number | null } | null) => void;
  required?: boolean;
}) {
  const [products, setProducts] = useState<PickableProduct[]>([]);
  const [brand, setBrand] = useState('');
  const [name, setName] = useState('');
  const [variantCode, setVariantCode] = useState('');

  useEffect(() => {
    fetch('/api/admin/products')
      .then((res) => res.json())
      .then((data) => setProducts((data.products ?? []).filter((p: PickableProduct) => p.active)));
  }, []);

  const brands = useMemo(() => [...new Set(products.map((p) => p.brand))].sort(), [products]);

  const names = useMemo(
    () => [...new Set(products.filter((p) => p.brand === brand).map((p) => p.name))].sort(),
    [products, brand]
  );

  const variants = useMemo(
    () => products.filter((p) => p.brand === brand && p.name === name),
    [products, brand, name]
  );

  // A product with only one variant (or no variant tracked at all) doesn't
  // need a third dropdown just to click through — auto-select it.
  useEffect(() => {
    if (variants.length === 1) {
      const only = variants[0];
      setVariantCode(only.code);
      onChange({
        display: only.variant ? `${brand} ${name} — ${only.variant}` : `${brand} ${name}`,
        code: only.code,
        listPrice: only.list_price,
      });
    } else {
      setVariantCode('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variants]);

  return (
    <div className="grid grid-cols-3 gap-2">
      <select
        required={required}
        className="border rounded px-3 py-2 text-ink"
        value={brand}
        onChange={(e) => {
          setBrand(e.target.value);
          setName('');
          onChange(null);
        }}
      >
        <option value="">Brand</option>
        {brands.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>

      <select
        required={required}
        disabled={!brand}
        className="border rounded px-3 py-2 text-ink disabled:bg-inset"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          onChange(null);
        }}
      >
        <option value="">Product name</option>
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>

      <select
        required={required}
        disabled={!name || variants.length <= 1}
        className="border rounded px-3 py-2 text-ink disabled:bg-inset"
        value={variantCode}
        onChange={(e) => {
          const chosen = variants.find((v) => v.code === e.target.value);
          setVariantCode(e.target.value);
          if (chosen) {
            onChange({
              display: chosen.variant ? `${brand} ${name} — ${chosen.variant}` : `${brand} ${name}`,
              code: chosen.code,
              listPrice: chosen.list_price,
            });
          }
        }}
      >
        <option value="">{variants.length <= 1 ? '—' : 'Variant'}</option>
        {variants.map((v) => (
          <option key={v.code} value={v.code}>
            {v.variant || '—'}
          </option>
        ))}
      </select>
    </div>
  );
}
