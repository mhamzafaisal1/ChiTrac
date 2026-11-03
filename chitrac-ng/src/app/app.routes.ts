import { Router, Routes } from '@angular/router';
import { legacyProductionRoutes } from './production-screen-legacy.routes';
import { inject } from '@angular/core';
import { OperatorGridComponent } from './operator-grid/operator-grid.component';
import { ItemGridComponent } from './item-grid/item-grid.component';
import { AuthGuard } from './guards/auth.guard';
import { MachineGridComponent } from './machine-grid/machine-grid.component';
import { ShiftSettingsComponent } from './shift-management/shift-settings.component';
import { MaintenanceShiftSettingsComponent } from './shift-management/maintenance-shift-settings.component';
import { SystemSettingsComponent } from './system-settings/system-settings.component';
import { PermissionLevels } from './user.service';
import { SettingsMenuComponent } from './settings-menu/settings-menu.component';
import { HomeComponent } from './home/home.component';

const appRoutes: Routes = [
	// Settings pages
	{ path: 'ng/settings', pathMatch: 'full', component: SettingsMenuComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.settings } },
	{ path: 'ng/settings/operators', component: OperatorGridComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.operators } },
	{ path: 'ng/settings/items', component: ItemGridComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.settings } },
	{ path: 'ng/settings/machines', component: MachineGridComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.settings } },
	{ path: 'ng/settings/system', component: SystemSettingsComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.settings } },
	{ path: 'ng/settings/profile', loadComponent: () => import('./user-profile/user-profile.component').then(m => m.UserProfileComponent), canActivate: [AuthGuard], data: { preload: true, requiredPermissionLevel: PermissionLevels.profile } },
	{ path: 'ng/settings/shifts', component: ShiftSettingsComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.shifts } },
	{ path: 'ng/settings/maintenance-shifts', component: MaintenanceShiftSettingsComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.shifts } },
	{ path: 'ng/settings/tokens', loadComponent: () => import('./token-management/token-management.component').then(m => m.TokenManagementComponent), canActivate: [AuthGuard], data: { preload: true, requiredPermissionLevel: PermissionLevels.apiTokens } },
	{ path: 'ng/settings/root/users', loadComponent: () => import('./user-management/user-management.component').then(m => m.UserManagementComponent), canActivate: [AuthGuard], data: { preload: true, requiredPermissionLevel: PermissionLevels.users } },
	{ path: 'ng/settings/root/users/register', loadComponent: () => import('./user-register/user-register.component').then(m => m.UserRegisterComponent), canActivate: [AuthGuard], data: { preload: true, requiredPermissionLevel: PermissionLevels.users } },
	{ path: 'ng/settings/root/utilities', loadComponent: () => import('./settings-utilities/settings-utilities.component').then(m => m.SettingsUtilitiesComponent), canActivate: [AuthGuard], data: { preload: true, requiredPermissionLevel: PermissionLevels.utilities } },
	{ path: 'ng/settings/server-logs', loadComponent: () => import('./server-logs-interface/server-logs-interface').then(m => m.ServerLogsInterfaceComponent), canActivate: [AuthGuard], data: { preload: true, requiredPermissionLevel: PermissionLevels.serverLogs } },
	{ path: 'ng/test', loadComponent: () => import('./test/test.component').then(m => m.TestComponent), canActivate: [AuthGuard], data: { preload: false } },
	
	// Login/Auth
	{ path: 'ng/login', redirectTo: ({ queryParams }) => inject(Router).createUrlTree(['/ng/home'], {
		queryParams: { login: '1', ...(typeof queryParams['returnUrl'] === 'string' ? { returnUrl: queryParams['returnUrl'] } : {}) }
	}) },
	{ path: 'ng/reset-password', redirectTo: ({ queryParams }) => inject(Router).createUrlTree(['/ng/home'], {
		queryParams: { resetPassword: '1', token: queryParams['token'] }
	}) },
	
	// Main Dashboards
	{ path: 'ng/machineAnalytics', loadComponent: () => import('./machine-dashboard/machine-dashboard.component').then(m => m.MachineDashboardComponent), data: { preload: true } },
	{ path: 'ng/operatorAnalytics', loadComponent: () => import('./operator-analytics-dashboard/operator-analytics-dashboard.component').then(m => m.OperatorAnalyticsDashboardComponent), data: { preload: true } },
	{ path: 'ng/itemAnalytics', loadComponent: () => import('./item-analytics-dashboard/item-analytics-dashboard.component').then(m => m.ItemAnalyticsDashboardComponent), data: { preload: true } },
	{ path: 'ng/daily-summary', loadComponent: () => import('./daily-summary-dashboard/daily-summary-dashboard.component').then(m => m.DailySummaryDashboardComponent), data: { preload: true } },
	{ path: 'ng/daily-analytics-split', loadComponent: () => import('./daily-analytics-dashboard-split/daily-analytics-dashboard-split.component').then(m => m.DailyAnalyticsDashboardSplitComponent), data: { preload: true } },
	{ path: 'ng/comparison-dashboard', loadComponent: () => import('./comparison-dashboard/comparison-dashboard.component').then(m => m.ComparisonDashboardComponent), data: { preload: true } },
	{ path: 'ng/action-center', loadComponent: () => import('./action-center/action-center.component').then(m => m.ActionCenterComponent), data: { preload: true } },
	{ path: 'ng/downtime-pareto', loadComponent: () => import('./downtime-pareto/downtime-pareto.component').then(m => m.DowntimeParetoComponent), data: { preload: true } },
	{ path: 'ng/shift-handoff', loadComponent: () => import('./shift-handoff/shift-handoff.component').then(m => m.ShiftHandoffComponent), data: { preload: true } },
	{ path: 'ng/visual-ops', loadComponent: () => import('./visual-ops-dashboard/visual-ops-dashboard.component').then(m => m.VisualOpsDashboardComponent), data: { preload: true } },
	{
		path: 'ng/experimental/daily-dashboard',
		data: { preload: true },
		loadComponent: () => import('./experimental-daily-dashboard/experimental-daily-dashboard.component')
			.then(m => m.ExperimentalDailyDashboardComponent)
	},
	{ path: 'ng/analytics/machine-dashboard', loadComponent: () => import('./machine-dashboard/machine-dashboard.component').then(m => m.MachineDashboardComponent), data: { preload: true } },
	
	// Reports
	{ path: 'ng/reports/machine-report', loadComponent: () => import('./reports/machine-report/machine-report.component').then(m => m.MachineReportComponent), data: { preload: true } },
	{ path: 'ng/reports/shift-machine-report', loadComponent: () => import('./reports/shift-machine-report/shift-machine-report.component').then(m => m.ShiftMachineReportComponent), data: { preload: true } },
	{ path: 'ng/reports/shift-comparison-report', loadComponent: () => import('./reports/shift-comparison-report/shift-comparison-report.component').then(m => m.ShiftComparisonReportComponent), data: { preload: true } },
	{ path: 'ng/reports/operator-report', loadComponent: () => import('./reports/operator-report/operator-report.component').then(m => m.OperatorReportComponent), data: { preload: true } },
	{ path: 'ng/reports/item-report', loadComponent: () => import('./reports/item-report/item-report.component').then(m => m.ItemReportComponent), data: { preload: true } },
	{ path: 'ng/reports/fault-report', loadComponent: () => import('./reports/fault-report/fault-report.component').then(m => m.FaultReportComponent), data: { preload: true } },
	{ path: 'ng/reports/report-subscriptions', loadComponent: () => import('./reports/report-subscription/report-subscription.component').then(m => m.ReportSubscriptionComponent), data: { preload: true } },
	
	// Retired display URLs remain guarded, but no longer load the old pages.
	...legacyProductionRoutes,

	// Production/Efficiency Screens
	{ path: 'ng/production-screen', loadComponent: () => import('./efficiency-screens/experimental-spf/experimental-spf.component').then(m => m.ExperimentalSpfComponent), data: { preload: true } },
	{ path: 'ng/experimental/spf', loadComponent: () => import('./efficiency-screens/experimental-spf/experimental-spf.component').then(m => m.ExperimentalSpfComponent) },
	
	// Redirects
	{ path: 'ng/home', component: HomeComponent },
	{ path: '', redirectTo: 'ng/home', pathMatch: 'full' },
	{ path: '**', loadComponent: () => import('./not-found/not-found.component').then(m => m.NotFoundComponent) }
];

// Home is the only anonymous page. Apply the same server-backed session guard
// to every destination, including legacy links, demos and lazy-loaded screens.
export const routes: Routes = appRoutes.map(route =>
  route.path === 'ng/home' || route.redirectTo !== undefined
    ? route
    : { ...route, canActivate: route.canActivate?.includes(AuthGuard) ? route.canActivate : [AuthGuard, ...(route.canActivate || [])] }
);
