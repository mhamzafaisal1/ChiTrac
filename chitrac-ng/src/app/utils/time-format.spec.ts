import { formatDisplayTime } from './time-format';

describe('formatDisplayTime', () => {
  it('defaults to AM/PM regardless of browser locale', () => {
    expect(formatDisplayTime(new Date(2026, 9, 7, 13, 5))).toBe('1:05 PM');
  });

  it('formats noon and midnight without 0 AM or 24:00', () => {
    expect(formatDisplayTime(new Date(2026, 9, 7, 0))).toBe('12:00 AM');
    expect(formatDisplayTime(new Date(2026, 9, 7, 12))).toBe('12:00 PM');
    expect(formatDisplayTime(new Date(2026, 9, 7, 0), '24h')).toBe('00:00');
    expect(formatDisplayTime(new Date(2026, 9, 7, 13, 5), '24h')).toBe('13:05');
  });

  it('preserves explicit timezone and seconds options', () => {
    expect(formatDisplayTime('2026-10-07T18:05:09Z', '24h', {
      timeZone: 'America/Chicago', second: '2-digit'
    })).toBe('13:05:09');
  });

  it('handles missing or malformed dates', () => {
    expect(formatDisplayTime(null)).toBe('');
    expect(formatDisplayTime('invalid')).toBe('');
  });
});
