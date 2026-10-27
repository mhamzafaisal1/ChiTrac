import { Injectable } from '@angular/core';
import type { NamedProductionLayout, ProductionLayoutActivation, ProductionLayoutLibrary, ProductionLayoutReference, ProductionLayoutScope } from './production-layout.models';
import { SpfLayout } from '../efficiency-screens/experimental-spf/spf-stations';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { tap, map, distinctUntilChanged } from 'rxjs/operators';
import { TimeFormat, formatDisplayTime } from '../utils/time-format';
import { ReportLayoutId } from '../reports/report-columns';

export interface AppSettings {
  productionScreenLayouts?: Record<string, Omit<NamedProductionLayout, 'scope'>>;
  enableApiTokenCheck: boolean;
  showErrorModals: boolean;
  defaultTheme: 'light' | 'dark';
  systemName: string;
  httpsEnabled: boolean;
  dashboardTimeframe?: 'current' | 'shift' | null;
  machinePphDisplayMode?: MachinePphDisplayMode;
  percentBreakpoints?: PercentBreakpoints;
  oePercentBreakpoints?: PercentBreakpoints;
  dashboardLayouts?: DashboardLayoutPreferences;
}

export interface PercentBreakpoints {
  poor: number;
  okay: number;
  good: number;
}

export interface ThemeResponse {
  theme: 'light' | 'dark';
  source: 'user' | 'default';
}

export interface DashboardLayoutPreferences {
  experimentalSpf?: SpfLayout;
  summaryDashboard?: {
    summaryCardOrder?: string[];
    summaryCardVisibility?: Record<string, boolean>;
  };
  machineDashboard?: {
    summaryCardOrder?: string[];
    summaryCardVisibility?: Record<string, boolean>;
    tableColumnVisibility?: Record<string, boolean>;
    tableColumnOrder?: string[];
  };
  operatorDashboard?: {
    summaryCardOrder?: string[];
    summaryCardVisibility?: Record<string, boolean>;
    tableColumnVisibility?: Record<string, boolean>;
    tableColumnOrder?: string[];
  };
  experimentalDailyDashboard?: {
    gridLayout?: ExperimentalDashboardGridLayout;
    chartOrder?: string[];
    chartVisibility?: Record<string, boolean>;
  };
}

export type ExperimentalDashboardGridLayout = '3x2' | '2x2';

export type MachinePphDisplayMode = 'perMachine' | 'perStation';

export interface UserPreferences {
  productionScreenLayouts?: Record<string, Omit<NamedProductionLayout, 'scope'>>;
  defaultProductionScreenLayout?: ProductionLayoutReference | null;
  reportLayouts?: Partial<Record<ReportLayoutId, { columnOrder: string[] }>>;
  timeFormat?: TimeFormat;
  userId?: string;
  theme?: 'light' | 'dark';
  defaultTheme?: 'light' | 'dark';
  dashboardLayouts?: DashboardLayoutPreferences;
  timestamps?: {
    create: string | Date;
    active: string | Date;
    update: string | Date;
  };
}

