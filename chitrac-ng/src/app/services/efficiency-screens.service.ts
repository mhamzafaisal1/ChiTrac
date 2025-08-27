import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class EfficiencyScreensService {
  constructor(private http: HttpClient) { }

  getLiveEfficiencySummary(serial: number, date: string): Observable<any> {
    const params = new HttpParams()
      .set('serial', serial.toString())
      .set('date', new Date(date).toISOString().split('T')[0]);
    return this.http.get('/api/alpha/analytics/machine-live-session-summary', { params });
  }

  getMachineLiveEfficiencySummary(serial: number): Observable<{ laneData: any }> {
    const params = new HttpParams().set('serial', String(serial));
    return this.http.get<{ laneData: any }>(
      '/api/alpha/analytics/machine-live-session-summary/machine',
      { params }
    );
  }
  


}
