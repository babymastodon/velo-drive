// calendar.ts
//
// Pure helpers extracted from the big views: the picker search-grammar parser /
// matcher (PickerView) and the planner calendar-week builder (PlannerView).
// No DOM, no reactivity — the components call these and bind the result. The
// picker + planner tests pin the behavior.

import { formatDateKey } from './date-keys.js';

// ----------------------------- picker search grammar -----------------------------

/**
 * The parsed picker search query: free-text tokens that must all appear in the
 * haystack, plus an optional inclusive duration range (minutes). The search
 * grammar: `30-45` / `<40` / `>60` / `45` (±5).
 */
export interface ParsedSearchQuery {
  tokens: string[];
  rangeMin: number | null;
  rangeMax: number | null;
}

/**
 * Parse a (already lower-cased or raw) search term into tokens + a duration
 * range. Whitespace-splits, then classifies each token: a compact range
 * (`30-45`), `<N` / `>N` bounds, an approx `N`(min) (expands to ±5), else a
 * free-text token. A reversed explicit range is normalized (min<=max).
 */
export function parseSearchQuery(term: string): ParsedSearchQuery {
  const rawTokens = term
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  let rangeMin: number | null = null;
  let rangeMax: number | null = null;
  const tokens: string[] = [];
  rawTokens.forEach((tok) => {
    const compactRange = tok.match(/^(\d+)\s*[-–]\s*(\d+)\s*(m|min)?$/i);
    if (compactRange) {
      rangeMin = Number(compactRange[1]);
      rangeMax = Number(compactRange[2]);
      return;
    }
    const lt = tok.match(/^<\s*(\d+)/);
    const gt = tok.match(/^>\s*(\d+)/);
    if (lt) {
      rangeMax = Number(lt[1]);
      return;
    }
    if (gt) {
      rangeMin = Number(gt[1]);
      return;
    }
    const approx = tok.match(/^(\d+)\s*(m|min)?$/i);
    if (approx) {
      const val = Number(approx[1]);
      if (Number.isFinite(val)) {
        rangeMin = rangeMin == null ? val - 5 : rangeMin;
        rangeMax = rangeMax == null ? val + 5 : rangeMax;
        return;
      }
    }
    tokens.push(tok);
  });
  if (rangeMin != null && rangeMax != null && rangeMin > rangeMax) {
    const tmp = rangeMin;
    rangeMin = rangeMax;
    rangeMax = tmp;
  }
  return { tokens, rangeMin, rangeMax };
}

/**
 * Test a single item (its lower-cased haystack + duration in minutes) against a
 * parsed query: every token must be a substring, and the duration must fall
 * within any range bound.
 */
export function matchesSearchQuery(
  q: ParsedSearchQuery,
  haystack: string,
  durationMin: number,
): boolean {
  const tokensMatch = q.tokens.every((t) => haystack.includes(t));
  if (!tokensMatch) return false;
  if (q.rangeMin != null || q.rangeMax != null) {
    const dur = durationMin;
    if (q.rangeMin != null && !(dur >= q.rangeMin)) return false;
    if (q.rangeMax != null && !(dur <= q.rangeMax)) return false;
  }
  return true;
}

// ----------------------------- planner calendar weeks -----------------------------

/** One day cell in the planner calendar grid. */
export interface DayCell {
  date: Date;
  key: string;
  dayNum: number;
  monthLabel: string | null;
  isToday: boolean;
  classes: string;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
function isSameDay(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Build the planner's calendar weeks grid (a VISIBLE_WEEKS × 7 matrix of
 * DayCells) from the anchor week start, today, and the selected date. Computes
 * the month labels (Today / month name / day-1) and the month-boundary CSS
 * classes. Pure.
 */
export function buildCalendarWeeks(
  anchorStart: Date,
  today: Date,
  selectedDate: Date | null,
  visibleWeeks: number,
): DayCell[][] {
  const rowsBefore = Math.floor(visibleWeeks / 2);
  const firstIndex = -rowsBefore;
  const out: DayCell[][] = [];
  // Precompute month meta for boundary classes.
  const monthMeta = new Map<string, { firstDow: number; lastDow: number }>();
  const metaFor = (year: number, month: number) => {
    const k = `${year}-${month}`;
    let m = monthMeta.get(k);
    if (!m) {
      m = {
        firstDow: new Date(year, month, 1).getDay(),
        lastDow: new Date(year, month + 1, 0).getDay(),
      };
      monthMeta.set(k, m);
    }
    return m;
  };
  // Build raw cells first.
  const raw: { date: Date; key: string; month: number; year: number; dow: number; cell: DayCell }[][] = [];
  for (let w = 0; w < visibleWeeks; w += 1) {
    const start = addDays(anchorStart, (firstIndex + w) * 7);
    const row: typeof raw[number] = [];
    for (let i = 0; i < 7; i += 1) {
      const date = addDays(start, i);
      const key = formatDateKey(date);
      const isFirstOfMonth = date.getDate() === 1;
      const isToday = isSameDay(date, today);
      let monthLabel: string | null = null;
      if (isFirstOfMonth || isToday) {
        monthLabel = isToday
          ? 'Today'
          : (() => {
              try {
                return date.toLocaleString(undefined, { month: 'long' });
              } catch {
                return String(date.getMonth() + 1);
              }
            })();
      }
      const cell: DayCell = {
        date,
        key,
        dayNum: date.getDate(),
        monthLabel,
        isToday,
        classes: '',
      };
      row.push({ date, key, month: date.getMonth(), year: date.getFullYear(), dow: date.getDay(), cell });
    }
    raw.push(row);
  }
  // Compute classes (selected/today/month-label + boundaries).
  raw.forEach((row, rowIdx) => {
    row.forEach((c, colIdx) => {
      const classes: string[] = ['planner-day'];
      if (c.cell.monthLabel != null) classes.push('has-month-label');
      if (c.cell.isToday) classes.push('is-today');
      if (selectedDate && isSameDay(c.date, selectedDate)) classes.push('is-selected');
      const meta = metaFor(c.year, c.month);
      if (colIdx > 0) {
        const prev = row[colIdx - 1];
        if (prev && prev.month !== c.month) classes.push('month-left-boundary');
      }
      if (rowIdx > 0) {
        const above = raw[rowIdx - 1]?.[colIdx];
        if (above && above.month !== c.month && c.dow >= meta.firstDow) {
          classes.push('month-top-boundary');
        }
      }
      if (rowIdx < raw.length - 1) {
        const below = raw[rowIdx + 1]?.[colIdx];
        if (below && below.month !== c.month && meta.lastDow !== 6 && c.dow <= meta.lastDow) {
          classes.push('month-bottom-boundary');
        }
      }
      c.cell.classes = classes.join(' ');
    });
  });
  raw.forEach((row) => out.push(row.map((c) => c.cell)));
  return out;
}
