const test = require('node:test');
const assert = require('node:assert/strict');
const { translateTotalsFilter, calendarRange, normalizeTotalsDocument } = require('../utils/totalsSchema');
const { DateTime } = require('luxon');
const { SYSTEM_TIMEZONE } = require('../utils/time');

test('cached plant fields match Luxon across DST and never share mutable dates', () => {
  for (const transition of ['2026-03-08T08:00:00Z', '2026-11-01T07:00:00Z']) {
    for (let offset = -65; offset <= 65; offset++) {
      const create = new Date(Date.parse(transition) + offset * 60000);
      const local = DateTime.fromJSDate(create, { zone: SYSTEM_TIMEZONE });
      const first = normalizeTotalsDocument({ timestamps: { create } });
      first.dateObj.setTime(0);
      const later = normalizeTotalsDocument({ timestamps: { create: new Date(+create + 59999) } });
      assert.equal(later.date, local.toISODate());
      assert.equal(+later.dateObj, local.startOf('day').toMillis());
      assert.equal(later.hour, local.hour);
      assert.equal(later.dateHourStr, local.startOf('hour').toISO({ suppressMilliseconds: true }));
    }
  }
  const legacy = { date: 'legacy', dateObj: new Date(0), hour: 0, dateHourStr: 'original' };
  const normalized = normalizeTotalsDocument({ ...legacy, timestamps: { create: new Date() } });
  for (const key of Object.keys(legacy)) assert.equal(normalized[key], legacy[key]);
});

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
