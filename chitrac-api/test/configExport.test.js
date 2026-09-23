const test = require("node:test");
const assert = require("node:assert/strict");

const {
  configCollectionExportFilename,
  exportConfigCollection,
  exportConfigCollections,
  getConfigCollectionNames,
} = require("../utils/configExport");

const config = {
  machineCollectionName: "config-machine",
  operatorCollectionName: "config-operator",
  itemCollectionName: "config-item",
  faultCollectionName: "config-fault",
  statusCollectionName: "config-status",
  userCollectionName: "config-user",
  shiftCollectionName: "config-shift",
  maintenanceShiftCollectionName: "config-shift-maintenance",
};

function createDb(collections) {
  return {
    collection(name) {
      return {
        find() {
          let excludeIds = false;
          return {
            sort() {
              return this;
            },
            project(projection) {
              excludeIds = projection?._id === 0;
              return this;
            },
            async toArray() {
              return (collections[name] || []).map((document) => {
                if (!excludeIds) return { ...document };
                const { _id, ...withoutId } = document;
                return withoutId;
              });
            },
          };
        },
      };
    },
  };
}

test("lists only configured config collections", () => {
  assert.deepEqual(getConfigCollectionNames({
    ...config,
    systemPreferencesCollectionName: "system-preferences",
  }), Object.values(config));
});

test("exports one allowed collection with optional MongoDB IDs", async () => {
  const db = createDb({
    "config-machine": [{ _id: "machine-object-id", serial: 1001 }],
  });

  assert.deepEqual(
    await exportConfigCollection(db, config, "config-machine"),
    [{ serial: 1001 }]
  );
  assert.deepEqual(
    await exportConfigCollection(db, config, "config-machine", { includeIds: true }),
    [{ _id: "machine-object-id", serial: 1001 }]
  );
});

test("rejects collections outside the configuration allowlist", async () => {
  const db = createDb({});

  await assert.rejects(
    exportConfigCollection(db, config, "config-api-token"),
    (error) => error.code === "INVALID_CONFIG_COLLECTION"
  );
});

test("combined export retains its existing envelope", async () => {
  const db = createDb({
    "config-machine": [{ _id: "machine-object-id", serial: 1001 }],
  });
  const result = await exportConfigCollections(db, config);

  assert.equal(result.includeIds, false);
  assert.deepEqual(result.collections["config-machine"], [{ serial: 1001 }]);
  assert.deepEqual(Object.keys(result.collections), Object.values(config));
});

test("builds a collection-specific timestamped filename", () => {
  assert.equal(
    configCollectionExportFilename("config-machine", new Date("2026-09-23T14:05:06.789Z")),
    "config-machine-20260923T140506Z.json"
  );
});
