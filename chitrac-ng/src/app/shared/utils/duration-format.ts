export interface DurationParts {
  hours?: number;
  minutes?: number;
  seconds?: number;
}

export function formatDurationSeconds(value: unknown): string {
  const totalSeconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatDurationMilliseconds(value: unknown): string {
  return formatDurationSeconds((Number(value) || 0) / 1000);
}

export function formatDurationParts(value: DurationParts | null | undefined): string {
  const hours = Math.max(0, Math.floor(Number(value?.hours) || 0));
  const minutes = Math.max(0, Math.floor(Number(value?.minutes) || 0));
  const seconds = Math.max(0, Math.floor(Number(value?.seconds) || 0));
  return formatDurationSeconds((hours * 3600) + (minutes * 60) + seconds);
}

export function parseDurationDisplay(value: unknown): number {
  const text = String(value ?? '');
  const hours = Number(text.match(/(\d+)h/)?.[1] ?? 0);
  const minutes = Number(text.match(/(\d+)m/)?.[1] ?? 0);
  const seconds = Number(text.match(/(\d+)s/)?.[1] ?? 0);
  return (hours * 3600) + (minutes * 60) + seconds;
}
