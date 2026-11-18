import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CascadeSignals {
  readyToStart: boolean;
  paused: boolean;
  running: boolean;
  lowAir: boolean;
}

export interface CascadeSourceStatus {
  source: string;
  topic: string;
  signals: CascadeSignals;
  lastChangedAt: string;
  lastSeenAt: string;
  stale: boolean;
}

export interface CascadeStatusResponse {
  enabled: boolean;
  staleAfterMs: number;
  sources: CascadeSourceStatus[];
}

export interface CascadeEvent {
  source: string;
  topic: string;
  timestamp: string;
  signals: CascadeSignals;
  previous: CascadeSignals | null;
}

@Injectable({ providedIn: 'root' })
export class CascadeService {
  private apiUrl = '/api/cascade';

  constructor(private http: HttpClient) {}

  getStatus(): Observable<CascadeStatusResponse> {
    return this.http.get<CascadeStatusResponse>(`${this.apiUrl}/status`);
  }

  getEvents(limit = 50): Observable<{ events: CascadeEvent[] }> {
    return this.http.get<{ events: CascadeEvent[] }>(`${this.apiUrl}/events`, { params: new HttpParams().set('limit', limit) });
  }
}
