import { Injectable } from '@angular/core';
import { defer, Observable } from 'rxjs';
import { distinctUntilChanged, filter, map, take, timeout } from 'rxjs/operators';
import { ConfigurationCacheState, WebsocketService } from './websocket.service';

@Injectable({ providedIn: 'root' })
export class ConfigurationCacheService {
  constructor(private readonly websocket: WebsocketService) {}

  watch<T>(key: string): Observable<T[]> {
    return defer(() => {
      this.websocket.ensureConnected();
      return this.websocket.configurationCache$.pipe(
        filter((cache): cache is ConfigurationCacheState => cache !== null),
        map(cache => cache.collections[cache.names[key] || key]),
        filter((rows): rows is any[] => Array.isArray(rows)),
        timeout({ first: 15000 }),
        distinctUntilChanged(),
        // Editors must never mutate the shared snapshot before a successful save.
        map(rows => structuredClone(rows) as T[])
      );
    });
  }

  read<T>(key: string): Observable<T[]> {
    // HTTP-compatible completing reads keep forkJoin/finalize callers working.
    return this.watch<T>(key).pipe(take(1));
  }
}
