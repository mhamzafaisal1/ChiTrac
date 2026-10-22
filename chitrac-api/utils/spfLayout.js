const SPF_STATION_IDS = ['90001', '90002', '90003', '90004', '90005', '90006'];
const STATION_ID_PATTERN = '^-?\\d+(?::-?\\d+)?$';

function configuredProductionStations(machines) {
  const stations = new Map();
  for (const machine of machines) {
    if (machine.active !== true || !Number.isSafeInteger(machine.id)) continue;
    for (const station of Array.isArray(machine.stations) ? machine.stations : []) {
      if (!Number.isSafeInteger(station)) continue;
      const id = machine.id + ':' + station;
      stations.set(id, { id, machineId: machine.id, station, label: (machine.name || 'Machine ' + machine.id) + ' — Station ' + station });
    }
  }
  return [...stations.values()].sort((a,b) => a.machineId - b.machineId || a.station - b.station);
}

/** Structural validation also accepts serial-only layouts saved by the original screen. */
function sanitizeSpfLayout(layout, availableStations) {
  const fail = () => { const error = new Error('Invalid production layout. Select 3–6 stations from active configured machines, with a unique station order.'); error.status = 400; throw error; };
  if (!layout || typeof layout !== 'object' || Array.isArray(layout) ||
      Object.keys(layout).some(key => !['stationOrder', 'stationVisibility'].includes(key))) fail();
  const { stationOrder, stationVisibility } = layout;
  const validId = id => typeof id === 'string' && id.length <= 40 && /^-?\d+(?::-?\d+)?$/.test(id) && id.split(':').every(part => Number.isSafeInteger(Number(part)) && String(Number(part)) === part);
  if (!Array.isArray(stationOrder) || stationOrder.length < 3 || stationOrder.length > 10000 || new Set(stationOrder).size !== stationOrder.length || stationOrder.some(id => !validId(id))) fail();
  if (!stationVisibility || typeof stationVisibility !== 'object' || Array.isArray(stationVisibility) || Object.keys(stationVisibility).length > 10000 ||
      Object.entries(stationVisibility).some(([id, value]) => !stationOrder.includes(id) || typeof value !== 'boolean')) fail();
  const resolve = id => {
    if (!availableStations) return id;
    return availableStations.find(station => station.id === id)?.id ||
      availableStations.find(station => station.machineId === Number(id) && station.station === 1)?.id ||
      availableStations.find(station => station.machineId === Number(id))?.id;
  };
  const order = [], visibility = {};
  for (const raw of stationOrder) {
    const id = resolve(raw);
    const shown = stationVisibility[raw] !== false;
    if (!id) { if (shown) fail(); else continue; }
    if (order.includes(id)) fail();
    order.push(id); visibility[id] = shown;
  }
  const count = Object.values(visibility).filter(Boolean).length;
  if (count < 3 || count > 6) fail();
  return { stationOrder: order, stationVisibility: visibility };
}
module.exports = { SPF_STATION_IDS, STATION_ID_PATTERN, configuredProductionStations, sanitizeSpfLayout };
