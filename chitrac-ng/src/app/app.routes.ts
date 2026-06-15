import { Routes } from '@angular/router';
import { OperatorGridComponent } from './operator-grid/operator-grid.component';
import { ItemGridComponent } from './item-grid/item-grid.component';
import { UserLoginComponent } from './user-login/user-login.component';
import { UserRegisterComponent } from './user-register/user-register.component';
import { OperatorAnalyticsDashboardComponent } from './operator-analytics-dashboard/operator-analytics-dashboard.component';
import { DailySummaryDashboardComponent } from './daily-summary-dashboard/daily-summary-dashboard.component';
import { ItemAnalyticsDashboardComponent } from './item-analytics-dashboard/item-analytics-dashboard.component';
import { AuthGuard } from './guards/auth.guard';
import { MachineDashboardComponent } from './machine-dashboard/machine-dashboard.component';
import { MachineReportComponent } from './reports/machine-report/machine-report.component';
import { ShiftMachineReportComponent } from './reports/shift-machine-report/shift-machine-report.component';
import { OperatorReportComponent } from './reports/operator-report/operator-report.component';
import { ItemReportComponent } from './reports/item-report/item-report.component';
import { FaultReportComponent } from './reports/fault-report/fault-report.component';
import { ReportSubscriptionComponent } from './reports/report-subscription/report-subscription.component';
import { BlanketBlasteroneEfficiencyScreen } from './efficiency-screens/blanket-blasterone-efficiency-screen/blanket-blasterone-efficiency-screen.component';
import { BlanketBlastertwoEfficiencyScreen } from './efficiency-screens/blanket-blastertwo-efficiency-screen/blanket-blastertwo-efficiency-screen.component';
import { MachineGridComponent } from './machine-grid/machine-grid.component';
import { SplEfficiencyScreen } from './efficiency-screens/spl-efficiency-screen/spl-efficiecny-screen.component';
import { LplEfficiencyScreen } from './efficiency-screens/lpl-efficiency-screen/lpl-efficiecny-screen.component';
import { MachineEfficiencyLaneComponent } from './efficiency-screens/efficiecny-screen-machine/machine-efficiecny-lane.component';
import { DailyAnalyticsDashboardSplitComponent } from './daily-analytics-dashboard-split/daily-analytics-dashboard-split.component';
import { SplColEfficiencyScreenComponent } from './efficiency-screens/spl-col-efficiency-screen/spl-col-efficiency-screen.component';
import { SpfColEfficiencyScreenComponent } from './efficiency-screens/spf-col-efficiency-screen/spf-col-efficiency-screen.component';
import { LPLsEfficiencyScreenComponent } from './efficiency-screens/LPLs-efficiency-screen/LPLs-efficiency-screen';
import { SPFsEfficiencyScreenComponent } from './efficiency-screens/SPFs-efficiency-screen/SPFs-efficiency-screen';
import { BlanketBlastersEfficiencyScreenComponent } from './efficiency-screens/blanketBlasters-efficiency-screen/blanketBlasters-efficiency-screen';
import { EightStationDemoComponent } from './efficiency-screens/eight-station-demo/eight-station-demo.component';
import { ErrorModalDemoComponent } from './components/error-modal/error-modal-demo.component';
import { TokenManagementComponent } from './token-management/token-management.component';
import { UserManagementComponent } from './user-management/user-management.component';
import { UserProfileComponent } from './user-profile/user-profile.component';
import { ServerLogsInterfaceComponent } from './server-logs-interface/server-logs-interface';
import { ShiftSettingsComponent } from './shift-management/shift-settings.component';
import { SettingsUtilitiesComponent } from './settings-utilities/settings-utilities.component';
import { PermissionLevels } from './user.service';
import { ComparisonDashboardComponent } from './comparison-dashboard/comparison-dashboard.component';

