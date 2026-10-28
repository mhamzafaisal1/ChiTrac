import { CommonModule } from '@angular/common';
import { Component, DestroyRef, Inject, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { finalize } from 'rxjs';
import { SettingsService } from '../../services/settings.service';
import { NamedProductionLayout, ProductionLayoutActivation, ProductionLayoutReference, ProductionLayoutScope } from '../../services/production-layout.models';

const dialogStyles = `
  mat-form-field { display: block; width: 100%; margin-top: 8px; }
  mat-dialog-content { color: var(--theme-color-text); }
  .scope-label { display: block; margin: 4px 0 8px; }
  .status { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
  .error { color: var(--sg-color-red); white-space: normal; }
  mat-dialog-actions { gap: 8px; flex-wrap: wrap; }
  mat-button-toggle-group { margin-bottom: 12px; }
`;
function errorMessage(error: any, fallback: string): string {
  return typeof error?.error?.error === 'string' ? error.error.error : fallback;
}

@Component({standalone:true,imports:[MatDialogModule,MatButtonModule],template:`
  <h2 mat-dialog-title>Replace unsaved changes?</h2>
  <mat-dialog-content>Loading this layout will replace your unsaved station selection and order.</mat-dialog-content>
  <mat-dialog-actions align="end"><button mat-button [mat-dialog-close]="false">Cancel</button><button mat-flat-button [mat-dialog-close]="true">Load Layout</button></mat-dialog-actions>
`,styles:[dialogStyles]})
export class ReplaceProductionLayoutDialogComponent {}

@Component({selector:'app-load-production-layout',standalone:true,
 imports:[CommonModule,FormsModule,MatDialogModule,MatButtonModule,MatFormFieldModule,MatSelectModule,MatProgressSpinnerModule],
 template:`
  <h2 mat-dialog-title>Load Layout</h2>
  <mat-dialog-content [attr.aria-busy]="loading || saving">
    <div class="status" *ngIf="loading" role="status"><mat-spinner diameter="24" aria-label="Loading layouts"></mat-spinner>Loading layouts…</div>
    <div *ngIf="listError" role="alert" class="error"><p>{{ listError }}</p><button mat-stroked-button type="button" (click)="loadLibrary()">Retry</button></div>
    <p *ngIf="!loading && !listError && !layouts.length">No saved production layouts yet. Create a layout first.</p>
    <mat-form-field appearance="outline" *ngIf="layouts.length">
      <mat-label>Production layout</mat-label>
      <mat-select [(ngModel)]="selectedKey" [disabled]="saving || loading" aria-label="Production layout">
        <mat-option *ngFor="let layout of layouts" [value]="key(layout)">{{ layout.name }} — {{ layout.scope === 'system' ? 'System' : 'User' }}</mat-option>
      </mat-select>
    </mat-form-field>
    <p>Loading a layout makes it your current default.</p>
    <p *ngIf="error" role="alert" class="error">{{ error }}</p>
    <div class="status" *ngIf="saving" role="status"><mat-spinner diameter="24" aria-label="Saving default layout"></mat-spinner>Loading layout…</div>
  </mat-dialog-content>
  <mat-dialog-actions align="end"><button mat-button type="button" [disabled]="saving" (click)="ref.close()">Cancel</button>
    <button mat-flat-button type="button" [disabled]="loading || saving || !selectedKey || !!listError" (click)="load()">Load Layout</button></mat-dialog-actions>
 `,styles:[dialogStyles]})
export class LoadProductionLayoutDialogComponent implements OnInit, OnDestroy {
  layouts: NamedProductionLayout[]=[];
  selectedKey=''; loading=false; saving=false; listError=''; error='';
  private overwriteConfirmed=false;
  private confirmation?: MatDialogRef<ReplaceProductionLayoutDialogComponent>;
  private readonly destroyRef=inject(DestroyRef);
  constructor(private settings:SettingsService, private dialog:MatDialog,
    public ref:MatDialogRef<LoadProductionLayoutDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data:{hasUnsavedChanges:boolean}){}
  ngOnInit():void{this.loadLibrary();}
  key(layout:ProductionLayoutReference):string{return layout.scope+':'+layout.id;}
  loadLibrary():void{
    if(this.loading || this.saving)return;
    this.loading=true;this.listError='';
    this.settings.getProductionLayouts().pipe(takeUntilDestroyed(this.destroyRef),finalize(()=>this.loading=false)).subscribe({
      next:library=>{
        this.layouts=library.layouts;
        this.selectedKey=library.defaultLayout && this.layouts.some(layout=>this.key(layout)===this.key(library.defaultLayout!))?this.key(library.defaultLayout):'';
      },error:error=>this.listError=errorMessage(error,'Could not load layouts. Please try again.'),
    });
  }
  load():void{
    if(this.loading || this.saving || this.confirmation)return;
    const layout=this.layouts.find(layout=>this.key(layout)===this.selectedKey);
    if(!layout)return;
    if(this.data.hasUnsavedChanges && !this.overwriteConfirmed){
      const confirmation=this.dialog.open(ReplaceProductionLayoutDialogComponent,{width:'460px',maxWidth:'94vw',autoFocus:false});
      this.confirmation=confirmation;
      confirmation.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(confirmed=>{
        this.confirmation=undefined;
        if(confirmed){this.overwriteConfirmed=true;this.activate(layout);}
      });
    }else this.activate(layout);
  }
  private activate(layout:ProductionLayoutReference):void{
    this.saving=true;this.error='';this.ref.disableClose=true;
    this.settings.loadProductionLayout({scope:layout.scope,id:layout.id}).pipe(takeUntilDestroyed(this.destroyRef),finalize(()=>{this.saving=false;this.ref.disableClose=false;})).subscribe({
      next:result=>this.ref.close(result),error:error=>this.error=errorMessage(error,'Could not load this layout. Your current layout is unchanged. Please try again.'),
    });
  }
  ngOnDestroy():void{this.confirmation?.close();}
}

@Component({selector:'app-create-production-layout',standalone:true,
 imports:[CommonModule,FormsModule,MatDialogModule,MatButtonModule,MatButtonToggleModule,MatFormFieldModule,MatInputModule,MatProgressSpinnerModule],
 template:`
  <h2 mat-dialog-title>Create Layout</h2>
  <form (ngSubmit)="save()">
    <mat-dialog-content [attr.aria-busy]="saving">
      <mat-form-field appearance="outline"><mat-label>Layout name</mat-label>
        <input matInput name="layoutName" [(ngModel)]="name" required maxlength="80" [disabled]="saving || !!createdReference" autocomplete="off" />
      </mat-form-field>
      <span class="scope-label" id="production-layout-scope">Save layout for</span>
      <mat-button-toggle-group name="layoutScope" [(ngModel)]="scope" aria-labelledby="production-layout-scope" [disabled]="saving || !!createdReference">
        <mat-button-toggle value="user">User</mat-button-toggle><mat-button-toggle value="system" [disabled]="!data.systemAllowed">System</mat-button-toggle>
      </mat-button-toggle-group>
      <p>{{ scope === 'system' ? 'Available to everyone. Creating it only changes your own default.' : 'Available only to your user account.' }}</p>
      <p *ngIf="!createdReference">The current station selection and order will be saved and made your default.</p>
      <p *ngIf="error" role="alert" class="error">{{ error }}</p>
      <div class="status" *ngIf="saving" role="status"><mat-spinner diameter="24" aria-label="Saving layout"></mat-spinner>Saving layout…</div>
    </mat-dialog-content>
    <mat-dialog-actions align="end"><button mat-button type="button" [disabled]="saving" (click)="ref.close()">Cancel</button>
      <button mat-flat-button type="submit" [disabled]="saving || (!createdReference && (!name.trim() || name.length > 80))">{{ createdReference ? 'Retry' : 'Create Layout' }}</button></mat-dialog-actions>
  </form>
 `,styles:[dialogStyles]})
export class CreateProductionLayoutDialogComponent {
  name='';scope:ProductionLayoutScope='user';saving=false;error='';createdReference?:ProductionLayoutReference;
  private readonly destroyRef=inject(DestroyRef);
  constructor(private settings:SettingsService,public ref:MatDialogRef<CreateProductionLayoutDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data:{stationIds:string[];systemAllowed:boolean}){}
  save():void{
    if(this.saving || (!this.createdReference && (!this.name.trim() || this.name.length>80 || (this.scope==='system' && !this.data.systemAllowed))))return;
    this.saving=true;this.error='';this.ref.disableClose=true;
    const request=this.createdReference?this.settings.loadProductionLayout(this.createdReference):this.settings.createProductionLayout(this.scope,this.name,this.data.stationIds);
    request.pipe(takeUntilDestroyed(this.destroyRef),finalize(()=>{this.saving=false;this.ref.disableClose=false;})).subscribe({
      next:(result:ProductionLayoutActivation)=>this.ref.close(result),error:error=>{
        this.createdReference=error?.error?.createdLayoutRef || this.createdReference;
        this.error=errorMessage(error,'Could not create the layout. Your changes are still available. Please try again.');
      }
    });
  }
}
