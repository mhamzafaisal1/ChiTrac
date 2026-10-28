import { ProductionScreenLayoutsService } from '../services/production-screen-layouts.service';
import { BreakpointObserver } from '@angular/cdk/layout';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { NavMainMenuComponent } from './nav-main-menu.component';
import { PermissionLevels } from '../user.service';

describe('NavMainMenuComponent Home actions', () => {
  let component: NavMainMenuComponent;
  let userService: any;
  let loginMenu: any;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: ProductionScreenLayoutsService, useValue: { state$: of({systemLayouts: [], userLayouts: [], loading: false, error: ''}), refresh() {} } },{
      provide: BreakpointObserver, useValue: { observe: () => of({ matches: false }) }
    }] });
    userService = jasmine.createSpyObj('UserService', ['hasPermissionLevel', 'logout']);
    userService.hasPermissionLevel.and.returnValue(true);
    component = TestBed.runInInjectionContext(() => new NavMainMenuComponent(
      userService, { url: '/ng/home' } as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any
    ));
    loginMenu = jasmine.createSpyObj('MatMenuTrigger', ['openMenu', 'closeMenu']);
    component.loginMenu = loginMenu;
  });

  it('opens the shared authentication popup without logging out', () => {
    component.user = { username: 'admin' };
    component['openAuthenticationMenu']();
    expect(loginMenu.openMenu).toHaveBeenCalled();
    expect(userService.logout).not.toHaveBeenCalled();
  });

  it('prompts anonymous users to log in, then opens Settings after successful login', () => {
    component['openSettingsMenu']();
    expect(loginMenu.openMenu).toHaveBeenCalled();
    component.user = { username: 'admin' };
    component.onAuthenticationMenuClosed();
    expect(component.shownMenu).toBe('settings');
    expect(userService.hasPermissionLevel).toHaveBeenCalledWith(PermissionLevels.settings, component.user);
    component.prevMenu();
    expect(component.shownMenu).toBe('main');
  });

  it('does not open Settings when login is dismissed or permission is missing', () => {
    component['openSettingsMenu']();
    component.onAuthenticationMenuClosed();
    expect(component.shownMenu).toBe('');
    component.user = { username: 'restricted' };
    userService.hasPermissionLevel.and.returnValue(false);
    component['openSettingsMenu']();
    expect(component.shownMenu).toBe('');
  });
});
