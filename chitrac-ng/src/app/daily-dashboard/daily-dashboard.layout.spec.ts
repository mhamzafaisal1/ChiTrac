import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { DailyDashboardComponent } from './daily-dashboard.component';
import { SummaryCardVisibilityDialogComponent } from '../components/summary-card-visibility-dialog/summary-card-visibility-dialog.component';
import { LayoutEditService } from '../services/layout-edit.service';

describe('Daily chart layout picker', () => {
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
      dragDropEnabled: true,
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

  it('drags charts within Shown and between lists while enforcing the exact count', () => {
    expect(component.dragDropEnabled).toBeTrue();
    const shown = { data: component.showCards }, hidden = { data: component.hideCards };
    const drop = (from: any, to: any, previousIndex: number, currentIndex: number) =>
      component.drop({ previousContainer: from, container: to, previousIndex, currentIndex } as any, to === shown);
    drop(shown, shown, 0, 2);
    expect(component.showCards.map(card => card.id)).toEqual(['chart-1', 'chart-2', 'chart-0', 'chart-3', 'chart-4', 'chart-5']);
    drop(shown, hidden, 2, 1);
    expect(component.canApply).toBeFalse();
    drop(hidden, shown, 0, 1);
    expect(component.canApply).toBeTrue();
    drop(hidden, shown, 0, 0); // A full layout must not accept another chart.
    expect(component.showCards.length).toBe(6);
    component.save();
    const result = close.calls.mostRecent().args[0];
    expect(result.order).toEqual(['chart-1', 'chart-6', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-0']);
    expect(result.visibility['chart-0']).toBeFalse();
    expect(result.visibility['chart-6']).toBeTrue();
    expect(data.cards.map((card: any) => card.id)).toEqual(Array.from({ length: 7 }, (_, i) => `chart-${i}`));
    expect(data.visibility).toEqual({ 'chart-6': false });
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

describe('Daily dashboard layout state', () => {
  let dashboard: DailyDashboardComponent;
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
      setDailyDashboardChartOrder: jasmine.createSpy('set'),
      saveDailyDashboardChartOrder: jasmine.createSpy('save').and.returnValue(of({})),
    };
    dialog = { open: jasmine.createSpy('open').and.returnValue({ afterClosed: () => closed }) };
    dashboard = new DailyDashboardComponent(
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
    expect(settings.setDailyDashboardChartOrder.calls.mostRecent().args[2]).toBe('2x2');
    dashboard.onChartDrop({ previousIndex: 0, currentIndex: 2 } as any);
    expect(settings.setDailyDashboardChartOrder.calls.mostRecent().args[2]).toBe('2x2');
    (dashboard as any).revertLayoutChanges();
    expect(dashboard.gridLayout).toBe('3x2');
    expect(dashboard.visibleChartTiles.map(tile => tile.id)).toEqual(original);
    expect(dashboard.layoutEditing).toBeFalse();
  });

  it('applies and saves modal drag order with visibility, and restores both on discard', () => {
    const original = dashboard.chartTiles.map(tile => tile.id);
    const order = [...original].reverse();
    const selected = Object.fromEntries(order.map((id, index) => [id, index < 4]));
    editor.toggle();
    dashboard.openChartVisibilityDialog();
    expect(dialog.open.calls.mostRecent().args[1].data.dragDropEnabled).toBeTrue();
    closed.next({ layout: '2x2', visibility: selected, order });
    expect(dashboard.visibleChartTiles.map(tile => tile.id)).toEqual(order.slice(0, 4));
    expect(settings.setDailyDashboardChartOrder.calls.mostRecent().args).toEqual([order, selected, '2x2']);
    (dashboard as any).saveLayout().subscribe();
    expect(settings.saveDailyDashboardChartOrder.calls.mostRecent().args).toEqual([order, selected, '2x2']);
    editor.toggle();
    dashboard.openChartVisibilityDialog();
    closed.next({ layout: '2x2', visibility: selected, order: original });
    (dashboard as any).revertLayoutChanges();
    expect(dashboard.chartTiles.map(tile => tile.id)).toEqual(order);
    expect(dashboard.visibleChartTiles.map(tile => tile.id)).toEqual(order.slice(0, 4));
  });

  it('does not apply invalid chart counts or a cancelled dialog', () => {
    dashboard.openChartVisibilityDialog();
    closed.next({ layout: '2x2', visibility: visibility(5), order: [] });
    closed.next(undefined);
    expect(dashboard.gridLayout).toBe('3x2');
    expect(settings.setDailyDashboardChartOrder).not.toHaveBeenCalled();
  });

  it('saves the grid and visibility together and retains the draft if saving fails', () => {
    editor.toggle();
    dashboard.openChartVisibilityDialog();
    closed.next({ layout: '2x2', visibility: visibility(4), order: [] });
    settings.saveDailyDashboardChartOrder.and.returnValue(throwError(() => new Error('offline')));
    (dashboard as any).saveLayout().subscribe({ error() {} });
    expect(dashboard.gridLayout).toBe('2x2');
    expect(dashboard.layoutEditing).toBeTrue();
    expect(settings.saveDailyDashboardChartOrder.calls.mostRecent().args[2]).toBe('2x2');
    settings.saveDailyDashboardChartOrder.and.returnValue(of({}));
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
