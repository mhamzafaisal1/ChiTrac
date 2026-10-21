import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Subject, catchError, distinctUntilChanged, exhaustMap, forkJoin, map, of, takeUntil, tap, timer, throwError } from 'rxjs';
import { EfficiencyScreensService } from '../../services/efficiency-screens.service';
import { LayoutEditService } from '../../services/layout-edit.service';
import { SettingsService } from '../../services/settings.service';
import { UserService } from '../../user.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { openLayoutSaveConfirmDialog } from '../../components/layout-save-confirm/layout-save-confirm.component';
import { SummaryCardVisibilityDialogComponent, SummaryCardVisibilityDialogResult } from '../../components/summary-card-visibility-dialog/summary-card-visibility-dialog.component';
import { EfficiencyScreenLaneComponent, EfficiencyScreenLaneMode } from '../efficiency-screen-lane/efficiency-screen-lane.component';
import { normalizeSpfLayout, SPF_STATION_SERIALS, SpfLayout } from './spf-stations';

@Component({
  selector: 'app-experimental-spf',
  standalone: true,
  imports: [CommonModule, DragDropModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, EfficiencyScreenLaneComponent],
  templateUrl: './experimental-spf.component.html',
  styleUrl: './experimental-spf.component.scss',
})
export class ExperimentalSpfComponent implements OnInit, OnDestroy {
  readonly layoutContextId = 'experimentalSpf';
  layout = normalizeSpfLayout();
  layoutEditing = false;
  isLoading = true;
  lanes: Record<string, any> = {};
  private snapshot: SpfLayout | null = null;
  private readonly destroyed$ = new Subject<void>();
  private picker?: MatDialogRef<SummaryCardVisibilityDialogComponent>;
  private saveDialog?: MatDialogRef<any>;

  constructor(
    private readonly efficiency: EfficiencyScreensService,
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
      this.editor.setEditing(false);
      this.snapshot = null;
      this.layout = normalizeSpfLayout();
    });
    this.settings.userPreferences$.pipe(takeUntil(this.destroyed$)).subscribe(preferences => {
      if (!this.layoutEditing) this.layout = normalizeSpfLayout(preferences?.dashboardLayouts?.experimentalSpf);
    });
    // Read the same shared live cache as the original screen; preserve identity across updates.
    timer(0, 6000).pipe(
      exhaustMap(() => forkJoin(SPF_STATION_SERIALS.map(serial =>
        this.efficiency.getLiveEfficiencySummary(serial).pipe(catchError(() => of({ flipperData: [] })))
      ))),
      takeUntil(this.destroyed$),
    ).subscribe(responses => {
      this.lanes = Object.fromEntries(SPF_STATION_SERIALS.map((serial, index) => {
        const lane = responses[index]?.flipperData?.[0];
        return [String(serial), lane ? { ...lane, serial } : {
          serial, machine: `Serial ${serial}`, status: -1, fault: 'Offline',
          operator: null, efficiency: {}, oee: {}, batch: {}, displayTimers: {},
        }];
      }));
      this.isLoading = false;
    });
  }

  get visibleStationIds(): string[] {
    return this.layout.stationOrder.filter(id => this.layout.stationVisibility[id]);
  }

  stationLabel(id: string): string { return this.lanes[id]?.machine || `Serial ${id}`; }
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
    if (!this.layoutEditing || this.picker) return;
    const ref = this.dialog.open(SummaryCardVisibilityDialogComponent, {
      width: '800px', maxWidth: '94vw', autoFocus: false,
      data: {
        title: 'Edit SPF Layout', description: 'Choose 3–6 stations. Drag stations to change their order.',
        showLabel: 'Shown', hideLabel: 'Hidden', emptyShownText: 'No stations shown', emptyHiddenText: 'No stations hidden',
        compactCards: true, minVisible: 3, maxVisible: 6, dragDropEnabled: true,
        cards: this.layout.stationOrder.map(id => ({ id, label: this.stationLabel(id), icon: 'local_laundry_service' })),
        visibility: { ...this.layout.stationVisibility },
      },
    });
    this.picker = ref;
    ref.afterClosed().pipe(takeUntil(this.destroyed$)).subscribe((result: SummaryCardVisibilityDialogResult | undefined) => {
      this.picker = undefined;
      if (!result || !this.layoutEditing) return;
      this.layout = normalizeSpfLayout({ stationOrder: result.order, stationVisibility: result.visibility });
      this.editor.markEditsMade();
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
      }
    });
  }

  private saveLayout() {
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
    this.destroyed$.next();
    this.destroyed$.complete();
    this.editor.unregister(this.layoutContextId);
  }
}
