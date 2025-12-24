// zwo.js
//
// Canonical workout representation + conversion to/from ZWO,
// plus inline ZWO parsing.
//
// This file is intentionally standalone (no DOM or fetch dependencies).

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
 * @property {Array<[number, number, number, (string?), (number?)]>} rawSegments
 *   Canonical segments: [minutes, startPower, endPower, type?, cadenceRpm?]
 *   - minutes: duration in minutes (float allowed)
 *   - startPower: % FTP or equivalent "start power" (0–100 usually)
 *   - endPower: % FTP or equivalent "end power" (0–100 usually)
 *   - type: optional string (e.g. "freeride")
 *   - cadenceRpm: optional cadence target (rpm)
 * @property {string} description
 *   Human-readable description/notes
 * @property {Array<{offsetSec:number,durationSec:number,text:string}>} [textEvents]
 *   Optional text events aligned to workout timeline
 */

// ---------------- Safety limits for ZWO parsing ----------------

const ZWO_MAX_SEGMENT_DURATION_SEC = 12 * 3600; // 12 hours per segment
const ZWO_MAX_WORKOUT_DURATION_SEC = 24 * 3600; // 24 hours total workout
const ZWO_MAX_INTERVAL_REPEATS = 500; // sanity cap on repeats
const FREERIDE_SEGMENT_FLAG = "freeride";
const FREERIDE_POWER_REL = 0.5;

// ---------------- Small helpers ----------------

function escapeXml(text) {
  return (text || "").replace(/[<>&'"]/g, (ch) => {
    switch (ch) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case '"': return "&quot;";
      case "'": return "&apos;";
      default: return ch;
    }
  });
}

function unescapeXml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function cdataWrap(text) {
  if (text == null) return "<![CDATA[]]>";
  const safe = String(text).replace("]]>", "]]&gt;");
  return "<![CDATA[" + safe + "]]>";
}

function cdataUnwrap(text) {
  if (text == null) return "";
  const str = String(text);
  if (str.startsWith("<![CDATA[") && str.endsWith("]]>")) {
    const inner = str.slice(9, -3);
    return inner.replace("]]&gt;", "]]>");
  }
  return str;
}

// ---------------- Inline ZWO snippet parser ----------------

/**
 * Parse a ZWO-style snippet containing SteadyState / Warmup / Cooldown / IntervalsT
 * into canonical rawSegments and syntax errors.
 *
 * @param {string} text
 * @returns {{
 *   rawSegments:Array<[number,number,number,(string?),(number?)]>,
 *   textEvents:Array<{offsetSec:number,durationSec:number,text:string}>,
 *   errors:Array<{start:number,end:number,message:string}>,
 *   blocks:Array<{
 *     kind:"steady"|"warmup"|"cooldown"|"intervals"|"freeride",
 *     start:number,
 *     end:number,
 *     lineStart:number,
 *     lineEnd:number,
 *     segmentStart:number,
 *     segmentCount:number,
 *     segments:Array<{durationSec:number,pStartRel:number,pEndRel:number,cadenceRpm?:(number|null)}>,
 *     attrs:Record<string, number>
 *   }>,
 *   sourceText:string
 * }}
 */
