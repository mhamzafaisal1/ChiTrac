import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { BaseTableComponent } from '../components/base-table/base-table.component';
import { ServerLogsService, ServerLog } from '../services/server-logs.service';
import { LogDetailModalComponent } from '../components/log-detail-modal/log-detail-modal.component';
import { TimeframePickerComponent, TimeframePickerMode, TimeframeSelection } from '../components/timeframe-picker/timeframe-picker.component';

@Component({
  selector: 'app-server-logs-interface',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatFormFieldModule,
    MatDialogModule,
    BaseTableComponent,
    TimeframePickerComponent
  ],
  templateUrl: './server-logs-interface.html',
  styleUrls: ['./server-logs-interface.scss']
})

export class ServerLogsInterfaceComponent implements OnInit, OnDestroy {
  startTime: string = '';
  endTime: string = '';
  timeframeMode: TimeframePickerMode = 'custom';
  selectedLevel: string = '';
  columns: string[] = ['Timestamp', 'Level', 'Message', 'Hostname'];
  rows: any[] = [];
  isDarkTheme: boolean = false;
  isLoading: boolean = false;
  selectedRow: any = null;
  
  // Pagination
  currentPage: number = 0;
  pageSize: number = 100;
  totalCount: number = 0;
  hasMore: boolean = false;

  logLevels: string[] = ['', 'info', 'http', 'error', 'warn', 'debug'];

  constructor(
    private serverLogsService: ServerLogsService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    // Set default date range (last 24 hours)
    const end = Date.now();
    this.startTime = new Date(end - 24 * 60 * 60 * 1000).toISOString();
    this.endTime = new Date(end).toISOString();

    // Detect dark theme
    this.detectDarkTheme();
    const observer = new MutationObserver(() => this.detectDarkTheme());
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    // Load initial data
    this.fetchLogs();
  }

  ngOnDestroy(): void {
    // Cleanup if needed
  }

  private detectDarkTheme(): void {
    this.isDarkTheme = document.body.classList.contains('dark-theme');
  }


  applyTimeframe(selection: TimeframeSelection): void {
    if (this.isLoading) return;
    this.startTime = selection.start.toISOString();
    this.endTime = selection.end.toISOString();
    this.timeframeMode = selection.mode ?? 'custom';
    this.fetchLogs();
  }

  fetchLogs(): void {
    if (this.isLoading || !this.startTime || !this.endTime) {
      return;
    }

    this.isLoading = true;
    this.currentPage = 0;

    const options = {
      start: this.startTime,
      end: this.endTime,
      level: this.selectedLevel || undefined,
      limit: this.pageSize,
      skip: 0
    };

    this.serverLogsService.getServerLogs(options).subscribe({
      next: (response) => {
        this.processLogs(response.logs);
        this.totalCount = response.pagination.total;
        this.hasMore = response.pagination.hasMore;
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error fetching server logs:', error);
        this.isLoading = false;
      }
    });
  }

  loadMore(): void {
    if (this.isLoading || !this.hasMore) {
      return;
    }

    this.isLoading = true;
    this.currentPage++;

    const options = {
      start: this.startTime,
      end: this.endTime,
      level: this.selectedLevel || undefined,
      limit: this.pageSize,
      skip: this.currentPage * this.pageSize
    };

    this.serverLogsService.getServerLogs(options).subscribe({
      next: (response) => {
        this.processLogs([...this.rows, ...response.logs]);
        this.hasMore = response.pagination.hasMore;
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading more logs:', error);
        this.isLoading = false;
      }
    });
  }

  private processLogs(logs: ServerLog[]): void {
    this.rows = logs.map(log => ({
      _id: log._id,
      'Timestamp': new Date(log.timestamp).toLocaleString(),
      'Level': log.level.toUpperCase(),
      'Message': this.truncateMessage(log.message, 100),
      'Hostname': log.hostname,
      _fullLog: log // Store full log for modal
    }));
  }

  private truncateMessage(message: string, maxLength: number): string {
    if (!message) return '';
    if (message.length <= maxLength) return message;
    return message.substring(0, maxLength) + '...';
  }

  onRowClick(row: any): void {
    if (row && row._fullLog) {
      this.openLogDetailModal(row._fullLog);
    }
  }

  openLogDetailModal(log: ServerLog): void {
    this.dialog.open(LogDetailModalComponent, {
      width: '80%',
      maxWidth: '900px',
      data: log,
      panelClass: this.isDarkTheme ? 'dark-theme' : ''
    });
  }

  getLevelClass(level: string): string {
    const levelLower = level.toLowerCase();
    if (levelLower === 'error') return 'error';
    if (levelLower === 'warn') return 'warn';
    if (levelLower === 'info') return 'info';
    if (levelLower === 'http') return 'http';
    return '';
  }

  onLevelChange(): void {
    this.fetchLogs();
  }
}

