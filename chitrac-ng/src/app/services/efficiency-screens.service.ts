import { ProductionStation } from '../efficiency-screens/experimental-spf/spf-stations';
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';
import { ConfigurationService } from '../configuration.service';
import {
  ProductionEntity,
  ProductionStatsCache,
  ProductionWindowStats,
  WebsocketService
} from './websocket.service';

@Injectable({
  providedIn: 'root'
})
export class EfficiencyScreensService {
  constructor(
    private http: HttpClient,
    private websocketService: WebsocketService,
    private readonly configuration: ConfigurationService
  ) { }

  getLiveEfficiencySummary(serial: number, _date?: string): Observable<any> {
    this.websocketService.ensureConnected();
    return this.websocketService.dashboardCache$.pipe(
      filter(cache => !!cache.dashboard?.production),
      take(1),
      map(cache => ({
        flipperData: this.machineLanes(cache.dashboard?.production, serial),
        machineLane: this.machineLane(cache.dashboard?.production, serial),
        serial
      }))
    );
  }

  getMachineLiveEfficiencySummary(serial: number): Observable<{ flipperData: any[] }> {
    this.websocketService.ensureConnected();
    return this.websocketService.dashboardCache$.pipe(
      filter(cache => !!cache.dashboard?.production),
      take(1),
      map(cache => ({ flipperData: this.machineLanes(cache.dashboard?.production, serial) }))
    );
  }

  getOperatorEfficiency(serial: number, station: number): Observable<any> {
    this.websocketService.ensureConnected();
    return this.websocketService.dashboardCache$.pipe(
      filter(cache => !!cache.dashboard?.production),
      take(1),
      map(cache => {
        const lanes = this.machineLanes(cache.dashboard?.production, serial);
        return lanes.find(lane => Number(lane.station) === Number(station))
          || lanes.find(lane => lane.operator == null)
          || null;
      })
    );
  }

  /** Resolve an exact machine/station pair; never borrow an operator from another station. */
  getProductionStationSummaries(stations: ProductionStation[]): Observable<Record<string, any>> {
    this.websocketService.ensureConnected();
    return this.websocketService.dashboardCache$.pipe(
      filter(cache => !!cache.dashboard?.production), take(1),
      map(cache => {
        const production = cache.dashboard!.production!;
        return Object.fromEntries(stations.map(station => {
          const machine = production.machines[String(station.machineId)];
          const operator = (machine?.activeOperatorKeys || []).map(key => production.operators[key])
            .find(entity => entity?.operator?.station != null && Number(entity.operator.station) === station.station &&
              Number(entity.machine?.id ?? entity.machine?.serial) === station.machineId);
          const lane = operator ? this.toLane(operator, production.elapsedAsOf ?? production.updatedAt) : machine ? {
            ...this.toLane(machine, production.elapsedAsOf ?? production.updatedAt), operator: null, operatorId: null, efficiency: {}, oee: {},
          } : { status: -1, fault: 'Offline', operator: null, efficiency: {}, oee: {}, batch: {}, displayTimers: {} };
          return [station.id, { ...lane, serial: station.machineId, station: station.station, machine: station.label }];
        }));
      }),
    );
  }

  getSPFMachines(): Observable<any[]> {
    return this.configuration.getMachineConfigs().pipe(map(machines => machines
      .filter(machine => machine.active !== false && (/^SPF/i.test(machine.name || '') || machine.type === 'SPF'))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map(machine => ({ ...machine, serial: Number(machine.id ?? (machine as any).serial) }))));
  }

  private machineLanes(cache: ProductionStatsCache | undefined, serial: number): any[] {
    if (!cache) return [];
    const machine = cache.machines[String(serial)];
    if (!machine) return [];

    const activeOperators = (machine.activeOperatorKeys || [])
      .map(key => cache.operators[key])
      .filter((operator): operator is ProductionEntity => !!operator);
    if (activeOperators.length) {
      return activeOperators.map(operator => this.toLane(operator, cache.elapsedAsOf ?? cache.updatedAt));
    }
    return [this.toLane(machine, cache.elapsedAsOf ?? cache.updatedAt)];
  }

  private machineLane(cache: ProductionStatsCache | undefined, serial: number): any | null {
    if (!cache) return null;
    const machine = cache.machines[String(serial)];
    return machine ? this.toLane(machine, cache.elapsedAsOf ?? cache.updatedAt) : null;
  }

  private toLane(entity: ProductionEntity, elapsedAsOf?: string | Date): any {
    const status = Number(entity.status ?? -1);
    const statusSince = entity.statusSince || null;
    return {
      status,
      fault: entity.fault || (status === -1 ? 'Offline' : 'Unknown'),
      operator: entity.operator?.name || null,
      operatorId: entity.operator?.id ?? null,
      station: entity.operator?.station ?? null,
      serial: Number(entity.machine?.serial ?? entity.machine?.id),
      machine: entity.machine?.name || `Serial ${entity.machine?.serial ?? entity.machine?.id}`,
      latestFaultStart: status > 1 ? statusSince : null,
      latestPausedStart: status <= 0 ? statusSince : null,
      elapsedAsOf,
      timers: { on: 0, ready: 0 },
      displayTimers: { on: '', run: '' },
      efficiency: this.metricSlots(entity, 'efficiencyPercent'),
      oee: this.metricSlots(entity, 'oeePercent'),
      productionStats: entity.stats,
      batch: { item: entity.item?.name || '', code: entity.item?.id || 0 }
    };
  }

  private metricSlots(
    entity: ProductionEntity,
    metric: 'efficiencyPercent' | 'oeePercent'
  ): Record<string, { value: number | null; hasData: boolean; label: string }> {
    const slot = (key: string, label: string) => {
      const stats: ProductionWindowStats | undefined = entity.stats?.[key];
      return { value: stats?.[metric] ?? null, hasData: stats?.hasData === true, label };
    };
    return {
      lastSixMinutes: slot('lastSixMinutes', 'Last 6 Mins'),
      lastFifteenMinutes: slot('lastFifteenMinutes', 'Last 15 Mins'),
      lastHour: slot('lastHour', 'Last Hour'),
      today: slot('today', 'All Day'),
      last24Hours: slot('last24Hours', 'Last 24 Hours')
    };
  }
}
