const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeReportLayouts, reportLayoutUpdates } = require('../utils/reportColumnLayouts');

test('normalizes supported reports without hiding any columns', () => {
  for (const id of ['machineReport', 'operatorReport', 'itemReport']) {
    const layout = sanitizeReportLayouts({ [id]: { columnOrder: [' Efficiency ', 'Unknown', 'Efficiency'] } })[id];
    assert.equal(layout.columnOrder[0], 'Efficiency');
    assert.equal(layout.columnOrder.length, 6);
    assert.equal(new Set(layout.columnOrder).size, 6);
  }
});
test('rejects invalid payloads and visibility options', () => {
  for (const input of [null, [], 'bad', { otherReport: {} }, { machineReport: null },
    { itemReport: { columnOrder: 'PPH' } }, { itemReport: { columnOrder: [1] } },
    { itemReport: { columnOrder: [], columnVisibility: {} } },
    { itemReport: { columnOrder: new Array(41).fill('PPH') } }]) {
    assert.throws(() => sanitizeReportLayouts(input), error => error.status === 400);
  }
});
test('uses report-specific dot updates without overwriting other reports or dashboards', () => {
  const layouts = sanitizeReportLayouts({ itemReport: { columnOrder: ['PPH'] } });
  const updates = reportLayoutUpdates(layouts);
  assert.deepEqual(Object.keys(updates), ['reportLayouts.itemReport.columnOrder']);
  assert.equal(updates['reportLayouts.itemReport.columnOrder'][0], 'PPH');
});
