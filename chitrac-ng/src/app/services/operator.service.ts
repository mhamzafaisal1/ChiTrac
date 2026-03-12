import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class OperatorService {
    private apiUrl = '/api/alpha';
  constructor(private http: HttpClient) { }

  getOperatorSummary(startTime: string, endTime: string): Observable<any> {
    const params = new HttpParams()
      .set('start', startTime)
      .set('end', endTime);

    return this.http.get(`${this.apiUrl}/analytics/operators-summary-daily-cached`, { params });
  }

  getOperatorDetails(start: string, end: string, operatorId: number): Observable<any> {
    const params = new HttpParams()
      .set('start', start)
      .set('end', end)
      .set('operatorId', operatorId.toString());
  
    return this.http.get('/api/alpha/analytics/operator-details-cached', { params });
  }

  
  getOperatorMachineSummary(start: string, end: string, operatorId: number): Observable<any> {
    const params = new HttpParams()
      .set('start', start)
      .set('end', end)
      .set('operatorId', operatorId.toString());
  
    return this.http.get('/api/alpha/analytics/operator-machine-summary', { params });
  }
  

  getOperatorSummaryWithTimeframe(timeframe: string): Observable<any> {
    const params = new HttpParams()
      .set('timeframe', timeframe);

    return this.http.get('/api/alpha/analytics/operator-summary-timeframe', { params });
  }

  
  getOperatorDetailsWithTimeFrame(start: string, end: string, operatorId: number): Observable<any> {
    const params = new HttpParams()
      .set('start', start)
      .set('end', end)
      .set('operatorId', operatorId.toString());
  
    return this.http.get('/api/alpha/analytics/operator-dashboard', { params });
  }
}