const routeFactory = require('../chitrac-api/controllers/alpha/efficiencyScreenSessionRoute');

function minutesAgo(minutes) {
  return new Date(Date.now() - (minutes * 60 * 1000));
}

function hoursAgo(hours) {
  return new Date(Date.now() - (hours * 60 * 60 * 1000));
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

function getValuesByPath(input, pathParts) {
  const queue = [{ value: input, index: 0 }];
  const results = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current.index >= pathParts.length) {
      results.push(current.value);
      continue;
    }

    const part = pathParts[current.index];
    const value = current.value;

    if (Array.isArray(value)) {
      for (const item of value) {
        queue.push({ value: item, index: current.index });
      }
      continue;
    }

    if (value == null || typeof value !== 'object' || !(part in value)) {
      continue;
    }

    queue.push({ value: value[part], index: current.index + 1 });
  }

  return results;
}

function compareValues(left, right) {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }
  if (left instanceof Date) return left.getTime() - new Date(right).getTime();
  if (right instanceof Date) return new Date(left).getTime() - right.getTime();
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

function matchesOperator(value, operatorObject) {
  const operatorEntries = Object.entries(operatorObject);
  return operatorEntries.every(([operator, expected]) => {
    if (operator === '$gte') return compareValues(value, expected) >= 0;
    if (operator === '$lte') return compareValues(value, expected) <= 0;
    if (operator === '$lt') return compareValues(value, expected) < 0;
    if (operator === '$gt') return compareValues(value, expected) > 0;
    if (operator === '$in') return expected.some(item => compareValues(value, item) === 0);
    if (operator === '$ne') return compareValues(value, expected) !== 0;
    if (operator === '$exists') return expected ? value !== undefined : value === undefined;
    return false;
  });
}

function isOperatorObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) {
    return false;
  }
  return Object.keys(value).some(key => key.startsWith('$'));
}

function matchesQuery(doc, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(clause => matchesQuery(doc, clause));
    if (key === '$and') return value.every(clause => matchesQuery(doc, clause));

    const pathParts = key.split('.');
    const values = getValuesByPath(doc, pathParts);

    if (isOperatorObject(value)) {
      if (value.$exists === false) {
        return values.length === 0;
      }
      return values.some(item => matchesOperator(item, value));
    }

    if (values.length === 0) return false;
    return values.some(item => compareValues(item, value) === 0);
  });
}

function sortDocs(docs, sortSpec) {
  const sortEntries = Object.entries(sortSpec || {});
  if (!sortEntries.length) return [...docs];

  return [...docs].sort((left, right) => {
    for (const [path, direction] of sortEntries) {
      const leftValue = getValuesByPath(left, path.split('.'))[0];
      const rightValue = getValuesByPath(right, path.split('.'))[0];
      const delta = compareValues(leftValue, rightValue);
      if (delta !== 0) return direction >= 0 ? delta : -delta;
    }
    return 0;
  });
}

class FakeCursor {
  constructor(docs, options = {}) {
    this.docs = docs;
    this.options = options;
    this.sortSpec = null;
  }

  project() {
    return this;
  }

  sort(sortSpec) {
    this.sortSpec = sortSpec;
    return this;
  }

  async toArray() {
    const docs = this.sortSpec ? sortDocs(this.docs, this.sortSpec) : [...this.docs];
    return docs.map(doc => JSON.parse(JSON.stringify(doc)));
  }
}

class FakeCollection {
  constructor(name, docs) {
    this.name = name;
    this.docs = docs || [];
  }

  find(query = {}, options = {}) {
    const filtered = this.docs.filter(doc => matchesQuery(doc, query));
    const cursor = new FakeCursor(filtered, options);
    if (options.sort) cursor.sort(options.sort);
    return cursor;
  }

  async findOne(query = {}, options = {}) {
    const filtered = this.docs.filter(doc => matchesQuery(doc, query));
    const sorted = options.sort ? sortDocs(filtered, options.sort) : filtered;
    const first = sorted[0];
    return first ? JSON.parse(JSON.stringify(first)) : null;
  }
}

class FakeDb {
  constructor(collectionMap) {
    this.collectionMap = collectionMap;
  }

