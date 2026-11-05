import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { FullScreenLoaderComponent } from '../full-screen-loader/full-screen-loader.component';

@Component({
  selector: 'app-page-load-state',
  standalone: true,
  imports: [MatButtonModule, FullScreenLoaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading) {
      <app-full-screen-loader [label]="label" />
    } @else if (error) {
      <div class="load-state" role="alert">
        <p>{{ error }}</p>
        <button mat-stroked-button type="button" (click)="retry.emit()">Retry</button>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .load-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      min-height: 160px;
      padding: 1rem;
      color: var(--theme-color-text);
    }
    p { margin: 0; text-align: center; }
  `],
})
export class PageLoadStateComponent {
  @Input() loading = false;
  @Input() error: string | null = null;
  @Input() label = 'Loading…';
  @Output() retry = new EventEmitter<void>();
}
