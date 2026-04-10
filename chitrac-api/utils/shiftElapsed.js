const { DateTime } = require("luxon");
const { SYSTEM_TIMEZONE } = require("./time");

// In-memory cache for active shifts to reduce MongoDB load per request.
let cachedActiveShifts = null; // Array | null
let cachedActiveShiftsLoadedAt = 0;
const DEFAULT_CACHE_TTL_MS = 30_000;

function toDateTime(input, zone = SYSTEM_TIMEZONE) {
  // Accept Date, ISO strings, or anything that `new Date()` can parse.
  return DateTime.fromJSDate(new Date(input), { zone });
}

function normalizeShift(shift) {
  const startHour = shift?.startTime?.hour;
  const startMinute = shift?.startTime?.minute;
  const endHour = shift?.endTime?.hour;
  const endMinute = shift?.endTime?.minute;
  const activeDays = Array.isArray(shift?.activeDays) ? shift.activeDays : [];

  if (
    typeof startHour !== "number" ||
    typeof startMinute !== "number" ||
    typeof endHour !== "number" ||
    typeof endMinute !== "number" ||
    activeDays.length === 0
  ) {
    return null;
  }

  // Simulator assumption: shifts do not cross midnight.
  const startMin = startHour * 60 + startMinute;
  const endMin = endHour * 60 + endMinute;
  if (endMin <= startMin) return null;

  return {
    startHour,
    startMinute,
    endHour,
    endMinute,
    activeDays,
    startMin,
    breaks: Array.isArray(shift?.breaks) ? shift.breaks : [],
  };
}

function mergeIntervalsMs(intervals) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.startMs <= prev.endMs) {
      prev.endMs = Math.max(prev.endMs, cur.endMs);
    } else {
      merged.push({ startMs: cur.startMs, endMs: cur.endMs });
    }
  }
  return merged;
}

/**
 * Returns the sub-intervals of `interval` that are NOT covered by `breaks`.
 * `breaks` must already be sorted and non-overlapping (i.e. merged).
 * Used to carve break windows out of a shift interval before computing elapsed time.
 * @param {{startMs: number, endMs: number}} interval
 * @param {{startMs: number, endMs: number}[]} breaks - merged, sorted break intervals
 * @returns {{startMs: number, endMs: number}[]}
 */
function subtractBreaksFromInterval(interval, breaks) {
  const result = [];
  let cursor = interval.startMs;
  for (const brk of breaks) {
    if (brk.endMs <= cursor) continue;
    if (brk.startMs >= interval.endMs) break;
    if (brk.startMs > cursor) result.push({ startMs: cursor, endMs: brk.startMs });
    cursor = Math.max(cursor, brk.endMs);
  }
  if (cursor < interval.endMs) result.push({ startMs: cursor, endMs: interval.endMs });
  return result;
}

function subtractIntervalMs(intersection, coveredMerged) {
  // coveredMerged must be merged/non-overlapping.
  let uncoveredMs = 0;
  let cursor = intersection.startMs;
  const endMs = intersection.endMs;

  for (const c of coveredMerged) {
    if (c.endMs <= cursor) continue;
    if (c.startMs >= endMs) break;

    if (c.startMs > cursor) uncoveredMs += c.startMs - cursor;
    cursor = Math.max(cursor, c.endMs);
    if (cursor >= endMs) break;
  }

  if (cursor < endMs) uncoveredMs += endMs - cursor;
  return uncoveredMs;
}

