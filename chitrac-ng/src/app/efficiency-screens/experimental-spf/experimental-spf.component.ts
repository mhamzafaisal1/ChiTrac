import { CreateProductionLayoutDialogComponent, LoadProductionLayoutDialogComponent } from './production-layout-dialogs.component';
import { ProductionLayoutActivation } from '../../services/production-layout.models';
import { ActivatedRoute, Router } from '@angular/router';
import { ProductionScreenLayoutsService } from '../../services/production-screen-layouts.service';
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Subject, Subscription, catchError, combineLatest, distinctUntilChanged, exhaustMap, map, of, startWith, switchMap, takeUntil, tap, timer, throwError } from 'rxjs';
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
  private systemLayout: SpfLayout | null = null;
  private selectedLayout: SpfLayout | null = null;
  private hasNamedSelection = false;
  layoutResolving = true;
  layoutError = '';
  private readonly layoutRetry = new Subject<void>();
  private readonly selectionChanged = new Subject<void>();
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
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly productionLayouts: ProductionScreenLayoutsService,
  ) {}

  ngOnInit(): void {
    this.editor.register(this.layoutContextId, 'Production Screen');
    this.editor.context$.pipe(takeUntil(this.destroyed$)).subscribe(context => {
      const editing = context?.id === this.layoutContextId && context.editing;
      if (editing && !this.layoutEditing) this.snapshot = this.copyLayout();
      this.layoutEditing = !!editing;
    });
    this.editor.lockRequested$.pipe(takeUntil(this.destroyed$)).subscribe(() => {
      if (this.layoutEditing) this.confirmSave();
    });
    this.settings.settings$.pipe(takeUntil(this.destroyed$)).subscribe(settings => {
      this.systemLayout = settings?.dashboardLayouts?.experimentalSpf || null;
    });
    this.user.user.pipe(map(user => user?.username || null), distinctUntilChanged(), takeUntil(this.destroyed$)).subscribe(() => {
      this.picker?.close();
      this.saveDialog?.close();
      this.namedDialog?.close();
      this.editor.setEditing(false);
      this.snapshot = null;
      this.savedLayout = this.systemLayout;
      this.layoutResolving = true;
      this.polling?.unsubscribe();
      this.lanes = {};
    });
    this.settings.userPreferences$.pipe(takeUntil(this.destroyed$)).subscribe(preferences => {
      this.savedLayout = preferences?.dashboardLayouts?.experimentalSpf || null;
      if (!this.layoutEditing) this.applyDisplayLayout();
    });
    this.watchRouteLayout();
    this.loadStations();
  }

  loadStations(openPicker = false): void {
    if (this.catalogLoading) return;
    if (this.hasCatalog) {
      if (openPicker && this.layoutEditing) this.showPicker();
      return;
    }
    this.catalogLoading = true;
    this.catalogError = '';
    this.catalogRequest?.unsubscribe();
    this.catalogRequest = this.configuration.watchMachineConfigs().pipe(
      takeUntil(this.destroyed$),
    ).subscribe({
      next: machines => {
        this.catalogLoading = false;
        this.stations = configuredProductionStations(machines);
        if (this.snapshot) this.snapshot = normalizeSpfLayout(this.snapshot, this.stations);
        this.hasCatalog = true;
        if (this.layoutEditing) {
          this.layout = normalizeSpfLayout(this.layout, this.stations);
          this.startPolling();
        } else this.applyDisplayLayout();
        if (openPicker && this.layoutEditing) this.showPicker();
      },
      error: () => {
        this.catalogLoading = false;
        this.isLoading = false;
        this.catalogError = 'Could not load configured stations. Please try again.';
      },
    });
  }

  private watchRouteLayout(): void {
    combineLatest([
      this.route.queryParamMap,
      this.user.user.pipe(map(user => user?.username || null), distinctUntilChanged()),
      this.layoutRetry.pipe(startWith(undefined)),
    ]).pipe(
      switchMap(([params]) => {
        this.selectionChanged.next();
        this.picker?.close();
        this.namedDialog?.close();
        this.saveDialog?.close();
        this.editor.setEditing(false);
        this.snapshot = null;
        this.selectedLayout = null;
        this.layoutError = '';
        this.layoutResolving = true;
        this.isLoading = true;
        this.polling?.unsubscribe();
        this.lanes = {};
        this.hasNamedSelection = params.has('layoutScope') || params.has('layoutId');
        if (!this.hasNamedSelection) return of(null);
        const scope = params.get('layoutScope');
        const id = params.get('layoutId');
        if ((scope !== 'system' && scope !== 'user') || !id || !/^[a-f0-9]{64}$/.test(id)) {
          this.layoutError = 'This production layout link is invalid. Choose another layout or open the default production screen.';
          return of(null);
        }
        return this.productionLayouts.read({ scope, id }).pipe(catchError(error => {
          this.layoutError = error?.error?.error || 'Could not load this production layout. Please try again or open the default production screen.';
          return of(null);
        }));
      }),
      takeUntil(this.destroyed$),
    ).subscribe(result => {
      this.selectedLayout = result?.stationLayout || null;
      this.layoutResolving = false;
      this.applyDisplayLayout();
    });
  }

  private applyDisplayLayout(): void {
    if (this.layoutResolving) return;
    if (this.layoutError) { this.isLoading = false; return; }
    const base = this.hasNamedSelection ? this.selectedLayout : this.savedLayout;
    if (this.hasNamedSelection && this.hasCatalog && base?.stationOrder.some(id =>
      base.stationVisibility[id] !== false && !this.stations.some(station => station.id === id))) {
      this.layoutError = 'This layout contains unavailable stations. Choose another layout or open the default production screen.';
      this.isLoading = false;
      this.polling?.unsubscribe();
      return;
    }
    this.layout = normalizeSpfLayout(base, this.stations);
    if (this.hasCatalog) this.startPolling();
  }

  retrySelectedLayout(): void { this.layoutRetry.next(); }

  openDefaultLayout(): void {
    this.router.navigate(['/ng/production-screen']);
  }

  private clearNamedSelection(): void {
    if (this.hasNamedSelection) this.router.navigate([], {
      relativeTo: this.route, queryParams: { layoutScope: null, layoutId: null }, queryParamsHandling: 'merge', replaceUrl: true,
    });
  }

  private startPolling(): void {
    if (this.layoutResolving || this.layoutError) return;
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
    return this.layoutResolving || this.layoutError ? [] : this.layout.stationOrder.filter(id => this.layout.stationVisibility[id]);
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
        title: 'Edit Layout', description: 'Choose 3–8 stations. Drag stations to change their order.',
        showLabel: 'Shown', hideLabel: 'Hidden', emptyShownText: 'No stations shown', emptyHiddenText: 'No stations hidden',
        compactCards: true, minVisible: 3, maxVisible: 8, allowTemporaryOverLimit: true, dragDropEnabled: true,
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
    const saved=normalizeSpfLayout(this.hasNamedSelection ? this.selectedLayout : this.savedLayout,this.stations);
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
    if(!this.layoutEditing || this.namedDialog || this.catalogLoading || !this.user.getToken() || this.visibleStationIds.length<3 || this.visibleStationIds.length>8)return;
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
      this.clearNamedSelection();
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
    if (this.visibleStationIds.length < 3 || this.visibleStationIds.length > 8) return throwError(() => new Error('Choose 3–8 active configured stations before saving.'));
    if (!this.user.getToken()) return throwError(() => new Error('Please log in to save a layout.'));
    return this.settings.saveExperimentalSpfLayout(this.copyLayout()).pipe(takeUntil(this.selectionChanged), tap(() => {
      this.snapshot = null;
      this.editor.setEditing(false);
      this.clearNamedSelection();
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
    this.selectionChanged.next();
    this.selectionChanged.complete();
    this.editor.unregister(this.layoutContextId);
  }
}
