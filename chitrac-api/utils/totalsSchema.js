const { DateTime } = require("luxon");
const { ObjectId } = require("mongodb");
const { SYSTEM_TIMEZONE } = require("./time");

const TOTALS_COLLECTIONS = new Set(["totals-daily", "totals-hourly", "totals-shift"]);

const LEGACY_PATHS = {
  entityType: "type",
  machineSerial: "machine.id",
  machineName: "machine.name",
  operatorId: "operator.id",
  operatorName: "operator.name",
  itemId: "item.id",
  itemName: "item.name",
  itemStandard: "item.standard",
  contributingMachine: "machine",
  runtimeMs: "totals.runtimeMs",
  faultTimeMs: "totals.faultTimeMs",
  workedTimeMs: "totals.workedTimeMs",
  pausedTimeMs: "totals.pausedTimeMs",
  downTimeMs: "totals.downTimeMs",
  offlineTimeMs: "totals.offlineTimeMs",
  breakTimeMs: "totals.breakTimeMs",
  totalFaults: "totals.faults",
  totalCounts: "totals.count",
  totalMisfeeds: "totals.misfeeds",
  totalTimeCreditMs: "totals.timeCreditMs",
};

function isTotalsCollection(name) {
  return TOTALS_COLLECTIONS.has(name);
}

function parsePlantDate(value) {
  if (value instanceof Date) {
    return DateTime.fromJSDate(value, { zone: SYSTEM_TIMEZONE });
  }
  if (typeof value === "string") {
    return DateTime.fromISO(value, { zone: SYSTEM_TIMEZONE });
  }
  return DateTime.invalid("Unsupported totals date");
}

function calendarRange(value, unit = "day") {
  const parsed = parsePlantDate(value);
  if (!parsed.isValid) return null;
  const start = parsed.startOf(unit);
  return {
    $gte: start.toJSDate(),
    $lt: start.plus({ [unit === "hour" ? "hours" : "days"]: 1 }).toJSDate(),
  };
}

function dateCondition(value) {
  if (value && typeof value === "object" && "$in" in value) {
    return {
      $or: value.$in
        .map((entry) => calendarRange(entry))
        .filter(Boolean)
        .map((range) => ({ "timestamps.create": range })),
    };
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const range = {};
    if (value.$gte != null) {
      const parsed = parsePlantDate(value.$gte);
      range.$gte = parsed.isValid ? parsed.startOf("day").toJSDate() : value.$gte;
    } else if (value.$gt != null) {
      const parsed = parsePlantDate(value.$gt);
      range.$gte = parsed.isValid ? parsed.plus({ days: 1 }).startOf("day").toJSDate() : value.$gt;
    }
    if (value.$lt != null) {
      const parsed = parsePlantDate(value.$lt);
      range.$lt = parsed.isValid ? parsed.startOf("day").toJSDate() : value.$lt;
    } else if (value.$lte != null) {
      const parsed = parsePlantDate(value.$lte);
      range.$lt = parsed.isValid ? parsed.plus({ days: 1 }).startOf("day").toJSDate() : value.$lte;
    }
    if (Object.keys(range).length) return { "timestamps.create": range };
  }
  const range = calendarRange(value);
  return range ? { "timestamps.create": range } : { "timestamps.create": value };
}

function hourCondition(value) {
  const range = calendarRange(value, "hour");
  return range ? { "timestamps.create": range } : { "timestamps.create": value };
}

function numericHourCondition(value) {
  const hourExpression = {
    $hour: { date: "$timestamps.create", timezone: SYSTEM_TIMEZONE },
  };
  if (typeof value === "number") {
    return { $expr: { $eq: [hourExpression, value] } };
  }
  if (!value || typeof value !== "object") return { hour: value };
  const expressions = [];
  const operators = {
    $gte: "$gte",
    $gt: "$gt",
    $lte: "$lte",
    $lt: "$lt",
    $eq: "$eq",
  };
  for (const [operator, mongoOperator] of Object.entries(operators)) {
    if (value[operator] != null) {
      expressions.push({ [mongoOperator]: [hourExpression, value[operator]] });
    }
  }
  if (Array.isArray(value.$in)) {
    expressions.push({ $in: [hourExpression, value.$in] });
  }
  if (!expressions.length) return { hour: value };
  return {
    $expr: expressions.length === 1 ? expressions[0] : { $and: expressions },
  };
}

function shiftCondition(value) {
  const values = value && typeof value === "object" && "$in" in value ? value.$in : [value];
  const candidates = [];
  for (const entry of values) {
    candidates.push(entry, String(entry));
    if (ObjectId.isValid(String(entry))) candidates.push(new ObjectId(String(entry)));
  }
  const unique = [...new Map(candidates.map((entry) => [`${entry?.constructor?.name}:${String(entry)}`, entry])).values()];
  const operand = unique.length === 1 ? unique[0] : { $in: unique };
  return { $or: [{ "shift.id": operand }, { "shift._id": operand }] };
}

