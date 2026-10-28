import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ProductionScreenLayoutsService } from '../../services/production-screen-layouts.service';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { ExperimentalSpfComponent } from './experimental-spf.component';
import { SPF_STATION_SERIALS, configuredProductionStations, normalizeSpfLayout } from './spf-stations';
import { EfficiencyScreensService } from '../../services/efficiency-screens.service';
import { ConfigurationService } from '../../configuration.service';
import { SettingsService } from '../../services/settings.service';
import { UserService } from '../../user.service';
import { LayoutEditService } from '../../services/layout-edit.service';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';
import { SummaryCardVisibilityDialogComponent } from '../../components/summary-card-visibility-dialog/summary-card-visibility-dialog.component';
import { EfficiencyScreenLaneComponent } from '../efficiency-screen-lane/efficiency-screen-lane.component';
const machines = () => [
  ...SPF_STATION_SERIALS.map(id => ({ id, name: 'SPF ' + id, active: true, stations: [1] })),
  { id: 80000, name: 'Large Piece Line', active: true, stations: [1,2,4] },
  { id: 70000, name: 'Inactive', active: false, stations: [1,2] },
] as any[];
const originalIds = SPF_STATION_SERIALS.map(id => id + ':1');

describe('Configured production station layouts', () => {
  let fixture: any, component: ExperimentalSpfComponent, editor: LayoutEditService;
  let preferences: BehaviorSubject<any>, identity: BehaviorSubject<any>, closed: Subject<any>;
  let catalog: BehaviorSubject<any[]>;
  let routeParams: BehaviorSubject<any>, layouts: any;
  let service: any, config: any, settings: any, dialog: any, ref: any, generation: number;
  beforeEach(() => {
    preferences = new BehaviorSubject(null); identity = new BehaviorSubject({ username: 'alice' }); closed = new Subject(); generation = 0;
    service = { getProductionStationSummaries: jasmine.createSpy().and.callFake((stations: any[]) => of(Object.fromEntries(stations.map(s => [s.id, { serial: s.machineId, station: s.station, machine: s.label, status: 1, operator: 'Operator ' + generation, efficiency: {}, batch: {} }]))) ) };
    catalog = new BehaviorSubject(machines());
    routeParams = new BehaviorSubject(convertToParamMap({}));
    layouts = {read: jasmine.createSpy('readLayout').and.returnValue(of({stationLayout: {stationOrder: ['80000:4','80000:1','80000:2'], stationVisibility:{}}}))};
    config = { watchMachineConfigs: jasmine.createSpy().and.returnValue(catalog) };
    settings = { settings$: of(null), userPreferences$: preferences, saveExperimentalSpfLayout: jasmine.createSpy().and.returnValue(of({})) };
    ref = { close: jasmine.createSpy('close'), afterClosed: () => closed }; dialog = { openDialogs: [], open: jasmine.createSpy().and.returnValue(ref) };
    TestBed.configureTestingModule({ imports: [ExperimentalSpfComponent], providers: [provideNoopAnimations(), provideRouter([]),
      {provide: ActivatedRoute, useValue: {queryParamMap: routeParams}},
      {provide: ProductionScreenLayoutsService, useValue: layouts},
      { provide: EfficiencyScreensService, useValue: service }, { provide: ConfigurationService, useValue: config },
      { provide: SettingsService, useValue: settings }, { provide: UserService, useValue: { user: identity, getToken: () => identity.value ? 'token' : null, hasPermissionLevel: () => !!identity.value } },
      { provide: MatDialog, useValue: dialog }, { provide: PercentBreakpointService, useValue: { getDashboardColor: () => 'green', getOeDashboardColor: () => 'green' } },
    ] });
    editor = TestBed.inject(LayoutEditService); fixture = TestBed.createComponent(ExperimentalSpfComponent); component = fixture.componentInstance;
  });
  afterEach(() => fixture.destroy());
  function load() { fixture.detectChanges(); tick(0); fixture.detectChanges(); }

  it('offers every configured station of active machines while retaining the original six defaults', fakeAsync(() => {
    load(); expect(component.stations.length).toBe(9); expect(component.visibleStationIds).toEqual(originalIds);
    expect(component.stations.some(s => s.machineId === 70000)).toBeFalse();
    editor.toggle(); component.openLayout(); const data = dialog.open.calls.mostRecent().args[1].data;
    expect(data.minVisible).toBe(3); expect(data.maxVisible).toBe(8); expect(data.cards.length).toBe(9);
    expect(data.allowTemporaryOverLimit).toBeTrue();
    expect(data.sortHiddenByLabel).toBeTrue();
    expect(data.cards.find((card: any) => card.id === '80000:4').label).toContain('Station 4');
    expect(config.watchMachineConfigs).toHaveBeenCalledTimes(1);
  }));

  it('renders eight selected lanes and allows creating a layout with all eight', fakeAsync(() => {
    load(); editor.toggle(); component.openLayout();
    const ids = component.stations.slice(0, 8).map(station => station.id);
    closed.next({ order: ids, visibility: {} }); tick(0); fixture.detectChanges();
    expect(component.visibleStationIds).toEqual(ids);
    expect(fixture.nativeElement.querySelectorAll('section.lane-container').length).toBe(8);
    component.openCreateLayout();
    expect(dialog.open.calls.mostRecent().args[1].data.stationIds).toEqual(ids);
  }));

  it('selects and reorders different stations on the same machine without refresh resetting the layout or DOM', fakeAsync(() => {
    load(); editor.toggle(); component.openLayout();
    closed.next({ order: ['80000:4','80000:1','80000:2'], visibility: {} }); tick(0); fixture.detectChanges();
    expect(component.visibleStationIds).toEqual(['80000:4','80000:1','80000:2']);
    const original = fixture.nativeElement.querySelector('section[aria-label="Large Piece Line — Station 4"]');
    component.onDrop({ previousIndex: 0, currentIndex: 2 } as any); generation++; tick(6000); fixture.detectChanges();
    expect(component.visibleStationIds).toEqual(['80000:1','80000:2','80000:4']);
    expect(fixture.nativeElement.querySelector('section[aria-label="Large Piece Line — Station 4"]')).toBe(original);
    expect(fixture.nativeElement.textContent).toContain('Operator 1');
    expect(settings.saveExperimentalSpfLayout).not.toHaveBeenCalled();
  }));

  it('ignores reorder requests outside edit mode and discards changes back to the edit snapshot', fakeAsync(() => {
    load(); component.moveStation(0, 1); expect(component.visibleStationIds).toEqual(originalIds);
    editor.toggle(); component.moveStation(0, 2); editor.toggle(); closed.next('discard');
    expect(component.layoutEditing).toBeFalse(); expect(component.visibleStationIds).toEqual(originalIds);
  }));

  it('migrates stored serial-only SPF preferences to the corresponding configured station', fakeAsync(() => {
    preferences.next({ dashboardLayouts: { experimentalSpf: { stationOrder: ['90003','90001','90002','90004','90005','90006'], stationVisibility: {'90004':false,'90005':false,'90006':false} } } });
    load(); expect(component.visibleStationIds).toEqual(['90003:1','90001:1','90002:1']);
    expect(component.layout.stationVisibility['80000:1']).toBeFalse();
  }));

  it('updates station availability from sync without automatically showing new stations or fetching on picker open', fakeAsync(() => {
    load(); catalog.next([...machines(), { id: 555, name: 'Added machine', active: true, stations: [3,5] }]);
    editor.toggle(); component.openLayout(); expect(component.stations.length).toBe(11);
    expect(component.visibleStationIds).toEqual(originalIds); expect(component.layout.stationVisibility['555:5']).toBeFalse();
  }));

  it('applies account preferences received during a catalog refresh against the new catalog', fakeAsync(() => {
    load();
    preferences.next({dashboardLayouts:{experimentalSpf:{stationOrder:['555:1','555:2','555:3'],stationVisibility:{}}}});
    catalog.next([...machines(),{id:555,name:'New line',active:true,stations:[1,2,3]}]);tick(0);
    expect(component.visibleStationIds).toEqual(['555:1','555:2','555:3']);
  }));

  it('shows a retryable configuration error and recovers without a blank screen', fakeAsync(() => {
    config.watchMachineConfigs.and.returnValue(throwError(() => new Error('offline'))); load();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Could not load');
    config.watchMachineConfigs.and.returnValue(of(machines())); fixture.nativeElement.querySelector('.catalog-message button').click(); tick(0); fixture.detectChanges();
    expect(component.visibleStationIds.length).toBe(6); expect(component.catalogError).toBe('');
  }));

  it('does not invent stations or permit saving when fewer than three are configured', fakeAsync(() => {
    config.watchMachineConfigs.and.returnValue(of([{ id: 42, name: 'One machine', active: true, stations: [1,2] }])); load();
    expect(component.visibleStationIds).toEqual(['42:1','42:2']);
    editor.toggle(); component.moveStation(0,1); editor.toggle();
    const save = dialog.open.calls.mostRecent().args[1].data.save; let failed = false;
    save().subscribe({error: () => failed=true}); expect(failed).toBeTrue(); expect(settings.saveExperimentalSpfLayout).not.toHaveBeenCalled();
  }));

  it('retains the draft after failed save and locks only after successful retry', fakeAsync(() => {
    load(); editor.toggle(); component.moveStation(0,1); editor.toggle(); const save = dialog.open.calls.mostRecent().args[1].data.save;
    settings.saveExperimentalSpfLayout.and.returnValue(throwError(() => new Error('offline'))); save().subscribe({error: () => {}});
    expect(component.layoutEditing).toBeTrue(); expect(component.visibleStationIds[0]).toBe('90002:1');
    const response = new Subject(); settings.saveExperimentalSpfLayout.and.returnValue(response); save().subscribe();
    expect(component.layoutEditing).toBeTrue(); response.next({}); response.complete(); expect(component.layoutEditing).toBeFalse();
  }));

  it('keeps layouts isolated on account changes and blocks anonymous editing', fakeAsync(() => {
    load(); preferences.next({dashboardLayouts:{experimentalSpf:{stationOrder:['80000:1','80000:2','80000:4'],stationVisibility:{}}}}); tick(0);
    expect(component.visibleStationIds[0]).toBe('80000:1'); editor.toggle(); component.openLayout();
    identity.next(null); preferences.next(null); expect(ref.close).toHaveBeenCalled(); expect(component.layoutEditing).toBeFalse();
    expect(component.visibleStationIds).toEqual(originalIds); editor.toggle(); expect(component.layoutEditing).toBeFalse();
    identity.next({username:'bob'}); preferences.next({dashboardLayouts:{experimentalSpf:{stationOrder:['80000:4','90001:1','90002:1'],stationVisibility:{}}}});
    expect(component.visibleStationIds).toEqual(['80000:4','90001:1','90002:1']);
  }));

  it('opens named load with true unsaved-change detection and leaves cancellation untouched', fakeAsync(()=>{
    load();editor.toggle();expect(component.hasUnsavedChanges()).toBeFalse();component.moveStation(0,1);component.openLoadLayout();
    expect(dialog.open.calls.mostRecent().args[1].data.hasUnsavedChanges).toBeTrue();closed.next(undefined);
    expect(component.visibleStationIds[0]).toBe('90002:1');expect(component.layoutEditing).toBeTrue();
    component.moveStation(0,1);expect(component.hasUnsavedChanges()).toBeFalse();
  }));
  it('creates a named snapshot from visible stations and applies the fresh catalog returned by activation',fakeAsync(()=>{
    load();editor.toggle();component.openCreateLayout();const data=dialog.open.calls.mostRecent().args[1].data;
    expect(data.stationIds).toEqual(originalIds);expect(data.systemAllowed).toBeTrue();
    const stations=configuredProductionStations([{id:555,name:'New machine',active:true,stations:[1,2,3]}]as any);
    closed.next({layout:{scope:'system',id:'a'},stations,preferences:{defaultProductionScreenLayout:{scope:'system',id:'a'},dashboardLayouts:{experimentalSpf:{stationOrder:['555:3','555:1','555:2'],stationVisibility:{}}}}});tick(0);
    expect(component.layoutEditing).toBeFalse();expect(component.visibleStationIds).toEqual(['555:3','555:1','555:2']);expect(component.hasUnsavedChanges()).toBeFalse();
  }));

  it('cancels in-flight cache reads and configuration loads when leaving', fakeAsync(() => {
    const pending = new Subject(); service.getProductionStationSummaries.and.returnValue(pending); load();
    expect(pending.observed).toBeTrue(); expect(catalog.observed).toBeTrue(); fixture.destroy();
    expect(pending.observed).toBeFalse(); expect(catalog.observed).toBeFalse(); tick(12000);
    expect(service.getProductionStationSummaries).toHaveBeenCalledTimes(1);
  }));
  it('opens named links without saving defaults and preserves the selected layout across preference updates', fakeAsync(() => {
    routeParams.next(convertToParamMap({layoutScope:'system',layoutId:'a'.repeat(64)}));
    load();
    expect(component.visibleStationIds).toEqual(['80000:4','80000:1','80000:2']);
    expect(layouts.read).toHaveBeenCalledWith({scope:'system',id:'a'.repeat(64)});
    preferences.next({dashboardLayouts:{experimentalSpf:{stationOrder:['90003:1','90002:1','90001:1'],stationVisibility:{}}}});
    expect(component.visibleStationIds).toEqual(['80000:4','80000:1','80000:2']);
    expect(settings.saveExperimentalSpfLayout).not.toHaveBeenCalled();
    routeParams.next(convertToParamMap({})); tick(0);
    expect(component.visibleStationIds).toEqual(['90003:1','90002:1','90001:1']);
  }));

  it('handles query-only navigation and cancels an obsolete layout request before returning to the default', fakeAsync(() => {
    const pending = new Subject(); layouts.read.and.returnValue(pending);
    routeParams.next(convertToParamMap({layoutScope:'system',layoutId:'a'.repeat(64)})); load();
    expect(component.layoutResolving).toBeTrue(); expect(component.visibleStationIds).toEqual([]);
    routeParams.next(convertToParamMap({})); tick(0);
    expect(pending.observed).toBeFalse(); expect(component.visibleStationIds).toEqual(originalIds);
    layouts.read.and.returnValue(of({stationLayout:{stationOrder:['80000:2','80000:4','80000:1'],stationVisibility:{}}}));
    routeParams.next(convertToParamMap({layoutScope:'user',layoutId:'b'.repeat(64)})); tick(0);
    expect(component.visibleStationIds).toEqual(['80000:2','80000:4','80000:1']);
  }));

  it('shows invalid, unavailable and failed named links without silently displaying a different layout', fakeAsync(() => {
    routeParams.next(convertToParamMap({layoutScope:'system'})); load();
    expect(component.layoutError).toContain('invalid'); expect(layouts.read).not.toHaveBeenCalled();
    layouts.read.and.returnValue(throwError(()=>({error:{error:'This layout is no longer available.'}})));
    routeParams.next(convertToParamMap({layoutScope:'system',layoutId:'a'.repeat(64)})); tick(0); fixture.detectChanges();
    expect(component.visibleStationIds).toEqual([]); expect(component.layoutError).toContain('no longer available');
    expect(fixture.nativeElement.textContent).toContain('Open default production screen');
    layouts.read.and.returnValue(of({stationLayout:{stationOrder:['80000:1','80000:2','80000:4'],stationVisibility:{}}}));
    component.retrySelectedLayout(); tick(0); expect(component.visibleStationIds.length).toBe(3);
    catalog.next(machines().filter(machine=>machine.id !== 80000));
    expect(component.visibleStationIds).toEqual([]); expect(component.layoutError).toContain('unavailable stations');
  }));

  it('revalidates private links on logout and cancels pending requests when destroyed', fakeAsync(() => {
    routeParams.next(convertToParamMap({layoutScope:'user',layoutId:'a'.repeat(64)})); load();
    expect(component.visibleStationIds.length).toBe(3);
    layouts.read.and.returnValue(throwError(()=>({error:{error:'Log in to view your saved production layouts.'}})));
    identity.next(null); tick(0);
    expect(component.visibleStationIds).toEqual([]); expect(component.layoutError).toContain('Log in');
    const pending = new Subject(); layouts.read.and.returnValue(pending);
    identity.next({username:'bob'}); expect(pending.observed).toBeTrue();
    fixture.destroy(); expect(pending.observed).toBeFalse();
  }));

});