export interface PromoteDashboardLayoutsResponse {
  preferences: AppSettings;
  promotedLayouts: Array<keyof DashboardLayoutPreferences>;
}

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  private readonly productionLayoutChanges = new Subject<void>();
  readonly productionLayoutsChanged$ = this.productionLayoutChanges.asObservable();
  private settingsSubject = new BehaviorSubject<AppSettings | null>(null);
  public settings$ = this.settingsSubject.asObservable();

  private currentThemeSubject = new BehaviorSubject<'light' | 'dark'>('light');
  public currentTheme$ = this.currentThemeSubject.asObservable();
  private userPreferencesSubject = new BehaviorSubject<UserPreferences | null>(null);
  public userPreferences$ = this.userPreferencesSubject.asObservable();
  public timeFormat$ = this.userPreferences$.pipe(
    map(preferences => preferences?.timeFormat === '24h' ? '24h' as const : '12h' as const),
    distinctUntilChanged()
  );
  private rawUserPreferences: UserPreferences | null = null;
  private readonly preferenceRequestOptions = {
    headers: new HttpHeaders({ 'X-Skip-Error-Modal': 'true' })
  };

  constructor(private http: HttpClient) {}

  getTimeFormat(): TimeFormat {
    return this.userPreferencesSubject.value?.timeFormat === '24h' ? '24h' : '12h';
  }

  formatTime(value: string | Date | number | null | undefined, options: Intl.DateTimeFormatOptions = {}): string {
    return formatDisplayTime(value, this.getTimeFormat(), options);
  }

  saveTimeFormat(timeFormat: TimeFormat): Observable<UserPreferences> {
    return this.http.put<UserPreferences>('/api/preferences/user', { timeFormat }, this.preferenceRequestOptions).pipe(
      tap(preferences => this.acceptUserPreferences(preferences))
    );
  }

  /**
   * Load application settings from the server
   */
  loadSettings(): Observable<AppSettings> {
    return this.http.get<AppSettings>('/api/utilities/settings').pipe(
      tap(settings => {
        this.settingsSubject.next(settings);
        this.publishEffectiveUserPreferences();
      })
    );
  }

  getSystemPreferences(): Observable<AppSettings> {
    return this.http.get<AppSettings>('/api/preferences/system');
  }

  loadUserPreferences(): Observable<UserPreferences> {
    return this.http.get<UserPreferences>('/api/preferences/user', this.preferenceRequestOptions).pipe(
      tap(preferences => {
        this.rawUserPreferences = preferences;
        this.publishEffectiveUserPreferences();
        if (preferences.theme) {
          this.currentThemeSubject.next(preferences.theme);
        }
      })
    );
  }

  clearUserPreferences(): void {
    localStorage.removeItem('chitrac-machine-dashboard-summary-card-order');
    localStorage.removeItem('chitrac-machine-dashboard-summary-card-visibility');
    localStorage.removeItem('chitrac-operator-dashboard-summary-card-order');
    localStorage.removeItem('chitrac-operator-dashboard-summary-card-visibility');
    localStorage.removeItem('chitrac-summary-dashboard-summary-card-order');
    localStorage.removeItem('chitrac-summary-dashboard-summary-card-visibility');
    this.rawUserPreferences = null;
    this.publishEffectiveUserPreferences();
  }

  saveDashboardTimeframe(dashboardTimeframe: 'current' | 'shift'): Observable<AppSettings> {
    return this.http.put<AppSettings>('/api/preferences/system', { dashboardTimeframe }).pipe(
      tap(() => {
        const current = this.settingsSubject.value;
        if (current) {
          this.settingsSubject.next({ ...current, dashboardTimeframe });
        }
      })
    );
  }

  savePercentBreakpoints(percentBreakpoints: PercentBreakpoints): Observable<AppSettings> {
    return this.http.put<AppSettings>('/api/preferences/system', { percentBreakpoints }).pipe(
      tap(() => {
        const current = this.settingsSubject.value;
        if (current) {
          this.settingsSubject.next({ ...current, percentBreakpoints });
        }
      })
    );
  }

  saveOePercentBreakpoints(oePercentBreakpoints: PercentBreakpoints): Observable<AppSettings> {
    return this.http.put<AppSettings>('/api/preferences/system', { oePercentBreakpoints }).pipe(
      tap(() => {
        const current = this.settingsSubject.value;
        if (current) {
          this.settingsSubject.next({ ...current, oePercentBreakpoints });
        }
      })
    );
  }

  promoteCurrentUserDashboardLayouts(): Observable<PromoteDashboardLayoutsResponse> {
    return this.http.post<PromoteDashboardLayoutsResponse>(
      '/api/preferences/system/dashboard-layouts/from-current-user',
      {},
      this.preferenceRequestOptions
    ).pipe(
      tap(response => {
        const current = this.settingsSubject.value;
        if (current) {
          this.settingsSubject.next({
            ...current,
            dashboardLayouts: response.preferences.dashboardLayouts
          });
          this.publishEffectiveUserPreferences();
        }
      })
    );
  }

  /**
   * Get current settings (sync)
   */
  getSettings(): AppSettings | null {
    return this.settingsSubject.value;
  }

  /**
   * Get user's theme preference from server
   */
  getUserTheme(): Observable<ThemeResponse> {
    return this.http.get<ThemeResponse>('/api/preferences/user/theme', this.preferenceRequestOptions).pipe(
      tap(response => {
        this.currentThemeSubject.next(response.theme);
      })
    );
  }

  /**
   * Save user's theme preference to server
   */
  saveUserTheme(theme: 'light' | 'dark'): Observable<any> {
    return this.http.put('/api/preferences/user/theme', { theme }, this.preferenceRequestOptions).pipe(
      tap(() => {
        this.currentThemeSubject.next(theme);
        const current = this.userPreferencesSubject.value || {};
        this.userPreferencesSubject.next({ ...current, theme, defaultTheme: theme });
      })
    );
  }

  saveMachineDashboardCardOrder(summaryCardOrder: string[]): Observable<UserPreferences> {
    const payload = {
      dashboardLayouts: {
        machineDashboard: {
          summaryCardOrder
        }
      }
    };

    return this.http.put<UserPreferences>('/api/preferences/user', payload, this.preferenceRequestOptions).pipe(
      tap(preferences => {
        this.acceptUserPreferences(preferences);
      })
    );
  }

  saveMachineDashboardLayout(
    summaryCardOrder: string[],
    tableColumnVisibility: Record<string, boolean>,
    summaryCardVisibility: Record<string, boolean> = {},
    tableColumnOrder: string[] = []
  ): Observable<UserPreferences> {
    const machineDashboard: DashboardLayoutPreferences['machineDashboard'] = {
      summaryCardOrder,
      summaryCardVisibility,
      tableColumnVisibility,
      tableColumnOrder
    };
    const payload = {
      dashboardLayouts: {
        machineDashboard
      }
    };

    return this.http.put<UserPreferences>('/api/preferences/user', payload, this.preferenceRequestOptions).pipe(
      tap(preferences => {
        this.acceptUserPreferences(preferences);
      })
    );
  }

  saveMachinePphDisplayMode(machinePphDisplayMode: MachinePphDisplayMode): Observable<AppSettings> {
    return this.http.put<AppSettings>('/api/preferences/system', { machinePphDisplayMode }).pipe(
      tap(() => {
        const current = this.settingsSubject.value;
        if (current) {
          this.settingsSubject.next({ ...current, machinePphDisplayMode });
        }
      })
    );
  }

  saveOperatorDashboardLayout(
    summaryCardOrder: string[],
    tableColumnVisibility: Record<string, boolean>,
    summaryCardVisibility: Record<string, boolean> = {},
    tableColumnOrder: string[] = []
  ): Observable<UserPreferences> {
    const payload = {
      dashboardLayouts: {
        operatorDashboard: {
          summaryCardOrder,
          summaryCardVisibility,
          tableColumnVisibility,
          tableColumnOrder
        }
      }
    };

    return this.http.put<UserPreferences>('/api/preferences/user', payload, this.preferenceRequestOptions).pipe(
      tap(preferences => {
        this.acceptUserPreferences(preferences);
      })
    );
  }

  saveSummaryDashboardLayout(
    summaryCardOrder: string[],
    summaryCardVisibility: Record<string, boolean> = {}
  ): Observable<UserPreferences> {
    const payload = {
      dashboardLayouts: {
        summaryDashboard: {
          summaryCardOrder,
          summaryCardVisibility
        }
      }
    };

    return this.http.put<UserPreferences>('/api/preferences/user', payload, this.preferenceRequestOptions).pipe(
      tap(preferences => this.acceptUserPreferences(preferences))
    );
  }

  saveExperimentalDailyDashboardChartOrder(
    chartOrder: string[],
    chartVisibility: Record<string, boolean> = {},
    gridLayout: ExperimentalDashboardGridLayout = '3x2'
  ): Observable<UserPreferences> {
    const payload = {
      dashboardLayouts: {
        experimentalDailyDashboard: {
          chartOrder,
          chartVisibility,
          gridLayout
        }
      }
    };

    return this.http.put<UserPreferences>('/api/preferences/user', payload, this.preferenceRequestOptions).pipe(
      tap(preferences => {
        this.acceptUserPreferences(preferences);
      })
    );
  }

  getProductionLayouts(): Observable<ProductionLayoutLibrary> {
    return this.http.get<ProductionLayoutLibrary>('/api/preferences/production-layouts', this.preferenceRequestOptions);
  }

  createProductionLayout(scope: ProductionLayoutScope, name: string, stationIds: string[]): Observable<ProductionLayoutActivation> {
    return this.http.post<ProductionLayoutActivation>('/api/preferences/production-layouts/' + scope, {name,stationIds}, this.preferenceRequestOptions)
      .pipe(tap({
        next: result => {
          this.acceptUserPreferences(result.preferences);
          this.productionLayoutChanges.next();
        },
        error: error => {
          if (error?.error?.createdLayoutRef) this.productionLayoutChanges.next();
        },
      }));
  }

  loadProductionLayout(reference: ProductionLayoutReference): Observable<ProductionLayoutActivation> {
    return this.http.post<ProductionLayoutActivation>('/api/preferences/production-layouts/load', reference, this.preferenceRequestOptions)
      .pipe(tap(result => this.acceptUserPreferences(result.preferences)));
  }

  saveExperimentalSpfLayout(layout: SpfLayout): Observable<UserPreferences> {
    return this.http.put<UserPreferences>('/api/preferences/user', {
      dashboardLayouts: { experimentalSpf: layout }
    }, this.preferenceRequestOptions).pipe(tap(preferences => this.acceptUserPreferences(preferences)));
  }

  saveReportColumnOrder(id: ReportLayoutId, columnOrder: string[]): Observable<UserPreferences> {
    return this.http.put<UserPreferences>('/api/preferences/user', {
      reportLayouts: { [id]: { columnOrder } }
    }, this.preferenceRequestOptions).pipe(tap(preferences => this.acceptUserPreferences(preferences)));
  }

  private acceptUserPreferences(preferences: UserPreferences): void {
    this.rawUserPreferences = preferences;
    this.publishEffectiveUserPreferences();
  }

  private publishEffectiveUserPreferences(): void {
    const systemLayouts = this.settingsSubject.value?.dashboardLayouts;
    const userLayouts = this.rawUserPreferences?.dashboardLayouts;
    const dashboardLayouts = this.mergeDashboardLayouts(systemLayouts, userLayouts);

    if (!this.rawUserPreferences && !dashboardLayouts) {
      this.userPreferencesSubject.next(null);
      return;
    }

    this.userPreferencesSubject.next({
      ...(this.rawUserPreferences || {}),
      ...(dashboardLayouts ? { dashboardLayouts } : {})
    });
  }

  private mergeDashboardLayouts(
    systemLayouts?: DashboardLayoutPreferences,
    userLayouts?: DashboardLayoutPreferences
  ): DashboardLayoutPreferences | undefined {
    const dashboardLayouts: DashboardLayoutPreferences = {};
    const dashboardNames: Array<keyof DashboardLayoutPreferences> = [
      'summaryDashboard',
      'machineDashboard',
      'operatorDashboard',
      'experimentalDailyDashboard',
      'experimentalSpf'
    ];

    for (const dashboardName of dashboardNames) {
      const systemLayout = systemLayouts?.[dashboardName];
      const userLayout = userLayouts?.[dashboardName];
      if (!systemLayout && !userLayout) continue;
      Object.assign(dashboardLayouts, { [dashboardName]: {
        ...(systemLayout || {}),
        ...(userLayout || {})
      } });
    }

    return Object.keys(dashboardLayouts).length ? dashboardLayouts : undefined;
  }

  setExperimentalDailyDashboardChartOrder(
    chartOrder: string[],
    chartVisibility: Record<string, boolean> = {},
    gridLayout: ExperimentalDashboardGridLayout = '3x2'
  ): void {
    const current = this.userPreferencesSubject.value || {};
    this.userPreferencesSubject.next({
      ...current,
      dashboardLayouts: {
        ...current.dashboardLayouts,
        experimentalDailyDashboard: {
          ...current.dashboardLayouts?.experimentalDailyDashboard,
          chartOrder,
          chartVisibility,
          gridLayout
        }
      }
    });
  }

  setMachineDashboardCardOrder(summaryCardOrder: string[]): void {
    const current = this.userPreferencesSubject.value || {};
    this.userPreferencesSubject.next({
      ...current,
      dashboardLayouts: {
        ...current.dashboardLayouts,
        machineDashboard: {
          ...current.dashboardLayouts?.machineDashboard,
          summaryCardOrder
        }
      }
    });
  }

  setMachineDashboardLayout(
    summaryCardOrder: string[],
    tableColumnVisibility: Record<string, boolean>,
    summaryCardVisibility: Record<string, boolean> = {},
    tableColumnOrder: string[] = []
  ): void {
    const current = this.userPreferencesSubject.value || {};
    const machineDashboard = {
      ...current.dashboardLayouts?.machineDashboard,
      summaryCardOrder,
      summaryCardVisibility,
      tableColumnVisibility,
      tableColumnOrder
    };
    this.userPreferencesSubject.next({
      ...current,
      dashboardLayouts: {
        ...current.dashboardLayouts,
        machineDashboard
      }
    });
  }

  setOperatorDashboardLayout(
    summaryCardOrder: string[],
    tableColumnVisibility: Record<string, boolean>,
    summaryCardVisibility: Record<string, boolean> = {},
    tableColumnOrder: string[] = []
  ): void {
    const current = this.userPreferencesSubject.value || {};
    this.userPreferencesSubject.next({
      ...current,
      dashboardLayouts: {
        ...current.dashboardLayouts,
        operatorDashboard: {
          ...current.dashboardLayouts?.operatorDashboard,
          summaryCardOrder,
          summaryCardVisibility,
          tableColumnVisibility,
          tableColumnOrder
        }
      }
    });
  }

  setSummaryDashboardLayout(
    summaryCardOrder: string[],
    summaryCardVisibility: Record<string, boolean> = {}
  ): void {
    const current = this.userPreferencesSubject.value || {};
    this.userPreferencesSubject.next({
      ...current,
      dashboardLayouts: {
        ...current.dashboardLayouts,
        summaryDashboard: {
          ...current.dashboardLayouts?.summaryDashboard,
          summaryCardOrder,
          summaryCardVisibility
        }
      }
    });
  }

  /**
   * Get current theme (sync)
   */
  getCurrentTheme(): 'light' | 'dark' {
    return this.currentThemeSubject.value;
  }

  /**
   * Check if error modals should be shown
   */
  shouldShowErrorModals(): boolean {
    const settings = this.settingsSubject.value;
    return settings?.showErrorModals !== false; // default to true
  }
}

