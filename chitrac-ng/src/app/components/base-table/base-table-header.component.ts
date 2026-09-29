import { Component } from '@angular/core';
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
  imports: [MatSlideToggleModule],
  template: `
    <div
      class="header-content"
      [class.header-content-editing]="params.editMode"
      [class.header-content-editing-toggleable]="params.editMode && params.toggleable">
      @if (params.editMode && params.toggleable) {
        <span class="visibility-toggle-slot">
          <mat-slide-toggle
            class="visibility-toggle"
            [checked]="params.enabled"
            [attr.aria-label]="'Toggle ' + params.displayName + ' column visibility'"
            (pointerdown)="$event.stopPropagation()"
            (mousedown)="$event.stopPropagation()"
            (click)="$event.stopPropagation()"
            (change)="onToggle($event)">
          </mat-slide-toggle>
        </span>
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
      cursor: grab;
    }

    .header-content-editing-toggleable {
      display: flex;
      justify-content: center;
      gap: 0.5rem;
    }

    .header-content-editing:active {
      cursor: grabbing;
    }

    .visibility-toggle {
      transform: scale(0.62);
      transform-origin: center;
    }

    .visibility-toggle-slot {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 2rem;
      height: 100%;
    }

    .header-label {
      align-self: center;
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
