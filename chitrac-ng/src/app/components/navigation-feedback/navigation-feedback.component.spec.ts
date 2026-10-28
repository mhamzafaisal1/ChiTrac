import { TestBed } from '@angular/core/testing';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationSkipped, NavigationStart, Router } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Subject } from 'rxjs';
import { NavigationFeedbackComponent } from './navigation-feedback.component';

describe('Navigation feedback', () => {
  let fixture: any;
  let events: Subject<any>;
  let router: any;
  beforeEach(() => {
    events = new Subject();
    router = { events, getCurrentNavigation: (): any => null, navigateByUrl: jasmine.createSpy('navigate').and.resolveTo(true) };
    TestBed.configureTestingModule({ imports: [NavigationFeedbackComponent], providers: [provideNoopAnimations(), { provide: Router, useValue: router }] });
    fixture = TestBed.createComponent(NavigationFeedbackComponent);
  });
  it('reacts immediately while a settings guard is pending and clears on completion', () => {
    events.next(new NavigationStart(1, '/ng/settings/items')); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('Loading settings');
    expect(fixture.nativeElement.querySelector('mat-spinner')).not.toBeNull();
    events.next(new NavigationEnd(1, '/ng/settings/items', '/ng/settings/items')); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
  });
  it('does not let an older cancellation hide a newer navigation', () => {
    events.next(new NavigationStart(1, '/ng/settings/items'));
    events.next(new NavigationStart(2, '/ng/settings/machines'));
    events.next(new NavigationCancel(1, '/ng/settings/items', 'superseded'));
    expect(fixture.componentInstance.pending()).toBeTrue();
    events.next(new NavigationCancel(2, '/ng/settings/machines', 'cancelled'));
    expect(fixture.componentInstance.pending()).toBeFalse();
  });
  it('offers Retry on navigation failure and removes stale errors when retry starts', () => {
    events.next(new NavigationStart(1, '/ng/settings/items?mode=all'));
    events.next(new NavigationError(1, '/ng/settings/items?mode=all', new Error('offline'))); fixture.detectChanges();
    expect(fixture.componentInstance.pending()).toBeFalse();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    fixture.nativeElement.querySelector('button').click();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/ng/settings/items?mode=all');
    events.next(new NavigationStart(2, '/ng/settings/items?mode=all')); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });
  it('clears feedback for skipped navigation and tracks an initial navigation already in progress', () => {
    fixture.destroy();
    router.getCurrentNavigation = () => ({ id: 4, initialUrl: { toString: () => '/ng/settings/profile' } });
    fixture = TestBed.createComponent(NavigationFeedbackComponent);
    expect(fixture.componentInstance.pending()).toBeTrue();
    events.next(new NavigationSkipped(4, '/ng/settings/profile', 'same URL'));
    expect(fixture.componentInstance.pending()).toBeFalse();
  });
});
