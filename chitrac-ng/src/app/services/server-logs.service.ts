import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ServerLog {
  _id: string;
  timestamp: Date;
  level: string;
  message: string;
  meta: any;
  hostname: string;
}

export interface ServerLogsResponse {
  logs: ServerLog[];
  pagination: {
    total: number;
    limit: number;
    skip: number;
    hasMore: boolean;
  };
}

@Injectable({
  providedIn: 'root'
})
export class ServerLogsService {
  private apiUrl = '/api/utilities';

  constructor(private http: HttpClient) { }

  getServerLogs(options: {
    start?: string;
    end?: string;
    level?: string;
    limit?: number;
    skip?: number;
  }): Observable<ServerLogsResponse> {
    let params = new HttpParams();

    if (options.start) {
      params = params.set('start', options.start);
    }
    if (options.end) {
      params = params.set('end', options.end);
    }
    if (options.level) {
      params = params.set('level', options.level);
    }
    if (options.limit) {
      params = params.set('limit', options.limit.toString());
    }
    if (options.skip) {
      params = params.set('skip', options.skip.toString());
    }

    return this.http.get<ServerLogsResponse>(`${this.apiUrl}/server-logs`, { params });
  }
}