describe('Production station catalog and layout repair', () => {
  it('deduplicates configured stations and rejects invalid or inactive entries', () => {
    const catalog = configuredProductionStations([{id:10,active:true,name:'A',stations:[1,1,2,NaN]}, {id:11,active:false,stations:[1]}, {id:12,active:true,stations:[]}] as any);
    expect(catalog.map(s=>s.id)).toEqual(['10:1','10:2']);
  });
  it('preserves station order, hides catalog additions, drops unavailable selections and enforces 3–8', () => {
    const catalog = configuredProductionStations(machines());
    let result = normalizeSpfLayout({stationOrder:['unknown','80000:4','80000:4'],stationVisibility:{}},catalog);
    expect(result.stationOrder[0]).toBe('80000:4'); expect(Object.values(result.stationVisibility).filter(Boolean).length).toBe(3);
    result=normalizeSpfLayout({stationOrder:catalog.map(s=>s.id),stationVisibility:{}},catalog);
    expect(Object.values(result.stationVisibility).filter(Boolean).length).toBe(8);
  });
});

describe('Station selection count limits', () => {
  it('allows temporary selections outside 3–8 but only applies valid selections', () => {
    const close=jasmine.createSpy(); const ids=['a','b','c','d','e','f','g','h','i'];
    TestBed.configureTestingModule({imports:[SummaryCardVisibilityDialogComponent],providers:[provideNoopAnimations(),
      {provide:MatDialogRef,useValue:{close}}, {provide:MAT_DIALOG_DATA,useValue:{cards:ids.map(id=>({id,label:id})),visibility:{i:false},minVisible:3,maxVisible:8,allowTemporaryOverLimit:true,dragDropEnabled:true}},
    ]});
    const fixture=TestBed.createComponent(SummaryCardVisibilityDialogComponent); const picker=fixture.componentInstance; fixture.detectChanges();
    picker.selectHide(picker.hideCards[0]); picker.showSelected(); expect(picker.showCards.length).toBe(9);
    fixture.detectChanges(); expect(picker.canApply).toBeFalse(); picker.save(); expect(close).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('mat-dialog-actions button:last-child').disabled).toBeTrue();
    picker.selectShow(picker.showCards[0]); picker.hideSelected(); expect(picker.showCards.length).toBe(8);
    for(let i=0;i<6;i++){picker.selectShow(picker.showCards[0]);picker.hideSelected();}
    fixture.detectChanges(); expect(picker.canApply).toBeFalse(); picker.save(); expect(close).not.toHaveBeenCalled();
    picker.selectHide(picker.hideCards[0]);picker.showSelected();fixture.detectChanges();expect(picker.canApply).toBeTrue();
    expect(fixture.nativeElement.querySelector('mat-dialog-actions button:last-child').disabled).toBeFalse();
    picker.save(); expect(close.calls.mostRecent().args[0].order.length).toBe(9); fixture.destroy();
  });

});


