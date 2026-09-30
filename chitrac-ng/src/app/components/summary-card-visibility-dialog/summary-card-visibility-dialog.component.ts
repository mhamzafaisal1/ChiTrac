import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { CdkDrag, CdkDragDrop, CdkDropList, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

export interface SummaryCardVisibilityOption {
  id?: string;
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
  exactVisible?: number;
  dragDropEnabled?: boolean;
}

export interface SummaryCardVisibilityDialogResult {
  visibility: Record<string, boolean>;
  order: string[];
}

@Component({
  selector: 'app-summary-card-visibility-dialog',
  standalone: true,
  imports: [CommonModule, DragDropModule, MatButtonModule, MatDialogModule, MatIconModule],
  templateUrl: './summary-card-visibility-dialog.component.html',
  styleUrl: './summary-card-visibility-dialog.component.scss'
})
export class SummaryCardVisibilityDialogComponent {
  showCards: SummaryCardVisibilityOption[] = [];
  hideCards: SummaryCardVisibilityOption[] = [];
  visibility: Record<string, boolean> = {};
  title = 'Show/Hide Infoboxes';
  description = 'Choose which dashboard infoboxes are visible in this layout.';
  showLabel = 'Show';
  hideLabel = 'Hide';
  emptyShownText = 'No infoboxes shown';
  emptyHiddenText = 'No infoboxes hidden';
  compactCards = false;
  maxVisible: number | null = null;
  exactVisible: number | null = null;
  dragDropEnabled = false;
  selectedShowId: string | null = null;
  selectedHideId: string | null = null;

  constructor(
    private dialogRef: MatDialogRef<SummaryCardVisibilityDialogComponent>,
    @Inject(MAT_DIALOG_DATA) data: SummaryCardVisibilityDialogData
  ) {
    this.visibility = { ...(data.visibility || {}) };
    this.title = data.title || this.title;
    this.description = data.description || this.description;
    this.showLabel = data.showLabel || this.showLabel;
    this.hideLabel = data.hideLabel || this.hideLabel;
    this.emptyShownText = data.emptyShownText || this.emptyShownText;
    this.emptyHiddenText = data.emptyHiddenText || this.emptyHiddenText;
    this.compactCards = data.compactCards === true;
    this.maxVisible = typeof data.maxVisible === 'number' ? data.maxVisible : null;
    this.exactVisible = typeof data.exactVisible === 'number' ? data.exactVisible : null;
    this.dragDropEnabled = data.dragDropEnabled === true;
    this.showCards = (data.cards || []).filter((card) => this.isVisible(this.getCardId(card)));
    this.hideCards = (data.cards || []).filter((card) => !this.isVisible(this.getCardId(card)));
  }

  selectShow(card: SummaryCardVisibilityOption): void {
    this.selectedShowId = this.getCardId(card);
    this.selectedHideId = null;
  }

  selectHide(card: SummaryCardVisibilityOption): void {
    this.selectedHideId = this.getCardId(card);
    this.selectedShowId = null;
  }

  hideSelected(): void {
    if (!this.selectedShowId) return;
    const index = this.showCards.findIndex((card) => this.getCardId(card) === this.selectedShowId);
    if (index < 0) return;
    const [card] = this.showCards.splice(index, 1);
    this.hideCards.push(card);
    this.setCardVisibility(card, false);
    this.selectedShowId = null;
  }

  showSelected(): void {
    if (!this.selectedHideId || !this.canShowMore) return;
    const index = this.hideCards.findIndex((card) => this.getCardId(card) === this.selectedHideId);
    if (index < 0) return;
    const [card] = this.hideCards.splice(index, 1);
    this.showCards.push(card);
    this.setCardVisibility(card, true);
    this.selectedHideId = null;
  }

  drop(event: CdkDragDrop<SummaryCardVisibilityOption[]>, destinationVisible: boolean): void {
    if (!this.dragDropEnabled) return;

    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
      return;
    }

    if (destinationVisible && !this.canShowMore) return;
    transferArrayItem(
      event.previousContainer.data,
      event.container.data,
      event.previousIndex,
      event.currentIndex
    );
    this.setCardVisibility(event.container.data[event.currentIndex], destinationVisible);
    this.selectedShowId = null;
    this.selectedHideId = null;
  }

  canEnterShow = (drag: CdkDrag<SummaryCardVisibilityOption>, drop: CdkDropList<SummaryCardVisibilityOption[]>): boolean =>
    drag.dropContainer === drop || this.canShowMore;

  get canShowMore(): boolean {
    return this.maxVisible == null || this.showCards.length < this.maxVisible;
  }

  get canApply(): boolean {
    return this.exactVisible == null || this.showCards.length === this.exactVisible;
  }

  get visibleCountMessage(): string | null {
    if (this.exactVisible != null) {
      return `${this.showCards.length} selected. Exactly ${this.exactVisible} required.`;
    }
    if (this.maxVisible == null || this.canShowMore) return null;
    return `Maximum visible: ${this.maxVisible}`;
  }

  cancel(): void {
    this.dialogRef.close();
  }

  save(): void {
    const result: SummaryCardVisibilityDialogResult = {
      visibility: this.visibility,
      order: [...this.showCards, ...this.hideCards].map((card) => this.getCardId(card)),
    };
    this.dialogRef.close(result);
  }

  private isVisible(label: string): boolean {
    return this.visibility[label] !== false;
  }

  private getCardId(card: SummaryCardVisibilityOption): string {
    return card.id || card.label;
  }

  private setCardVisibility(card: SummaryCardVisibilityOption, visible: boolean): void {
    this.visibility = { ...this.visibility, [this.getCardId(card)]: visible };
  }
}
