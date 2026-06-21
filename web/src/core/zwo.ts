// zwo.ts
//
// Canonical workout representation + conversion to/from ZWO, plus inline ZWO
// parsing.
//
// Note the `<= 5 means relative` (`toRel`) handling in segmentsToZwoSnippet.
//
// This file is intentionally standalone (no DOM or fetch dependencies).

import type { CanonicalWorkout, RawSegment, TextEvent } from './model.js';
import {
  FREERIDE_POWER_REL,
  FREERIDE_SEGMENT_FLAG,
  getRawCadence,
} from './segments.js';

// ---------------- Safety limits for ZWO parsing ----------------

const ZWO_MAX_SEGMENT_DURATION_SEC = 12 * 3600; // 12 hours per segment
const ZWO_MAX_WORKOUT_DURATION_SEC = 24 * 3600; // 24 hours total workout
const ZWO_MAX_INTERVAL_REPEATS = 500; // sanity cap on repeats
// ---------------- Internal working types ----------------

interface ZwoError {
  start: number;
  end: number;
  message: string;
}

interface WorkingSegment {
  durationSec: number;
  pStartRel: number;
  pEndRel: number;
  cadenceRpm?: number | null;
  isFreeRide?: boolean;
}

type BlockKind =
  | 'steady'
  | 'warmup'
  | 'cooldown'
  | 'intervals'
  | 'freeride';

interface ParsedBlock {
  kind: BlockKind;
  start: number;
  end: number;
  lineStart: number;
  lineEnd: number;
  segmentStart: number;
  segmentCount: number;
  segments: WorkingSegment[];
  attrs: Record<string, number | null>;
}

interface BlockResult {
  kind: BlockKind;
  segments: WorkingSegment[];
  attrs: Record<string, number | null>;
}

interface PendingTextEvent {
  attrs: Record<string, string>;
  start: number;
  end: number;
}

interface NormalizedTextEvent {
  offsetSec: number;
  durationSec: number;
  text: string;
  start: number;
  end: number;
}

interface BlockEntry {
  index: number;
  start: number;
  end: number;
  block: ParsedBlock;
}

export interface ParseZwoSnippetResult {
  rawSegments: RawSegment[];
  textEvents: TextEvent[];
  errors: ZwoError[];
  blocks: ParsedBlock[];
  sourceText: string;
}

// ---------------- Small helpers ----------------

function escapeXml(text: string | null | undefined): string {
  return (text || '').replace(/[<>&'"]/g, (ch: string) => {
    switch (ch) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      case "'":
        return '&apos;';
      default:
        return ch;
    }
  });
}

