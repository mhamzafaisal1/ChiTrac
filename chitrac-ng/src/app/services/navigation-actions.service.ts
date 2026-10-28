import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/** Requests handled by the navigation shell, which owns the shared menus. */
@Injectable({ providedIn: 'root' })
export class NavigationActionsService {
  private readonly requests = new Subject<'settings' | 'authentication'>();
  readonly requests$ = this.requests.asObservable();

  openSettings(): void {
    this.requests.next('settings');
  }

  openAuthentication(): void {
    this.requests.next('authentication');
  }
}