export function parseZwoSnippet(text) {
  /** @type {Array<{durationSec:number,pStartRel:number,pEndRel:number}>} */
  const segments = [];
  const textEvents = [];
  const errors = [];
  const blocks = [];

  const source = String(text || "");
  const withoutWorkoutWrappers = source
    // Preserve string length for position mapping by replacing wrappers with spaces
    .replace(/<\s*workout[^>]*>/gi, (m) => " ".repeat(m.length))
    .replace(/<\/\s*workout\s*>/gi, (m) => " ".repeat(m.length));

  const working = withoutWorkoutWrappers;
  if (!working.trim()) {
    return {rawSegments: [], textEvents, errors, blocks, sourceText: working};
  }

  const tagRegex = /<([A-Za-z]+)\b([^>]*)\/>/g;
  let lastIndex = 0;
  let match;

  const lineFromIndex = (idx) => {
    const safeIdx = Math.max(0, Math.min(idx, working.length));
    let line = 0;
    for (let i = 0; i < safeIdx; i += 1) {
      if (working[i] === "\n") line += 1;
    }
    return line;
  };

  while ((match = tagRegex.exec(working)) !== null) {
    const full = match[0];
    const tagName = match[1];
    const attrsText = match[2] || "";
    const startIdx = match.index;
    const endIdx = startIdx + full.length;

    const between = working.slice(lastIndex, startIdx);
    if (between.trim().length > 0) {
      errors.push({
        start: lastIndex,
        end: startIdx,
        message:
          "Unexpected text between elements; only ZWO workout elements are allowed.",
      });
    }

    const {attrs, hasGarbage} = parseZwoAttributes(attrsText);

    if (hasGarbage) {
      errors.push({
        start: startIdx,
        end: endIdx,
        message:
          "Malformed element: unexpected text or tokens inside element.",
      });
      lastIndex = endIdx;
      continue;
    }

    const blockSegmentStart = segments.length;
    const blockLineStart = lineFromIndex(startIdx);
    let blockResult = null;

    switch (tagName) {
      case "SteadyState":
        blockResult = handleZwoSteady(attrs, segments, errors, startIdx, endIdx);
        break;
      case "Warmup":
      case "Cooldown":
        blockResult = handleZwoRamp(tagName, attrs, segments, errors, startIdx, endIdx);
        break;
      case "FreeRide":
      case "Freeride":
        blockResult = handleZwoFreeRide(attrs, segments, errors, startIdx, endIdx);
        break;
      case "TextEvent":
      case "textevent":
        handleZwoTextEvent(attrs, textEvents, errors, startIdx, endIdx);
        break;
      case "IntervalsT":
        blockResult = handleZwoIntervals(attrs, segments, errors, startIdx, endIdx);
        break;
      default:
        errors.push({
          start: startIdx,
          end: endIdx,
          message: `Unknown element <${tagName}>`,
        });
        break;
    }

    if (blockResult && blockResult.segments && blockResult.segments.length) {
      blocks.push({
        kind: blockResult.kind,
        start: startIdx,
        end: endIdx,
        lineStart: blockLineStart,
        lineEnd: lineFromIndex(endIdx),
        segmentStart: blockSegmentStart,
        segmentCount: blockResult.segments.length,
        segments: blockResult.segments.slice(),
        attrs: {...blockResult.attrs},
      });
    }

    lastIndex = endIdx;
  }

  const trailing = working.slice(lastIndex);
  if (trailing.trim().length > 0) {
    errors.push({
      start: lastIndex,
      end: lastIndex + trailing.length,
      message: "Trailing text after last element.",
    });
  }

  const rawSegments = segments.map((seg) => {
    if (seg.isFreeRide) {
      return [
        seg.durationSec / 60,
        FREERIDE_POWER_REL * 100,
        FREERIDE_POWER_REL * 100,
        FREERIDE_SEGMENT_FLAG,
      ];
    }
    const cadence = Number.isFinite(seg.cadenceRpm) ? seg.cadenceRpm : null;
    const base = [
      seg.durationSec / 60,   // minutes
      seg.pStartRel * 100,    // startPct
      seg.pEndRel * 100       // endPct
    ];
    if (cadence != null) {
      base.push(null, cadence);
    }
    return base;
  });

  return {rawSegments, textEvents, errors, blocks, sourceText: working};
}

function parseZwoAttributes(attrText) {
  const attrs = {};
  let hasGarbage = false;

  const attrRegex =
    /([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=\s*"([^"]*)"/g;

  let m;
  let lastIndex = 0;

  while ((m = attrRegex.exec(attrText)) !== null) {
    if (m.index > lastIndex) {
      const between = attrText.slice(lastIndex, m.index);
      if (between.trim().length > 0) hasGarbage = true;
    }

    attrs[m[1]] = m[2];
    lastIndex = attrRegex.lastIndex;
  }

  const trailing = attrText.slice(lastIndex);
  if (trailing.trim().length > 0) hasGarbage = true;

  return {attrs, hasGarbage};
}

