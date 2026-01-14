/*** Angular Imports */
import { Component, OnInit, OnDestroy, ViewChild, model, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/*** Material Imports */
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { PageEvent, MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { SelectionModel } from '@angular/cdk/collections';

import { MatCheckboxModule } from '@angular/material/checkbox';


/*** rxjs Imports */
import { Subscription, timer } from 'rxjs';
import { startWith, switchMap, share, retry, take } from 'rxjs/operators';

/*** PDF Imports */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/*** Model Imports */
import { OperatorConfig } from '../shared/models/operator.model';

/*** Component Imports */
import { OperatorDialogCuComponent } from '../operator-dialog-cu/operator-dialog-cu.component';

/*** Service Imports */
import { ConfigurationService } from '../configuration.service';


@Component({
    selector: 'operator-grid',
    imports: [CommonModule, MatTableModule, MatPaginatorModule, MatSortModule, MatCheckboxModule, MatDividerModule, MatButtonModule, MatIconModule],
    templateUrl: './operator-grid.component.html',
    styleUrl: './operator-grid.component.scss'
})
export class OperatorGridComponent implements OnInit, OnDestroy {
  operators: OperatorConfig[];
  dataSource: MatTableDataSource<OperatorConfig>;
  selectionModel = new SelectionModel<OperatorConfig>(false, []);

  sub: Subscription;
  page: number = 1;
  paginationSize: number = 10;
  isDownloading: boolean = false;

  displayedColumns: string[] = ['code', 'name', 'active'];

  emptyOperator: OperatorConfig = new OperatorConfig().deserialize({ code: null, name: '', active: true});

  @ViewChild(MatPaginator) paginator!: MatPaginator;

  @ViewChild(MatSort) sort: MatSort;

  constructor(private configurationService: ConfigurationService) {
   }

  private getOpsSubFunction = (res: OperatorConfig[]) => {
    this.operators = res;
    if (!this.dataSource) this.dataSource = new MatTableDataSource<OperatorConfig>(res);
    else this.dataSource.data = res;
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  private getOps = timer(1, (30 * 1000))
    .pipe(
      switchMap(() => this.configurationService.getOperatorConfigs()),
      retry(),
      share()
  );

  readonly dialog = inject(MatDialog);

  private sanitize(op: any): OperatorConfig {
    const { _id, code, name, active } = op ?? {};
    return new OperatorConfig().deserialize({
      _id, code: typeof code === 'string' ? +code : code, name, active: !!active
    });
  }

  private refreshTable() {
    if (this.sub) this.sub.unsubscribe();
    this.sub = this.getOps.subscribe(this.getOpsSubFunction);
  }

  private applyLocalUpdate(updated: OperatorConfig) {
    const arr = this.dataSource?.data ?? [];
    const i = arr.findIndex(x => x._id === updated._id);
    this.dataSource.data = i >= 0
      ? [...arr.slice(0, i), new OperatorConfig().deserialize({ ...arr[i], ...updated }), ...arr.slice(i + 1)]
      : [...arr, updated];
  }

  getOperatorDisplayName(operator: OperatorConfig): string {
    if (!operator.name) return '';
    if (typeof operator.name === 'string') {
      return operator.name;
    }
    // Complex name object
    const name = operator.name as any;
    return [name.first, name.surname].filter(Boolean).join(' ') || 'Unknown';
  }

  ngOnInit() {
    this.sub = this.getOps.subscribe(this.getOpsSubFunction);
  }

  openDialog(operator: OperatorConfig | null): void {
    if (operator) {
      // Editing existing operator
      const data = { ...operator }; // clone
      const dialogRef = this.dialog.open(OperatorDialogCuComponent, { data, disableClose: true });
      this.setupDialogHandlers(dialogRef);
    } else {
      // Creating new operator - get next available ID
      this.configurationService.getNewOperatorId().subscribe({
        next: (response) => {
          const newOperator = { ...this.emptyOperator, code: response.code };
          const dialogRef = this.dialog.open(OperatorDialogCuComponent, { data: newOperator, disableClose: true });
          this.setupDialogHandlers(dialogRef);
        },
        error: (err) => {
          console.error('Failed to get new operator ID:', err);
          // Fallback: open dialog with empty operator
          const data = { ...this.emptyOperator };
          const dialogRef = this.dialog.open(OperatorDialogCuComponent, { data, disableClose: true });
          this.setupDialogHandlers(dialogRef);
        }
      });
    }
  }

  private setupDialogHandlers(dialogRef: any): void {
    dialogRef.componentInstance.submitEvent.pipe(take(1)).subscribe((op: OperatorConfig) => {
      const payload = this.sanitize(op);
      const req$ = payload._id
        ? this.configurationService.putOperatorConfig(payload)
        : this.configurationService.postOperatorConfig(payload);

      const sub = req$.subscribe({
        next: saved => {
          this.applyLocalUpdate(saved || payload); // optimistic UI
          this.selectionModel.clear();
          dialogRef.close('saved');
          this.refreshTable();                     // server is source of truth
          sub.unsubscribe();
        },
        error: err => {
          const msg = err?.error?.message || err?.error || 'Update failed';
          dialogRef.componentInstance.error = { message: msg }; // surface 409 text
          sub.unsubscribe();
        }
      });
    });
  }

  deleteOperator(operator: OperatorConfig): void {
    if (operator) {
      const submitSub = this.configurationService.deleteOperatorConfig(operator._id).subscribe({
        next: (res) => {
          console.log('Operator deleted:', res);
          this.refreshTable();
          this.selectionModel.clear();
          submitSub.unsubscribe();
        },
        error: (err) => {
          console.error('Error deleting operator:', err);
          submitSub.unsubscribe();
        }
      });
    }
  }


  handlePageEvent(e: PageEvent) {
    this.page = e.pageIndex;
  }

  async downloadOperatorsPdf(): Promise<void> {
    if (!this.dataSource?.data || this.dataSource.data.length === 0) {
      console.warn('No operators data to export');
      return;
    }

    this.isDownloading = true;
    console.log('Starting PDF export...');

    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const margin = 24;
      let y = margin;

      // Title
      doc.setFontSize(14);
      doc.text('OPERATOR CONFIGURATION REPORT', margin, y);
      y += 18;

      // Date
      doc.setFontSize(10);
      const exportDate = new Date().toLocaleString();
      doc.text(`Exported: ${exportDate}`, margin, y);
      y += 24;

      // Table headers
      const head = [['Code', 'Name', 'Status']];
      
      // Table body - export all operators (not just current page)
      const body = this.dataSource.data.map(operator => [
        operator.code?.toString() || 'N/A',
        this.getOperatorDisplayName(operator),
        operator.active ? 'Active' : 'Inactive'
      ]);

      console.log(`Adding table with ${body.length} rows`);
      
      // Add table
      autoTable(doc, {
        head,
        body,
        startY: y,
        margin: { left: margin, right: margin },
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [22, 160, 133], textColor: 255, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 80 },  // Code column
          1: { cellWidth: 200 }, // Name column
          2: { cellWidth: 80 }   // Status column
        },
        theme: 'striped'
      });

      console.log('Saving PDF...');
      const timestamp = new Date().toISOString().split('T')[0];
      doc.save(`operator_report_${timestamp}.pdf`);
      console.log('PDF export completed successfully');
    } catch (e) {
      console.error('PDF export failed:', e);
    } finally {
      this.isDownloading = false;
    }
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
  }

}