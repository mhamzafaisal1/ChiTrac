import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { LaneOeeComponent } from '../blanket-blaster/lane-oee/lane-oee.component';
import { CmMachineOeeComponent } from '../modules/column/cm-machine-oee/cm-machine-oee.component';
import { EfficiencyScreensService } from '../services/efficiency-screens.service';
import { PercentBreakpointService } from '../services/percent-breakpoint.service';
import { EfficiencyScreenLaneComponent } from './efficiency-screen-lane/efficiency-screen-lane.component';

describe('Retained OEE column library', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [
    { provide: EfficiencyScreensService, useValue: { getLiveEfficiencySummary: () => of({
      machineLane: { machine: 'Blanket 1', status: 1, oee: { lastSixMinutes: { value: 84 } } },
      flipperData: [{ oee: { lastSixMinutes: { value: 33 } } }],
    }) } },
    { provide: PercentBreakpointService, useValue: {
      getDashboardColor: () => 'green', getOeDashboardColor: () => 'orange',
    } },
  ] }));

  it('renders machine OEE independently of operator efficiency through the shared renderer', () => {
    const fixture = TestBed.createComponent(EfficiencyScreenLaneComponent);
    fixture.componentRef.setInput('mode', 'oee');
    fixture.componentRef.setInput('lane', {
      machine: 'Blanket 1', status: 1,
      efficiency: { today: { value: 33, hasData: true } },
      oee: { today: { value: 84, hasData: true } },
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('84%');
    expect(fixture.nativeElement.textContent).not.toContain('33%');
    fixture.destroy();
  });

  it('keeps the standalone legacy OEE column and its data bars usable without the retired module', () => {
    const fixture = TestBed.createComponent(LaneOeeComponent);
    fixture.componentRef.setInput('lane', {
      machine: 'Blanket 1', oee: {
        lastSixMinutes: { value: 84, color: 'green' },
        lastFifteenMinutes: { value: 82, label: 'Last 15 Mins', color: 'green' },
        lastHour: { value: 81, label: 'Last Hour', color: 'green' },
        today: { value: 80, label: 'All Day', color: 'green' },
      },
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('84%');
    expect(fixture.nativeElement.querySelectorAll('ct-data-bar').length).toBe(3);
    fixture.destroy();
  });

  it('feeds machine-level OEE into the retained wrapper without the retired module', fakeAsync(() => {
    const fixture = TestBed.createComponent(CmMachineOeeComponent);
    fixture.componentRef.setInput('machineSerial', 90009);
    fixture.detectChanges(); tick(0);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Blanket 1');
    expect(fixture.nativeElement.textContent).toContain('84%');
    expect(fixture.nativeElement.textContent).not.toContain('33%');
    fixture.destroy();
  }));
});
