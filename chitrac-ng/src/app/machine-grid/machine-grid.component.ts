import { AfterViewInit, Component, OnInit, OnDestroy, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginator, PageEvent } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { SelectionModel } from '@angular/cdk/collections';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { defer, EMPTY, Subscription } from 'rxjs';
import { PageLoadStateComponent } from '../components/page-load-state/page-load-state.component';
import { share, catchError } from 'rxjs/operators';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import { MachineConfig } from '../shared/models/machine.model';
import { ConfigurationService } from '../configuration.service';
import { MachineDialogCuComponent } from '../machine-dialog-cu/machine-dialog-cu.component';

@Component({
  selector: 'machine-grid',
  standalone: true,
  imports: [
    PageLoadStateComponent,
    CommonModule,
    MatTableModule,
    MatPaginator,
    MatSortModule,
    MatCheckboxModule,
    MatDividerModule,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule 
  ],
  templateUrl: './machine-grid.component.html',
  styleUrl: './machine-grid.component.scss'
})
export class MachineGridComponent implements OnInit, OnDestroy, AfterViewInit {
  machines: MachineConfig[] = [];
  dataSource = new MatTableDataSource<MachineConfig>([]);
  isLoading = true;
  selectionModel = new SelectionModel<MachineConfig>(false, []);
  sub: Subscription;
  page = 1;
  paginationSize = 10;
  displayedColumns: string[] = ['id', 'name', 'ipAddress', 'lanes', 'stations', 'type', 'polled', 'simulated', 'active'];

  error: string | null = null;

  emptyMachine: MachineConfig = new MachineConfig().deserialize({
    id: null,
    name: null,
    active: true,
    ipAddress: null,
    lanes: [1],
    stations: [1],
    type: '',
    polled: false,
    simulated: false
  });
  

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort: MatSort;

  constructor(private configurationService: ConfigurationService) {}

  readonly dialog = inject(MatDialog);

  private getMachinesSubFunction = (res: MachineConfig | MachineConfig[]) => {
    this.isLoading = false;
    this.error = null;
    const machines = Array.isArray(res) ? res : [res];
    this.machines = Object.assign([], machines);
    this.dataSource.data = machines;
    const selectedId = this.selectionModel.selected[0]?._id;
    const selected = selectedId == null ? undefined : machines.find(row => row._id === selectedId);
    this.selectionModel.clear();
    if (selected) this.selectionModel.select(selected);
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  };

  private handleError = (error: any) => {
    console.error('Error fetching machines:', error);
    this.error = 'Failed to load machines. Please try again.';
    this.isLoading = false;
    return EMPTY;
  };

  private getMachines = defer(() => this.configurationService.watchMachineConfigs()).pipe(
    catchError(this.handleError),
    share()
  );

  ngOnInit(): void {
    this.sub = this.getMachines.subscribe({
      next: this.getMachinesSubFunction,
      error: (err) => {
        console.error('Error in subscription:', err);
        this.error = 'Failed to load machines. Please try again.';
      }
    });
  }

  ngOnDestroy(): void {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  handlePageEvent(e: PageEvent) {
    this.page = e.pageIndex;
  }

  private refreshTable(): void {
    this.isLoading = true;
    this.error = null;
    if (this.sub) this.sub.unsubscribe();
    this.sub = this.getMachines.subscribe({
      next: this.getMachinesSubFunction,
      error: (err) => {
        console.error('Error in subscription:', err);
        this.error = 'Failed to load machines. Please try again.';
      }
    });
  }

  retryLoad(): void { this.refreshTable(); }

  openDialog(machine: MachineConfig | null): void {
    const data = structuredClone(machine || this.emptyMachine);
    const dialogRef = this.dialog.open(MachineDialogCuComponent, {
      data,
      disableClose: true
    });
    this.setupDialogHandlers(dialogRef);
  }

  formatIpAddress(machine: MachineConfig): string {
    const ip = machine?.ipAddress;
    if (!ip) return '';
    return [ip.firstOctet, ip.secondOctet, ip.thirdOctet, ip.fourthOctet].join('.');
  }

  formatAddresses(values: number[] | null | undefined): string {
    return Array.isArray(values) ? values.join(', ') : '';
  }

  private setupDialogHandlers(dialogRef: any): void {
    dialogRef.afterClosed().subscribe((dialogMachine: MachineConfig | null) => {
      if (!dialogMachine) {
        return;
      }

      const action$ = dialogMachine._id
        ? this.configurationService.putMachineConfig(dialogMachine)
        : this.configurationService.postMachineConfig(dialogMachine);

      action$.subscribe({
        next: () => {
          this.selectionModel.clear();
        },
        error: (err) => {
          console.error('Machine operation failed:', err);
          const errorPayload = err?.error || {};
          const retryMachine = {
            ...dialogMachine,
            error: {
              message: errorPayload.error || err.message || 'Machine operation failed.',
              fieldErrors: errorPayload.fieldErrors || {}
            }
          };
          const errorDialogRef = this.dialog.open(MachineDialogCuComponent, {
            data: retryMachine,
            disableClose: true,
            panelClass: 'error-dialog'
          });
          this.setupDialogHandlers(errorDialogRef);
        }
      });
    });
  }

  deleteMachine(machine: MachineConfig): void {
    if (machine) {
      this.configurationService.deleteMachineConfig(machine._id).subscribe({
        next: (res) => {
          console.log('Delete successful:', res);
          this.selectionModel.clear();
        },
        error: (err) => {
          console.error('Delete failed:', err);
          this.error = 'Failed to delete machine. Please try again.';
        }
      });
    }
  }
}
