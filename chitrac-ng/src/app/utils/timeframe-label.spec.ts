import { selectedTimeframeLabel } from './timeframe-label';

describe('selectedTimeframeLabel', () => {
  it('labels default and explicitly selected Today consistently', () => {
    expect(selectedTimeframeLabel('', '', true)).toBe('today');
    expect(selectedTimeframeLabel('today', '', false)).toBe('today');
  });

  it('labels a custom range and the existing calendar presets', () => {
    expect(selectedTimeframeLabel('', '', false)).toBe('Custom');
    expect(selectedTimeframeLabel('thisWeek', '', false)).toBe('This Week');
    expect(selectedTimeframeLabel('thisMonth', '', false)).toBe('This Month');
    expect(selectedTimeframeLabel('thisYear', '', false)).toBe('This Year');
  });

  it('shows the selected shift instead of a different active shift', () => {
    expect(selectedTimeframeLabel('', 'selected', false, [
      { _id: 'selected', id: 1, name: 'Afternoon Shift' }
    ], { activeShift: { shiftId: 'other', shift: { name: 'Morning Shift' }, mode: 'current' } }))
      .toBe('Afternoon Shift');
  });

  it('can resolve a historical shift from matching dashboard metadata', () => {
    expect(selectedTimeframeLabel('', 'historical', false, [], {
      dashboard: { machines: { history: { shifts: [
        { meta: { shiftId: 'historical', shift: { name: 'Previous Shift' } } }
      ] } } }
    })).toBe('Previous Shift');
  });

  it('uses a neutral fallback when a selected shift cannot be resolved', () => {
    expect(selectedTimeframeLabel('', 'missing', false)).toBe('Shift');
  });
});
