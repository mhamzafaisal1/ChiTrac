import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ReportSubscriptionDto {
  _id: string;
  name: string;
  enabled: boolean;
  report: { name: string; type: 'summary' | 'detailed' };
  email: { to: string; cc: string; bcc: string; subject: string; bodyText: string };
  schedule: { cron: string };
  timestamps?: any;
  lastAttempt?: any;
  log?: any;
}

export interface ReportSubscriptionPayload {
  name: string;
  enabled: boolean;
  report: { name: string; type: 'summary' | 'detailed' };
  email: { to: string; cc: string; bcc: string; subject: string; bodyText: string };
  schedule: { cron: string };
}

@Injectable({
  providedIn: 'root'
})
export class ReportsService {
  private apiUrl = '/api/reports';

  constructor(private http: HttpClient) { }


  getMachineReport(start: string, end: string, serial?: number): Observable<any> {
    let params = new HttpParams()
      .set('start', start)
      .set('end', end);

    if (serial) {
      params = params.set('serial', serial.toString());
    }

    // return this.http.get(`${this.apiUrl}/analytics/machine-item-sessions-summary-cache`, { params });
    return this.http.get(`${this.apiUrl}/analytics/machine-report-cache`, { params });
  }

  getOperatorReport(start: string, end: string, operatorId?: number): Observable<any> {
    let params = new HttpParams()
      .set('start', start)
      .set('end', end);

    if (operatorId) {
      params = params.set('operatorId', operatorId.toString());
    }

    return this.http.get(`${this.apiUrl}/analytics/operator-item-sessions-summary-cache`, { params });
  }

  getItemReport(start: string, end: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/analytics/item-sessions-summary-daily-cache`, {
      params: { start, end }
    });
  }

  emailMachineReport(payload: {
    to: string;
    pdfBase64: string;
    start: string;
    end: string;
    summaryOnly: boolean;
  }): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `${this.apiUrl}/analytics/machine-report-email`,
      payload
    );
  }

  listReportSubscriptions(): Observable<ReportSubscriptionDto[]> {
    return this.http.get<ReportSubscriptionDto[]>(`${this.apiUrl}/report-subscriptions`);
  }

  getReportSubscription(id: string): Observable<ReportSubscriptionDto> {
    return this.http.get<ReportSubscriptionDto>(`${this.apiUrl}/report-subscriptions/${id}`);
  }

  createReportSubscription(payload: ReportSubscriptionPayload): Observable<ReportSubscriptionDto> {
    return this.http.post<ReportSubscriptionDto>(`${this.apiUrl}/report-subscriptions`, payload);
  }

  updateReportSubscription(id: string, payload: ReportSubscriptionPayload): Observable<ReportSubscriptionDto> {
    return this.http.put<ReportSubscriptionDto>(`${this.apiUrl}/report-subscriptions/${id}`, payload);
  }

  deleteReportSubscription(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.apiUrl}/report-subscriptions/${id}`);
  }
}
