import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ConfigurationCacheService } from './configuration-cache.service';

export interface ShiftListItem {
  _id: string;
  id: number;
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
  id?: number;
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

export type MaintenanceShiftDocument = Omit<ShiftDocument, 'breaks'>;

export type MaintenanceShiftDefinitionPayload = Omit<ShiftDefinitionPayload, 'breaks'>;

@Injectable({
  providedIn: 'root',
})
export class ShiftService {
  private alphaUrl = '/api/alpha';

  constructor(private http: HttpClient, private readonly cache: ConfigurationCacheService) {}

  getActiveShifts(skipErrorModal = false): Observable<{ shifts: ShiftListItem[] }> {
    return this.getAllShifts().pipe(map(({ shifts }) => ({ shifts: shifts.filter(shift => shift.active === true)
      .sort((a, b) => this.startMinutes(a) - this.startMinutes(b) || (a.name || '').localeCompare(b.name || '')) })));
  }

  /** All shifts (active and inactive), sorted by start time on the server. */
  getAllShifts(): Observable<{ shifts: ShiftDocument[] }> {
    return this.cache.read<ShiftDocument>('shift').pipe(map(shifts => ({ shifts: this.sortShifts(shifts) })));
  }

  watchAllShifts(): Observable<{ shifts: ShiftDocument[] }> {
    return this.cache.watch<ShiftDocument>('shift').pipe(map(shifts => ({ shifts: this.sortShifts(shifts) })));
  }

  watchAllMaintenanceShifts(): Observable<{ shifts: MaintenanceShiftDocument[] }> {
    return this.cache.watch<MaintenanceShiftDocument>('maintenanceShift').pipe(map(shifts => ({ shifts: this.sortShifts(shifts) })));
  }

  private startMinutes(shift: ShiftListItem): number {
    return shift.startTime ? shift.startTime.hour * 60 + shift.startTime.minute : Infinity;
  }

  private sortShifts<T extends ShiftListItem>(shifts: T[]): T[] {
    return shifts.sort((a, b) => this.startMinutes(a) - this.startMinutes(b));
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

  /** All maintenance shifts (active and inactive), sorted by start time on the server. */
  getAllMaintenanceShifts(): Observable<{ shifts: MaintenanceShiftDocument[] }> {
    return this.cache.read<MaintenanceShiftDocument>('maintenanceShift').pipe(map(shifts => ({ shifts: this.sortShifts(shifts) })));
  }

  deleteMaintenanceShift(id: string): Observable<void> {
    return this.http.delete<void>(
      `${this.alphaUrl}/maintenance-shifts/${encodeURIComponent(id)}`
    );
  }

  saveMaintenanceShiftDefinition(
    shift: MaintenanceShiftDefinitionPayload
  ): Observable<MaintenanceShiftDefinitionPayload> {
    if (shift._id) {
      return this.http.put<MaintenanceShiftDefinitionPayload>(
        `${this.alphaUrl}/maintenance-shifts/${encodeURIComponent(String(shift._id))}`,
        shift
      );
    }
    return this.http.post<MaintenanceShiftDefinitionPayload>(
      `${this.alphaUrl}/maintenance-shifts`,
      shift
    );
  }
}
