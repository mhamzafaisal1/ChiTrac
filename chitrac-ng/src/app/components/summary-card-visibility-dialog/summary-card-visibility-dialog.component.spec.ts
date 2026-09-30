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
