/** Display rules are based on configured machine type, never its name or serial. */
export const CASCADE_DASHBOARD_METRICS = ['Total Count', 'Misfeed Count', 'PPH', 'Throughput', 'Efficiency', 'OEE'] as const;
export const CASCADE_REPORT_METRICS = ['Total Count', 'PPH', 'Standard', 'Efficiency'] as const;
export const CASCADE_MODAL_TABS = ['Fault Summaries', 'Downtime Pareto', 'Fault History'] as const;

export function isCascadeMachine(machine: { type?: string } | null | undefined): boolean {
  return machine?.type?.trim().toLowerCase() === 'cascade';
}

export function presentMachineMetrics<T extends Record<string, any>>(
  row: T, machine: { type?: string } | null | undefined, columns: readonly string[]
): T {
  if (!isCascadeMachine(machine)) return row;
  return { ...row, ...Object.fromEntries(columns.map(column => [column, '—'])) };
}
