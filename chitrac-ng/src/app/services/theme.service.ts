import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, distinctUntilChanged } from 'rxjs';

/**
 * Single source for the light/dark theme applied as a class on <body>.
 * Replaces one MutationObserver per component with one for the whole app.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService implements OnDestroy {
  private readonly darkSubject = new BehaviorSubject<boolean>(ThemeService.readBodyTheme());
  readonly isDark$: Observable<boolean> = this.darkSubject.pipe(distinctUntilChanged());
  private readonly observer?: MutationObserver;

  constructor() {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    this.observer = new MutationObserver(() => this.darkSubject.next(ThemeService.readBodyTheme()));
    this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  get isDark(): boolean {
    return this.darkSubject.value;
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private static readBodyTheme(): boolean {
    return typeof document !== 'undefined' && document.body.classList.contains('dark-theme');
  }
}