function getAttrValue(attrs, name) {
  if (!attrs || !name) return null;
  if (name in attrs) return attrs[name];
  const target = name.toLowerCase();
  for (const key of Object.keys(attrs)) {
    if (key.toLowerCase() === target) return attrs[key];
  }
  return null;
}

function getAttrNumber(attrs, name) {
  const raw = getAttrValue(attrs, name);
  return raw != null ? Number(raw) : NaN;
}

function handleZwoSteady(attrs, segments, errors, start, end) {
  const duration = attrs.Duration != null ? Number(attrs.Duration) : NaN;
  const power = attrs.Power != null ? Number(attrs.Power) : NaN;
  const cadence = getAttrNumber(attrs, "Cadence");

  if (!validateZwoDuration(duration, "SteadyState", start, end, errors)) return;
  if (!Number.isFinite(power) || power <= 0) {
    errors.push({
      start,
      end,
      message:
        "SteadyState must have a positive numeric Power (relative FTP, e.g. 0.75).",
    });
    return;
  }

  const seg = {
    durationSec: duration,
    pStartRel: power,
    pEndRel: power,
    cadenceRpm: Number.isFinite(cadence) ? cadence : null,
  };
  segments.push(seg);

  return {
    kind: "steady",
    segments: [seg],
    attrs: {
      durationSec: duration,
      powerRel: power,
      cadenceRpm: Number.isFinite(cadence) ? cadence : null,
    },
  };
}

function handleZwoRamp(tagName, attrs, segments, errors, start, end) {
  const duration = attrs.Duration != null ? Number(attrs.Duration) : NaN;
  const pLow = attrs.PowerLow != null ? Number(attrs.PowerLow) : NaN;
  const pHigh = attrs.PowerHigh != null ? Number(attrs.PowerHigh) : NaN;
  const cadence = getAttrNumber(attrs, "Cadence");

  if (!validateZwoDuration(duration, tagName, start, end, errors)) return;
  if (!Number.isFinite(pLow) || !Number.isFinite(pHigh)) {
    errors.push({
      start,
      end,
      message: `${tagName} must have PowerLow and PowerHigh as numbers (relative FTP).`,
    });
    return;
  }

  const seg = {
    durationSec: duration,
    pStartRel: pLow,
    pEndRel: pHigh,
    cadenceRpm: Number.isFinite(cadence) ? cadence : null,
  };

  segments.push(seg);

  return {
    kind: tagName === "Warmup" ? "warmup" : "cooldown",
    segments: [seg],
    attrs: {
      durationSec: duration,
      powerLowRel: pLow,
      powerHighRel: pHigh,
      cadenceRpm: Number.isFinite(cadence) ? cadence : null,
    },
  };
}

function handleZwoFreeRide(attrs, segments, errors, start, end) {
  const duration = attrs.Duration != null ? Number(attrs.Duration) : NaN;

  if (!validateZwoDuration(duration, "FreeRide", start, end, errors)) return;

  const seg = {
    durationSec: duration,
    pStartRel: FREERIDE_POWER_REL,
    pEndRel: FREERIDE_POWER_REL,
    isFreeRide: true,
  };

  segments.push(seg);

  return {
    kind: "freeride",
    segments: [seg],
    attrs: {
      durationSec: duration,
    },
  };
}

function handleZwoTextEvent(attrs, textEvents, errors, start, end) {
  const offset = getAttrNumber(attrs, "timeoffset");
  const durationRaw = getAttrNumber(attrs, "duration");
  const message = getAttrValue(attrs, "message");

  if (!Number.isFinite(offset) || offset < 0) {
    errors.push({
      start,
      end,
      message: "TextEvent must include a non-negative timeoffset (seconds).",
    });
    return;
  }

  const durationSec = Number.isFinite(durationRaw)
    ? Math.max(1, Math.round(durationRaw))
    : 10;
  const text = message != null ? unescapeXml(String(message)) : "";
  textEvents.push({ offsetSec: Math.round(offset), durationSec, text });
}

