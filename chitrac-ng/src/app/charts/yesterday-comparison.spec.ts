import { SimpleChange, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DashboardService } from '../services/dashboard.service';
import { PollingService } from '../services/polling-service.service';
import { DateTimeService } from '../services/date-time.service';
import { PercentBreakpointService } from '../services/percent-breakpoint.service';
import { CartesianChartComponent } from './cartesian-chart/cartesian-chart.component';
import { DailyMachineOeeBarChartComponent } from './daily-machine-oee-bar-chart/daily-machine-oee-bar-chart.component';
import { DailyCountByItemChartComponent } from './daily-count-by-item-chart/daily-count-by-item-chart.component';
import { RankedOperatorBarChartComponent } from './ranked-operator-bar-chart/ranked-operator-bar-chart.component';
import { EfficiencyByMachineGroupBarChartComponent } from './efficiency-by-machine-group-bar-chart/efficiency-by-machine-group-bar-chart.component';

const previous = (value: number) => ({ date: '2026-10-27', value });
const cases: { name: string; component: Type<any>; data: any }[] = [
  { name: 'Machine OEE', component: DailyMachineOeeBarChartComponent, data: [
    { serial: 1, name: 'Duplicate name', oee: 80, previousDay: previous(0) },
    { serial: 2, name: 'Duplicate name', oee: 60, previousDay: previous(150) },
    { serial: 3, name: 'New machine', oee: 40, previousDay: null },
  ] },
  { name: 'Item totals', component: DailyCountByItemChartComponent, data: { items: [
    { itemName: 'Sheets', totalCount: 80, previousDay: previous(0) },
    { itemName: 'Towels', totalCount: 60, previousDay: previous(150) },
    { itemName: 'New type', totalCount: 40, previousDay: null },
  ] } },
  { name: 'Top operators', component: RankedOperatorBarChartComponent, data: [
    { id: 1, name: 'Duplicate name', efficiency: 80, previousDay: previous(0) },
    { id: 2, name: 'Duplicate name', efficiency: 60, previousDay: previous(150) },
    { id: 3, name: 'New operator', efficiency: 40, previousDay: null },
  ] },
  { name: 'Machine groups', component: EfficiencyByMachineGroupBarChartComponent, data: [
    { name: 'First', metrics: { performance: { efficiency: { value: 0.8 } } }, previousDay: previous(0) },
    { name: 'Second', metrics: { performance: { efficiency: { value: 0.6 } } }, previousDay: previous(150) },
    { name: 'New group', metrics: { performance: { efficiency: { value: 0.4 } } }, previousDay: null },
  ] },
];

for (const example of cases) {
  describe(`${example.name} previous-day markers`, () => {
    let component: any;
    beforeEach(() => {
      TestBed.configureTestingModule({ providers: [
        { provide: DashboardService, useValue: {} },
        { provide: PollingService, useValue: {} },
        { provide: DateTimeService, useValue: { getConfirmed: () => false } },
        { provide: PercentBreakpointService, useValue: { getColorHex: () => '#42a5f5', getOeColorHex: () => '#42a5f5' } },
      ] });
      component = TestBed.createComponent(example.component).componentInstance;
      component.chartWidth = 600;
      component.chartHeight = 400;
      component.preloadedData = example.data;
      component.ngOnChanges({ preloadedData: new SimpleChange(null, example.data, true) });
    });
    afterEach(() => component.ngOnDestroy());
    const points = (chart: any) => chart.chartConfig.series.flatMap((series: any) => series.data);

    it('defaults on, preserves duplicate identities and exposes the comparison date/value in tooltips', () => {
      expect(component.showYesterday).toBeTrue();
      expect(points(component).map((point: any) => point.endMarkerValue)).toEqual([0, 150, undefined]);
      const series = component.chartConfig.series[0];
      const text = component.chartConfig.tooltip.formatter({ series, xLabel: series.data[0].x, value: series.data[0].y });
      expect(text.join(' ')).toContain('Previous day (2026-10-27): 0');
      const last = component.chartConfig.series[component.chartConfig.series.length - 1];
      const missing = last.data[last.data.length - 1];
      expect(component.chartConfig.tooltip.formatter({ series: last, xLabel: missing.x, value: missing.y }).join(' ')).toContain('Previous day: N/A');
    });

    it('draws zero and larger historical values, removes markers and their scale contribution when switched off', () => {
      const fixture = TestBed.createComponent(CartesianChartComponent);
      fixture.componentRef.setInput('config', component.chartConfig);
      fixture.detectChanges();
      const lines = fixture.nativeElement.querySelectorAll('line[stroke-dasharray="6,6"]');
      expect(lines.length).toBe(2);
      expect(Number(lines[0].getAttribute('x1'))).toBe(0);
      expect(Number(lines[1].getAttribute('x1'))).toBeGreaterThan(0);
      expect(Number(lines[1].getAttribute('x1'))).toBeLessThanOrEqual(600);
      component.showYesterday = false;
      component.ngOnChanges({ showYesterday: new SimpleChange(true, false, false) });
      expect(points(component).every((point: any) => point.endMarkerValue === undefined)).toBeTrue();
      fixture.componentRef.setInput('config', component.chartConfig);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('line[stroke-dasharray="6,6"]').length).toBe(0);
      fixture.destroy();
    });

    it('keeps its choice on refresh/resize and restores markers without fetching', () => {
      const fetch = spyOn(component, 'fetchOnce');
      component.showYesterday = false;
      component.ngOnChanges({ showYesterday: new SimpleChange(true, false, false) });
      component.ngOnChanges({ preloadedData: new SimpleChange(null, example.data, false) });
      component.chartWidth = 800;
      component.ngOnChanges({ chartWidth: new SimpleChange(600, 800, false) });
      expect(component.chartConfig.width).toBe(800);
      expect(points(component).every((point: any) => point.endMarkerValue === undefined)).toBeTrue();
      component.showYesterday = true;
      component.ngOnChanges({ showYesterday: new SimpleChange(false, true, false) });
      expect(points(component)[1].endMarkerValue).toBe(150);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
}
