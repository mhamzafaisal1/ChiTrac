import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CascadeSignals {
  readyToStart: boolean;
  paused: boolean;
  running: boolean;
  lowAir: boolean;
  rts2?: boolean;
  rts3?: boolean;
}

export interface CascadeMachineStatus {
  code: number;
  name: string;
}

export interface CascadeSourceStatus {
  source: string;
  topic: string;
  signals: CascadeSignals;
  status?: CascadeMachineStatus;
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
  events?: string[];
  status?: CascadeMachineStatus;
  statusChanged?: boolean;
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
