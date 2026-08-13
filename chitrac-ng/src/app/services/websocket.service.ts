import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

export type WebsocketConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type DashboardCacheScope = 'today' | 'currentShift';

export interface DashboardCacheEnvelope {
  machinesSummary?: any[];
  operatorsSummary?: any[];
  countSparkline?: any;
  data?: any;
  updatedAt?: string | Date;
  meta?: any;
}

export interface DashboardCacheState {
  today?: DashboardCacheEnvelope;
  currentShift?: DashboardCacheEnvelope;
  countSparkline?: any;
  dashboard?: {
    machines?: {
      today?: DashboardCacheEnvelope;
      shifts?: DashboardCacheEnvelope[];
      history?: {
        days?: DashboardCacheEnvelope[];
        shifts?: DashboardCacheEnvelope[];
        updatedAt?: string | Date;
        meta?: any;
      };
    };
    operators?: {
      today?: DashboardCacheEnvelope;
      shifts?: DashboardCacheEnvelope[];
      history?: {
        days?: DashboardCacheEnvelope[];
        shifts?: DashboardCacheEnvelope[];
        updatedAt?: string | Date;
        meta?: any;
      };
    };
    dailyAnalytics?: {
      today?: DashboardCacheEnvelope;
      shifts?: DashboardCacheEnvelope[];
    };
    counts?: {
      sparkline?: any;
    };
  };
}

interface DashboardCacheMessage {
  type: 'dashboard-cache-update' | 'dashboard-cache';
  scope?: DashboardCacheScope | 'all' | 'dashboard' | 'dashboardHistory' | 'countSparkline' | 'initial';
  cache?: DashboardCacheEnvelope | DashboardCacheState;
  dashboard?: DashboardCacheState['dashboard'];
}

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {
  private socket: WebSocket | null = null;
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private manualDisconnect = false;
  private readonly reconnectDelays = [10000, 20000, 30000];
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
    this.manualDisconnect = false;
    this.clearReconnectTimeout();

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    this.errorSubject.next(null);
    this.statusSubject.next('connecting');

    this.connectToCandidate(this.getWebsocketUrls(), 0);
  }

  private connectToCandidate(urls: string[], index: number): void {
    if (index >= urls.length) {
      this.socket = null;
      this.scheduleReconnect('Websocket connection error.');
      return;
    }

    const socket = new WebSocket(urls[index]);
    this.socket = socket;

    this.clearConnectTimeout();
    this.connectTimeout = setTimeout(() => {
      if (this.socket === socket && socket.readyState === WebSocket.CONNECTING) {
        this.tryNextCandidate(socket, urls, index, 'Websocket connection timed out.');
      }
    }, 5000);

    socket.onopen = () => {
      this.zone.run(() => {
        this.clearConnectTimeout();
        this.clearReconnectTimeout();
        this.reconnectAttempt = 0;
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
        this.tryNextCandidate(socket, urls, index, 'Websocket connection error.');
      });
    };

    socket.onclose = () => {
      this.zone.run(() => {
        if (this.socket !== socket) {
          return;
        }

        this.clearConnectTimeout();
        this.socket = null;

        if (this.manualDisconnect) {
          this.statusSubject.next('disconnected');
          return;
        }

        this.scheduleReconnect('Websocket disconnected.');
      });
    };
  }

  disconnect(): void {
    this.manualDisconnect = true;
    this.reconnectAttempt = 0;
    this.clearReconnectTimeout();

    if (!this.socket) {
      this.errorSubject.next(null);
      this.statusSubject.next('disconnected');
      return;
    }

    this.socket.close();
    this.socket = null;
    this.clearConnectTimeout();
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

  dailyAnalyticsDashboardData$(scope: DashboardCacheScope, shiftId?: string | null): Observable<any | null> {
    return this.dashboardCache$.pipe(
      map((cache) => this.resolveDailyAnalyticsEnvelope(cache, scope, shiftId)),
      map((envelope) => envelope?.data || null),
      distinctUntilChanged()
    );
  }

  private getWebsocketUrls(): string[] {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const hostname = window.location.hostname || 'localhost';
    const sameOrigin = `${protocol}://${window.location.host}/ws`;
    const legacyPort = `${protocol}://${hostname}:50001`;
    return Array.from(new Set([sameOrigin, legacyPort]));
  }

  private tryNextCandidate(socket: WebSocket, urls: string[], index: number, message: string): void {
    if (this.socket !== socket) {
      return;
    }

    this.clearConnectTimeout();
    this.socket = null;

    try {
      socket.close();
    } catch {
      // Ignore close failures while moving to the next candidate URL.
    }

    if (index + 1 < urls.length) {
      this.connectToCandidate(urls, index + 1);
      return;
    }

    this.scheduleReconnect(message);
  }

  private clearConnectTimeout(): void {
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private getReconnectDelay(attempt: number): number {
    return this.reconnectDelays[attempt - 1] || 60000;
  }

  private scheduleReconnect(message: string): void {
    if (this.manualDisconnect || this.reconnectTimeout) {
      return;
    }

    this.errorSubject.next(message);
    this.reconnectAttempt += 1;
    const attempt = this.reconnectAttempt;

    this.statusSubject.next(attempt >= 4 ? 'error' : 'disconnected');
    this.reconnectTimeout = setTimeout(() => {
      this.zone.run(() => {
        this.reconnectTimeout = null;
        this.connect();
      });
    }, this.getReconnectDelay(attempt));
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
        countSparkline: cache?.countSparkline || current.countSparkline,
        dashboard: message.dashboard || cache?.dashboard || current.dashboard
      });
      return;
    }

    if (message.scope === 'dashboard' || message.scope === 'dashboardHistory') {
      this.dashboardCacheSubject.next({
        ...current,
        countSparkline: cache?.countSparkline || current.countSparkline,
        dashboard: message.dashboard || cache?.dashboard || current.dashboard
      });
      return;
    }

    if (message.scope === 'countSparkline') {
      this.dashboardCacheSubject.next({
        ...current,
        countSparkline: cache?.countSparkline || current.countSparkline,
        today: cache?.today || current.today,
        currentShift: cache?.currentShift || current.currentShift,
        dashboard: message.dashboard || cache?.dashboard || current.dashboard
      });
      return;
    }

    if (message.scope === 'today' || message.scope === 'currentShift') {
      this.dashboardCacheSubject.next({
        ...current,
        [message.scope]: message.cache as DashboardCacheEnvelope,
        countSparkline: cache?.countSparkline || current.countSparkline,
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

  private resolveDailyAnalyticsEnvelope(
    cache: DashboardCacheState,
    scope: DashboardCacheScope,
    shiftId?: string | null
  ): DashboardCacheEnvelope | undefined {
    const dailyAnalytics = cache.dashboard?.dailyAnalytics;

    if (scope === 'today' || !shiftId) {
      return dailyAnalytics?.today;
    }

    return dailyAnalytics?.shifts?.find((shift) => shift?.meta?.shiftId === shiftId);
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
