// schedule.ts
//
// Pure schedule business rules. Each function takes the current schedule array
// + args and returns the NEXT array (or a guard result) — no I/O. WebFileStore /
// PickerView keep the read/write of schedule.json and CALL these. The rules
// (case-insensitive title match, the past-day move guard, the slice+concat
// reorder, the de-dupe / replace-in-place) are pinned by the planner/post-ride
// tests.

/** A persisted schedule entry (schedule.json is a flat array of these). */
export interface ScheduleEntry {
  date: string; // YYYY-MM-DD
  workoutTitle: string;
}

/**
 * Remove the scheduled entry for a given local day + workout title (matched
 * case-insensitively on the trimmed title). Returns null when there is nothing
 * to remove (bad args, or no matching entry), otherwise the pruned array.
 */
export function removeScheduledByTitle(
  entries: ScheduleEntry[],
  dateKey: string,
  title: string,
): ScheduleEntry[] | null {
  if (!dateKey || !title) return null;
  const wanted = title.trim().toLowerCase();
  const next = entries.filter(
    (e) => !(e.date === dateKey && (e.workoutTitle || '').trim().toLowerCase() === wanted),
  );
  if (next.length === entries.length) return null;
  return next;
}

/** A move result: a no-op (same day), a rejection (past day / no match), or the next array. */
export type MoveScheduledResult =
  | { kind: 'noop' }
  | { kind: 'reject' }
  | { kind: 'next'; entries: ScheduleEntry[] };

/**
 * Move a scheduled entry from one day to another (drag-and-drop reschedule):
 * a same-day move is a no-op, a move onto a PAST day is rejected, and only the
 * FIRST matching {fromDate, title} entry is moved (kept with its other fields,
 * re-appended at the end). `now` is the clock used for the past-day guard
 * (defaults to new Date()) so callers stay deterministic.
 */
export function moveScheduledEntry(
  entries: ScheduleEntry[],
  fromDate: string,
  title: string,
  toDate: string,
  now: Date = new Date(),
): MoveScheduledResult {
  if (!fromDate || !toDate || !title) return { kind: 'reject' };
  if (fromDate === toDate) return { kind: 'noop' };
  // Reject moving onto a past day. Day key compared against local midnight,
  // matching PlannerView.isPastDate.
  const [y, m, d] = toDate.split('-').map((n) => Number(n));
  if (y && m && d) {
    const target = new Date(y, m - 1, d).getTime();
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    if (target < midnight.getTime()) return { kind: 'reject' };
  }
  const idx = entries.findIndex((e) => e.date === fromDate && e.workoutTitle === title);
  if (idx === -1) return { kind: 'reject' };
  const next = entries
    .slice(0, idx)
    .concat(entries.slice(idx + 1))
    .concat([{ ...entries[idx], date: toDate } as ScheduleEntry]);
  return { kind: 'next', entries: next };
}

/**
 * Schedule a workout on a day (the picker's "Schedule Workout" / "Edit
 * Schedule" select). In edit mode (`replace` set), replace the FIRST entry
 * matching `replace` in place; if none matched, append. Otherwise de-dupe the
 * same day+title then append.
 */
export function scheduleWorkoutForDay(
  entries: ScheduleEntry[],
  dateKey: string,
  workoutTitle: string,
  replace: ScheduleEntry | null,
): ScheduleEntry[] {
  const nextEntry: ScheduleEntry = { date: dateKey, workoutTitle };
  let next: ScheduleEntry[];
  if (replace) {
    // Replace the targeted entry in place (matched by date + title).
    let replaced = false;
    next = entries.map((e) => {
      if (!replaced && e.date === replace.date && e.workoutTitle === replace.workoutTitle) {
        replaced = true;
        return nextEntry;
      }
      return e;
    });
    if (!replaced) next.push(nextEntry);
  } else {
    // Avoid a duplicate (same day + title) but otherwise append.
    next = entries.filter((e) => !(e.date === dateKey && e.workoutTitle === workoutTitle));
    next.push(nextEntry);
  }
  return next;
}

/**
 * Remove the entry exactly matching {date, title} (unschedule in edit mode).
 */
export function unscheduleEntry(entries: ScheduleEntry[], entry: ScheduleEntry): ScheduleEntry[] {
  return entries.filter((e) => !(e.date === entry.date && e.workoutTitle === entry.workoutTitle));
}
