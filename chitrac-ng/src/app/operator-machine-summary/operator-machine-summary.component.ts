// operator-machine-summary.component.ts
import {
    Component,
    OnInit,
    OnDestroy,
    OnChanges,
    Input,
    SimpleChanges,
    ElementRef,
    Renderer2,
    Inject,
  } from '@angular/core';
  import { CommonModule } from '@angular/common';
  import { HttpClient, HttpClientModule, HttpParams } from '@angular/common/http';
  import { FormsModule } from '@angular/forms';
  import { MAT_DIALOG_DATA } from '@angular/material/dialog';
  import { Subject, tap, takeUntil, debounceTime } from 'rxjs';
  
  import { BaseTableComponent } from '../components/base-table/base-table.component';
  import { PollingService } from '../services/polling-service.service';
  import { DateTimeService } from '../services/date-time.service';
  import { OperatorAnalyticsService } from '../services/operator-analytics.service';
  
  type OperatorMachineSummaryResponse = {
    context: { operatorId: number; start: string; end: string };
    machines: Array<{
      machine: { serial: number; name: string };
      sessions: number;
      faultsWhileRunning: number;
      totals: { totalCount: number; totalMisfeed: number; totalTimeCredit: number; runtime: number };
      items: Array<{ id: number; name: string; standard: number; totalCount: number; totalTimeCredit: number }>;
    }>;
  };
  
  @Component({
    selector: 'app-operator-machine-summary',
    standalone: true,
    imports: [CommonModule, HttpClientModule, FormsModule, BaseTableComponent],
    templateUrl: './operator-machine-summary.component.html',
    styleUrls: ['./operator-machine-summary.component.scss'],
  })
  export class OperatorMachineSummaryComponent implements OnInit, OnChanges, OnDestroy {
    @Input() operatorId: number | null = null;
    @Input() startTime = '';
    @Input() endTime = '';
    @Input() isModal = false;
  
    columns: string[] = [];
    rows: any[] = [];
    selectedRow: any | null = null;
    isDarkTheme = false;
    isLoading = false;
    liveMode = false;
    hasFetchedOnce = false;
  
    private destroy$ = new Subject<void>();
    private fetchTrigger$ = new Subject<void>();
    private pollingSub: any;
    private readonly POLLING_INTERVAL = 6000;
  
    private lastParams: { operatorId: number | null; startTime: string; endTime: string } | null = null;
    private lastData: OperatorMachineSummaryResponse | null = null;
  
    constructor(
      private http: HttpClient,
      private polling: PollingService,
      private dateTime: DateTimeService,
      private renderer: Renderer2,
      private elRef: ElementRef,
      private operatorAnalytics: OperatorAnalyticsService,
      @Inject(MAT_DIALOG_DATA) private data: any
    ) {
      if (data) {
        this.operatorId = (this.operatorId ?? data.operatorId) ?? null;
        this.startTime = this.startTime || data.startTime || '';
        this.endTime = this.endTime || data.endTime || '';
      }
    }
  
    ngOnInit(): void {
      this.detectTheme();
      this.observeTheme();
  
      this.fetchTrigger$.pipe(debounceTime(0), takeUntil(this.destroy$)).subscribe(() => this.checkAndFetch());
  
      this.dateTime.liveMode$.pipe(takeUntil(this.destroy$)).subscribe((isLive: boolean) => {
        this.liveMode = isLive;
        if (this.liveMode) {
          const start = new Date();
          start.setHours(0, 0, 0, 0);
          this.startTime = this.formatDateForInput(start);
          this.endTime = this.polling.updateEndTimestampToNow();
  
          this.lastParams = { operatorId: this.operatorId ?? null, startTime: this.startTime, endTime: this.endTime };
          this.fetchData();
          this.setupPolling();
        } else {
          this.stopPolling();
        }
      });
  
      this.dateTime.confirmTrigger$.pipe(takeUntil(this.destroy$)).subscribe(() => {
        this.liveMode = false;
        this.stopPolling();
  
        this.startTime = this.dateTime.getStartTime();
        this.endTime = this.dateTime.getEndTime();
  
        this.lastParams = { operatorId: this.operatorId ?? null, startTime: this.startTime, endTime: this.endTime };
        this.fetchData();
      });
    }
  
    ngOnChanges(changes: SimpleChanges): void {
      if (changes['operatorId'] || changes['startTime'] || changes['endTime']) {
        this.fetchTrigger$.next();
      }
    }
  
    ngOnDestroy(): void {
      this.stopPolling();
      this.destroy$.next();
      this.destroy$.complete();
    }
  
    private setupPolling(): void {
      if (!this.liveMode) return;
      this.pollingSub = this.polling
        .poll(
          () => {
            this.endTime = this.polling.updateEndTimestampToNow();
            this.fetchData(true);
            return this.operatorAnalytics.getOperatorMachineSummary(this.startTime, this.endTime, this.operatorId!);
          },
          this.POLLING_INTERVAL,
          this.destroy$,
          false,
          false
        )
        .subscribe();
    }
  
    private stopPolling(): void {
      if (this.pollingSub) {
        this.pollingSub.unsubscribe();
        this.pollingSub = null;
      }
    }
  
    public checkAndFetch(): void {
      if (!this.operatorId || !this.startTime || !this.endTime) return;
  
      const nowParams = { operatorId: this.operatorId, startTime: this.startTime, endTime: this.endTime };
      const changed =
        !this.lastParams ||
        this.lastParams.operatorId !== nowParams.operatorId ||
        this.lastParams.startTime !== nowParams.startTime ||
        this.lastParams.endTime !== nowParams.endTime;
  
      if (changed) {
        this.lastParams = nowParams;
        this.fetchData();
      }
    }
  
    private fetchData(skipLoadingFlag = false): void {
      if (!this.operatorId) return;
      if (!skipLoadingFlag) this.isLoading = true;
  
      this.operatorAnalytics.getOperatorMachineSummary(this.startTime, this.endTime, this.operatorId)
        .pipe(
          tap({
            next: (data) => {
              this.hasFetchedOnce = true;
              this.lastData = data;
              this.updateTable();
              this.isLoading = false;
            },
            error: () => {
              this.rows = [];
              this.columns = [];
              this.isLoading = false;
            },
          }),
          takeUntil(this.destroy$)
        )
        .subscribe();
    }
  
    private updateTable(): void {
      if (!this.lastData) return;
  
      this.rows = (this.lastData.machines || []).map((m) => {
        const totals = m.totals || { totalCount: 0, totalMisfeed: 0, totalTimeCredit: 0, runtime: 0 };
        const runtimeSec = Number(totals.runtime) || 0;
        const eff =
          runtimeSec > 0 ? Math.max(0, Math.min(100, (Number(totals.totalTimeCredit) / runtimeSec) * 100)) : 0;
  
        return {
          Machine: m.machine?.name ?? `#${m.machine?.serial ?? ''}`,
          'Total Count': totals.totalCount ?? 0,
          'Total Misfeeds': totals.totalMisfeed ?? 0,
          'Total Runtime': this.formatDuration(runtimeSec),
          'Total Sessions': m.sessions ?? 0,
          'Efficiency %': eff.toFixed(1),
        };
      });
  
      this.columns = this.rows.length ? Object.keys(this.rows[0]) : [];
    }
  
    onRowSelected(row: any): void {
      this.selectedRow = this.selectedRow === row ? null : row;
      setTimeout(() => {
        const element = document.querySelector('.mat-row.selected');
        element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 0);
    }
  
    private observeTheme(): void {
      const observer = new MutationObserver(() => this.detectTheme());
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  
    private detectTheme(): void {
      this.isDarkTheme = document.body.classList.contains('dark-theme');
      const el = this.elRef.nativeElement;
      this.renderer.setAttribute(el, 'data-theme', this.isDarkTheme ? 'dark' : 'light');
    }
  
    private formatDateForInput(date: Date): string {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      const hh = String(date.getHours()).padStart(2, '0');
      const mm = String(date.getMinutes()).padStart(2, '0');
      return `${y}-${m}-${d}T${hh}:${mm}`;
    }
  
    private formatDuration(totalSeconds: number): string {
      const s = Math.max(0, Math.floor(totalSeconds));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      if (h > 0) return `${h}h ${m}m ${sec}s`;
      if (m > 0) return `${m}m ${sec}s`;
      return `${sec}s`;
    }
  }
  