const test = require('node:test');
const assert = require('node:assert/strict');
const { SPF_STATION_IDS, sanitizeSpfLayout } = require('../utils/spfLayout');
const schema = require('../schemas/system-preferences');
const valid = () => ({ stationOrder: [...SPF_STATION_IDS].reverse(), stationVisibility: Object.fromEntries(SPF_STATION_IDS.map(id => [id, true])) });

test('SPF layout accepts exactly the six station identities with three through six selected', () => {
  for (let count = 3; count <= 6; count++) {
    const input = valid(); input.stationVisibility = Object.fromEntries(SPF_STATION_IDS.map((id,i) => [id, i < count]));
    const output = sanitizeSpfLayout(input);
    assert.deepEqual(output, input); assert.notEqual(output.stationOrder, input.stationOrder);
  }
});
test('SPF layout rejects invalid selections, duplicate identities, unknown stations and malformed values', () => {
  const allHidden = Object.fromEntries(SPF_STATION_IDS.map(id => [id, false]));
  for (const input of [null, [], {}, { ...valid(), stationOrder: ['90001'] },
    { ...valid(), stationOrder: ['90001','90001','90003','90004','90005','90006'] },
    { ...valid(), stationOrder: ['90001','90002','90003','90004','90005','other'] },
    { ...valid(), stationVisibility: { ...allHidden, '90001': true, '90002': true } },
    { ...valid(), stationVisibility: { '90001': 'false' } },
    { ...valid(), stationVisibility: { other: true } }, { ...valid(), stationVisibility: [] },
    { ...valid(), extra: true }]) assert.throws(() => sanitizeSpfLayout(input), error => error.status === 400);
});
test('SPF system/default normalization preserves valid layouts and rejects fewer than three', () => {
  const layout = valid();
  assert.deepEqual(schema.utils.normalizePreferences({ dashboardLayouts: { experimentalSpf: layout } }).dashboardLayouts.experimentalSpf, layout);
  layout.stationVisibility = Object.fromEntries(SPF_STATION_IDS.map(id => [id,false]));
  assert.throws(() => schema.utils.normalizePreferences({ dashboardLayouts: { experimentalSpf: layout } }), error => error.status === 400);
});
