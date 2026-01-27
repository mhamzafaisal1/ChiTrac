# Alpha Routes Used by Angular Frontend

This document maps all `/api/alpha/*` routes to their usage in the ChiTrac Angular frontend, organized by feature area.

---

## 📊 Dashboards

### Machine Dashboard (`machine-dashboard.component.ts`)

**Main Table Data:**
- `GET /analytics/machines-summary-daily-cached` - Machine summary table (with timeframe support via `/analytics/machine-summary-timeframe`)

**Machine Detail Modal (on row click):**
- `GET /analytics/machine-dashboard-daily-cached` - Full machine details for modal (with timeframe support via `/analytics/machine-dashboard-cached`)
  - Used by modal tabs: Item Summary, Current Operators, Item Stacked Chart, Fault Summaries, Fault History, Performance Chart

**Backend Files:**
- `controllers/alpha/machineSessions.js` (machines-summary-daily-cached)
- `controllers/alpha/index.js` (machine-dashboard-daily-cached, machine-dashboard-cached)

---

### Operator Analytics Dashboard (`operator-analytics-dashboard.component.ts`)

**Main Table Data:**
- `GET /analytics/operators-summary-daily-cached` - Operator summary table (with timeframe support via `/analytics/operator-summary-timeframe`)

**Operator Detail Modal (on row click):**
- `GET /analytics/operator-dashboard-sessions` - Base operator data for modal
- `GET /analytics/operator-details-cached` - Additional operator details
  - Used by modal tabs: Item Summary, Item Stacked Chart, Running/Paused/Fault Pie Chart, Fault History, Daily Efficiency Chart, Machine Summary

**Backend Files:**
- `controllers/alpha/operatorSessions.js` (operators-summary-daily-cached, operator-summary-timeframe)
- `controllers/alpha/dashboardRoutes.js` (operator-dashboard-sessions)
- `controllers/alpha/operatorDetails.js` (operator-details-cached)

---

### Daily Summary Dashboard (`daily-summary-dashboard.component.ts`)

**Main Tables:**
- `GET /analytics/daily-summary-dashboard/machines` - Machine summary table
- `GET /analytics/daily-summary-dashboard/operators` - Operator summary table
- `GET /analytics/daily-summary-dashboard/items` - Item summary table

**Machine Detail Modal (on machine row click):**
- `GET /analytics/machine-dashboard-daily-cached` - Full machine details
  - Used by modal tabs: Fault Summaries, Fault Cycles, Performance Chart

**Operator Detail Modal (on operator row click):**
- `GET /analytics/operator-details-cached` - Operator details with countByItem
  - Used by modal: Operator Count by Item Chart

**Backend Files:**
- `controllers/alpha/dailyDashboardSessionRoutes.js` (daily-summary-dashboard routes)
- `controllers/alpha/index.js` (machine-dashboard-daily-cached)
- `controllers/alpha/operatorDetails.js` (operator-details-cached)

---

### Daily Analytics Dashboard Split (`daily-analytics-dashboard-split.component.ts`)

**Chart Data (Individual Routes):**
- `GET /analytics/daily/machine-status-cache` - Machine status breakdowns (used by Daily Machine Stacked Bar Chart)
- `GET /analytics/daily/machine-oee` - Machine OEE rankings (used by Daily Machine OEE Bar Chart)
- `GET /analytics/hourly/item-hourly-production` - Item hourly production data (used by Daily Machine Item Stacked Bar Chart)
- `GET /analytics/daily/top-operators-cache` - Top operator efficiency rankings (used by Ranked Operator Bar Chart)
- `GET /analytics/daily/plantwide-metrics-cache` - Plant-wide metrics by hour (used by Plantwide Metrics Chart)
- `GET /analytics/daily/count-totals-cache` - Daily count totals (used by Daily Count Bar Chart)

**Backend Files:**
- `controllers/alpha/dailyDashboardSessionRoutesSplit.js` (all individual daily dashboard routes)

---

### Item Analytics Dashboard (`item-analytics-dashboard.component.ts`)

**Main Table Data:**
- `GET /analytics/items-summary-daily-cache` - Item summary table

**Backend Files:**
- `controllers/alpha/itemSessions.js` (items-summary-daily-cache)

---

## 🔍 Modals (Opened from Dashboards)

### Machine Dashboard Modals

**Item Summary Tab:**
- Uses data from `GET /analytics/machine-dashboard-daily-cached` (preloaded in modal)

**Item Stacked Chart Tab:**
- Uses data from `GET /analytics/machine-dashboard-daily-cached` (preloaded `itemHourlyStack`)

**Fault History Tab:**
- Uses data from `GET /analytics/machine-dashboard-daily-cached` (preloaded `faultData`)

**Performance Chart Tab:**
- Uses data from `GET /analytics/machine-dashboard-daily-cached` (preloaded `operatorEfficiency`)

**Current Operators Tab:**
- Uses data from `GET /analytics/machine-dashboard-daily-cached` (preloaded `currentOperators`)

---

### Operator Dashboard Modals

**Item Summary Tab:**
- Uses data from `GET /analytics/operator-dashboard-sessions` + `GET /analytics/operator-details-cached` (merged)

**Item Stacked Chart Tab:**
- Uses data from `GET /analytics/operator-dashboard-sessions` + `GET /analytics/operator-details-cached` (merged)

**Running/Paused/Fault Pie Chart Tab:**
- Uses data from `GET /analytics/operator-dashboard-sessions` + `GET /analytics/operator-details-cached` (merged)
- May also call: `GET /analytics/operator-cycle-pie` (if not preloaded)

