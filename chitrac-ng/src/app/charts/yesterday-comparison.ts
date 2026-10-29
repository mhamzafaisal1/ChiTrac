export interface PreviousDayComparison {
  date: string;
  value: number;
}

export function yesterdayMarker(previous: PreviousDayComparison | null | undefined, enabled: boolean): { endMarkerValue?: number } {
  return enabled && previous != null && Number.isFinite(previous.value) && previous.value >= 0
    ? { endMarkerValue: previous.value } : {};
}

export const YESTERDAY_MARKER_STYLE = { show: true, dash: '6,6', stroke: '#1e88e5', strokeWidth: 2 };

export function yesterdayTooltip(previous: PreviousDayComparison | null | undefined, percent = true): string {
  if (previous == null || !Number.isFinite(previous.value) || previous.value < 0) return 'Previous day: N/A';
  const value = previous.value.toLocaleString('en-US', { maximumFractionDigits: percent ? 2 : 0 });
  return `Previous day${previous.date ? ` (${previous.date})` : ''}: ${value}${percent ? '%' : ''}`;
}
