const REPORT_COLUMNS = {
  machineReport: ['Machine', 'Total Time (Runtime)', 'Total Count', 'PPH', 'Standard', 'Efficiency'],
  operatorReport: ['Operator', 'Worked Time', 'Total Count', 'PPH', 'Standard', 'Efficiency'],
  itemReport: ['Item Name', 'Worked Time', 'Count Total', 'PPH', 'Standard', 'Efficiency']
};

function sanitizeReportLayouts(input) {
  const fail = () => {
    const error = new Error('Invalid reportLayouts. Expected supported report column-order arrays.');
    error.status = 400;
    throw error;
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail();
  const layouts = {};
  for (const [id, layout] of Object.entries(input)) {
    if (!Object.prototype.hasOwnProperty.call(REPORT_COLUMNS, id)) fail();
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) fail();
    if (Object.keys(layout).some(key => key !== 'columnOrder')) fail();
    const order = layout.columnOrder;
    if (!Array.isArray(order) || order.length > 40 || order.some(column => typeof column !== 'string')) fail();
    const known = order.map(column => column.trim()).filter(column => REPORT_COLUMNS[id].includes(column));
    layouts[id] = { columnOrder: [...new Set([...known, ...REPORT_COLUMNS[id]])] };
  }
  return layouts;
}

function reportLayoutUpdates(layouts = {}) {
  return Object.fromEntries(Object.entries(layouts).map(([id, layout]) => [`reportLayouts.${id}.columnOrder`, layout.columnOrder]));
}

module.exports = { sanitizeReportLayouts, reportLayoutUpdates };