**Fault History Tab:**
- `GET /analytics/operator-fault-history` - Operator fault history

**Daily Efficiency Chart Tab:**
- Uses data from `GET /analytics/operator-dashboard-sessions` + `GET /analytics/operator-details-cached` (merged)
- May also call: `GET /analytics/operator/daily-efficiency` (if not preloaded)

**Machine Summary Tab:**
- `GET /analytics/operator-machine-summary` - Per-machine summary for operator

**Backend Files:**
- `controllers/alpha/index.js` (operator-fault-history, operator-cycle-pie, operator/daily-efficiency)
- `controllers/alpha/operatorSessions.js` (operator-machine-summary)

---

## 📈 Efficiency Screens

### SPL Efficiency Screen (`spl-efficiency-screen.component.ts`)

**Live Efficiency Data:**
- `GET /analytics/daily/machine-live-session-summary` - Live efficiency summary for SPL machine (serial 90011)
  - Polls every 6 seconds

**Backend Files:**
- `controllers/alpha/efficiencyScreenSessionRoute.js` (daily/machine-live-session-summary)

---

### Other Efficiency Screens

**Machine-Wide Efficiency:**
- `GET /analytics/machine-live-session-summary/machine` - Machine-wide efficiency screen data

**Operator Efficiency:**
- `GET /analytics/machine-live-session-summary/operator` - Operator efficiency for specific station

**SPF Machine List:**
- `GET /machines/spf` - List of SPF-type machines for efficiency screen selection

**Backend Files:**
- `controllers/alpha/efficiencyScreenSessionRoute.js` (machine-live-session-summary routes, machines/spf)

---

## 📄 Reports

### Machine Report (`machine-report.component.ts`)

**Report Data:**
- `GET /analytics/machine-item-sessions-summary-cache` - Machine-item summary for report table
  - Used for PDF/CSV export

**Backend Files:**
- `controllers/alpha/reportsSessionRoutes.js` (machine-item-sessions-summary-cache)

---

### Operator Report (`operator-report.component.ts`)

**Report Data:**
- `GET /analytics/operator-item-sessions-summary-cache` - Operator-item summary for report table
  - Used for PDF/CSV export

**Backend Files:**
- `controllers/alpha/reportsSessionRoutes.js` (operator-item-sessions-summary-cache)

---

### Item Report (`item-report.component.ts`)

**Report Data:**
- `GET /analytics/item-sessions-summary-daily-cache` - Item summary for report table
  - Used for PDF/CSV export

**Backend Files:**
- `controllers/alpha/reportsSessionRoutes.js` (item-sessions-summary-daily-cache)

---

## ⚙️ Configuration Routes

These routes are used for managing configuration data (machines, items, operators) and are mounted at `/api` (not `/api/alpha`).

### Machine Configuration (`configuration.service.ts`)

**Machine Config Routes:**
- `GET /api/machines/config` - Get all machine configurations
- `GET /api/machines/config/xml` - Get machine configurations as XML
- `POST /api/machines/config` - Create new machine configuration
- `PUT /api/machines/config/:id` - Update machine configuration
- `DELETE /api/machines/config/:id` - Delete machine configuration

**Backend Files:**
- `controllers/machine/index.js`

---

### Item Configuration (`configuration.service.ts`)

**Item Config Routes:**
- `GET /api/item/config` - Get all item configurations
- `GET /api/item/config/xml` - Get item configurations as XML
- `GET /api/item/new-id` - Get new item ID
- `POST /api/item/config` - Create/update item configuration
- `PUT /api/item/config/:id` - Update item configuration
- `DELETE /api/item/config/:id` - Delete item configuration

**Backend Files:**
- `controllers/item/index.js`

---

### Operator Configuration (`configuration.service.ts`)

**Operator Config Routes:**
- `GET /api/operator/config` - Get all operator configurations (with filterTestOperators query param)
- `GET /api/operator/config/xml` - Get operator configurations as XML
- `GET /api/operator/new-id` - Get new operator ID
- `POST /api/operator/config` - Create new operator configuration (JWT protected)
- `PUT /api/operator/config/:id` - Update operator configuration (JWT protected)
- `DELETE /api/operator/config/:id` - Delete operator configuration (JWT protected)

**Backend Files:**
- `controllers/operator/index.js`

---

## 🔧 Softrol Routes (Legacy Integration)

These routes are conditionally loaded based on environment settings and are mounted at `/api/softrol`.


### Softrol Historic Data

**Historic Data Routes:**
- `GET /api/softrol/historic-data` - Get historic data (updated route)
- `GET /api/softrol/historic-data/old` - Get historic data (legacy route)

**Backend Files:**
- `controllers/softrol/index.js`

---

## 🔧 Supporting Routes

### Machine Analytics Routes

- `GET /analytics/operator-dashboard` - Per-operator dashboard
- `GET /analytics/operator-performance` - Operator performance metrics
- `GET /analytics/operator-countbyitem` - Item counts by operator

**Backend Files:**
- `controllers/alpha/index.js` (operator-performance, operator-countbyitem)
- `controllers/alpha/operatorRoutes.js` (operator-dashboard)

---

### Item Analytics Routes

- `GET /analytics/machine-item-sessions-summary` - Machine-item summary (chart-ready)
- `GET /analytics/operator-item-sessions-summary` - Operator-item summary

**Backend Files:**
- `controllers/alpha/reportsSessionRoutes.js` (machine-item-sessions-summary, operator-item-sessions-summary)


