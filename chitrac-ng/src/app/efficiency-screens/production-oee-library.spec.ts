import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { EfficiencyScreensService } from '../services/efficiency-screens.service';
import { PercentBreakpointService } from '../services/percent-breakpoint.service';
import { EfficiencyScreenLaneComponent } from './efficiency-screen-lane/efficiency-screen-lane.component';

describe('Production lane OEE', () => {
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
});
