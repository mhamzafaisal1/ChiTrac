import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

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
}
