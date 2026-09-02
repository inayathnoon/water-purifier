'use client';

import { useEffect, useState } from 'react';
import AreaSelect from './AreaSelect';
import { daysAgoIST } from '@/lib/dates';

export interface CustomerFieldsValue {
  phoneNumber: string;
  name: string;
  address: string;
  area: string;
  customerId: string | null;
  forceNewAddress: boolean;
}

interface CustomerMatch {
  id: string;
  phone_number: string;
  name: string;
  address: string;
  area: string;
}

interface DuplicateWarnings {
  openEnquiries: { id: string; created_at: string; enquiry_product_interest: string | null }[];
  recentPurchases: { id: string; created_at: string; agreed_price: number | null; enquiry_product_interest: string | null }[];
}

const daysAgo = daysAgoIST;

// Label on the left, the field on the right — matches FormRow elsewhere,
// duplicated here so this component doesn't depend on either page's
// local FormRow definition.
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-40 shrink-0 text-sm font-medium text-gray-900">{label}</label>
      {children}
    </div>
  );
}

/**
 * Phone number, Name, Address, Area — as one unit, because a phone
 * number can now have more than one address on file (§4.1 revised).
 * Typing a known number either autofills the single match, or shows a
 * picker when there's more than one, with an explicit "add a new
 * address" escape hatch either way.
 */
export default function CustomerFields({
  value,
  onChange,
}: {
  value: CustomerFieldsValue;
  onChange: (value: CustomerFieldsValue) => void;
}) {
  const [matches, setMatches] = useState<CustomerMatch[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [warnings, setWarnings] = useState<DuplicateWarnings | null>(null);

  useEffect(() => {
    const phone = value.phoneNumber.trim();
    if (phone.length < 6) {
      setMatches([]);
      setWarnings(null);
      return;
    }
    const timeout = setTimeout(() => {
      fetch(`/api/admin/customers/lookup?phone=${encodeURIComponent(phone)}`)
        .then((res) => res.json())
        .then((data) => {
          const found: CustomerMatch[] = data.customers ?? [];
          setMatches(found);
          setWarnings(data.warnings ?? null);
          if (found.length === 1 && !value.customerId) {
            onChange({
              ...value,
              name: found[0].name,
              address: found[0].address,
              area: found[0].area,
              customerId: found[0].id,
              forceNewAddress: false,
            });
          } else if (found.length > 1 && !value.customerId && !value.forceNewAddress) {
            setShowPicker(true);
          }
        });
    }, 400);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.phoneNumber]);

  const hasWarnings = !!warnings && (warnings.openEnquiries.length > 0 || warnings.recentPurchases.length > 0);

  const pickAddress = (m: CustomerMatch) => {
    setShowPicker(false);
    onChange({ ...value, name: m.name, address: m.address, area: m.area, customerId: m.id, forceNewAddress: false });
  };

  const useNewAddress = () => {
    setShowPicker(false);
    onChange({ ...value, name: '', address: '', area: '', customerId: null, forceNewAddress: true });
  };

  return (
    <>
      <Row label="Phone number">
        <div className="flex-1">
          <input
            required
            className="w-full border rounded px-3 py-2 text-gray-900"
            value={value.phoneNumber}
            onChange={(e) => onChange({ ...value, phoneNumber: e.target.value, customerId: null, forceNewAddress: false })}
          />
          {matches.length === 1 && value.customerId && !value.forceNewAddress && (
            <p className="text-xs text-green-700 mt-1">
              Known customer — details filled in below.{' '}
              <button type="button" onClick={useNewAddress} className="underline">
                Use a different address for this number
              </button>
            </p>
          )}
          {matches.length > 1 && !showPicker && (
            <p className="text-xs text-blue-700 mt-1">
              {matches.length} addresses on file for this number.{' '}
              <button type="button" onClick={() => setShowPicker(true)} className="underline">
                Choose one
              </button>
            </p>
          )}
        </div>
      </Row>

      {hasWarnings && (
        <div className="ml-[calc(10rem+0.75rem)] bg-orange-50 border border-orange-200 rounded-md p-3 text-sm">
          <p className="font-medium text-orange-800 mb-1">Heads up — this number already has activity:</p>
          <ul className="space-y-1 text-orange-800">
            {warnings!.openEnquiries.map((e) => (
              <li key={e.id}>
                • An open enquiry ({e.enquiry_product_interest || 'no product noted'}), {daysAgo(e.created_at)}d ago
              </li>
            ))}
            {warnings!.recentPurchases.map((p) => (
              <li key={p.id}>
                • A purchase recorded {daysAgo(p.created_at)}d ago ({p.enquiry_product_interest || 'no product noted'}
                {p.agreed_price != null ? `, ₹${p.agreed_price}` : ''})
              </li>
            ))}
          </ul>
        </div>
      )}

      {showPicker && matches.length > 1 && (
        <div className="border rounded-md ml-[calc(10rem+0.75rem)]">
          <p className="text-xs text-gray-600 p-2 border-b bg-gray-50">Which address is this?</p>
          <div className="max-h-56 overflow-y-auto divide-y">
            {matches.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => pickAddress(m)}
                className="w-full text-left p-2.5 hover:bg-gray-50 text-sm"
              >
                <p className="font-medium">{m.name}</p>
                <p className="text-xs text-gray-600">
                  {m.address}, {m.area}
                </p>
              </button>
            ))}
            <button type="button" onClick={useNewAddress} className="w-full text-left p-2.5 hover:bg-gray-50 text-sm text-blue-700">
              + Add a new address for this number
            </button>
          </div>
        </div>
      )}

      <Row label="Name">
        <input
          required
          className="w-full border rounded px-3 py-2 text-gray-900"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </Row>
      <Row label="Address">
        <input
          required
          className="w-full border rounded px-3 py-2 text-gray-900"
          value={value.address}
          onChange={(e) => onChange({ ...value, address: e.target.value })}
        />
      </Row>
      <Row label="Area">
        <AreaSelect required value={value.area} onChange={(area) => onChange({ ...value, area })} />
      </Row>
    </>
  );
}
