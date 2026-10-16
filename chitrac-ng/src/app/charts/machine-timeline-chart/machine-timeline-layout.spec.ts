import { Component } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BehaviorSubject, of } from 'rxjs';
import * as d3 from 'd3';
import { MachineTimelineChartComponent } from './machine-timeline-chart.component';
import { ChartTileComponent } from '../../components/chart-tile/chart-tile.component';
import { TimelineZoomControlsComponent } from '../../components/timeline-zoom-controls/timeline-zoom-controls.component';
import { DailyChartDetailComponent } from '../../components/daily-chart-detail/daily-chart-detail.component';
import { SettingsService } from '../../services/settings.service';

const start = '2026-10-13T08:00:00';
const end = '2026-10-13T09:00:00';
const payload = { range: { start, end }, machines: [{ serial: 1, name: 'Test', sessions: [{ start, end, status: 'paused' as const }] }] };

@Component({
  standalone: true,
  imports: [ChartTileComponent, TimelineZoomControlsComponent, MachineTimelineChartComponent],
  template: `
    <app-chart-tile title="Machine Timeline" subtitle="Today">
      <app-timeline-zoom-controls chartTileActions class="header-controls"
        [canZoomIn]="chart.canZoomIn" [canZoomOut]="chart.canZoomOut"
        (zoomIn)="chart.zoomBy(2)" (zoomOut)="chart.zoomBy(0.5)" (reset)="chart.resetZoom()"
      ></app-timeline-zoom-controls>
      <app-machine-timeline-chart #chart [preloadedData]="data"
        [useExternalTitle]="true" [controlsInHeader]="true"></app-machine-timeline-chart>
    </app-chart-tile>`
})
class TimelineHost { data = payload; }

