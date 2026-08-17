import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { DateTimeService } from './date-time.service';

@Injectable({
  providedIn: 'root'
})
export class OperatorService {
    private apiUrl = '/api/operator';
  constructor(
    private http: HttpClient,
    private dateTimeService: DateTimeService
  ) { }

  getOperatorSummary(startTime: string, endTime: string, shiftId?: string | null): Observable<any> {
    let params = new HttpParams()
      .set('start', startTime)
      .set('end', endTime);
    if (shiftId) params = params.set('shiftId', shiftId);

    return this.http.get(`${this.apiUrl}/analytics/operators-summary-daily-cached`, { params });
  }

  getIdleOperatorSummary(startTime?: string, endTime?: string, shiftId?: string | null): Observable<any> {
    let params = new HttpParams();
    if (startTime) params = params.set('start', startTime);
    if (endTime) params = params.set('end', endTime);
    if (shiftId) params = params.set('shiftId', shiftId);

    return this.http.get(`${this.apiUrl}/analytics/idle-operators`, { params });
  }

  getOperatorDetails(start: string, end: string, operatorId: number): Observable<any> {
    const params = new HttpParams()
      .set('start', start)
      .set('end', end)
      .set('operatorId', operatorId.toString());
  
    return this.http.get(`${this.apiUrl}/analytics/operator-details-cached`, { params });
  }

  
  getOperatorMachineSummary(start: string, end: string, operatorId: number): Observable<any> {
    const params = new HttpParams()
      .set('start', start)
      .set('end', end)
      .set('operatorId', operatorId.toString());
  
    return this.http.get(`${this.apiUrl}/analytics/operator-machine-summary`, { params });
  }
  

  getOperatorSummaryWithTimeframe(timeframe: string, shiftId?: string | null): Observable<any> {
    return this.getOperatorSummary(
      this.dateTimeService.getStartTime(),
      this.dateTimeService.getEndTime(),
      shiftId
    );
  }

  
  getOperatorDetailsWithTimeFrame(start: string, end: string, operatorId: number): Observable<any> {
    return this.getOperatorDetails(start, end, operatorId);
  }
}
