const Ajv = require('ajv');
const { problem } = require('./productionLayouts');

const chartIds = [
  'machine-status', 'machine-timeline', 'machine-oee', 'item-totals',
  'machine-group-efficiency', 'top-operators', 'daily-counts'
];
const idPattern = '^[a-f0-9]{64}$';
const layoutSchema = {
  type: 'object',
  required: ['gridLayout', 'chartOrder', 'chartVisibility'],
  additionalProperties: false,
  properties: {
    gridLayout: { enum: ['3x2', '2x2'] },
    chartOrder: {
      type: 'array', minItems: 1, maxItems: chartIds.length,
      uniqueItems: true, items: { enum: chartIds }
    },
    chartVisibility: {
      type: 'object', additionalProperties: false,
      properties: Object.fromEntries(chartIds.map(id => [id, { type: 'boolean' }]))
    }
  }
};
const librarySchema = {
  type: 'object', propertyNames: { pattern: idPattern },
  additionalProperties: {
    type: 'object', required: ['id', 'name', 'layout', 'createdAt'], additionalProperties: false,
    properties: {
      id: { type: 'string', pattern: idPattern },
      name: { type: 'string', minLength: 1, maxLength: 80 },
      layout: layoutSchema,
      createdAt: { type: 'string', format: 'date-time' }
    }
  }
};
const validate = new Ajv().compile(layoutSchema);

function sanitizeDailyLayout(input) {
  if (!validate(input)) throw problem(400, 'Choose a valid daily chart order, visibility and grid size.');
  // Preserve older selections when charts are added; new charts start hidden.
  const chartOrder = [...input.chartOrder, ...chartIds.filter(id => !input.chartOrder.includes(id))];
  const chartVisibility = Object.fromEntries(chartOrder.map(id => [id,
    input.chartOrder.includes(id) && input.chartVisibility[id] === true
  ]));
  const visible = chartOrder.filter(id => chartVisibility[id]).length;
  if (visible !== (input.gridLayout === '2x2' ? 4 : 6)) {
    throw problem(400, 'Choose exactly four charts for 2×2 or six charts for 3×2.');
  }
  return {
    gridLayout: input.gridLayout,
    chartOrder,
    chartVisibility
  };
}

module.exports = { chartIds, layoutSchema, librarySchema, sanitizeDailyLayout };
