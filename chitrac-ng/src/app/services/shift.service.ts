import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ShiftListItem {
  _id: string;
  name?: string;
  active?: boolean;
  startTime?: { hour: number; minute: number };
  endTime?: { hour: number; minute: number };
  activeDays?: number[];
}

@Injectable({
  providedIn: 'root',
})
export class ShiftService {
  private apiUrl = '/api/reports';

  constructor(private http: HttpClient) {}

  getActiveShifts(): Observable<{ shifts: ShiftListItem[] }> {
    return this.http.get<{ shifts: ShiftListItem[] }>(`${this.apiUrl}/shifts`);
  }
}