function unescapeXml(text: string | null | undefined): string {
  if (!text) return '';
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function cdataWrap(text: string | null | undefined): string {
  if (text == null) return '<![CDATA[]]>';
  const safe = String(text).replace(']]>', ']]&gt;');
  return '<![CDATA[' + safe + ']]>';
}

function cdataUnwrap(text: string | null | undefined): string {
  if (text == null) return '';
  const str = String(text);
  if (str.startsWith('<![CDATA[') && str.endsWith(']]>')) {
    const inner = str.slice(9, -3);
    return inner.replace(']]&gt;', ']]>');
  }
  return str;
}

// ---------------- Inline ZWO snippet parser ----------------

/**
 * Parse a ZWO-style snippet containing SteadyState / Warmup / Cooldown /
 * IntervalsT (etc.) into canonical rawSegments and syntax errors.
 */
export function parseZwoSnippet(text: string): ParseZwoSnippetResult {
  const segments: WorkingSegment[] = [];
  const textEvents: TextEvent[] = [];
  const errors: ZwoError[] = [];
  const blocks: ParsedBlock[] = [];

  const source = String(text || '');
  const withoutWorkoutWrappers = source
    // Preserve string length for position mapping by replacing wrappers with spaces
    .replace(/<\s*workout[^>]*>/gi, (m) => ' '.repeat(m.length))
    .replace(/<\/\s*workout\s*>/gi, (m) => ' '.repeat(m.length));

  let working = withoutWorkoutWrappers;
  if (!working.trim()) {
    return { rawSegments: [], textEvents, errors, blocks, sourceText: working };
  }

  const textEventRegex = /<\s*(textevent|TextEvent)\b([^>]*)\/\s*>/gi;
  const pendingTextEvents: PendingTextEvent[] = [];
  working = working.replace(
    textEventRegex,
    (full: string, _tagName: string, attrsText: string, offset: number) => {
      const startIdx = Number.isFinite(offset) ? offset : 0;
      const endIdx = startIdx + full.length;
      const { attrs, hasGarbage } = parseZwoAttributes(attrsText || '');
      if (hasGarbage) {
        errors.push({
          start: startIdx,
          end: endIdx,
          message:
            'Malformed element: unexpected text or tokens inside element.',
        });
      } else {
        pendingTextEvents.push({ attrs, start: startIdx, end: endIdx });
      }
      return ' '.repeat(full.length);
    },
  );

  const ignoredInlineRegex =
    /<\s*(TextNotification|gameplayevent)\b[^>]*\/\s*>/gi;
  working = working.replace(ignoredInlineRegex, (full) =>
    ' '.repeat(full.length),
  );

  const blockRegex =
    /<\s*(SteadyState|SolidState|Warmup|Cooldown|Ramp|IntervalsT|FreeRide|Freeride|MaxEffort|RestDay)\b([^>]*?)(\/?)\s*>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const lineFromIndex = (idx: number): number => {
    const safeIdx = Math.max(0, Math.min(idx, working.length));
    let line = 0;
    for (let i = 0; i < safeIdx; i += 1) {
      if (working[i] === '\n') line += 1;
    }
    return line;
  };

  while ((match = blockRegex.exec(working)) !== null) {
    const full = match[0] as string;
    const tagName = match[1] as string;
    const attrsText = match[2] || '';
    const selfClosing = (match[3] || '').includes('/');
    const startIdx = match.index;
    let endIdx = startIdx + full.length;
    let blockEndIdx = endIdx;

    const between = working.slice(lastIndex, startIdx);
    if (between.trim().length > 0) {
      errors.push({
        start: lastIndex,
        end: startIdx,
        message:
          'Unexpected text between elements; only ZWO workout elements are allowed.',
      });
    }

    const { attrs, hasGarbage } = parseZwoAttributes(attrsText);

    if (hasGarbage) {
      errors.push({
        start: startIdx,
        end: endIdx,
        message:
          'Malformed element: unexpected text or tokens inside element.',
      });
      lastIndex = endIdx;
      continue;
    }

    if (!selfClosing) {
      const closeRe = new RegExp(`</\\s*${tagName}\\s*>`, 'i');
      const rest = working.slice(endIdx);
      const closeMatch = closeRe.exec(rest);
      if (!closeMatch) {
        errors.push({
          start: startIdx,
          end: endIdx,
          message: `Missing closing tag for <${tagName}>`,
        });
        lastIndex = endIdx;
        continue;
      }
      const closeStart = endIdx + closeMatch.index;
      const closeEnd = closeStart + (closeMatch[0] as string).length;
      const inner = working.slice(endIdx, closeStart);
      if (inner.trim().length > 0) {
        errors.push({
          start: endIdx,
          end: closeStart,
          message:
            'Unexpected text inside element; only <textevent/> tags are allowed.',
        });
      }
      blockEndIdx = closeEnd;
      endIdx = blockEndIdx;
      blockRegex.lastIndex = blockEndIdx;
    }

    const blockSegmentStart = segments.length;
    const blockLineStart = lineFromIndex(startIdx);
    let blockResult: BlockResult | null | undefined = null;

    switch (tagName) {
      case 'SteadyState':
      case 'SolidState':
        blockResult = handleZwoSteady(
          tagName,
          attrs,
          segments,
          errors,
          startIdx,
          endIdx,
        );
        break;
      case 'Warmup':
      case 'Cooldown':
      case 'Ramp':
        blockResult = handleZwoRamp(
          tagName,
          attrs,
          segments,
          errors,
          startIdx,
          endIdx,
        );
        break;
      case 'FreeRide':
      case 'Freeride':
        blockResult = handleZwoFreeRide(
          attrs,
          segments,
          errors,
          startIdx,
          endIdx,
        );
        break;
      case 'MaxEffort':
        blockResult = handleZwoMaxEffort(
          attrs,
          segments,
          errors,
          startIdx,
          endIdx,
        );
        break;
      case 'RestDay':
        blockResult = null;
        break;
      case 'IntervalsT':
        blockResult = handleZwoIntervals(
          attrs,
          segments,
          errors,
          startIdx,
          endIdx,
        );
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
        attrs: { ...blockResult.attrs },
      });
    }

    lastIndex = endIdx;
  }

  const trailing = working.slice(lastIndex);
  if (trailing.trim().length > 0) {
    errors.push({
      start: lastIndex,
      end: lastIndex + trailing.length,
      message: 'Trailing text after last element.',
    });
  }

  if (pendingTextEvents.length) {
    const cleaned = pendingTextEvents
      .map((evt) => normalizePendingTextEvent(evt, errors))
      .filter(Boolean) as NormalizedTextEvent[];
    const blockEntries: BlockEntry[] = blocks.map((block, idx) => ({
      index: idx,
      start: block.start,
      end: block.end,
      block,
    }));
    const evaluations = cleaned.map((evt) =>
      evaluateTextEventOffset(evt, blockEntries),
    );
    const nestedEvaluations = evaluations.filter((res) => res.blockEntry);
    let relativeVotes = 0;
    let absoluteVotes = 0;
    nestedEvaluations.forEach((res) => {
      if (res.classification === 'relative') relativeVotes += 1;
      if (res.classification === 'absolute') absoluteVotes += 1;
    });
    const globalMode = relativeVotes > absoluteVotes ? 'relative' : 'absolute';
    evaluations.forEach((res) => {
      if (!res.blockEntry) {
        textEvents.push({
          offsetSec: Math.round(res.event.offsetSec),
          durationSec: res.event.durationSec,
          text: res.event.text,
        });
        return;
      }
      const resolved = applyTextEventOffset(
        res.event,
        res.blockEntry,
        globalMode,
        blockEntries,
      );
      if (resolved) {
        textEvents.push(resolved);
      }
    });
  }

  const rawSegments: RawSegment[] = segments.map((seg) => {
    if (seg.isFreeRide) {
      return [
        seg.durationSec / 60,
        FREERIDE_POWER_REL * 100,
        FREERIDE_POWER_REL * 100,
        FREERIDE_SEGMENT_FLAG,
      ] as RawSegment;
    }
    const cadence = Number.isFinite(seg.cadenceRpm) ? seg.cadenceRpm : null;
    const base: (number | string | null)[] = [
      seg.durationSec / 60, // minutes
      seg.pStartRel * 100, // startPct
      seg.pEndRel * 100, // endPct
    ];
    if (cadence != null) {
      base.push(null, cadence);
    }
    return base as unknown as RawSegment;
  });

  return { rawSegments, textEvents, errors, blocks, sourceText: working };
}

