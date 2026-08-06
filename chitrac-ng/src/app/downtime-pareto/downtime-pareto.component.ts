import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DateTimePickerComponent } from '../../../arch/date-time-picker/date-time-picker.component';
import { DailyDashboardService } from '../services/daily-dashboard.service';

interface ParetoRow {
  fault: string;
  count: number;
  seconds: number;
  duration: string;
  share: number;
  cumulative: number;
}

@Component({
  selector: 'app-downtime-pareto',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, DateTimePickerComponent],
  templateUrl: './downtime-pareto.component.html',
  styleUrl: './downtime-pareto.component.scss',
})
export class DowntimeParetoComponent implements OnInit, OnDestroy {
  startTime = '';
  endTime = '';
  isLoading = false;
  isDarkTheme = false;
  rows: ParetoRow[] = [];
  totalDuration = 0;
  totalCount = 0;
  private observer!: MutationObserver;

  constructor(private dailyDashboardService: DailyDashboardService) {}

  ngOnInit(): void {
    const end = new Date();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    this.startTime = this.formatDateForInput(start);
    this.endTime = this.formatDateForInput(end);
    this.detectTheme();
    this.observer = new MutationObserver(() => this.detectTheme());
    this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    this.fetchData();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  fetchData(): void {
    if (!this.startTime || !this.endTime) return;
    this.isLoading = true;
    this.dailyDashboardService
      .getFaultReportSummary(new Date(this.startTime).toISOString(), new Date(this.endTime).toISOString())
      .subscribe({
        next: (response) => {
          this.processRows(response.summaries || []);
          this.isLoading = false;
        },
        error: () => {
          this.rows = [];
          this.totalDuration = 0;
          this.totalCount = 0;
          this.isLoading = false;
        },
      });
  }

  private processRows(summaries: any[]): void {
    const sorted = summaries
      .map((summary) => ({
        fault: summary.code == null ? summary.name || 'Fault' : `${summary.name || 'Fault'} (${summary.code})`,
        count: Number(summary.count || 0),
        seconds: Number(summary.totalDurationSeconds || 0),
      }))
      .filter((row) => row.seconds > 0 || row.count > 0)
      .sort((a, b) => b.seconds - a.seconds || b.count - a.count);

    this.totalDuration = sorted.reduce((sum, row) => sum + row.seconds, 0);
    this.totalCount = sorted.reduce((sum, row) => sum + row.count, 0);
    let running = 0;
    this.rows = sorted.map((row) => {
      running += row.seconds;
      return {
        ...row,
        duration: this.formatDuration(row.seconds),
        share: this.totalDuration ? Math.round((row.seconds / this.totalDuration) * 100) : 0,
        cumulative: this.totalDuration ? Math.round((running / this.totalDuration) * 100) : 0,
      };
    });
  }

  private detectTheme(): void {
    this.isDarkTheme = document.body.classList.contains('dark-theme');
  }

  private formatDateForInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
  }

  formatDuration(seconds: number): string {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  }
}