  collection(name) {
    if (!this.collectionMap[name]) {
      this.collectionMap[name] = [];
    }
    return new FakeCollection(name, this.collectionMap[name]);
  }
}

function makeOperator(code, name) {
  return { _id: `${code}`, code, name, active: true };
}

function makeTicker(serial, machineName, operators, stations = 3) {
  return {
    _id: `${serial}-ticker`,
    timestamp: new Date(),
    machine: { serial, id: serial, name: machineName, ipAddress: `192.168.0.${serial % 255}` },
    program: {
      mode: 'largePiece',
      programNumber: 1,
      batchNumber: 0,
      accountNumber: 0,
      speed: 101,
      stations
    },
    operators,
    status: { code: 1, name: 'Run', softrolColor: 'Green' }
  };
}

function makeState(serial, machineName, timestamp, statusCode, statusName, operators, stations = 3) {
  return {
    _id: `${serial}-${timestamp.toISOString()}-${statusCode}`,
    timestamp,
    machine: { serial, id: serial, name: machineName, ipAddress: `192.168.0.${serial % 255}` },
    program: {
      mode: 'largePiece',
      items: {},
      programNumber: 1,
      batchNumber: 0,
      accountNumber: 0,
      speed: 101,
      stations
    },
    operators,
    status: { code: statusCode, name: statusName, softrolColor: statusCode === 1 ? 'Green' : 'Red' }
  };
}

function makeCount({ serial, machineName, minutesBack, operatorId, operatorName, station, itemId = 101, standard = 420, misfeed = false }) {
  return {
    _id: `${serial}-${operatorId}-${station}-${minutesBack}-${misfeed ? 'm' : 'v'}`,
    timestamp: minutesAgo(minutesBack),
    machine: { serial, id: serial, name: machineName, ipAddress: `192.168.0.${serial % 255}` },
    program: {
      mode: 'largePiece',
      programNumber: 1,
      batchNumber: 0,
      accountNumber: 0,
      speed: 101,
      stations: 3
    },
    operator: { id: operatorId, name: operatorName },
    item: { id: itemId, name: 'None Entered', standard },
    station,
    lane: 1,
    misfeed
  };
}

