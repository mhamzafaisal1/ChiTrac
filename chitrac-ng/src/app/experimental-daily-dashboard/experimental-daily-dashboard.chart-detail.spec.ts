import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ChartTileComponent } from '../components/chart-tile/chart-tile.component';
import { WebsocketService } from '../services/websocket.service';
import { DateTimeService } from '../services/date-time.service';
import { DashboardTimeframeService } from '../services/dashboard-timeframe.service';
import { LayoutEditService } from '../services/layout-edit.service';
import { SettingsService } from '../services/settings.service';
import { UserService } from '../user.service';
import { Subject, BehaviorSubject } from 'rxjs';
import { ExperimentalDailyDashboardComponent } from './experimental-daily-dashboard.component';
import { DAILY_CHART_COMPONENTS, DailyChartDetailComponent } from '../components/daily-chart-detail/daily-chart-detail.component';

describe('Experimental Daily Dashboard chart detail', () => {
  let dashboard: ExperimentalDailyDashboardComponent;
  let closed: Subject<void>;
  let open: jasmine.Spy;
  let close: jasmine.Spy;

  beforeEach(() => {
    closed = new Subject<void>();
    close = jasmine.createSpy('close');
    open = jasmine.createSpy('open').and.returnValue({ close, afterClosed: () => closed });
    dashboard = new ExperimentalDailyDashboardComponent(
      {} as any, {} as any, {} as any,
      { unregister: () => {} } as any, {} as any, {} as any,
      { open } as any, {} as any,
    );
  });

  afterEach(() => dashboard.ngOnDestroy());

  it('maps every tile to its existing chart and matching data', () => {
    for (const tile of dashboard.chartTiles) {
      const data = [{ marker: tile.id }];
      dashboard.preloadedData = { [DAILY_CHART_COMPONENTS[tile.id].dataKey]: data };
      dashboard.openChartDetail(tile);
      const options = open.calls.mostRecent().args[1];
      expect(options.data.component).toBe(DailyChartDetailComponent);
      expect(options.data.componentInputs.chartId).toBe(tile.id);
      expect(options.data.componentInputs.state$.value.data).toBe(data);
      expect(options.ariaLabel).toBe(tile.title);
      closed.next();
    }
    expect(open).toHaveBeenCalledTimes(7);
  });

  it('does not open during editing or open a second modal', () => {
    dashboard.layoutEditing = true;
    dashboard.openChartDetail(dashboard.chartTiles[0]);
    expect(open).not.toHaveBeenCalled();
    dashboard.layoutEditing = false;
    dashboard.openChartDetail(dashboard.chartTiles[0]);
    dashboard.openChartDetail(dashboard.chartTiles[1]);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('updates the open chart from the dashboard without changing the selected chart', () => {
    dashboard.openChartDetail(dashboard.chartTiles[0]);
    const inputs = open.calls.mostRecent().args[1].data.componentInputs;
    dashboard.preloadedData = { machineStatus: [{ count: 42 }] };
    dashboard.cacheSubtitle = 'Afternoon Shift';
    dashboard.cacheUpdatedAt = 'Updated 2:00 PM';
    (dashboard as any).updateChartDetail();
    expect(inputs.state$.value).toEqual({
      data: [{ count: 42 }], subtitle: 'Afternoon Shift', subtitleStrong: false, updatedAt: 'Updated 2:00 PM',
    });
    expect(inputs.chartId).toBe('machine-status');
  });

  it('preserves the daily-count timeframe and handles missing data', () => {
    dashboard.openChartDetail(dashboard.chartTiles.find(tile => tile.id === 'daily-counts')!);
    const state = open.calls.mostRecent().args[1].data.componentInputs.state$.value;
    expect(state.subtitle).toBe('Last 28 Days');
    expect(state.data).toBeNull();
  });

  it('passes daily count choices into the enlarged chart without resetting on updates', () => {
    dashboard.setDailyCountOption('averageLine', false);
    dashboard.setDailyCountOption('tooltip', false);
    dashboard.openChartDetail(dashboard.chartTiles.find(tile => tile.id === 'daily-counts')!);
    const state = open.calls.mostRecent().args[1].data.componentInputs.state$;
    const detail = new DailyChartDetailComponent({} as any, {} as any);
    detail.chartId = 'daily-counts';
    expect(detail.chartInputs(state.value)['displayOptions']).toEqual({ averageLine: false, barColors: true, tooltip: false });
    dashboard.preloadedData = { dailyCounts: [{ date: '2026-10-20', count: 42 }] };
    (dashboard as any).updateChartDetail();
    expect(detail.chartInputs(state.value)['displayOptions']).toEqual({ averageLine: false, barColors: true, tooltip: false });
  });

  it('keeps each yesterday choice independent and passes it to the enlarged chart on cache updates', () => {
    for (const id of dashboard.yesterdayChartIds) {
      const tile = dashboard.chartTiles.find(tile => tile.id === id)!;
      dashboard.setYesterdayVisibility(id, false);
      expect(dashboard.yesterdayChartIds.filter(other => other !== id).every(other => dashboard.yesterdayVisibility[other] !== false)).toBeTrue();
      dashboard.openChartDetail(tile);
      const state = open.calls.mostRecent().args[1].data.componentInputs.state$;
      const detail = new DailyChartDetailComponent({} as any, {} as any);
      detail.chartId = id;
      expect(detail.chartInputs(state.value)['showYesterday']).toBeFalse();
      dashboard.preloadedData = { [DAILY_CHART_COMPONENTS[id].dataKey]: [] };
      (dashboard as any).updateChartDetail();
      expect(detail.chartInputs(state.value)['showYesterday']).toBeFalse();
      closed.next();
      dashboard.setYesterdayVisibility(id, true);
    }
  });

  it('completes modal state on close and allows reopening', () => {
    dashboard.openChartDetail(dashboard.chartTiles[0]);
    const completed = jasmine.createSpy('completed');
    open.calls.mostRecent().args[1].data.componentInputs.state$.subscribe({ complete: completed });
    closed.next();
    expect(completed).toHaveBeenCalled();
    dashboard.openChartDetail(dashboard.chartTiles[1]);
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe('Dashboard chart header controls', () => {
  let fixture: any;
  let dashboard: ExperimentalDailyDashboardComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ExperimentalDailyDashboardComponent],
      providers: [provideNoopAnimations(),
        { provide: WebsocketService, useValue: { ensureConnected: () => {}, status$: new Subject(), dashboardCache$: new Subject() } },
        { provide: DateTimeService, useValue: { getConfirmed: () => true } },
        { provide: DashboardTimeframeService, useValue: {} },
        { provide: LayoutEditService, useValue: { register: () => {}, unregister: () => {}, context$: new BehaviorSubject(null), lockRequested$: new Subject() } },
        { provide: SettingsService, useValue: { timeFormat$: new Subject(), userPreferences$: new Subject() } },
        { provide: UserService, useValue: {} },
        { provide: MatDialog, useValue: {} },
      ],
    }).overrideComponent(ExperimentalDailyDashboardComponent, {
      set: { imports: [CommonModule, ChartTileComponent, MatSlideToggleModule], schemas: [NO_ERRORS_SCHEMA] },
    });
    fixture = TestBed.createComponent(ExperimentalDailyDashboardComponent);
    dashboard = fixture.componentInstance;
    spyOn(dashboard as any, 'setupChartResizeObserver');
    spyOn(dashboard as any, 'scheduleChartDimensionUpdate');
    fixture.detectChanges(); // Complete the initial (locked) layout subscription first.
  });
  afterEach(() => fixture.destroy());

  it('keeps daily-count options in Edit Layout with isolated pointer and keyboard events', () => {
    dashboard.chartTiles = dashboard.chartTiles.filter(tile => tile.id === 'daily-counts');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.daily-count-controls')).toBeNull();
    dashboard.layoutEditing = true;
    fixture.detectChanges();
    const inputs = fixture.nativeElement.querySelectorAll('.chart-tile-header input');
    expect(inputs.length).toBe(3);
    expect(Array.from(inputs as NodeListOf<HTMLInputElement>).every(input => input.checked)).toBeTrue();
    const shell = fixture.nativeElement.querySelector('.chart-shell');
    const propagated = jasmine.createSpy('propagated');
    shell.addEventListener('click', propagated);
    shell.addEventListener('keydown', propagated);
    shell.addEventListener('pointerdown', propagated);
    inputs[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    inputs[0].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    inputs[0].click();
    fixture.detectChanges();
    expect(dashboard.dailyCountDisplayOptions.averageLine).toBeFalse();
    expect(dashboard.dailyCountDisplayOptions.barColors).toBeTrue();
    expect(propagated).not.toHaveBeenCalled();
    dashboard.layoutEditing = false;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.daily-count-controls')).toBeNull();
    expect(dashboard.dailyCountDisplayOptions.averageLine).toBeFalse();
  });

  it('uses independent Yesterday slide toggles only in Edit Layout and isolates their events', () => {
    dashboard.chartTiles = dashboard.yesterdayChartIds.map(id => ({ id, title: id, icon: 'bar_chart' }));
    dashboard.layoutEditing = true;
    fixture.detectChanges();
    const yesterdayInputs = fixture.nativeElement.querySelectorAll('.chart-tile-header button[role="switch"]');
    expect(yesterdayInputs.length).toBe(4);
    expect(Array.from(yesterdayInputs as NodeListOf<HTMLButtonElement>).every(input => input.getAttribute('aria-checked') === 'true')).toBeTrue();
    expect(fixture.nativeElement.querySelector('.yesterday-controls input[type="checkbox"]')).toBeNull();
    const propagated = jasmine.createSpy('propagated');
    const shell = yesterdayInputs[0].closest('.chart-shell');
    for (const event of ['click', 'keydown', 'pointerdown']) shell.addEventListener(event, propagated);
    yesterdayInputs[0].focus();
    expect(document.activeElement).toBe(yesterdayInputs[0]);
    yesterdayInputs[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    yesterdayInputs[0].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    yesterdayInputs[0].click();
    fixture.detectChanges();
    expect(dashboard.yesterdayVisibility['machine-oee']).toBeFalse();
    expect(propagated).not.toHaveBeenCalled();
    expect(yesterdayInputs[0].getAttribute('aria-checked')).toBe('false');
    const offTrack = yesterdayInputs[0].getBoundingClientRect();
    const offHandle = yesterdayInputs[0].querySelector('.mdc-switch__handle').getBoundingClientRect();
    expect(offHandle.left).toBeGreaterThanOrEqual(offTrack.left);
    expect(offHandle.right).toBeLessThanOrEqual(offTrack.right);
    expect(yesterdayInputs[0].getAttribute('aria-label')).toContain('machine-oee');
    expect(dashboard.yesterdayChartIds.slice(1).every(id => dashboard.yesterdayVisibility[id] !== false)).toBeTrue();
    dashboard.layoutEditing = false;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.yesterday-controls')).toBeNull();
    dashboard.layoutEditing = true; fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[role="switch"]').getAttribute('aria-checked')).toBe('false');
  });

  for (const width of [320, 360, 640]) {
    for (const dark of [false, true]) {
      it(`keeps Yesterday switches in the title row, clear of drag handles at ${width}px (${dark ? 'dark' : 'light'})`, () => {
        Object.assign(fixture.nativeElement.style, { display: 'block', width: `${width}px` });
        fixture.nativeElement.style.setProperty('--theme-color-text', dark ? '#fff' : '#222');
        if (dark) fixture.nativeElement.classList.add('dark-theme');
        dashboard.isDarkTheme = dark;
        dashboard.chartTiles = dashboard.chartTiles.filter(tile => dashboard.yesterdayChartIds.includes(tile.id));
        dashboard.layoutEditing = true;
        dashboard.cacheSubtitle = 'Today'; dashboard.cacheUpdatedAt = 'Updated 12:30 PM';
        fixture.detectChanges();
        // Exercise a single tile's width independently of the viewport/grid breakpoint.
        fixture.nativeElement.querySelector('.charts-grid').style.gridTemplateColumns = 'minmax(0, 1fr)';
        const shells: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.chart-shell'));
        expect(shells.length).toBe(4);
        for (const shell of shells) {
          const title = shell.querySelector('.chart-tile-title')!.getBoundingClientRect();
          const header = shell.querySelector('.chart-tile-header')!.getBoundingClientRect();
          const control = shell.querySelector('.yesterday-controls')!.getBoundingClientRect();
          const drag = shell.querySelector('.chart-drag-handle')!.getBoundingClientRect();
          const toggle = shell.querySelector('button[role="switch"]')!.getBoundingClientRect();
          const handle = shell.querySelector('.mdc-switch__handle')!.getBoundingClientRect();
          // The test runner uses the legacy M2 theme; both themes must stay compact.
          expect(toggle.width).toBe(36); expect(toggle.height).toBeLessThanOrEqual(20);
          expect(handle.width).toBeLessThanOrEqual(20); expect(handle.height).toBeLessThanOrEqual(20);
          expect(handle.left).toBeGreaterThanOrEqual(toggle.left);
          expect(handle.right).toBeLessThanOrEqual(toggle.right);
          expect(control.top).toBeLessThan(title.bottom);
          expect(title.right).toBeLessThanOrEqual(control.left);
          expect(control.right + 4).toBeLessThanOrEqual(drag.left);
          expect(control.bottom).toBeLessThanOrEqual(header.bottom);
          expect(header.height).toBeLessThanOrEqual(50);
          expect(shell.querySelector('.chart-content mat-slide-toggle')).toBeNull();
        }
      });
    }
  }
});
