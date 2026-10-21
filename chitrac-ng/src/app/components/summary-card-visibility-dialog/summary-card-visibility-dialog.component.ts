import { CommonModule } from '@angular/common';
import { Component, DestroyRef, Inject, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, defer, finalize, take } from 'rxjs';
import { CdkDrag, CdkDragDrop, CdkDropList, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ScrollingModule } from '@angular/cdk/scrolling';

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
  minVisible?: number;
  exactVisible?: number;
  layoutOptions?: Array<{ id: string; label: string; exactVisible: number }>;
  layout?: string;
  dragDropEnabled?: boolean;
  applyLabel?: string;
  save?: (result: SummaryCardVisibilityDialogResult) => Observable<unknown>;
}

export interface SummaryCardVisibilityDialogResult {
  visibility: Record<string, boolean>;
  order: string[];
  layout?: string;
}

@Component({
  selector: 'app-summary-card-visibility-dialog',
  standalone: true,
  imports: [CommonModule, DragDropModule, ScrollingModule, MatButtonModule, MatDialogModule, MatIconModule, MatTooltipModule],
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
  minVisible: number | null = null;
  exactVisible: number | null = null;
  layoutOptions: NonNullable<SummaryCardVisibilityDialogData['layoutOptions']> = [];
  selectedLayout: string | null = null;
  dragDropEnabled = false;
  selectedShowId: string | null = null;
  selectedHideId: string | null = null;
  applyLabel = 'Apply';
  saving = false;
  saveError = '';
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private dialogRef: MatDialogRef<SummaryCardVisibilityDialogComponent>,
    @Inject(MAT_DIALOG_DATA) private data: SummaryCardVisibilityDialogData
  ) {
    this.visibility = { ...(data.visibility || {}) };
    this.title = data.title || this.title;
    this.description = data.description ?? this.description;
    this.showLabel = data.showLabel || this.showLabel;
    this.hideLabel = data.hideLabel || this.hideLabel;
    this.emptyShownText = data.emptyShownText || this.emptyShownText;
    this.emptyHiddenText = data.emptyHiddenText || this.emptyHiddenText;
    this.compactCards = data.compactCards === true;
    this.maxVisible = typeof data.maxVisible === 'number' ? data.maxVisible : null;
    this.minVisible = typeof data.minVisible === 'number' ? data.minVisible : null;
    this.exactVisible = typeof data.exactVisible === 'number' ? data.exactVisible : null;
    this.layoutOptions = data.layoutOptions || [];
    if (this.layoutOptions.length) {
      this.selectLayout(data.layout || this.layoutOptions[0].id);
      if (!this.selectedLayout) this.selectLayout(this.layoutOptions[0].id);
    }
    this.dragDropEnabled = data.dragDropEnabled === true;
    this.applyLabel = data.applyLabel || this.applyLabel;
    this.showCards = (data.cards || []).filter((card) => this.isVisible(this.getCardId(card)));
    this.hideCards = (data.cards || []).filter((card) => !this.isVisible(this.getCardId(card)));
  }

  selectShow(card: SummaryCardVisibilityOption): void {
    this.selectedShowId = this.getCardId(card);
    this.selectedHideId = null;
  }

  selectLayout(id: string): void {
    if (this.saving) return;
    const option = this.layoutOptions.find(option => option.id === id);
    if (!option) return;
    this.selectedLayout = option.id;
    this.exactVisible = option.exactVisible;
    this.maxVisible = option.exactVisible;
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

  hideAll(): void {
    if (!this.showCards.length) return;
    this.moveAll(false);
  }

  showAll(): void {
    if (!this.canShowAll) return;
    this.moveAll(true);
  }

  get canShowAll(): boolean {
    const total = this.showCards.length + this.hideCards.length;
    return this.hideCards.length > 0 &&
      (this.maxVisible == null || total <= this.maxVisible) &&
      (this.exactVisible == null || total <= this.exactVisible);
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
    return (this.exactVisible == null || this.showCards.length === this.exactVisible) &&
      (this.minVisible == null || this.showCards.length >= this.minVisible) &&
      (this.maxVisible == null || this.showCards.length <= this.maxVisible);
  }

  get visibleCountMessage(): string | null {
    if (this.exactVisible != null) {
      return `${this.showCards.length} selected. Exactly ${this.exactVisible} required.`;
    }
    if (this.minVisible != null) {
      return `${this.showCards.length} selected. Choose ${this.minVisible}${this.maxVisible != null ? '–' + this.maxVisible : ' or more'}.`;
    }
    if (this.maxVisible == null || this.canShowMore) return null;
    return `Maximum visible: ${this.maxVisible}`;
  }

  cancel(): void {
    if (this.saving) return;
    this.dialogRef.close();
  }

  save(): void {
    if (this.saving || !this.canApply) return;
    const result: SummaryCardVisibilityDialogResult = {
      visibility: { ...this.visibility },
      order: [...this.showCards, ...this.hideCards].map((card) => this.getCardId(card)),
      ...(this.selectedLayout ? { layout: this.selectedLayout } : {}),
    };
    if (!this.data.save) {
      this.dialogRef.close(result);
      return;
    }
    this.saving = true;
    this.saveError = '';
    const disableClose = this.dialogRef.disableClose;
    this.dialogRef.disableClose = true;
    defer(() => this.data.save!(result)).pipe(
      take(1),
      takeUntilDestroyed(this.destroyRef),
      finalize(() => {
        this.saving = false;
        this.dialogRef.disableClose = disableClose;
      })
    ).subscribe({
      next: () => this.dialogRef.close(result),
      error: () => { this.saveError = 'Could not save changes. Please try again.'; }
    });
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

  private moveAll(visible: boolean): void {
    const source = visible ? this.hideCards : this.showCards;
    const destination = visible ? this.showCards : this.hideCards;
    const visibility = { ...this.visibility };
    for (const card of source) {
      visibility[this.getCardId(card)] = visible;
      destination.push(card);
    }
    source.length = 0;
    this.visibility = visibility;
    this.selectedShowId = null;
    this.selectedHideId = null;
  }
}
