const { computeShiftElapsedMs } = require("./shiftElapsed");
const { SYSTEM_TIMEZONE } = require("./time");

/** Productive ms in [rangeStart, rangeEnd) per active shifts (breaks excluded); wall-clock if no shifts. */
function getLiveProductiveWindowMs(shifts, rangeStart, rangeEnd) {
  return computeShiftElapsedMs(shifts, rangeStart, rangeEnd, SYSTEM_TIMEZONE);
}

function liveAvailabilityRatioFromRuntimeSec(runtimeSec, productiveSec) {
  if (productiveSec <= 0) return 0;
  return Math.min(Math.max(runtimeSec / productiveSec, 0), 1);
}

function liveAvailabilityRatioFromMs(runtimeMs, productiveMs) {
  if (productiveMs <= 0) return 0;
  return Math.min(Math.max(runtimeMs / productiveMs, 0), 1);
}

function liveDowntimeMs(runtimeMs, productiveMs) {
  return Math.max(0, productiveMs - runtimeMs);
}

module.exports = {
  getLiveProductiveWindowMs,
  liveAvailabilityRatioFromRuntimeSec,
  liveAvailabilityRatioFromMs,
  liveDowntimeMs,
};
