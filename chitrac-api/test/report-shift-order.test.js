const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { ObjectId } = require('mongodb');
const config = require('../modules/config');

test('report shifts use plant-local start time, minutes, and deterministic name ties', async () => {
  const shift = (name, start, end = '2026-01-07T18:00:00-06:00', active = true) => ({
    _id: new ObjectId(), name, active, timestamps: { start, end }
  });
  const shifts = [
    shift('Afternoon', '2026-01-07T13:00:00-06:00'),
    shift('Morning Later', '2026-01-07T06:30:00-06:00'),
    shift('Morning Z', '2026-01-07T06:00:00-06:00'),
    shift('Night', '2026-01-07T22:00:00-06:00', '2026-01-08T06:00:00-06:00'),
    shift('Midnight', '2026-01-07T00:00:00-06:00'),
    shift('Morning A', '2026-01-07T06:00:00-06:00'),
    shift('Inactive', '2026-01-07T01:00:00-06:00', undefined, false),
    shift('Unknown', 'invalid')
  ];
  const filename = require.resolve('../controllers/reports');
  const localRequire = createRequire(filename);
  const context = { module: { exports: {} }, console, Date, Map, Set,
    require(name) {
      if (name === './reportSubscription') return () => require('express').Router();
      return localRequire(name);
    }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  const router = context.module.exports({
    logger: { error: assert.fail },
    db: { collection(name) {
      assert.equal(name, config.shiftCollectionName);
      return { find(query) {
        assert.equal(query.active, true);
        return { project() { return this; }, toArray: async () => shifts.filter(s => s.active) };
      } };
    } }
  });
  const handler = router.stack.find(layer => layer.route?.path === '/shifts').route.stack[0].handle;
  let body;
  await handler({}, { json(value) { body = value; } });
  assert.deepEqual(Array.from(body.shifts, s => s.name),
    ['Midnight', 'Morning A', 'Morning Z', 'Morning Later', 'Afternoon', 'Night', 'Unknown']);
  assert.equal(body.shifts[3].startTime.minute, 30);
  assert.equal(body.shifts[5].startTime.hour, 22);
  assert.ok(body.shifts.every(s => typeof s._id === 'string'));
});
