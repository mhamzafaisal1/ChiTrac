import { Location } from '@angular/common';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BehaviorSubject, filter, firstValueFrom } from 'rxjs';
import { User, UserService } from '../user.service';
import { ProductionLayoutReference } from './production-layout.models';
import { ProductionScreenNavigationService, restoreLegacyProductionLayout } from './production-screen-navigation.service';

@Component({ template: '' })
class TestRouteComponent {}

describe('Production Screen navigation', () => {
  const path = '/ng/production-screen';
  const system: ProductionLayoutReference = { scope: 'system', id: 'a'.repeat(64) };
  const personal: ProductionLayoutReference = { scope: 'user', id: 'b'.repeat(64) };
  let user: BehaviorSubject<User | null>;

  beforeEach(() => {
    user = new BehaviorSubject<User | null>({ username: 'alice' });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'ng/home', component: TestRouteComponent },
          {
            path: 'ng/production-screen',
            component: TestRouteComponent,
            canActivate: [restoreLegacyProductionLayout],
            runGuardsAndResolvers: 'paramsOrQueryParamsChange',
          },
        ]),
        { provide: UserService, useValue: { user } },
      ],
    });
  });

  it('switches and clears selections at the same clean URL', async () => {
    await RouterTestingHarness.create('/ng/home');
    const navigation = TestBed.inject(ProductionScreenNavigationService);
    const location = TestBed.inject(Location);
    const selections: unknown[] = [];
    const sub = navigation.selection$.subscribe(selection => selections.push(selection));
    try {
      await navigation.open(system);
      await navigation.open(personal);
      expect(location.path()).toBe(path);
      expect(location.getState()).toEqual(jasmine.objectContaining({
        productionLayout: { ...personal, owner: 'alice' },
      }));
      await navigation.clear();
      expect(location.path()).toBe(path);
      expect(selections).toEqual([null, system, personal, null]);
      await navigation.open(system);
      await navigation.open();
      expect(selections.slice(-2)).toEqual([system, null]);
      expect(location.path()).toBe(path);
    } finally {
      sub.unsubscribe();
    }
  });

  it('opens a legacy layout link and removes only the layout parameters', async () => {
    const harness = await RouterTestingHarness.create(path);
    await harness.navigateByUrl(path + '?layoutScope=user&layoutId=' + personal.id + '&display=wide#preview');
    expect(TestBed.inject(Location).path(true)).toBe(path + '?display=wide#preview');
    expect(await firstValueFrom(TestBed.inject(ProductionScreenNavigationService).selection$)).toEqual(personal);

    await harness.navigateByUrl(path + '?layoutScope=user');
    expect(TestBed.inject(Location).path()).toBe(path);
    expect(await firstValueFrom(TestBed.inject(ProductionScreenNavigationService).selection$)).toBe('invalid');
  });

  it('restores the selection when going forward to the Production Screen', async () => {
    await RouterTestingHarness.create('/ng/home');
    const router = TestBed.inject(Router);
    router.setUpLocationChangeListener();
    const location = TestBed.inject(Location);
    const navigation = TestBed.inject(ProductionScreenNavigationService);
    await navigation.open(system);
    await navigation.open(personal);

    const back = firstValueFrom(router.events.pipe(filter(event => event instanceof NavigationEnd)));
    location.back();
    await back;
    expect(location.path()).toBe('/ng/home');

    const forward = firstValueFrom(router.events.pipe(filter(event => event instanceof NavigationEnd)));
    location.forward();
    await forward;
    expect(location.path()).toBe(path);
    expect(await firstValueFrom(navigation.selection$)).toEqual(personal);
  });

  it('restores the same tab on initial navigation and drops a private selection on account change', async () => {
    const location = TestBed.inject(Location);
    const router = TestBed.inject(Router);
    location.replaceState(path, '', { productionLayout: { ...personal, owner: 'alice' }, navigationId: 5 });
    const navigated = firstValueFrom(router.events.pipe(filter(event => event instanceof NavigationEnd)));
    router.initialNavigation();
    await navigated;

    const selections: unknown[] = [];
    const sub = TestBed.inject(ProductionScreenNavigationService).selection$.subscribe(selection => selections.push(selection));
    try {
      expect(selections).toEqual([personal]);
      user.next({ username: 'bob' });
      expect(selections).toEqual([personal, null]);
      expect(location.getState()).toEqual(jasmine.objectContaining({ productionLayout: null }));
      user.next({ username: 'alice' });
      expect(selections.at(-1)).toBeNull();
    } finally {
      sub.unsubscribe();
    }
  });
});
