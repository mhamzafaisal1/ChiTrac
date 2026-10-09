import { Type } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { MachineTimelineChartComponent } from '../charts/machine-timeline-chart/machine-timeline-chart.component';
import { OperatorTimelineChartComponent } from '../operator-timeline-chart/operator-timeline-chart.component';
import { SettingsService } from '../services/settings.service';

const start = '2026-10-08T08:00:00';
const end = '2026-10-08T16:00:00';
const payload = (status = 'running', count = 10, id = 'session-1') => ({
  range: { start, end },
  machines: [{ serial: 1, name: 'Machine 1', sessions: [{
    id, start, end, status, totalCount: count,
  }] }],
});

for (const chart of [MachineTimelineChartComponent, OperatorTimelineChartComponent] as Type<any>[]) {
  describe(`${chart.name} hover tooltips`, () => {
    let fixture: any;
    let component: any;
    let hitTest: jasmine.Spy;
    const render = () => { fixture.detectChanges(); tick(48); fixture.detectChanges(); };
    const segment = () => fixture.nativeElement.querySelector('.session-chunk');
    const hover = () => {
      segment().dispatchEvent(new MouseEvent('mouseenter', { clientX: 200, clientY: 100 }));
      fixture.detectChanges();
    };

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
      render();
      hitTest = spyOn(document, 'elementFromPoint').and.callFake(() => segment());
    }));

    afterEach(() => fixture.destroy());

    it('shows offline start, end and duration without running metrics', fakeAsync(() => {
      fixture.componentRef.setInput('preloadedData', payload('offline'));
      render();
      hover();
      expect(component.tooltip.visible).toBeTrue();
      expect(component.tooltip.lines).toContain('Status: Offline');
      expect(component.tooltip.lines).toContain('Total Duration: 08:00:00');
      expect(component.tooltip.lines.some((line: string) => line.startsWith('Start Time:'))).toBeTrue();
      expect(component.tooltip.lines.some((line: string) => line.startsWith('End Time:'))).toBeTrue();
      expect(component.tooltip.lines.some((line: string) => /Total Count|Eff%/.test(line))).toBeFalse();
    }));

    it('keeps a stationary tooltip visible through repeated refreshes and updates its values', fakeAsync(() => {
      hover();
      for (let count = 11; count < 15; count++) {
        tick(3000);
        fixture.componentRef.setInput('preloadedData', payload('running', count));
        render();
        expect(component.tooltip.visible).toBeTrue();
        expect(component.tooltip.lines).toContain(`Total Count: ${count}`);
      }
    }));

    it('reconciles replaced segments under the stationary pointer', fakeAsync(() => {
      hover();
      fixture.componentRef.setInput('preloadedData', payload('offline', 0, 'new-offline-id'));
      render();
      expect(component.tooltip.visible).toBeTrue();
      expect(component.tooltip.lines).toContain('Status: Offline');
    }));

    it('hides over empty space and recovers on another segment without leaving the SVG', fakeAsync(() => {
      hover();
      hitTest.and.returnValue(fixture.nativeElement.querySelector('.zoom-surface'));
      const svg = fixture.nativeElement.querySelector('svg');
      svg.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200 }));
      expect(component.tooltip.visible).toBeFalse();
      hitTest.and.callFake(() => segment());
      svg.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 100 }));
      expect(component.tooltip.visible).toBeTrue();
    }));

    it('does not reopen after the pointer leaves, even if a refresh is queued', fakeAsync(() => {
      hover();
      fixture.componentRef.setInput('preloadedData', payload('running', 20));
      fixture.detectChanges();
      fixture.nativeElement.querySelector('svg').dispatchEvent(new MouseEvent('mouseleave'));
      render();
      expect(component.tooltip.visible).toBeFalse();
    }));

    it('hides when the segment disappears or an overlay covers it', fakeAsync(() => {
      hover();
      hitTest.and.returnValue(document.body);
      fixture.componentRef.setInput('chartWidth', 800);
      render();
      expect(component.tooltip.visible).toBeFalse();
      hitTest.and.callFake(() => segment());
      hover();
      fixture.componentRef.setInput('preloadedData', null);
      render();
      expect(component.tooltip.visible).toBeFalse();
    }));

    it('reconciles hover after zoom and refresh without synthetic zoom events', fakeAsync(() => {
      hover();
      component.zoomBy(2);
      render();
      expect(component.tooltip.visible).toBeTrue();
      const zoomRender = spyOn(component, 'scheduleZoomRender').and.callThrough();
      fixture.componentRef.setInput('preloadedData', payload('running', 30));
      render();
      expect(zoomRender).not.toHaveBeenCalled();
      expect(component.tooltip.visible).toBeTrue();
      component.resetZoom();
      render();
      expect(component.tooltip.visible).toBeTrue();
    }));

    it('cancels pending hover work when destroyed', fakeAsync(() => {
      hover();
      fixture.componentRef.setInput('chartWidth', 800);
      fixture.detectChanges();
      const sync = spyOn(component, 'syncHoveredTooltip').and.callThrough();
      fixture.destroy();
      tick(100);
      expect(sync).not.toHaveBeenCalled();
    }));
  });
}
