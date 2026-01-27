import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class EfficiencyScreensService {
  constructor(private http: HttpClient) { }

  getLiveEfficiencySummary(serial: number): Observable<any> {
    const params = new HttpParams()
      .set('serial', serial.toString());
    return this.http.get('/api/alpha/analytics/daily/machine-live-session-summary', { params });
  }

  getMachineLiveEfficiencySummary(serial: number): Observable<{ flipperData: any[] }> {
    const params = new HttpParams().set('serial', String(serial));
    return this.http.get<{ flipperData: any[] }>(
      '/api/alpha/analytics/machine-live-session-summary/machine',
      { params }
    );
  }

  getOperatorEfficiency(serial: number, station: number): Observable<any> {
    const params = new HttpParams()
      .set('serial', serial.toString())
      .set('station', station.toString());
    return this.http.get('/api/alpha/analytics/machine-live-session-summary/operator', { params });
  }

  getSPFMachines(): Observable<any[]> {
    return this.http.get<any[]>('/api/alpha/machines/spf');
  }
}
