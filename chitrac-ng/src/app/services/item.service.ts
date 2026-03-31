import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ItemAnalyticsRow {
  itemId: number;
  itemName: string;
  workedTimeFormatted: {
    hours: number;
    minutes: number;
  };
  count: number;
  pph: number;
  standard: number;
  efficiency: number;
}

@Injectable({
  providedIn: 'root'
})
export class ItemService {
  private apiUrl = '/api/alpha';
  constructor(private http: HttpClient) {}

  getItemAnalytics(startTime: string, endTime: string): Observable<ItemAnalyticsRow[]> {
    const params = new HttpParams()
      .set('start', startTime)
      .set('end', endTime);

    return this.http.get<ItemAnalyticsRow[]>(`${this.apiUrl}/analytics/items-summary-daily-cache`, { params });
  }
}
