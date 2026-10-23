import { CreateProductionLayoutDialogComponent, LoadProductionLayoutDialogComponent } from './production-layout-dialogs.component';
import { ProductionLayoutActivation } from '../../services/production-layout.models';
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Subject, Subscription, distinctUntilChanged, exhaustMap, finalize, map, takeUntil, tap, timer, throwError } from 'rxjs';
import { ConfigurationService } from '../../configuration.service';
import { EfficiencyScreensService } from '../../services/efficiency-screens.service';
import { LayoutEditService } from '../../services/layout-edit.service';
import { SettingsService } from '../../services/settings.service';
import { UserService } from '../../user.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { openLayoutSaveConfirmDialog } from '../../components/layout-save-confirm/layout-save-confirm.component';
import { SummaryCardVisibilityDialogComponent, SummaryCardVisibilityDialogResult } from '../../components/summary-card-visibility-dialog/summary-card-visibility-dialog.component';
import { EfficiencyScreenLaneComponent, EfficiencyScreenLaneMode } from '../efficiency-screen-lane/efficiency-screen-lane.component';
import { configuredProductionStations, normalizeSpfLayout, ProductionStation, SpfLayout } from './spf-stations';

@Component({
  selector: 'app-experimental-spf',
  standalone: true,
  imports: [CommonModule, DragDropModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, EfficiencyScreenLaneComponent],
  templateUrl: './experimental-spf.component.html',
  styleUrl: './experimental-spf.component.scss',
})
export class ExperimentalSpfComponent implements OnInit, OnDestroy {
  readonly layoutContextId = 'experimentalSpf';
  stations: ProductionStation[] = [];
  layout = normalizeSpfLayout(null, []);
  catalogLoading = false;
  catalogError = '';
  private hasCatalog = false;
  private savedLayout: SpfLayout | null = null;
  private catalogRequest?: Subscription;
  private polling?: Subscription;
  layoutEditing = false;
  isLoading = true;
  lanes: Record<string, any> = {};
  private snapshot: SpfLayout | null = null;
  private readonly destroyed$ = new Subject<void>();
  private picker?: MatDialogRef<SummaryCardVisibilityDialogComponent>;
  private saveDialog?: MatDialogRef<any>;
  private namedDialog?: MatDialogRef<any>;

  constructor(
    private readonly efficiency: EfficiencyScreensService,
    private readonly configuration: ConfigurationService,
    private readonly settings: SettingsService,
    private readonly user: UserService,
    private readonly editor: LayoutEditService,
    private readonly dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    this.editor.register(this.layoutContextId, 'Experimental SPF');
    this.editor.context$.pipe(takeUntil(this.destroyed$)).subscribe(context => {
      const editing = context?.id === this.layoutContextId && context.editing;
      if (editing && !this.layoutEditing) this.snapshot = this.copyLayout();
      this.layoutEditing = !!editing;
    });
    this.editor.lockRequested$.pipe(takeUntil(this.destroyed$)).subscribe(() => {
      if (this.layoutEditing) this.confirmSave();
    });
    this.user.user.pipe(map(user => user?.username || null), distinctUntilChanged(), takeUntil(this.destroyed$)).subscribe(() => {
      this.picker?.close();
      this.saveDialog?.close();
      this.namedDialog?.close();
      this.editor.setEditing(false);
      this.snapshot = null;
      this.savedLayout = null;
      this.layout = normalizeSpfLayout(null, this.stations);
      if (this.hasCatalog) this.startPolling();
    });
    this.settings.userPreferences$.pipe(takeUntil(this.destroyed$)).subscribe(preferences => {
      this.savedLayout = preferences?.dashboardLayouts?.experimentalSpf || null;
      if (!this.layoutEditing) {
        this.layout = normalizeSpfLayout(this.savedLayout, this.stations);
        if (this.hasCatalog) this.startPolling();
      }
    });
    this.loadStations();
  }

  loadStations(openPicker = false): void {
    if (this.catalogLoading) return;
    this.catalogLoading = true;
    this.catalogError = '';
    this.catalogRequest = this.configuration.getMachineConfigs().pipe(
      finalize(() => this.catalogLoading = false), takeUntil(this.destroyed$),
    ).subscribe({
      next: machines => {
        this.stations = configuredProductionStations(machines);
        this.layout = normalizeSpfLayout(this.hasCatalog && this.layoutEditing ? this.layout : this.savedLayout, this.stations);
        if (this.snapshot) this.snapshot = normalizeSpfLayout(this.snapshot, this.stations);
        this.hasCatalog = true;
        this.startPolling();
        if (openPicker && this.layoutEditing) this.showPicker();
      },
      error: () => {
        this.isLoading = false;
        this.catalogError = 'Could not load configured stations. Please try again.';
      },
    });
  }

  private startPolling(): void {
    this.polling?.unsubscribe();
    const selected = this.stations.filter(station => this.visibleStationIds.includes(station.id));
    this.isLoading = selected.length > 0 && selected.some(station => !this.lanes[station.id]);
    if (!selected.length) { this.lanes = {}; return; }
    this.polling = timer(0, 6000).pipe(
      exhaustMap(() => this.efficiency.getProductionStationSummaries(selected)),
      takeUntil(this.destroyed$),
    ).subscribe(lanes => { this.lanes = lanes; this.isLoading = false; });
  }

  get visibleStationIds(): string[] {
    return this.layout.stationOrder.filter(id => this.layout.stationVisibility[id]);
  }

