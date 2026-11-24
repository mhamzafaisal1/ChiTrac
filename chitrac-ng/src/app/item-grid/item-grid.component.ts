/*** Angular Imports */
import { Component, LOCALE_ID, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule, formatNumber } from '@angular/common';
import { BaseTableColumnOptions, BaseTableComponent } from '../components/base-table/base-table.component';

/*** Material Imports */
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';

/*** rxjs Imports */
import { defer, EMPTY, Subscription } from 'rxjs';
import { PageLoadStateComponent } from '../components/page-load-state/page-load-state.component';
import { share, catchError } from 'rxjs/operators';

/*** Model Imports */
import { ItemConfig } from '../shared/models/item.model';

/*** Component Imports */
import { ItemDialogCuComponent } from '../item-dialog-cu/item-dialog-cu.component';

/*** Service Imports */
import { ConfigurationService } from '../configuration.service';

@Component({
  selector: 'app-item-grid',
  standalone: true,
  imports: [
    PageLoadStateComponent,
    BaseTableComponent,
    CommonModule,
    MatDividerModule,
    MatButtonModule,
    MatIconModule
  ],
  templateUrl: './item-grid.component.html',
  styleUrl: './item-grid.component.scss'
})
export class ItemGridComponent implements OnInit, OnDestroy {
  selectedRow: ItemConfig | null = null;
  readonly displayedColumns = ['Image', 'ID', 'Name', 'Pace Standard', 'Active'];
  readonly pageSizes = [5, 10, 25, 100];
  readonly columnOptions: Record<string, BaseTableColumnOptions<ItemConfig>> = {
    Image: { sortable: false },
    ID: { field: 'id' },
    Name: { field: 'name' },
    'Pace Standard': {
      valueGetter: ({ data }) => data?.standard || 0,
      valueFormatter: ({ value }) => formatNumber(value, this.locale, '1.0-0'),
      getQuickFilterText: ({ value }) => formatNumber(value, this.locale, '1.0-0'),
    },
    Active: { valueGetter: ({ data }) => data?.active ? 'Active' : 'Inactive' },
  };
  readonly rowIdentity = (row: ItemConfig) => String(row._id ?? row.id);
  private readonly locale = inject(LOCALE_ID);
  isLoading = true;

  sub: Subscription;
  items: ItemConfig[] = [];
  error: string | null = null;
  emptyItem: ItemConfig = new ItemConfig().deserialize({ 
    id: null, 
    name: null, 
    active: true, 
    weight: null,
    standard: 0,
    area: 0,
    department: ''
  });

  constructor(private configurationService: ConfigurationService) {}

  readonly dialog = inject(MatDialog);

  private isItemPayload(value: unknown): value is ItemConfig {
    return !!value && typeof value === 'object' && ('id' in value || '_id' in value);
  }

  private sanitize(item: any): ItemConfig {
    const { _id, id, name, active, weight, standard, area, department, photo, photoFile } = item ?? {};
    return new ItemConfig().deserialize({
      _id,
      id: typeof id === 'string' ? Number(id) : id,
      name: typeof name === 'string' ? name.trim() : name,
      active: !!active,
      weight: weight === '' || weight === undefined ? null : Number(weight),
      standard: standard === undefined || standard === null ? 0 : Number(standard),
      area: area === undefined || area === null ? 0 : Number(area),
      department: department ?? '',
      photo,
      photoFile
    });
  }

  getPhotoUrl(photo?: string): string | null {
    if (!photo) return null;
    const fileName = photo.split(/[\\/]/).pop();
    return fileName ? `/uploads/images/${encodeURIComponent(fileName)}` : null;
  }

  private getItemsSubFunction = (res: ItemConfig[]) => {
    this.isLoading = false;
    this.error = null;
    this.items = res;
    const selectedRow = this.selectedRow;
    this.selectedRow = selectedRow
      ? this.items.find(row => this.rowIdentity(row) === this.rowIdentity(selectedRow)) ?? null
      : null;
  };

