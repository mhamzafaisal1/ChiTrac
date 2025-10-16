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
import { OperatorReportComponent } from './reports/operator-report/operator-report.component';
import { ItemReportComponent } from './reports/item-report/item-report.component';
import { BlanketBlasteroneEfficiencyScreen } from './efficiency-screens/blanket-blasterone-efficiency-screen/blanket-blasterone-efficiency-screen.component';
import { BlanketBlastertwoEfficiencyScreen } from './efficiency-screens/blanket-blastertwo-efficiency-screen/blanket-blastertwo-efficiency-screen.component';
import { MachineGridComponent } from './machine-grid/machine-grid.component';
import { SplEfficiencyScreen } from './efficiency-screens/spl-efficiency-screen/spl-efficiecny-screen.component';
import { LplEfficiencyScreen } from './efficiency-screens/lpl-efficiency-screen/lpl-efficiecny-screen.component';
import { MachineEfficiencyLaneComponent } from './efficiency-screens/efficiecny-screen-machine/machine-efficiecny-lane.component';
import { DailyAnalyticsDashboardSplitComponent } from './daily-analytics-dashboard-split/daily-analytics-dashboard-split.component';
import { SplColEfficiencyScreenComponent } from './efficiency-screens/spl-col-efficiency-screen/spl-col-efficiency-screen.component';
import { SpfColEfficiencyScreenComponent } from './efficiency-screens/spf-col-efficiency-screen/spf-col-efficiency-screen.component';
import { ErrorModalDemoComponent } from './components/error-modal/error-modal-demo.component';
import { TokenManagementComponent } from './token-management/token-management.component';

export const routes: Routes = [
	// Settings pages
	{ path: 'ng/settings/operators', component: OperatorGridComponent },
	{ path: 'ng/settings/items', component: ItemGridComponent },
	{ path: 'ng/settings/machines', component: MachineGridComponent },
	{ path: 'ng/settings/tokens', component: TokenManagementComponent, canActivate: [AuthGuard] },
	{ path: 'ng/settings/root/users/register', component: UserRegisterComponent, canActivate: [AuthGuard] },
	
	// Login/Auth
	{ path: 'ng/login', component: UserLoginComponent },
	
	// Main Dashboards
	{ path: 'ng/machineAnalytics', component: MachineDashboardComponent },
	{ path: 'ng/operatorAnalytics', component: OperatorAnalyticsDashboardComponent },
	{ path: 'ng/itemAnalytics', component: ItemAnalyticsDashboardComponent },
	{ path: 'ng/daily-summary', component: DailySummaryDashboardComponent },
	{ path: 'ng/daily-analytics-split', component: DailyAnalyticsDashboardSplitComponent },
	{ path: 'ng/analytics/machine-dashboard', component: MachineDashboardComponent },
	
	// Reports
	{ path: 'ng/reports/machine-report', component: MachineReportComponent },
	{ path: 'ng/reports/operator-report', component: OperatorReportComponent },
	{ path: 'ng/reports/item-report', component: ItemReportComponent },
	
	// Production/Efficiency Screens
	{ path: 'ng/blanket-blaster-one', component: BlanketBlasteroneEfficiencyScreen },
	{ path: 'ng/blanket-blaster-two', component: BlanketBlastertwoEfficiencyScreen },
	{ path: 'ng/spl-efficiency-screen', component: SplEfficiencyScreen },
	{ path: 'ng/lpl-efficiency-screen', component: LplEfficiencyScreen },
	{ path: 'ng/lpl-efficiency-screen/:line', component: LplEfficiencyScreen },
	{ path: 'ng/machine-efficiency-lane', component: MachineEfficiencyLaneComponent },
	{ path: 'ng/spl-col-efficiency-screen', component: SplColEfficiencyScreenComponent },
	{ path: 'ng/spf-col-efficiency-screen', component: SpfColEfficiencyScreenComponent },
	
	// Redirects
	{ path: 'ng/home', redirectTo: 'ng/machineAnalytics' },
	{ path: '', redirectTo: 'ng/machineAnalytics', pathMatch: 'full' },
	{ path: '**', redirectTo: 'ng/machineAnalytics', pathMatch: 'full' }
];
