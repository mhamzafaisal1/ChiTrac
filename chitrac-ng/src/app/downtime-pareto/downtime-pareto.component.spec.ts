import { TestBed } from '@angular/core/testing';
import { DowntimeParetoComponent } from './downtime-pareto.component';
import { DailyDashboardService } from '../services/daily-dashboard.service';
import { FaultService } from '../services/fault.service';
import { DateTimeService } from '../services/date-time.service';
import { DashboardTimeframeService } from '../services/dashboard-timeframe.service';
import { PollingService } from '../services/polling-service.service';
import { WebsocketService } from '../services/websocket.service';
import { ThemeService } from '../services/theme.service';

describe('Downtime Pareto categories', () => {
  const STORAGE_KEY = 'chitrac.downtimePareto.categories';
  const summaries: any[] = [
    { category: 'fault', code: 2110, name: 'LR Estop', count: 2, totalDurationSeconds: 600 },
    { category: 'paused', code: 0, name: 'Paused', count: 3, totalDurationSeconds: 900 },
    { category: 'offline', code: -1, name: 'Offline', count: 1, totalDurationSeconds: 1800 },
  ];

  function create(): DowntimeParetoComponent {
    TestBed.configureTestingModule({
      imports: [DowntimeParetoComponent],
      providers: [
        { provide: DailyDashboardService, useValue: {} },
        { provide: FaultService, useValue: {} },
        { provide: DateTimeService, useValue: {} },
        { provide: DashboardTimeframeService, useValue: {} },
        { provide: PollingService, useValue: {} },
        { provide: WebsocketService, useValue: {} },
        { provide: ThemeService, useValue: { isDark: false } },
      ],
    });
    // No detectChanges: ngOnInit (data loading) is not needed for these checks.
    return TestBed.createComponent(DowntimeParetoComponent).componentInstance;
  }

  beforeEach(() => localStorage.removeItem(STORAGE_KEY));
  afterEach(() => localStorage.removeItem(STORAGE_KEY));

  it('shows faults and paused by default, offline hidden', () => {
    const component = create();
    (component as any).processRows(summaries);
    expect(component.rows.map((row: any) => row.category)).toEqual(['paused', 'fault']);
    expect(component.totalDuration).toBe(1500);
    expect(component.categoryTotals.offline).toBe(1800);
  });

  it('labels faults with their code and paused/offline by name', () => {
    const component = create();
    component.toggleCategory('offline');
    (component as any).processRows(summaries);
    expect(component.rows.map((row: any) => row.fault)).toEqual(['Offline', 'Paused', 'LR Estop (2110)']);
  });

  it('toggling recomputes totals and remembers the choice', () => {
    const component = create();
    (component as any).processRows(summaries);
    component.toggleCategory('paused');
    expect(component.rows.length).toBe(1);
    expect(component.totalDuration).toBe(600);
    expect(component.rows[0].share).toBeCloseTo(100);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')).toEqual(['fault']);
    expect((component as any).loadCategoryPreference()).toEqual(['fault']);
  });

  it('treats older summaries without a category as faults', () => {
    const component = create();
    (component as any).processRows([{ code: 2115, name: 'Doors', count: 1, totalDurationSeconds: 60 }]);
    expect(component.rows[0].category).toBe('fault');
  });

  it('keeps legacy faults with a null code when Paused is disabled', () => {
    const component = create();
    (component as any).processRows([
      { code: null, name: 'Legacy fault', count: 1, totalDurationSeconds: 60 },
      { code: '0', name: 'Paused', count: 1, totalDurationSeconds: 120 },
    ]);
    component.toggleCategory('paused');
    expect(component.rows.map(row => row.fault)).toEqual(['Legacy fault']);
    expect(component.totalDuration).toBe(60);
  });
});
