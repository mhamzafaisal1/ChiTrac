/*** Angular Imports */
import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BaseTableColumnOptions, BaseTableComponent } from '../components/base-table/base-table.component';

/*** Material Imports */
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';



/*** rxjs Imports */
import { defer, EMPTY, Subscription } from 'rxjs';
import { share, catchError, take } from 'rxjs/operators';
import { PageLoadStateComponent } from '../components/page-load-state/page-load-state.component';

/*** PDF Imports */
import { loadPdfTools } from '../shared/utils/pdf-tools';

/*** Model Imports */
import { OperatorConfig } from '../shared/models/operator.model';

/*** Component Imports */
import { OperatorDialogCuComponent } from '../operator-dialog-cu/operator-dialog-cu.component';

/*** Service Imports */
import { ConfigurationService } from '../configuration.service';


@Component({
    selector: 'operator-grid',
    imports: [PageLoadStateComponent, BaseTableComponent, CommonModule, MatDividerModule, MatButtonModule, MatIconModule],
    templateUrl: './operator-grid.component.html',
    styleUrl: './operator-grid.component.scss'
})
export class OperatorGridComponent implements OnInit, OnDestroy {
  operators: OperatorConfig[] = [];
  isLoading = true;
  error: string | null = null;
  selectedRow: OperatorConfig | null = null;

  sub: Subscription;
  isDownloading: boolean = false;

  readonly displayedColumns = ['ID', 'Name', 'Active'];
  readonly pageSizes = [5, 10, 25, 100];
  readonly columnOptions: Record<string, BaseTableColumnOptions<OperatorConfig>> = {
    ID: { field: 'id' },
    Name: { valueGetter: ({ data }) => data ? this.getOperatorDisplayName(data) : '' },
    Active: { valueGetter: ({ data }) => data?.active ? 'Active' : 'Inactive' },
  };
  readonly rowIdentity = (row: OperatorConfig) => String(row._id ?? row.id);

  emptyOperator: OperatorConfig = new OperatorConfig().deserialize({ id: null, name: '', active: true});



  constructor(private configurationService: ConfigurationService) {
   }

  private getOpsSubFunction = (res: OperatorConfig[]) => {
    this.isLoading = false;
    this.error = null;
    this.operators = res;
    const selectedRow = this.selectedRow;
    this.selectedRow = selectedRow
      ? this.operators.find(row => this.rowIdentity(row) === this.rowIdentity(selectedRow)) ?? null
      : null;
  }

  private getOps = defer(() => this.configurationService.watchOperatorConfigs())
    .pipe(
        catchError(() => {
          this.isLoading = false;
          this.error = 'Failed to load operators. Please try again.';
          return EMPTY;
        }),
      share()
  );

  readonly dialog = inject(MatDialog);

  private sanitize(op: any): OperatorConfig {
    const { _id, id, code, name, active } = op ?? {};
    return new OperatorConfig().deserialize({
      _id,
      id: typeof (id ?? code) === 'string' ? +(id ?? code) : (id ?? code),
      name,
      active: !!active
    });
  }

  private refreshTable() {
    this.isLoading = true;
    this.error = null;
    if (this.sub) this.sub.unsubscribe();
    this.sub = this.getOps.subscribe(this.getOpsSubFunction);
  }

  retryLoad(): void { this.refreshTable(); }

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
      const data = structuredClone(operator);
      const dialogRef = this.dialog.open(OperatorDialogCuComponent, { data, disableClose: true });
      this.setupDialogHandlers(dialogRef);
    } else {
      // Creating new operator - get next available ID
      this.configurationService.getNewOperatorId().subscribe({
        next: (response) => {
          const newOperator = { ...this.emptyOperator, id: response.id };
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

      req$.subscribe({
        next: () => {
          this.selectedRow = null;
          dialogRef.close('saved');
        },
        error: err => {
          const msg = err?.error?.message || err?.error || 'Update failed';
          dialogRef.componentInstance.error = { message: msg }; // surface 409 text
        }
      });
    });
  }

  deleteOperator(operator: OperatorConfig): void {
    if (operator) {
      this.configurationService.deleteOperatorConfig(operator._id).subscribe({
        next: (res) => {
          console.log('Operator deleted:', res);
          this.selectedRow = null;
        },
        error: (err) => {
          console.error('Error deleting operator:', err);
        }
      });
    }
  }


  async downloadOperatorsPdf(): Promise<void> {
    if (!this.operators.length) {
      console.warn('No operators data to export');
      return;
    }

    this.isDownloading = true;
    console.log('Starting PDF export...');

    try {
      const { jsPDF, autoTable } = await loadPdfTools();
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
      const head = [['ID', 'Name', 'Status']];
      
      // Table body - export all operators (not just current page)
      const body = this.operators.map(operator => [
        operator.id?.toString() || 'N/A',
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
