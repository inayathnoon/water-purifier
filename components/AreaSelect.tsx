'use client';

import { useEffect, useState } from 'react';

// Suggestions now come from the "Areas" sheet (§ moved off a hardcoded
// list, 2026-09-07) — the business can add a place it actually
// encounters without a code change, synced via the Developer panel.
//
// This is a free-text input with these as <datalist> suggestions, not a
// rigid <select> — real historical customer data (imported from the
// business's own CSVs) uses area names that don't always match this
// curated list at all (different spelling, or a place not on it), and a
// <select> silently can't display a value that isn't one of its own
// options. A known customer's actual stored area — whatever it is —
// always shows correctly this way; the list just offers convenient
// autocomplete for a new one. An empty/still-loading suggestion list is
// harmless for the same reason — the input works fine either way.
export default function AreaSelect({
  value,
  onChange,
  required = false,
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/areas')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setSuggestions(data.areas ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <input
        required={required}
        list="area-suggestions"
        placeholder="Type or pick an area"
        className="w-full border rounded px-3 py-2 text-ink"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id="area-suggestions">
        {suggestions.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </>
  );
}
