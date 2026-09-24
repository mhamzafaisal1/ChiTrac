const assert = require('node:assert/strict');
const test = require('node:test');
const { ObjectId } = require('mongodb');

const createMachineValidator = require('../middleware/machineValidator');

function validMachine(overrides = {}) {
  return {
    id: 90008,
    active: true,
    name: 'LPL2',
    timestamps: {
      create: '2026-07-09T15:56:12.081Z',
      active: '2026-07-09T15:56:12.081Z',
      update: '2026-07-09T15:56:12.081Z'
    },
    ipAddress: {
      firstOctet: 192,
      secondOctet: 168,
      thirdOctet: 0,
      fourthOctet: 8
    },
    lanes: [1],
    stations: [1, 2, 3],
    type: 'LPL',
    polled: false,
    simulated: false,
    ...overrides
  };
}

function responseStub() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

function serverStub(existingMachine = null) {
  return {
    logger: {
      debug() {},
      warn() {}
    },
    db: {
      collection() {
        return {
          async findOne() {
            return existingMachine;
          }
        };
      }
    }
  };
}

test('machine update ignores serialized client timestamps and validates address arrays', async () => {
  const timestamps = {
    create: new Date('2026-07-09T15:56:12.081Z'),
    active: new Date('2026-07-09T15:56:12.081Z'),
    update: new Date('2026-07-09T15:56:12.081Z')
  };
  const req = {
    method: 'PUT',
    url: '/machine/config/example',
    params: { id: new ObjectId().toHexString() },
    body: validMachine()
  };
  const res = responseStub();
  let nextCalled = false;

  await createMachineValidator(serverStub({ timestamps }))(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(req.body.timestamps, timestamps);
  assert.deepEqual(req.body.lanes, [1]);
  assert.deepEqual(req.body.stations, [1, 2, 3]);
});

test('machine creation always generates server timestamps', async () => {
  const req = {
    method: 'POST',
    url: '/machine/config',
    params: {},
    body: validMachine()
  };
  const res = responseStub();
  let nextCalled = false;

  await createMachineValidator(serverStub())(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(req.body.timestamps.create instanceof Date, true);
  assert.equal(req.body.timestamps.active instanceof Date, true);
  assert.equal(req.body.timestamps.update instanceof Date, true);
});