  private handleError = (error: any) => {
    console.error('Error fetching items:', error);
    this.error = 'Failed to load items. Please try again.';
    this.isLoading = false;
    return EMPTY;
  };

  private getItems = defer(() => this.configurationService.watchItemConfigs()).pipe(
    catchError(this.handleError),
    share()
  );

  ngOnInit() {
    this.sub = this.getItems.subscribe({
      next: (res: ItemConfig | ItemConfig[]) => {
        const items = Array.isArray(res) ? res : [res];
        this.getItemsSubFunction(items);
      },
      error: (err) => {
        console.error('Error in subscription:', err);
        this.error = 'Failed to load items. Please try again.';
      }
    });
  }

  private refreshTable() {
    this.isLoading = true;
    this.error = null;
    if (this.sub) this.sub.unsubscribe();
    this.sub = this.getItems.subscribe({
      next: (res: ItemConfig | ItemConfig[]) => {
        const items = Array.isArray(res) ? res : [res];
        this.getItemsSubFunction(items);
      },
      error: (err) => {
        console.error('Error in subscription:', err);
        this.error = 'Failed to load items. Please try again.';
      }
    });
  }

  retryLoad(): void { this.refreshTable(); }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
  }

  openDialog(item: ItemConfig | null): void {
    if (item) {
      // Editing existing item
      const data = structuredClone(item);
      const dialogRef = this.dialog.open(ItemDialogCuComponent, { data, disableClose: true });
      this.setupDialogHandlers(dialogRef);
    } else {
      // Creating new item - get next available ID
      this.configurationService.getNewItemId().subscribe({
        next: (response) => {
          const newItem = { ...this.emptyItem, id: response.id };
          const dialogRef = this.dialog.open(ItemDialogCuComponent, { data: newItem, disableClose: true });
          this.setupDialogHandlers(dialogRef);
        },
        error: (err) => {
          console.error('Failed to get new item ID:', err);
          // Fallback: open dialog with empty item
          const data = { ...this.emptyItem };
          const dialogRef = this.dialog.open(ItemDialogCuComponent, { data, disableClose: true });
          this.setupDialogHandlers(dialogRef);
        }
      });
    }
  }

  private setupDialogHandlers(dialogRef: any): void {
    dialogRef.afterClosed().subscribe((dialogItem: any) => {
      if (!this.isItemPayload(dialogItem)) {
        console.log('Cancelled');
        return;
      }

      const applyAfterMachinesOffline = !!dialogItem.applyAfterMachinesOffline;
      const payload = this.sanitize(dialogItem);
      const action$ = payload._id
        ? this.configurationService.putItemConfig(payload, applyAfterMachinesOffline)
        : this.configurationService.postItemConfig(payload, applyAfterMachinesOffline);

      action$.subscribe({
        next: (res) => {
          console.log('Success:', res);
          this.selectedRow = null;
        },
        error: (err) => {
          console.error('Operation failed:', err);
          // Handle backend validation errors
          const retryItem: Record<string, any> & { error?: { message: string; details: any[] } } = { ...payload };
          if (err.error && err.error.details) {
            retryItem.error = {
              message: 'Validation failed',
              details: err.error.details
            };
          } else {
            retryItem.error = {
              message: err?.error?.message || err.message || 'Operation failed',
              details: []
            };
          }
          const errorDialogRef = this.dialog.open(ItemDialogCuComponent, {
            data: retryItem,
            disableClose: true,
            panelClass: 'error-dialog'
          });
          this.setupDialogHandlers(errorDialogRef);
        }
      });
    });
  }

  deleteItem(item: ItemConfig): void {
    if (item) {
      this.configurationService.deleteItemConfig(item._id).subscribe({
        next: (res) => {
          console.log('Delete successful:', res);
          this.selectedRow = null;
        },
        error: (err) => {
          console.error('Delete failed:', err);
          this.error = 'Failed to delete item. Please try again.';
        }
      });
    }
  }
}
