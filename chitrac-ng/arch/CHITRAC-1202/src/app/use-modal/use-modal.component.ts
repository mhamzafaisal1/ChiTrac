import { Component } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ModalWrapperComponent } from '../components/modal-wrapper-component/modal-wrapper-component.component';
import { OperatorPerformanceChartComponent } from '../operator-performance-chart/operator-performance-chart.component'; // Your chart component

@Component({
    selector: 'app-use-modal',
    templateUrl: './use-modal.component.html',
    styleUrls: ['./use-modal.component.scss'],
    imports: [MatDialogModule, MatButtonModule, MatIconModule]
})

export class UseModalComponent {
  constructor(private dialog: MatDialog) {}

  openOperatorPerformanceChart() {
    this.dialog.open(ModalWrapperComponent, {
      data: {
        component: OperatorPerformanceChartComponent
      },
      width: '90vw',
      height: '85vh',
      maxWidth: 'none',
      disableClose: false,
      panelClass: 'custom-modal-panel' // optional, for further custom styling
    });
  }
  
}
