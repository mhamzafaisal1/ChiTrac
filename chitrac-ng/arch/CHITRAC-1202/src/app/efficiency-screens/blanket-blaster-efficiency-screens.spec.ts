import { Type } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Subject } from 'rxjs';
import { EfficiencyScreensService } from '../services/efficiency-screens.service';
import { PercentBreakpointService } from '../services/percent-breakpoint.service';
import { BlanketBlasteroneEfficiencyScreen } from './blanket-blasterone-efficiency-screen/blanket-blasterone-efficiency-screen.component';
import { BlanketBlastertwoEfficiencyScreen } from './blanket-blastertwo-efficiency-screen/blanket-blastertwo-efficiency-screen.component';
import { EfficiencyScreenLaneComponent } from './efficiency-screen-lane/efficiency-screen-lane.component';

const screens: Array<{ component: Type<any>; serial: number }> = [
  { component: BlanketBlasteroneEfficiencyScreen, serial: 90009 },
  { component: BlanketBlastertwoEfficiencyScreen, serial: 90010 }
];

for (const { component, serial } of screens) {
  describe(`Blanket Blaster ${serial} shared layout`, () => {
    let responses: Subject<any>;
    let fetch: jasmine.Spy;

    beforeEach(async () => {
      responses = new Subject<any>();
      fetch = jasmine.createSpy('getLiveEfficiencySummary').and.returnValue(responses);
      await TestBed.configureTestingModule({
        imports: [component],
        providers: [
          { provide: EfficiencyScreensService, useValue: { getLiveEfficiencySummary: fetch } },
          { provide: PercentBreakpointService, useValue: {
            getDashboardColor: () => 'green', getOeDashboardColor: () => 'orange'
          } }
        ]
      }).compileComponents();
    });

    it('uses machine-wide OEE and shared tiles instead of legacy tiles', fakeAsync(() => {
      const fixture = TestBed.createComponent(component);
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Loading');
      tick(0);
      const operator = { status: 1, operator: 'Operator', efficiency: {}, oee: { today: { value: 33, hasData: true } } };
      const machineLane = { machine: 'Blanket', oee: { today: { value: 84, hasData: true } } };
      responses.next({ flipperData: [operator], machineLane });
      fixture.detectChanges();
      const tiles = fixture.debugElement.queryAll(By.directive(EfficiencyScreenLaneComponent));
      expect(fetch).toHaveBeenCalledWith(serial);
      expect(tiles.length).toBe(2);
      expect(tiles[0].componentInstance.mode).toBe('operator');
      expect(tiles[1].componentInstance.mode).toBe('oee');
      expect(tiles[1].componentInstance.lane).toBe(machineLane);
      expect(tiles[1].nativeElement.textContent).toContain('84%');
      expect(fixture.nativeElement.querySelector('ct-lane-running, ct-lane-oee')).toBeNull();
      fixture.destroy();
      const calls = fetch.calls.count();
      tick(12000);
      expect(fetch.calls.count()).toBe(calls);
    }));

    it('preserves fault, paused, offline and no-operator states', fakeAsync(() => {
      const fixture = TestBed.createComponent(component);
      fixture.detectChanges();
      tick(0);
      responses.next({ flipperData: [
        { status: 2, fault: 'Fault' }, { status: 0 }, { status: -1 }, { status: 1, operator: null }
      ], machineLane: null });
      fixture.detectChanges();
      const tiles = fixture.debugElement.queryAll(By.directive(EfficiencyScreenLaneComponent));
      expect(tiles.map(tile => tile.componentInstance.mode)).toEqual(['fault', 'offline', 'offline', 'operator']);
      expect(tiles[3].componentInstance.isNoOperator).toBeTrue();
      expect(tiles[3].nativeElement.textContent).toContain('N/A');
      fixture.destroy();
    }));

    it('renders machine OEE without operators and an empty state without data', fakeAsync(() => {
      const fixture = TestBed.createComponent(component);
      fixture.detectChanges();
      tick(0);
      responses.next({ flipperData: [], machineLane: { oee: {} } });
      fixture.detectChanges();
      expect(fixture.debugElement.queryAll(By.directive(EfficiencyScreenLaneComponent)).length).toBe(1);
      expect(fixture.nativeElement.textContent).toContain('OEE');
      responses.next({ flipperData: [], machineLane: null });
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('No Blanket Blaster data');
      fixture.destroy();
    }));
  });
}
