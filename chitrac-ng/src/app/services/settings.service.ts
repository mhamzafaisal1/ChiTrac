import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  private settingsSubject = new BehaviorSubject<AppSettings | null>(null);
  public settings$ = this.settingsSubject.asObservable();

  private currentThemeSubject = new BehaviorSubject<'light' | 'dark'>('light');
  public currentTheme$ = this.currentThemeSubject.asObservable();

  constructor(private http: HttpClient) {}

  /**
   * Load application settings from the server
   */
  loadSettings(): Observable<AppSettings> {
    return this.http.get<AppSettings>('/api/utilities/settings').pipe(
      tap(settings => {
        this.settingsSubject.next(settings);
        console.log('[SettingsService] Settings loaded:', settings);
      })
    );
  }

  getSystemPreferences(): Observable<AppSettings> {
    return this.http.get<AppSettings>('/api/preferences/system');
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
    return this.http.get<ThemeResponse>('/api/preferences/user/theme').pipe(
      tap(response => {
        this.currentThemeSubject.next(response.theme);
        console.log('[SettingsService] Theme loaded:', response);
      })
    );
  }

  /**
   * Save user's theme preference to server
   */
  saveUserTheme(theme: 'light' | 'dark'): Observable<any> {
    return this.http.put('/api/preferences/user/theme', { theme }).pipe(
      tap(() => {
        this.currentThemeSubject.next(theme);
        console.log('[SettingsService] Theme saved:', theme);
      })
    );
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

