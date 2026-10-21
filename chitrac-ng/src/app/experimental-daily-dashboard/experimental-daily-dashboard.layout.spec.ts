import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { ExperimentalDailyDashboardComponent } from './experimental-daily-dashboard.component';
import { SummaryCardVisibilityDialogComponent } from '../components/summary-card-visibility-dialog/summary-card-visibility-dialog.component';
import { LayoutEditService } from '../services/layout-edit.service';

describe('Experimental chart layout picker', () => {
  let fixture: any;
  let component: SummaryCardVisibilityDialogComponent;
  let close: jasmine.Spy;
  let data: any;

  beforeEach(() => {
    close = jasmine.createSpy('close');
    data = {
      cards: Array.from({ length: 7 }, (_, i) => ({ id: `chart-${i}`, label: `Chart ${i}` })),
      visibility: { 'chart-6': false },
      layout: '3x2',
      layoutOptions: [
        { id: '3x2', label: '3 × 2 — 6 charts', exactVisible: 6 },
        { id: '2x2', label: '2 × 2 — 4 charts', exactVisible: 4 },
      ],
    };
    TestBed.configureTestingModule({
      imports: [SummaryCardVisibilityDialogComponent],
      providers: [provideNoopAnimations(), { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } }],
    });
    fixture = TestBed.createComponent(SummaryCardVisibilityDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function choose(layout: string): void {
    fixture.nativeElement.querySelector(`input[value="${layout}"]`).click();
    fixture.detectChanges();
  }

  function hideOne(): void {
    component.selectShow(component.showCards[component.showCards.length - 1]);
    component.hideSelected();
    fixture.detectChanges();
  }

  it('requires the user to select exactly four after switching from six, without silently hiding charts', () => {
    choose('2x2');
    expect(component.showCards.length).toBe(6);
    expect(fixture.nativeElement.textContent).toContain('Exactly 4 required');
    const apply = fixture.nativeElement.querySelector('mat-dialog-actions button:last-child');
    expect(apply.disabled).toBeTrue();
    component.save();
    expect(close).not.toHaveBeenCalled();
    hideOne();
    expect(apply.disabled).toBeTrue();
    hideOne();
    expect(apply.disabled).toBeFalse();
    component.selectHide(component.hideCards[0]);
    component.showSelected();
    expect(component.showCards.length).toBe(4);
    apply.click();
    expect(close.calls.mostRecent().args[0].layout).toBe('2x2');
  });

  it('requires exactly six when returning to 3x2 and rejects too few charts', () => {
    choose('2x2'); hideOne(); hideOne();
    choose('3x2');
    expect(component.canApply).toBeFalse();
    component.save();
    expect(close).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) {
      component.selectHide(component.hideCards[0]);
      component.showSelected();
    }
    fixture.detectChanges();
    expect(component.canApply).toBeTrue();
    component.save();
    expect(close.calls.mostRecent().args[0].layout).toBe('3x2');
  });

  it('rejects fewer than four and cancels without mutating the supplied layout or selection', () => {
    choose('2x2'); hideOne(); hideOne(); hideOne();
    expect(component.canApply).toBeFalse();
    component.save();
    expect(close).not.toHaveBeenCalled();
    component.cancel();
    expect(close).toHaveBeenCalledWith();
    expect(data.layout).toBe('3x2');
    expect(data.visibility).toEqual({ 'chart-6': false });
  });
});

describe('Experimental dashboard layout state', () => {
  let dashboard: ExperimentalDailyDashboardComponent;
  let preferences: BehaviorSubject<any>;
  let editor: LayoutEditService;
  let settings: any;
  let closed: Subject<any>;
  let dialog: any;
  let user: any;

  beforeEach(() => {
    preferences = new BehaviorSubject<any>(null);
    closed = new Subject();
    user = { getToken: () => 'test-token' };
    editor = new LayoutEditService(user);
    settings = {
      timeFormat$: of('12h'), userPreferences$: preferences,
      setExperimentalDailyDashboardChartOrder: jasmine.createSpy('set'),
      saveExperimentalDailyDashboardChartOrder: jasmine.createSpy('save').and.returnValue(of({})),
    };
    dialog = { open: jasmine.createSpy('open').and.returnValue({ afterClosed: () => closed }) };
    dashboard = new ExperimentalDailyDashboardComponent(
      { ensureConnected() {}, status$: of('disconnected'), dashboardCache$: of({}) } as any,
      { getConfirmed: () => true } as any, {} as any, editor, settings, user, dialog, {} as any,
    );
    spyOn(dashboard as any, 'scheduleChartDimensionUpdate');
    dashboard.ngOnInit();
  });
  afterEach(() => dashboard.ngOnDestroy());

  function visibility(count: number): Record<string, boolean> {
    return Object.fromEntries(dashboard.chartTiles.map((tile, index) => [tile.id, index < count]));
  }

  it('defaults legacy layouts to 3x2 and restores 2x2 with exactly four charts', () => {
    expect(dashboard.gridLayout).toBe('3x2');
    expect(dashboard.visibleChartTiles.length).toBe(6);
    preferences.next({ dashboardLayouts: { experimentalDailyDashboard: { gridLayout: '2x2', chartVisibility: visibility(4) } } });
    expect(dashboard.gridLayout).toBe('2x2');
    expect(dashboard.visibleChartTiles.length).toBe(4);
    preferences.next({ dashboardLayouts: { experimentalDailyDashboard: { chartVisibility: visibility(6) } } });
    expect(dashboard.gridLayout).toBe('3x2');
    expect(dashboard.visibleChartTiles.length).toBe(6);
  });

  it('applies a valid selection, preserves its grid while reordering, and restores the full snapshot on discard', () => {
    const original = dashboard.visibleChartTiles.map(tile => tile.id);
    editor.toggle();
    dashboard.openChartVisibilityDialog();
    expect(dialog.open.calls.mostRecent().args[1].data.layout).toBe('3x2');
    closed.next({ layout: '2x2', visibility: visibility(4), order: [] });
    expect(dashboard.visibleChartTiles.length).toBe(4);
    expect(settings.setExperimentalDailyDashboardChartOrder.calls.mostRecent().args[2]).toBe('2x2');
    dashboard.onChartDrop({ previousIndex: 0, currentIndex: 2 } as any);
    expect(settings.setExperimentalDailyDashboardChartOrder.calls.mostRecent().args[2]).toBe('2x2');
    (dashboard as any).revertLayoutChanges();
    expect(dashboard.gridLayout).toBe('3x2');
    expect(dashboard.visibleChartTiles.map(tile => tile.id)).toEqual(original);
    expect(dashboard.layoutEditing).toBeFalse();
  });

  it('does not apply invalid chart counts or a cancelled dialog', () => {
    dashboard.openChartVisibilityDialog();
    closed.next({ layout: '2x2', visibility: visibility(5), order: [] });
    closed.next(undefined);
    expect(dashboard.gridLayout).toBe('3x2');
    expect(settings.setExperimentalDailyDashboardChartOrder).not.toHaveBeenCalled();
  });

  it('saves the grid and visibility together and retains the draft if saving fails', () => {
    editor.toggle();
    dashboard.openChartVisibilityDialog();
    closed.next({ layout: '2x2', visibility: visibility(4), order: [] });
    settings.saveExperimentalDailyDashboardChartOrder.and.returnValue(throwError(() => new Error('offline')));
    (dashboard as any).saveLayout().subscribe({ error() {} });
    expect(dashboard.gridLayout).toBe('2x2');
    expect(dashboard.layoutEditing).toBeTrue();
    expect(settings.saveExperimentalDailyDashboardChartOrder.calls.mostRecent().args[2]).toBe('2x2');
    settings.saveExperimentalDailyDashboardChartOrder.and.returnValue(of({}));
    (dashboard as any).saveLayout().subscribe();
    expect(dashboard.layoutEditing).toBeFalse();
  });

  it('repairs partial saved visibility and restores defaults on logout', () => {
    preferences.next({ dashboardLayouts: { experimentalDailyDashboard: { gridLayout: '2x2', chartVisibility: visibility(1) } } });
    expect(dashboard.visibleChartTiles.length).toBe(4);
    preferences.next(null);
    expect(dashboard.gridLayout).toBe('3x2');
    expect(dashboard.visibleChartTiles.length).toBe(6);
  });
});