// Computes how much time (ms) between [start, end) is inside the "active shift",
// based on:
// - daily startTime/endTime (no midnight crossing),
// - activeDays (1=Mon..7=Sun),
// - overlap precedence: earliest startTime shift wins for overlapping portions.
function computeShiftElapsedMsFromShifts(shifts, start, end, zone = SYSTEM_TIMEZONE) {
  const startDT = toDateTime(start, zone);
  const endDT = toDateTime(end, zone);

  if (!startDT.isValid || !endDT.isValid) return 0;
  if (endDT <= startDT) return 0;

  // If there are no active shifts, fall back to wall-clock.
  if (!Array.isArray(shifts) || shifts.length === 0) {
    return endDT.toMillis() - startDT.toMillis();
  }

  const normalized = shifts
    .map(normalizeShift)
    .filter(Boolean)
    .sort((a, b) => a.startMin - b.startMin);

  if (normalized.length === 0) {
    return endDT.toMillis() - startDT.toMillis();
  }

  let totalMs = 0;

  let dayCursor = startDT.startOf("day");
  const lastDay = endDT.minus({ milliseconds: 1 }).startOf("day");

  while (dayCursor <= lastDay) {
    const dayIsoWeekday = dayCursor.weekday; // 1=Mon..7=Sun

    const dayStartMs = dayCursor.toMillis();
    const dayEndMs = dayCursor.plus({ days: 1 }).toMillis();
    const rangeStartMs = Math.max(startDT.toMillis(), dayStartMs);
    const rangeEndMs = Math.min(endDT.toMillis(), dayEndMs);
    if (rangeEndMs <= rangeStartMs) {
      dayCursor = dayCursor.plus({ days: 1 });
      continue;
    }

    // `covered` contains time portions within [start,end) already claimed
    // by earlier-start shifts (overlap precedence).
    const covered = [];

    for (const shift of normalized) {
      if (!shift.activeDays.includes(dayIsoWeekday)) continue;

      const shiftStart = dayCursor.set({
        hour: shift.startHour,
        minute: shift.startMinute,
        second: 0,
        millisecond: 0,
      });
      const shiftEnd = dayCursor.set({
        hour: shift.endHour,
        minute: shift.endMinute,
        second: 0,
        millisecond: 0,
      });

      const intersectionStartMs = Math.max(rangeStartMs, shiftStart.toMillis());
      const intersectionEndMs = Math.min(rangeEndMs, shiftEnd.toMillis());
      if (intersectionEndMs <= intersectionStartMs) continue;

      // Carve break windows out of this shift's intersection to get productive sub-intervals.
      const breakIntervals = [];
      for (const brk of shift.breaks) {
        let brkStartMs;
        let brkEndMs;
        const brkSH = brk?.startTime?.hour;
        const brkSM = brk?.startTime?.minute;
        const brkEH = brk?.endTime?.hour;
        const brkEM = brk?.endTime?.minute;
        if (
          typeof brkSH === "number" && typeof brkSM === "number" &&
          typeof brkEH === "number" && typeof brkEM === "number"
        ) {
          const brkStart = dayCursor.set({ hour: brkSH, minute: brkSM, second: 0, millisecond: 0 });
          const brkEnd   = dayCursor.set({ hour: brkEH, minute: brkEM, second: 0, millisecond: 0 });
          brkStartMs = Math.max(intersectionStartMs, brkStart.toMillis());
          brkEndMs   = Math.min(intersectionEndMs,   brkEnd.toMillis());
        } else if (brk?.timestamps?.start && brk?.timestamps?.end) {
          const bs = toDateTime(brk.timestamps.start, zone);
          const be = toDateTime(brk.timestamps.end, zone);
          if (!bs.isValid || !be.isValid) continue;
          brkStartMs = Math.max(intersectionStartMs, bs.toMillis());
          brkEndMs   = Math.min(intersectionEndMs, be.toMillis());
        } else {
          continue;
        }
        if (brkEndMs > brkStartMs) breakIntervals.push({ startMs: brkStartMs, endMs: brkEndMs });
      }
      const mergedBreaks = mergeIntervalsMs(breakIntervals);

      // Active sub-intervals = shift intersection minus break windows.
      const activeSubIntervals = subtractBreaksFromInterval(
        { startMs: intersectionStartMs, endMs: intersectionEndMs },
        mergedBreaks
      );

      // For each productive sub-interval, add the portion not already covered by an earlier shift.
      const coveredMerged = mergeIntervalsMs(covered);
      for (const sub of activeSubIntervals) {
        totalMs += subtractIntervalMs(sub, coveredMerged);
        covered.push(sub);
      }

      // Also mark the full intersection (including break windows) as covered so later
      // shifts don't claim time that this shift's breaks already "own".
      covered.push({ startMs: intersectionStartMs, endMs: intersectionEndMs });
    }

    dayCursor = dayCursor.plus({ days: 1 });
  }

  return Math.max(0, totalMs);
}

/**
 * Inclusive 0–23 local hour indices for the "shift day" on `day` in `zone`:
 * from the earliest shift start through the hour bucket that contains the latest shift end.
 * Hours between separate shifts stay included; only time before the first start or after
 * the last end is trimmed. Returns null if there are no valid shifts for that weekday.
 *
 * @param {unknown[]} shifts - Raw shift docs from Mongo
 * @param {Date|string|number} day - Any instant on the calendar day (interpreted in `zone`)
 * @param {string} [zone=SYSTEM_TIMEZONE]
 * @returns {{ minHour: number, maxHour: number } | null}
 */
function getShiftDayHourEnvelope(shifts, day, zone = SYSTEM_TIMEZONE) {
  const dayDT = toDateTime(day, zone);
  if (!dayDT.isValid) return null;
  const dayIsoWeekday = dayDT.weekday;

  const normalized = (Array.isArray(shifts) ? shifts : [])
    .map(normalizeShift)
    .filter(Boolean)
    .filter((s) => s.activeDays.includes(dayIsoWeekday));

  if (normalized.length === 0) return null;

  let minStartMin = Infinity;
  let maxEndMin = -Infinity;
  for (const s of normalized) {
    minStartMin = Math.min(minStartMin, s.startMin);
    const endMin = s.endHour * 60 + s.endMinute;
    maxEndMin = Math.max(maxEndMin, endMin);
  }

  let minHour = Math.floor(minStartMin / 60);
  let maxHour = Math.ceil(maxEndMin / 60) - 1;
  minHour = Math.min(23, Math.max(0, minHour));
  maxHour = Math.min(23, Math.max(0, maxHour));
  if (maxHour < minHour) return null;
  return { minHour, maxHour };
}

async function loadActiveShifts(
  db,
  { collectionName = "shift", ttlMs = DEFAULT_CACHE_TTL_MS } = {}
) {
  if (!db) throw new Error("loadActiveShifts: db is required");

  const nowMs = Date.now();
  if (cachedActiveShifts && nowMs - cachedActiveShiftsLoadedAt < ttlMs) {
    return cachedActiveShifts;
  }

  const docs = await db.collection(collectionName).find({ active: true }).toArray();
  cachedActiveShifts = docs || [];
  cachedActiveShiftsLoadedAt = nowMs;
  return cachedActiveShifts;
}

module.exports = {
  loadActiveShifts,
  computeShiftElapsedMs: computeShiftElapsedMsFromShifts,
  getShiftDayHourEnvelope,
};

