import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { ExperimentalSpfComponent } from './experimental-spf.component';
import { SPF_STATION_IDS, normalizeSpfLayout } from './spf-stations';
import { EfficiencyScreensService } from '../../services/efficiency-screens.service';
import { SettingsService } from '../../services/settings.service';
import { UserService } from '../../user.service';
import { LayoutEditService } from '../../services/layout-edit.service';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';
import { SummaryCardVisibilityDialogComponent } from '../../components/summary-card-visibility-dialog/summary-card-visibility-dialog.component';

describe('Experimental SPF production layout', () => {
  let fixture: any, component: ExperimentalSpfComponent, editor: LayoutEditService;
  let preferences: BehaviorSubject<any>, identity: BehaviorSubject<any>, closed: Subject<any>;
  let service: any, settings: any, dialog: any, ref: any;
  let generation = 0;
  beforeEach(() => {
    preferences = new BehaviorSubject(null); identity = new BehaviorSubject({ username: 'alice' });
    closed = new Subject(); generation = 0;
    service = { getLiveEfficiencySummary: jasmine.createSpy().and.callFake((serial: number) => of({ flipperData: [{ serial, machine: 'SPF ' + serial, status: 1, operator: 'Operator ' + generation, efficiency: {}, batch: {} }] })) };
    settings = { userPreferences$: preferences, saveExperimentalSpfLayout: jasmine.createSpy().and.returnValue(of({})) };
    ref = { close: jasmine.createSpy('close'), afterClosed: () => closed };
    dialog = { openDialogs: [], open: jasmine.createSpy().and.returnValue(ref) };
    TestBed.configureTestingModule({ imports: [ExperimentalSpfComponent], providers: [provideNoopAnimations(),
      { provide: EfficiencyScreensService, useValue: service }, { provide: SettingsService, useValue: settings },
      { provide: UserService, useValue: { user: identity, getToken: () => identity.value ? 'token' : null } },
      { provide: MatDialog, useValue: dialog },
      { provide: PercentBreakpointService, useValue: { getDashboardColor: () => 'green', getOeDashboardColor: () => 'green' } },
    ] });
    editor = TestBed.inject(LayoutEditService);
    fixture = TestBed.createComponent(ExperimentalSpfComponent); component = fixture.componentInstance;
  });
  afterEach(() => fixture.destroy());

  it('starts with the six original stations and uses the current lane display', fakeAsync(() => {
    fixture.detectChanges(); tick(0); fixture.detectChanges();
    expect(component.visibleStationIds).toEqual(SPF_STATION_IDS);
    expect(service.getLiveEfficiencySummary).toHaveBeenCalledTimes(6);
    expect(fixture.nativeElement.querySelectorAll('app-efficiency-screen-lane').length).toBe(6);
    expect(fixture.nativeElement.querySelector('.layout-toolbar')).toBeNull();
  }));

  it('reorders only in edit mode and preserves order and DOM identity across live updates', fakeAsync(() => {
    fixture.detectChanges(); tick(0); fixture.detectChanges();
    component.moveStation(0, 2); expect(component.visibleStationIds).toEqual(SPF_STATION_IDS);
    const original = fixture.nativeElement.querySelector('section[aria-label="SPF 90001"]');
    editor.toggle(); component.onDrop({ previousIndex: 0, currentIndex: 2 } as any); fixture.detectChanges();
    expect(component.visibleStationIds.slice(0, 3)).toEqual(['90002', '90003', '90001']);
    generation++; tick(6000); fixture.detectChanges();
    expect(component.visibleStationIds.slice(0, 3)).toEqual(['90002', '90003', '90001']);
    expect(fixture.nativeElement.querySelector('section[aria-label="SPF 90001"]')).toBe(original);
    expect(fixture.nativeElement.textContent).toContain('Operator 1');
  }));

  it('offers only the existing stations with 3–6 validation and applies selection and picker order together', fakeAsync(() => {
    fixture.detectChanges(); tick(0); editor.toggle(); component.openLayout();
    const data = dialog.open.calls.mostRecent().args[1].data;
    expect(data.minVisible).toBe(3); expect(data.maxVisible).toBe(6);
    expect(data.cards.map((card: any) => card.id)).toEqual(SPF_STATION_IDS);
    closed.next({ order: ['90003','90001','90002','90004','90005','90006'], visibility: { '90004': false, '90005': false, '90006': false } });
    fixture.detectChanges();
    expect(component.visibleStationIds).toEqual(['90003', '90001', '90002']);
    expect(fixture.nativeElement.querySelectorAll('app-efficiency-screen-lane').length).toBe(3);
    expect(settings.saveExperimentalSpfLayout).not.toHaveBeenCalled();
  }));

  it('discards selection and order changes back to the edit snapshot', fakeAsync(() => {
    fixture.detectChanges(); tick(0); editor.toggle(); component.moveStation(0, 2); editor.toggle();
    closed.next('discard');
    expect(component.layoutEditing).toBeFalse(); expect(component.visibleStationIds).toEqual(SPF_STATION_IDS);
    expect(settings.saveExperimentalSpfLayout).not.toHaveBeenCalled();
  }));

  it('locks only after a successful save; failed saves retain the draft for retry', fakeAsync(() => {
    fixture.detectChanges(); tick(0); editor.toggle(); component.moveStation(0, 1); editor.toggle();
    const save = dialog.open.calls.mostRecent().args[1].data.save;
    settings.saveExperimentalSpfLayout.and.returnValue(throwError(() => new Error('offline')));
    save().subscribe({ error: () => {} });
    expect(component.layoutEditing).toBeTrue(); expect(component.visibleStationIds[0]).toBe('90002');
    const response = new Subject(); settings.saveExperimentalSpfLayout.and.returnValue(response);
    save().subscribe(); expect(component.layoutEditing).toBeTrue();
    expect(settings.saveExperimentalSpfLayout.calls.mostRecent().args[0].stationOrder[0]).toBe('90002');
    response.next({}); response.complete(); expect(component.layoutEditing).toBeFalse();
  }));

  it('loads the current account layout, resets on logout, and applies a different account layout', fakeAsync(() => {
    fixture.detectChanges(); tick(0);
    const layout = normalizeSpfLayout({ stationOrder: [...SPF_STATION_IDS].reverse(), stationVisibility: { '90001': false } });
    preferences.next({ dashboardLayouts: { experimentalSpf: layout } });
    expect(component.visibleStationIds[0]).toBe('90006');
    editor.toggle(); component.openLayout(); identity.next(null); preferences.next(null);
    expect(component.layoutEditing).toBeFalse(); expect(ref.close).toHaveBeenCalled();
    expect(component.visibleStationIds).toEqual(SPF_STATION_IDS);
    editor.toggle(); expect(component.layoutEditing).toBeFalse();
    identity.next({ username: 'bob' }); preferences.next({ dashboardLayouts: { experimentalSpf: normalizeSpfLayout({ stationOrder: ['90004'] }) } });
    expect(component.visibleStationIds[0]).toBe('90004');
  }));

  it('keeps offline stations selected and uses their stable serials', fakeAsync(() => {
    service.getLiveEfficiencySummary.and.returnValue(of({ flipperData: [] })); fixture.detectChanges(); tick(0);
    expect(component.visibleStationIds.length).toBe(6); expect(component.laneMode('90001')).toBe('offline');
    expect(component.lanes['90001'].serial).toBe(90001);
  }));

  it('cancels an in-flight cache read when leaving and does not keep polling', fakeAsync(() => {
    const pending = new Subject(); service.getLiveEfficiencySummary.and.returnValue(pending); fixture.detectChanges(); tick(0);
    expect(pending.observed).toBeTrue(); fixture.destroy(); expect(pending.observed).toBeFalse();
    tick(12000); expect(service.getLiveEfficiencySummary).toHaveBeenCalledTimes(6);
  }));
});

