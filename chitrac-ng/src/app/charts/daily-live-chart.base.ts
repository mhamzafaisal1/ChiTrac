import { ChangeDetectorRef, Directive, OnDestroy, inject } from '@angular/core';
import { EMPTY, Observable, Subject, Subscription } from 'rxjs';
import { delay, repeat, takeUntil, tap } from 'rxjs/operators';
import { DateTimeService } from '../services/date-time.service';
import { PollingService } from '../services/polling-service.service';
import { ThemeService } from '../services/theme.service';
import { toDateTimeLocalInput } from '../shared/utils/date-input';

export type DailyChartResponseSource = 'once' | 'poll';

/**
 * Data lifecycle shared by the Daily Dashboard charts:
 * placeholder -> one-off fetch for a confirmed range, or live polling from midnight to now.
 * Polls never overlap: the next request starts POLLING_INTERVAL after the previous one finished.
 */
@Directive()
export abstract class DailyLiveChartBase implements OnDestroy {
  startTime = '';
  endTime = '';
  liveMode = false;
  isLoading = false;
  hasInitialData = false;
  dummyMode = true;
  isDarkTheme = false;

  protected readonly destroy$ = new Subject<void>();
  protected readonly POLLING_INTERVAL = 6000;
  protected readonly cdr = inject(ChangeDetectorRef);
  private readonly liveDates = inject(DateTimeService);
  private readonly livePolling = inject(PollingService);
  private pollingSub: Subscription | null = null;

  constructor() {
    inject(ThemeService).isDark$.pipe(takeUntil(this.destroy$)).subscribe(isDark => {
      this.isDarkTheme = isDark;
      this.cdr.markForCheck();
    });
  }

  /** Requests this chart's data for the given `YYYY-MM-DDTHH:mm` range. */
  protected abstract loadData(start: string, end: string): Observable<any>;
  /** Applies a response; `source` says whether it came from a one-off fetch or a live poll. */
  protected abstract consumeResponse: (source: DailyChartResponseSource) => (res: any) => void;
  /** Shows the loading placeholder. */
  protected abstract enterDummy(): void;
  /** Drops the rendered chart when live mode is switched off. */
  protected abstract clearChart(): void;

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.stopPolling();
  }

  /** Initial load plus reactions to live-mode switches and confirmed timeframes. */
  protected startTimeframeSync(isLive: boolean, wasConfirmed: boolean): void {
    if (!isLive || wasConfirmed) {
      if (wasConfirmed) {
        this.startTime = this.liveDates.getStartTime();
        this.endTime = this.liveDates.getEndTime();
      }
      this.fetchOnce().subscribe();
    }

    this.liveDates.liveMode$
      .pipe(takeUntil(this.destroy$))
      .subscribe(live => {
        this.liveMode = live;
        if (live) this.startLive(); else this.stopLive();
      });

    this.liveDates.confirmTrigger$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.liveMode = false;
        this.stopPolling();
        this.enterDummy();
        this.startTime = this.liveDates.getStartTime();
        this.endTime = this.liveDates.getEndTime();
        this.fetchOnce().subscribe();
      });
  }

  protected setupPolling(): void {
    this.stopPolling();
    this.pollingSub = this.pollOnce()
      .pipe(repeat({ delay: this.POLLING_INTERVAL }), takeUntil(this.destroy$))
      .subscribe({ error: () => this.stopPolling() });
  }

  protected stopPolling(): void {
    this.pollingSub?.unsubscribe();
    this.pollingSub = null;
  }

  protected fetchOnce(): Observable<any> {
    if (!this.startTime || !this.endTime) return EMPTY;
    this.isLoading = true;
    return this.loadData(this.startTime, this.endTime).pipe(
      takeUntil(this.destroy$),
      tap(this.consumeResponse('once')),
      delay(0)
    );
  }

  private startLive(): void {
    this.enterDummy();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    this.startTime = toDateTimeLocalInput(start);
    this.endTime = this.livePolling.updateEndTimestampToNow();
    this.setupPolling();
  }

  private stopLive(): void {
    this.stopPolling();
    this.hasInitialData = false;
    this.clearChart();
    this.enterDummy();
  }

  private pollOnce(): Observable<any> {
    this.endTime = this.livePolling.updateEndTimestampToNow();
    return this.loadData(this.startTime, this.endTime).pipe(tap(this.consumeResponse('poll')));
  }
}
