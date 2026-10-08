import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { MatDialogRef } from '@angular/material/dialog';
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

    return new SummaryCardVisibilityDialogComponent(
      { close } as unknown as MatDialogRef<SummaryCardVisibilityDialogComponent>,
      data
    );
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