function parseZwoAttributes(attrText: string): {
  attrs: Record<string, string>;
  hasGarbage: boolean;
} {
  const attrs: Record<string, string> = {};
  let hasGarbage = false;

  const attrRegex = /([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=\s*"([^"]*)"/g;

  let m: RegExpExecArray | null;
  let lastIndex = 0;

  while ((m = attrRegex.exec(attrText)) !== null) {
    if (m.index > lastIndex) {
      const between = attrText.slice(lastIndex, m.index);
      if (between.trim().length > 0) hasGarbage = true;
    }

    attrs[m[1] as string] = m[2] as string;
    lastIndex = attrRegex.lastIndex;
  }

  const trailing = attrText.slice(lastIndex);
  if (trailing.trim().length > 0) hasGarbage = true;

  return { attrs, hasGarbage };
}

function getAttrValue(
  attrs: Record<string, string> | null | undefined,
  name: string,
): string | null {
  if (!attrs || !name) return null;
  if (name in attrs) return attrs[name] as string;
  const target = name.toLowerCase();
  for (const key of Object.keys(attrs)) {
    if (key.toLowerCase() === target) return attrs[key] as string;
  }
  return null;
}

function getAttrNumber(
  attrs: Record<string, string> | null | undefined,
  name: string,
): number {
  const raw = getAttrValue(attrs, name);
  return raw != null ? Number(raw) : NaN;
}

function getFirstNumber(
  attrs: Record<string, string> | null | undefined,
  names: string[],
): number {
  for (const name of names) {
    const val = getAttrNumber(attrs, name);
    if (Number.isFinite(val)) return val;
  }
  return NaN;
}

function handleZwoSteady(
  tagName: string,
  attrs: Record<string, string>,
  segments: WorkingSegment[],
  errors: ZwoError[],
  start: number,
  end: number,
): BlockResult | undefined {
  const duration = getAttrNumber(attrs, 'Duration');
  const power = getFirstNumber(attrs, ['Power', 'Target', 'OffPower']);
  const cadence = getFirstNumber(attrs, [
    'Cadence',
    'CadenceLow',
    'CadenceHigh',
  ]);

  if (!validateZwoDuration(duration, tagName, start, end, errors)) return;
  if (!Number.isFinite(power) || power <= 0) {
    errors.push({
      start,
      end,
      message: `${tagName} must have a positive numeric Power (relative FTP, e.g. 0.75).`,
    });
    return;
  }

  const seg: WorkingSegment = {
    durationSec: duration,
    pStartRel: power,
    pEndRel: power,
    cadenceRpm: Number.isFinite(cadence) ? cadence : null,
  };
  segments.push(seg);

  return {
    kind: 'steady',
    segments: [seg],
    attrs: {
      durationSec: duration,
      powerRel: power,
      cadenceRpm: Number.isFinite(cadence) ? cadence : null,
    },
  };
}

