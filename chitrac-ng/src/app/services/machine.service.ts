import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs/internal/Observable';

import { HttpClient, HttpParams } from '@angular/common/http';
import { DateTimeService } from './date-time.service';

@Injectable({
    providedIn: 'root'
})
export class MachineService {
    private machineApiUrl = '/api/machine';
    constructor(
      private http: HttpClient,
      private dateTimeService: DateTimeService
    ) { }

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
        return this.getMachinesSummary(
          this.dateTimeService.getStartTime(),
          this.dateTimeService.getEndTime(),
          shiftId
        );
      }
    
    
    
      getMachineDetailsWithTimeframe(timeframe: string, serial: number, shiftId?: string | null): Observable<any> {
        return this.getMachineDetails(
          this.dateTimeService.getStartTime(),
          this.dateTimeService.getEndTime(),
          serial,
          shiftId
        );
      }
      
}
