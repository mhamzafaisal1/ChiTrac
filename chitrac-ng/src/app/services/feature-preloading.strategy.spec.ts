import { fakeAsync, tick } from '@angular/core/testing';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { FeaturePreloadingStrategy } from './feature-preloading.strategy';

describe('Feature preloading', () => {
  const admin = { username: 'admin', permissions: { level: 0 } };
  let users: BehaviorSubject<any>;
  let strategy: FeaturePreloadingStrategy;
  beforeEach(() => {
    users = new BehaviorSubject(null);
    strategy = new FeaturePreloadingStrategy({
      user: users,
      hasPermissionLevel: (required: number, user: any) => user.permissions.level <= required,
    } as any);
  });

  it('does not download features for anonymous visitors or unmarked routes', fakeAsync(() => {
    const load = jasmine.createSpy().and.returnValue(of(null));
    strategy.preload({ data: { preload: true } }, load).subscribe();
    users.next(admin);
    strategy.preload({}, load).subscribe();
    tick(1000); expect(load).not.toHaveBeenCalled();
  }));

  it('warms permitted features after rendering, without a session REST call', fakeAsync(() => {
    users.next(admin);
    const load = jasmine.createSpy().and.returnValue(of(null));
    strategy.preload({ data: { preload: true, requiredPermissionLevel: 0 } }, load).subscribe();
    tick(999); expect(load).not.toHaveBeenCalled();
    tick(1); expect(load).toHaveBeenCalledTimes(1);
  }));

  it('skips restricted features and cancels delayed work on teardown', fakeAsync(() => {
    users.next({ username: 'viewer', permissions: { level: 7 } });
    const load = jasmine.createSpy().and.returnValue(of(null));
    strategy.preload({ data: { preload: true, requiredPermissionLevel: 0 } }, load).subscribe();
    users.next(admin);
    const work = strategy.preload({ data: { preload: true } }, load).subscribe();
    work.unsubscribe(); tick(1000); expect(load).not.toHaveBeenCalled();
  }));

  it('leaves failed chunk loads retryable by actual navigation', fakeAsync(() => {
    users.next(admin);
    let failed = false;
    strategy.preload({ data: { preload: true } }, () => throwError(() => new Error('offline')))
      .subscribe({ error: () => failed = true });
    tick(1000); expect(failed).toBeFalse();
  }));
  it('rechecks access if the account changes before the delayed load starts', fakeAsync(() => {
    users.next(admin);
    const load = jasmine.createSpy().and.returnValue(of(null));
    strategy.preload({ data: { preload: true, requiredPermissionLevel: 0 } }, load).subscribe();
    users.next({ username: 'viewer', permissions: { level: 7 } });
    tick(1000); expect(load).not.toHaveBeenCalled();
  }));
});
