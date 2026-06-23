import { Component, HostBinding, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

@Component({
    selector: 'app-chart-tile',
    imports: [CommonModule, MatIconModule],
    templateUrl: './chart-tile.component.html',
    styleUrls: ['./chart-tile.component.scss']
})
export class ChartTileComponent {
  @HostBinding('attr.title') nativeTitle: null = null;

  @Input() title: string = '';
  @Input() icon?: string; // optional Material icon name
  @Input() chartWidth: number = 600;
  @Input() chartHeight: number = 400;
}