function combineConditions(conditions) {
  const usable = conditions.filter((condition) => condition && Object.keys(condition).length);
  if (usable.length === 0) return {};
  if (usable.length === 1) return usable[0];
  return { $and: usable };
}

function translateTotalsFilter(filter) {
  if (
    !filter ||
    typeof filter !== "object" ||
    filter instanceof Date ||
    filter instanceof ObjectId ||
    filter instanceof RegExp ||
    Buffer.isBuffer(filter)
  ) {
    return filter;
  }
  if (Array.isArray(filter)) return filter.map(translateTotalsFilter);

  const conditions = [];
  const regular = {};
  for (const [key, value] of Object.entries(filter)) {
    if (key === "date" || key === "dateObj") {
      conditions.push(dateCondition(value));
    } else if (key === "dateHourStr") {
      conditions.push(hourCondition(value));
    } else if (key === "hour") {
      conditions.push(numericHourCondition(value));
    } else if (key === "shiftId") {
      conditions.push(shiftCondition(value));
    } else if (key === "$and" || key === "$or" || key === "$nor") {
      regular[key] = value.map(translateTotalsFilter);
    } else if (key.startsWith("$")) {
      regular[key] = translateTotalsFilter(value);
    } else {
      regular[LEGACY_PATHS[key] || key] = translateTotalsFilter(value);
    }
  }
  if (Object.keys(regular).length) conditions.unshift(regular);
  return combineConditions(conditions);
}

function translateTotalsPath(path) {
  if (path === "date" || path === "dateObj" || path === "dateHourStr") {
    return "timestamps.create";
  }
  if (path === "shiftId") return "shift.id";
  return LEGACY_PATHS[path] || path;
}

function translateTotalsProjection(projection) {
  if (!projection || typeof projection !== "object") return projection;
  const translated = Object.fromEntries(
    Object.entries(projection).map(([path, value]) => [translateTotalsPath(path), value])
  );
  const isInclusion = Object.entries(translated).some(
    ([path, value]) => path !== "_id" && (value === 1 || value === true)
  );
  if (isInclusion) translated.type = 1;
  return translated;
}

function translateTotalsSort(sort) {
  if (!sort || typeof sort !== "object" || Array.isArray(sort)) return sort;
  return Object.fromEntries(
    Object.entries(sort).map(([path, direction]) => [translateTotalsPath(path), direction])
  );
}

function legacyAliasStage() {
  return {
    $set: {
      entityType: "$type",
      machineSerial: "$machine.id",
      machineName: "$machine.name",
      operatorId: "$operator.id",
      operatorName: "$operator.name",
      itemId: "$item.id",
      itemName: "$item.name",
      itemStandard: "$item.standard",
      contributingMachine: "$machine",
      shiftId: { $ifNull: ["$shift.id", "$shift._id"] },
      runtimeMs: "$totals.runtimeMs",
      faultTimeMs: "$totals.faultTimeMs",
      workedTimeMs: "$totals.workedTimeMs",
      pausedTimeMs: "$totals.pausedTimeMs",
      downTimeMs: "$totals.downTimeMs",
      offlineTimeMs: "$totals.offlineTimeMs",
      breakTimeMs: "$totals.breakTimeMs",
      totalFaults: "$totals.faults",
      totalCounts: "$totals.count",
      totalMisfeeds: "$totals.misfeeds",
      totalTimeCreditMs: "$totals.timeCreditMs",
      dateObj: {
        $dateTrunc: { date: "$timestamps.create", unit: "day", timezone: SYSTEM_TIMEZONE },
      },
      date: {
        $dateToString: {
          date: "$timestamps.create",
          format: "%Y-%m-%d",
          timezone: SYSTEM_TIMEZONE,
        },
      },
      dateHourStr: {
        $dateToString: {
          date: "$timestamps.create",
          format: "%Y-%m-%dT%H:00:00",
          timezone: SYSTEM_TIMEZONE,
        },
      },
      hour: {
        $hour: { date: "$timestamps.create", timezone: SYSTEM_TIMEZONE },
      },
      lastUpdated: "$timestamps.update",
      timeRange: { start: "$timestamps.start", end: "$timestamps.end" },
    },
  };
}

