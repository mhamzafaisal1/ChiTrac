import { MachineDashboardComponent } from './machine-dashboard.component';
import { DateTimeService } from '../services/date-time.service';

describe('Total Count sparkline timeframe eligibility', () => {
  let dashboard: any;
  let dates: DateTimeService;
  const cache = { countSparkline: { allMachines: [{ count: 4 }, { count: 8 }] } };
  beforeEach(() => {
    dates = new DateTimeService();
    dashboard = Object.create(MachineDashboardComponent.prototype);
    dashboard.dateTimeService = dates;
    dashboard.startTime = dates.formatDateForInput(new Date(new Date().setHours(0, 0, 0, 0)));
    dashboard.endTime = dates.formatDateForInput(new Date());
  });

  it('keeps Today sparklines with and without a shift', () => {
    dates.setTimeframe('today');
    dates.setConfirmed(true);
    for (const shift of ['', 'morning']) {
      dates.setShiftId(shift);
      const card = dashboard.getTotalCountCard(1234, 100, cache);
      expect(card.value).toBe((1234).toLocaleString());
      expect(card.sparklineLinePoints).toBeTruthy();
    }
  });

  it('keeps implicit current-day and default current-shift sparklines', () => {
    dates.setLiveMode(false);
    for (const shift of ['', 'morning']) {
      dates.setShiftId(shift);
      expect(dashboard.getTotalCountCard(1234, 100, cache).sparklineLinePoints).toBeTruthy();
    }
  });

  it('keeps the default Today view when only the shift is explicitly confirmed', () => {
    dates.setConfirmed(true);
    dates.setShiftId('morning');
    expect(dashboard.getTotalCountCard(1234, 100, cache).sparklineLinePoints).toBeTruthy();
  });

  it('hides all chart metadata for other presets and custom ranges, even with cached data or a shift', () => {
    const readCache = spyOn(dashboard, 'getCountSparklineData').and.callThrough();
    const mock = spyOn(dashboard, 'getMockCountSparklineData').and.callThrough();
    dates.setConfirmed(true);
    dates.setLiveMode(false);
    for (const timeframe of ['yesterday', 'thisWeek', 'thisMonth', 'thisYear', 'lastWeek', 'lastMonth', 'lastYear', '']) {
      dates.setTimeframe(timeframe);
      for (const shift of ['', 'morning']) {
        dates.setShiftId(shift);
        const card = dashboard.getTotalCountCard(1234, 100, cache);
        expect(card).toEqual({ label: 'Total Count', value: (1234).toLocaleString(), icon: 'tag', tone: 'neutral' });
      }
    }
    expect(readCache).not.toHaveBeenCalled();
    expect(mock).not.toHaveBeenCalled();
  });

  it('clears the graph for historical selections and restores it on returning to Today', () => {
    dates.setTimeframe('today');
    expect(dashboard.getTotalCountCard(1234, 100, cache).sparklineLinePoints).toBeTruthy();
    dates.setTimeframe('lastWeek');
    expect(dashboard.getTotalCountCard(9876, 100, cache).sparklineLinePoints).toBeUndefined();
    dates.setTimeframe('today');
    expect(dashboard.getTotalCountCard(1234, 100, cache).sparklineLinePoints).toBeTruthy();
  });
});
