const test = require('node:test');
const assert = require('node:assert/strict');
const { translateTotalsFilter, calendarRange } = require('../utils/totalsSchema');

for (const field of ['date', 'dateObj']) {
  test(`${field}: empty or entirely invalid date lists produce a valid no-match filter`, () => {
    for (const dates of [[], ['not-a-date'], [null, undefined, 'invalid']]) {
      assert.deepEqual(translateTotalsFilter({ [field]: { $in: dates } }), { 'timestamps.create': { $in: [] } });
    }
  });
  test(`${field}: valid dates keep their plant-day ranges and invalid dates do not widen the filter`, () => {
    const dates = ['2026-01-06', '2026-01-07'];
    assert.deepEqual(translateTotalsFilter({ [field]: { $in: [...dates, 'invalid'] } }), {
      $or: dates.map(date => ({ 'timestamps.create': calendarRange(date) }))
    });
  });
}
test('empty date branches preserve sibling filters and never generate an empty logical operator', () => {
  const query = translateTotalsFilter({ $and: [
    { $or: [{ date: { $in: [] } }, { dateObj: { $in: [] } }] },
    { entityType: 'machine', shiftId: 'shift-1' }
  ] });
  assert.match(JSON.stringify(query), /timestamps.create/);
  assert.doesNotMatch(JSON.stringify(query), /"\$(?:or|and|nor)":\[\]/);
  assert.match(JSON.stringify(query), /shift-1/);
});
