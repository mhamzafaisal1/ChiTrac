import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';
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
    private websocketService: WebsocketService
  ) { }

  getLiveEfficiencySummary(serial: number, _date?: string): Observable<any> {
    this.websocketService.ensureConnected();
    return this.websocketService.dashboardCache$.pipe(
      filter(cache => !!cache.dashboard?.production),
      take(1),
      map(cache => ({ flipperData: this.machineLanes(cache.dashboard?.production, serial), serial }))
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

  getSPFMachines(): Observable<any[]> {
    return this.http.get<any[]>('/api/machine/spf');
  }

  private machineLanes(cache: ProductionStatsCache | undefined, serial: number): any[] {
    if (!cache) return [];
    const machine = cache.machines[String(serial)];
    if (!machine) return [];

    const activeOperators = (machine.activeOperatorKeys || [])
      .map(key => cache.operators[key])
      .filter((operator): operator is ProductionEntity => !!operator);
    if (activeOperators.length) {
      return activeOperators.map(operator => this.toLane(operator));
    }
    return [this.toLane(machine)];
  }

  private toLane(entity: ProductionEntity): any {
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
