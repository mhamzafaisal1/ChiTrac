import { NgTemplateOutlet } from '@angular/common';
import { Component, TemplateRef } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';

type TemplateCellParams = ICellRendererParams & { template: TemplateRef<{ $implicit: unknown }> };

@Component({
  selector: 'base-table-template-cell',
  imports: [NgTemplateOutlet],
  template: `<ng-container [ngTemplateOutlet]="template" [ngTemplateOutletContext]="{ $implicit: row }" />`,
})
export class BaseTableTemplateCellComponent implements ICellRendererAngularComp {
  template!: TemplateCellParams['template'];
  row: unknown;

  agInit(params: TemplateCellParams): void {
    this.refresh(params);
  }

  refresh(params: TemplateCellParams): boolean {
    this.template = params.template;
    this.row = params.data;
    return true;
  }
}
