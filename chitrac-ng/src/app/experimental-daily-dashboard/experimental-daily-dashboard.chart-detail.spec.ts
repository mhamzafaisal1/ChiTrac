import { Subject } from 'rxjs';
import { ExperimentalDailyDashboardComponent } from './experimental-daily-dashboard.component';
import { DAILY_CHART_COMPONENTS, DailyChartDetailComponent } from '../components/daily-chart-detail/daily-chart-detail.component';

describe('Experimental Daily Dashboard chart detail', () => {
  let dashboard: ExperimentalDailyDashboardComponent;
  let closed: Subject<void>;
  let open: jasmine.Spy;
  let close: jasmine.Spy;

  beforeEach(() => {
    closed = new Subject<void>();
    close = jasmine.createSpy('close');
    open = jasmine.createSpy('open').and.returnValue({ close, afterClosed: () => closed });
    dashboard = new ExperimentalDailyDashboardComponent(
      {} as any, {} as any, {} as any,
      { unregister: () => {} } as any, {} as any, {} as any,
      { open } as any, {} as any,
    );
  });

  afterEach(() => dashboard.ngOnDestroy());

  it('maps every tile to its existing chart and matching data', () => {
    for (const tile of dashboard.chartTiles) {
      const data = [{ marker: tile.id }];
      dashboard.preloadedData = { [DAILY_CHART_COMPONENTS[tile.id].dataKey]: data };
      dashboard.openChartDetail(tile);
      const options = open.calls.mostRecent().args[1];
      expect(options.data.component).toBe(DailyChartDetailComponent);
      expect(options.data.componentInputs.chartId).toBe(tile.id);
      expect(options.data.componentInputs.state$.value.data).toBe(data);
      expect(options.ariaLabel).toBe(tile.title);
      closed.next();
    }
    expect(open).toHaveBeenCalledTimes(7);
  });

  it('does not open during editing or open a second modal', () => {
    dashboard.layoutEditing = true;
    dashboard.openChartDetail(dashboard.chartTiles[0]);
    expect(open).not.toHaveBeenCalled();
    dashboard.layoutEditing = false;
    dashboard.openChartDetail(dashboard.chartTiles[0]);
    dashboard.openChartDetail(dashboard.chartTiles[1]);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('updates the open chart from the dashboard without changing the selected chart', () => {
    dashboard.openChartDetail(dashboard.chartTiles[0]);
    const inputs = open.calls.mostRecent().args[1].data.componentInputs;
    dashboard.preloadedData = { machineStatus: [{ count: 42 }] };
    dashboard.cacheSubtitle = 'Afternoon Shift';
    dashboard.cacheUpdatedAt = 'Updated 2:00 PM';
    (dashboard as any).updateChartDetail();
    expect(inputs.state$.value).toEqual({
      data: [{ count: 42 }], subtitle: 'Afternoon Shift', subtitleStrong: false, updatedAt: 'Updated 2:00 PM',
    });
    expect(inputs.chartId).toBe('machine-status');
  });

  it('preserves the daily-count timeframe and handles missing data', () => {
    dashboard.openChartDetail(dashboard.chartTiles.find(tile => tile.id === 'daily-counts')!);
    const state = open.calls.mostRecent().args[1].data.componentInputs.state$.value;
    expect(state.subtitle).toBe('Last 28 Days');
    expect(state.data).toBeNull();
  });

  it('completes modal state on close and allows reopening', () => {
    dashboard.openChartDetail(dashboard.chartTiles[0]);
    const completed = jasmine.createSpy('completed');
    open.calls.mostRecent().args[1].data.componentInputs.state$.subscribe({ complete: completed });
    closed.next();
    expect(completed).toHaveBeenCalled();
    dashboard.openChartDetail(dashboard.chartTiles[1]);
    expect(open).toHaveBeenCalledTimes(2);
  });
});
