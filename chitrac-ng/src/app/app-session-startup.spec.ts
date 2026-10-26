import { BehaviorSubject, of, throwError } from 'rxjs';
import { AppComponent } from './app.component';

describe('App session preference loading', () => {
  let app: AppComponent;
  let account: BehaviorSubject<any>;
  let settings: any;
  let users: any;
  beforeEach(() => {
    account = new BehaviorSubject(null);
    const defaults = { defaultTheme: 'light', showErrorModals: true };
    settings = {
      loadSettings: () => of(defaults), getSettings: () => defaults,
      clearUserPreferences: jasmine.createSpy('clear'),
      loadUserPreferences: jasmine.createSpy('preferences').and.returnValue(of({})),
      getUserTheme: jasmine.createSpy('theme').and.returnValue(of({ theme: 'light' })),
    };
    users = { user: account, getCurrentUser: jasmine.createSpy('session').and.returnValue(of(null)) };
    app = new AppComponent({ addClass() {}, removeClass() {} } as any, settings,
      { setShowErrorModals() {} } as any, users, { ensureConnected() {} } as any);
  });
  afterEach(() => app.ngOnDestroy());

  it('does not reload theme/preferences when the same account is revalidated', () => {
    app.ngOnInit();
    account.next({ username: 'admin', permissions: { level: 0 } });
    account.next({ username: 'admin', permissions: { level: 0 }, email: 'updated@example.test' });
    account.next({ username: 'admin', permissions: { level: 4 } });
    expect(settings.loadUserPreferences).toHaveBeenCalledTimes(1);
    expect(settings.getUserTheme).not.toHaveBeenCalled();
  });
  it('reloads preferences when changing accounts or signing in again after logout', () => {
    app.ngOnInit();
    account.next({ username: 'admin' }); account.next({ username: 'other' });
    account.next(null); account.next({ username: 'other' });
    expect(settings.loadUserPreferences).toHaveBeenCalledTimes(3);
    expect(settings.clearUserPreferences).toHaveBeenCalledTimes(2);
  });
  it('keeps public startup usable when session verification temporarily fails', () => {
    users.getCurrentUser.and.returnValue(throwError(() => new Error('offline')));
    expect(() => app.ngOnInit()).not.toThrow();
    expect(settings.loadUserPreferences).not.toHaveBeenCalled();
  });
});
