import { toDateTimeLocalInput } from './date-input';
import { placeholderRows } from './placeholder-rows';

describe('Shared table and date helpers', () => {
  it('formats local datetime-input values with zero padding', () => {
    expect(toDateTimeLocalInput(new Date(2026, 0, 5, 7, 3))).toBe('2026-01-05T07:03');
    expect(toDateTimeLocalInput(new Date(2026, 10, 20, 23, 59))).toBe('2026-11-20T23:59');
  });

  it('builds separate placeholder rows with every column blank', () => {
    const rows = placeholderRows(['Machine Name', 'OEE'], 3);
    expect(rows.length).toBe(3);
    expect(rows[0]).not.toBe(rows[1]);
    expect(Object.keys(rows[0])).toEqual(['Status', 'Machine Name', 'OEE', 'isDummy', 'cssClass']);
    expect(rows.every(row => row['isDummy'] === true && row['OEE'] === '')).toBeTrue();
  });
});
