export type StatusLike = { code?: number | null; color?: string; name?: string } | null | undefined;

/**
 * Resolves status dot using color (when present), then code, then name.
 * Use this when the API may provide currentStatus with code, color, and/or name
 * (e.g. machine has color; operator often has only name when code is null).
 */
export function getStatusDot(status: StatusLike): string {
  if (status == null) return 'Offline Dot';

  const color = (status.color ?? '').toString().toLowerCase().trim();
  const name = (status.name ?? '').toString().toLowerCase().trim();
  const code = status.code;

  // 1. Prefer color when available and not "none"
  if (color && color !== 'none') {
    if (color === 'green') return 'Running Dot';
    if (color === 'yellow' || color === 'amber') return 'Paused Dot';
    if (color === 'red') return 'Faulted Dot';
  }

  // 2. Use code when it's a valid number
  if (typeof code === 'number') {
    if (code === 1) return 'Running Dot';
    if (code === 0) return 'Paused Dot';
    if (code > 1) return 'Faulted Dot';
  }

  // 3. Fallback to name (e.g. operator API often has name "Run" but code null)
  if (name) {
    if (name === 'run' || name === 'running') return 'Running Dot';
    if (name === 'paused' || name === 'timeout') return 'Paused Dot';
    if (/\b(fault|faulted|error|down|stop)\b/.test(name)) return 'Faulted Dot';
  }

  return 'Offline Dot';
}

export function getStatusDotByCode(code: number | undefined | null): string {
  return getStatusDot({ code });
}
