import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-layout-save-confirm',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatDialogModule, MatIconModule],
  template: `
    <div class="layout-save-dialog">
      <mat-icon>dashboard_customize</mat-icon>
      <h2 mat-dialog-title>Save Layout?</h2>
      <mat-dialog-content>
        Save these layout settings to your user preferences.
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-stroked-button [mat-dialog-close]="'discard'">Cancel</button>
        <button mat-stroked-button [mat-dialog-close]="'keep-editing'">Keep Editing</button>
        <button mat-flat-button color="primary" [mat-dialog-close]="'save'">Save</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .layout-save-dialog {
      min-width: 360px;
      padding-top: 8px;
    }

    .layout-save-dialog > mat-icon {
      display: block;
      width: 34px;
      height: 34px;
      margin: 0 auto 4px;
      color: var(--theme-color-primary);
      font-size: 34px;
    }

    h2 {
      margin: 0;
      text-align: center;
    }

    mat-dialog-content {
      color: var(--theme-color-on-surface-variant);
      text-align: center;
    }

    mat-dialog-actions {
      display: flex;
      flex-wrap: nowrap;
      justify-content: center;
      gap: 12px;
      padding-top: 14px;
    }

    mat-dialog-actions button {
      min-width: 112px;
      margin: 0;
      white-space: nowrap;
    }
  `]
})
export class LayoutSaveConfirmComponent {}
