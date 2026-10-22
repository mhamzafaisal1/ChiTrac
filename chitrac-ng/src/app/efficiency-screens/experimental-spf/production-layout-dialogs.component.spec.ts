import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of, Subject, throwError } from 'rxjs';
import { SettingsService } from '../../services/settings.service';
import { CreateProductionLayoutDialogComponent, LoadProductionLayoutDialogComponent } from './production-layout-dialogs.component';
const entry=(scope='user',id='a')=>({scope,id,name:'Line A',stationIds:['100:1','100:2','100:3'],createdAt:'2026-10-22T12:00:00Z'});
const activated:any={layout:entry(),stations:[],preferences:{defaultProductionScreenLayout:{scope:'user',id:'a'},dashboardLayouts:{experimentalSpf:{stationOrder:['100:1','100:2','100:3'],stationVisibility:{}}}}};

describe('Named production layout dialogs',()=>{
 let data:any,settings:any,ref:any,dialog:any,confirmation:any,confirmed:Subject<any>,fixture:any;
 beforeEach(()=>{
  data={stationIds:['100:1','100:2','100:3'],systemAllowed:true,hasUnsavedChanges:false};
  settings={getProductionLayouts:jasmine.createSpy().and.returnValue(of({layouts:[entry('user'),entry('system')],defaultLayout:{scope:'system',id:'a'}})),
   createProductionLayout:jasmine.createSpy().and.returnValue(of(activated)),loadProductionLayout:jasmine.createSpy().and.returnValue(of(activated))};
  confirmed=new Subject();confirmation={afterClosed:()=>confirmed,close:jasmine.createSpy()};
  ref={close:jasmine.createSpy(),disableClose:false};dialog={open:jasmine.createSpy().and.returnValue(confirmation)};
  TestBed.configureTestingModule({imports:[CreateProductionLayoutDialogComponent,LoadProductionLayoutDialogComponent],providers:[provideNoopAnimations(),
   {provide:MAT_DIALOG_DATA,useValue:data},{provide:MatDialogRef,useValue:ref},{provide:MatDialog,useValue:dialog},{provide:SettingsService,useValue:settings}
  ]});
  TestBed.overrideProvider(MatDialog,{useValue:dialog});
 });
 afterEach(()=>fixture?.destroy());
 function create(){fixture=TestBed.createComponent(CreateProductionLayoutDialogComponent);fixture.detectChanges();return fixture.componentInstance;}
 function load(){fixture=TestBed.createComponent(LoadProductionLayoutDialogComponent);fixture.detectChanges();return fixture.componentInstance;}

 it('loads both scopes with distinct keys and preselects the current named default',()=>{
  const component=load();expect(component.layouts.length).toBe(2);expect(component.key(component.layouts[0])).not.toBe(component.key(component.layouts[1]));
  expect(component.selectedKey).toBe('system:a');component.load();expect(settings.loadProductionLayout).toHaveBeenCalledWith({scope:'system',id:'a'});expect(ref.close).toHaveBeenCalledWith(activated);
 });
 it('asks before discarding unsaved changes and cancellation preserves the current layout',()=>{
  data.hasUnsavedChanges=true;const component=load();component.load();expect(dialog.open).toHaveBeenCalled();expect(settings.loadProductionLayout).not.toHaveBeenCalled();
  confirmed.next(false);expect(ref.close).not.toHaveBeenCalled();expect(settings.loadProductionLayout).not.toHaveBeenCalled();
 });
 it('keeps a failed load retryable without repeating an already-confirmed overwrite question',()=>{
  data.hasUnsavedChanges=true;settings.loadProductionLayout.and.returnValues(throwError(()=>({error:{error:'Station unavailable'}})),of(activated));
  const component=load();component.load();confirmed.next(true);fixture.detectChanges();
  expect(component.error).toBe('Station unavailable');expect(ref.close).not.toHaveBeenCalled();expect(ref.disableClose).toBeFalse();
  component.load();expect(dialog.open).toHaveBeenCalledTimes(1);expect(ref.close).toHaveBeenCalledWith(activated);
 });
 it('shows empty and failed library states, prevents loading, and supports list retry',()=>{
  settings.getProductionLayouts.and.returnValues(throwError(()=>new Error('offline')),of({layouts:[],defaultLayout:null}));
  const component=load();expect(component.listError).toContain('Could not load');
  component.loadLibrary();fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('No saved production layouts');
  expect(fixture.nativeElement.querySelector('mat-dialog-actions button:last-child').disabled).toBeTrue();
 });
 it('blocks repeated submissions and cancellation while the default save is pending',()=>{
  const pending=new Subject();settings.loadProductionLayout.and.returnValue(pending);const component=load();component.load();fixture.detectChanges();
  expect(ref.disableClose).toBeTrue();expect(fixture.nativeElement.querySelector('mat-dialog-actions button').disabled).toBeTrue();
  component.load();expect(settings.loadProductionLayout).toHaveBeenCalledTimes(1);pending.next(activated);pending.complete();expect(ref.close).toHaveBeenCalledWith(activated);
 });
 it('cancels a pending library request and closes an owned confirmation when destroyed',()=>{
  const pending=new Subject();settings.getProductionLayouts.and.returnValue(pending);load();expect(pending.observed).toBeTrue();fixture.destroy();expect(pending.observed).toBeFalse();
 });
 it('creates User layouts from the current station order and returns successful activation',()=>{
  const component=create();expect(component.scope).toBe('user');component.name='My line';component.save();
  expect(settings.createProductionLayout).toHaveBeenCalledWith('user','My line',data.stationIds);expect(ref.close).toHaveBeenCalledWith(activated);
 });
 it('supports System selection when permitted and blocks it when the current user lacks permission',()=>{
  const component=create();component.name='Shared';component.scope='system';component.save();expect(settings.createProductionLayout).toHaveBeenCalledWith('system','Shared',data.stationIds);
  settings.createProductionLayout.calls.reset();data.systemAllowed=false;component.save();expect(settings.createProductionLayout).not.toHaveBeenCalled();
 });
 it('rejects blank and oversized names without sending a request',()=>{
  const component=create();for(const name of ['','   ','x'.repeat(81)]){component.name=name;component.save();}expect(settings.createProductionLayout).not.toHaveBeenCalled();
 });
 it('shows duplicate-name errors and preserves the entered name and station selection',()=>{
  settings.createProductionLayout.and.returnValue(throwError(()=>({status:409,error:{error:'A layout with this name already exists. Choose another name.'}})));
  const component=create();component.name='Existing';component.save();fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Choose another name');expect(component.name).toBe('Existing');expect(data.stationIds).toEqual(['100:1','100:2','100:3']);expect(ref.close).not.toHaveBeenCalled();
 });
 it('retries only default activation after a System layout was saved, avoiding a duplicate create',()=>{
  const createdLayoutRef={scope:'system',id:'a'};settings.createProductionLayout.and.returnValue(throwError(()=>({error:{error:'Created but could not set default',createdLayoutRef}})));
  const component=create();component.name='Shared';component.scope='system';component.save();expect(component.createdReference).toEqual(createdLayoutRef);
  component.save();expect(settings.createProductionLayout).toHaveBeenCalledTimes(1);expect(settings.loadProductionLayout).toHaveBeenCalledWith(createdLayoutRef);expect(ref.close).toHaveBeenCalledWith(activated);
 });
 it('cancels a pending create when leaving the dialog',()=>{
  const pending=new Subject();settings.createProductionLayout.and.returnValue(pending);const component=create();component.name='New';component.save();
  expect(pending.observed).toBeTrue();fixture.destroy();expect(pending.observed).toBeFalse();expect(ref.close).not.toHaveBeenCalled();
 });
});
