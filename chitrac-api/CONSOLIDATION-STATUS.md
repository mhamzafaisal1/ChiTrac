# Alpha Controllers → Utils Consolidation Status

Assessment of what has been done and what remains for the 7 target alpha files.

---

## Summary

| File | Status | Notes |
|------|--------|--------|
| **operatorRoutes.js** | Done | Dead code (8 functions, ~543 lines) removed; unused imports cleaned. No `operatorFunctions` import needed for remaining routes. |
| **itemSessions.js** | Done | Imports from `utils/itemFunctions.js`; local duplicates removed. |
| **operatorSessions.js** | Done | Imports from `utils/operatorFunctions.js`; local helpers removed. Still has local `parseAndValidateQueryParams` (duplicate of `utils/time`) — optional cleanup. |
| **efficiencyScreenSessionRoute.js** | Done | Imports from `utils/sessionFunctions.js`; local helpers removed. |
| **dailyDashboardSessionRoutesSplit.js** | Done | Imports from `utils/dashboardFunctions.js`; uses buildDailyMachineStatusFromSessions, buildMachineOEEFromDailyTotals, etc. |
| **machineSessions.js** | Done | Imports from `utils/machineFunctions.js`; local helpers removed. Still has local `parseAndValidateQueryParams` (duplicate of `utils/time`) — optional cleanup. |
| **reportsSessionRoutes.js** | Done | Imports from `utils/reportFunctions.js`; local duplicate definitions (queryItemDailyCache, queryItemSessions, combineItemData, splitTimeRangeForHybridReport, getCachedDataForDays, getSessionDataForPartialDays, combineHybridData, getOperatorCachedDataForDays, getOperatorSessionDataForPartialDays, combineOperatorHybridData) have been removed. Routes use the imported functions with `db` passed as first argument where required. |

---

## What’s Done

- **operatorRoutes.js** (~294 lines): Only active route is `daily-dashboard/operator-efficiency-top10`. Uses `time`, `dailyDashboardBuilder`, `operatorDashboardBuilder`, `fetchData`, `bookendingBuilder`. Dead code and unused imports removed.
- **itemSessions.js** (~566 lines): Requires `itemFunctions`; routes use `splitTimeRangeForHybridItems`, `getItemsCachedDataForDays`, `getItemsSessionDataForPartialDays`, `combineItemsHybridData`.
- **operatorSessions.js** (~1,370 lines): Requires `operatorFunctions`; uses `buildHybridOperatorsSummary`, `queryOperatorsSummaryDailyCache`, `queryOperatorsSummarySessions`, `combineOperatorsSummaryData`, `recalcOperatorSession`, `truncateAndRecalcOperator`, etc.
- **efficiencyScreenSessionRoute.js** (~1,409 lines): Requires `sessionFunctions`; uses `buildZeroEfficiencyPayload`, `queryOperatorTimeframes`, `queryMachineTimeframes`, `extractCountsFromSessions`, etc.
- **dailyDashboardSessionRoutesSplit.js** (~332 lines): Requires `dashboardFunctions` and `dailyDashboardBuilder`; all route logic uses imported builders.
- **machineSessions.js** (~1,704 lines): Requires `machineFunctions`; uses `buildHybridMachinesSummary`, `queryMachinesSummaryDailyCache`, `queryMachinesSummarySessions`, `combineMachineDashboardData`, etc.

---

## What’s Not Done

### reportsSessionRoutes.js

Done. All local duplicate definitions were removed; the file now relies only on the `reportFunctions` imports. Call sites already pass `db` as the first argument where required.

---

## Optional Cleanups (any file)

- **operatorSessions.js** and **machineSessions.js**: Replace local `parseAndValidateQueryParams` with `require("../../utils/time").parseAndValidateQueryParams` (or add to existing time require) and remove the local implementation.
