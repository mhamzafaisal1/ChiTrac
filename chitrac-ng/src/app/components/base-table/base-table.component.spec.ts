import { haveSameColumns, reconcileColumnOrder } from './base-table.component';

describe('reconcileColumnOrder', () => {
  it('applies a saved order and appends new columns', () => {
    expect(reconcileColumnOrder(
      ['Status', 'Machine', 'Runtime', 'OEE'],
      ['Machine', 'Status', 'Runtime']
    )).toEqual(['Machine', 'Status', 'Runtime', 'OEE']);
  });

  it('removes duplicate and obsolete saved columns', () => {
    expect(reconcileColumnOrder(
      ['Status', 'Machine', 'Runtime'],
      ['Runtime', 'Removed', 'Runtime', 'Machine']
    )).toEqual(['Runtime', 'Machine', 'Status']);
  });

  it('uses the source column order when no preference exists', () => {
    expect(reconcileColumnOrder(
      ['Status', 'Operator', 'Efficiency'],
      []
    )).toEqual(['Status', 'Operator', 'Efficiency']);
  });
});

describe('haveSameColumns', () => {
  it('treats a new array with the same ordered columns as unchanged', () => {
    expect(haveSameColumns(
      ['Status', 'Machine', 'Runtime'],
      ['Status', 'Machine', 'Runtime']
    )).toBeTrue();
  });

  it('detects reordered, added, and removed columns', () => {
    expect(haveSameColumns(['Status', 'Machine'], ['Machine', 'Status'])).toBeFalse();
    expect(haveSameColumns(['Status'], ['Status', 'Machine'])).toBeFalse();
    expect(haveSameColumns(['Status', 'Machine'], ['Status'])).toBeFalse();
  });
});
