import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class EfficiencyScreensService {
  private dashboardApiUrl = '/api/dashboard';

  constructor(private http: HttpClient) { }

  getLiveEfficiencySummary(serial: number): Observable<any> {
    const params = new HttpParams()
      .set('serial', serial.toString());
    return this.http.get(`${this.dashboardApiUrl}/analytics/daily/machine-live-session-summary`, { params });
  }

  getMachineLiveEfficiencySummary(serial: number): Observable<{ flipperData: any[] }> {
    const params = new HttpParams().set('serial', String(serial));
    return this.http.get<{ flipperData: any[] }>(
      `${this.dashboardApiUrl}/analytics/machine-live-session-summary/machine`,
      { params }
    );
  }

  getOperatorEfficiency(serial: number, station: number): Observable<any> {
    const params = new HttpParams()
      .set('serial', serial.toString())
      .set('station', station.toString());
    return this.http.get(`${this.dashboardApiUrl}/analytics/machine-live-session-summary/operator`, { params });
  }

  getSPFMachines(): Observable<any[]> {
    return this.http.get<any[]>('/api/machine/spf');
  }
}
