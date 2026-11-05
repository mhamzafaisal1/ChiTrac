# Compact production updates

The alpha CPU profile showed most sampled time in WebSocket JSON serialization
and observable-property reads. Production updates previously included every
dashboard and its history, duplicated the dashboard under two properties, and
serialized again for each WebSocket listener.

Updated Angular clients opt in with `dashboardUpdates=partial` on both WebSocket
URLs. Their `production` updates have `partial: true` and include only
`cache.dashboard.production`. The browser replaces that production snapshot
while retaining the other dashboards, history, active shift and summary caches.
Production snapshots still replace removed machine/operator entries.

Initial snapshots and other update scopes retain their existing full format.
Older tabs receive the original production message through a lazy fallback.
Each format is serialized once across both listeners, only when it has eligible
recipients. Status-only and datafeed service connections remain excluded.

## Deployment and verification

Deploy the API changes and rebuilt Angular application from `chitrac-server`.
No database migration or datafeed deployment is required. Either API/frontend
deployment order remains compatible, but both must be updated to use compact
production messages.

Refresh all existing dashboard and production-display tabs after deployment.
An old tab reconnecting without a page refresh continues requesting the larger
full messages and retains that serialization cost until refreshed or closed.

On alpha, repeat the localhost small-chunk timings and API CPU measurements under
the same simulator/browser workload. Verify dashboard and Production Screen data
continue updating and remain populated after navigation and reconnects. In the
browser WebSocket frames, opted-in production updates should contain only the
production subsection; initial synchronization remains a full snapshot.

Local tests cover recipient filtering, mixed old/new clients, shared serialization,
payload independence from history size, and preservation of unrelated browser
cache state. They do not establish alpha's post-deployment CPU or response times.
