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
  percentBreakpoints?: PercentBreakpoints;
  oePercentBreakpoints?: PercentBreakpoints;
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
  };
  experimentalDailyDashboard?: {
    chartOrder?: string[];
  };
}

export interface UserPreferences {
  userId?: string;
  theme?: 'light' | 'dark';
  defaultTheme?: 'light' | 'dark';
  dashboardLayouts?: DashboardLayoutPreferences;
  createdAt?: string | Date;
  updatedAt?: string | Date;
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
      })
    );
  }

  getSystemPreferences(): Observable<AppSettings> {
    return this.http.get<AppSettings>('/api/preferences/system');
  }

  loadUserPreferences(): Observable<UserPreferences> {
    return this.http.get<UserPreferences>('/api/preferences/user', this.preferenceRequestOptions).pipe(
      tap(preferences => {
        this.userPreferencesSubject.next(preferences);
        if (preferences.theme) {
          this.currentThemeSubject.next(preferences.theme);
        }
      })
    );
  }

  clearUserPreferences(): void {
    this.userPreferencesSubject.next(null);
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
        this.userPreferencesSubject.next(preferences);
      })
    );
  }

  saveExperimentalDailyDashboardChartOrder(chartOrder: string[]): Observable<UserPreferences> {
    const payload = {
      dashboardLayouts: {
        experimentalDailyDashboard: {
          chartOrder
        }
      }
    };

    return this.http.put<UserPreferences>('/api/preferences/user', payload, this.preferenceRequestOptions).pipe(
      tap(preferences => {
        this.userPreferencesSubject.next(preferences);
      })
    );
  }

  setExperimentalDailyDashboardChartOrder(chartOrder: string[]): void {
    const current = this.userPreferencesSubject.value || {};
    this.userPreferencesSubject.next({
      ...current,
      dashboardLayouts: {
        ...current.dashboardLayouts,
        experimentalDailyDashboard: {
          ...current.dashboardLayouts?.experimentalDailyDashboard,
          chartOrder
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

