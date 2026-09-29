import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleChange, MatSlideToggleModule } from '@angular/material/slide-toggle';
import { IInnerHeaderAngularComp } from 'ag-grid-angular';
import { IHeaderParams } from 'ag-grid-community';

interface BaseTableHeaderParams extends IHeaderParams {
  editMode: boolean;
  toggleable: boolean;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

@Component({
  selector: 'base-table-header',
  standalone: true,
  imports: [MatIconModule, MatSlideToggleModule],
  template: `
    <div class="header-content" [class.header-content-editing]="params.editMode">
      @if (params.editMode) {
        <mat-icon class="drag-indicator" aria-hidden="true">drag_indicator</mat-icon>
      }
      @if (params.editMode && params.toggleable) {
        <mat-slide-toggle
          class="visibility-toggle"
          [checked]="params.enabled"
          [attr.aria-label]="'Toggle ' + params.displayName + ' column visibility'"
          (pointerdown)="$event.stopPropagation()"
          (mousedown)="$event.stopPropagation()"
          (click)="$event.stopPropagation()"
          (change)="onToggle($event)">
        </mat-slide-toggle>
      }
      <span class="header-label" [class.column-disabled]="params.editMode && params.toggleable && !params.enabled">
        {{ params.displayName }}
      </span>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      min-width: 0;
      width: 100%;
    }

    .header-content {
      display: flex;
      align-items: center;
      height: 100%;
      min-width: 0;
      width: 100%;
    }

    .header-content-editing {
      display: grid;
      grid-template-columns: 1.25rem 2.5rem minmax(0, 1fr);
      gap: 0.25rem;
      cursor: grab;
    }

    .header-content-editing:active {
      cursor: grabbing;
    }

    .drag-indicator {
      width: 1.1rem;
      height: 1.1rem;
      font-size: 1.1rem;
    }

    .visibility-toggle {
      transform: scale(0.78);
      transform-origin: center;
    }

    .header-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .column-disabled {
      opacity: 0.42;
    }
  `],
})
export class BaseTableHeaderComponent implements IInnerHeaderAngularComp {
  params!: BaseTableHeaderParams;

  agInit(params: IHeaderParams): void {
    this.params = params as BaseTableHeaderParams;
  }

  refresh(params: IHeaderParams): boolean {
    this.params = params as BaseTableHeaderParams;
    return true;
  }

  onToggle(event: MatSlideToggleChange): void {
    this.params.onToggle(event.checked);
  }
}