function normalizeTotalsDocument(document) {
  if (!document || typeof document !== "object") return document;
  if (!document.type && !document.timestamps && !document.totals) return document;
  const result = { ...document };
  const created = document.timestamps?.create;
  const plantDate = created ? DateTime.fromJSDate(new Date(created), { zone: SYSTEM_TIMEZONE }) : null;
  const totals = document.totals || {};

  result.entityType ??= document.type;
  result.machineSerial ??= document.machine?.id;
  result.machineName ??= document.machine?.name;
  result.operatorId ??= document.operator?.id;
  result.operatorName ??= document.operator?.name;
  result.itemId ??= document.item?.id;
  result.itemName ??= document.item?.name;
  result.itemStandard ??= document.item?.standard;
  result.contributingMachine ??= document.machine;
  result.shiftId ??= document.shift?.id ?? document.shift?._id;
  result.runtimeMs ??= totals.runtimeMs;
  result.faultTimeMs ??= totals.faultTimeMs;
  result.workedTimeMs ??= totals.workedTimeMs;
  result.pausedTimeMs ??= totals.pausedTimeMs;
  result.downTimeMs ??= totals.downTimeMs;
  result.offlineTimeMs ??= totals.offlineTimeMs;
  result.breakTimeMs ??= totals.breakTimeMs;
  result.totalFaults ??= totals.faults;
  result.totalCounts ??= totals.count;
  result.totalMisfeeds ??= totals.misfeeds;
  result.totalTimeCreditMs ??= totals.timeCreditMs;
  result.lastUpdated ??= document.timestamps?.update;
  if (document.timestamps?.start || document.timestamps?.end) {
    result.timeRange ??= {
      start: document.timestamps?.start,
      end: document.timestamps?.end,
    };
  }
  if (plantDate?.isValid) {
    result.date ??= plantDate.toISODate();
    result.dateObj ??= plantDate.startOf("day").toJSDate();
    result.dateHourStr ??= plantDate.startOf("hour").toISO({ suppressMilliseconds: true });
    result.hour ??= plantDate.hour;
  }
  return result;
}

function compactObject(value) {
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null)
  );
}

function toNewTotalsDocument(document) {
  if (!document || typeof document !== "object") return document;
  if (document.type && document.timestamps && document.totals) {
    const { _id, ...withoutMongoId } = document;
    return withoutMongoId;
  }

  const create = document.timestamps?.create || document.dateObj ||
    calendarRange(document.date)?.$gte || document.timeRange?.start || new Date();
  const update = document.timestamps?.update || document.lastUpdated || new Date();
  const start = document.timestamps?.start || document.timeRange?.start || create;
  const end = document.timestamps?.end || document.timeRange?.end ||
    DateTime.fromJSDate(new Date(start), { zone: SYSTEM_TIMEZONE }).plus({ days: 1 }).toJSDate();

  const machine = document.machine || document.contributingMachine ||
    compactObject({ id: document.machineSerial, name: document.machineName });
  const operator = document.operator ||
    compactObject({ id: document.operatorId, name: document.operatorName });
  const item = document.item ||
    compactObject({
      id: document.itemId,
      name: document.itemName,
      standard: document.itemStandard,
    });

  const result = {
    id: document.id || (typeof document._id === "string" ? document._id : undefined),
    type: document.type || document.entityType,
    timestamps: {
      create: new Date(create),
      active: new Date(document.timestamps?.active || update),
      update: new Date(update),
      start: new Date(start),
      end: new Date(end),
    },
    totals: {
      runtimeMs: document.totals?.runtimeMs ?? document.runtimeMs ?? 0,
      faultTimeMs: document.totals?.faultTimeMs ?? document.faultTimeMs ?? 0,
      workedTimeMs: document.totals?.workedTimeMs ?? document.workedTimeMs ?? 0,
      pausedTimeMs: document.totals?.pausedTimeMs ?? document.pausedTimeMs ?? 0,
      downTimeMs: document.totals?.downTimeMs ?? document.downTimeMs ?? 0,
      offlineTimeMs: document.totals?.offlineTimeMs ?? document.offlineTimeMs ?? 0,
      breakTimeMs: document.totals?.breakTimeMs ?? document.breakTimeMs ?? 0,
      faults: document.totals?.faults ?? document.totalFaults ?? 0,
      count: document.totals?.count ?? document.totalCounts ?? 0,
      misfeeds: document.totals?.misfeeds ?? document.totalMisfeeds ?? 0,
      timeCreditMs: document.totals?.timeCreditMs ?? document.totalTimeCreditMs ?? 0,
    },
    source: document.source,
  };

  if (machine && Object.keys(machine).length) result.machine = machine;
  if (operator && Object.keys(operator).length) result.operator = operator;
  if (item && Object.keys(item).length) result.item = item;
  if (document.shift) result.shift = document.shift;
  return compactObject(result);
}

module.exports = {
  TOTALS_COLLECTIONS,
  LEGACY_PATHS,
  isTotalsCollection,
  calendarRange,
  translateTotalsFilter,
  translateTotalsPath,
  translateTotalsProjection,
  translateTotalsSort,
  legacyAliasStage,
  normalizeTotalsDocument,
  toNewTotalsDocument,
};
