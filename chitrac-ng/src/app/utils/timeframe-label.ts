import type { ShiftListItem } from '../services/shift.service';
import type { DashboardCacheState } from '../services/websocket.service';

export function selectedTimeframeLabel(
  timeframe: string,
  shiftId: string,
  liveMode: boolean,
  shifts: ShiftListItem[] = [],
  cache?: DashboardCacheState
): string {
  if (shiftId) {
    const configuredName = shifts.find(shift => String(shift._id) === shiftId)?.name;
    if (configuredName?.trim()) return configuredName.trim();

    const metadata = [
      cache?.currentShift?.meta,
      ...(cache?.dashboard?.machines?.shifts || []).map(shift => shift.meta),
      ...(cache?.dashboard?.machines?.history?.shifts || []).map(shift => shift.meta),
      ...(cache?.dashboard?.operators?.shifts || []).map(shift => shift.meta),
      ...(cache?.dashboard?.operators?.history?.shifts || []).map(shift => shift.meta),
      cache?.activeShift,
    ];
    const match = metadata.find(value => String(value?.shiftId || '') === shiftId && value?.shift?.name?.trim());
    return match?.shift?.name.trim() || 'Shift';
  }

  const labels: Record<string, string> = {
    today: 'today', thisWeek: 'This Week', thisMonth: 'This Month', thisYear: 'This Year',
  };
  return labels[timeframe] || (liveMode && !timeframe ? 'today' : 'Custom');
}
