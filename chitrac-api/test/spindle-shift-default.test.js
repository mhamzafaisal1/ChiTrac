const test = require('node:test');
const assert = require('node:assert/strict');
const spindle = require('../controllers/spindle');
const config = require('../modules/config');

test('Spindle overview and details infer shift only when timeframe is omitted', async () => {
  const shiftLookups = [];
  const empty = { project() { return this; }, toArray: async () => [] };
  const db = { collection: name => ({
    find: () => empty,
    findOne: async query => { assert.equal(name, config.shiftCollectionName); shiftLookups.push(query.id); return null; },
  }) };
  const router = spindle({ db, logger: console });
  for (const path of ['/machine/overview', '/operator/overview', '/machine/details', '/operator/details']) {
    const handler = router.stack.find(layer => layer.route.path === path).route.stack[0].handle;
    async function request(query) {
      const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
      await handler({ query }, res);
      return [res.code, res.body];
    }
    shiftLookups.length = 0;
    assert.deepEqual(await request({ shift: '2' }), await request({ timeframe: 'shift', shift: '2' }));
    assert.deepEqual(shiftLookups, [2, 2]);
    assert.deepEqual(await request({ timeframe: 'today', shift: '2' }), await request({}));
    assert.deepEqual(await request({ timeframe: 'custom', shift: '2' }), [400, { error: 'start is required' }]);
    assert.deepEqual(await request({ timeframe: '', shift: '2' }), [400, { error: 'Invalid timeframe' }]);
    assert.deepEqual(await request({ shift: '' }), [400, { error: 'shift is required and must be an integer' }]);
    assert.deepEqual(shiftLookups, [2, 2]);
  }
});
