import { SimpleChange } from '@angular/core';
import { fakeAsync, tick, TestBed } from '@angular/core/testing';
import { DailyCountBarChartComponent, DEFAULT_DAILY_COUNT_DISPLAY_OPTIONS } from './daily-count-bar-chart.component';
import { CartesianChartComponent } from '../cartesian-chart/cartesian-chart.component';
import { DashboardService } from '../../services/dashboard.service';
import { PollingService } from '../../services/polling-service.service';
import { DateTimeService } from '../../services/date-time.service';

describe('Daily total count display options', () => {
  let component: DailyCountBarChartComponent;
  let dashboard: jasmine.SpyObj<DashboardService>;
  const rows = [
    { date: '2026-10-20', count: 100 },
    { date: '2026-10-21', count: 150 },
    { date: '2026-10-22', count: 50 },
  ];

  beforeEach(() => {
    dashboard = jasmine.createSpyObj('DashboardService', ['getDailyCountTotals']);
    TestBed.configureTestingModule({
      providers: [
        { provide: DashboardService, useValue: dashboard },
        { provide: PollingService, useValue: {} },
        { provide: DateTimeService, useValue: {} },
      ],
    });
    component = TestBed.createComponent(DailyCountBarChartComponent).componentInstance;
    component.preloadedData = rows;
    component.ngOnChanges({ preloadedData: new SimpleChange(null, rows, true) });
  });

  afterEach(() => component.ngOnDestroy());

  function options(changes: Partial<typeof DEFAULT_DAILY_COUNT_DISPLAY_OPTIONS>): void {
    const previous = component.displayOptions;
    component.displayOptions = { ...previous, ...changes };
    component.ngOnChanges({ displayOptions: new SimpleChange(previous, component.displayOptions, false) });
  }

  function tooltip(date: string, value: number): string[] {
    const config = component.chartConfig!;
    return config.tooltip!.formatter!({ series: config.series[0], xLabel: date, value } as any) as string[];
  }

  it('enables the average line, variance colors and tooltip by default', () => {
    expect(component.chartConfig!.series.map(series => series.id)).toEqual(['counts', 'moving-average']);
    expect(component.chartConfig!.tooltip!.show).toBeTrue();
    expect(component.chartConfig!.series[0].data.map(point => point.color)).toEqual(['#42a5f5', '#66bb6a', '#ef5350']);
  });

  it('toggles independently and rebuilds without fetching data', () => {
    options({ averageLine: false });
    expect(component.chartConfig!.series.length).toBe(1);
    expect(component.chartConfig!.series[0].data[2].color).toBe('#ef5350');
    expect(tooltip('2026-10-21', 150)).toContain('Vs 7-Day Avg: +25 (+20.0%)');
    options({ barColors: false, tooltip: false });
    expect(component.chartConfig!.series[0].data.every(point => point.color === '#42a5f5')).toBeTrue();
    expect(component.chartConfig!.tooltip!.show).toBeFalse();
    options({ averageLine: true, barColors: true, tooltip: true });
    expect(component.chartConfig!.series.length).toBe(2);
    expect(component.chartConfig!.tooltip!.show).toBeTrue();
    expect(dashboard.getDailyCountTotals).not.toHaveBeenCalled();
  });

  it('hides an open tooltip and cancels a pending tooltip when disabled', fakeAsync(() => {
    const fixture = TestBed.createComponent(CartesianChartComponent);
    fixture.componentRef.setInput('config', component.chartConfig);
    fixture.detectChanges();
    const chart = fixture.componentInstance;
    const element = fixture.nativeElement.querySelector('.cc-tooltip') as HTMLElement;
    const context = { series: component.chartConfig!.series[0], xLabel: '2026-10-21', value: 150 };
    (chart as any).scheduleTooltip(new MouseEvent('mousemove'), component.chartConfig, context);
    tick(750);
    expect(element.classList.contains('is-visible')).toBeTrue();
    (chart as any).scheduleTooltip(new MouseEvent('mousemove'), component.chartConfig, context);
    options({ tooltip: false });
    fixture.componentRef.setInput('config', component.chartConfig);
    fixture.detectChanges();
    expect(element.classList.contains('is-visible')).toBeFalse();
    tick(750);
    expect(element.classList.contains('is-visible')).toBeFalse();
    fixture.destroy();
  }));

  it('retains choices on data refresh and resize', () => {
    options({ averageLine: false, barColors: false, tooltip: false });
    component.preloadedData = [{ date: '2026-10-23', count: 200 }];
    component.ngOnChanges({ preloadedData: new SimpleChange(rows, component.preloadedData, false) });
    component.chartWidth = 900;
    component.ngOnChanges({ chartWidth: new SimpleChange(600, 900, false) });
    expect(component.chartConfig!.width).toBe(900);
    expect(component.chartConfig!.series.length).toBe(1);
    expect(component.chartConfig!.series[0].data[0].y).toBe(200);
    expect(component.chartConfig!.series[0].data[0].color).toBe('#42a5f5');
    expect(component.chartConfig!.tooltip!.show).toBeFalse();
  });

  it('compares the actual previous calendar date after sorting, including negative deltas', () => {
    component.preloadedData = [...rows].reverse();
    component.ngOnChanges({ preloadedData: new SimpleChange(rows, component.preloadedData, false) });
    expect(tooltip('2026-10-21', 150)).toContain('Vs Previous Day: +50 (+50.0%)');
    expect(tooltip('2026-10-22', 50)).toContain('Vs Previous Day: -100 (-66.7%)');
    expect(tooltip('2026-10-20', 100)).toContain('Vs Previous Day: N/A');
  });

  it('shows N/A for missing previous dates and zero denominators without hiding count differences', () => {
    component.preloadedData = [
      { date: '2026-10-20', count: 0 },
      { date: '2026-10-21', count: 10 },
      { date: '2026-10-23', count: 20 },
    ];
    component.ngOnChanges({ preloadedData: new SimpleChange(rows, component.preloadedData, false) });
    expect(tooltip('2026-10-20', 0)).toContain('Vs 7-Day Avg: 0 (N/A)');
    expect(tooltip('2026-10-21', 10)).toContain('Vs Previous Day: +10 (N/A)');
    expect(tooltip('2026-10-23', 20)).toContain('Vs Previous Day: N/A');
  });
});