function handleZwoRamp(
  tagName: string,
  attrs: Record<string, string>,
  segments: WorkingSegment[],
  errors: ZwoError[],
  start: number,
  end: number,
): BlockResult | undefined {
  const duration = getAttrNumber(attrs, 'Duration');
  const pLow = getAttrNumber(attrs, 'PowerLow');
  const pHigh = getAttrNumber(attrs, 'PowerHigh');
  const cadence = getFirstNumber(attrs, [
    'Cadence',
    'CadenceLow',
    'CadenceHigh',
  ]);

  if (!validateZwoDuration(duration, tagName, start, end, errors)) return;
  if (!Number.isFinite(pLow) || !Number.isFinite(pHigh)) {
    errors.push({
      start,
      end,
      message: `${tagName} must have PowerLow and PowerHigh as numbers (relative FTP).`,
    });
    return;
  }

  const seg: WorkingSegment = {
    durationSec: duration,
    pStartRel: pLow,
    pEndRel: pHigh,
    cadenceRpm: Number.isFinite(cadence) ? cadence : null,
  };

  segments.push(seg);

  const rampKind: BlockKind =
    tagName === 'Warmup'
      ? 'warmup'
      : tagName === 'Cooldown'
        ? 'cooldown'
        : pHigh >= pLow
          ? 'warmup'
          : 'cooldown';
  return {
    kind: rampKind,
    segments: [seg],
    attrs: {
      durationSec: duration,
      powerLowRel: pLow,
      powerHighRel: pHigh,
      cadenceRpm: Number.isFinite(cadence) ? cadence : null,
    },
  };
}

function handleZwoFreeRide(
  attrs: Record<string, string>,
  segments: WorkingSegment[],
  errors: ZwoError[],
  start: number,
  end: number,
): BlockResult | undefined {
  const duration = getAttrNumber(attrs, 'Duration');

  if (!validateZwoDuration(duration, 'FreeRide', start, end, errors)) return;

  const seg: WorkingSegment = {
    durationSec: duration,
    pStartRel: FREERIDE_POWER_REL,
    pEndRel: FREERIDE_POWER_REL,
    isFreeRide: true,
  };

  segments.push(seg);

  return {
    kind: 'freeride',
    segments: [seg],
    attrs: {
      durationSec: duration,
    },
  };
}

function normalizePendingTextEvent(
  evt: PendingTextEvent,
  errors: ZwoError[],
): NormalizedTextEvent | null {
  if (!evt || !evt.attrs) return null;
  const offset = getFirstNumber(evt.attrs, ['timeoffset', 'TimeOffset']);
  const durationRaw = getFirstNumber(evt.attrs, ['duration', 'Duration']);
  const message =
    getAttrValue(evt.attrs, 'message') ??
    getAttrValue(evt.attrs, 'mssage') ??
    getAttrValue(evt.attrs, 'text');
  if (!Number.isFinite(offset) || offset < 0) {
    errors.push({
      start: evt.start,
      end: evt.end,
      message: 'TextEvent must include a non-negative timeoffset (seconds).',
    });
    return null;
  }
  const durationSec = Number.isFinite(durationRaw)
    ? Math.max(1, Math.round(durationRaw))
    : 10;
  const text = message != null ? unescapeXml(String(message)) : '';
  return {
    offsetSec: Math.round(offset),
    durationSec,
    text,
    start: evt.start,
    end: evt.end,
  };
}

interface TextEventEvaluation {
  event: NormalizedTextEvent;
  classification: 'relative' | 'absolute';
  blockEntry?: BlockEntry | null;
}

