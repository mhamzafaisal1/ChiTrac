const assert = require('node:assert/strict');
const test = require('node:test');

const systemPreferencesSchema = require('../schemas/system-preferences');

test('system preference normalization preserves stored dashboard layouts', () => {
  const existing = systemPreferencesSchema.utils.normalizePreferences({
    dashboardLayouts: {
      machineDashboard: {
        summaryCardOrder: ['Runtime', 'Downtime'],
        tableColumnVisibility: { Machine: true, Status: false }
      }
    }
  });

  const updated = systemPreferencesSchema.utils.normalizePreferences(
    { dashboardTimeframe: 'shift' },
    existing
  );

  assert.deepEqual(updated.dashboardLayouts, existing.dashboardLayouts);
});

test('system preference normalization accepts all editable dashboard layouts', () => {
  const preferences = systemPreferencesSchema.utils.normalizePreferences({
    dashboardLayouts: {
      machineDashboard: {
        summaryCardOrder: ['Runtime'],
        summaryCardVisibility: { Runtime: true },
        tableColumnVisibility: { Machine: true },
        tableColumnOrder: ['Machine', 'Status'],
        pphDisplayMode: 'perStation'
      },
      operatorDashboard: {
        summaryCardOrder: ['Efficiency'],
        summaryCardVisibility: { Efficiency: true },
        tableColumnVisibility: { Operator: true },
        tableColumnOrder: ['Operator', 'Status']
      },
      experimentalDailyDashboard: {
        chartOrder: ['machine-status'],
        chartVisibility: { 'machine-status': true }
      }
    }
  });

  assert.equal(preferences.schemaVersion, 2);
  assert.equal(preferences.dashboardLayouts.machineDashboard.pphDisplayMode, 'perStation');
  assert.deepEqual(preferences.dashboardLayouts.operatorDashboard.tableColumnOrder, ['Operator', 'Status']);
  assert.deepEqual(preferences.dashboardLayouts.experimentalDailyDashboard.chartOrder, ['machine-status']);
});

test('system preference normalization rejects malformed dashboard layouts', () => {
  assert.throws(
    () => systemPreferencesSchema.utils.normalizePreferences({
      dashboardLayouts: {
        experimentalDailyDashboard: {
          chartVisibility: { 'machine-status': 'yes' }
        }
      }
    }),
    /Schema validation failed/
  );

  assert.throws(
    () => systemPreferencesSchema.utils.normalizePreferences({
      dashboardLayouts: {
        machineDashboard: {
          tableColumnOrder: ['Status', 42]
        }
      }
    }),
    /Schema validation failed/
  );
});
