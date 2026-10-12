import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { MachineFaultHistoryComponent } from './machine-fault-history.component';
import { FaultService, FaultHistoryResponse } from '../services/fault.service';
import { PollingService } from '../services/polling-service.service';
import { DateTimeService } from '../services/date-time.service';

describe('Machine modal fault states', () => {
  let fixture: ComponentFixture<MachineFaultHistoryComponent>;
  let component: MachineFaultHistoryComponent;
  let response$: Subject<FaultHistoryResponse>;
  let faultService: jasmine.SpyObj<FaultService>;
  const summary = { name: 'Jam', count: 1, totalDurationSeconds: 60 };
  const cycle = { name: 'Jam', start: '2026-10-12T08:00:00Z', durationSeconds: 60 };

  beforeEach(async () => {
    response$ = new Subject<FaultHistoryResponse>();
    faultService = jasmine.createSpyObj('FaultService', ['getFaultHistoryBySerial']);
    faultService.getFaultHistoryBySerial.and.returnValue(response$);
    TestBed.configureTestingModule({
      imports: [MachineFaultHistoryComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: null },
        { provide: FaultService, useValue: faultService },
        { provide: PollingService, useValue: {} },
        { provide: DateTimeService, useValue: { liveMode$: new Subject(), confirmTrigger$: new Subject() } },
      ],
    });
    fixture = TestBed.createComponent(MachineFaultHistoryComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('isModal', true);
    fixture.componentRef.setInput('mode', 'dashboard');
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  for (const view of ['summary', 'cycles'] as const) {
    const key = view === 'summary' ? 'faultSummaries' : 'faultCycles';
    for (const format of ['array', 'object']) {
      it(`shows the icon and no table for empty ${view} ${format} data`, () => {
        fixture.componentRef.setInput('viewType', view);
        fixture.componentRef.setInput('preloadedData', format === 'array' ? [] : { [key]: [] });
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.chart-no-data-icon')).not.toBeNull();
        expect(fixture.nativeElement.textContent).toContain('No faults recorded for the selected time range.');
        expect(fixture.nativeElement.querySelector('base-table')).toBeNull();
        expect(faultService.getFaultHistoryBySerial).not.toHaveBeenCalled();
      });

      it(`renders populated ${view} ${format} data instead of the empty state`, () => {
        const rows = [view === 'summary' ? summary : cycle];
        fixture.componentRef.setInput('viewType', view);
        fixture.componentRef.setInput('preloadedData', format === 'array' ? rows : { [key]: rows });
        fixture.detectChanges();
        expect(component.rows.length).toBe(1);
        expect(fixture.nativeElement.querySelector('base-table')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.chart-no-data')).toBeNull();
      });
    }
  }

  it('bases the empty state on the selected tab and preserves input cycle order', () => {
    const earlier = { ...cycle, start: '2026-10-12T07:00:00Z' };
    const cycles = Object.freeze([earlier, cycle]);
    fixture.componentRef.setInput('preloadedData', { faultSummaries: [], faultCycles: cycles });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chart-no-data-icon')).not.toBeNull();
    fixture.componentRef.setInput('viewType', 'cycles');
    fixture.detectChanges();
    expect(component.rows.length).toBe(2);
    expect(fixture.nativeElement.querySelector('.chart-no-data')).toBeNull();
    expect(cycles[0]).toBe(earlier);
  });

  it('distinguishes loading and failed requests from a successful empty response', () => {
    component.serial = '90001';
    component.startTime = '2026-10-12T00:00:00Z';
    component.endTime = '2026-10-13T00:00:00Z';
    component.fetchData();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Loading fault data...');
    expect(fixture.nativeElement.querySelector('.chart-no-data-icon')).toBeNull();
    response$.error(new Error('Request failed'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.chart-no-data-icon')).toBeNull();

    response$ = new Subject<FaultHistoryResponse>();
    faultService.getFaultHistoryBySerial.and.returnValue(response$);
    component.fetchData();
    response$.next({ context: { start: component.startTime, end: component.endTime }, faultSummaries: [] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.chart-no-data-icon')).not.toBeNull();
    response$.complete();
  });

  it('keeps standalone controls without showing an empty state before fetching', () => {
    fixture.componentRef.setInput('isModal', false);
    fixture.componentRef.setInput('mode', 'standalone');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.controls')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.chart-no-data')).toBeNull();
  });
});
