import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SettingsService } from './services/settings.service';
import { PercentBreakpointService } from './services/percent-breakpoint.service';
import { ActionCenterComponent } from './action-center/action-center.component';
import { VisualOpsDashboardComponent } from './visual-ops-dashboard/visual-ops-dashboard.component';
import { DowntimeParetoComponent } from './downtime-pareto/downtime-pareto.component';

describe('Operations data and loading regressions', () => {
  let settings: SettingsService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    settings = TestBed.inject(SettingsService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('shares concurrent settings reads, retries errors, and permits explicit refreshes', () => {
    settings.loadSettings().subscribe({ error: () => {} });
    settings.loadSettings().subscribe({ error: () => {} });
    http.expectOne('/api/utilities/settings').flush({}, { status: 500, statusText: 'Unavailable' });
    settings.loadSettings().subscribe();
    settings.loadSettings().subscribe();
    http.expectOne('/api/utilities/settings').flush({ systemName: 'chitrac', oePercentBreakpoints: { poor: 0, okay: 55, good: 72 } });
    expect(settings.getSettings()?.oePercentBreakpoints?.good).toBe(72);
    settings.loadSettings().subscribe();
    http.expectOne('/api/utilities/settings').flush({ systemName: 'chitrac' });
  });

  it('does not present absent snapshots as healthy zeroes and retains real zero counts', () => {
    const component = TestBed.runInInjectionContext(() => new ActionCenterComponent({} as any, {} as any, {} as any));
    (component as any).rebuildFromCache({});
    expect(component.cacheReady).toBeFalse();
    expect(component.insightCards.every(card => card.value === '—' && card.tone === 'neutral')).toBeTrue();
    (component as any).rebuildFromCache({ today: { machinesSummary: [], operatorsSummary: [] } });
    expect(component.cacheReady).toBeTrue();
    expect(component.insightCards.find(card => card.label === 'Total Count')?.value).toBe('0');
    expect(component.insightCards.find(card => card.label === 'Plant OEE')?.value).toBe('—');
  });

  it('uses configured OEE thresholds and plots the bar and target on the same scale', () => {
    const component = new VisualOpsDashboardComponent({} as any, {} as any, {} as any, {} as any,
      TestBed.inject(PercentBreakpointService), settings);
    settings.loadSettings().subscribe();
    http.expectOne('/api/utilities/settings').flush({ systemName: 'chitrac', oePercentBreakpoints: { poor: 0, okay: 50, good: 72 } });
    expect(component.oeeTarget).toBe(72);
    expect(component.heatTone(73)).toBe('good');
    expect(component.heatTone(55)).toBe('watch');
    expect(component.heatTone(49)).toBe('bad');
    expect(component.bulletWidth({ oee: 72 } as any)).toBe(component.targetOffset());
  });

  it('keeps distinct machines and fault codes identifiable without changing Pareto totals', () => {
    const component = new DowntimeParetoComponent({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    (component as any).processRows([{ name: 'Estop/Door', code: 10, count: 2, totalDurationSeconds: 100, faults: [
      { machineSerial: 1, machineName: 'LPL1', durationSeconds: 40 },
      { machineSerial: 2, machineName: 'LPL2', durationSeconds: 60 }
    ] }, { name: 'Estop/Door', code: 11, count: 1, totalDurationSeconds: 20 }]);
    expect(component.totalDuration).toBe(120);
    expect(component.totalCount).toBe(3);
    expect(component.rows.length).toBe(3);
    expect(component.rows[0].machine).toContain('LPL2');
    expect(component.rows[0].fault).toContain('(10)');
    expect(component.rows[2].fault).toContain('(11)');
  });
});
