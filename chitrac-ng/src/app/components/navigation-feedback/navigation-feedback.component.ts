import { Component, ChangeDetectionStrategy, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationSkipped, NavigationStart, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-navigation-feedback',
  standalone: true,
  imports: [MatButtonModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (pending()) {
      <div class="navigation-loading" role="status" aria-live="polite">
        <mat-spinner diameter="40" aria-label="Loading page"></mat-spinner>
        <p>{{ message() }}</p>
      </div>
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
    .navigation-loading {
      position: fixed;
      inset: 64px 0 0;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      background: var(--theme-color-surface);
      color: var(--theme-color-text);
    }
    p { margin: 0; }
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
  readonly message = signal('Loading page…');
  readonly error = signal('');
  private readonly router = inject(Router);
  private navigationId: number | null = null;
  private targetUrl = '';

  constructor() {
    const current = this.router.getCurrentNavigation();
    if (current) this.start(current.id, current.initialUrl.toString());
    this.router.events.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(event => {
      if (event instanceof NavigationStart) {
        this.start(event.id, event.url);
      } else if (event instanceof NavigationEnd || event instanceof NavigationCancel ||
                 event instanceof NavigationError || event instanceof NavigationSkipped) {
        if (event.id !== this.navigationId) return;
        this.pending.set(false);
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
    this.navigationId = id;
    this.targetUrl = url;
    this.message.set(/^\/ng\/settings(?:[/?#]|$)/.test(url) ? 'Loading settings…' : 'Loading page…');
    this.error.set('');
    this.pending.set(true);
  }
}
