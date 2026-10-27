import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, Subject, combineLatest, merge, of } from 'rxjs';
import { catchError, distinctUntilChanged, map, shareReplay, startWith, switchMap, tap } from 'rxjs/operators';
import { UserService } from '../user.service';
import { SettingsService } from './settings.service';
import { NamedProductionLayout, ProductionLayoutLibrary, ProductionLayoutReference, ProductionLayoutView } from './production-layout.models';

export interface ProductionScreenMenuState {
  systemLayouts: NamedProductionLayout[];
  userLayouts: NamedProductionLayout[];
  loading: boolean;
  error: string;
}

@Injectable({ providedIn: 'root' })
export class ProductionScreenLayoutsService {
  private readonly refreshRequests = new Subject<void>();
  private readonly options = { headers: new HttpHeaders({ 'X-Skip-Error-Modal': 'true' }) };
  private readonly empty: ProductionScreenMenuState = { systemLayouts: [], userLayouts: [], loading: false, error: '' };
  readonly state$: Observable<ProductionScreenMenuState>;
  private last: ProductionScreenMenuState = this.empty;
  private lastAccount: string | null | undefined = undefined;

  constructor(private http: HttpClient, user: UserService, settings: SettingsService) {
    this.state$ = combineLatest([
      user.user.pipe(map(account => account?.username || null), distinctUntilChanged()),
      merge(of(undefined), this.refreshRequests, settings.productionLayoutsChanged$),
    ]).pipe(
      // Refreshes keep the current entries visible until the new list arrives, so the menu doesn't blink.
      // Account switches cancel outstanding requests and clear private entries immediately.
      switchMap(([account]) => {
        const previous = account === this.lastAccount ? this.last : { ...this.last, userLayouts: [] };
        this.lastAccount = account;
        const hasEntries = previous.systemLayouts.length + previous.userLayouts.length > 0;
        return this.http.get<ProductionLayoutLibrary>('/api/production-screen-layouts', this.options).pipe(
          map(library => {
            const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
            const group = (scope: 'system' | 'user') => library.layouts.filter(layout => layout.scope === scope)
              .sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
            return { systemLayouts: group('system'), userLayouts: account ? group('user') : [], loading: false, error: '' };
          }),
          catchError(() => of({ ...previous, loading: false, error: 'Could not load saved layouts.' })),
          startWith({ ...previous, loading: !hasEntries, error: '' }),
        );
      }),
      tap(state => this.last = state),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }

  refresh(): void { this.refreshRequests.next(); }

  read(reference: ProductionLayoutReference) {
    return this.http.get<ProductionLayoutView>(
      '/api/production-screen-layouts/' + reference.scope + '/' + encodeURIComponent(reference.id), this.options,
    );
  }
}
