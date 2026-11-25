import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BaseTableColumnOptions, BaseTableComponent } from '../components/base-table/base-table.component';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { defer, EMPTY, Subscription } from 'rxjs';
import { PageLoadStateComponent } from '../components/page-load-state/page-load-state.component';
import { share, catchError } from 'rxjs/operators';

import { MachineConfig } from '../shared/models/machine.model';
import { ConfigurationService } from '../configuration.service';
import { MachineDialogCuComponent } from '../machine-dialog-cu/machine-dialog-cu.component';

@Component({
  selector: 'machine-grid',
  standalone: true,
  imports: [
    PageLoadStateComponent,
    BaseTableComponent,
    CommonModule,
    MatDividerModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './machine-grid.component.html',
  styleUrl: './machine-grid.component.scss'
})
export class MachineGridComponent implements OnInit, OnDestroy {
  machines: MachineConfig[] = [];
  isLoading = true;
  selectedRow: MachineConfig | null = null;
  sub: Subscription;
  readonly displayedColumns = ['ID', 'Name', 'IP Address', 'Lanes', 'Stations', 'Type', 'Polled', 'Simulated', 'Active'];
  readonly pageSizes = [5, 10, 25, 100];
  readonly columnOptions: Record<string, BaseTableColumnOptions<MachineConfig>> = {
    ID: { field: 'id' },
    Name: { field: 'name' },
    'IP Address': { valueGetter: ({ data }) => data ? this.formatIpAddress(data) : '', minWidth: 142 },
    Lanes: { valueGetter: ({ data }) => this.formatAddresses(data?.lanes), sortable: false },
    Stations: { valueGetter: ({ data }) => this.formatAddresses(data?.stations), sortable: false },
    Type: { field: 'type' },
    Polled: { valueGetter: ({ data }) => data?.polled ? 'Yes' : 'No' },
    Simulated: { valueGetter: ({ data }) => data?.simulated ? 'Yes' : 'No' },
    Active: { valueGetter: ({ data }) => data?.active ? 'Active' : 'Inactive' },
  };
  readonly rowIdentity = (row: MachineConfig) => String(row._id ?? row.id);

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

  constructor(private configurationService: ConfigurationService) {}

  readonly dialog = inject(MatDialog);

  private getMachinesSubFunction = (res: MachineConfig | MachineConfig[]) => {
    this.isLoading = false;
    this.error = null;
    const machines = Array.isArray(res) ? res : [res];
    this.machines = machines;
    const selectedRow = this.selectedRow;
    this.selectedRow = selectedRow
      ? this.machines.find(row => this.rowIdentity(row) === this.rowIdentity(selectedRow)) ?? null
      : null;
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
          this.selectedRow = null;
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
          this.selectedRow = null;
        },
        error: (err) => {
          console.error('Delete failed:', err);
          this.error = 'Failed to delete machine. Please try again.';
        }
      });
    }
  }
}
