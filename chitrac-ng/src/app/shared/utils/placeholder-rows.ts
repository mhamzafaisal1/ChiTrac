/** Loading rows shown while a dashboard table waits for its first data. Each row is a separate object. */
export function placeholderRows(columns: readonly string[], count = 5): Record<string, any>[] {
  return Array.from({ length: count }, () => ({
    Status: '<div class="loading-spinner dummy-row">⏳</div>',
    ...Object.fromEntries(columns.map(column => [column, ''])),
    isDummy: true,
    cssClass: 'dummy-row',
  }));
}
