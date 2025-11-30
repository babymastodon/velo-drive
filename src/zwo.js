// zwo.js
//
// Canonical workout representation + conversion to ZWO,
// plus parsers for TrainerRoad / TrainerDay / WhatsOnZwift.
//
// This file is intentionally standalone (no external imports).

/**
 * Canonical representation of a scraped workout.
 *
 * @typedef CanonicalWorkout
 * @property {string} source
 *   e.g. "TrainerRoad" | "TrainerDay" | "WhatsOnZwift" | "Unknown"
 * @property {string} sourceURL
 *   Original workout page URL
 * @property {string} workoutTitle
 *   Human-readable workout title
 * @property {Array<[number, number, number]>} rawSegments
 *   Canonical segments: [minutes, startPower, endPower]
 *   - minutes: duration in minutes (float allowed)
 *   - startPower: % FTP or equivalent "start power" (0–100 usually)
 *   - endPower: % FTP or equivalent "end power" (0–100 usually)
 * @property {string} description
 *   Human-readable description/notes
 */

// ---------------- Site detection regexes (for parsers) ----------------

const TRAINERROAD_WORKOUT_REGEX =
  /\/app\/cycling\/workouts\/add\/(\d+)(?:\/|$)/;
const TRAINERDAY_WORKOUT_REGEX = /^\/workouts\/([^/?#]+)/;
const WHATSONZWIFT_WORKOUT_REGEX = /^\/workouts\/.+/;

// ---------------- Small helpers ----------------

function escapeXml(text) {
  return (text || "").replace(/[<>&'"]/g, (ch) => {
    switch (ch) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return ch;
    }
  });
}

function cdataWrap(text) {
  if (!text) return "<![CDATA[]]>";
  // Prevent accidental CDATA close inside content
  const safe = String(text).replace("]]>", "]]&gt;");
  return "<![CDATA[" + safe + "]]>";
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

async function fetchTrainerRoadJson(url) {
  return fetchJson(url, {
    credentials: "include",
    headers: {
      "trainerroad-jsonformat": "camel-case",
    },
  });
}

async function fetchTrainerDayWorkoutBySlug(slug) {
  const url = `https://app.api.trainerday.com/api/workouts/bySlug/${encodeURIComponent(
    slug
  )}`;
  return fetchJson(url, {credentials: "omit"});
}

// ---------------- Canonical segments -> ZWO body ----------------

/**
 * segments: [minutes, startPower, endPower]
 * Detects repeated steady on/off pairs and emits IntervalsT when possible.
 *
 * startPower/endPower are assumed to be in “FTP-relative” units where:
 *   - <= 5 → treated as 0–1 (fraction of FTP)
 *   - >  5 → treated as 0–100 (% of FTP)
 *
 * @param {Array<[number, number, number]>} segments
 * @returns {string} ZWO <workout> body lines joined by "\n"
 */
function segmentsToZwoSnippet(segments) {
  if (!Array.isArray(segments) || !segments.length) return "";

  const blocks = [];

  // ---------- 1) segments -> normalized blocks ----------
  for (const seg of segments) {
    if (!Array.isArray(seg) || seg.length < 2) continue;

    const minutes = Number(seg[0]);
    let startVal = Number(seg[1]);
    let endVal =
      seg.length > 2 && seg[2] != null ? Number(seg[2]) : startVal;

    if (
      !Number.isFinite(minutes) ||
      minutes <= 0 ||
      !Number.isFinite(startVal) ||
      !Number.isFinite(endVal)
    ) {
      continue;
    }

    // Convert to relative FTP (0–1) with a simple heuristic:
    // if value <= 5, assume already 0–1; otherwise assume 0–100%.
    const toRel = (v) => (v <= 5 ? v : v / 100);

    const durationSec = minutes * 60;
    const pStartRel = toRel(startVal);
    const pEndRel = toRel(endVal);

    if (durationSec <= 0) continue;

    if (Math.abs(pStartRel - pEndRel) < 1e-6) {
      // steady
      blocks.push({
        kind: "steady",
        durationSec,
        powerRel: pStartRel,
      });
    } else if (pEndRel > pStartRel) {
      // ramp up
      blocks.push({
        kind: "rampUp",
        durationSec,
        powerLowRel: pStartRel,
        powerHighRel: pEndRel,
      });
    } else {
      // ramp down
      blocks.push({
        kind: "rampDown",
        durationSec,
        powerLowRel: pStartRel,
        powerHighRel: pEndRel,
      });
    }
  }

  if (!blocks.length) return "";

  // ---------- 2) compress blocks -> ZWO lines ----------
  const lines = [];
  const DUR_TOL = 1; // seconds
  const PWR_TOL = 0.01; // relative FTP (0.01 = 1%)

  let i = 0;

  while (i < blocks.length) {
    // Try to detect repeated steady on/off pairs → IntervalsT
    if (i + 3 < blocks.length) {
      const firstA = blocks[i];
      const firstB = blocks[i + 1];

      if (firstA.kind === "steady" && firstB.kind === "steady") {
        let repeat = 1;
        let j = i + 2;

        // Scan forward for more identical A/B pairs
        while (j + 1 < blocks.length) {
          const nextA = blocks[j];
          const nextB = blocks[j + 1];

          if (
            nextA.kind !== "steady" ||
            nextB.kind !== "steady" ||
            !blocksSimilarSteady(firstA, nextA, DUR_TOL, PWR_TOL) ||
            !blocksSimilarSteady(firstB, nextB, DUR_TOL, PWR_TOL)
          ) {
            break;
          }

          repeat++;
          j += 2;
        }

        if (repeat >= 2) {
          const onDur = Math.round(firstA.durationSec);
          const offDur = Math.round(firstB.durationSec);
          const onPow = firstA.powerRel.toFixed(2);
          const offPow = firstB.powerRel.toFixed(2);

          lines.push(
            `<IntervalsT Repeat="${repeat}"` +
            ` OnDuration="${onDur}" OffDuration="${offDur}"` +
            ` OnPower="${onPow}" OffPower="${offPow}" />`
          );

          i += repeat * 2;
          continue;
        }
      }
    }

    // Fallback: single block -> SteadyState / Warmup / Cooldown
    const b = blocks[i];

    if (b.kind === "steady") {
      lines.push(
        `<SteadyState Duration="${Math.round(
          b.durationSec
        )}" Power="${b.powerRel.toFixed(2)}" />`
      );
    } else if (b.kind === "rampUp") {
      lines.push(
        `<Warmup Duration="${Math.round(
          b.durationSec
        )}" PowerLow="${b.powerLowRel.toFixed(
          2
        )}" PowerHigh="${b.powerHighRel.toFixed(2)}" />`
      );
    } else if (b.kind === "rampDown") {
      lines.push(
        `<Cooldown Duration="${Math.round(
          b.durationSec
        )}" PowerLow="${b.powerLowRel.toFixed(
          2
        )}" PowerHigh="${b.powerHighRel.toFixed(2)}" />`
      );
    }

    i++;
  }

  return lines.join("\n");
}

function blocksSimilarSteady(a, b, durTolSec, pwrTol) {
  if (a.kind !== "steady" || b.kind !== "steady") return false;
  const durDiff = Math.abs(a.durationSec - b.durationSec);
  const pDiff = Math.abs(a.powerRel - b.powerRel);
  return durDiff <= durTolSec && pDiff <= pwrTol;
}

// ---------------- CanonicalWorkout -> ZWO XML ----------------

/**
 * Build a full ZWO XML file from a CanonicalWorkout.
 *
 * The original source URL is included:
 *   - Appended to the description inside CDATA
 *   - As a tag: <tag name="OriginalURL:..."/>
 *
 * @param {CanonicalWorkout} meta
 * @param {Object} [options]
 * @param {string} [options.category]   - Optional Zwift category (default: meta.source or "Imported")
 * @param {string} [options.sportType]  - Zwift sportType (default: "bike")
 * @returns {string} ZWO XML content
 */
export function canonicalWorkoutToZwoXml(meta, options = {}) {
  const {
    source = "Unknown",
    sourceURL = "",
    workoutTitle = "",
    rawSegments = [],
    description = "",
  } = meta || {};

  const category = options.category || source || "Imported";
  const sportType = options.sportType || "bike";

  const name =
    (workoutTitle || "Custom workout").trim() || "Custom workout";
  const author = (source || "External workout").trim() || "External workout";

  // rawSegments are already canonical: [minutes, startPower, endPower]
  const workoutSnippet = segmentsToZwoSnippet(rawSegments);

  // Include URL in description so it's visible in Zwift UI
  let descCombined = description || "";
  if (sourceURL) {
    const urlLine = `Original workout URL: ${sourceURL}`;
    descCombined = descCombined
      ? `${descCombined}\n\n${urlLine}`
      : urlLine;
  }

  // Also include URL as a tag (Zwift will just ignore unknown tags,
  // but tools can use it later).
  const urlTag = sourceURL
    ? `    <tag name="OriginalURL:${escapeXml(sourceURL)}"/>\n`
    : "";

  const indentedBody = workoutSnippet
    ? workoutSnippet
      .split("\n")
      .map((line) => "    " + line)
      .join("\n")
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
  <author>${escapeXml(author)}</author>
  <name>${escapeXml(name)}</name>
  <description>${cdataWrap(descCombined)}</description>
  <category>${escapeXml(category)}</category>
  <sportType>${escapeXml(sportType)}</sportType>
  <tags>
    <tag name="${escapeXml(source || "External")}"/>
${urlTag}  </tags>
  <workout>
${indentedBody}
  </workout>
</workout_file>
`;
}

// ---------------- Parsers for each site -> CanonicalWorkout -----------
//
// Each parser returns a tuple: [CanonicalWorkout|null, string|null]
//   - On success: [canonicalWorkout, null]
//   - On failure: [null, "user-friendly error message"]

// ---------- TrainerRoad ----------

/**
 * Convert TrainerRoad chart "course data" into canonical [minutes, startPower, endPower].
 *
 * @param {any} courseData
 * @returns {Array<[number, number, number]>}
 */
function canonicalizeTrainerRoadSegments(courseData) {
  if (!Array.isArray(courseData)) return [];
  const out = [];

  for (const seg of courseData) {
    // Case 1: already numeric array
    if (Array.isArray(seg)) {
      if (seg.length >= 2) {
        let minutes = Number(seg[0]);
        let start = Number(seg[1]);
        let end =
          seg.length > 2 && seg[2] != null ? Number(seg[2]) : start;

        // Heuristic: if first value looks like seconds (very large),
        // treat it as seconds and convert to minutes.
        if (Number.isFinite(minutes) && minutes > 90 * 60) {
          minutes = minutes / 60;
        }

        if (
          Number.isFinite(minutes) &&
          minutes > 0 &&
          Number.isFinite(start) &&
          Number.isFinite(end)
        ) {
          out.push([minutes, start, end]);
        }
      }
      continue;
    }

    if (!seg || typeof seg !== "object") continue;

    // Case 2: object — try to find duration/time
    let minutes = null;

    if ("Minutes" in seg) minutes = Number(seg.Minutes);
    else if ("minutes" in seg) minutes = Number(seg.minutes);
    else if ("Duration" in seg) minutes = Number(seg.Duration) / 60;
    else if ("duration" in seg) minutes = Number(seg.duration) / 60;
    else if ("Seconds" in seg) minutes = Number(seg.Seconds) / 60;
    else if ("seconds" in seg) minutes = Number(seg.seconds) / 60;

    // Case 3: power is often a single value (steady)
    let powerVal =
      seg.power ??
      seg.Power ??
      seg.percentFTP ??
      seg.PercentFTP ??
      seg.work ??
      seg.Work;

    if (!Number.isFinite(minutes) || minutes <= 0 || powerVal == null) {
      continue;
    }

    powerVal = Number(powerVal);
    if (!Number.isFinite(powerVal)) continue;

    const startPower = powerVal;
    const endPower = powerVal;
    out.push([minutes, startPower, endPower]);
  }

  return out;
}

/**
 * Parse the current TrainerRoad workout page into a CanonicalWorkout tuple.
 *
 * @returns {Promise<[CanonicalWorkout|null, string|null]>}
 */
export async function parseTrainerRoadPage() {
  try {
    const path = window.location.pathname;
    const match = path.match(TRAINERROAD_WORKOUT_REGEX);
    if (!match) {
      return [
        null,
        "This doesn’t look like a TrainerRoad workout page. Open a workout in TrainerRoad and try again.",
      ];
    }

    const workoutId = match[1];
    const baseUrl = "https://www.trainerroad.com";

    const chartUrl = `${baseUrl}/app/api/workouts/${workoutId}/chart-data`;
    const summaryUrl = `${baseUrl}/app/api/workouts/${workoutId}/summary?withDifficultyRating=true`;

    const chartData = await fetchTrainerRoadJson(chartUrl);
    const metaResp = await fetchTrainerRoadJson(summaryUrl);
    const summary = metaResp.summary || metaResp || {};

    // Course data -> canonical segments
    let courseData =
      chartData.CourseData || chartData.courseData || chartData;
    if (!Array.isArray(courseData) && chartData.courseData) {
      courseData = chartData.courseData;
    }
    if (!Array.isArray(courseData) && chartData.data) {
      courseData = chartData.data;
    }

    const rawSegments = canonicalizeTrainerRoadSegments(courseData);
    if (!rawSegments.length) {
      return [
        null,
        "This TrainerRoad workout doesn’t have any intervals that VeloDrive can read yet.",
      ];
    }

    const workoutTitle =
      summary.workoutName || document.title || "TrainerRoad Workout";

    const description =
      summary.workoutDescription || summary.goalDescription || "";

    /** @type {CanonicalWorkout} */
    const cw = {
      source: "TrainerRoad",
      sourceURL: window.location.href,
      workoutTitle,
      rawSegments,
      description,
    };

    return [cw, null];
  } catch (err) {
    console.warn("[VeloDrive][TrainerRoad] parse error:", err);
    return [
      null,
      "VeloDrive couldn’t read this TrainerRoad workout. Make sure you’re logged in and try reloading the page.",
    ];
  }
}

// ---------- TrainerDay ----------

/**
 * Convert TrainerDay segments into canonical [minutes, startPower, endPower].
 * TrainerDay segments are typically [minutes, startPct, endPct?].
 *
 * @param {Array<any>} segments
 * @returns {Array<[number, number, number]>}
 */
function canonicalizeTrainerDaySegments(segments) {
  if (!Array.isArray(segments)) return [];
  const out = [];

  for (const seg of segments) {
    if (!Array.isArray(seg) || seg.length < 2) continue;

    const minutes = Number(seg[0]);
    const start = Number(seg[1]);
    const end =
      seg.length > 2 && seg[2] != null ? Number(seg[2]) : start;

    if (
      Number.isFinite(minutes) &&
      minutes > 0 &&
      Number.isFinite(start) &&
      Number.isFinite(end)
    ) {
      out.push([minutes, start, end]);
    }
  }

  return out;
}

/**
 * Parse the current TrainerDay workout page into a CanonicalWorkout tuple.
 *
 * @returns {Promise<[CanonicalWorkout|null, string|null]>}
 */
export async function parseTrainerDayPage() {
  try {
    const path = window.location.pathname;
    const match = path.match(TRAINERDAY_WORKOUT_REGEX);
    if (!match) {
      return [
        null,
        "This doesn’t look like a TrainerDay workout page. Open a workout on TrainerDay and try again.",
      ];
    }

    const slug = match[1];
    const details = await fetchTrainerDayWorkoutBySlug(slug);

    const rawSegments = canonicalizeTrainerDaySegments(
      Array.isArray(details.segments) ? details.segments : []
    );

    if (!rawSegments.length) {
      return [
        null,
        "This TrainerDay workout doesn’t have any intervals that VeloDrive can use.",
      ];
    }

    const workoutTitle =
      details.title || document.title || "TrainerDay Workout";
    const description = details.description || "";

    /** @type {CanonicalWorkout} */
    const cw = {
      source: "TrainerDay",
      sourceURL: window.location.href,
      workoutTitle,
      rawSegments,
      description,
    };

    return [cw, null];
  } catch (err) {
    console.warn("[VeloDrive][TrainerDay] parse error:", err);
    return [
      null,
      "VeloDrive couldn’t import this TrainerDay workout. Please check the URL and try again.",
    ];
  }
}

// ---------- WhatsOnZwift ----------

function extractWozTitle() {
  const el = document.querySelector("header.my-8 h1");
  return el ? el.textContent.trim() : "WhatsOnZwift Workout";
}

function extractWozDescription() {
  const ul = document.querySelector("ul.items-baseline");
  if (!ul) return "";
  let el = ul.previousElementSibling;
  while (el) {
    if (el.tagName && el.tagName.toLowerCase() === "p") {
      return el.textContent.trim();
    }
    el = el.previousElementSibling;
  }
  return "";
}

/**
 * Returns an array of { minutes, startPct, endPct, cadence|null }
 * extracted from the current WhatsOnZwift workout DOM.
 */
function extractWozSegmentsFromDom() {
  const container = document.querySelector("div.order-2");
  if (!container) {
    console.warn("[zwo] WhatsOnZwift: order-2 container not found.");
    return [];
  }

  const bars = Array.from(container.querySelectorAll(".textbar"));
  const segments = [];

  for (const bar of bars) {
    const text = (bar.textContent || "").replace(/\s+/g, " ").trim();
    const powSpans = bar.querySelectorAll(
      'span[data-unit="relpow"][data-value]'
    );

    // Patterns like: "5x 4min @ 72% FTP, 2min @ 52% FTP"
    const repMatch = text.match(/(\d+)\s*x\b/i);
    if (repMatch && powSpans.length >= 2) {
      const reps = parseInt(repMatch[1], 10);
      if (Number.isFinite(reps) && reps > 0) {
        const durMatches = Array.from(
          text.matchAll(/(\d+(?:\.\d+)?)\s*(min|sec)/gi)
        );
        const durations = durMatches
          .map((m) => {
            const val = parseFloat(m[1]);
            const unit = (m[2] || "").toLowerCase();
            if (!Number.isFinite(val)) return null;
            if (unit === "sec") return val / 60;
            return val; // minutes
          })
          .filter((v) => v != null);

        if (durations.length >= 2) {
          const onMinutes = durations[0];
          const offMinutes = durations[1];

          const pOn = Number(powSpans[0].getAttribute("data-value"));
          const pOff = Number(powSpans[1].getAttribute("data-value"));

          if (
            Number.isFinite(onMinutes) &&
            onMinutes > 0 &&
            Number.isFinite(offMinutes) &&
            offMinutes > 0 &&
            Number.isFinite(pOn) &&
            Number.isFinite(pOff)
          ) {
            for (let i = 0; i < reps; i++) {
              segments.push({
                minutes: onMinutes,
                startPct: pOn,
                endPct: pOn,
                cadence: null,
              });
              segments.push({
                minutes: offMinutes,
                startPct: pOff,
                endPct: pOff,
                cadence: null,
              });
            }
            continue;
          }
        }
      }
    }

    // Single bars, including ramps, with minutes or seconds
    let minutes = null;
    const minMatch = text.match(/(\d+)\s*min/i);
    if (minMatch) {
      minutes = Number(minMatch[1]);
    } else {
      const secMatch = text.match(/(\d+)\s*sec/i);
      if (secMatch) {
        const secs = Number(secMatch[1]);
        if (Number.isFinite(secs)) {
          minutes = secs / 60;
        }
      }
    }
    if (!Number.isFinite(minutes) || minutes <= 0) continue;

    const cadenceMatch = text.match(/@\s*(\d+)\s*rpm/i);
    const cadence = cadenceMatch ? Number(cadenceMatch[1]) : null;

    if (powSpans.length === 1) {
      const pct = Number(powSpans[0].getAttribute("data-value"));
      if (!Number.isFinite(pct)) continue;
      segments.push({
        minutes,
        startPct: pct,
        endPct: pct,
        cadence,
      });
    } else if (powSpans.length >= 2) {
      const pctLow = Number(powSpans[0].getAttribute("data-value"));
      const pctHigh = Number(powSpans[1].getAttribute("data-value"));
      if (!Number.isFinite(pctLow) || !Number.isFinite(pctHigh)) continue;
      segments.push({
        minutes,
        startPct: pctLow,
        endPct: pctHigh,
        cadence,
      });
    }
  }

  return segments;
}

/**
 * Map WhatsOnZwift DOM segments into canonical [minutes, startPower, endPower].
 *
 * @param {Array<{minutes:number,startPct:number,endPct:number}>} segments
 * @returns {Array<[number, number, number]>}
 */
function canonicalizeWozSegments(segments) {
  if (!Array.isArray(segments)) return [];
  const out = [];

  for (const s of segments) {
    if (!s || typeof s !== "object") continue;
    const minutes = Number(s.minutes);
    const start = Number(s.startPct);
    const end =
      s.endPct != null ? Number(s.endPct) : start;

    if (
      Number.isFinite(minutes) &&
      minutes > 0 &&
      Number.isFinite(start) &&
      Number.isFinite(end)
    ) {
      out.push([minutes, start, end]);
    }
  }

  return out;
}

/**
 * Parse the current WhatsOnZwift workout page into a CanonicalWorkout tuple.
 *
 * @returns {Promise<[CanonicalWorkout|null, string|null]>}
 */
export async function parseWhatsOnZwiftPage() {
  try {
    const path = window.location.pathname;
    if (!WHATSONZWIFT_WORKOUT_REGEX.test(path)) {
      return [
        null,
        "This doesn’t look like a WhatsOnZwift workout page. Open a workout on WhatsOnZwift and try again.",
      ];
    }

    const segments = extractWozSegmentsFromDom();
    const rawSegments = canonicalizeWozSegments(segments);

    if (!rawSegments.length) {
      return [
        null,
        "VeloDrive couldn’t find any intervals on this WhatsOnZwift workout page.",
      ];
    }

    const workoutTitle = extractWozTitle();
    const description = extractWozDescription() || "";

    /** @type {CanonicalWorkout} */
    const cw = {
      source: "WhatsOnZwift",
      sourceURL: window.location.href,
      workoutTitle,
      rawSegments,
      description,
    };

    return [cw, null];
  } catch (err) {
    console.warn("[VeloDrive][WhatsOnZwift] parse error:", err);
    return [
      null,
      "VeloDrive couldn’t read this WhatsOnZwift workout. Try reloading the page and make sure the workout loads fully.",
    ];
  }
}

