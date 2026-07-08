const { DateTime } = require("luxon");
const { SYSTEM_TIMEZONE } = require("./time");

function toDateTime(input, zone = SYSTEM_TIMEZONE) {
  if (DateTime.isDateTime(input)) return input.setZone(zone);
  return DateTime.fromJSDate(new Date(input), { zone });
}

function getTimeComponentsFromTimestamp(timestamp, zone = SYSTEM_TIMEZONE) {
  const dt = toDateTime(timestamp, zone);
  if (!dt.isValid) {
    return null;
  }

  return {
    hour: dt.hour,
    minute: dt.minute,
  };
}

function getShiftTimeComponents(shift, zone = SYSTEM_TIMEZONE) {
  const startTime = getTimeComponentsFromTimestamp(shift?.timestamps?.start, zone);
  const endTime = getTimeComponentsFromTimestamp(shift?.timestamps?.end, zone);

  if (!startTime || !endTime) {
    return null;
  }

  return { startTime, endTime };
}

function getShiftStartMinutes(shift, zone = SYSTEM_TIMEZONE) {
  const components = getShiftTimeComponents(shift, zone);
  if (!components) return null;
  return components.startTime.hour * 60 + components.startTime.minute;
}

function addDerivedShiftTimeComponents(shift, zone = SYSTEM_TIMEZONE) {
  if (!shift) return shift;
  const components = getShiftTimeComponents(shift, zone);
  if (!components) return { ...shift };

  return {
    ...shift,
    ...components,
  };
}

module.exports = {
  getTimeComponentsFromTimestamp,
  getShiftTimeComponents,
  getShiftStartMinutes,
  addDerivedShiftTimeComponents,
};
