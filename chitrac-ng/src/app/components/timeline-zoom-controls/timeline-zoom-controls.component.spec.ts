import { Type } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import * as d3 from 'd3';
import { of } from 'rxjs';
import { MachineTimelineChartComponent } from '../../charts/machine-timeline-chart/machine-timeline-chart.component';
import { OperatorTimelineChartComponent } from '../../operator-timeline-chart/operator-timeline-chart.component';
import { SettingsService } from '../../services/settings.service';

const start = '2026-10-08T08:00:00';
const end = '2026-10-08T16:00:00';
const payload = () => ({
  range: { start, end },
  machines: [{ serial: 1, name: 'Machine 1', sessions: [{ start, end, status: 'running' }] }],
});

for (const chart of [MachineTimelineChartComponent, OperatorTimelineChartComponent] as Type<any>[]) {
  describe(`${chart.name} zoom controls`, () => {
    let fixture: any;
    let component: any;
    let svg: SVGSVGElement;
    const buttons = () => fixture.nativeElement.querySelectorAll('app-timeline-zoom-controls button') as NodeListOf<HTMLButtonElement>;
    const render = () => { tick(32); fixture.detectChanges(); };

    beforeEach(fakeAsync(() => {
      TestBed.configureTestingModule({
        imports: [chart],
        providers: [provideNoopAnimations(), {
          provide: SettingsService,
          useValue: { timeFormat$: of('12h'), formatTime: (date: Date) => date.toTimeString().slice(0, 5) },
        }],
      });
      fixture = TestBed.createComponent(chart);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('preloadedData', payload());
      fixture.detectChanges();
      render();
      svg = fixture.nativeElement.querySelector('svg');
    }));

    afterEach(() => fixture.destroy());

    it('zooms about the visible center and restores the complete range', fakeAsync(() => {
      expect(buttons()[1].disabled).toBeTrue();
      expect(buttons()[2].disabled).toBeTrue();
      buttons()[0].click();
      render();
      expect(d3.zoomTransform(svg).k).toBe(2);
      const domain = component.visibleTimeScale.domain();
      expect((+domain[0] + +domain[1]) / 2).toBe((+new Date(start) + +new Date(end)) / 2);
      buttons()[1].click();
      render();
      expect(d3.zoomTransform(svg).k).toBe(1);
      buttons()[0].click();
      render();
      d3.select(svg).call(component.zoomBehavior.translateBy, -100, 0);
      render();
      buttons()[2].click();
      render();
      expect(d3.zoomTransform(svg).k).toBe(1);
      expect(d3.zoomTransform(svg).x).toBe(0);
      expect(component.visibleTimeScale.domain().map(Number)).toEqual([+new Date(start), +new Date(end)]);
    }));

    it('respects limits and handles rapid clicks without stale zoom state', fakeAsync(() => {
      for (let i = 0; i < 8; i++) component.zoomBy(2);
      render();
      expect(d3.zoomTransform(svg).k).toBe(32);
      expect(buttons()[0].disabled).toBeTrue();
      for (let i = 0; i < 8; i++) component.zoomBy(0.5);
      render();
      expect(d3.zoomTransform(svg).k).toBe(1);
      expect(buttons()[1].disabled).toBeTrue();
    }));

    it('shares zoom state with wheel gestures', fakeAsync(() => {
      svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 300, clientY: 100, bubbles: true, cancelable: true }));
      tick(200);
      fixture.detectChanges();
      const gestureScale = d3.zoomTransform(svg).k;
      expect(gestureScale).toBeGreaterThan(1);
      buttons()[0].click();
      render();
      expect(d3.zoomTransform(svg).k).toBeCloseTo(gestureScale * 2);
      buttons()[2].click();
      render();
      expect(d3.zoomTransform(svg).k).toBe(1);
    }));

    it('preserves the visible interval on data refresh and resize', fakeAsync(() => {
      buttons()[0].click();
      render();
      const domain = component.visibleTimeScale.domain().map(Number);
      fixture.componentRef.setInput('preloadedData', payload());
      fixture.componentRef.setInput('chartWidth', 1000);
      fixture.detectChanges();
      render();
      expect(component.visibleTimeScale.domain().map(Number)).toEqual(domain);
    }));

    it('does not bubble button clicks to dashboard chart actions', fakeAsync(() => {
      const parentClick = jasmine.createSpy('parentClick');
      fixture.nativeElement.addEventListener('click', parentClick);
      buttons()[0].click();
      render();
      expect(parentClick).not.toHaveBeenCalled();
    }));

    it('uses the app text color in both dark and light themes', fakeAsync(() => {
      fixture.nativeElement.style.setProperty('--theme-color-text', '#ffffff');
      render();
      expect(getComputedStyle(buttons()[0]).color).toBe('rgb(255, 255, 255)');
      fixture.nativeElement.style.setProperty('--theme-color-text', '#000000');
      render();
      expect(getComputedStyle(buttons()[0]).color).toBe('rgb(0, 0, 0)');
    }));

    it('hides controls without data and safely ignores zoom commands', fakeAsync(() => {
      fixture.componentRef.setInput('preloadedData', null);
      fixture.detectChanges();
      render();
      expect(buttons().length).toBe(0);
      expect(() => { component.zoomBy(2); component.resetZoom(); }).not.toThrow();
    }));
  });
}
