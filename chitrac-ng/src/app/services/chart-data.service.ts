
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ChartDataService {
  private apiUrl = '/api/alpha';

  constructor(private http: HttpClient) { }

  /**
   * Get item stacked by hour data for charts
   * @param start Start date string
   * @param end End date string
   * @param operatorId Optional operator ID
   * @param serial Optional machine serial number
   * @returns Observable with item stacked chart data
   */
  getItemStackedByHour(start: string, end: string, operatorId?: number, serial?: number): Observable<any> {
    let params = new HttpParams()
      .set('start', start)
      .set('end', end);

    if (operatorId != null) {
      params = params.set('operatorId', operatorId.toString());
    }

    if (serial != null) {
      params = params.set('serial', serial.toString());
    }

    return this.http.get(`${this.apiUrl}/analytics/item-stacked-by-hour`, { params });
  }

}