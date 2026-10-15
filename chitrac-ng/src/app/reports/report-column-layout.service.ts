import { Injectable, OnDestroy } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Subject, takeUntil, tap } from 'rxjs';
import { LayoutEditService } from '../services/layout-edit.service';
import { SettingsService } from '../services/settings.service';
import { openLayoutSaveConfirmDialog } from '../components/layout-save-confirm/layout-save-confirm.component';
import { REPORT_COLUMNS, reconcileReportColumns, ReportLayoutId } from './report-columns';

@Injectable()
export class ReportColumnLayoutService implements OnDestroy {
  columns: string[] = [];
  editing = false;
  private id!: ReportLayoutId;
  private snapshot: string[] | null = null;
  private readonly destroyed$ = new Subject<void>();

  constructor(private edits: LayoutEditService, private settings: SettingsService, private dialog: MatDialog) {}

  initialize(id: ReportLayoutId, label: string): void {
    this.id = id;
    this.columns = [...REPORT_COLUMNS[id]];
    this.edits.register(id, label);
    this.settings.userPreferences$.pipe(takeUntil(this.destroyed$)).subscribe(preferences => {
      if (!this.editing) this.columns = reconcileReportColumns(id, preferences?.reportLayouts?.[id]?.columnOrder);
    });
    this.edits.context$.pipe(takeUntil(this.destroyed$)).subscribe(context => {
      const editing = context?.id === id && context.editing;
      if (editing && !this.editing) this.snapshot = [...this.columns];
      this.editing = editing;
    });
    this.edits.lockRequested$.pipe(takeUntil(this.destroyed$)).subscribe(() => {
      if (!this.editing) return;
      const ref = openLayoutSaveConfirmDialog(this.dialog, () => this.settings.saveReportColumnOrder(id, this.columns).pipe(
        tap(() => {
          this.snapshot = null;
          this.edits.setEditing(false);
        })
      ), this.destroyed$);
      ref?.afterClosed().pipe(takeUntil(this.destroyed$)).subscribe(result => {
        if (result === 'discard') {
          this.columns = [...(this.snapshot ?? REPORT_COLUMNS[id])];
          this.snapshot = null;
          this.edits.setEditing(false);
        }
      });
    });
  }

  setOrder(order: string[]): void {
    if (!this.editing) return;
    const next = reconcileReportColumns(this.id, order);
    if (next.every((column, index) => column === this.columns[index])) return;
    this.columns = next;
    this.edits.markEditsMade();
  }

  ngOnDestroy(): void {
    this.destroyed$.next();
    this.destroyed$.complete();
    if (this.id) this.edits.unregister(this.id);
  }
}
