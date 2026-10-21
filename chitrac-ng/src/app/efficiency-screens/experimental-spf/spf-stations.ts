/** The six stations offered by the existing SPFs production screen. */
export const SPF_STATION_SERIALS = [90001, 90002, 90003, 90004, 90005, 90006] as const;
export const SPF_STATION_IDS = SPF_STATION_SERIALS.map(String);

export interface SpfLayout {
  stationOrder: string[];
  stationVisibility: Record<string, boolean>;
}

/** Repair stale or incomplete saved layouts without allowing an empty production screen. */
export function normalizeSpfLayout(layout?: Partial<SpfLayout> | null): SpfLayout {
  const order = Array.isArray(layout?.stationOrder) ? layout.stationOrder : [];
  const stationOrder = [...new Set([...order.filter(id => SPF_STATION_IDS.includes(id)), ...SPF_STATION_IDS])];
  const stationVisibility = Object.fromEntries(stationOrder.map(id => [id, layout?.stationVisibility?.[id] !== false]));
  let count = stationOrder.filter(id => stationVisibility[id]).length;
  for (const id of stationOrder) {
    if (count >= 3) break;
    if (!stationVisibility[id]) { stationVisibility[id] = true; count++; }
  }
  return { stationOrder, stationVisibility };
}