function createFixtureData() {
  const todayStart = startOfToday();

  const operatorDocs = [
    makeOperator(135790, 'Lilliana Ashca'),
    makeOperator(135791, 'Jessica Barrera'),
    makeOperator(135801, 'Maribel Guangaje'),
    makeOperator(135816, 'Manuela Villagomez'),
    makeOperator(135817, 'Vernice Villagomez')
  ];

  const stateTicker = [
    makeTicker(90007, 'LPL1', [
      { id: 135790, station: 1 },
      { id: -1, station: 2 },
      { id: 135816, station: 3 },
      { id: -1, station: 4 }
    ]),
    makeTicker(90008, 'LPL2', [
      { id: 135801, station: 1 },
      { id: 135791, station: 2 },
      { id: 135791, station: 3 },
      { id: -1, station: 4 }
    ])
  ];

  const state = [
    makeState(90007, 'LPL1', new Date(todayStart.getTime() - (5 * 60 * 1000)), 1, 'Run', [
      { id: 135790, station: 1 },
      { id: 135816, station: 3 },
      { id: -1, station: 4 }
    ]),
    makeState(90007, 'LPL1', hoursAgo(2), 1, 'Run', [
      { id: 135790, station: 1 },
      { id: 135816, station: 3 },
      { id: -1, station: 4 }
    ]),
    makeState(90007, 'LPL1', minutesAgo(70), 174, 'Feeder Tail Sensor Jam', [
      { id: 135790, station: 1 },
      { id: 135816, station: 3 },
      { id: -1, station: 4 }
    ]),
    makeState(90007, 'LPL1', minutesAgo(45), 1, 'Run', [
      { id: 135790, station: 1 },
      { id: 135816, station: 3 },
      { id: -1, station: 4 }
    ]),
    makeState(90008, 'LPL2', new Date(todayStart.getTime() - (5 * 60 * 1000)), 1, 'Run', [
      { id: 135801, station: 1 },
      { id: 135791, station: 2 },
      { id: 135791, station: 3 },
      { id: -1, station: 4 }
    ]),
    makeState(90008, 'LPL2', hoursAgo(3), 1, 'Run', [
      { id: 135801, station: 1 },
      { id: 135791, station: 2 },
      { id: 135791, station: 3 },
      { id: -1, station: 4 }
    ]),
    makeState(90008, 'LPL2', minutesAgo(80), 174, 'Feeder Tail Sensor Jam', [
      { id: 135801, station: 1 },
      { id: 135791, station: 2 },
      { id: 135791, station: 3 },
      { id: -1, station: 4 }
    ]),
    makeState(90008, 'LPL2', minutesAgo(65), 1, 'Run', [
      { id: 135801, station: 1 },
      { id: 135791, station: 2 },
      { id: 135791, station: 3 },
      { id: -1, station: 4 }
    ])
  ];

  const count = [
    makeCount({ serial: 90007, machineName: 'LPL1', minutesBack: 12, operatorId: 135790, operatorName: 'WRONG NAME', station: 1 }),
    makeCount({ serial: 90007, machineName: 'LPL1', minutesBack: 35, operatorId: 135790, operatorName: 'WRONG NAME', station: 1 }),
    makeCount({ serial: 90007, machineName: 'LPL1', minutesBack: 50, operatorId: 135790, operatorName: 'WRONG NAME', station: 1 }),
    makeCount({ serial: 90007, machineName: 'LPL1', minutesBack: 95, operatorId: 135790, operatorName: 'WRONG NAME', station: 1 }),
    makeCount({ serial: 90007, machineName: 'LPL1', minutesBack: 13, operatorId: 135816, operatorName: 'Outdated Name', station: 3 }),
    makeCount({ serial: 90007, machineName: 'LPL1', minutesBack: 26, operatorId: 135816, operatorName: 'Outdated Name', station: 3 }),
    makeCount({ serial: 90007, machineName: 'LPL1', minutesBack: 26, operatorId: 135816, operatorName: 'Outdated Name', station: 3 }),
    makeCount({ serial: 90007, machineName: 'LPL1', minutesBack: 75, operatorId: 135816, operatorName: 'Outdated Name', station: 3 }),
    makeCount({ serial: 90008, machineName: 'LPL2', minutesBack: 10, operatorId: 135801, operatorName: 'Wrong Maribel', station: 1 }),
    makeCount({ serial: 90008, machineName: 'LPL2', minutesBack: 20, operatorId: 135801, operatorName: 'Wrong Maribel', station: 1 }),
    makeCount({ serial: 90008, machineName: 'LPL2', minutesBack: 50, operatorId: 135801, operatorName: 'Wrong Maribel', station: 1 }),
    makeCount({ serial: 90008, machineName: 'LPL2', minutesBack: 90, operatorId: 135801, operatorName: 'Wrong Maribel', station: 1 }),
    makeCount({ serial: 90008, machineName: 'LPL2', minutesBack: 8, operatorId: 135791, operatorName: 'Wrong Jessica', station: 2 }),
    makeCount({ serial: 90008, machineName: 'LPL2', minutesBack: 38, operatorId: 135791, operatorName: 'Wrong Jessica', station: 2 }),
    makeCount({ serial: 90008, machineName: 'LPL2', minutesBack: 11, operatorId: 135791, operatorName: 'Wrong Jessica', station: 3 }),
    makeCount({ serial: 90008, machineName: 'LPL2', minutesBack: 18, operatorId: 135791, operatorName: 'Wrong Jessica', station: 3 }),
    makeCount({ serial: 90008, machineName: 'LPL2', minutesBack: 55, operatorId: 135791, operatorName: 'Wrong Jessica', station: 3 })
  ];

  return {
    operator: operatorDocs,
    operators: [],
    stateTicker,
    state,
    count,
    machines: [
      { serial: 90007, name: 'LPL1' },
      { serial: 90008, name: 'LPL2' }
    ]
  };
}

async function invokeRoute(router, path, query) {
  const layer = router.stack.find(item => item.route && item.route.path === path);
  if (!layer) {
    throw new Error(`Unable to find route handler for ${path}`);
  }

  const req = {
    method: 'GET',
    originalUrl: path,
    query
  };

  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ statusCode: this.statusCode, payload });
      }
    };

    try {
      layer.route.stack[0].handle(req, res);
    } catch (error) {
      reject(error);
    }
  });
}

