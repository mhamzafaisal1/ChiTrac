import { PermissionLevels } from '../user.service';

export type NavigationMenu = 'main' | 'dashboards' | 'experimental' | 'productionScreens' | 'reports' | 'settings';
export interface NavigationEntry {
  label: string;
  icon: string;
  path?: string;
  menu?: NavigationMenu;
  action?: 'logout';
  permission?: number;
}

export const menuTitles: Record<NavigationMenu, string> = {
  main: 'Main Menu', dashboards: 'Dashboards', experimental: 'Experimental',
  productionScreens: 'Production Screens', reports: 'Reports', settings: 'Settings',
};
export const menuParents: Partial<Record<NavigationMenu, NavigationMenu>> = { experimental: 'dashboards' };

// One catalogue for the sidebar and the DMC-style Home navigation.
const menus: Record<NavigationMenu, NavigationEntry[]> = {
  main: [
    { label: 'Home', icon: 'home', path: '/ng/home' },
    { label: 'Dashboards', icon: 'dashboard', menu: 'dashboards' },
    { label: 'Production Screens', icon: 'live_tv', menu: 'productionScreens' },
    { label: 'Reports', icon: 'bar_chart', menu: 'reports' },
    { label: 'Settings', icon: 'settings', menu: 'settings', permission: PermissionLevels.settings },
    { label: 'Log Out', icon: 'logout', action: 'logout' },
  ],
  dashboards: [
    { label: 'Daily', icon: 'slow_motion_video', path: '/ng/daily-analytics-split' },
    { label: 'Machine', icon: 'local_laundry_service', path: '/ng/analytics/machine-dashboard' },
    { label: 'Operator', icon: 'person', path: '/ng/operatorAnalytics' },
    { label: 'Item', icon: 'dry_cleaning', path: '/ng/itemAnalytics' },
    { label: 'Summary', icon: 'view_column', path: '/ng/daily-summary' },
    { label: 'Comparison', icon: 'compare', path: '/ng/comparison-dashboard' },
    { label: 'Experimental', icon: 'science', menu: 'experimental' },
  ],
  experimental: [
    { label: 'Daily Experimental', icon: 'dashboard_customize', path: '/ng/experimental/daily-dashboard' },
    { label: 'Action Center', icon: 'crisis_alert', path: '/ng/action-center' },
    { label: 'Downtime Pareto', icon: 'waterfall_chart', path: '/ng/downtime-pareto' },
    { label: 'Shift Handoff', icon: 'assignment', path: '/ng/shift-handoff' },
    { label: 'Visual Ops', icon: 'monitoring', path: '/ng/visual-ops' },
  ],
  productionScreens: [{ label: 'Production Screen', icon: 'live_tv', path: '/ng/production-screen' }],
  reports: [
    { label: 'Machine Report', icon: 'local_laundry_service', path: '/ng/reports/machine-report' },
    { label: 'Shift Machine Report', icon: 'schedule', path: '/ng/reports/shift-machine-report' },
    { label: 'Shift Comparison Report', icon: 'compare_arrows', path: '/ng/reports/shift-comparison-report' },
    { label: 'Operator Report', icon: 'person', path: '/ng/reports/operator-report' },
    { label: 'Item Report', icon: 'dry_cleaning', path: '/ng/reports/item-report' },
    { label: 'Fault Report', icon: 'warning', path: '/ng/reports/fault-report' },
    { label: 'Report Subscriptions', icon: 'schedule_send', path: '/ng/reports/report-subscriptions' },
  ],
  settings: [
    { label: 'Machines', icon: 'local_laundry_service', path: '/ng/settings/machines', permission: PermissionLevels.settings },
    { label: 'Profile', icon: 'account_circle', path: '/ng/settings/profile', permission: PermissionLevels.profile },
    { label: 'Operators', icon: 'person', path: '/ng/settings/operators', permission: PermissionLevels.operators },
    { label: 'Items', icon: 'dry_cleaning', path: '/ng/settings/items', permission: PermissionLevels.settings },
    { label: 'System Settings', icon: 'tune', path: '/ng/settings/system', permission: PermissionLevels.settings },
    { label: 'API Tokens', icon: 'vpn_key', path: '/ng/settings/tokens', permission: PermissionLevels.apiTokens },
    { label: 'Users', icon: 'manage_accounts', path: '/ng/settings/root/users', permission: PermissionLevels.users },
    { label: 'Server Logs', icon: 'description', path: '/ng/settings/server-logs', permission: PermissionLevels.serverLogs },
    { label: 'Utilities', icon: 'build_circle', path: '/ng/settings/root/utilities', permission: PermissionLevels.utilities },
    { label: 'Shifts', icon: 'punch_clock', path: '/ng/settings/shifts', permission: PermissionLevels.shifts },
    { label: 'Maintenance Shifts', icon: 'engineering', path: '/ng/settings/maintenance-shifts', permission: PermissionLevels.shifts },
  ],
};

export function isNavigationMenu(value: string | null): value is NavigationMenu {
  return !!value && Object.prototype.hasOwnProperty.call(menus, value);
}

export function navigationEntries(menu: NavigationMenu, canAccess: (level: number) => boolean): NavigationEntry[] {
  return menus[menu].filter(entry => entry.permission === undefined || canAccess(entry.permission));
}
