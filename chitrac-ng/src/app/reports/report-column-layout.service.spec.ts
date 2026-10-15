import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { ReportColumnLayoutService } from './report-column-layout.service';
import { LayoutEditService } from '../services/layout-edit.service';
import { REPORT_COLUMNS } from './report-columns';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { SettingsService } from '../services/settings.service';

describe('Report layout edit lifecycle', () => {
  let layout: ReportColumnLayoutService;
  let edits: LayoutEditService;
  let preferences: BehaviorSubject<any>;
  let save: jasmine.Spy;
  let dialogData: any;
  let closed: Subject<string>;

  beforeEach(() => {
    edits = new LayoutEditService({ getToken: () => 'test-token' } as any);
    preferences = new BehaviorSubject<any>(null);
    save = jasmine.createSpy('save').and.returnValue(of({}));
    closed = new Subject<string>();
    const dialog = { openDialogs: [] as any[], open: (_component: any, options: any) => {
      dialogData = options.data;
      return { afterClosed: () => closed, close: () => closed.next('keep-editing') };
    } };
    layout = new ReportColumnLayoutService(edits, { userPreferences$: preferences, saveReportColumnOrder: save } as any, dialog as any);
    layout.initialize('machineReport', 'Machine Report');
  });
  afterEach(() => layout.ngOnDestroy());

  it('loads saved orders and keeps report preferences independent', () => {
    preferences.next({ reportLayouts: { machineReport: { columnOrder: ['Efficiency', 'Machine'] },
      operatorReport: { columnOrder: ['PPH'] } } });
    expect(layout.columns.slice(0, 2)).toEqual(['Efficiency', 'Machine']);
    expect(layout.columns.length).toBe(6);
  });
  it('only reorders while editing', () => {
    layout.setOrder(['Efficiency']);
    expect(layout.columns[0]).toBe('Machine');
    edits.toggle();
    layout.setOrder(['Efficiency']);
    expect(layout.columns[0]).toBe('Efficiency');
  });
  it('saves current order through the existing lock confirmation', () => {
    edits.toggle(); layout.setOrder(['Efficiency']); edits.toggle();
    dialogData.save().subscribe();
    expect(save).toHaveBeenCalledWith('machineReport', layout.columns);
    expect(layout.editing).toBeFalse();
  });
  it('discards unsaved changes and restores the snapshot', () => {
    edits.toggle(); layout.setOrder(['Efficiency']); edits.toggle(); closed.next('discard');
    expect(layout.columns).toEqual([...REPORT_COLUMNS.machineReport]);
    expect(layout.editing).toBeFalse();
  });
  it('retains edits on failed saves and permits a retry', () => {
    save.and.returnValue(throwError(() => new Error('offline')));
    edits.toggle(); layout.setOrder(['Efficiency']); edits.toggle();
    dialogData.save().subscribe({ error: () => {} });
    expect(layout.editing).toBeTrue();
    expect(layout.columns[0]).toBe('Efficiency');
    save.and.returnValue(of({})); dialogData.save().subscribe();
    expect(layout.editing).toBeFalse();
  });
  it('cleans up the context and preference subscription', () => {
    edits.toggle();
    layout.setOrder(['Efficiency']);
    layout.ngOnDestroy();
    preferences.next({ reportLayouts: { machineReport: { columnOrder: ['Efficiency'] } } });
    expect(layout.columns[0]).toBe('Efficiency');
  });
});

describe('Report preference HTTP persistence', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }));
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('saves only the requested report and publishes the returned preferences', () => {
    const settings = TestBed.inject(SettingsService);
    let effective: any;
    settings.userPreferences$.subscribe(value => effective = value);
    settings.saveReportColumnOrder('itemReport', ['Efficiency', 'Item Name']).subscribe();
    const request = TestBed.inject(HttpTestingController).expectOne('/api/preferences/user');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ reportLayouts: { itemReport: { columnOrder: ['Efficiency', 'Item Name'] } } });
    request.flush({ theme: 'dark', reportLayouts: { itemReport: { columnOrder: ['Efficiency', 'Item Name'] } } });
    expect(effective.reportLayouts.itemReport.columnOrder[0]).toBe('Efficiency');
    expect(effective.theme).toBe('dark');
  });
});
