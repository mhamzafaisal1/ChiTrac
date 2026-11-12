# Standalone configuration initialization

From `chitrac-api`, with its dependencies installed:

```powershell
npm run init:config
```

Or run `node C:\path\to\project\scripts\init-config.js` from any working directory.
Use `npm run init:config -- --help` for usage without connecting to MongoDB.

The script loads `.env` next to the project's `package.json`, regardless of the current directory.
Existing environment variables take precedence. Only `MONGO_CONN_STRING` is required; it must include
the intended database, for example `mongodb://localhost:27017/chitrac`. The script does not require
`MONGO_LOG_CONN_STRING`, JWT or WebSocket secrets, an API process, or a simulator.

It seeds missing or empty `config-machine`, `config-item`, `config-status`, `config-operator`,
`config-shift`, `config-user`, and `config-alarm` collections from the bundled defaults. It also
creates `config-shift-maintenance` empty because there are no bundled maintenance shifts.
Populated collections are skipped, including customized records and independent alarm flags.
MongoDB generates fresh ObjectIds for bundled defaults; numeric IDs and BSON Date timestamps are
preserved through the same conversion used at API startup. Bundled default user accounts are the
same as API startup; their credential fields are never printed by the initializer.

When alarms are missing or empty, existing `config-fault` documents take precedence over bundled
alarm defaults. Their IDs and dates are preserved and `fault: true, stop: true` are added. The
retired fault collection is never created, seeded, edited or deleted by this script.

The script prints the target database and one count/status per collection, closes its connection,
and exits. Failures stop initialization and produce a nonzero exit code. Initialization is not an
all-collections transaction: completed collections remain if a later operation fails. Fix the
reported failure before retrying; populated collections will remain unchanged. Run deployment
initialization once before starting services rather than running multiple seeders simultaneously.
The script contains no reset, drop, overwrite or delete operation.

API startup calls the same `initializeConfigCollections` module using its configured collection
names. Its existing runtime collection and system-preference setup remains outside this module.
API startup supplies an `onError` callback: each collection failure is logged and remaining
collections are still attempted, preserving best-effort startup. Standalone callers omit that
callback, so initialization stops at the first failure and the CLI exits with a nonzero code.
The standalone script creates no runtime/session/count collections, system preferences, migrations
for unrelated records, analytics indexes, web servers, or background jobs.

## Copying to another repository

Copy these files together, preserving their relative paths:

- `scripts/init-config.js`
- `modules/initializeConfigCollections.js`
- `modules/initializeAlarms.js`
- The entire `defaults/` directory, including `index.js`, `utils.js`, and `fault.js`

`defaults/alarm.js` imports `defaults/fault.js` for its bundled definitions; this does not create a
fault collection. The copied code imports no API configuration, logger, schema or entry point.
The receiving project needs `mongodb` and `dotenv`, and can add this npm script:

```json
"init:config": "node scripts/init-config.js"
```

Keep copies synchronized when defaults or initialization behavior change. The server is the source
of truth. The initializer, defaults, and regression tests are available in both `chitrac-server`
and `chitrac-datafeed-api`, with the same `npm run init:config` command. The simulator does not yet
include the script; add it to this list if distribution is extended there. Alpha reset/testing
remains a separate step; this change does not stop services or clear any database.