function evaluateTextEventOffset(
  evt: NormalizedTextEvent,
  blockEntries: BlockEntry[],
): TextEventEvaluation {
  if (!evt) return { event: evt, classification: 'absolute' };
  const parent = blockEntries.find(
    (block) => evt.start >= block.start && evt.end <= block.end,
  );
  if (!parent) {
    return { event: evt, classification: 'absolute', blockEntry: null };
  }
  const { block } = parent;
  const blockDuration = getBlockDurationFromSegments(block);
  const blockStartSec = getBlockStartTimeSec(blockEntries, parent.index);
  const absoluteOffset = evt.offsetSec;
  const absoluteFits =
    absoluteOffset >= blockStartSec &&
    absoluteOffset < blockStartSec + blockDuration;
  const relativeFits = evt.offsetSec < blockDuration;
  let classification: 'relative' | 'absolute' = 'absolute';
  if (relativeFits && !absoluteFits) {
    classification = 'relative';
  } else if (relativeFits && absoluteFits) {
    const absoluteWithin =
      absoluteOffset >= blockStartSec &&
      absoluteOffset < blockStartSec + blockDuration;
    const relativeWithin =
      blockStartSec + evt.offsetSec >= blockStartSec &&
      blockStartSec + evt.offsetSec < blockStartSec + blockDuration;
    if (relativeWithin && !absoluteWithin) {
      classification = 'relative';
    }
  }
  return { event: evt, classification, blockEntry: parent };
}

function applyTextEventOffset(
  evt: NormalizedTextEvent,
  blockEntry: BlockEntry | null | undefined,
  mode: 'relative' | 'absolute',
  blockEntries: BlockEntry[],
): TextEvent | null {
  if (!evt) return null;
  if (mode === 'relative' && blockEntry) {
    const blockStartSec = getBlockStartTimeSec(blockEntries, blockEntry.index);
    const absoluteOffset = blockStartSec + evt.offsetSec;
    return {
      offsetSec: Math.round(absoluteOffset),
      durationSec: evt.durationSec,
      text: evt.text,
    };
  }
  return {
    offsetSec: Math.round(evt.offsetSec),
    durationSec: evt.durationSec,
    text: evt.text,
  };
}

function getBlockDurationFromSegments(block: ParsedBlock): number {
  const segs = Array.isArray(block?.segments) ? block.segments : [];
  return segs.reduce(
    (total, seg) => total + Math.max(1, Math.round(seg?.durationSec || 0)),
    0,
  );
}

function getBlockStartTimeSec(
  blockEntries: BlockEntry[],
  index: number,
): number {
  let total = 0;
  for (let i = 0; i < blockEntries.length && i < index; i += 1) {
    total += getBlockDurationFromSegments((blockEntries[i] as BlockEntry).block);
  }
  return total;
}

