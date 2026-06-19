// date-keys.ts
//
// The single canonical `YYYY-MM-DD` date-key formatter.
//
// Formats a Date into a LOCAL-time date key (year-month-day in the local
// timezone, NOT UTC) with zero-padded month/day. This key is correctness-
// sensitive: it is used for schedule matching and history lookups, so the
// local-vs-UTC handling and zero-padding must stay byte-identical to the
// values stored on disk. This is the exact implementation that previously
// lived (duplicated) as `formatKey` in PlannerView.svelte and inline in
// App.svelte (×2).
export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
