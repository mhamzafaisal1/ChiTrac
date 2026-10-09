import { CommonModule } from '@angular/common';
import { Component, DestroyRef, Inject, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { defer, Observable, take, takeUntil } from 'rxjs';

interface LayoutSaveDialogData {
  save: () => Observable<unknown>;
}

export function openLayoutSaveConfirmDialog(
  dialog: MatDialog,
  save: () => Observable<unknown>,
  destroyed: Observable<void>
): MatDialogRef<LayoutSaveConfirmComponent> | undefined {
  if (dialog.openDialogs.some(ref => ref.componentInstance instanceof LayoutSaveConfirmComponent)) return undefined;
  const ref = dialog.open(LayoutSaveConfirmComponent, {
    width: '460px',
    maxWidth: 'calc(100vw - 32px)',
    autoFocus: false,
    data: { save: () => save().pipe(takeUntil(destroyed)) },
  });
  destroyed.pipe(take(1), takeUntil(ref.afterClosed())).subscribe(() => ref.close('keep-editing'));
  return ref;
}

@Component({
  selector: 'app-layout-save-confirm',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="layout-save-dialog">
      <mat-icon *ngIf="!saving">dashboard_customize</mat-icon>
      <mat-spinner *ngIf="saving" [diameter]="34" aria-label="Saving layout"></mat-spinner>
      <h2 mat-dialog-title>{{ saving ? 'Saving Layout' : 'Save Layout?' }}</h2>
      <mat-dialog-content [attr.aria-busy]="saving">
        <div *ngIf="saving" role="status" aria-live="polite">Saving...</div>
        <div *ngIf="!saving && !error">Save these layout settings to your user preferences.</div>
        <div *ngIf="error" role="alert">{{ error }}</div>
      </mat-dialog-content>
      <mat-dialog-actions *ngIf="!saving" align="end">
        <button mat-stroked-button [mat-dialog-close]="'discard'">Cancel</button>
        <button mat-stroked-button [mat-dialog-close]="'keep-editing'">Keep Editing</button>
        <button mat-flat-button color="primary" (click)="save()">{{ error ? 'Retry' : 'Save' }}</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .layout-save-dialog {
      width: 100%;
      min-width: 0;
      padding-top: 8px;
      overflow: hidden;
      box-sizing: border-box;
    }

    .layout-save-dialog > mat-icon {
      display: block;
      width: 34px;
      height: 34px;
      margin: 0 auto 4px;
      color: var(--theme-color-primary);
      font-size: 34px;
    }

    mat-spinner { margin: 0 auto 4px; }

    mat-dialog-content { min-height: 56px; }

    h2 {
      margin: 0;
      text-align: center;
    }

    mat-dialog-content {
      color: var(--theme-color-on-surface-variant);
      text-align: center;
      overflow: visible;
      white-space: normal;
    }

    mat-dialog-actions {
      display: flex;
      flex-wrap: nowrap;
      justify-content: space-between;
      gap: clamp(10px, 3vw, 18px);
      padding-top: 14px;
      padding-inline: clamp(16px, 5%, 28px);
    }

    mat-dialog-actions button {
      flex: 1 1 0;
      min-width: 0;
      max-width: none;
      margin: 0;
      white-space: nowrap;
    }
  `]
})
export class LayoutSaveConfirmComponent {
  saving = false;
  error = '';
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    @Inject(MAT_DIALOG_DATA) private readonly data: LayoutSaveDialogData,
    private readonly dialogRef: MatDialogRef<LayoutSaveConfirmComponent>
  ) {}

  save(): void {
    if (this.saving) return;
    this.saving = true;
    this.error = '';
    this.dialogRef.disableClose = true;
    let saved = false;
    defer(() => this.data.save()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { saved = true; },
      complete: () => { if (saved) this.dialogRef.close('saved'); },
      error: () => {
        this.saving = false;
        this.dialogRef.disableClose = false;
        this.error = 'Could not save the layout. Your changes are still available. Retry or keep editing.';
      },
    });
  }
}