function validateZwoDuration(
  duration: number,
  tagName: string,
  start: number,
  end: number,
  errors: ZwoError[],
): boolean {
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

function handleZwoIntervals(
  attrs: Record<string, string>,
  segments: WorkingSegment[],
  errors: ZwoError[],
  start: number,
  end: number,
): BlockResult | undefined {
  const repeat = getAttrNumber(attrs, 'Repeat');
  const onDur = getAttrNumber(attrs, 'OnDuration');
  const offDur = getAttrNumber(attrs, 'OffDuration');
  let onPow = getAttrNumber(attrs, 'OnPower');
  let offPow = getAttrNumber(attrs, 'OffPower');
  if (!Number.isFinite(onPow)) {
    const onHigh = getAttrNumber(attrs, 'PowerOnHigh');
    const onLow = getAttrNumber(attrs, 'PowerOnLow');
    if (Number.isFinite(onHigh) && Number.isFinite(onLow)) {
      onPow = (onHigh + onLow) / 2;
    } else if (Number.isFinite(onHigh)) {
      onPow = onHigh;
    } else if (Number.isFinite(onLow)) {
      onPow = onLow;
    }
  }
  if (!Number.isFinite(offPow)) {
    const offHigh = getAttrNumber(attrs, 'PowerOffHigh');
    const offLow = getAttrNumber(attrs, 'PowerOffLow');
    if (Number.isFinite(offHigh) && Number.isFinite(offLow)) {
      offPow = (offHigh + offLow) / 2;
    } else if (Number.isFinite(offHigh)) {
      offPow = offHigh;
    } else if (Number.isFinite(offLow)) {
      offPow = offLow;
    }
  }
  const onCad = getFirstNumber(attrs, ['Cadence', 'CadenceLow']);
  const offCad = getFirstNumber(attrs, ['CadenceResting', 'CadenceHigh']);

  if (
    !Number.isFinite(repeat) ||
    repeat <= 0 ||
    repeat > ZWO_MAX_INTERVAL_REPEATS
  ) {
    errors.push({
      start,
      end,
      message: `IntervalsT must have Repeat as a positive integer (max ${ZWO_MAX_INTERVAL_REPEATS}).`,
    });
    return;
  }

  if (!validateZwoDuration(onDur, 'IntervalsT OnDuration', start, end, errors))
    return;
  if (!validateZwoDuration(offDur, 'IntervalsT OffDuration', start, end, errors))
    return;

  const totalBlockSec = repeat * (onDur + offDur);
  if (
    !Number.isFinite(totalBlockSec) ||
    totalBlockSec > ZWO_MAX_WORKOUT_DURATION_SEC
  ) {
    errors.push({
      start,
      end,
      message: 'IntervalsT total duration is unrealistically large.',
    });
    return;
  }
  if (!Number.isFinite(onPow) || !Number.isFinite(offPow)) {
    errors.push({
      start,
      end,
      message:
        'IntervalsT must have numeric OnPower and OffPower (relative FTP).',
    });
    return;
  }

  const blockSegments: WorkingSegment[] = [];

  const reps = Math.round(repeat);
  for (let i = 0; i < reps; i++) {
    const onSeg: WorkingSegment = {
      durationSec: onDur,
      pStartRel: onPow,
      pEndRel: onPow,
      cadenceRpm: Number.isFinite(onCad) ? onCad : null,
    };
    const offSeg: WorkingSegment = {
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
    kind: 'intervals',
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

function handleZwoMaxEffort(
  attrs: Record<string, string>,
  segments: WorkingSegment[],
  errors: ZwoError[],
  start: number,
  end: number,
): BlockResult | undefined {
  const duration = getAttrNumber(attrs, 'Duration');
  if (!validateZwoDuration(duration, 'MaxEffort', start, end, errors)) return;
  const seg: WorkingSegment = {
    durationSec: duration,
    pStartRel: FREERIDE_POWER_REL,
    pEndRel: FREERIDE_POWER_REL,
    isFreeRide: true,
  };
  segments.push(seg);
  return {
    kind: 'freeride',
    segments: [seg],
    attrs: {
      durationSec: duration,
    },
  };
}

// ---------------- Canonical segments -> ZWO body ----------------

interface SnippetBlock {
  kind: 'steady' | 'freeride' | 'rampUp' | 'rampDown';
  durationSec: number;
  powerRel?: number;
  powerLowRel?: number;
  powerHighRel?: number;
  cadenceRpm?: number | null;
}

/**
 * segments: [minutes, startPower, endPower, type?, cadenceRpm?]
 *
 * Returns ZWO <workout> body lines joined by "\n".
 */
export function segmentsToZwoSnippet(
  segments: RawSegment[],
  textEvents: TextEvent[] = [],
): string {
  if (!Array.isArray(segments) || !segments.length) return '';

  const blocks: SnippetBlock[] = [];

  // ---------- 1) segments -> normalized blocks ----------
  for (const seg of segments as unknown as unknown[][]) {
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

    const toRel = (v: number): number => (v <= 5 ? v : v / 100);

    const durationSec = minutes * 60;
    if (isFreeRide) {
      blocks.push({ kind: 'freeride', durationSec });
      continue;
    }
    const pStartRel = toRel(startVal);
    const pEndRel = toRel(endVal);

    if (durationSec <= 0) continue;

    if (Math.abs(pStartRel - pEndRel) < 1e-6) {
      blocks.push({
        kind: 'steady',
        durationSec,
        powerRel: pStartRel,
        cadenceRpm: cadence,
      });
    } else if (pEndRel > pStartRel) {
      blocks.push({
        kind: 'rampUp',
        durationSec,
        powerLowRel: pStartRel,
        powerHighRel: pEndRel,
        cadenceRpm: cadence,
      });
    } else {
      blocks.push({
        kind: 'rampDown',
        durationSec,
        powerLowRel: pStartRel,
        powerHighRel: pEndRel,
        cadenceRpm: cadence,
      });
    }
  }

  if (!blocks.length) return '';

  // ---------- 2) compress blocks -> ZWO lines ----------
  const lines: string[] = [];
  const lineBlocks: { start: number; end: number }[] = [];
  const DUR_TOL = 1; // seconds
  const PWR_TOL = 0.01; // relative FTP

  let i = 0;
  let cursorSec = 0;

  while (i < blocks.length) {
    // Try to detect repeated steady on/off pairs → IntervalsT
    if (i + 3 < blocks.length) {
      const firstA = blocks[i] as SnippetBlock;
      const firstB = blocks[i + 1] as SnippetBlock;

      if (firstA.kind === 'steady' && firstB.kind === 'steady') {
        let repeat = 1;
        let j = i + 2;

        while (j + 1 < blocks.length) {
          const nextA = blocks[j] as SnippetBlock;
          const nextB = blocks[j + 1] as SnippetBlock;

          if (
            nextA.kind !== 'steady' ||
            nextB.kind !== 'steady' ||
            !blocksSimilarSteady(firstA, nextA, DUR_TOL, PWR_TOL) ||
            !blocksSimilarSteady(firstB, nextB, DUR_TOL, PWR_TOL)
          )
            break;

          repeat++;
          j += 2;
        }

        if (repeat >= 2) {
          const onDur = Math.round(firstA.durationSec);
          const offDur = Math.round(firstB.durationSec);
          const onPow = (firstA.powerRel as number).toFixed(2);
          const offPow = (firstB.powerRel as number).toFixed(2);
          const onCad = Number.isFinite(firstA.cadenceRpm)
            ? Math.round(firstA.cadenceRpm as number)
            : null;
          const offCad = Number.isFinite(firstB.cadenceRpm)
            ? Math.round(firstB.cadenceRpm as number)
            : null;

          const cadenceAttrs =
            (onCad != null ? ` Cadence="${onCad}"` : '') +
            (offCad != null ? ` CadenceResting="${offCad}"` : '');
          lines.push(
            `<IntervalsT Repeat="${repeat}"` +
              ` OnDuration="${onDur}" OffDuration="${offDur}"` +
              ` OnPower="${onPow}" OffPower="${offPow}"${cadenceAttrs} />`,
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

    const b = blocks[i] as SnippetBlock;

    if (b.kind === 'steady') {
      const cadenceAttr = Number.isFinite(b.cadenceRpm)
        ? ` Cadence="${Math.round(b.cadenceRpm as number)}"`
        : '';
      const dur = Math.round(b.durationSec);
      lines.push(
        `<SteadyState Duration="${Math.round(
          b.durationSec,
        )}" Power="${(b.powerRel as number).toFixed(2)}"${cadenceAttr} />`,
      );
      lineBlocks.push({ start: cursorSec, end: cursorSec + dur });
      cursorSec += dur;
    } else if (b.kind === 'freeride') {
      const dur = Math.round(b.durationSec);
      lines.push(`<FreeRide Duration="${Math.round(b.durationSec)}" />`);
      lineBlocks.push({ start: cursorSec, end: cursorSec + dur });
      cursorSec += dur;
    } else if (b.kind === 'rampUp') {
      const cadenceAttr = Number.isFinite(b.cadenceRpm)
        ? ` Cadence="${Math.round(b.cadenceRpm as number)}"`
        : '';
      const dur = Math.round(b.durationSec);
      lines.push(
        `<Warmup Duration="${Math.round(
          b.durationSec,
        )}" PowerLow="${(b.powerLowRel as number).toFixed(
          2,
        )}" PowerHigh="${(b.powerHighRel as number).toFixed(2)}"${cadenceAttr} />`,
      );
      lineBlocks.push({ start: cursorSec, end: cursorSec + dur });
      cursorSec += dur;
    } else if (b.kind === 'rampDown') {
      const cadenceAttr = Number.isFinite(b.cadenceRpm)
        ? ` Cadence="${Math.round(b.cadenceRpm as number)}"`
        : '';
      const dur = Math.round(b.durationSec);
      lines.push(
        `<Cooldown Duration="${Math.round(
          b.durationSec,
        )}" PowerLow="${(b.powerLowRel as number).toFixed(
          2,
        )}" PowerHigh="${(b.powerHighRel as number).toFixed(2)}"${cadenceAttr} />`,
      );
      lineBlocks.push({ start: cursorSec, end: cursorSec + dur });
      cursorSec += dur;
    }

    i++;
  }

  if (Array.isArray(textEvents) && textEvents.length) {
    const withEvents: string[] = [];
    const normalizedEvents = textEvents
      .map((evt) => ({
        offsetSec: Math.max(0, Math.round(Number(evt?.offsetSec) || 0)),
        durationSec: Math.max(1, Math.round(Number(evt?.durationSec) || 10)),
        text: evt?.text || '',
      }))
      .sort((a, b) => a.offsetSec - b.offsetSec);

    lines.forEach((line, idx) => {
      const block = lineBlocks[idx];
      if (!block) {
        withEvents.push(line);
        return;
      }
      const eventsInBlock = normalizedEvents.filter(
        (evt) => evt.offsetSec >= block.start && evt.offsetSec < block.end,
      );
      if (!eventsInBlock.length) {
        withEvents.push(line);
        return;
      }

      const selfCloseMatch = line.match(/^<([A-Za-z0-9]+)([^>]*)\/>$/);
      if (!selfCloseMatch) {
        withEvents.push(line);
        return;
      }
      const tagName = selfCloseMatch[1];
      const attrs = selfCloseMatch[2] || '';
      withEvents.push(`<${tagName}${attrs}>`);
      eventsInBlock.forEach((evt) => {
        const durationAttr = evt.durationSec
          ? ` duration="${evt.durationSec}"`
          : '';
        withEvents.push(
          `  <textevent timeoffset="${evt.offsetSec}"${durationAttr} message="${escapeXml(
            evt.text,
          )}" />`,
        );
      });
      withEvents.push(`</${tagName}>`);
    });

    const totalSec = lineBlocks.length
      ? (lineBlocks[lineBlocks.length - 1] as { start: number; end: number }).end
      : 0;
    const trailing = normalizedEvents.filter((evt) => evt.offsetSec >= totalSec);
    trailing.forEach((evt) => {
      const durationAttr = evt.durationSec
        ? ` duration="${evt.durationSec}"`
        : '';
      withEvents.push(
        `<textevent timeoffset="${evt.offsetSec}"${durationAttr} message="${escapeXml(
          evt.text,
        )}" />`,
      );
    });

    return withEvents.join('\n');
  }

  return lines.join('\n');
}

function blocksSimilarSteady(
  a: SnippetBlock,
  b: SnippetBlock,
  durTolSec: number,
  pwrTol: number,
): boolean {
  if (a.kind !== 'steady' || b.kind !== 'steady') return false;
  const durDiff = Math.abs(a.durationSec - b.durationSec);
  const pDiff = Math.abs((a.powerRel as number) - (b.powerRel as number));
  const cadA = Number.isFinite(a.cadenceRpm)
    ? Math.round(a.cadenceRpm as number)
    : null;
  const cadB = Number.isFinite(b.cadenceRpm)
    ? Math.round(b.cadenceRpm as number)
    : null;
  const cadenceMatch = cadA == null && cadB == null ? true : cadA === cadB;
  return durDiff <= durTolSec && pDiff <= pwrTol && cadenceMatch;
}

// ---------------- CanonicalWorkout -> ZWO XML ----------------

/**
 * Build a full ZWO XML file from a CanonicalWorkout.
 *
 * Values from `meta` are used as-is (escaped for XML), without adding
 * default labels or modifying description.
 */
export function canonicalWorkoutToZwoXml(
  meta: Partial<CanonicalWorkout> | null | undefined,
): string {
  const {
    source = '',
    sourceURL = '',
    workoutTitle = '',
    rawSegments = [],
    description = '',
    textEvents = [],
  } = meta || {};

  const name = workoutTitle;
  const author = source;

  const workoutSnippet = segmentsToZwoSnippet(rawSegments, textEvents);

  const descCombined = description;

  const urlTag = sourceURL
    ? `    <tag name="OriginalURL:${escapeXml(sourceURL)}"/>\n`
    : '';

  const indentedBody = workoutSnippet
    ? workoutSnippet
        .split('\n')
        .map((line) => '    ' + line)
        .join('\n')
    : '';

  const sportType = 'bike';

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
 */
export function parseZwoXmlToCanonicalWorkout(
  xmlText: string,
): CanonicalWorkout | null {
  if (!xmlText) return null;

  // Title
  let workoutTitle = '';
  const nameMatch = xmlText.match(/<name>([\s\S]*?)<\/name>/i);
  if (nameMatch) {
    const rawName = nameMatch[1];
    workoutTitle = unescapeXml(cdataUnwrap(rawName));
  }

  // Description (use exactly what's in the tag)
  let description = '';
  const descMatch = xmlText.match(/<description>([\s\S]*?)<\/description>/i);
  if (descMatch) {
    const rawDesc = descMatch[1];
    description = unescapeXml(cdataUnwrap(rawDesc));
  }

  // Original URL tag (if present)
  let sourceURL = '';
  const urlTagMatch = xmlText.match(
    /<tag[^>]*\sname="OriginalURL:([^"]*)"/i,
  );
  if (urlTagMatch) {
    sourceURL = unescapeXml(urlTagMatch[1]);
  }

  // Source = author element, or empty if missing
  let source = '';
  const authorMatch = xmlText.match(/<author>([\s\S]*?)<\/author>/i);
  if (authorMatch) {
    source = unescapeXml(authorMatch[1]);
  }

  // Extract <workout> body and parse into canonical rawSegments
  const workoutMatch = xmlText.match(/<workout[^>]*>([\s\S]*?)<\/workout>/i);
  const workoutInner = workoutMatch ? (workoutMatch[1] as string) : '';
  const { rawSegments, textEvents } = parseZwoSnippet(workoutInner);

  return {
    source,
    sourceURL,
    workoutTitle,
    rawSegments,
    description,
    textEvents,
  };
}
