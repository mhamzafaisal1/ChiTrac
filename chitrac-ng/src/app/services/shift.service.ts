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

/** Full shift document from GET /api/alpha/shifts (settings list / edit). */
export interface ShiftDocument extends ShiftListItem {
  breaks?: ShiftBreakPayload[];
  shiftTime?: number;
  timestamps?: ShiftDefinitionPayload['timestamps'];
}

export interface ShiftTimeValue {
  hour: number;
  minute: number;
}

export interface ShiftBreakPayload {
  active: boolean;
  timestamps: {
    create: string;
    active: string;
    update: string;
    start?: string;
    end?: string;
    inactive?: string;
  };
  breakTime: number;
  startTime: ShiftTimeValue;
  endTime: ShiftTimeValue;
  name?: string;
}

export interface ShiftDefinitionPayload {
  _id?: string;
  active: boolean;
  timestamps: {
    create: string;
    active: string;
    update: string;
    start?: string;
    end?: string;
    inactive?: string;
  };
  shiftTime: number;
  breaks: ShiftBreakPayload[];
  startTime: ShiftTimeValue;
  endTime: ShiftTimeValue;
  activeDays: number[];
  name?: string;
}

@Injectable({
  providedIn: 'root',
})
export class ShiftService {
  private apiUrl = '/api/reports';
  private alphaUrl = '/api/alpha';

  constructor(private http: HttpClient) {}

  getActiveShifts(): Observable<{ shifts: ShiftListItem[] }> {
    return this.http.get<{ shifts: ShiftListItem[] }>(`${this.apiUrl}/shifts`);
  }

  /** All shifts (active and inactive), sorted by start time on the server. */
  getAllShifts(): Observable<{ shifts: ShiftDocument[] }> {
    return this.http.get<{ shifts: ShiftDocument[] }>(`${this.alphaUrl}/shifts`);
  }

  deleteShift(id: string): Observable<void> {
    return this.http.delete<void>(
      `${this.alphaUrl}/shifts/${encodeURIComponent(id)}`
    );
  }

  saveShiftDefinition(shift: ShiftDefinitionPayload): Observable<ShiftDefinitionPayload> {
    if (shift._id) {
      return this.http.put<ShiftDefinitionPayload>(
        `${this.alphaUrl}/shifts/${encodeURIComponent(String(shift._id))}`,
        shift
      );
    }
    return this.http.post<ShiftDefinitionPayload>(`${this.alphaUrl}/shifts`, shift);
  }
}