describe('Production operator name wrapping', () => {
  it('uses two readable lines in narrow running, paused and fault lanes without clipping the header', () => {
    TestBed.configureTestingModule({ imports: [EfficiencyScreenLaneComponent], providers: [
      { provide: PercentBreakpointService, useValue: { getDashboardColor: () => 'green' } },
    ] });
    const fixture = TestBed.createComponent(EfficiencyScreenLaneComponent);
    const host = fixture.nativeElement as HTMLElement;
    host.style.height = '600px';
    try {
      for (const width of [220, 240]) {
        host.style.width = `${width}px`;
        for (const mode of ['operator', 'offline', 'fault']) {
          fixture.componentRef.setInput('mode', mode);
          fixture.componentRef.setInput('lane', { operator: 'ALEXANDRA GRETCHEN BLEILER', fault: 'System_Paused' });
          fixture.detectChanges();
          const content = host.querySelector('.operator-content') as HTMLElement;
          const block = host.querySelector('.operator-block') as HTMLElement;
          const lineHeight = parseFloat(getComputedStyle(content).lineHeight);
          expect(content.clientHeight).withContext(`${width}px ${mode}`).toBeGreaterThan(lineHeight * 1.5);
          expect(content.clientHeight).toBeLessThanOrEqual(lineHeight * 2 + 1);
          expect(content.getBoundingClientRect().bottom).toBeLessThanOrEqual(block.getBoundingClientRect().bottom + 1);
          expect(content.title).toBe('ALEXANDRA GRETCHEN BLEILER');
        }
      }
    } finally { fixture.destroy(); }
  });
});
