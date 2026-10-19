import type { ShiftListItem } from '../services/shift.service';
import type { DashboardCacheState } from '../services/websocket.service';

export function selectedTimeframeLabel(
  timeframe: string,
  shiftId: string,
  liveMode: boolean,
  shifts: ShiftListItem[] = [],
  cache?: DashboardCacheState
): string {
  const labels: Record<string, string> = {
    today: 'Today', thisWeek: 'This Week', thisMonth: 'This Month', thisYear: 'This Year',
    yesterday: 'Yesterday', lastWeek: 'Last Week', lastMonth: 'Last Month', lastYear: 'Last Year',
  };
  const period = labels[timeframe] || (liveMode && !timeframe ? 'Today' : 'Custom');
  const withShift = (name: string) => timeframe ? `${period} - ${name}` : name;
  if (shiftId) {
    const configuredName = shifts.find(shift => String(shift._id) === shiftId)?.name;
    if (configuredName?.trim()) return withShift(configuredName.trim());

    const metadata = [
      cache?.currentShift?.meta,
      ...(cache?.dashboard?.machines?.shifts || []).map(shift => shift.meta),
      ...(cache?.dashboard?.machines?.history?.shifts || []).map(shift => shift.meta),
      ...(cache?.dashboard?.operators?.shifts || []).map(shift => shift.meta),
      ...(cache?.dashboard?.operators?.history?.shifts || []).map(shift => shift.meta),
      cache?.activeShift,
    ];
    const match = metadata.find(value => String(value?.shiftId || '') === shiftId && value?.shift?.name?.trim());
    return withShift(match?.shift?.name.trim() || 'Shift');
  }

  return period;
}
