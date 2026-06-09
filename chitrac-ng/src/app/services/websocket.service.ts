import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export type WebsocketConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface DashboardCacheEnvelope {
  machinesSummary: any[];
  operatorsSummary: any[];
  updatedAt?: string;
  meta?: any;
}

export interface DashboardCachePayload {
  today?: DashboardCacheEnvelope;
  currentShift?: DashboardCacheEnvelope;
}

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {
  private socket: WebSocket | null = null;
  private readonly statusSubject = new BehaviorSubject<WebsocketConnectionStatus>('disconnected');
  private readonly messageSubject = new BehaviorSubject<string>('No websocket messages received.');
  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  private readonly dashboardCacheSubject = new BehaviorSubject<DashboardCachePayload | null>(null);
  private readonly sessionIdSubject = new BehaviorSubject<string | null>(null);

  readonly status$: Observable<WebsocketConnectionStatus> = this.statusSubject.asObservable();
  readonly message$: Observable<string> = this.messageSubject.asObservable();
  readonly error$: Observable<string | null> = this.errorSubject.asObservable();
  readonly dashboardCache$: Observable<DashboardCachePayload | null> = this.dashboardCacheSubject.asObservable();
  readonly sessionId$: Observable<string | null> = this.sessionIdSubject.asObservable();

  constructor(private zone: NgZone) {}

  ensureConnected(): void {
    this.connect();
  }

  getDashboardCacheSnapshot(): DashboardCachePayload | null {
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
        this.handleParsedMessage(event.data);
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

  private getWebsocketUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const hostname = window.location.hostname || 'localhost';
    return `${protocol}://${hostname}:50001`;
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

  private handleParsedMessage(data: unknown): void {
    if (typeof data !== 'string') {
      return;
    }

    try {
      const payload = JSON.parse(data);
      if (payload?.type === 'dashboard-cache' && payload.cache) {
        this.dashboardCacheSubject.next(payload.cache);
      }
      if (payload?.type === 'websocket-session' && payload.session?.id) {
        this.sessionIdSubject.next(payload.session.id);
      }
    } catch {
      return;
    }
  }
}
