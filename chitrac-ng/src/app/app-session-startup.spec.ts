import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { AppComponent } from './app.component';

describe('App session preference loading', () => {
  let app: AppComponent;
  let account: BehaviorSubject<any>;
  let settings: any;
  let users: any;
  let socket: any, router: any;
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
    socket = {ensureConnected: jasmine.createSpy('connect'), resetSession: jasmine.createSpy('reset')};
    router = {navigate: jasmine.createSpy('navigate').and.resolveTo(true)};
    app = new AppComponent({ addClass() {}, removeClass() {} } as any, settings,
      { setShowErrorModals() {} } as any, users, socket, router);
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
  it('connects public status before login and returns to it after logout', () => {
    app.ngOnInit();
    expect(socket.ensureConnected).toHaveBeenCalledWith('status');
    expect(socket.ensureConnected).not.toHaveBeenCalledWith();
    expect(router.navigate).not.toHaveBeenCalled();
    account.next({username:'admin'}); expect(socket.ensureConnected.calls.mostRecent().args).toEqual([]);
    account.next(null); expect(socket.ensureConnected.calls.mostRecent().args).toEqual(['status']);
    expect(router.navigate).toHaveBeenCalledWith(['/ng/home'], {replaceUrl:true});
  });
  it('connects public status without waiting for session verification to respond', () => {
    users.getCurrentUser.and.returnValue(new Subject());
    app.ngOnInit();
    expect(socket.ensureConnected.calls.first().args).toEqual(['status']);
  });
});
