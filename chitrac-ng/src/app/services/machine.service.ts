import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs/internal/Observable';

import { HttpClient, HttpParams } from '@angular/common/http';

@Injectable({
    providedIn: 'root'
})
export class MachineService {
    private apiUrl = '/api/alpha';
    constructor(private http: HttpClient) { }

    getMachinesSummary(start: string, end: string): Observable<any> {
        const params = new HttpParams()
          .set('start', start)
          .set('end', end);
      
        return this.http.get(`${this.apiUrl}/analytics/machines-summary-daily-cached`, { params });
      }

      getMachineDetails(start: string, end: string, serial: number): Observable<any> {
        const params = new HttpParams()
          .set('start', start)
          .set('end', end)
          .set('serial', serial.toString());
      
        return this.http.get(`${this.apiUrl}/analytics/machine-dashboard-daily-cached`, { params });
      }

      getMachineSummaryWithTimeframe(timeframe: string): Observable<any> {
        const params = new HttpParams()
          .set('timeframe', timeframe);
      
        return this.http.get(`${this.apiUrl}/analytics/machine-summary-timeframe`, { params });
      }
    
    
    
      getMachineDetailsWithTimeframe(timeframe: string, serial: number): Observable<any> {
        const params = new HttpParams()
          .set('timeframe', timeframe)
          .set('serial', serial.toString());
      
        return this.http.get(`${this.apiUrl}/analytics/machine-dashboard-cached`, { params });
      }
      
}