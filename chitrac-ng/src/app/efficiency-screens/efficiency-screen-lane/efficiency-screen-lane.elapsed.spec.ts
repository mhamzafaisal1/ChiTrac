import { fakeAsync, tick } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { EfficiencyScreenLaneComponent } from './efficiency-screen-lane.component';

describe('Production state elapsed time', () => {
  function create() {
    spyOn(performance, 'now').and.callFake(() => Date.now());
    const markForCheck = jasmine.createSpy();
    const component = new EfficiencyScreenLaneComponent({ markForCheck } as any, {} as any);
    component.mode = 'fault';
    component.lane = { serial: 90007, station: 1, status: 37,
      latestFaultStart: '2026-10-23T15:00:00Z', elapsedAsOf: '2026-10-23T15:00:10Z' };
    component.ngOnChanges({ lane: new SimpleChange(null, component.lane, true) });
    return { component, markForCheck };
  }
  function update(component: EfficiencyScreenLaneComponent, changes: any) {
    const before = component.lane;
    component.lane = { ...before, ...changes };
    component.ngOnChanges({ lane: new SimpleChange(before, component.lane, false) });
  }

  it('shows source session elapsed time regardless of the browser clock, and ticks each second', fakeAsync(() => {
    const { component } = create();
    expect(component.getElapsedDisplay()).toBe('10s');
    tick(2000); expect(component.getElapsedDisplay()).toBe('12s');
    // Reading the same cached snapshot must not reset the elapsed timer.
    update(component, {}); expect(component.getElapsedDisplay()).toBe('12s');
    tick(1000); expect(component.getElapsedDisplay()).toBe('13s');
    component.ngOnDestroy();
  }));

  it('resets when entering a different fault and then a paused session', fakeAsync(() => {
    const { component } = create();
    tick(2000);
    update(component, { status: 38, latestFaultStart: '2026-10-23T15:00:12Z', elapsedAsOf: '2026-10-23T15:00:12Z' });
    expect(component.getElapsedDisplay()).toBe('0s');
    tick(1000); expect(component.getElapsedDisplay()).toBe('1s');
    component.mode = 'offline';
    update(component, { status: 0, latestFaultStart: null, latestPausedStart: '2026-10-23T15:00:13Z', elapsedAsOf: '2026-10-23T15:00:15Z' });
    expect(component.getElapsedDisplay()).toBe('2s');
    component.ngOnDestroy();
  }));

  it('does not reuse an earlier fault timer for a paused state with no known session start', fakeAsync(() => {
    const { component, markForCheck } = create();
    component.mode = 'offline';
    update(component, { status: 0, latestPausedStart: null });
    expect(component.getElapsedDisplay()).toBe('—');
    const calls = markForCheck.calls.count(); tick(2000);
    expect(markForCheck.calls.count()).toBe(calls);
    component.ngOnDestroy();
  }));

  it('handles invalid session starts and stops updating after destruction', fakeAsync(() => {
    const { component, markForCheck } = create();
    update(component, { latestFaultStart: 'invalid' });
    expect(component.getElapsedDisplay()).toBe('—');
    update(component, { latestFaultStart: '2026-10-23T15:00:00Z' });
    tick(1000); component.ngOnDestroy();
    const calls = markForCheck.calls.count(); tick(2000);
    expect(markForCheck.calls.count()).toBe(calls);
  }));
});