describe('Machine timeline header and layout', () => {
  beforeEach(() => TestBed.configureTestingModule({
    imports: [TimelineHost, DailyChartDetailComponent],
    providers: [provideNoopAnimations(), { provide: SettingsService, useValue: {
      timeFormat$: of('12h'), formatTime: (date: Date) => date.toTimeString().slice(0, 5)
    } }]
  }));

  it('projects controls into the title and removes reserved toolbar/title space', fakeAsync(() => {
    const fixture = TestBed.createComponent(TimelineHost);
    fixture.detectChanges(); tick(32); fixture.detectChanges();
    const chart = fixture.debugElement.query(By.directive(MachineTimelineChartComponent)).componentInstance;
    expect(fixture.nativeElement.querySelectorAll('.chart-tile-header app-timeline-zoom-controls').length).toBe(1);
    expect(fixture.nativeElement.querySelector('.chart-content app-timeline-zoom-controls')).toBeNull();
    expect(chart.plotTop).toBe(8);
    expect(chart.svgHeight).toBe(chart.measuredHeight);
    const svg = fixture.nativeElement.querySelector('svg');
    const buttons = fixture.nativeElement.querySelectorAll('button');
    buttons[0].click(); tick(32); fixture.detectChanges();
    expect(d3.zoomTransform(svg).k).toBe(2);
    buttons[2].click(); tick(32); fixture.detectChanges();
    expect(d3.zoomTransform(svg).k).toBe(1);
    fixture.destroy();
  }));

  for (const width of [640, 360]) {
    it(`top-aligns header zoom icons with the title at ${width}px without shrinking buttons or plot space`, fakeAsync(() => {
      const fixture = TestBed.createComponent(TimelineHost);
      Object.assign(fixture.nativeElement.style, { display: 'block', width: `${width}px`, height: '440px' });
      fixture.detectChanges(); tick(32); fixture.detectChanges();
      const root: HTMLElement = fixture.nativeElement;
      const title = root.querySelector('.chart-tile-title')!.getBoundingClientRect();
      const buttons = root.querySelectorAll<HTMLButtonElement>('.chart-tile-actions button');
      const header = root.querySelector('.chart-tile-header')!.getBoundingClientRect();
      expect(buttons.length).toBe(3);
      for (const button of Array.from(buttons)) {
        const icon = button.querySelector('mat-icon')!.getBoundingClientRect();
        expect(Math.abs(icon.top - title.top)).toBeLessThan(1);
        expect(button.getBoundingClientRect().width).toBe(40);
        expect(button.getBoundingClientRect().height).toBe(40);
      }
      expect(title.right).toBeLessThanOrEqual(buttons[0].getBoundingClientRect().left);
      expect(header.height).toBe(48);
      const chart = fixture.debugElement.query(By.directive(MachineTimelineChartComponent)).componentInstance;
      expect(chart.plotTop).toBe(8);
      fixture.destroy();
    }));
  }

  it('includes an explicit paused status alongside times and duration', fakeAsync(() => {
    const fixture = TestBed.createComponent(TimelineHost);
    fixture.detectChanges(); tick(32); fixture.detectChanges();
    const chart = fixture.debugElement.query(By.directive(MachineTimelineChartComponent)).componentInstance;
    const tooltip = chart.viewMachines[0].chunks[0].tooltip;
    expect(tooltip).toContain('Status: Paused');
    expect(tooltip.some((line: string) => line.startsWith('Start Time:'))).toBeTrue();
    expect(tooltip.some((line: string) => line.startsWith('End Time:'))).toBeTrue();
    expect(tooltip).toContain('Total Duration: 01:00:00');
    fixture.destroy();
  }));

  it('uses the same header controls in the enlarged timeline', fakeAsync(() => {
    const fixture = TestBed.createComponent(DailyChartDetailComponent);
    fixture.componentRef.setInput('chartId', 'machine-timeline');
    fixture.componentRef.setInput('title', 'Machine Timeline');
    fixture.componentRef.setInput('state$', new BehaviorSubject({ data: payload, subtitle: 'Today', subtitleStrong: false, updatedAt: null }));
    fixture.detectChanges(); tick(32); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chart-tile-header app-timeline-zoom-controls')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.chart-content app-timeline-zoom-controls')).toBeNull();
    fixture.destroy();
  }));

  it('uses the displayed paused interval instead of the full session duration, including after zoom', fakeAsync(() => {
    const fixture = TestBed.createComponent(MachineTimelineChartComponent);
    fixture.componentRef.setInput('preloadedData', {
      range: { start, end },
      machines: [{ serial: 1, name: 'Test', sessions: [{
        start, end: '2026-10-13T09:00:05.700', status: 'paused',
        durationMs: 3605700, totalDurationMs: 36851618,
        sessionStart: '2026-10-12T22:45:54.082'
      }] }]
    });
    fixture.detectChanges(); tick(32); fixture.detectChanges();
    const chart = fixture.componentInstance;
    expect(chart.viewMachines[0].chunks[0].tooltip).toContain('Total Duration: 01:00:06');
    expect(chart.viewMachines[0].chunks[0].tooltip).not.toContain('Total Duration: 10:14:12');
    chart.zoomBy(2); tick(32); fixture.detectChanges();
    expect(chart.viewMachines[0].chunks[0].tooltip).toContain('Total Duration: 01:00:06');
    fixture.destroy();
  }));

  it('keeps offline duration consistent with its displayed timestamps', fakeAsync(() => {
    const fixture = TestBed.createComponent(MachineTimelineChartComponent);
    fixture.componentRef.setInput('preloadedData', {
      range: { start, end },
      machines: [{ serial: 1, name: 'Test', sessions: [{
        start, end, status: 'offline', durationMs: 0, totalDurationMs: 7200000
      }] }]
    });
    fixture.detectChanges(); tick(32); fixture.detectChanges();
    expect(fixture.componentInstance.viewMachines[0].chunks[0].tooltip).toContain('Status: Offline');
    expect(fixture.componentInstance.viewMachines[0].chunks[0].tooltip).toContain('Total Duration: 01:00:00');
    fixture.destroy();
  }));

  it('does not bubble zoom keyboard events to the dashboard tile', fakeAsync(() => {
    const fixture = TestBed.createComponent(TimelineHost);
    fixture.detectChanges(); tick(32); fixture.detectChanges();
    const handler = jasmine.createSpy('keydown');
    fixture.nativeElement.addEventListener('keydown', handler);
    fixture.nativeElement.querySelector('button').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
    fixture.destroy();
  }));
});
