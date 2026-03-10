import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class DailyDashboardService {
  private apiUrl = '/api/alpha';

  constructor(private http: HttpClient) { }

  getMachineStatus(start: string, end: string, serial?: number): Observable<any> {
    let params = new HttpParams()
      .set('start', start)
      .set('end', end);

    if (serial) {
      params = params.set('serial', serial.toString());
    }

    return this.http.get(`${this.apiUrl}/analytics/daily-dashboard/machine-status`, { params });
  }

  getMachineOee(start: string, end: string): Observable<any> {
    const params = new HttpParams().set('start', start).set('end', end);
    return this.http.get(`${this.apiUrl}/analytics/daily-dashboard/machine-oee`, { params });
  }

  getAllMachinesItemHourlyStack(start: string, end: string): Observable<any> {
    const params = new HttpParams().set('start', start).set('end', end);
    return this.http.get(`${this.apiUrl}/analytics/daily-dashboard/item-hourly-stack`, { params });
  }

  getTopOperatorEfficiency(start: string, end: string): Observable<any> {
    const params = new HttpParams().set('start', start).set('end', end);
    return this.http.get(`${this.apiUrl}/analytics/daily-dashboard/operator-efficiency-top10`, { params });
  }

  getPlantwideMetricsByHour(start: string, end: string): Observable<any> {
    const params = new HttpParams().set('start', start).set('end', end);
    return this.http.get(`${this.apiUrl}/analytics/daily-dashboard/plantwide-metrics-by-hour`, { params });
  }

  /** ✅ New consolidated route for entire dashboard */
  getFullDailyDashboard(start: string, end: string): Observable<any> {
    const params = new HttpParams().set('start', start).set('end', end);
    return this.http.get('/api/alpha/analytics/daily-sessions-dashboard', { params });
  }

  /** ✅ New summary dashboard route for machines, operators, and items */
  getDailySummaryDashboard(start: string, end: string): Observable<any> {
    const params = new HttpParams().set('start', start).set('end', end);
    return this.http.get(`${this.apiUrl}/analytics/daily-summary-dashboard`, { params });
  }

  // daily-dashboard.service.ts
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

  /** ✅ New daily dashboard session split individual routes */
  getDailyMachineStatus(start: string, end: string, serial?: number): Observable<any> {
    let params = new HttpParams()
      .set('start', start)
      .set('end', end);

    if (serial) {
      params = params.set('serial', serial.toString());
    }

    return this.http.get(`${this.apiUrl}/analytics/daily/machine-status`, { params });
  }

  getDailyMachineStatusFast(start: string, end: string, serial?: number): Observable<any> {
    let params = new HttpParams()
      .set('start', start)
      .set('end', end);

    if (serial) {
      params = params.set('serial', serial.toString());
    }

    return this.http.get(`${this.apiUrl}/analytics/daily/machine-status-state`, { params });
  }

  getDailyMachineOee(start: string, end: string): Observable<any> {
    const params = new HttpParams().set('start', start).set('end', end);
    return this.http.get(`${this.apiUrl}/analytics/daily/machine-oee`, { params });
  }

  getDailyItemHourlyProduction(start: string, end: string): Observable<any> {
    const params = new HttpParams().set('start', start).set('end', end);
    return this.http.get(`${this.apiUrl}/analytics/hourly/item-hourly-production`, { params });
  }

  getItemTotalsByType(start: string, end: string): Observable<any> {
    const params = new HttpParams().set('start', start).set('end', end);
    return this.http.get(`${this.apiUrl}/analytics/hourly/item-totals-by-type`, { params });
  }

  getDailyTopOperators(start: string, end: string): Observable<any> {
    const params = new HttpParams().set('start', start).set('end', end);
    return this.http.get(`${this.apiUrl}/analytics/daily/top-operators-state`, { params });
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
    return this.http.get(`${this.apiUrl}/analytics/daily/count-totals-state`, { params });
  }

  /** Machine groups (departments) summary with efficiency per group – used for Efficiency% by Machine Group chart */
  getMachinesGroupSummary(start: string, end: string, serial?: number): Observable<any> {
    let params = new HttpParams().set('start', start).set('end', end);
    if (serial != null) params = params.set('serial', String(serial));
    // Use state + count based endpoint for more accurate, fully recomputed metrics
    return this.http.get(`${this.apiUrl}/analytics/machines-group-summary-daily-state`, { params });
  }

  getMachineItemSessionsSummary(start: string, end: string, serial?: number): Observable<any> {
    let params = new HttpParams()
      .set('start', start)
      .set('end', end);

    if (serial) {
      params = params.set('serial', serial.toString());
    }

    // Uses state + count collections (machine-item-states-summary returns array; wrap as { results } for component)
    return this.http.get<any[]>(`${this.apiUrl}/analytics/machine-item-states-summary`, { params }).pipe(
      map((results) => ({ results: results ?? [] }))
    );
  }

  getOperatorItemSessionsSummary(start: string, end: string, operatorId?: number): Observable<any> {
    let params = new HttpParams()
      .set('start', start)
      .set('end', end);

    if (operatorId) {
      params = params.set('operatorId', operatorId.toString());
    }

    // return this.http.get(`${this.apiUrl}/analytics/operator-item-sessions-summary-cache`, { params });
    return this.http.get(`${this.apiUrl}/analytics/operator-item-states-summary`, { params });
  }

}
