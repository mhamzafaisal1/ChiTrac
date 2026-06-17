import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { of } from 'rxjs';

export interface AppSettings {
  enableApiTokenCheck: boolean;
  showErrorModals: boolean;
  defaultTheme: 'light' | 'dark';
  systemName: string;
}

export interface ThemeResponse {
  theme: 'light' | 'dark';
  source: 'user' | 'default';
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  enableApiTokenCheck: true,
  showErrorModals: true,
  defaultTheme: 'dark',
  systemName: 'ChiTrac'
};

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  private settingsSubject = new BehaviorSubject<AppSettings | null>(DEFAULT_APP_SETTINGS);
  public settings$ = this.settingsSubject.asObservable();

  private currentThemeSubject = new BehaviorSubject<'light' | 'dark'>('light');
  public currentTheme$ = this.currentThemeSubject.asObservable();

  constructor(private http: HttpClient) {}

  /**
   * Load application settings from the server
   */
  loadSettings(): Observable<AppSettings> {
    return this.http.get<AppSettings>('/api/utilities/settings', {
      headers: { 'X-Suppress-Error-Modal': 'true' }
    }).pipe(
      tap(settings => {
        this.settingsSubject.next(settings);
        console.log('[SettingsService] Settings loaded:', settings);
      }),
      catchError(error => {
        console.warn('[SettingsService] Failed to load settings, using defaults', error);
        this.settingsSubject.next(DEFAULT_APP_SETTINGS);
        return of(DEFAULT_APP_SETTINGS);
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
    return this.http.get<ThemeResponse>('/api/auth/user/theme').pipe(
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
    return this.http.put('/api/auth/user/theme', { theme }).pipe(
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

