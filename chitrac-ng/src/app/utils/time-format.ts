export type TimeFormat = '12h' | '24h';

export function formatDisplayTime(
  value: string | Date | number | null | undefined,
  timeFormat: TimeFormat = '12h',
  options: Intl.DateTimeFormatOptions = {}
): string {
  if (value == null || value === '') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    hour: timeFormat === '24h' ? '2-digit' : 'numeric',
    minute: '2-digit',
    ...options,
    hourCycle: timeFormat === '24h' ? 'h23' : 'h12',
  }).format(date);
}
