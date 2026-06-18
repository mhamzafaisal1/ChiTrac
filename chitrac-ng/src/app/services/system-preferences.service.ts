import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SystemPreferences {
  _id: string;
  systemName?: string;
  defaultTheme?: 'light' | 'dark';
  logLevel?: string;
  httpsEnabled?: boolean;
  userSessionExpirationHours: number;
  userPermissionsLevels?: string[];
  operatorPaceHandicap?: Array<{
    daysOfEmployment: number;
    handicapFactor: number;
  }>;
  createdAt?: string;
  updatedAt?: string;
}

export interface SystemPreferencesUpdate {
  userSessionExpirationHours: number;
}

@Injectable({
  providedIn: 'root'
})
export class SystemPreferencesService {
  private apiUrl = '/api/system-preferences';

  constructor(private http: HttpClient) {}

  getPreferences(): Observable<SystemPreferences> {
    return this.http.get<SystemPreferences>(this.apiUrl);
  }

  updatePreferences(update: SystemPreferencesUpdate): Observable<SystemPreferences> {
    return this.http.put<SystemPreferences>(this.apiUrl, update);
  }

  resetPreferences(): Observable<SystemPreferences> {
    return this.http.delete<SystemPreferences>(this.apiUrl);
  }
}
