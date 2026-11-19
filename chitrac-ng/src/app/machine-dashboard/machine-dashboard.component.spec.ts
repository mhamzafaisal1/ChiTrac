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
      label: 'Shift: Morning', value: '08:00 — 12:00', icon: 'schedule', tone: 'neutral', isTimeRange: true,
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


describe('Cascade machine presentation', () => {
  const response = (type: string, serial: number) => ({ machine: { serial, name: 'Any name', type }, currentStatus: { code: 1 },
    metrics: { runtime: { total: 60000 }, downtime: { total: 10000 }, pausedTime: { total: 10000 }, faultTime: { total: 0 },
      output: { totalCount: 8, misfeedCount: 2 }, performance: { availability: { percentage: 80 }, throughput: { percentage: 80 },
        efficiency: { percentage: 90 }, oee: { percentage: 72 } } } });
  let dashboard: any;
  beforeEach(() => {
    dashboard = Object.create(MachineDashboardComponent.prototype);
    dashboard.updateSummaryCards = () => {}; dashboard.loadOperatorStatusCounts = () => {}; dashboard.prefetchMachineDetails = () => {};
    dashboard.applyCachedOperatorStatus = () => {}; dashboard.websocketService = { getDashboardCacheSnapshot: () => ({}) };
    dashboard.dateTimeService = { getShiftId: (): string | null => null }; dashboard.shouldUseWebsocketDashboardData = () => true;
  });
  for (const mode of ['REST','websocket']) it(mode + ' masks only Cascade production values', () => {
    const data = [response('Cascade', 41), response('SPF', 42)];
    if (mode === 'REST') dashboard.updateDashboardData(data);
    else dashboard.tryApplyWebsocketDashboardData({ today: { machinesSummary: data } });
    for (const key of ['Total Count','Misfeed Count','PPH','Throughput','Efficiency','OEE']) expect(dashboard.rows[0][key]).withContext(key).toBe('—');
    expect(dashboard.rows[0].Runtime).not.toBe('—'); expect(dashboard.rows[0].Availability).toBe('80%');
    expect(dashboard.rows[1]['Total Count']).toBe(8); expect(dashboard.rows[1].Efficiency).toBe('90%');
    expect(data[0].metrics.output.totalCount).toBe(8);
  });
  for (const type of ['Cascade','SPF']) it(type + ' opens only its approved modal tabs', () => {
    dashboard.getDashboardCacheScope = () => 'today';
    dashboard.dialog = { open: jasmine.createSpy().and.returnValue({ afterClosed: () => ({ subscribe() {} }) }) };
    dashboard.openMachineDetailsModal({},41,{ machine: { type } },{ width: 800, height: 500 });
    const labels = dashboard.dialog.open.calls.mostRecent().args[1].data.componentInputs.tabData.map((tab: any) => tab.label);
    expect(labels).toEqual(type === 'Cascade' ? ['Fault Summaries','Downtime Pareto','Fault History']
      : ['Item Summary','Current Operators','Item Stacked Chart','Fault Summaries','Downtime Pareto','Fault History','Performance Chart']);
  });
});
