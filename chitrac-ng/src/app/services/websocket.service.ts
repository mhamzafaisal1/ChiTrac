import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export type WebsocketConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {
  private socket: WebSocket | null = null;
  private readonly statusSubject = new BehaviorSubject<WebsocketConnectionStatus>('disconnected');
  private readonly messageSubject = new BehaviorSubject<string>('No websocket messages received.');
  private readonly errorSubject = new BehaviorSubject<string | null>(null);

  readonly status$: Observable<WebsocketConnectionStatus> = this.statusSubject.asObservable();
  readonly message$: Observable<string> = this.messageSubject.asObservable();
  readonly error$: Observable<string | null> = this.errorSubject.asObservable();

  constructor(private zone: NgZone) {}

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
}
