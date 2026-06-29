export function displayInteger(
  value: unknown,
  fallback: number | string = 0
): number | string {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.round(numericValue) : fallback;
}