function validateZwoDuration(duration, tagName, start, end, errors) {
  if (!Number.isFinite(duration) || duration <= 0) {
    errors.push({
      start,
      end,
      message: `${tagName} must have a positive numeric Duration (seconds).`,
    });
    return false;
  }
  if (duration > ZWO_MAX_SEGMENT_DURATION_SEC) {
    errors.push({
      start,
      end,
      message: `${tagName} Duration is unrealistically large (max ${ZWO_MAX_SEGMENT_DURATION_SEC} seconds).`,
    });
    return false;
  }
  return true;
}

function handleZwoIntervals(attrs, segments, errors, start, end) {
  const repeat = attrs.Repeat != null ? Number(attrs.Repeat) : NaN;
  const onDur = attrs.OnDuration != null ? Number(attrs.OnDuration) : NaN;
  const offDur = attrs.OffDuration != null ? Number(attrs.OffDuration) : NaN;
  const onPow = attrs.OnPower != null ? Number(attrs.OnPower) : NaN;
  const offPow = attrs.OffPower != null ? Number(attrs.OffPower) : NaN;
  const onCad = getAttrNumber(attrs, "Cadence");
  const offCad = getAttrNumber(attrs, "CadenceResting");

  if (!Number.isFinite(repeat) || repeat <= 0 || repeat > ZWO_MAX_INTERVAL_REPEATS) {
    errors.push({
      start,
      end,
      message: `IntervalsT must have Repeat as a positive integer (max ${ZWO_MAX_INTERVAL_REPEATS}).`,
    });
    return;
  }

  if (!validateZwoDuration(onDur, "IntervalsT OnDuration", start, end, errors)) return;
  if (!validateZwoDuration(offDur, "IntervalsT OffDuration", start, end, errors)) return;

  const totalBlockSec = repeat * (onDur + offDur);
  if (!Number.isFinite(totalBlockSec) || totalBlockSec > ZWO_MAX_WORKOUT_DURATION_SEC) {
    errors.push({
      start,
      end,
      message: "IntervalsT total duration is unrealistically large.",
    });
    return;
  }
  if (!Number.isFinite(onPow) || !Number.isFinite(offPow)) {
    errors.push({
      start,
      end,
      message:
        "IntervalsT must have numeric OnPower and OffPower (relative FTP).",
    });
    return;
  }

  const blockSegments = [];

  const reps = Math.round(repeat);
  for (let i = 0; i < reps; i++) {
    const onSeg = {
      durationSec: onDur,
      pStartRel: onPow,
      pEndRel: onPow,
      cadenceRpm: Number.isFinite(onCad) ? onCad : null,
    };
    const offSeg = {
      durationSec: offDur,
      pStartRel: offPow,
      pEndRel: offPow,
      cadenceRpm: Number.isFinite(offCad) ? offCad : null,
    };

    segments.push(onSeg);
    segments.push(offSeg);
    blockSegments.push(onSeg, offSeg);
  }

  return {
    kind: "intervals",
    segments: blockSegments,
    attrs: {
      repeat: reps,
      onDurationSec: onDur,
      offDurationSec: offDur,
      onPowerRel: onPow,
      offPowerRel: offPow,
      onCadenceRpm: Number.isFinite(onCad) ? onCad : null,
      offCadenceRpm: Number.isFinite(offCad) ? offCad : null,
    },
  };
}

// ---------------- Canonical segments -> ZWO body ----------------

/**
 * segments: [minutes, startPower, endPower, type?, cadenceRpm?]
 *
 * @param {Array<[number, number, number, (string?), (number?)]>} segments
 * @param {Array<{offsetSec:number,durationSec:number,text:string}>} [textEvents]
 * @returns {string} ZWO <workout> body lines joined by "\n"
 */
