# Saved Daily Dashboard layouts

Unlock the Daily Dashboard layout to edit chart order, visibility and the 3×2 or
2×2 grid. Locking still saves the current user's working layout. **Create Layout**
saves a named snapshot to either User or System; **Load Layout** activates a saved
snapshot and makes it the current user's dashboard preference.

User layouts belong to the authenticated account. System layouts are shared, but
creating or loading one never changes another user's selected layout. Named layout
operations use the same level-7 permission rule as production screens. Names must
be unique within their scope and owner, ignoring case and normalized whitespace.
Editing a loaded layout and locking saves the working copy without overwriting the
named definition. Create a new name to keep another snapshot.

## API

All routes are under `/api/preferences` and require authentication:

- `GET /daily-layouts`: list the user's personal layouts and shared System layouts.
- `POST /daily-layouts/user`: create with `{ name, layout }`.
- `POST /daily-layouts/system`: create with `{ name, layout }`.
- `POST /daily-layouts/load`: activate with `{ scope, id }`.

The `layout` contains `gridLayout`, `chartOrder` (chart IDs, including hidden charts),
and `chartVisibility` (boolean flags). Older layouts can omit newly added charts:
the server appends missing charts as hidden without changing the named definition.
Unknown chart IDs and duplicate order entries are rejected. Exactly four charts
must be visible for 2×2 and six for 3×2. Chart-specific comparison and display
switches retain their existing behavior; they are not part of these snapshots.

Definitions live in `dailyDashboardLayouts` on the existing `preferences-user` and
`preferences-system` documents. Selection is stored as `defaultDailyDashboardLayout`
on the user document; the working layout remains at the existing
`dashboardLayouts.experimentalDailyDashboard` key. No migration or database reset
is required. Existing layouts and production-screen preferences are preserved.

Create returns HTTP 409 for duplicate names. If System creation succeeds but
activating it for the creator fails, HTTP 503 includes `createdLayoutRef`; retry
using the load endpoint rather than creating the same definition again.
