import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class OperatorAnalyticsService {

  constructor(private http: HttpClient) { }

  getOperatorDashboard(startTime: string, endTime: string, operatorId?: number): Observable<any> {
    let params = new HttpParams()
      .set('startTime', startTime)
      .set('endTime', endTime);

    if (operatorId) {
      params = params.set('operatorId', operatorId.toString());
    }

    return this.http.get('/api/alpha/analytics/operator-dashboard-sessions', { params });
  }

  getOperatorSummary(startTime: string, endTime: string): Observable<any> {
    const params = new HttpParams()
      .set('start', startTime)
      .set('end', endTime);

    return this.http.get('/api/alpha/analytics/operators-summary', { params });
  }

  getOperatorDetails(start: string, end: string, operatorId: number): Observable<any> {
    const params = new HttpParams()
      .set('start', start)
      .set('end', end)
      .set('operatorId', operatorId.toString());
  
    return this.http.get('/api/alpha/analytics/operator-dashboard', { params });
  }

  getOperatorInfo(start: string, end: string, operatorId: number): Observable<any> {
    const params = new HttpParams()
      .set('start', start)
      .set('end', end)
      .set('operatorId', operatorId.toString());
  
    return this.http.get('/api/alpha/analytics/operator-details', { params });
  }
  

  getOperatorPerformance(startTime: string, endTime: string, operatorId?: number): Observable<any> {
    let params = new HttpParams()
      .set('startTime', startTime)
      .set('endTime', endTime);

    if (operatorId) {
      params = params.set('operatorId', operatorId.toString());
    }

    return this.http.get('/api/alpha/analytics/operator-performance', { params });
  }

  getOperatorCycles(startTime: string, endTime: string, operatorId?: number): Observable<any> {
    let params = new HttpParams()
      .set('startTime', startTime)
      .set('endTime', endTime);

    if (operatorId) {
      params = params.set('operatorId', operatorId.toString());
    }

    return this.http.get('/api/alpha/run-session/state/operator-cycles', { params });
  }

  getOperatorCyclePieData(startTime: string, endTime: string, operatorId: number): Observable<any> {
    let params = new HttpParams()
      .set('startTime', startTime)
      .set('endTime', endTime)
      .set('operatorId', operatorId.toString());

    return this.http.get('/api/alpha/analytics/operator-cycle-pie', { params });
  }
}
