import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-timeline-zoom-controls',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="zoom-controls" role="group" aria-label="Timeline zoom"
      (click)="$event.stopPropagation()" (dblclick)="$event.stopPropagation()">
      <button mat-icon-button type="button" aria-label="Zoom in" matTooltip="Zoom in"
        [disabled]="!canZoomIn" (click)="zoomIn.emit()"><mat-icon>zoom_in</mat-icon></button>
      <button mat-icon-button type="button" aria-label="Zoom out" matTooltip="Zoom out"
        [disabled]="!canZoomOut" (click)="zoomOut.emit()"><mat-icon>zoom_out</mat-icon></button>
      <button mat-icon-button type="button" aria-label="Show full range" matTooltip="Show full range"
        [disabled]="!canZoomOut" (click)="reset.emit()"><mat-icon>zoom_out_map</mat-icon></button>
    </div>
  `,
  styles: `
    :host { display: block; flex: 0 0 52px; height: 52px; }
    .zoom-controls { display: flex; justify-content: flex-end; align-items: center; height: 48px; gap: 4px; }
    button.mat-mdc-icon-button {
      flex: 0 0 48px;
      width: 48px;
      height: 48px;
      --mdc-icon-button-state-layer-size: 48px;
      color: var(--theme-color-text, currentColor);
    }
    button:disabled { opacity: 0.4; }
  `,
})
export class TimelineZoomControlsComponent {
  @Input() canZoomIn = false;
  @Input() canZoomOut = false;
  @Output() zoomIn = new EventEmitter<void>();
  @Output() zoomOut = new EventEmitter<void>();
  @Output() reset = new EventEmitter<void>();
}
