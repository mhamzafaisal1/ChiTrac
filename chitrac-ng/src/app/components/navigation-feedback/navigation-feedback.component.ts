import { Component, ChangeDetectionStrategy, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationSkipped, NavigationStart, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { FullScreenLoaderComponent } from '../full-screen-loader/full-screen-loader.component';

@Component({
  selector: 'app-navigation-feedback',
  standalone: true,
  imports: [MatButtonModule, FullScreenLoaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showProgress()) {
      <app-full-screen-loader class="navigation-loading" [label]="message()" />
    }
    @if (error()) {
      <div class="navigation-error" role="alert">
        <span>{{ error() }}</span>
        <button mat-button type="button" (click)="retry()">Retry</button>
        <button mat-button type="button" (click)="error.set('')">Dismiss</button>
      </div>
    }
  `,
  styles: [`
    .navigation-error {
      position: relative;
      z-index: 1000;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      background: var(--theme-color-surface-container);
      color: var(--theme-color-text);
    }
  `],
})
export class NavigationFeedbackComponent {
  readonly pending = signal(false);
  readonly showProgress = signal(false);
  readonly message = signal('Loading page…');
  readonly error = signal('');
  private readonly router = inject(Router);
  private navigationId: number | null = null;
  private targetUrl = '';
  private progressTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => clearTimeout(this.progressTimer));
    const current = this.router.getCurrentNavigation();
    if (current) this.start(current.id, current.initialUrl.toString());
    this.router.events.pipe(takeUntilDestroyed(destroyRef)).subscribe(event => {
      if (event instanceof NavigationStart) {
        this.start(event.id, event.url);
      } else if (event instanceof NavigationEnd || event instanceof NavigationCancel ||
                 event instanceof NavigationError || event instanceof NavigationSkipped) {
        if (event.id !== this.navigationId) return;
        this.pending.set(false);
        clearTimeout(this.progressTimer);
        this.showProgress.set(false);
        if (event instanceof NavigationError) {
          this.error.set('Could not open this page. Please try again.');
        }
      }
    });
  }

  retry(): void {
    if (this.targetUrl) this.router.navigateByUrl(this.targetUrl).catch(() => {});
  }

  private start(id: number, url: string): void {
    clearTimeout(this.progressTimer);
    this.showProgress.set(false);
    this.navigationId = id;
    this.targetUrl = url;
    this.message.set(/^\/ng\/settings(?:[/?#]|$)/.test(url) ? 'Loading settings…' : 'Loading page…');
    this.error.set('');
    this.pending.set(true);
    // Fast local transitions need no spinner. Genuine waits use the shared
    // full-screen blur loader; pending makes routed content inert immediately.
    this.progressTimer = setTimeout(() => this.showProgress.set(true), 200);
  }
}
