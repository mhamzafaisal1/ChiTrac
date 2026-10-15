export type ReportLayoutId = 'machineReport' | 'operatorReport' | 'itemReport';

export const REPORT_COLUMNS: Record<ReportLayoutId, readonly string[]> = {
  machineReport: ['Machine', 'Total Time (Runtime)', 'Total Count', 'PPH', 'Standard', 'Efficiency'],
  operatorReport: ['Operator', 'Worked Time', 'Total Count', 'PPH', 'Standard', 'Efficiency'],
  itemReport: ['Item Name', 'Worked Time', 'Count Total', 'PPH', 'Standard', 'Efficiency']
};

export function reconcileReportColumns(id: ReportLayoutId, saved: readonly string[] = []): string[] {
  const defaults = REPORT_COLUMNS[id];
  const known = saved.filter(column => defaults.includes(column));
  return [...new Set([...known, ...defaults])];
}

export function reportCsvColumns(id: ReportLayoutId, order: readonly string[]): string[] {
  const identity = REPORT_COLUMNS[id][0];
  return order.flatMap(column => id !== 'itemReport' && column === identity ? [identity, 'Item'] : [column]);
}

export function reportPdfTable(id: ReportLayoutId, order: readonly string[], rows: Record<string, any>[]) {
  const identity = REPORT_COLUMNS[id][0];
  const grouped = id !== 'itemReport';
  return {
    head: [order.map(column => grouped && column === identity ? `${identity}/Item` : column)],
    body: rows.map(row => order.map(column => grouped && column === identity
      ? `${row[identity]} / ${row['Item']}` : row[column])),
    identityIndex: order.indexOf(identity)
  };
}

export function reportCsv(columns: readonly string[], rows: Record<string, any>[]): string {
  const escape = (value: any) => {
    const text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.map(escape).join(','), ...rows.map(row => columns.map(column => escape(row[column])).join(','))].join('\n');
}
