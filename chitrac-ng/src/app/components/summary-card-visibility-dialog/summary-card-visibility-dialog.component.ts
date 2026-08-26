import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

export interface SummaryCardVisibilityOption {
  label: string;
  icon?: string;
  value?: string | number;
  tone?: string;
  sparklineLinePoints?: string;
  sparklineAreaPath?: string;
}

export interface SummaryCardVisibilityDialogData {
  cards: SummaryCardVisibilityOption[];
  visibility: Record<string, boolean>;
  title?: string;
  description?: string;
  showLabel?: string;
  hideLabel?: string;
  emptyShownText?: string;
  emptyHiddenText?: string;
  compactCards?: boolean;
  maxVisible?: number;
}

@Component({
  selector: 'app-summary-card-visibility-dialog',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatDialogModule, MatIconModule],
  templateUrl: './summary-card-visibility-dialog.component.html',
  styleUrl: './summary-card-visibility-dialog.component.scss'
})
export class SummaryCardVisibilityDialogComponent {
  cards: SummaryCardVisibilityOption[] = [];
  visibility: Record<string, boolean> = {};
  title = 'Show/Hide Infoboxes';
  description = 'Choose which dashboard infoboxes are visible in this layout.';
  showLabel = 'Show';
  hideLabel = 'Hide';
  emptyShownText = 'No infoboxes shown';
  emptyHiddenText = 'No infoboxes hidden';
  compactCards = false;
  maxVisible: number | null = null;
  selectedShowLabel: string | null = null;
  selectedHideLabel: string | null = null;

  constructor(
    private dialogRef: MatDialogRef<SummaryCardVisibilityDialogComponent>,
    @Inject(MAT_DIALOG_DATA) data: SummaryCardVisibilityDialogData
  ) {
    this.cards = data.cards || [];
    this.visibility = { ...(data.visibility || {}) };
    this.title = data.title || this.title;
    this.description = data.description || this.description;
    this.showLabel = data.showLabel || this.showLabel;
    this.hideLabel = data.hideLabel || this.hideLabel;
    this.emptyShownText = data.emptyShownText || this.emptyShownText;
    this.emptyHiddenText = data.emptyHiddenText || this.emptyHiddenText;
    this.compactCards = data.compactCards === true;
    this.maxVisible = typeof data.maxVisible === 'number' ? data.maxVisible : null;
  }

  get showCards(): SummaryCardVisibilityOption[] {
    return this.cards.filter((card) => this.isVisible(card.label));
  }

  get hideCards(): SummaryCardVisibilityOption[] {
    return this.cards.filter((card) => !this.isVisible(card.label));
  }

  selectShow(label: string): void {
    this.selectedShowLabel = label;
    this.selectedHideLabel = null;
  }

  selectHide(label: string): void {
    this.selectedHideLabel = label;
    this.selectedShowLabel = null;
  }

  hideSelected(): void {
    if (!this.selectedShowLabel) return;
    this.visibility = { ...this.visibility, [this.selectedShowLabel]: false };
    this.selectedShowLabel = null;
  }

  showSelected(): void {
    if (!this.selectedHideLabel) return;
    if (!this.canShowMore) return;
    this.visibility = { ...this.visibility, [this.selectedHideLabel]: true };
    this.selectedHideLabel = null;
  }

  get canShowMore(): boolean {
    return this.maxVisible == null || this.showCards.length < this.maxVisible;
  }

  get maxVisibleMessage(): string | null {
    if (this.maxVisible == null || this.canShowMore) return null;
    return `Maximum visible: ${this.maxVisible}`;
  }

  cancel(): void {
    this.dialogRef.close();
  }

  save(): void {
    this.dialogRef.close(this.visibility);
  }

  private isVisible(label: string): boolean {
    return this.visibility[label] !== false;
  }
}
