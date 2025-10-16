/*** Angular Imports */
import { Component, OnInit, OnDestroy, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

/*** Material Imports */
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { PageEvent, MatPaginator } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { SelectionModel } from '@angular/cdk/collections';
import { MatCheckboxModule } from '@angular/material/checkbox';

/*** rxjs Imports */
import { Subscription, timer } from 'rxjs';
import { switchMap, retry, share, catchError, take } from 'rxjs/operators';

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
    CommonModule,
    MatTableModule,
    MatPaginator,
    MatSortModule,
    MatCheckboxModule,
    MatDividerModule,
    MatButtonModule,
    MatIconModule
  ],
  templateUrl: './item-grid.component.html',
  styleUrl: './item-grid.component.scss'
})
export class ItemGridComponent implements OnInit, OnDestroy {
  selectionModel = new SelectionModel<ItemConfig>(false, []);
  page: number = 1;
  paginationSize: number = 10;
  displayedColumns: string[] = ['number', 'name', 'active'];
  dataSource: MatTableDataSource<ItemConfig>;

  sub: Subscription;
  items: ItemConfig[];
  error: string | null = null;
  emptyItem: ItemConfig = new ItemConfig().deserialize({ 
    number: null, 
    name: null, 
    active: true, 
    weight: null,
    standard: 0,
    area: 0,
    department: ''
  });

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort: MatSort;

  constructor(private configurationService: ConfigurationService) {}

  readonly dialog = inject(MatDialog);

  private getItemsSubFunction = (res: ItemConfig[]) => {
    this.error = null;
    this.items = res;
    this.dataSource = new MatTableDataSource(res);
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  };

  private handleError = (error: any): ItemConfig[] => {
    console.error('Error fetching items:', error);
    this.error = 'Failed to load items. Please try again.';
    return [];
  };

  private getItems = timer(1, 30 * 1000).pipe(
    switchMap(() => this.configurationService.getItemConfigs().pipe(
      catchError(this.handleError)
    )),
    retry({ delay: 5000 }),
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

  handlePageEvent(e: PageEvent) {
    this.page = e.pageIndex;
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
  }

  openDialog(item: ItemConfig | null): void {
    if (item) {
      // Editing existing item
      const data = { ...item }; // clone
      const dialogRef = this.dialog.open(ItemDialogCuComponent, { data, disableClose: true });
      this.setupDialogHandlers(dialogRef);
    } else {
      // Creating new item - get next available ID
      this.configurationService.getNewItemId().subscribe({
        next: (response) => {
          const newItem = { ...this.emptyItem, number: response.number };
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
      if (!dialogItem) {
        console.log('Cancelled');
        return;
      }

      const action$ = dialogItem._id
        ? this.configurationService.putItemConfig(dialogItem)
        : this.configurationService.postItemConfig(dialogItem);

      action$.subscribe({
        next: (res) => {
          console.log('Success:', res);
          this.refreshTable();
          this.selectionModel.clear();
        },
        error: (err) => {
          console.error('Operation failed:', err);
          // Handle backend validation errors
          if (err.error && err.error.details) {
            dialogItem.error = {
              message: 'Validation failed',
              details: err.error.details
            };
          } else {
            dialogItem.error = {
              message: err.message || 'Operation failed',
              details: []
            };
          }
          const errorDialogRef = this.dialog.open(ItemDialogCuComponent, {
            data: dialogItem,
            disableClose: true,
            panelClass: 'error-dialog'
          });
        }
      });
    });
  }

  deleteItem(item: ItemConfig): void {
    if (item) {
      this.configurationService.deleteItemConfig(item._id).subscribe({
        next: (res) => {
          console.log('Delete successful:', res);
          this.refreshTable();
          this.selectionModel.clear();
        },
        error: (err) => {
          console.error('Delete failed:', err);
          this.error = 'Failed to delete item. Please try again.';
        }
      });
    }
  }
}
