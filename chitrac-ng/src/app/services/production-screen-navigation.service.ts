import { Location } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { CanActivateFn, NavigationEnd, RedirectCommand, Router, UrlTree } from '@angular/router';
import { combineLatest, distinctUntilChanged, filter, firstValueFrom, map, startWith, take } from 'rxjs';
import { UserService } from '../user.service';
import { ProductionLayoutReference } from './production-layout.models';

const productionScreen = '/ng/production-screen';
type LayoutSelection = ProductionLayoutReference | 'invalid' | null;
type StoredSelection = (ProductionLayoutReference & { owner?: string }) | 'invalid' | null;
interface LayoutHistoryState {
  productionLayout?: StoredSelection;
}

function layoutReference(scope: unknown, id: unknown): ProductionLayoutReference | 'invalid' {
  if ((scope === 'system' || scope === 'user') && typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)) {
    return { scope, id };
  }
  return 'invalid';
}

function layoutState(selection: LayoutSelection, account?: string): LayoutHistoryState {
  if (!selection || selection === 'invalid') return { productionLayout: selection };
  const { scope, id } = selection;
  return { productionLayout: scope === 'user' ? { scope, id, owner: account } : { scope, id } };
}

export const restoreLegacyProductionLayout: CanActivateFn = (route, state) => {
  const params = route.queryParamMap;
  if (!params.has('layoutScope') && !params.has('layoutId')) return true;

  const router = inject(Router);
  const user = inject(UserService);
  const url = router.parseUrl(state.url);
  const queryParams = { ...url.queryParams };
  delete queryParams['layoutScope'];
  delete queryParams['layoutId'];
  const clean = new UrlTree(url.root, queryParams, url.fragment);
  const selection = layoutReference(params.get('layoutScope'), params.get('layoutId'));

  return user.user.pipe(take(1), map(account =>
    new RedirectCommand(clean, {
      onSameUrlNavigation: 'reload',
      replaceUrl: true,
      state: layoutState(selection, account?.username),
    }),
  ));
};

@Injectable({ providedIn: 'root' })
export class ProductionScreenNavigationService {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly user = inject(UserService);

  readonly selection$ = combineLatest([
    this.router.events.pipe(filter(event => event instanceof NavigationEnd), startWith(null)),
    this.user.user.pipe(map(account => account?.username), distinctUntilChanged()),
  ]).pipe(
    map(([, account]) => ({ account, selection: this.readSelection(account) })),
    distinctUntilChanged((previous, current) => {
      if (previous.account !== current.account) return false;
      const a = previous.selection;
      const b = current.selection;
      return a === b || (!!a && !!b && a !== 'invalid' && b !== 'invalid' && a.scope === b.scope && a.id === b.id);
    }),
    map(({ selection }) => selection),
  );

  async open(reference: ProductionLayoutReference | null = null): Promise<boolean> {
    const account = reference?.scope === 'user' ? await firstValueFrom(this.user.user) : null;
    return this.router.navigateByUrl(productionScreen, {
      onSameUrlNavigation: 'reload',
      state: layoutState(reference, account?.username),
    });
  }

  clear(): Promise<boolean> {
    return this.router.navigateByUrl(this.router.url, {
      onSameUrlNavigation: 'reload',
      replaceUrl: true,
      state: layoutState(null),
    });
  }

  private readSelection(account?: string): LayoutSelection {
    const state = this.location.getState() as LayoutHistoryState | null;
    const selection = state?.productionLayout;
    if (!selection || selection === 'invalid') return selection ?? null;
    if (selection.scope === 'user' && (!account || selection.owner !== account)) {
      this.location.replaceState(this.location.path(true), '', { ...state, ...layoutState(null) });
      return null;
    }
    return layoutReference(selection.scope, selection.id);
  }
}
