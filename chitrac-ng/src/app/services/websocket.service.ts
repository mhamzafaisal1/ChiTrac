import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

export type WebsocketConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type DashboardCacheScope = 'today' | 'currentShift';

export interface DashboardCacheEnvelope {
  machinesSummary?: any[];
  operatorsSummary?: any[];
  updatedAt?: string | Date;
  meta?: any;
}

export interface DashboardCacheState {
  today?: DashboardCacheEnvelope;
  currentShift?: DashboardCacheEnvelope;
  dashboard?: {
    machines?: {
      today?: DashboardCacheEnvelope;
      shifts?: DashboardCacheEnvelope[];
    };
    operators?: {
      today?: DashboardCacheEnvelope;
      shifts?: DashboardCacheEnvelope[];
    };
  };
}

interface DashboardCacheMessage {
  type: 'dashboard-cache-update' | 'dashboard-cache';
  scope?: DashboardCacheScope | 'all' | 'dashboard' | 'initial';
  cache?: DashboardCacheEnvelope | DashboardCacheState;
  dashboard?: DashboardCacheState['dashboard'];
}

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {
  private socket: WebSocket | null = null;
  private readonly statusSubject = new BehaviorSubject<WebsocketConnectionStatus>('disconnected');
  private readonly messageSubject = new BehaviorSubject<string>('No websocket messages received.');
  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  private readonly dashboardCacheSubject = new BehaviorSubject<DashboardCacheState>({});
  private readonly sessionIdSubject = new BehaviorSubject<string | null>(null);

  readonly status$: Observable<WebsocketConnectionStatus> = this.statusSubject.asObservable();
  readonly message$: Observable<string> = this.messageSubject.asObservable();
  readonly error$: Observable<string | null> = this.errorSubject.asObservable();
  readonly dashboardCache$: Observable<DashboardCacheState> = this.dashboardCacheSubject.asObservable();
  readonly sessionId$: Observable<string | null> = this.sessionIdSubject.asObservable();

  constructor(private zone: NgZone) {}

  ensureConnected(): void {
    this.connect();
  }

  getDashboardCacheSnapshot(): DashboardCacheState {
    return this.dashboardCacheSubject.getValue();
  }

  connect(): void {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    this.errorSubject.next(null);
    this.statusSubject.next('connecting');

    const socket = new WebSocket(this.getWebsocketUrl());
    this.socket = socket;

    socket.onopen = () => {
      this.zone.run(() => {
        this.statusSubject.next('connected');
        this.send({
          type: 'server-info-request',
          timestamp: new Date().toISOString()
        });
      });
    };

    socket.onmessage = (event) => {
      this.zone.run(() => {
        this.handleMessage(event.data);
        this.messageSubject.next(this.formatMessage(event.data));
      });
    };

    socket.onerror = () => {
      this.zone.run(() => {
        this.errorSubject.next('Websocket connection error.');
        this.statusSubject.next('error');
      });
    };

    socket.onclose = () => {
      this.zone.run(() => {
        if (this.socket === socket) {
          this.socket = null;
        }

        if (this.statusSubject.value !== 'error') {
          this.statusSubject.next('disconnected');
        }
      });
    };
  }

  disconnect(): void {
    if (!this.socket) {
      this.errorSubject.next(null);
      this.statusSubject.next('disconnected');
      return;
    }

    this.socket.close();
    this.socket = null;
    this.errorSubject.next(null);
    this.statusSubject.next('disconnected');
  }

  send(payload: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.errorSubject.next('Websocket is not connected.');
      return;
    }

    const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.socket.send(message);
  }

  dashboardCacheScope$(scope: DashboardCacheScope): Observable<DashboardCacheEnvelope | undefined> {
    return this.dashboardCache$.pipe(
      map((cache) => cache[scope]),
      distinctUntilChanged()
    );
  }

  machineDashboardData$(scope: DashboardCacheScope, shiftId?: string | null): Observable<any[]> {
    return this.dashboardCache$.pipe(
      map((cache) => this.resolveDashboardEnvelope(cache, 'machines', scope, shiftId)),
      map((envelope) => Array.isArray(envelope?.machinesSummary) ? envelope.machinesSummary : [])
    );
  }

  operatorDashboardData$(scope: DashboardCacheScope, shiftId?: string | null): Observable<any[]> {
    return this.dashboardCache$.pipe(
      map((cache) => this.resolveDashboardEnvelope(cache, 'operators', scope, shiftId)),
      map((envelope) => Array.isArray(envelope?.operatorsSummary) ? envelope.operatorsSummary : [])
    );
  }

  private getWebsocketUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const hostname = window.location.hostname || 'localhost';
    return `${protocol}://${hostname}:50001`;
  }

  private handleMessage(data: unknown): void {
    const parsed = this.parseMessage(data);
    if (!parsed) return;

    if ((parsed.type === 'dashboard-cache-update' || parsed.type === 'dashboard-cache') && parsed.cache) {
      this.storeDashboardCache(parsed as DashboardCacheMessage);
    }

    if (parsed.type === 'websocket-session' && parsed.session?.id) {
      this.sessionIdSubject.next(parsed.session.id);
    }
  }

  private storeDashboardCache(message: DashboardCacheMessage): void {
    const current = this.dashboardCacheSubject.value;
    const cache = message.cache as DashboardCacheState | undefined;

    if (message.scope === 'all' || message.scope === 'initial' || message.type === 'dashboard-cache') {
      this.dashboardCacheSubject.next({
        today: cache?.today || current.today,
        currentShift: cache?.currentShift || current.currentShift,
        dashboard: message.dashboard || cache?.dashboard || current.dashboard
      });
      return;
    }

    if (message.scope === 'dashboard') {
      this.dashboardCacheSubject.next({
        ...current,
        dashboard: message.dashboard || cache?.dashboard || current.dashboard
      });
      return;
    }

    if (message.scope === 'today' || message.scope === 'currentShift') {
      this.dashboardCacheSubject.next({
        ...current,
        [message.scope]: message.cache as DashboardCacheEnvelope,
        dashboard: message.dashboard || current.dashboard
      });
    }
  }

  private resolveDashboardEnvelope(
    cache: DashboardCacheState,
    dashboard: 'machines' | 'operators',
    scope: DashboardCacheScope,
    shiftId?: string | null
  ): DashboardCacheEnvelope | undefined {
    const dashboardCache = cache.dashboard?.[dashboard];

    if (scope === 'today' || !shiftId) {
      return dashboardCache?.today || cache.today;
    }

    return dashboardCache?.shifts?.find((shift) => shift?.meta?.shiftId === shiftId) || cache.currentShift;
  }

  private parseMessage(data: unknown): any | null {
    if (typeof data !== 'string') {
      return null;
    }

    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  private formatMessage(data: unknown): string {
    if (typeof data !== 'string') {
      return String(data);
    }

    try {
      return JSON.stringify(JSON.parse(data), null, 2);
    } catch {
      return data;
    }
  }
}
