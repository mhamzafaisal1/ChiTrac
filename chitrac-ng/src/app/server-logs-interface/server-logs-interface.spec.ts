import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { TimeframePickerComponent } from '../components/timeframe-picker/timeframe-picker.component';
import { PercentBreakpointService } from '../services/percent-breakpoint.service';
import { ServerLogsService } from '../services/server-logs.service';
import { ShiftService } from '../services/shift.service';
import { ServerLogsInterfaceComponent } from './server-logs-interface';

describe('Server Logs timeframe', () => {
  it('uses the shared picker and resets pagination only when the draft range is applied', () => {
    const getServerLogs = jasmine.createSpy('getServerLogs').and.returnValue(of({
      logs: [],
      pagination: { total: 200, hasMore: true },
    }));
    const getActiveShifts = jasmine.createSpy('getActiveShifts');
    TestBed.configureTestingModule({
      imports: [ServerLogsInterfaceComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ServerLogsService, useValue: { getServerLogs } },
        { provide: ShiftService, useValue: { getActiveShifts } },
        { provide: PercentBreakpointService, useValue: { getColorClass: () => '' } },
      ],
    });

    const fixture = TestBed.createComponent(ServerLogsInterfaceComponent);
    fixture.detectChanges();
    const page = fixture.componentInstance;
    const pickerElement = fixture.debugElement.query(By.directive(TimeframePickerComponent));
    const picker: TimeframePickerComponent = pickerElement.componentInstance;
    expect(pickerElement.nativeElement.textContent).not.toContain('Shift filter');
    expect(getActiveShifts).not.toHaveBeenCalled();

    const initial = getServerLogs.calls.mostRecent().args[0];
    expect(Date.parse(initial.end) - Date.parse(initial.start)).toBe(86_400_000);
    page.selectedLevel = 'warn';
    page.onLevelChange();
    page.loadMore();
    expect(getServerLogs.calls.mostRecent().args[0]).toEqual({ ...initial, level: 'warn', skip: page.pageSize });

    const beforeApply = getServerLogs.calls.count();
    picker.quickSelect('yesterday');
    expect(getServerLogs.calls.count()).toBe(beforeApply);
    const range = { start: picker.pickerStart!.toISOString(), end: picker.pickerEnd!.toISOString() };
    pickerElement.query(By.css('.picker-actions button')).nativeElement.click();
    expect(getServerLogs.calls.count()).toBe(beforeApply + 1);
    expect(getServerLogs.calls.mostRecent().args[0]).toEqual({ ...initial, ...range, level: 'warn', skip: 0 });
    expect(page.timeframeMode).toBe('yesterday');

    page.loadMore();
    expect(getServerLogs.calls.mostRecent().args[0]).toEqual({ ...initial, ...range, level: 'warn', skip: page.pageSize });
  });
});