export function segmentsToZwoSnippet(segments, textEvents = []) {
  if (!Array.isArray(segments) || !segments.length) return "";

  const blocks = [];

  // ---------- 1) segments -> normalized blocks ----------
  for (const seg of segments) {
    if (!Array.isArray(seg) || seg.length < 2) continue;

    const minutes = Number(seg[0]);
    let startVal = Number(seg[1]);
    let endVal = seg.length > 2 && seg[2] != null ? Number(seg[2]) : startVal;
    const isFreeRide = seg[3] === FREERIDE_SEGMENT_FLAG;
    const cadence = getRawCadence(seg);

    if (
      !Number.isFinite(minutes) ||
      minutes <= 0 ||
      (!isFreeRide && (!Number.isFinite(startVal) || !Number.isFinite(endVal)))
    ) {
      continue;
    }

    const toRel = (v) => (v <= 5 ? v : v / 100);

    const durationSec = minutes * 60;
    if (isFreeRide) {
      blocks.push({kind: "freeride", durationSec});
      continue;
    }
    const pStartRel = toRel(startVal);
    const pEndRel = toRel(endVal);

    if (durationSec <= 0) continue;

    if (Math.abs(pStartRel - pEndRel) < 1e-6) {
      blocks.push({
        kind: "steady",
        durationSec,
        powerRel: pStartRel,
        cadenceRpm: cadence,
      });
    } else if (pEndRel > pStartRel) {
      blocks.push({
        kind: "rampUp",
        durationSec,
        powerLowRel: pStartRel,
        powerHighRel: pEndRel,
        cadenceRpm: cadence,
      });
    } else {
      blocks.push({
        kind: "rampDown",
        durationSec,
        powerLowRel: pStartRel,
        powerHighRel: pEndRel,
        cadenceRpm: cadence,
      });
    }
  }

  if (!blocks.length) return "";

  // ---------- 2) compress blocks -> ZWO lines ----------
  const lines = [];
  const lineBlocks = [];
  const DUR_TOL = 1;    // seconds
  const PWR_TOL = 0.01; // relative FTP

  let i = 0;
  let cursorSec = 0;

  while (i < blocks.length) {
    // Try to detect repeated steady on/off pairs → IntervalsT
    if (i + 3 < blocks.length) {
      const firstA = blocks[i];
      const firstB = blocks[i + 1];

      if (firstA.kind === "steady" && firstB.kind === "steady") {
        let repeat = 1;
        let j = i + 2;

        while (j + 1 < blocks.length) {
          const nextA = blocks[j];
          const nextB = blocks[j + 1];

          if (
            nextA.kind !== "steady" ||
            nextB.kind !== "steady" ||
            !blocksSimilarSteady(firstA, nextA, DUR_TOL, PWR_TOL) ||
            !blocksSimilarSteady(firstB, nextB, DUR_TOL, PWR_TOL)
          ) break;

          repeat++;
          j += 2;
        }

        if (repeat >= 2) {
          const onDur = Math.round(firstA.durationSec);
          const offDur = Math.round(firstB.durationSec);
          const onPow = firstA.powerRel.toFixed(2);
          const offPow = firstB.powerRel.toFixed(2);
          const onCad = Number.isFinite(firstA.cadenceRpm)
            ? Math.round(firstA.cadenceRpm)
            : null;
          const offCad = Number.isFinite(firstB.cadenceRpm)
            ? Math.round(firstB.cadenceRpm)
            : null;

          const cadenceAttrs =
            (onCad != null ? ` Cadence="${onCad}"` : "") +
            (offCad != null ? ` CadenceResting="${offCad}"` : "");
          lines.push(
            `<IntervalsT Repeat="${repeat}"` +
            ` OnDuration="${onDur}" OffDuration="${offDur}"` +
            ` OnPower="${onPow}" OffPower="${offPow}"${cadenceAttrs} />`
          );
          lineBlocks.push({
            start: cursorSec,
            end: cursorSec + (onDur + offDur) * repeat,
          });
          cursorSec += (onDur + offDur) * repeat;

          i += repeat * 2;
          continue;
        }
      }
    }

    const b = blocks[i];

    if (b.kind === "steady") {
      const cadenceAttr = Number.isFinite(b.cadenceRpm)
        ? ` Cadence="${Math.round(b.cadenceRpm)}"`
        : "";
      const dur = Math.round(b.durationSec);
      lines.push(
        `<SteadyState Duration="${Math.round(
          b.durationSec
        )}" Power="${b.powerRel.toFixed(2)}"${cadenceAttr} />`
      );
      lineBlocks.push({ start: cursorSec, end: cursorSec + dur });
      cursorSec += dur;
    } else if (b.kind === "freeride") {
      const dur = Math.round(b.durationSec);
      lines.push(
        `<FreeRide Duration="${Math.round(b.durationSec)}" />`
      );
      lineBlocks.push({ start: cursorSec, end: cursorSec + dur });
      cursorSec += dur;
    } else if (b.kind === "rampUp") {
      const cadenceAttr = Number.isFinite(b.cadenceRpm)
        ? ` Cadence="${Math.round(b.cadenceRpm)}"`
        : "";
      const dur = Math.round(b.durationSec);
      lines.push(
        `<Warmup Duration="${Math.round(
          b.durationSec
        )}" PowerLow="${b.powerLowRel.toFixed(
          2
        )}" PowerHigh="${b.powerHighRel.toFixed(2)}"${cadenceAttr} />`
      );
      lineBlocks.push({ start: cursorSec, end: cursorSec + dur });
      cursorSec += dur;
    } else if (b.kind === "rampDown") {
      const cadenceAttr = Number.isFinite(b.cadenceRpm)
        ? ` Cadence="${Math.round(b.cadenceRpm)}"`
        : "";
      const dur = Math.round(b.durationSec);
      lines.push(
        `<Cooldown Duration="${Math.round(
          b.durationSec
        )}" PowerLow="${b.powerLowRel.toFixed(
          2
        )}" PowerHigh="${b.powerHighRel.toFixed(2)}"${cadenceAttr} />`
      );
      lineBlocks.push({ start: cursorSec, end: cursorSec + dur });
      cursorSec += dur;
    }

    i++;
  }

  if (Array.isArray(textEvents) && textEvents.length) {
    const withEvents = [];
    const normalizedEvents = textEvents.map((evt) => ({
      offsetSec: Math.max(0, Math.round(Number(evt?.offsetSec) || 0)),
      durationSec: Math.max(1, Math.round(Number(evt?.durationSec) || 10)),
      text: evt?.text || "",
    })).sort((a, b) => a.offsetSec - b.offsetSec);

    lines.forEach((line, idx) => {
      withEvents.push(line);
      const block = lineBlocks[idx];
      if (!block) return;
      const eventsInBlock = normalizedEvents.filter(
        (evt) => evt.offsetSec >= block.start && evt.offsetSec < block.end,
      );
      eventsInBlock.forEach((evt) => {
        const durationAttr =
          evt.durationSec ? ` duration="${evt.durationSec}"` : "";
        withEvents.push(
          `<textevent timeoffset="${evt.offsetSec}"${durationAttr} message="${escapeXml(evt.text)}" />`,
        );
      });
    });

    const totalSec = lineBlocks.length
      ? lineBlocks[lineBlocks.length - 1].end
      : 0;
    const trailing = normalizedEvents.filter((evt) => evt.offsetSec >= totalSec);
    trailing.forEach((evt) => {
      const durationAttr =
        evt.durationSec ? ` duration="${evt.durationSec}"` : "";
      withEvents.push(
        `<textevent timeoffset="${evt.offsetSec}"${durationAttr} message="${escapeXml(evt.text)}" />`,
      );
    });

    return withEvents.join("\n");
  }

  return lines.join("\n");
}

