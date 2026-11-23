import { DateTimeService } from './date-time.service';

describe('DateTimeService.applySelection', () => {
  it('sets range, shift and timeframe before live mode or confirm subscribers run', () => {
    const dates = new DateTimeService();
    dates.setShiftId('old-shift');
    dates.setTimeframe('today');
    const seenOnLive: string[] = [];
    const seenOnConfirm: string[] = [];
    dates.liveMode$.subscribe(() => seenOnLive.push(`${dates.getShiftId()}|${dates.getTimeframe()}|${dates.getStartTime()}`));
    dates.confirmTrigger$.subscribe(() => seenOnConfirm.push(`${dates.getShiftId()}|${dates.getConfirmed()}`));
    seenOnLive.length = 0; // ignore the replayed current value

    dates.applySelection({ start: '2026-11-20T06:00', end: '2026-11-20T14:30', live: true, shiftId: 'morning', timeframe: '' });

    expect(seenOnLive).toEqual(['morning||2026-11-20T06:00']);
    expect(seenOnConfirm).toEqual(['morning|true']);
    expect(dates.getEndTime()).toBe('2026-11-20T14:30');
  });
});
