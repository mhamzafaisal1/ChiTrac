// polling.service.ts
import { Injectable, NgZone, inject } from '@angular/core';
import { Observable, timer, Subject, BehaviorSubject, of } from 'rxjs';
import { switchMap, filter, takeUntil, tap, concatMap, delay, mergeMap } from 'rxjs/operators';
import { DateTime } from 'luxon';

@Injectable({ providedIn: 'root' })
export class PollingService {
  private modalOpen$ = new BehaviorSubject<boolean>(false);
  private zone = inject(NgZone);

  setModalOpen(isOpen: boolean) {
    this.modalOpen$.next(isOpen);
  }

  poll<T>(
    pollFn: () => Observable<T>,
    intervalMs: number,
    stop$: Observable<any>,
    isModal: boolean = false,
    immediate: boolean = true
  ): Observable<T> {
    const source$ = isModal ? this.modalOpen$ : new BehaviorSubject(true);
  
    return source$.pipe(
      filter(isActive => isActive),
      switchMap(() => {
        // Start with immediate execution if requested
        const initialDelay = immediate ? 0 : intervalMs;
        
        return of(null).pipe(
          delay(initialDelay),
          mergeMap(() => this.createPollingStream(pollFn, intervalMs, stop$))
        );
      })
    );
  }

  private createPollingStream<T>(
    pollFn: () => Observable<T>,
    intervalMs: number,
    stop$: Observable<any>
  ): Observable<T> {
    return new Observable<T>((subscriber) => {
      const sub = pollFn().pipe(
        takeUntil(stop$),
        tap(result => {
          console.log(`Polling: API call completed at ${new Date().toISOString()}`);
        }),
        // After each successful API call, wait for the interval and then make the next call
        mergeMap(result => 
          of(result).pipe(
            tap(() => {
              console.log(`Polling: Waiting ${intervalMs}ms before next call at ${new Date().toISOString()}`);
            }),
            delay(intervalMs),
            mergeMap(() => this.createPollingStream(pollFn, intervalMs, stop$))
          )
        )
      ).subscribe({
        next: (v) => this.zone.run(() => subscriber.next(v)),      // <—
        error: (e) => this.zone.run(() => subscriber.error(e)),    // <—
        complete: () => this.zone.run(() => subscriber.complete()) // <—
      });

      return () => sub.unsubscribe();
    });
  }
  
  // Utility method to update end timestamp to now
  updateEndTimestampToNow(): string {
    //const now = new Date();
    const now = new Date(DateTime.now().endOf('day').toISO());
    return this.formatDateForInput(now);
  }

  private formatDateForInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
  }
}
