import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/** Shared full-viewport loader, matching the dashboard detail-loading overlay. */
@Component({
  selector: 'app-full-screen-loader',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-loading-overlay" role="status" aria-live="polite">
      <div class="loading-content-modal">
        <div class="loading-spinner" aria-hidden="true"></div>
        <div class="loading-text">{{ label }}</div>
      </div>
    </div>
  `,
  styleUrl: './full-screen-loader.component.scss',
})
export class FullScreenLoaderComponent {
  @Input() label = 'Fetching data...';
}
