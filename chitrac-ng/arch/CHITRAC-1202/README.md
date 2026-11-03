# CHITRAC-1202: archived Angular components

These 127 files were moved from their original paths under `chitrac-ng/`, without
changing their contents. `manifest.json` records each original path and SHA-256.
No existing archive files were overwritten. Archived code is reference material,
not a standalone runnable application; historical relative imports are preserved.
Restore a file to its original path and review its dependencies before reusing it.

## Scope

Retired 11 legacy Production Screen page components (12 route patterns), the old
flipper module and demo service, and other component implementations with no
remaining runtime import path from the app entry point. Associated templates,
styles and tests are kept alongside their source. The older error-modal example
was unused and is archived; `/ng/test` remains active for QA.

All current menu destinations, Home shortcuts, login/reset flows and shared
dependencies remain active. No menus, saved layouts or database records changed.
The existing `arch/date-time-picker` is still used by active pages and was left
alone. Being in `arch` does not prevent bundling if runtime code imports it.

## OEE retained outside this archive

- `src/app/efficiency-screens/efficiency-screen-lane`: shared renderer including OEE.
- `src/app/blanket-blaster/lane-oee`: standalone older OEE column.
- `src/app/blanket-blaster/lane-components/data-bar`: retained OEE dependency.
- `src/app/modules/column/cm-machine-oee`: older machine OEE wrapper.
- `src/app/services/efficiency-screens.service.ts`: station and machine metric APIs.

The older OEE components now import their dependencies directly, without loading
the retired flipper module. They are preserved for future column-library work;
the wrapper now reads machine-level metrics from the current shared service
response. This change does not add OEE to the layout picker. The Production
Screen's 3-8 station constraint is unchanged.

## Old URLs

`src/app/production-screen-legacy.routes.ts` keeps legacy display URLs guarded and
lazy-loads one small migration page linking to the saved Production Screens menu.
There is no reliable mapping from old URLs to deployment-specific saved layout
IDs. A user must choose the layout; the app must not silently display a different
machine set. Existing TVs/bookmarks should be updated to the selected layout URL.
`/ng/production-screen` and `/ng/experimental/spf` still open the current screen.

## Validation

Run `npm run test:production-cleanup` from `chitrac-ng` for menu/legacy-route,
OEE, named-layout, station-range and current Production Screen regressions.
`tsconfig.blanket-screen.spec.json` now exercises retained OEE functionality;
the original page-specific Blanket Blaster tests are archived here.
Production build statistics are compared before/after; the bundle budget is not
increased. Retained heavy feature routes now load separately and warm after
login, with a one-second render delay and permission checks. Home, Settings menu
and the small CRUD screens remain eager. PDF libraries are shared and loaded
only when an export is requested; downloading and emailing await generation.

## Measured result

The production build passes without the previous 3 MB budget warning.
Initial assets fell from 3,964,587 bytes to 1,652,644 bytes
(58.31%). CLI estimated initial transfer fell from
763.33 kB to 329.94 kB (56.77%). Neither jsPDF nor AG Grid is in the initial
module graph. Retained feature code warms in the background after login; an
immediate cold/direct feature visit may still need to load its chunk.

Across all emitted chunks, output fell from 4,726,084 to 4,636,534
bytes. This is primarily a startup-loading improvement, not a comparable
reduction in the total code for all retained features. No file under this new
archive contributes to the output.

Validation passed: 85 cleanup/compatibility/OEE/layout/preloading/PDF tests and
78 existing operations regressions in headless Chrome. Tests cover actual PDF
generation, deferred downloads/email, export failures, login warmup, permissions,
menu destinations and legacy URLs. Archived-file checksums match the manifest;
the navigation menu catalogue is unchanged.

## Archived source folders

- `src/app/blanket-blaster`
- `src/app/blanket-blaster/demo-flipper`
- `src/app/blanket-blaster/lane-fault`
- `src/app/blanket-blaster/lane-running`
- `src/app/blanket-blaster/lane-running-greyed`
- `src/app/blanket-blaster/lane-stop`
- `src/app/blanket-blaster/six-lane-flipper`
- `src/app/charts/daily-machine-item-stacked-bar-chart`
- `src/app/charts/data-aware-item-stacked-chart`
- `src/app/charts/fault-stacked-bar-by machine`
- `src/app/charts/item-stacked-chart`
- `src/app/charts/machine-status-stacked-chart`
- `src/app/charts/plantwide-metrics-chart`
- `src/app/charts/ranked-fault-bar-chart`
- `src/app/charts/ranked-oee-chart`
- `src/app/charts/ranked-operator-bar-chart-with-tooltip`
- `src/app/components/bar-chart`
- `src/app/components/error-modal`
- `src/app/components/multiple-bar-and-line-chart`
- `src/app/components/multiple-bar-chart`
- `src/app/components/multiple-line-chart`
- `src/app/components/pie-chart`
- `src/app/components/stacked-bar-chart`
- `src/app/efficiency-screens`
- `src/app/efficiency-screens/LPLs-efficiency-screen`
- `src/app/efficiency-screens/SPFs-efficiency-screen`
- `src/app/efficiency-screens/blanket-blasterone-efficiency-screen`
- `src/app/efficiency-screens/blanket-blastertwo-efficiency-screen`
- `src/app/efficiency-screens/blanketBlasters-efficiency-screen`
- `src/app/efficiency-screens/efficiecny-screen-machine`
- `src/app/efficiency-screens/eight-station-demo`
- `src/app/efficiency-screens/lpl-efficiency-screen`
- `src/app/efficiency-screens/spf-col-efficiency-screen`
- `src/app/efficiency-screens/spl-col-efficiency-screen`
- `src/app/efficiency-screens/spl-efficiency-screen`
- `src/app/layouts/column/column-layout`
- `src/app/layouts/grid/layout-grid-threebythree`
- `src/app/layouts/grid/layout-grid-twobythree`
- `src/app/layouts/grid/layout-grid-twobytwo`
- `src/app/modules/column/cm-operator-efficiency`
- `src/app/modules/column/cm-operator-efficiency-test`
- `src/app/services`
- `src/app/settings-operators`
- `src/app/use-modal`