function normalizeAndSortLanes(responses) {
  const lanes = [];

  for (const response of responses) {
    const flipperData = response?.payload?.flipperData || [];
    if (flipperData.length > 0) {
      lanes.push(...flipperData);
    }
  }

  return lanes.sort((a, b) => {
    const machineOrderDiff = machineOrderValue(a) - machineOrderValue(b);
    if (machineOrderDiff !== 0) return machineOrderDiff;

    const stationA = Number(a?.station) || 0;
    const stationB = Number(b?.station) || 0;
    if (stationA !== stationB) return stationA - stationB;

    return String(a?.operator || '').localeCompare(String(b?.operator || ''));
  });
}

function machineOrderValue(lane) {
  const machineName = String(lane?.machine || '');
  const lplMatch = machineName.match(/LPL\s*(\d+)/i);
  if (lplMatch) {
    const n = Number(lplMatch[1]);
    if (Number.isFinite(n)) return -n;
  }

  const serial = Number(lane?.machineSerial);
  if (Number.isFinite(serial)) return -serial;
  return Number.MAX_SAFE_INTEGER;
}

function summarizeLane(lane) {
  return {
    machine: lane.machine,
    station: lane.station,
    status: lane.status,
    operator: lane.operator,
    last15: lane.efficiency?.lastFifteenMinutes?.value,
    lastHour: lane.efficiency?.lastHour?.value,
    today: lane.efficiency?.today?.value
  };
}

function runAssertions(sortedLanes) {
  const failures = [];

  const order = sortedLanes.map(lane => `${lane.machine}-S${lane.station}`);
  const expectedOrder = [
    'LPL2-S1',
    'LPL2-S2',
    'LPL2-S3',
    'LPL1-S1',
    'LPL1-S2',
    'LPL1-S3'
  ];
  if (JSON.stringify(order) !== JSON.stringify(expectedOrder)) {
    failures.push(`Unexpected lane order: ${order.join(', ')}`);
  }

  const lpl1Station1 = sortedLanes.find(lane => lane.machine === 'LPL1' && lane.station === 1);
  if (!lpl1Station1 || lpl1Station1.operator !== 'Lilliana Ashca') {
    failures.push('LPL1 station 1 did not resolve the operator name from the operator collection.');
  }

  const lpl1Station2 = sortedLanes.find(lane => lane.machine === 'LPL1' && lane.station === 2);
  if (!lpl1Station2 || lpl1Station2.status !== -1 || lpl1Station2.operator !== null) {
    failures.push('LPL1 station 2 should have been rendered as an offline lane.');
  }

  const lanesThatShouldVary = [
    sortedLanes.find(lane => lane.machine === 'LPL1' && lane.station === 1),
    sortedLanes.find(lane => lane.machine === 'LPL2' && lane.station === 1),
    sortedLanes.find(lane => lane.machine === 'LPL2' && lane.station === 3)
  ].filter(Boolean);

  for (const lane of lanesThatShouldVary) {
    const values = [
      lane.efficiency?.lastFifteenMinutes?.value,
      lane.efficiency?.lastHour?.value,
      lane.efficiency?.today?.value
    ];
    const unique = new Set(values);
    if (unique.size < 2) {
      failures.push(`${lane.machine} station ${lane.station} returned identical Last15/LastHour/All Day values: ${values.join('/')}`);
    }
  }

  return failures;
}

async function main() {
  const collections = createFixtureData();
  const fakeDb = new FakeDb(collections);
  const router = routeFactory({
    db: fakeDb,
    logger: {
      error: (...args) => console.error(...args),
      info: () => {}
    }
  });

  const responses = await Promise.all([
    invokeRoute(router, '/analytics/daily/machine-live-state-summary', { serial: '90007' }),
    invokeRoute(router, '/analytics/daily/machine-live-state-summary', { serial: '90008' })
  ]);

  const sortedLanes = normalizeAndSortLanes(responses);
  const failures = runAssertions(sortedLanes);

  console.log('Raw API payloads:');
  for (const response of responses) {
    console.log(JSON.stringify(response.payload, null, 2));
  }

  console.log('\nFrontend-sorted lane summary:');
  console.table(sortedLanes.map(summarizeLane));

  if (failures.length > 0) {
    console.error('\nFAILURES:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('\nAll checks passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
