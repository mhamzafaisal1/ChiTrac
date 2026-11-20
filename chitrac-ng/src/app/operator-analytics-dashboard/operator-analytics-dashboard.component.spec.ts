import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { of, Subject } from 'rxjs';
import { OperatorAnalyticsDashboardComponent } from './operator-analytics-dashboard.component';
import { BaseTableComponent } from '../components/base-table/base-table.component';
import { OperatorService } from '../services/operator.service';
import { MachineService } from '../services/machine.service';
import { PollingService } from '../services/polling-service.service';
import { DateTimeService } from '../services/date-time.service';
import { DashboardTimeframeService } from '../services/dashboard-timeframe.service';
import { PercentBreakpointService } from '../services/percent-breakpoint.service';
import { WebsocketService } from '../services/websocket.service';
import { SettingsService } from '../services/settings.service';
import { UserService } from '../user.service';
import { LayoutEditService } from '../services/layout-edit.service';

const data = (value: number) => Array.from({ length: 120 }, (_, index) => ({
  operator: { id: index + 1, name: 'Operator ' + (index + 1) }, currentStatus: { code: 1 },
  currentMachine: { serial: 21, name: 'Machine' },
  metrics: { runtime: { total: 60000 }, downtime: { total: 0 }, pausedTime: { total: 0 }, faultTime: { total: 0 },
    output: { totalCount: value + index, misfeedCount: 0, pph: 100 }, performance: {
      availability: { percentage: 100 }, throughput: { percentage: 100 }, efficiency: { percentage: 90 }, oee: { percentage: 90 } } }
}));
const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

describe('Operator dashboard refresh stability', () => {
  let fixture: any, dashboard: any, operators: any;
  let scrollContainer: HTMLDivElement | null;
  beforeEach(() => {
    scrollContainer = null;
    spyOn(OperatorAnalyticsDashboardComponent.prototype, 'ngOnInit').and.stub();
    operators = { getOperatorSummary: () => of(data(1)), getOperatorSummaryWithTimeframe: () => of(data(1)) };
    TestBed.configureTestingModule({ imports: [OperatorAnalyticsDashboardComponent], providers: [provideNoopAnimations(),
      ...[MachineService, MatDialog, PollingService, DashboardTimeframeService, SettingsService, UserService]
        .map(provide => ({ provide, useValue: {} })),
      { provide: OperatorService, useValue: operators },
      { provide: DateTimeService, useValue: { getShiftId: () => '', getTimeframe: () => '' } },
      { provide: WebsocketService, useValue: { getDashboardCacheSnapshot: () => ({}) } },
      { provide: LayoutEditService, useValue: { unregister() {} } },
      { provide: PercentBreakpointService, useValue: { getColorClass: () => '', getOeColorClass: () => '', getDashboardColor: () => 'green', getOeDashboardColor: () => 'green' } }
    ] });
    fixture = TestBed.createComponent(OperatorAnalyticsDashboardComponent); dashboard = fixture.componentInstance;
    fixture.nativeElement.style.width = '1600px'; fixture.nativeElement.style.height = 'auto';
    dashboard.startTime = '2026-11-20T06:00:00Z'; dashboard.endTime = '2026-11-20T18:00:00Z';
    spyOn(dashboard, 'loadMachineStatusCounts').and.stub(); spyOn(dashboard, 'loadIdleOperatorSummary').and.stub();
    spyOn(dashboard, 'prefetchOperatorDetails').and.stub();
    spyOn(dashboard, 'shouldUseWebsocketDashboardData').and.returnValue(true);
  });
  afterEach(() => { window.scrollTo(0, 0); fixture.destroy(); scrollContainer?.remove(); });

  for (const scrollMode of ['document', 'container']) it(scrollMode + ' keeps scroll, row nodes, cards, sorting and selection during repeated REST/WebSocket updates', async () => {
    if (scrollMode === 'container') {
      scrollContainer = document.createElement('div');
      scrollContainer.style.cssText = 'height:600px;width:1600px;overflow-y:auto';
      fixture.nativeElement.parentNode.insertBefore(scrollContainer, fixture.nativeElement);
      scrollContainer.appendChild(fixture.nativeElement);
    }
    dashboard.updateDashboardData(data(1), {}); fixture.detectChanges(); await settle();
    const table: any = fixture.debugElement.query(By.directive(BaseTableComponent)).componentInstance;
    const api = table.gridApi; expect(api).toBeTruthy();
    dashboard.selectedRow = dashboard.rows[0]; fixture.detectChanges(); await settle();
    api.applyColumnState({ state: [{ colId: 'Operator Name', sort: 'asc' }] });
    table.searchTerm = 'Operator'; table.applyFilter(); await settle();
    const firstNode = api.getRowNode('operator:1'), card = fixture.nativeElement.querySelector('.summary-card');
    const scrollArea = scrollContainer || document.documentElement;
    const scrollPosition = () => scrollContainer ? scrollContainer.scrollTop : window.scrollY;
    expect(firstNode).toBeTruthy(); expect(scrollArea.scrollHeight).toBeGreaterThan(1500);
    const nearBottom = scrollArea.scrollHeight - (scrollContainer?.clientHeight || window.innerHeight) - 80;
    if (scrollContainer) scrollContainer.scrollTop = nearBottom;
    else window.scrollTo(0, nearBottom);
    await settle();
    const scroll = scrollPosition(); expect(scroll).toBeGreaterThan(500);
    for (let index = 0; index < 6; index++) {
      if (index % 2) dashboard.updateDashboardData(data(index + 20));
      else dashboard.tryApplyWebsocketDashboardData({ today: { operatorsSummary: data(index + 20) } });
      fixture.detectChanges(); await settle();
      expect(scrollPosition()).toBeCloseTo(scroll, 0);
      expect(api.getRowNode('operator:1')).toBe(firstNode);
      expect(fixture.nativeElement.querySelector('.summary-card')).toBe(card);
      expect(api.getColumnState().find((column: any) => column.colId === 'Operator Name').sort).toBe('asc');
      expect(table.getRowClass({ data: dashboard.rows[0] })).toContain('selected');
      expect(api.getDisplayedRowCount()).toBe(120);
    }
  });
  it('retains visible rows during background requests/errors but accepts an actual empty result', () => {
    dashboard.updateDashboardData(data(1), {}); fixture.detectChanges();
    const rows = dashboard.rows, pending = new Subject<any>();
    operators.getOperatorSummary = () => pending; dashboard.shouldUseWebsocketDashboardData.and.returnValue(false);
    dashboard.fetchAnalyticsData(); expect(dashboard.rows).toBe(rows); expect(dashboard.isLoading).toBeFalse();
    spyOn(console, 'error'); pending.error(new Error('temporary connection failure')); expect(dashboard.rows).toBe(rows);
    operators.getOperatorSummary = () => of([]); dashboard.fetchAnalyticsData(); expect(dashboard.rows).toEqual([]);
  });
  it('uses unique placeholder identities and stable identities across machine reassignment', () => {
    const first = { isDummy: true, 'Operator ID': '' }, second = { isDummy: true, 'Operator ID': '' };
    expect(dashboard.getOperatorRowIdentity(first)).not.toBe(dashboard.getOperatorRowIdentity(second));
    expect(dashboard.getOperatorRowIdentity(first)).toBe(dashboard.getOperatorRowIdentity(first));
    expect(dashboard.getOperatorRowIdentity({ 'Operator ID': 7, 'Current Machine Serial': 1 }))
      .toBe(dashboard.getOperatorRowIdentity({ 'Operator ID': 7, 'Current Machine Serial': 2 }));
  });
});
