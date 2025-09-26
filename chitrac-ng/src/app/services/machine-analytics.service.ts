import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class MachineAnalyticsService {
  private apiUrl = '/api/alpha';

  constructor(private http: HttpClient) {}

  getMachines(): Observable<any> {
    return this.http.get('/api/alpha/machines');
  }

  getMachineHourlyStates(machineSerial: string, endTime: string): Observable<any> {
    const endDate = new Date(endTime);
     // Set start to 12:00 AM of the endDate
  const startDate = new Date(endDate);
  startDate.setHours(0, 0, 0, 0);
  const startTime = startDate.toISOString();
  
    let params = new HttpParams()
      .set('startTime', startTime)
      .set('endTime', endTime);

    if (machineSerial) {
      params = params.set('machineSerial', machineSerial);
    }

    return this.http.get('/api/alpha/analytics/machine-hourly-states', { params });
  }

  getMachinePerformance(startTime: string, endTime: string, machineSerial?: number): Observable<any> {
    let params = new HttpParams()
      .set('startTime', startTime)
      .set('endTime', endTime);

    if (machineSerial) {
      params = params.set('machineSerial', machineSerial.toString());
    }

    return this.http.get('/api/alpha/analytics/machine-performance', { params });
  }

  getRunCycles(startTime: string, endTime: string, machineSerial: number): Observable<any> {
    const params = new HttpParams()
      .set('startTime', startTime)
      .set('endTime', endTime)
      .set('machineSerial', machineSerial.toString());

    return this.http.get('/api/alpha/run-session/state/cycles', { params });
  }

  getOperatorCycles(startTime: string, endTime: string, machineSerial?: number): Observable<any> {
    let params = new HttpParams()
      .set('startTime', startTime)
      .set('endTime', endTime);

    if (machineSerial) {
      params = params.set('machineSerial', machineSerial.toString());
    }

    return this.http.get('/api/alpha/run-session/state/operator-cycles', { params });
  }

  getMachineStateTotals(startTime: string, endTime: string, machineSerial?: number): Observable<any> {
    let params = new HttpParams()
      .set('startTime', startTime)
      .set('endTime', endTime);

    if (machineSerial) {
      params = params.set('machineSerial', machineSerial.toString());
    }

    return this.http.get('/api/alpha/analytics/machine-state-totals', { params });
  }

  getItemSummary(start: string, end: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/analytics/item-summary`, {
      params: { start, end }
    });
  }

  getItemSessionSummary(start: string, end: string): Observable<any> {
    return this.http.get('/api/alpha/analytics/item-sessions-summary', {
      params: { start, end }
    });
  }

  
  getMachineItemSummary(start: string, end: string, serial:number): Observable<any> {
    return this.http.get(`${this.apiUrl}/analytics/machine-item-summary`, {
      params: { start, end, serial }
    });
  }

  getMachineItemHourlyStack(start: string, end: string, serial: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/analytics/machine-item-hourly-item-stack`, {
      params: { start, end, serial }
    });
  }

  getMachineDashboard(start: string, end: string, serial?: number): Observable<any> {
    let params = new HttpParams()
      .set('start', start)
      .set('end', end);

    if (serial) {
      params = params.set('serial', serial.toString());
    }

    return this.http.get(`${this.apiUrl}/analytics/machine-dashboard-sessions`, { params });
  }

  getMachineSummary(start: string, end: string): Observable<any> {
    const params = new HttpParams()
      .set('start', start)
      .set('end', end);
  
    return this.http.get(`${this.apiUrl}/analytics/machines-summary-cached`, { params });
  }

  getMachineSummaryWithTimeframe(timeframe: string): Observable<any> {
    const params = new HttpParams()
      .set('timeframe', timeframe);
  
    return this.http.get(`${this.apiUrl}/analytics/machines-summary-cached`, { params });
  }

  getMachineDetails(start: string, end: string, serial: number): Observable<any> {
    const params = new HttpParams()
      .set('start', start)
      .set('end', end)
      .set('serial', serial.toString());
  
    return this.http.get(`${this.apiUrl}/analytics/machine-dashboard-cached`, { params });
  }

  getMachineDetailsWithTimeframe(timeframe: string, serial: number): Observable<any> {
    const params = new HttpParams()
      .set('timeframe', timeframe)
      .set('serial', serial.toString());
  
    return this.http.get(`${this.apiUrl}/analytics/machine-dashboard-cached`, { params });
  }
  
  
}
