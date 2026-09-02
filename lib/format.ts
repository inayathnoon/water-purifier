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
