import { MachineConfig } from '../../shared/models/machine.model';

/** Defaults for the original SPF page; availability always comes from machine configuration. */
export const SPF_STATION_SERIALS = [90001, 90002, 90003, 90004, 90005, 90006] as const;
export interface ProductionStation { id: string; machineId: number; station: number; label: string; }
export interface SpfLayout { stationOrder: string[]; stationVisibility: Record<string, boolean>; }

export function configuredProductionStations(machines: MachineConfig[]): ProductionStation[] {
  const stations = new Map<string, ProductionStation>();
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

/** Serial-only layouts from the first SPF version refer to that machine's first station. */
export function resolveStationId(id: string, stations: ProductionStation[]): string | undefined {
  return stations.find(station => station.id === id)?.id ||
    stations.find(station => station.machineId === Number(id) && station.station === 1)?.id ||
    stations.find(station => station.machineId === Number(id))?.id;
}

/** Keep saved selections/order, hide new stations, and repair stale layouts to the 3–8 range. */
export function normalizeSpfLayout(layout: Partial<SpfLayout> | null | undefined, stations: ProductionStation[]): SpfLayout {
  const catalogIds = stations.map(station => station.id);
  const defaults = SPF_STATION_SERIALS.map(serial => resolveStationId(String(serial), stations)).filter((id): id is string => !!id);
  const sourceOrder = layout && Array.isArray(layout.stationOrder) ? layout.stationOrder : [...new Set([...defaults, ...catalogIds])].slice(0, 6);
  const savedIds = sourceOrder.map(id => resolveStationId(id, stations)).filter((id): id is string => !!id);
  const stationOrder = [...new Set([...savedIds, ...catalogIds])];
  const stationVisibility = Object.fromEntries(stationOrder.map(id => [id, false]));
  let count = 0;
  for (const rawId of sourceOrder) {
    const id = resolveStationId(rawId, stations);
    if (id && layout?.stationVisibility?.[rawId] !== false && !stationVisibility[id] && count < 8) {
      stationVisibility[id] = true; count++;
    }
  }
  for (const id of stationOrder) {
    if (count >= Math.min(3, stations.length)) break;
    if (!stationVisibility[id]) { stationVisibility[id] = true; count++; }
  }
  return { stationOrder, stationVisibility };
}