  stationLabel(id: string): string { return this.stations.find(station => station.id === id)?.label || id; }
  trackStation(_index: number, id: string): string { return id; }
  laneMode(id: string): EfficiencyScreenLaneMode {
    const status = this.lanes[id]?.status;
    return status === 1 ? 'operator' : status > 1 ? 'fault' : 'offline';
  }

  onDrop(event: CdkDragDrop<string[]>): void { this.moveStation(event.previousIndex, event.currentIndex); }

  moveStation(from: number, to: number): void {
    const visible = this.visibleStationIds;
    if (!this.layoutEditing || from === to || from < 0 || to < 0 || from >= visible.length || to >= visible.length) return;
    moveItemInArray(visible, from, to);
    let index = 0;
    this.layout = { ...this.layout, stationOrder: this.layout.stationOrder.map(id => this.layout.stationVisibility[id] ? visible[index++] : id) };
    this.editor.markEditsMade();
  }

  openLayout(): void {
    if (!this.layoutEditing || this.picker || this.catalogLoading) return;
    this.loadStations(true);
  }

  private showPicker(): void {
    const ref = this.dialog.open(SummaryCardVisibilityDialogComponent, {
      width: '800px', maxWidth: '94vw', autoFocus: false,
      data: {
        title: 'Edit SPF Layout', description: 'Choose 3–6 stations. Drag stations to change their order.',
        showLabel: 'Shown', hideLabel: 'Hidden', emptyShownText: 'No stations shown', emptyHiddenText: 'No stations hidden',
        compactCards: true, minVisible: 3, maxVisible: 6, allowTemporaryOverLimit: true, dragDropEnabled: true,
        cards: this.layout.stationOrder.map(id => ({ id, label: this.stationLabel(id), icon: 'local_laundry_service' })),
        visibility: { ...this.layout.stationVisibility },
      },
    });
    this.picker = ref;
    ref.afterClosed().pipe(takeUntil(this.destroyed$)).subscribe((result: SummaryCardVisibilityDialogResult | undefined) => {
      this.picker = undefined;
      if (!result || !this.layoutEditing) return;
      this.layout = normalizeSpfLayout({ stationOrder: result.order, stationVisibility: result.visibility }, this.stations);
      this.editor.markEditsMade();
      this.startPolling();
    });
  }

  hasUnsavedChanges(): boolean {
    const saved=normalizeSpfLayout(this.savedLayout,this.stations);
    const savedIds=saved.stationOrder.filter(id=>saved.stationVisibility[id]);
    return JSON.stringify(this.visibleStationIds)!==JSON.stringify(savedIds);
  }

  openLoadLayout(): void {
    if(!this.layoutEditing || this.namedDialog || this.catalogLoading || !this.user.getToken())return;
    this.openNamedDialog(this.dialog.open(LoadProductionLayoutDialogComponent,{
      width:'520px',maxWidth:'94vw',autoFocus:false,data:{hasUnsavedChanges:this.hasUnsavedChanges()}
    }));
  }

  openCreateLayout(): void {
    if(!this.layoutEditing || this.namedDialog || this.catalogLoading || !this.user.getToken() || this.visibleStationIds.length<3 || this.visibleStationIds.length>6)return;
    this.openNamedDialog(this.dialog.open(CreateProductionLayoutDialogComponent,{
      width:'520px',maxWidth:'94vw',autoFocus:false,
      data:{stationIds:[...this.visibleStationIds],systemAllowed:this.user.hasPermissionLevel(7)}
    }));
  }

  private openNamedDialog(ref: MatDialogRef<any>): void {
    this.namedDialog=ref;
    ref.afterClosed().pipe(takeUntil(this.destroyed$)).subscribe((result:ProductionLayoutActivation | undefined)=>{
      this.namedDialog=undefined;
      if(!result)return;
      // The activation response includes the fresh catalog used by server validation.
      this.stations=result.stations;
      this.savedLayout=result.preferences.dashboardLayouts!.experimentalSpf!;
      this.layout=normalizeSpfLayout(this.savedLayout,this.stations);
      this.snapshot=null;
      this.editor.setEditing(false);
      this.startPolling();
    });
  }

  private confirmSave(): void {
    const ref = openLayoutSaveConfirmDialog(this.dialog, () => this.saveLayout(), this.destroyed$);
    this.saveDialog = ref;
    ref?.afterClosed().pipe(takeUntil(this.destroyed$)).subscribe(result => {
      this.saveDialog = undefined;
      if (result === 'discard' && this.snapshot) {
        this.layout = this.snapshot;
        this.snapshot = null;
        this.editor.setEditing(false);
        this.startPolling();
      }
    });
  }

  private saveLayout() {
    if (this.visibleStationIds.length < 3 || this.visibleStationIds.length > 6) return throwError(() => new Error('Choose 3–6 active configured stations before saving.'));
    if (!this.user.getToken()) return throwError(() => new Error('Please log in to save a layout.'));
    return this.settings.saveExperimentalSpfLayout(this.copyLayout()).pipe(tap(() => {
      this.snapshot = null;
      this.editor.setEditing(false);
    }));
  }

  private copyLayout(): SpfLayout {
    return { stationOrder: [...this.layout.stationOrder], stationVisibility: { ...this.layout.stationVisibility } };
  }

  ngOnDestroy(): void {
    this.picker?.close();
    this.namedDialog?.close();
    this.catalogRequest?.unsubscribe();
    this.polling?.unsubscribe();
    this.destroyed$.next();
    this.destroyed$.complete();
    this.editor.unregister(this.layoutContextId);
  }
}
