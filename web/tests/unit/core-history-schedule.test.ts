// tests/unit/core-history-schedule.test.ts
//
// Focused unit coverage for the pure core modules extracted from the
// persistence adapter + the big views (Q8/Q9 layering refactor): the schedule
// rules (core/schedule), the picker search grammar (core/calendar), and the
// ride preview/detail math (core/history). These pin the byte-identical moved
// behavior independent of the I/O wrappers in WebFileStore / the Svelte views.

import { describe, it, expect } from "vitest";
import {
  removeScheduledByTitle,
  moveScheduledEntry,
  scheduleWorkoutForDay,
  unscheduleEntry,
  type ScheduleEntry,
} from "../../src/core/schedule.js";
import {
  parseSearchQuery,
  matchesSearchQuery,
  buildCalendarWeeks,
} from "../../src/core/calendar.js";
import { buildHistoryPreview, buildRideDetail } from "../../src/core/history.js";
import type { ParseFitResult } from "../../src/core/fit.js";

const ENTRIES = (): ScheduleEntry[] => [
  { date: "2026-06-18", workoutTitle: "Sleepy Spin" },
  { date: "2026-06-18", workoutTitle: "Into the Black" },
  { date: "2026-06-20", workoutTitle: "Keep Turning" },
];

describe("core/schedule.removeScheduledByTitle", () => {
  it("removes the matching entry case-insensitively + trimmed", () => {
    const next = removeScheduledByTitle(ENTRIES(), "2026-06-18", "  sleepy spin  ");
    expect(next).toEqual([
      { date: "2026-06-18", workoutTitle: "Into the Black" },
      { date: "2026-06-20", workoutTitle: "Keep Turning" },
    ]);
  });
  it("returns null when nothing matches or args are bad", () => {
    expect(removeScheduledByTitle(ENTRIES(), "2026-06-18", "Nope")).toBeNull();
    expect(removeScheduledByTitle(ENTRIES(), "", "Sleepy Spin")).toBeNull();
    expect(removeScheduledByTitle(ENTRIES(), "2026-06-18", "")).toBeNull();
  });
});

describe("core/schedule.moveScheduledEntry", () => {
  const NOW = new Date("2026-06-19T12:00:00");
  it("same-day move is a no-op", () => {
    expect(moveScheduledEntry(ENTRIES(), "2026-06-18", "Sleepy Spin", "2026-06-18", NOW)).toEqual({
      kind: "noop",
    });
  });
  it("rejects a move onto a past day", () => {
    expect(moveScheduledEntry(ENTRIES(), "2026-06-20", "Keep Turning", "2026-06-01", NOW)).toEqual({
      kind: "reject",
    });
  });
  it("rejects when no entry matches", () => {
    expect(moveScheduledEntry(ENTRIES(), "2026-06-18", "Nope", "2026-06-25", NOW)).toEqual({
      kind: "reject",
    });
  });
  it("moves the first match, re-appending it at the end with the new date", () => {
    const res = moveScheduledEntry(ENTRIES(), "2026-06-18", "Sleepy Spin", "2026-06-25", NOW);
    expect(res).toEqual({
      kind: "next",
      entries: [
        { date: "2026-06-18", workoutTitle: "Into the Black" },
        { date: "2026-06-20", workoutTitle: "Keep Turning" },
        { date: "2026-06-25", workoutTitle: "Sleepy Spin" },
      ],
    });
  });
});

describe("core/schedule.scheduleWorkoutForDay + unscheduleEntry", () => {
  it("appends + de-dupes when not in edit mode", () => {
    const next = scheduleWorkoutForDay(ENTRIES(), "2026-06-18", "Sleepy Spin", null);
    expect(next).toEqual([
      { date: "2026-06-18", workoutTitle: "Into the Black" },
      { date: "2026-06-20", workoutTitle: "Keep Turning" },
      { date: "2026-06-18", workoutTitle: "Sleepy Spin" },
    ]);
  });
  it("replaces the targeted entry in place in edit mode", () => {
    const replace: ScheduleEntry = { date: "2026-06-20", workoutTitle: "Keep Turning" };
    const next = scheduleWorkoutForDay(ENTRIES(), "2026-06-20", "Rise Against the Odds", replace);
    expect(next).toEqual([
      { date: "2026-06-18", workoutTitle: "Sleepy Spin" },
      { date: "2026-06-18", workoutTitle: "Into the Black" },
      { date: "2026-06-20", workoutTitle: "Rise Against the Odds" },
    ]);
  });
  it("appends in edit mode when the replace target is missing", () => {
    const replace: ScheduleEntry = { date: "2099-01-01", workoutTitle: "Ghost" };
    const next = scheduleWorkoutForDay(ENTRIES(), "2026-06-22", "New", replace);
    expect(next[next.length - 1]).toEqual({ date: "2026-06-22", workoutTitle: "New" });
    expect(next.length).toBe(4);
  });
  it("unscheduleEntry removes the exact {date,title}", () => {
    expect(unscheduleEntry(ENTRIES(), { date: "2026-06-20", workoutTitle: "Keep Turning" })).toEqual([
      { date: "2026-06-18", workoutTitle: "Sleepy Spin" },
      { date: "2026-06-18", workoutTitle: "Into the Black" },
    ]);
  });
});

