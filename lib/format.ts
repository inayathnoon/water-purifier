// The product sheet stores brand/category/name in ALL CAPS (that's just
// how the business types it in Sheets) — this normalizes it to Start Case
// for display, matching how hand-typed free-text product descriptions
// already read elsewhere in the app.
export function toStartCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

// Every ₹ figure in the app goes through this — Indian digit grouping
// (₹1,39,000, not ₹139000), no decimals (this app never handles paise).
const inrFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
export function formatINR(n: number): string {
  return `₹${inrFormatter.format(n)}`;
}