function blocksSimilarSteady(a, b, durTolSec, pwrTol) {
  if (a.kind !== "steady" || b.kind !== "steady") return false;
  const durDiff = Math.abs(a.durationSec - b.durationSec);
  const pDiff = Math.abs(a.powerRel - b.powerRel);
  const cadA = Number.isFinite(a.cadenceRpm) ? Math.round(a.cadenceRpm) : null;
  const cadB = Number.isFinite(b.cadenceRpm) ? Math.round(b.cadenceRpm) : null;
  const cadenceMatch = cadA == null && cadB == null ? true : cadA === cadB;
  return durDiff <= durTolSec && pDiff <= pwrTol && cadenceMatch;
}

function getRawCadence(seg) {
  if (!Array.isArray(seg)) return null;
  if (seg[3] === FREERIDE_SEGMENT_FLAG) return null;
  if (Number.isFinite(seg[4])) return Number(seg[4]);
  if (typeof seg[3] === "number" && Number.isFinite(seg[3])) {
    return Number(seg[3]);
  }
  return null;
}

// ---------------- CanonicalWorkout -> ZWO XML ----------------

/**
 * Build a full ZWO XML file from a CanonicalWorkout.
 *
 * Values from `meta` are used as-is (escaped for XML), without adding
 * default labels or modifying description.
 *
 * @param {CanonicalWorkout} meta
 * @param {Object} [options]
 * @param {string} [options.sportType]  - Zwift sportType (default: "bike")
 * @returns {string} ZWO XML content
 */
