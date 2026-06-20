// planner-backend.js
// Non-view helpers and state for the workout planner: history indexing,
// stats cache maintenance, FIT preview loading, and schedule persistence.

import { parseFitFile } from "./fit-file.js";
import {
  DEFAULT_FTP,
  computeMetricsFromSamples,
  computeScheduledMetrics,
  inferZoneFromSegments,
} from "./workout-metrics.js";
import {
  loadWorkoutDirHandle,
  loadWorkoutStatsCache,
  saveWorkoutStatsCache,
  loadScheduleEntries,
  saveScheduleEntries,
} from "./storage.js";
import { loadWorkoutFile } from "./workout-library.js";
import { buildPowerSegments, powerMaxFromIntervals } from "./planner-analysis.js";

const STATS_CACHE_VERSION = 30; // bump whenever cache format/logic changes

export function createPlannerBackend({
  formatKey,
  utcDateKeyToLocalDate,
  toDateSafe,
  keyToDate,
  getCurrentFtp,
} = {}) {
  const historyIndex = new Map(); // dateKey -> {handle, name}
  const historyCache = new Map(); // dateKey -> Promise<{...}>
  const historyData = new Map(); // dateKey -> Array<preview>
  const scheduledMap = new Map(); // dateKey -> Array<entry>
  let historyIndexPromise = null;
  let schedulePromise = null;
  let statsCache = null;

  const aggTotals = {
    3: { sec: 0, kj: 0, tss: 0 },
    7: { sec: 0, kj: 0, tss: 0 },
    30: { sec: 0, kj: 0, tss: 0 },
  };

  function dateKeyFromHandleName(name) {
    const parts = name.split(" ");
    if (!parts.length) return null;
    const isoPart = parts[0];
    const timeMatch = isoPart.match(
      /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z$/,
    );
    if (timeMatch) {
      const iso = `${timeMatch[1]}T${timeMatch[2]}:${timeMatch[3]}:${timeMatch[4]}Z`;
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) {
        return typeof formatKey === "function" ? formatKey(d) : null;
      }
    }
    const datePart = isoPart.split("T")[0];
    if (!datePart || datePart.length < 10) return null;
    const asDate =
      typeof utcDateKeyToLocalDate === "function"
        ? utcDateKeyToLocalDate(datePart)
        : null;
    return asDate && typeof formatKey === "function" ? formatKey(asDate) : null;
  }

  function resetHistoryIndex() {
    historyIndex.clear();
    historyCache.clear();
    historyData.clear();
    historyIndexPromise = null;
    scheduledMap.clear();
    schedulePromise = null;
  }

  async function ensureStatsCache() {
    if (statsCache) return statsCache;
    try {
      const raw = await loadWorkoutStatsCache();
      if (raw && raw.version === STATS_CACHE_VERSION && raw.entries) {
        statsCache = raw;
      } else {
        statsCache = { version: STATS_CACHE_VERSION, entries: {} };
      }
    } catch (_err) {
      statsCache = { version: STATS_CACHE_VERSION, entries: {} };
    }
    return statsCache;
  }

  async function ensureHistoryIndex() {
    if (historyIndexPromise) return historyIndexPromise;
    historyIndexPromise = (async () => {
      const dir = await loadWorkoutDirHandle();
      if (!dir) return;
      try {
        for await (const [name, handle] of dir.entries()) {
          if (!name || !name.toLowerCase().endsWith(".fit")) continue;
          const localizedKey = dateKeyFromHandleName(name);
          if (!localizedKey) continue;
          const arr = historyIndex.get(localizedKey) || [];
          arr.push({ name, handle });
          historyIndex.set(localizedKey, arr);
        }
        historyIndex.forEach((arr, key) => {
          historyIndex.set(
            key,
            arr.sort((a, b) =>
              a.name < b.name ? 1 : a.name > b.name ? -1 : 0,
            ),
          );
        });
      } catch (err) {
        console.warn("[Planner] Failed to list history dir:", err);
      }
    })();
    return historyIndexPromise;
  }

  async function loadScheduleIntoMap() {
    const entries = await loadScheduleEntries();
    const nextMap = new Map();
    let added = 0;
    const ftpForSchedule =
      typeof getCurrentFtp === "function"
        ? Number(getCurrentFtp()) || DEFAULT_FTP
        : DEFAULT_FTP;
    for (const e of entries) {
      if (!e || !e.date || !e.workoutTitle) continue;
      const key = e.date;
      const entry = { date: e.date, workoutTitle: e.workoutTitle };
      await loadWorkoutFile(entry);
      entry.metrics = entry.metrics || computeScheduledMetrics(entry, ftpForSchedule);
      if (entry.metrics) {
        entry.durationSec = entry.metrics.durationSec;
        entry.kj = entry.metrics.kj;
        entry.ifValue = entry.metrics.ifValue;
        entry.tss = entry.metrics.tss;
        entry.zone = entry.metrics.zone;
      }
      const arr = nextMap.get(key) || [];
      arr.push(entry);
      nextMap.set(key, arr);
      added += 1;
    }
    scheduledMap.clear();
    nextMap.forEach((val, key) => scheduledMap.set(key, val));
    return added;
  }

  async function ensureScheduleLoaded() {
    if (!schedulePromise) {
      schedulePromise = loadScheduleIntoMap();
    }
    return schedulePromise;
  }

  async function persistSchedule(entries) {
    await saveScheduleEntries(entries);
  }

  async function loadHistoryPreview(dateKey) {
    const existing = historyCache.get(dateKey);
    if (existing) return existing;

    const promise = (async () => {
      await ensureStatsCache();
      await ensureHistoryIndex();
      const entries = historyIndex.get(dateKey) || [];
      if (!entries.length) return [];
      let cacheDirty = false;
      const results = [];
      for (const entry of entries) {
        try {
          let entryDirty = false;
          const cached = statsCache.entries[entry.name];
          const file = await entry.handle.getFile();
          const buf = await file.arrayBuffer();
          const parsed = parseFitFile(buf);
          const cw = parsed.canonicalWorkout || {};
          const meta = parsed.meta || {};
          const metaStarted = typeof toDateSafe === "function" ? toDateSafe(meta.startedAt) : null;
          const metaEnded = typeof toDateSafe === "function" ? toDateSafe(meta.endedAt) : null;
          const ftp = meta.ftp || DEFAULT_FTP;
          const lastSample = parsed.samples?.length
            ? parsed.samples[parsed.samples.length - 1]
            : null;
          const durationSecHint =
            meta.totalTimerSec != null
              ? Math.max(1, Math.round(meta.totalTimerSec))
              : metaStarted && metaEnded
                ? Math.max(
                    1,
                    Math.round(
                      (metaEnded.getTime() - metaStarted.getTime()) / 1000,
                    ),
                  )
                : Math.max(1, Math.round(lastSample?.t || 0));

          let metrics = null;
          if (
            cached &&
            cached.durationSec &&
            cached.kj != null &&
            cached.tss != null &&
            cached.ifValue != null
          ) {
            metrics = {
              durationSec: cached.durationSec,
              kj: cached.kj,
              tss: cached.tss,
              ifValue: cached.ifValue,
            };
          } else {
            metrics = computeMetricsFromSamples(
              parsed.samples || [],
              ftp,
              durationSecHint,
            );
            entryDirty = true;
          }

          const title = cw.workoutTitle || entry.name.replace(/\.fit$/i, "");
          const startedAt =
            metaStarted ||
            (cached?.startedAt && typeof toDateSafe === "function"
              ? toDateSafe(cached.startedAt)
              : null) ||
            (typeof utcDateKeyToLocalDate === "function"
              ? utcDateKeyToLocalDate(dateKey)
              : null);

          let zone = cached?.zone;
          if (!zone) {
            zone = inferZoneFromSegments(cw.rawSegments || []);
            if (zone) entryDirty = true;
          }

          let powerSegments = cached?.powerSegments;
          if (!Array.isArray(powerSegments)) {
            const built = buildPowerSegments(
              parsed.samples || [],
              durationSecHint,
            );
            powerSegments = built.intervals;
            entryDirty = true;
          }
          if (!Array.isArray(powerSegments)) powerSegments = [];

          if (!cached || entryDirty) {
            statsCache.entries[entry.name] = {
              workoutTitle: title,
              durationSec: metrics.durationSec || durationSecHint || 0,
              kj: meta.totalWorkJ != null ? meta.totalWorkJ / 1000 : metrics.kj,
              ifValue: metrics.ifValue,
              tss: metrics.tss,
              startedAt: startedAt ? startedAt.toISOString() : null,
              powerSegments,
              zone,
            };
            cacheDirty = true;
          }

          const powerMax = powerMaxFromIntervals(powerSegments);
          results.push({
            workoutTitle: title,
            durationSec: metrics.durationSec || durationSecHint || 0,
            kj: meta.totalWorkJ != null ? meta.totalWorkJ / 1000 : metrics.kj,
            ifValue: metrics.ifValue,
            tss: metrics.tss,
            startedAt,
            rawSegments: cw.rawSegments || [],
            powerSegments,
            powerMax,
            fileName: entry.name,
            zone,
          });
        } catch (err) {
          console.warn(
            "[Planner] Failed to load history for",
            dateKey,
            entry?.name,
            err,
          );
        }
      }
      if (cacheDirty) {
        saveWorkoutStatsCache(statsCache).catch(() => {});
      }
      return results;
    })();

    historyCache.set(dateKey, promise);
    return promise;
  }

  return {
    historyIndex,
    historyCache,
    historyData,
    scheduledMap,
    dateKeyFromHandleName,
    resetHistoryIndex,
    ensureStatsCache,
    ensureHistoryIndex,
    loadHistoryPreview,
    loadScheduleIntoMap,
    ensureScheduleLoaded,
    persistSchedule,
    aggTotals,
    recomputeAggTotals(baseDate) {
      aggTotals["3"] = { sec: 0, kj: 0, tss: 0 };
      aggTotals["7"] = { sec: 0, kj: 0, tss: 0 };
      aggTotals["30"] = { sec: 0, kj: 0, tss: 0 };

      const base = baseDate ? new Date(baseDate) : new Date();
      base.setHours(0, 0, 0, 0);
      const baseMs = base.getTime();
      const dayMs = 24 * 60 * 60 * 1000;
      const baseEndMs = baseMs + dayMs;
      const cutoff7 = baseEndMs - 7 * dayMs; // selected day + previous 6
      const cutoff3 = baseEndMs - 3 * dayMs; // selected day + previous 2
      const cutoff30 = baseEndMs - 30 * dayMs; // selected day + previous 29

      historyData.forEach((items) => {
        items.forEach((item) => {
          const start = item.startedAt ? item.startedAt.getTime() : null;
          if (start == null) return;
          if (start < baseEndMs && start >= cutoff3) {
            aggTotals["3"].sec += item.durationSec || 0;
            aggTotals["3"].kj += item.kj || 0;
            aggTotals["3"].tss += item.tss || 0;
          }
          if (start < baseEndMs && start >= cutoff7) {
            aggTotals["7"].sec += item.durationSec || 0;
            aggTotals["7"].kj += item.kj || 0;
            aggTotals["7"].tss += item.tss || 0;
          }
          if (start < baseEndMs && start >= cutoff30) {
            aggTotals["30"].sec += item.durationSec || 0;
            aggTotals["30"].kj += item.kj || 0;
            aggTotals["30"].tss += item.tss || 0;
          }
        });
      });
      const todayMid = new Date();
      todayMid.setHours(0, 0, 0, 0);
      const todayMs = todayMid.getTime();
      scheduledMap.forEach((entries, key) => {
        const date =
          typeof keyToDate === "function" ? keyToDate(key) : new Date(key);
        date.setHours(0, 0, 0, 0);
        const start = date.getTime();
        if (start < todayMs) return;
        entries.forEach((entry) => {
          const metrics = entry.metrics;
          if (!metrics) return;
          if (start < baseEndMs && start >= cutoff3) {
            aggTotals["3"].sec += metrics.durationSec || 0;
            aggTotals["3"].kj += metrics.kj || 0;
            aggTotals["3"].tss += metrics.tss || 0;
          }
          if (start < baseEndMs && start >= cutoff7) {
            aggTotals["7"].sec += metrics.durationSec || 0;
            aggTotals["7"].kj += metrics.kj || 0;
            aggTotals["7"].tss += metrics.tss || 0;
          }
          if (start < baseEndMs && start >= cutoff30) {
            aggTotals["30"].sec += metrics.durationSec || 0;
            aggTotals["30"].kj += metrics.kj || 0;
            aggTotals["30"].tss += metrics.tss || 0;
          }
        });
      });
      return aggTotals;
    },
  };
}
