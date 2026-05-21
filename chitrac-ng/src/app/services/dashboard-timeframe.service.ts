import { Injectable } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { DateTimeService, DashboardTimeframeSelection } from './date-time.service';
import { SettingsService } from './settings.service';
import { ShiftService } from './shift.service';

@Injectable({
  providedIn: 'root',
})
export class DashboardTimeframeService {
  constructor(
    private dateTimeService: DateTimeService,
    private settingsService: SettingsService,
    private shiftService: ShiftService
  ) {}

  applyDefault(): Observable<DashboardTimeframeSelection> {
    const settings = this.settingsService.getSettings();
    const settings$ = settings ? of(settings) : this.settingsService.loadSettings();

    return settings$.pipe(
      switchMap((resolvedSettings) => {
        const preference = resolvedSettings.dashboardTimeframe ?? 'current';
        if (preference !== 'shift') {
          return of(
            this.dateTimeService.applyDashboardDefaultTimeframe('current', [])
          );
        }

        return forkJoin({
          settings: of(resolvedSettings),
          shifts: this.shiftService.getActiveShifts(),
        }).pipe(
          map(({ settings, shifts }) =>
            this.dateTimeService.applyDashboardDefaultTimeframe(
              settings.dashboardTimeframe ?? 'current',
              shifts.shifts || []
            )
          ),
          catchError(() =>
            of(this.dateTimeService.applyDashboardDefaultTimeframe('current', []))
          )
        );
      }),
      catchError(() =>
        of(this.dateTimeService.applyDashboardDefaultTimeframe('current', []))
      )
    );
  }
}