export function canonicalWorkoutToZwoXml(meta) {
  const {
    source = "",
    sourceURL = "",
    workoutTitle = "",
    rawSegments = [],
    description = "",
    textEvents = [],
  } = meta || {};

  const name = workoutTitle;
  const author = source;

  const workoutSnippet = segmentsToZwoSnippet(rawSegments, textEvents);

  const descCombined = description;

  const urlTag = sourceURL
    ? `    <tag name="OriginalURL:${escapeXml(sourceURL)}"/>\n`
    : "";

  const indentedBody = workoutSnippet
    ? workoutSnippet
      .split("\n")
      .map((line) => "    " + line)
      .join("\n")
    : "";

  const sportType = "bike";

  return `<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
  <author>${escapeXml(author)}</author>
  <name>${escapeXml(name)}</name>
  <description>${cdataWrap(descCombined)}</description>
  <sportType>${escapeXml(sportType)}</sportType>
  <tags>
${urlTag}  </tags>
  <workout>
${indentedBody}
  </workout>
</workout_file>
`;
}

/**
 * Parse a full ZWO XML file into a CanonicalWorkout.
 *
 * Values are taken directly from XML without injecting defaults or
 * manipulating description contents.
 *
 * @param {string} xmlText
 * @returns {CanonicalWorkout|null}
 */
export function parseZwoXmlToCanonicalWorkout(xmlText) {
  if (!xmlText) return null;

  // Title
  let workoutTitle = "";
  const nameMatch = xmlText.match(/<name>([\s\S]*?)<\/name>/i);
  if (nameMatch) {
    const rawName = nameMatch[1];
    workoutTitle = unescapeXml(cdataUnwrap(rawName));
  }

  // Description (use exactly what's in the tag)
  let description = "";
  const descMatch = xmlText.match(/<description>([\s\S]*?)<\/description>/i);
  if (descMatch) {
    const rawDesc = descMatch[1];
    description = unescapeXml(cdataUnwrap(rawDesc));
  }

  // Original URL tag (if present)
  let sourceURL = "";
  const urlTagMatch = xmlText.match(
    /<tag[^>]*\sname="OriginalURL:([^"]*)"/i
  );
  if (urlTagMatch) {
    sourceURL = unescapeXml(urlTagMatch[1]);
  }

  // Source = author element, or empty if missing
  let source = "";
  const authorMatch = xmlText.match(/<author>([\s\S]*?)<\/author>/i);
  if (authorMatch) {
    source = unescapeXml(authorMatch[1]);
  }

  // Extract <workout> body and parse into canonical rawSegments
  const workoutMatch = xmlText.match(
    /<workout[^>]*>([\s\S]*?)<\/workout>/i
  );
  const workoutInner = workoutMatch ? workoutMatch[1] : "";
  const {rawSegments, textEvents} = parseZwoSnippet(workoutInner);

  /** @type {CanonicalWorkout} */
  return {
    source,
    sourceURL,
    workoutTitle,
    rawSegments,
    description,
    textEvents,
  };
}
