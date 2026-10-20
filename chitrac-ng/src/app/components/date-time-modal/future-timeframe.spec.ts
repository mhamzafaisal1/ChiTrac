import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { DateTimeModalComponent } from './date-time-modal.component';
import { TimeframePickerComponent } from '../timeframe-picker/timeframe-picker.component';
import { DateTimeService } from '../../services/date-time.service';
import { DashboardTimeframeService } from '../../services/dashboard-timeframe.service';
import { ShiftService } from '../../services/shift.service';
import { WebsocketService } from '../../services/websocket.service';

describe('Future Today shift validation', () => {
  const shifts = [
    { _id: 'morning', id: 1, startTime: { hour: 8, minute: 0 }, endTime: { hour: 11, minute: 0 } },
    { _id: 'afternoon', id: 2, startTime: { hour: 11, minute: 0 }, endTime: { hour: 18, minute: 30 } },
    { _id: 'night', id: 3, startTime: { hour: 22, minute: 0 }, endTime: { hour: 6, minute: 0 } }
  ];
  let dates: DateTimeService;
  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 9, 20, 10));
    dates = new DateTimeService();
    dates.setStartTime(new Date(2026, 9, 20).toISOString());
    dates.setEndTime(new Date().toISOString());
    dates.setTimeframe('today');
    TestBed.configureTestingModule({
      imports: [DateTimeModalComponent, TimeframePickerComponent],
      providers: [provideNoopAnimations(),
        { provide: DateTimeService, useValue: dates },
        { provide: DashboardTimeframeService, useValue: {} },
        { provide: ShiftService, useValue: { getActiveShifts: () => of({ shifts }) } },
        { provide: WebsocketService, useValue: { dashboardCache$: of({}) } },
      ]
    });
  });
  afterEach(() => { TestBed.resetTestingModule(); jasmine.clock().uninstall(); });

  it('disables dashboard Confirm, shows the exact error below it, and rejects direct confirmation', () => {
    const fixture = TestBed.createComponent(DateTimeModalComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const close = spyOn(component.closeModal, 'emit');
    const confirm = spyOn(dates, 'triggerConfirm');
    component.selectShift('afternoon');
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.action-row button');
    const error: HTMLElement = fixture.nativeElement.querySelector('.future-timeframe-error');
    expect(button.disabled).toBeTrue();
    expect(error.textContent!.trim()).toBe('Cannot select a timeframe in the future');
    expect(!!(button.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTrue();
    component.confirm();
    expect(confirm).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(dates.getShiftId()).toBe('');
    component.selectShift('morning');
    fixture.detectChanges();
    expect(button.disabled).toBeFalse();
    expect(fixture.nativeElement.querySelector('.future-timeframe-error')).toBeNull();
    component.selectShift('afternoon');
    component.onTimeframeSelect('lastWeek');
    fixture.detectChanges();
    expect(button.disabled).toBeFalse();
    component.selectToday();
    component.selectShift(null);
    fixture.detectChanges();
    expect(button.disabled).toBeFalse();
    fixture.destroy();
  });

  it('re-enables dashboard Confirm at the shift start and commits its scheduled times', () => {
    const fixture = TestBed.createComponent(DateTimeModalComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectShift('afternoon');
    fixture.detectChanges();
    expect(component.isFutureTimeframe).toBeTrue();
    jasmine.clock().tick(60 * 60 * 1000);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.action-row button').disabled).toBeFalse();
    expect(fixture.nativeElement.querySelector('.future-timeframe-error')).toBeNull();
    component.confirm();
    expect(dates.getShiftId()).toBe('afternoon');
    expect(new Date(dates.getStartTime())).toEqual(new Date(2026, 9, 20, 11));
    expect(new Date(dates.getEndTime())).toEqual(new Date(2026, 9, 20, 18, 30));
    fixture.destroy();
  });

  it('applies the same block and recovery in the reusable picker', () => {
    const fixture = TestBed.createComponent(TimeframePickerComponent);
    fixture.componentRef.setInput('shifts', shifts);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const confirmed = spyOn(component.confirmed, 'emit');
    component.quickSelect('today');
    component.selectShift('afternoon');
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.picker-actions button');
    expect(button.disabled).toBeTrue();
    expect(fixture.nativeElement.querySelector('.future-timeframe-error').textContent.trim())
      .toBe('Cannot select a timeframe in the future');
    component.confirm();
    expect(confirmed).not.toHaveBeenCalled();
    jasmine.clock().tick(60 * 60 * 1000);
    fixture.detectChanges();
    expect(button.disabled).toBeFalse();
    component.confirm();
    expect(confirmed).toHaveBeenCalled();
    expect(confirmed.calls.mostRecent().args[0].start).toEqual(new Date(2026, 9, 20, 11));
    expect(confirmed.calls.mostRecent().args[0].end).toEqual(new Date(2026, 9, 20, 18, 30));
    component.quickSelect('yesterday');
    fixture.detectChanges();
    expect(button.disabled).toBeFalse();
    expect(fixture.nativeElement.querySelector('.future-timeframe-error')).toBeNull();
    fixture.destroy();
  });

  it('updates dashboard draft times in either selection order and restores all-data boundaries', () => {
    const fixture = TestBed.createComponent(DateTimeModalComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectShift('morning');
    expect(component.startDateTime).toEqual(new Date(2026, 9, 20, 8));
    expect(component.endDateTime).toEqual(new Date(2026, 9, 20, 11));
    component.onTimeframeSelect('yesterday');
    expect(component.startDateTime).toEqual(new Date(2026, 9, 19, 8));
    expect(component.endDateTime).toEqual(new Date(2026, 9, 19, 11));
    component.selectShift('night');
    expect(component.startDateTime).toEqual(new Date(2026, 9, 19, 22));
    expect(component.endDateTime).toEqual(new Date(2026, 9, 20, 6));
    component.selectShift('morning');
    expect(component.endDateTime).toEqual(new Date(2026, 9, 19, 11));
    component.confirm();
    component.resetDraftFromCommittedSelection();
    expect(component.endDateTime).toEqual(new Date(2026, 9, 19, 11));
    component.selectShift(null);
    expect(component.startDateTime).toEqual(new Date(2026, 9, 19));
    expect(component.endDateTime).toEqual(new Date(2026, 9, 20));
    fixture.destroy();
  });

  it('updates report draft times for periods, shift changes, overnight shifts and custom dates', () => {
    const fixture = TestBed.createComponent(TimeframePickerComponent);
    fixture.componentRef.setInput('shifts', shifts);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.quickSelect('lastWeek');
    component.selectShift('morning');
    expect(component.pickerStart).toEqual(new Date(2026, 9, 11, 8));
    expect(component.pickerEnd).toEqual(new Date(2026, 9, 17, 11));
    component.selectShift('night');
    expect(component.pickerEnd).toEqual(new Date(2026, 9, 18, 6));
    component.selectShift('afternoon');
    expect(component.pickerEnd).toEqual(new Date(2026, 9, 17, 18, 30));
    component.selectShift(null);
    expect(component.pickerStart).toEqual(new Date(2026, 9, 11));
    expect(component.pickerEnd).toEqual(new Date(2026, 9, 18));
    component.quickSelect('custom');
    component.pickerStart = new Date(2026, 9, 1, 9);
    component.pickerEnd = new Date(2026, 9, 3, 17);
    component.selectShift('morning');
    expect(component.pickerStart).toEqual(new Date(2026, 9, 1, 8));
    expect(component.pickerEnd).toEqual(new Date(2026, 9, 3, 11));
    component.selectShift(null);
    expect(component.pickerStart).toEqual(new Date(2026, 9, 1, 9));
    expect(component.pickerEnd).toEqual(new Date(2026, 9, 3, 17));
    fixture.destroy();
  });
});
