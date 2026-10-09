import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, Subject, throwError } from 'rxjs';
import { LayoutSaveConfirmComponent, openLayoutSaveConfirmDialog } from './layout-save-confirm.component';
import { MachineDashboardComponent } from '../../machine-dashboard/machine-dashboard.component';
import { OperatorAnalyticsDashboardComponent } from '../../operator-analytics-dashboard/operator-analytics-dashboard.component';
import { DailySummaryDashboardComponent } from '../../daily-summary-dashboard/daily-summary-dashboard.component';
import { ExperimentalDailyDashboardComponent } from '../../experimental-daily-dashboard/experimental-daily-dashboard.component';

describe('Layout save dialog', () => {
  let fixture: any;
  let response: Subject<unknown>;
  let save: jasmine.Spy;
  let ref: any;

  beforeEach(() => {
    response = new Subject();
    save = jasmine.createSpy('save').and.returnValue(response);
    ref = { close: jasmine.createSpy('close'), disableClose: false };
    TestBed.configureTestingModule({
      imports: [LayoutSaveConfirmComponent],
      providers: [provideNoopAnimations(), { provide: MAT_DIALOG_DATA, useValue: { save } },
        { provide: MatDialogRef, useValue: ref }],
    });
    fixture = TestBed.createComponent(LayoutSaveConfirmComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('keeps the dialog open and blocks duplicate saves until completion', () => {
    const component = fixture.componentInstance;
    component.save();
    component.save();
    fixture.detectChanges();
    expect(save).toHaveBeenCalledTimes(1);
    expect(ref.disableClose).toBeTrue();
    expect(fixture.nativeElement.querySelector('mat-spinner')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('mat-dialog-actions')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Saving...');
    response.next({});
    expect(ref.close).not.toHaveBeenCalled();
    response.complete();
    expect(ref.close).toHaveBeenCalledOnceWith('saved');
  });

  it('shows an inline failure and can retry without discarding the draft', () => {
    fixture.componentInstance.save();
    response.error(new Error('Failed'));
    fixture.detectChanges();
    expect(ref.close).not.toHaveBeenCalled();
    expect(ref.disableClose).toBeFalse();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Your changes');
    expect(fixture.nativeElement.textContent).toContain('Retry');
    save.and.returnValue(of({}));
    fixture.componentInstance.save();
    expect(ref.close).toHaveBeenCalledOnceWith('saved');
  });

  it('handles synchronous save errors and preserves Keep Editing', () => {
    save.and.callFake(() => { throw new Error('Storage failed'); });
    fixture.componentInstance.save();
    fixture.detectChanges();
    expect(fixture.componentInstance.saving).toBeFalse();
    const keepEditing = [...fixture.nativeElement.querySelectorAll('button')]
      .find((button: any) => button.textContent.includes('Keep Editing')) as HTMLButtonElement;
    keepEditing.click();
    expect(ref.close).toHaveBeenCalledWith('keep-editing');
  });

  it('cancels pending work on destruction without reporting success', () => {
    fixture.componentInstance.save();
    fixture.destroy();
    expect(response.observed).toBeFalse();
    expect(ref.close).not.toHaveBeenCalled();
  });

  it('prevents duplicate dialogs and closes on dashboard destruction', () => {
    const destroyed = new Subject<void>();
    const closed = new Subject<void>();
    const dialog: any = { openDialogs: [{ componentInstance: fixture.componentInstance }], open: jasmine.createSpy('open') };
    expect(openLayoutSaveConfirmDialog(dialog, save, destroyed)).toBeUndefined();
    expect(dialog.open).not.toHaveBeenCalled();
    dialog.openDialogs = [];
    dialog.open.and.returnValue({ close: ref.close, afterClosed: () => closed });
    openLayoutSaveConfirmDialog(dialog, save, destroyed);
    destroyed.next();
    expect(ref.close).toHaveBeenCalledWith('keep-editing');
  });
});

const dashboards = [
  [MachineDashboardComponent, 'saveLayoutPreferences', 'saveMachineDashboardLayout', 'setMachineDashboardLayout'],
  [OperatorAnalyticsDashboardComponent, 'saveLayoutPreferences', 'saveOperatorDashboardLayout', 'setOperatorDashboardLayout'],
  [DailySummaryDashboardComponent, 'saveSummaryCardLayout', 'saveSummaryDashboardLayout', 'setSummaryDashboardLayout'],
  [ExperimentalDailyDashboardComponent, 'saveLayout', 'saveExperimentalDailyDashboardChartOrder', 'setExperimentalDailyDashboardChartOrder'],
] as const;

for (const [type, method, serverSave, localSave] of dashboards) {
  describe(`${type.name} layout save`, () => {
    let dashboard: any;
    let response: Subject<unknown>;
    beforeEach(() => {
      dashboard = Object.create(type.prototype);
      response = new Subject();
      dashboard.settingsService = jasmine.createSpyObj('settings', [serverSave, localSave]);
      dashboard.settingsService[serverSave].and.returnValue(response);
      dashboard.userService = { getToken: () => 'test-token' };
      dashboard.layoutEditService = { setEditing: jasmine.createSpy('setEditing') };
      dashboard.layoutSnapshot = { draft: true };
      dashboard.getSummaryCardOrder = () => ['Machines'];
      dashboard.getChartOrder = () => ['machine-timeline'];
      dashboard.cleanTableColumnVisibility = (value: any) => value;
      dashboard.cleanTableColumnOrder = (value: any) => value;
      dashboard.cleanSummaryCardVisibility = (value: any) => value;
      dashboard.tableColumnVisibility = {};
      dashboard.tableColumnOrder = [];
      dashboard.summaryCardVisibility = {};
      dashboard.chartVisibility = {};
      dashboard.summaryCardOrderKey = 'test-layout-order';
      dashboard.summaryCardVisibilityKey = 'test-layout-visibility';
    });
    afterEach(() => {
      localStorage.removeItem(dashboard.summaryCardOrderKey);
      localStorage.removeItem(dashboard.summaryCardVisibilityKey);
    });

    it('does not republish preferences or exit edit mode until the request succeeds', () => {
      dashboard[method]().subscribe();
      expect(dashboard.settingsService[localSave]).not.toHaveBeenCalled();
      expect(dashboard.layoutEditService.setEditing).not.toHaveBeenCalled();
      response.next({});
      response.complete();
      expect(dashboard.layoutEditService.setEditing).toHaveBeenCalledOnceWith(false);
      expect(dashboard.layoutSnapshot).toBeNull();
    });

    it('retains the draft and edit mode after failure', () => {
      dashboard.settingsService[serverSave].and.returnValue(throwError(() => new Error('Failed')));
      dashboard[method]().subscribe({ error: () => {} });
      expect(dashboard.layoutSnapshot).toEqual({ draft: true });
      expect(dashboard.layoutEditService.setEditing).not.toHaveBeenCalled();
      expect(dashboard.settingsService[localSave]).not.toHaveBeenCalled();
    });

    it('preserves local-only saves without making an API request', () => {
      dashboard.userService.getToken = (): null => null;
      dashboard[method]().subscribe();
      expect(dashboard.settingsService[serverSave]).not.toHaveBeenCalled();
      expect(dashboard.settingsService[localSave]).toHaveBeenCalled();
      expect(dashboard.layoutEditService.setEditing).toHaveBeenCalledOnceWith(false);
      expect(dashboard.layoutSnapshot).toBeNull();
    });
  });
}