export const routes: Routes = [
	// Settings pages
	{ path: 'ng/settings/operators', component: OperatorGridComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.operators } },
	{ path: 'ng/settings/items', component: ItemGridComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.settings } },
	{ path: 'ng/settings/machines', component: MachineGridComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.settings } },
	{ path: 'ng/settings/profile', component: UserProfileComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.profile } },
	{ path: 'ng/settings/shifts', component: ShiftSettingsComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.shifts } },
	{ path: 'ng/settings/tokens', component: TokenManagementComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.apiTokens } },
	{ path: 'ng/settings/root/users', component: UserManagementComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.users } },
	{ path: 'ng/settings/root/users/register', component: UserRegisterComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.users } },
	{ path: 'ng/settings/root/utilities', component: SettingsUtilitiesComponent, canActivate: [AuthGuard] },
	{ path: 'ng/settings/server-logs', component: ServerLogsInterfaceComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.serverLogs } },
	
	// Login/Auth
	{ path: 'ng/login', component: UserLoginComponent },
	
	// Main Dashboards
	{ path: 'ng/machineAnalytics', component: MachineDashboardComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.dashboards } },
	{ path: 'ng/operatorAnalytics', component: OperatorAnalyticsDashboardComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.dashboards } },
	{ path: 'ng/itemAnalytics', component: ItemAnalyticsDashboardComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.dashboards } },
	{ path: 'ng/daily-summary', component: DailySummaryDashboardComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.dashboards } },
	{ path: 'ng/daily-analytics-split', component: DailyAnalyticsDashboardSplitComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.dashboards } },
	{ path: 'ng/comparison-dashboard', component: ComparisonDashboardComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.dashboards } },
	{ path: 'ng/analytics/machine-dashboard', component: MachineDashboardComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.dashboards } },
	
	// Reports
	{ path: 'ng/reports/machine-report', component: MachineReportComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.reports } },
	{ path: 'ng/reports/shift-machine-report', component: ShiftMachineReportComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.reports } },
	{ path: 'ng/reports/operator-report', component: OperatorReportComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.reports } },
	{ path: 'ng/reports/item-report', component: ItemReportComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.reports } },
	{ path: 'ng/reports/fault-report', component: FaultReportComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.reports } },
	{ path: 'ng/reports/report-subscriptions', component: ReportSubscriptionComponent, canActivate: [AuthGuard], data: { requiredPermissionLevel: PermissionLevels.reports } },
	
	// Production/Efficiency Screens
	{ path: 'ng/blanket-blaster-one', component: BlanketBlasteroneEfficiencyScreen },
	{ path: 'ng/blanket-blaster-two', component: BlanketBlastertwoEfficiencyScreen },
	{ path: 'ng/spl-efficiency-screen', component: SplEfficiencyScreen },
	{ path: 'ng/lpl-efficiency-screen', component: LplEfficiencyScreen },
	{ path: 'ng/lpl-efficiency-screen/:line', component: LplEfficiencyScreen },
	{ path: 'ng/machine-efficiency-lane', component: MachineEfficiencyLaneComponent },
	{ path: 'ng/spl-col-efficiency-screen', component: SplColEfficiencyScreenComponent },
	{ path: 'ng/spf-col-efficiency-screen', component: SpfColEfficiencyScreenComponent },
	{ path: 'ng/lpls-efficiency-screen', component: LPLsEfficiencyScreenComponent },
	{ path: 'ng/spfs-efficiency-screen', component: SPFsEfficiencyScreenComponent },
	{ path: 'ng/blanket-blasters-efficiency-screen', component: BlanketBlastersEfficiencyScreenComponent },
	{ path: 'ng/eight-station-demo', component: EightStationDemoComponent },
	
	// Redirects
	{ path: 'ng/home', redirectTo: 'ng/machineAnalytics' },
	{ path: '', redirectTo: 'ng/machineAnalytics', pathMatch: 'full' },
	{ path: '**', redirectTo: 'ng/machineAnalytics', pathMatch: 'full' }
];
