import { Component, OnInit, OnDestroy, ElementRef, Renderer2, Inject, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { OeeDataService } from '../services/oee-data.service';
import { MultipleLineChartComponent } from '../components/multiple-line-chart/multiple-line-chart.component';

@Component({
    selector: 'app-operator-performance-chart',
    imports: [
        CommonModule,
        FormsModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatIconModule,
        MultipleLineChartComponent
    ],
    templateUrl: './operator-performance-chart.component.html',
    styleUrls: ['./operator-performance-chart.component.scss']
})
export class OperatorPerformanceChartComponent implements OnInit, OnDestroy {
  @Input() chartWidth: number;
  @Input() chartHeight: number;
  @Input() isModal: boolean = false;
  @Input() mode: 'standalone' | 'dashboard' = 'standalone';
  @Input() preloadedData: any = null;

  startTime = '';
  endTime = '';
  machineSerial = '';
  chartData: any = null;
  loading = false;
  error: string | null = null;
  isDarkTheme = false;

  private observer!: MutationObserver;

  constructor(
    private oeeService: OeeDataService,
    private renderer: Renderer2,
    private elRef: ElementRef,
    @Inject(MAT_DIALOG_DATA) private data: any
  ) {
    this.startTime = data?.startTime ?? '';
    this.endTime = data?.endTime ?? '';
    this.machineSerial = data?.machineSerial ?? '';
    this.chartWidth = data?.chartWidth ?? this.chartWidth;
    this.chartHeight = data?.chartHeight ?? this.chartHeight;
    this.isModal = data?.isModal ?? this.isModal;
    this.mode = data?.mode ?? this.mode;
    this.preloadedData = data?.preloadedData ?? this.preloadedData;
  }

  ngOnInit(): void {
    if (!this.startTime || !this.endTime) {
      const now = new Date();
      const before = new Date(now);
      before.setHours(before.getHours() - 24);
      this.startTime = before.toISOString();
      this.endTime = now.toISOString();
    }

    this.observeTheme();
    
    if (this.mode === 'dashboard' && this.preloadedData) {
      this.chartData = this.preloadedData;
      return;
    }

    if (this.machineSerial && this.startTime && this.endTime) {
      this.fetchData();
    }
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private observeTheme(): void {
    this.detectTheme();
    this.observer = new MutationObserver(() => this.detectTheme());
    this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  private detectTheme(): void {
    this.isDarkTheme = document.body.classList.contains('dark-theme');
    const el = this.elRef.nativeElement;
  }

  isValidInput(): boolean {
    return !!this.startTime && !!this.endTime && !!this.machineSerial;
  }

  fetchData(): void {
    if (!this.isValidInput()) {
      this.error = 'All fields are required';
      return;
    }

    this.loading = true;
    this.error = null;

    this.oeeService.getOperatorEfficiency(this.startTime, this.endTime, this.machineSerial).subscribe({
      next: (data) => {
        this.chartData = data;
        this.loading = false;
      },
      error: (err) => {
        console.error(err);
        this.error = 'Failed to fetch data.';
        this.loading = false;
      }
    });
  }
}
