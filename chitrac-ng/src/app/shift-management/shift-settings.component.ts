import { SelectionModel } from '@angular/cdk/collections';
import { animate, style, transition, trigger } from '@angular/animations';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { ShiftCrudComponent } from './shift-crud.component';
import { ShiftDocument, ShiftService } from '../services/shift.service';
import { formatTime } from './shift-time.utils';

@Component({
  selector: 'app-shift-settings',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    ShiftCrudComponent,
  ],
  templateUrl: './shift-settings.component.html',
  styleUrls: ['./shift-settings.component.scss'],
  animations: [
    trigger('editorReveal', [
      transition(':enter', [
        style({
          opacity: 0,
          transform: 'translateY(-18px)',
          overflow: 'hidden',
        }),
        animate(
          '400ms cubic-bezier(0.33, 1, 0.32, 1)',
          style({
            opacity: 1,
            transform: 'translateY(0)',
            overflow: 'visible',
          })
        ),
      ]),
      transition(':leave', [
        style({ overflow: 'hidden' }),
        animate(
          '260ms cubic-bezier(0.4, 0, 1, 1)',
          style({
            opacity: 0,
            transform: 'translateY(-10px)',
          })
        ),
      ]),
    ]),
  ],
})
export class ShiftSettingsComponent implements OnInit {
  private readonly shiftService = inject(ShiftService);
  private readonly snackBar = inject(MatSnackBar);

  shifts: ShiftDocument[] = [];
  readonly displayedColumns = ['summary'];
  selection = new SelectionModel<ShiftDocument>(
    false,
    [],
    true,
    (a, b) => a._id === b._id
  );

  showEditor = false;
  editorMode: 'add' | 'edit' = 'add';
  editorShift: ShiftDocument | null = null;

  isLoading = false;

  private readonly dayLabels: Record<number, string> = {
    1: 'Mon',
    2: 'Tue',
    3: 'Wed',
    4: 'Thur',
    5: 'Fri',
    6: 'Sat',
    7: 'Sun',
  };

  ngOnInit(): void {
    this.loadShifts();
  }

  get canEditOrDelete(): boolean {
    return this.selection.selected.length > 0;
  }

  formatShiftRow(shift: ShiftDocument): string {
    const name = shift.name?.trim() ? shift.name : 'Unnamed shift';
    const st = shift.startTime;
    const en = shift.endTime;
    const timePart =
      st && en
        ? `${formatTime(st)} – ${formatTime(en)}`
        : '—';
    const days = (shift.activeDays ?? [])
      .slice()
      .sort((a, b) => a - b)
      .map((d) => this.dayLabels[d] ?? String(d))
      .join(', ');
    const daysPart = days || '—';
    const status = shift.active !== false ? 'Active' : 'Inactive';
    return `${name} · ${timePart} · ${daysPart} · ${status}`;
  }

  loadShifts(): void {
    this.isLoading = true;
    this.shiftService.getAllShifts().subscribe({
      next: (res) => {
        this.shifts = res.shifts ?? [];
        this.isLoading = false;
        this.syncSelectionAfterReload();
      },
      error: (err: unknown) => {
        this.isLoading = false;
        const msg =
          err instanceof HttpErrorResponse &&
          err.error &&
          typeof err.error === 'object' &&
          'error' in err.error
            ? String((err.error as { error?: string }).error)
            : 'Could not load shifts.';
        this.snackBar.open(msg, 'Close', { duration: 4000 });
        this.shifts = [];
      },
    });
  }

  private syncSelectionAfterReload(): void {
    const sel = this.selection.selected[0];
    if (!sel) {
      return;
    }
    const match = this.shifts.find((s) => s._id === sel._id);
    if (match) {
      this.selection.setSelection(match);
      if (this.showEditor && this.editorMode === 'edit') {
        this.editorShift = match;
      }
    } else {
      this.selection.clear();
      this.showEditor = false;
    }
  }

  openAdd(): void {
    this.editorMode = 'add';
    this.editorShift = null;
    this.showEditor = true;
  }

  openEdit(): void {
    const row = this.selection.selected[0];
    if (!row) {
      return;
    }
    this.editorMode = 'edit';
    this.editorShift = row;
    this.showEditor = true;
  }

  closeEditor(): void {
    this.showEditor = false;
  }

  onShiftSaved(): void {
    this.loadShifts();
  }

  deleteShift(): void {
    const row = this.selection.selected[0];
    if (!row) {
      return;
    }
    if (!confirm(`Delete shift "${row.name || 'Unnamed'}"?`)) {
      return;
    }
    this.shiftService.deleteShift(row._id).subscribe({
      next: () => {
        this.snackBar.open('Shift deleted.', 'Close', { duration: 2500 });
        if (this.editorMode === 'edit' && this.editorShift?._id === row._id) {
          this.showEditor = false;
          this.editorShift = null;
        }
        this.selection.clear();
        this.loadShifts();
      },
      error: (err: unknown) => {
        const msg =
          err instanceof HttpErrorResponse &&
          err.error &&
          typeof err.error === 'object' &&
          'error' in err.error
            ? String((err.error as { error?: string }).error)
            : 'Could not delete shift.';
        this.snackBar.open(msg, 'Close', { duration: 4500 });
      },
    });
  }

  selectRow(row: ShiftDocument): void {
    this.selection.toggle(row);
  }
}
