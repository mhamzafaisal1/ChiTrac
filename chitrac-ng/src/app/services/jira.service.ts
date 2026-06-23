import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ErrorInfo } from './error-queue.service';

export interface JiraBugReportResponse {
  success: boolean;
  action?: 'created' | 'commented';
  key: string;
  id: string;
  url: string;
}

@Injectable({
  providedIn: 'root'
})
export class JiraService {
  constructor(private http: HttpClient) {}

  reportBug(error: ErrorInfo): Observable<JiraBugReportResponse> {
    const user = this.getStoredUser();
    const payload = {
      message: error.message,
      statusCode: error.statusCode,
      endpoint: error.endpoint,
      timestamp: error.timestamp.toISOString(),
      fullError: error.fullError,
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
      user: user ? {
        username: user.username,
        email: user.email,
        role: user.role,
        permissions: user.permissions
      } : null
    };

    const headers = new HttpHeaders({ 'X-Skip-Error-Modal': 'true' });
    return this.http.post<JiraBugReportResponse>('/api/jira/report-bug', payload, { headers });
  }

  private getStoredUser(): any | null {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch (error) {
      return null;
    }
  }
}
