import { Component, OnInit, OnDestroy, ViewChild, inject } from '@angular/core';
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
import { Subscription, timer } from 'rxjs';
import { switchMap, retry, share, catchError } from 'rxjs/operators';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import { MachineConfig } from '../shared/models/machine.model';
import { ConfigurationService } from '../configuration.service';
import { MachineDialogCuComponent } from '../machine-dialog-cu/machine-dialog-cu.component';

@Component({
  selector: 'machine-grid',
  standalone: true,
  imports: [
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
export class MachineGridComponent implements OnInit, OnDestroy {
  machines: MachineConfig[] = [];
  dataSource: MatTableDataSource<MachineConfig>;
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
    this.error = null;
    const machines = Array.isArray(res) ? res : [res];
    this.machines = Object.assign([], machines);
    this.dataSource = new MatTableDataSource(machines);
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  };

  private handleError = (error: any): MachineConfig[] => {
    console.error('Error fetching machines:', error);
    this.error = 'Failed to load machines. Please try again.';
    return [];
  };

  private getMachines = timer(1, 30 * 1000).pipe(
    switchMap(() => this.configurationService.getMachineConfigs().pipe(
      catchError(this.handleError)
    )),
    retry(),
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

  handlePageEvent(e: PageEvent) {
    this.page = e.pageIndex;
  }

  private refreshTable(): void {
    if (this.sub) this.sub.unsubscribe();
    this.sub = this.getMachines.subscribe({
      next: this.getMachinesSubFunction,
      error: (err) => {
        console.error('Error in subscription:', err);
        this.error = 'Failed to load machines. Please try again.';
      }
    });
  }

  openDialog(machine: MachineConfig | null): void {
    const data = machine ? { ...machine } : { ...this.emptyMachine };
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
          this.refreshTable();
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
          this.refreshTable();
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
