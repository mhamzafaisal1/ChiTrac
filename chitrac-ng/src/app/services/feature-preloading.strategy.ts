import { Injectable } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { EMPTY, Observable, catchError, switchMap, take, timer } from 'rxjs';
import { User, UserService } from '../user.service';

@Injectable({ providedIn: 'root' })
export class FeaturePreloadingStrategy implements PreloadingStrategy {
  constructor(private readonly users: UserService) {}

  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (!route.data?.['preload']) return EMPTY;
    const permission = route.data?.['requiredPermissionLevel'];
    const allowed = (user: User | null) => !!user?.username &&
      (typeof permission !== 'number' || this.users.hasPermissionLevel(permission, user));
    return this.users.user.pipe(
      take(1),
      switchMap(user => {
        if (!allowed(user)) return EMPTY;
        // Let Home and the shared menus render before warming feature code.
        // Preloading never instantiates a page or fetches its business data.
        return timer(1000).pipe(
          switchMap(() => this.users.user.pipe(take(1))),
          switchMap(current => allowed(current) ? load() : EMPTY),
          catchError(() => EMPTY)
        );
      }),
    );
  }
}
