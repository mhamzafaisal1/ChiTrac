const SPF_STATION_IDS = ['90001', '90002', '90003', '90004', '90005', '90006'];

function sanitizeSpfLayout(layout) {
  const fail = () => { const error = new Error('Invalid SPF layout. Select 3–6 of the supported SPF stations with a unique station order.'); error.status = 400; throw error; };
  if (!layout || typeof layout !== 'object' || Array.isArray(layout) ||
      Object.keys(layout).some(key => !['stationOrder', 'stationVisibility'].includes(key))) fail();
  const { stationOrder, stationVisibility } = layout;
  if (!Array.isArray(stationOrder) || stationOrder.length !== 6 || new Set(stationOrder).size !== 6 ||
      stationOrder.some(id => !SPF_STATION_IDS.includes(id))) fail();
  if (!stationVisibility || typeof stationVisibility !== 'object' || Array.isArray(stationVisibility) ||
      Object.entries(stationVisibility).some(([id, value]) => !SPF_STATION_IDS.includes(id) || typeof value !== 'boolean')) fail();
  const visibility = Object.fromEntries(SPF_STATION_IDS.map(id => [id, stationVisibility[id] !== false]));
  if (Object.values(visibility).filter(Boolean).length < 3) fail();
  return { stationOrder: [...stationOrder], stationVisibility: visibility };
}
module.exports = { SPF_STATION_IDS, sanitizeSpfLayout };