describe('SPF stored-layout normalization', () => {
  it('repairs unknown and duplicate IDs and restores at least three visible stations', () => {
    const result = normalizeSpfLayout({ stationOrder: ['bad', '90004', '90004'], stationVisibility: Object.fromEntries(SPF_STATION_IDS.map(id => [id, false])) });
    expect(result.stationOrder[0]).toBe('90004'); expect(new Set(result.stationOrder).size).toBe(6);
    expect(Object.values(result.stationVisibility).filter(Boolean).length).toBe(3);
  });
});

describe('SPF station selection limits in the shared picker', () => {
  it('disables Apply below three, permits three through six and leaves input unchanged on cancellation', () => {
    const close = jasmine.createSpy(); const visibility = {};
    TestBed.configureTestingModule({ imports: [SummaryCardVisibilityDialogComponent], providers: [provideNoopAnimations(),
      { provide: MatDialogRef, useValue: { close } }, { provide: MAT_DIALOG_DATA, useValue: {
        cards: SPF_STATION_IDS.map(id => ({ id, label: id })), visibility, minVisible: 3, maxVisible: 6,
      } },
    ] });
    const fixture = TestBed.createComponent(SummaryCardVisibilityDialogComponent); const picker = fixture.componentInstance;
    fixture.detectChanges(); const apply = fixture.nativeElement.querySelector('mat-dialog-actions button:last-child');
    for (const count of [6, 5, 4, 3, 2]) {
      fixture.detectChanges(); expect(apply.disabled).toBe(count < 3);
      if (count < 3) { picker.save(); expect(close).not.toHaveBeenCalled(); }
      picker.selectShow(picker.showCards[0]); picker.hideSelected();
    }
    picker.cancel(); expect(visibility).toEqual({}); expect(close).toHaveBeenCalledWith();
    fixture.destroy();
  });
});
