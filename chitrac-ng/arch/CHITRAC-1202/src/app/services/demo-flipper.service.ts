import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class DemoFlipperService {
  private apiUrl = '/api/alpha';

  constructor(private http: HttpClient) { }

  getLiveEfficiencySummary(serial: number, date: string): Observable<any> {
    const params = new HttpParams()
      .set('serial', serial.toString())
      .set('date', new Date(date).toISOString().split('T')[0]);
    return this.http.get('http://localhost:9090/api/alpha/analytics/flipper-live-summary', { params });
  }
}
