import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs/internal/Observable';

import { HttpClient, HttpParams } from '@angular/common/http';

@Injectable({
    providedIn: 'root'
})
export class MachineService {
    private machineApiUrl = '/api/machine';
    private alphaApiUrl = '/api/alpha';
    constructor(private http: HttpClient) { }

    getMachinesSummary(start: string, end: string, shiftId?: string | null): Observable<any> {
        let params = new HttpParams()
          .set('start', start)
          .set('end', end);
        if (shiftId) params = params.set('shiftId', shiftId);
      
        return this.http.get(`${this.machineApiUrl}/analytics/machines-summary-daily-cached`, { params });
      }

      getMachineDetails(start: string, end: string, serial: number, shiftId?: string | null): Observable<any> {
        let params = new HttpParams()
          .set('start', start)
          .set('end', end)
          .set('serial', serial.toString());
        if (shiftId) params = params.set('shiftId', shiftId);
      
        return this.http.get(`${this.machineApiUrl}/analytics/machine-dashboard-daily-cached`, { params });
      }

      getMachineSummaryWithTimeframe(timeframe: string, shiftId?: string | null): Observable<any> {
        let params = new HttpParams()
          .set('timeframe', timeframe);
        if (shiftId) params = params.set('shiftId', shiftId);
      
        return this.http.get(`${this.alphaApiUrl}/analytics/machine-summary-timeframe`, { params });
      }
    
    
    
      getMachineDetailsWithTimeframe(timeframe: string, serial: number, shiftId?: string | null): Observable<any> {
        let params = new HttpParams()
          .set('timeframe', timeframe)
          .set('serial', serial.toString());
        if (shiftId) params = params.set('shiftId', shiftId);
      
        return this.http.get(`${this.alphaApiUrl}/analytics/machine-dashboard-cached`, { params });
      }
      
}
