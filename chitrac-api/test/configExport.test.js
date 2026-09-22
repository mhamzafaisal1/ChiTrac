const test = require('node:test');
const assert = require('node:assert/strict');

const {
  configExportFilename,
  exportConfigCollections,
  getConfigCollectionNames,
} = require('../utils/configExport');

const config = {
  machineCollectionName: 'config-machine',
  operatorCollectionName: 'config-operator',
  itemCollectionName: 'config-item',
  faultCollectionName: 'config-fault',
  statusCollectionName: 'config-status',
  userCollectionName: 'config-user',
  shiftCollectionName: 'config-shift',
  maintenanceShiftCollectionName: 'config-shift-maintenance',
  countCollectionName: 'count',
};

function fakeDb() {
  return {
    collection(name) {
      const documents = [{ _id: `${name}-id`, name }];
      const cursor = {
        sort() {
          return cursor;
        },
        project(projection) {
          if (projection?._id === 0) {
            documents.forEach((document) => delete document._id);
          }
          return cursor;
        },
        async toArray() {
          return documents;
        },
      };
      return { find: () => cursor };
    },
  };
}

test('uses only the configured config collection allowlist', () => {
  assert.deepEqual(getConfigCollectionNames(config), [
    'config-machine',
    'config-operator',
    'config-item',
    'config-fault',
    'config-status',
    'config-user',
    'config-shift',
    'config-shift-maintenance',
  ]);
});

test('excludes MongoDB ids by default', async () => {
  const result = await exportConfigCollections(fakeDb(), config);
  assert.equal(result.includeIds, false);
  assert.equal(result.collections['config-machine'][0]._id, undefined);
});

test('includes MongoDB ids when requested', async () => {
  const result = await exportConfigCollections(fakeDb(), config, { includeIds: true });
  assert.equal(result.includeIds, true);
  assert.equal(result.collections['config-machine'][0]._id, 'config-machine-id');
});

test('builds a filesystem-safe timestamped JSON filename', () => {
  assert.equal(
    configExportFilename(new Date('2026-09-22T19:30:45.123Z')),
    'chitrac-config-20260922T193045Z.json'
  );
});
