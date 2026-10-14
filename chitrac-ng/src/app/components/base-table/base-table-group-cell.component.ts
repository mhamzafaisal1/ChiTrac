import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import { BaseTableGroupRow } from './base-table-groups';

interface GroupCellParams extends ICellRendererParams {
  onToggle: (key: string) => void;
}

@Component({
  selector: 'base-table-group-cell', standalone: true, imports: [CommonModule, MatIconModule],
  template: `
    <button *ngIf="group?.kind === 'summary'; else item" type="button" class="group-label"
      [attr.aria-expanded]="group.expanded" [attr.aria-label]="(group.expanded ? 'Collapse ' : 'Expand ') + label"
      (click)="toggle($event)">
      <mat-icon aria-hidden="true">{{ group.expanded ? 'expand_more' : 'chevron_right' }}</mat-icon>
      <span class="name">{{ label }}</span>
      <span class="count" *ngIf="group.detailCount" [attr.title]="group.singleItem || null">{{ group.singleItem || group.detailCount + ' items' }}</span>
    </button>
    <ng-template #item><span class="name">{{ label }}</span></ng-template>
  `,
  styles: [`
    :host { display: flex; align-items: center; width: 100%; min-width: 0; }
    .group-label { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0;
      border: 0; padding: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; text-align: left; }
    mat-icon { flex: none; width: 20px; height: 20px; font-size: 20px; color: var(--theme-color-primary); }
    .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .count { flex: 0 1 auto; min-width: 0; max-width: 50%; padding: 0 6px; border-radius: 999px;
      font-size: 12px; font-weight: 700; color: var(--theme-color-primary); overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; background: color-mix(in srgb, var(--theme-color-primary) 16%, transparent); }
    .group-label:focus-visible { outline: 2px solid var(--theme-color-primary); outline-offset: 2px; }
  `]
})
export class BaseTableGroupCellComponent implements ICellRendererAngularComp {
  group!: BaseTableGroupRow;
  label = '';
  private params!: GroupCellParams;
  agInit(params: GroupCellParams): void {
    this.params = params;
    this.group = params.data.__baseTableGroup;
    this.label = String(params.value ?? '');
  }
  refresh(params: GroupCellParams): boolean { this.agInit(params); return true; }
  toggle(event: MouseEvent): void {
    event.stopPropagation();
    this.params.onToggle(this.group.key);
  }
}