describe("core/calendar.parseSearchQuery + matchesSearchQuery", () => {
  it("parses a compact range", () => {
    expect(parseSearchQuery("30-45")).toEqual({ tokens: [], rangeMin: 30, rangeMax: 45 });
  });
  it("parses < and > bounds", () => {
    expect(parseSearchQuery("<40")).toEqual({ tokens: [], rangeMin: null, rangeMax: 40 });
    expect(parseSearchQuery(">60")).toEqual({ tokens: [], rangeMin: 60, rangeMax: null });
  });
  it("expands an approx N to ±5", () => {
    expect(parseSearchQuery("45")).toEqual({ tokens: [], rangeMin: 40, rangeMax: 50 });
  });
  it("normalizes a reversed explicit range", () => {
    expect(parseSearchQuery("45-30")).toEqual({ tokens: [], rangeMin: 30, rangeMax: 45 });
  });
  it("keeps free-text tokens alongside a range", () => {
    expect(parseSearchQuery("threshold 30-45")).toEqual({
      tokens: ["threshold"],
      rangeMin: 30,
      rangeMax: 45,
    });
  });
  it("matches tokens (substring) + range inclusively", () => {
    const q = parseSearchQuery("black 30-45");
    expect(matchesSearchQuery(q, "into the black tempo", 40)).toBe(true);
    expect(matchesSearchQuery(q, "into the black tempo", 46)).toBe(false);
    expect(matchesSearchQuery(q, "sleepy spin recovery", 40)).toBe(false);
  });
});

describe("core/calendar.buildCalendarWeeks", () => {
  it("builds a 16x7 grid anchored on the week containing today", () => {
    const today = new Date(2026, 5, 18); // 2026-06-18 (a Thursday)
    today.setHours(0, 0, 0, 0);
    const anchor = new Date(today);
    anchor.setDate(anchor.getDate() - anchor.getDay()); // start of week (Sunday)
    const weeks = buildCalendarWeeks(anchor, today, today, 16);
    expect(weeks.length).toBe(16);
    expect(weeks.every((r) => r.length === 7)).toBe(true);
    const todayCell = weeks.flat().find((c) => c.isToday);
    expect(todayCell?.monthLabel).toBe("Today");
    expect(todayCell?.classes).toContain("is-today");
    expect(todayCell?.classes).toContain("is-selected");
  });
});

function fakeFit(over: Partial<ParseFitResult>): ParseFitResult {
  return {
    canonicalWorkout: { workoutTitle: "Test Ride", rawSegments: [] } as never,
    samples: [
      { t: 0, power: 100, hr: 120, cadence: 80 },
      { t: 1, power: 200, hr: 140, cadence: 90 },
      { t: 2, power: 150, hr: 130, cadence: 85 },
    ] as never,
    meta: {
      ftp: 200,
      startedAt: new Date("2026-06-18T10:00:00Z"),
      endedAt: new Date("2026-06-18T10:00:03Z"),
      totalWorkJ: 450,
      totalElapsedSec: 5,
      totalTimerSec: 3,
      pauseEvents: [],
    },
    ...over,
  } as ParseFitResult;
}

describe("core/history.buildHistoryPreview + buildRideDetail", () => {
  it("buildHistoryPreview produces a stable preview from a parsed FIT", () => {
    const p = buildHistoryPreview("2026-06-18T10-00-00Z.fit", fakeFit({}));
    expect(p.fileName).toBe("2026-06-18T10-00-00Z.fit");
    expect(p.workoutTitle).toBe("Test Ride");
    expect(p.kj).toBe(0.45); // totalWorkJ / 1000
    expect(p.durationSec).toBeGreaterThan(0);
    expect(p.startedAt?.toISOString()).toBe("2026-06-18T10:00:00.000Z");
  });
  it("buildRideDetail derives pausedSec (elapsed - timer) + VI/EF", () => {
    const d = buildRideDetail("2026-06-18T10-00-00Z.fit", fakeFit({}), {
      workoutTitle: "fallback",
      startedAt: null,
      startedAtFallback: null,
      zone: "",
    });
    expect(d.pausedSec).toBe(2); // totalElapsedSec(5) - totalTimerSec(3)
    expect(d.ftp).toBe(200);
    // VI = NP/avg, EF = NP/avgHr — both present given the samples.
    expect(typeof d.vi).toBe("number");
    expect(typeof d.ef).toBe("number");
  });
});
