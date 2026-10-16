const test = require('node:test');
const assert = require('node:assert/strict');
const { splitTimeRangeForHybridReport } = require('../utils/reportFunctions');

const instant = value => new Date(value);

for (const startDate of ['2026-10-15', '2026-10-14']) {
  test(`includes the final partial day after historical days starting ${startDate}`, () => {
    const end = instant('2026-10-16T14:00:00-05:00');
    const { completeDays, partialDays } = splitTimeRangeForHybridReport(
      instant(`${startDate}T00:00:00-05:00`), end
    );
    assert.deepEqual(completeDays.map(day => day.dateStr), startDate.endsWith('14')
      ? ['2026-10-14', '2026-10-15'] : ['2026-10-15']);
    assert.deepEqual(partialDays, [{
      start: instant('2026-10-16T00:00:00-05:00'), end, type: 'end'
    }]);
  });
}

test('keeps a single partial day in the live-session path', () => {
  const start = instant('2026-10-16T00:00:00-05:00');
  const end = instant('2026-10-16T14:00:00-05:00');
  assert.deepEqual(splitTimeRangeForHybridReport(start, end), {
    completeDays: [], partialDays: [{ start, end, type: 'single' }]
  });
});

test('excludes the final day when the range ends exactly at plant midnight', () => {
  const result = splitTimeRangeForHybridReport(
    instant('2026-10-14T00:00:00-05:00'), instant('2026-10-16T00:00:00-05:00')
  );
  assert.deepEqual(result.completeDays.map(day => day.dateStr), ['2026-10-14', '2026-10-15']);
  assert.deepEqual(result.partialDays, []);
});

test('preserves both partial boundaries around a complete historical day', () => {
  const start = instant('2026-10-14T08:00:00-05:00');
  const end = instant('2026-10-16T14:00:00-05:00');
  const result = splitTimeRangeForHybridReport(start, end);
  assert.deepEqual(result.completeDays.map(day => day.dateStr), ['2026-10-15']);
  assert.deepEqual(result.partialDays, [
    { start, end: instant('2026-10-14T23:59:59.999-05:00'), type: 'start' },
    { start: instant('2026-10-16T00:00:00-05:00'), end, type: 'end' }
  ]);
});

for (const [start, dayStart, end, hours] of [
  ['2026-03-07T00:00:00-06:00', '2026-03-08T00:00:00-06:00', '2026-03-08T10:00:00-05:00', 9],
  ['2026-10-31T00:00:00-05:00', '2026-11-01T00:00:00-05:00', '2026-11-01T10:00:00-06:00', 11],
]) {
  test(`uses plant midnight for the final day across the DST boundary ${dayStart}`, () => {
    const result = splitTimeRangeForHybridReport(instant(start), instant(end));
    assert.equal(result.completeDays.length, 1);
    assert.deepEqual(result.partialDays, [{ start: instant(dayStart), end: instant(end), type: 'end' }]);
    assert.equal((result.partialDays[0].end - result.partialDays[0].start) / 3600000, hours);
  });
}
