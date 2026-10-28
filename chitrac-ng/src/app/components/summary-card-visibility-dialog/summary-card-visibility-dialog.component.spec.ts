import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { MatDialogRef } from '@angular/material/dialog';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import {
  SummaryCardVisibilityDialogComponent,
  SummaryCardVisibilityDialogData,
  SummaryCardVisibilityOption,
} from './summary-card-visibility-dialog.component';

describe('SummaryCardVisibilityDialogComponent', () => {
  let close: jasmine.Spy;

  beforeEach(() => {
    close = jasmine.createSpy('close');
  });

  function createComponent(overrides: Partial<SummaryCardVisibilityDialogData> = {}): SummaryCardVisibilityDialogComponent {
    const data: SummaryCardVisibilityDialogData = {
      cards: [
        { id: 'first', label: 'First' },
        { id: 'second', label: 'Second' },
        { id: 'third', label: 'Third' },
      ],
      visibility: { third: false },
      dragDropEnabled: true,
      ...overrides,
    };

    return TestBed.runInInjectionContext(() => new SummaryCardVisibilityDialogComponent(
      { close } as unknown as MatDialogRef<SummaryCardVisibilityDialogComponent>,
      data
    ));
  }

  function dropEvent(
    previousData: SummaryCardVisibilityOption[],
    currentData: SummaryCardVisibilityOption[],
    previousIndex: number,
    currentIndex: number
  ): CdkDragDrop<SummaryCardVisibilityOption[]> {
    const previousContainer = { data: previousData };
    const container = previousData === currentData ? previousContainer : { data: currentData };
    return {
      previousContainer,
      container,
      previousIndex,
      currentIndex,
    } as CdkDragDrop<SummaryCardVisibilityOption[]>;
  }

  it('reorders cards within the Show list', () => {
    const component = createComponent();

    component.drop(dropEvent(component.showCards, component.showCards, 0, 1), true);

    expect(component.showCards.map((card) => card.id)).toEqual(['second', 'first']);
  });

  it('keeps hidden station labels naturally sorted through arrow, bulk and drag transfers', () => {
    const component = createComponent({
      cards: [
        { id: 'spl4', label: 'SPL1 — Station 4' },
        { id: 'lpl10', label: 'LPL2 — Station 10' },
        { id: 'blanket', label: 'Blanket1 — Station 2' },
        { id: 'spl1', label: 'SPL1 — Station 1' },
        { id: 'lpl2', label: 'LPL2 — Station 2' },
      ],
      visibility: { lpl10: false, blanket: false, spl1: false },
      sortHiddenByLabel: true,
    });
    expect(component.showCards.map(card => card.id)).toEqual(['spl4', 'lpl2']);
    expect(component.hideCards.map(card => card.id)).toEqual(['blanket', 'lpl10', 'spl1']);
    component.selectShow(component.showCards[1]);
    component.hideSelected();
    expect(component.hideCards.map(card => card.id)).toEqual(['blanket', 'lpl2', 'lpl10', 'spl1']);
    component.drop(dropEvent(component.showCards, component.hideCards, 0, 0), false);
    const sorted = ['blanket', 'lpl2', 'lpl10', 'spl1', 'spl4'];
    expect(component.hideCards.map(card => card.id)).toEqual(sorted);
    component.drop(dropEvent(component.hideCards, component.hideCards, 0, 4), false);
    expect(component.hideCards.map(card => card.id)).toEqual(sorted);
    component.selectHide(component.hideCards[1]);
    component.showSelected();
    expect(component.showCards.map(card => card.id)).toEqual(['lpl2']);
    component.showAll();
    expect(component.showCards.map(card => card.id)).toEqual(['lpl2', 'blanket', 'lpl10', 'spl1', 'spl4']);
    component.hideAll();
    expect(component.hideCards.map(card => card.id)).toEqual(sorted);
  });

  it('moves cards between Show and Hide and updates visibility', () => {
    const component = createComponent();

    component.drop(dropEvent(component.showCards, component.hideCards, 0, 1), false);
    component.drop(dropEvent(component.hideCards, component.showCards, 0, 0), true);

    expect(component.showCards.map((card) => card.id)).toEqual(['third', 'second']);
    expect(component.hideCards.map((card) => card.id)).toEqual(['first']);
    expect(component.visibility['first']).toBeFalse();
    expect(component.visibility['third']).toBeTrue();
  });

  it('does not move another card into Show when the maximum is reached', () => {
    const component = createComponent({ maxVisible: 2 });

    component.drop(dropEvent(component.hideCards, component.showCards, 0, 1), true);

    expect(component.showCards.map((card) => card.id)).toEqual(['first', 'second']);
    expect(component.hideCards.map((card) => card.id)).toEqual(['third']);
  });

  it('hides all in source order and clears selection without changing input', () => {
    const visibility = { third: false };
    const component = createComponent({ visibility });
    component.selectShow(component.showCards[0]);
    component.hideAll();
    expect(component.showCards).toEqual([]);
    expect(component.hideCards.map(card => card.id)).toEqual(['third', 'first', 'second']);
    expect(component.visibility).toEqual({ first: false, second: false, third: false });
    expect(visibility).toEqual({ third: false });
    expect(component.selectedShowId).toBeNull();
    expect(component.selectedHideId).toBeNull();
  });

  it('allows temporary transfers above the limit but blocks applying until corrected', () => {
    const component = createComponent({ minVisible: 1, maxVisible: 2, allowTemporaryOverLimit: true });
    expect(component.canEnterShow({ dropContainer: {} } as any, {} as any)).toBeTrue();
    component.drop(dropEvent(component.hideCards, component.showCards, 0, 1), true);
    expect(component.showCards.map(card => card.id)).toEqual(['first', 'third', 'second']);
    expect(component.canApply).toBeFalse();
    component.save();
    expect(close).not.toHaveBeenCalled();
    component.selectShow(component.showCards[0]);
    component.hideSelected();
    expect(component.canApply).toBeTrue();
    component.save();
    expect(close).toHaveBeenCalled();
  });

  it('allows arrow and bulk transfers beyond the limit while retaining minimum validation', () => {
    const component = createComponent({ minVisible: 2, maxVisible: 2, allowTemporaryOverLimit: true });
    component.selectHide(component.hideCards[0]);
    component.showSelected();
    expect(component.showCards.length).toBe(3);
    expect(component.canApply).toBeFalse();
    component.hideAll();
    expect(component.canApply).toBeFalse();
    expect(component.canShowAll).toBeTrue();
    component.showAll();
    expect(component.showCards.length).toBe(3);
    expect(component.canApply).toBeFalse();
    component.save();
    expect(close).not.toHaveBeenCalled();
  });

  it('shows all, preserves destination order and saves all IDs once', () => {
    const component = createComponent();
    component.selectHide(component.hideCards[0]);
    component.showAll();
    component.save();
    expect(component.hideCards).toEqual([]);
    expect(component.showCards.map(card => card.id)).toEqual(['first', 'second', 'third']);
    expect(component.selectedHideId).toBeNull();
    expect(close).toHaveBeenCalledWith({ visibility: { third: true }, order: ['first', 'second', 'third'] });
    expect(component.canShowAll).toBeFalse();
  });

  it('does not partially show all when there is insufficient capacity', () => {
    const component = createComponent({ visibility: { second: false, third: false }, maxVisible: 2 });
    expect(component.canShowMore).toBeTrue();
    expect(component.canShowAll).toBeFalse();
    component.showAll();
    expect(component.showCards.map(card => card.id)).toEqual(['first']);
    expect(component.hideCards.map(card => card.id)).toEqual(['second', 'third']);
  });

  it('allows show all at the maximum and validates exact counts after hide all', () => {
    const component = createComponent({ maxVisible: 3, exactVisible: 3 });
    expect(component.canShowAll).toBeTrue();
    component.showAll();
    expect(component.canApply).toBeTrue();
    component.hideAll();
    expect(component.canApply).toBeFalse();
    component.showAll();
    expect(component.canApply).toBeTrue();
  });

  it('respects the exact count even without a maximum', () => {
    const component = createComponent({ exactVisible: 2 });
    expect(component.canShowAll).toBeFalse();
    component.showAll();
    expect(component.showCards.length).toBe(2);
  });

  it('handles empty lists, label-only cards and cancelling bulk edits', () => {
    const visibility = { First: true, Second: false };
    const component = createComponent({ cards: [{ label: 'First' }, { label: 'Second' }], visibility });
    component.hideAll();
    component.hideAll();
    expect(component.hideCards.map(card => card.label)).toEqual(['Second', 'First']);
    component.showAll();
    component.showAll();
    expect(component.visibility).toEqual({ First: true, Second: true });
    component.cancel();
    expect(close).toHaveBeenCalledWith();
    expect(visibility).toEqual({ First: true, Second: false });
  });

  it('keeps edits after a failed save and allows retry', () => {
    const save = jasmine.createSpy('save').and.returnValues(throwError(() => new Error('offline')), of({}));
    const component = createComponent({ save, applyLabel: 'Save', description: '' });
    component.hideAll();
    component.save();
    expect(component.saveError).toContain('try again');
    expect(component.saving).toBeFalse();
    expect(component.showCards).toEqual([]);
    expect(component.description).toBe('');
    expect(close).not.toHaveBeenCalled();
    component.save();
    expect(close).toHaveBeenCalledWith({ visibility: { first: false, second: false, third: false }, order: ['third', 'first', 'second'] });
  });

  it('blocks duplicate saves and cancel while saving, and closes only on success', () => {
    const pending = new Subject();
    const save = jasmine.createSpy('save').and.returnValue(pending);
    const component = createComponent({ save });
    component.save();
    component.save();
    component.cancel();
    expect(save).toHaveBeenCalledTimes(1);
    expect(component.saving).toBeTrue();
    expect(close).not.toHaveBeenCalled();
    pending.next({});
    expect(close).toHaveBeenCalledTimes(1);
    expect(component.saving).toBeFalse();
  });

  it('handles synchronous save errors without losing edits', () => {
    const component = createComponent({ save: () => { throw new Error('offline'); } });
    component.save();
    expect(component.saving).toBeFalse();
    expect(component.saveError).toContain('try again');
    expect(close).not.toHaveBeenCalled();
  });

  it('returns visibility and stable card order when applied', () => {
    const component = createComponent();
    component.drop(dropEvent(component.showCards, component.showCards, 0, 1), true);

    component.save();

    expect(close).toHaveBeenCalledWith({
      visibility: { third: false },
      order: ['second', 'first', 'third'],
    });
  });
});
