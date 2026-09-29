import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

export interface AppSettings {
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
    chartOrder?: string[];
    chartVisibility?: Record<string, boolean>;
  };
}

export type MachinePphDisplayMode = 'perMachine' | 'perStation';

export interface UserPreferences {
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
  private settingsSubject = new BehaviorSubject<AppSettings | null>(null);
  public settings$ = this.settingsSubject.asObservable();

  private currentThemeSubject = new BehaviorSubject<'light' | 'dark'>('light');
  public currentTheme$ = this.currentThemeSubject.asObservable();
  private userPreferencesSubject = new BehaviorSubject<UserPreferences | null>(null);
  public userPreferences$ = this.userPreferencesSubject.asObservable();
  private rawUserPreferences: UserPreferences | null = null;
  private readonly preferenceRequestOptions = {
    headers: new HttpHeaders({ 'X-Skip-Error-Modal': 'true' })
  };

  constructor(private http: HttpClient) {}

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

  saveExperimentalDailyDashboardChartOrder(
    chartOrder: string[],
    chartVisibility: Record<string, boolean> = {}
  ): Observable<UserPreferences> {
    const payload = {
      dashboardLayouts: {
        experimentalDailyDashboard: {
          chartOrder,
          chartVisibility
        }
      }
    };

    return this.http.put<UserPreferences>('/api/preferences/user', payload, this.preferenceRequestOptions).pipe(
      tap(preferences => {
        this.acceptUserPreferences(preferences);
      })
    );
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
      'machineDashboard',
      'operatorDashboard',
      'experimentalDailyDashboard'
    ];

    for (const dashboardName of dashboardNames) {
      const systemLayout = systemLayouts?.[dashboardName];
      const userLayout = userLayouts?.[dashboardName];
      if (!systemLayout && !userLayout) continue;
      dashboardLayouts[dashboardName] = {
        ...(systemLayout || {}),
        ...(userLayout || {})
      } as DashboardLayoutPreferences[typeof dashboardName];
    }

    return Object.keys(dashboardLayouts).length ? dashboardLayouts : undefined;
  }

  setExperimentalDailyDashboardChartOrder(
    chartOrder: string[],
    chartVisibility: Record<string, boolean> = {}
  ): void {
    const current = this.userPreferencesSubject.value || {};
    this.userPreferencesSubject.next({
      ...current,
      dashboardLayouts: {
        ...current.dashboardLayouts,
        experimentalDailyDashboard: {
          ...current.dashboardLayouts?.experimentalDailyDashboard,
          chartOrder,
          chartVisibility
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

