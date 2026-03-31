import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class DashboardService {
  private apiUrl = '/api/alpha';

  constructor(private http: HttpClient) { }


  // Daily Summary Dashboard 
getMachinesSummary(start: string, end: string, serial?: number) {
  let params = new HttpParams().set('start', start).set('end', end);
  if (serial != null) params = params.set('serial', String(serial));
  return this.http.get(`${this.apiUrl}/analytics/daily-summary-dashboard/machines`, { params });
}
getOperatorsSummary(start: string, end: string) {
  const params = new HttpParams().set('start', start).set('end', end);
  return this.http.get(`${this.apiUrl}/analytics/daily-summary-dashboard/operators`, { params });
}
getItemsSummary(start: string, end: string, serial?: number) {
  let params = new HttpParams().set('start', start).set('end', end);
  if (serial != null) params = params.set('serial', String(serial));
  return this.http.get(`${this.apiUrl}/analytics/daily-summary-dashboard/items`, { params });
}

//The 6 chart Daily Dashboard 

  getDailyMachineStatus(start: string, end: string, serial?: number): Observable<any> {
    let params = new HttpParams()
      .set('start', start)
      .set('end', end);

    if (serial) {
      params = params.set('serial', serial.toString());
    }

    return this.http.get(`${this.apiUrl}/analytics/daily/machine-status-cache`, { params });
  }

  getDailyMachineOee(start: string, end: string): Observable<any> {
    const params = new HttpParams().set('start', start).set('end', end);
    return this.http.get(`${this.apiUrl}/analytics/daily/machine-oee`, { params });
  }


  getItemTotalsByType(start: string, end: string): Observable<any> {
    const params = new HttpParams().set('start', start).set('end', end);
    return this.http.get(`${this.apiUrl}/analytics/hourly/item-totals-by-type`, { params });
  }

  getDailyTopOperators(start: string, end: string): Observable<any> {
    const params = new HttpParams().set('start', start).set('end', end);
    return this.http.get(`${this.apiUrl}/analytics/daily/top-operators-cache`, { params });
  }

  getDailyTopFaults(start: string, end: string): Observable<any> {
    const params = new HttpParams().set('start', start).set('end', end);
    return this.http.get(`${this.apiUrl}/analytics/daily/top-faults`, { params });
  }

  getDailyPlantwideMetrics(start: string, end: string): Observable<any> {
    const params = new HttpParams().set('start', start).set('end', end);
    return this.http.get(`${this.apiUrl}/analytics/daily/plantwide-metrics-cache`, { params });
  }

  getDailyCountTotals(start: string, end: string): Observable<any> {
    const params = new HttpParams().set('start', start).set('end', end);
    return this.http.get(`${this.apiUrl}/analytics/daily/count-totals-cache`, { params });
  }

  /** Machine groups (departments) summary with efficiency per group – used for Efficiency% by Machine Group chart */
  getMachinesGroupSummary(start: string, end: string, serial?: number): Observable<any> {
    let params = new HttpParams().set('start', start).set('end', end);
    if (serial != null) params = params.set('serial', String(serial));
    return this.http.get(`${this.apiUrl}/analytics/machines-group-summary-daily-cached`, { params });
  }


}
