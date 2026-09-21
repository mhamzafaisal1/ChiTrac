const test = require('node:test');
const assert = require('node:assert/strict');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const machineSchema = require('../schemas/machine');

const ajv = new Ajv({ strictSchema: false });
addFormats(ajv);
const validate = ajv.compile(machineSchema.schema);

function machine(overrides = {}) {
  const now = new Date();
  return {
    id: 1,
    active: true,
    name: 'Test Machine',
    timestamps: { create: now, active: now, update: now },
    ipAddress: {
      firstOctet: 127,
      secondOctet: 0,
      thirdOctet: 0,
      fourthOctet: 1
    },
    lanes: [1],
    stations: [1],
    type: 'Test',
    polled: false,
    ...overrides
  };
}

test('accepts one lane and one station with false boolean settings', () => {
  assert.equal(validate(machine({ active: false, polled: false })), true);
});

test('accepts independent lane and station counts up to eight', () => {
  assert.equal(validate(machine({ lanes: [1], stations: [1, 2, 3, 4, 5, 6, 7, 8] })), true);
  assert.equal(validate(machine({ lanes: [1, 2, 3, 4, 5, 6, 7, 8], stations: [1] })), true);
});

test('rejects missing or empty lane and station arrays', () => {
  assert.equal(validate(machine({ lanes: [] })), false);
  assert.equal(validate(machine({ stations: [] })), false);

  const withoutStations = machine();
  delete withoutStations.stations;
  assert.equal(validate(withoutStations), false);
});

test('rejects more than eight lanes or stations', () => {
  const nineAddresses = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  assert.equal(validate(machine({ lanes: nineAddresses })), false);
  assert.equal(validate(machine({ stations: nineAddresses })), false);
});
