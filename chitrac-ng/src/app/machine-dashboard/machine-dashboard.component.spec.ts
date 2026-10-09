import { MachineDashboardComponent } from './machine-dashboard.component';

describe('Machine dashboard shift infobox', () => {
  let dashboard: any;
  let selectedShiftId: string | null;
  let currentDay: boolean;
  let projection: any;
  const shift = (shiftId: string, name = 'Morning') => ({
    shiftId, name, start: '2026-10-08T08:00:00', end: '2026-10-08T12:00:00',
  });

  beforeEach(() => {
    dashboard = Object.create(MachineDashboardComponent.prototype);
    selectedShiftId = 'morning';
    currentDay = true;
    projection = { currentShift: shift('morning'), state: 'inShift' };
    dashboard.dateTimeService = { getShiftId: () => selectedShiftId };
    spyOn(dashboard, 'isCurrentDayView').and.callFake(() => currentDay);
    spyOn(dashboard, 'getShiftProjectionWindow').and.callFake(() => projection);
    spyOn(dashboard, 'formatShiftInfoTime').and.callFake((value: string) => value.slice(11, 16));
    spyOn(dashboard, 'isTomorrow').and.returnValue(false);
    dashboard.shiftInfoCardPreferenceLabel = 'Shift';
    dashboard.summaryCardVisibility = {};
    dashboard.summaryCardOrder = ['Shift', 'Machines'];
  });

  it('shows the selected active shift and its scheduled times', () => {
    expect(dashboard.getShiftInfoCard()).toEqual({
      label: 'Shift: Morning', value: '08:00 — 12:00', icon: 'schedule', tone: 'neutral',
    });
  });

  it('uses the completed occurrence instead of the upcoming occurrence', () => {
    projection = {
      previousShift: shift('morning'), nextShift: shift('morning', 'Tomorrow'), state: 'afterLastShift',
    };
    expect(dashboard.getShiftInfoCard().label).toBe('Shift: Morning');
  });

  it('shows an upcoming selected shift', () => {
    projection = { nextShift: shift('morning'), state: 'beforeFirstShift' };
    expect(dashboard.getShiftInfoCard().label).toBe('Shift: Morning');
  });

  it('keeps the selected shift visible for historical timeframes', () => {
    currentDay = false;
    projection = { previousShift: shift('morning'), state: 'afterLastShift' };
    expect(dashboard.getShiftInfoCard()).not.toBeNull();
  });

  it('does not display another shift when selected-shift data is unavailable', () => {
    projection = { currentShift: shift('afternoon') };
    expect(dashboard.getShiftInfoCard()).toBeNull();
  });

  it('retains the break indication for the selected active shift', () => {
    projection.state = 'inBreak';
    expect(dashboard.getShiftInfoCard().value).toBe('08:00 — 12:00 (In Break)');
  });

  it('preserves Today behavior and excludes unrelated historical ranges', () => {
    selectedShiftId = null;
    expect(dashboard.getShiftInfoCard().label).toBe('Current Shift: Morning');
    projection = { nextShift: shift('morning'), state: 'beforeFirstShift' };
    dashboard.isTomorrow.and.returnValue(true);
    expect(dashboard.getShiftInfoCard().label).toBe('First Shift Tomorrow: Morning');
    currentDay = false;
    expect(dashboard.getShiftInfoCard()).toBeNull();
  });

  it('preserves the Shift visibility preference and saved order across selections', () => {
    const machines = { label: 'Machines', value: 1, icon: 'precision_manufacturing', tone: 'neutral' };
    const selected = dashboard.getShiftInfoCard();
    expect(dashboard.applySummaryCardOrder([machines, selected])).toEqual([selected, machines]);
    dashboard.summaryCardVisibility = { Shift: false };
    expect(dashboard.applySummaryCardVisibility([selected, machines])).toEqual([machines]);
    selectedShiftId = null;
    expect(dashboard.applySummaryCardVisibility([dashboard.getShiftInfoCard(), machines])).toEqual([machines]);
  });
});
