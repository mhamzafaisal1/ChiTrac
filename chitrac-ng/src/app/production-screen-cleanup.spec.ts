import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { routes } from './app.routes';
import { AuthGuard } from './guards/auth.guard';
import { legacyProductionRoutes } from './production-screen-legacy.routes';
import { RetiredProductionScreenComponent } from './retired-production-screen/retired-production-screen.component';
import { NavigationMenu, navigationEntries } from './services/navigation-menu';
import { UserService } from './user.service';

@Component({ standalone: true, template: '<h1>Production Screens menu</h1>' })
class HomeStub {}

describe('Production screen archival and navigation compatibility', () => {
  let account: any;
  beforeEach(() => {
    account = { username: 'admin', permissions: { level: 0 } };
    TestBed.configureTestingModule({ providers: [
      provideNoopAnimations(),
      provideRouter(routes.map(route => route.path === 'ng/home' ? { path: route.path, component: HomeStub } : route)),
      { provide: UserService, useValue: {
        getCurrentUser: () => of(account), hasPermissionLevel: () => true,
      } },
    ] });
  });

  it('preserves every navigation-menu destination as an active page with its guard', () => {
    const menus: NavigationMenu[] = ['main', 'dashboards', 'experimental', 'productionScreens', 'reports', 'settings'];
    for (const menu of menus) {
      for (const entry of navigationEntries(menu, () => true).filter(entry => entry.path)) {
        const route = routes.find(route => '/' + route.path === entry.path);
        expect(route).withContext(entry.path!).toBeDefined();
        expect(route!.data?.['previousScreen']).withContext(entry.path!).toBeUndefined();
        expect(!!route!.component || !!route!.loadComponent).withContext(entry.path!).toBeTrue();
        if (entry.path !== '/ng/home') expect(route!.canActivate).withContext(entry.path!).toContain(AuthGuard);
      }
    }
    // Keep the QA tool even though it has no menu entry.
    expect(routes.find(route => route.path === 'ng/test')?.loadComponent).toBeDefined();
  });

  for (const legacy of legacyProductionRoutes) {
    it(`keeps /${legacy.path} guarded and opens layout selection without choosing different machines`, async () => {
      const url = '/' + legacy.path!.replace(':line', 'lpl2');
      const route = routes.find(route => route.path === legacy.path)!;
      expect(route.canActivate).toContain(AuthGuard);
      expect(route.component).toBeUndefined();
      const harness = await RouterTestingHarness.create(url);
      expect(harness.routeDebugElement!.componentInstance).toBeInstanceOf(RetiredProductionScreenComponent);
      expect(harness.routeNativeElement!.textContent).toContain('has moved');
      const link = harness.routeNativeElement!.querySelector('a') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/ng/home?menu=productionScreens');
      link.click(); await harness.fixture.whenStable();
      expect(TestBed.inject(Router).url).toBe('/ng/home?menu=productionScreens');
    });
  }

  it('requires authentication on a bookmarked old display URL', async () => {
    account = null;
    await RouterTestingHarness.create('/ng/lpl-efficiency-screen/lpl2');
    expect(TestBed.inject(Router).url).toBe('/ng/home?returnUrl=%2Fng%2Flpl-efficiency-screen%2Flpl2');
  });
});
