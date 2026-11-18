import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { forkJoin, switchMap, timer } from 'rxjs';
import { CascadeEvent, CascadeService, CascadeSignals, CascadeStatusResponse } from '../services/cascade.service';

const SIGNALS: { key: keyof CascadeSignals; label: string; device: string }[] = [
  { key: 'readyToStart', label: 'Ready to start', device: 'M2100' },
  { key: 'paused', label: 'Paused', device: 'M2101' },
  { key: 'running', label: 'Running', device: 'M2102' },
  { key: 'lowAir', label: 'Low air', device: 'M2103' },
];

/** Live view of the Cascade PLC status received over MQTT. Polls every 5 s. */
@Component({
  selector: 'app-cascade-status',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="cs-page">
      <h1 class="cs-title">Cascade (MQTT)</h1>
      @if (error()) {
        <p class="cs-notice">{{ error() }}</p>
      }
      @if (!status() && !error()) {
        <p class="cs-notice">Loading…</p>
      }
      @if (status(); as s) {
        @if (!s.enabled) {
          <p class="cs-notice">The Cascade MQTT subscriber is not configured on this server (CASCADE_MQTT_URL).</p>
        }
        @if (s.sources.length === 0) {
          <p class="cs-notice">No Cascade status received yet.</p>
        }
        @for (src of s.sources; track src.source) {
          <div class="cs-card">
            <div class="cs-card-header">
              <h2 class="cs-card-title">{{ src.source }}</h2>
              <span class="cs-badge" [class.cs-badge-offline]="src.stale">{{ src.stale ? 'No data' : 'Live' }}</span>
            </div>
            <div class="cs-signals">
              @for (sig of signalDefs; track sig.key) {
                <div class="cs-signal" [class.cs-on]="src.signals[sig.key]" [class.cs-dim]="src.stale">
                  <span class="cs-dot"></span>
                  <span class="cs-label">{{ sig.label }}</span>
                  <span class="cs-value">{{ src.signals[sig.key] ? 'ON' : 'OFF' }}</span>
                  <span class="cs-device">{{ sig.device }}</span>
                </div>
              }
            </div>
            <p class="cs-meta">
              Last message {{ src.lastSeenAt | date: 'medium' }} · Last change {{ src.lastChangedAt | date: 'medium' }}
            </p>
          </div>
        }
        @if (events().length) {
          <div class="cs-card">
            <h2 class="cs-card-title">Recent changes</h2>
            <table class="cs-table">
              <thead><tr><th>Time</th><th>Source</th>@for (sig of signalDefs; track sig.key) {<th>{{ sig.label }}</th>}</tr></thead>
              <tbody>
                @for (e of events(); track $index) {
                  <tr>
                    <td>{{ e.timestamp | date: 'medium' }}</td>
                    <td>{{ e.source }}</td>
                    @for (sig of signalDefs; track sig.key) {
                      <td [class.cs-changed]="e.previous && e.previous[sig.key] !== e.signals[sig.key]"
                          [class.cs-cell-on]="e.signals[sig.key]">{{ e.signals[sig.key] ? 'ON' : 'OFF' }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100%; background: var(--theme-background); color: var(--theme-color-text); }
    .cs-page { max-width: 64rem; margin: 0 auto; padding: 2rem 1.5rem; color: var(--theme-color-text); }
    .cs-title { margin: 0 0 1rem; color: var(--theme-color-text); }
    .cs-notice { color: var(--theme-color-text); opacity: .85; }
    .cs-card { background: var(--theme-color-surface-container); color: var(--theme-color-text);
      border: 1px solid var(--theme-color-outline-variant, rgba(255,255,255,.12)); border-radius: 12px; padding: 1rem 1.25rem; margin-bottom: 1rem; }
    .cs-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: .75rem; }
    .cs-card-title { margin: 0 0 .75rem; font-size: 1.1rem; font-weight: 600; color: var(--theme-color-text); }
    .cs-card-header .cs-card-title { margin: 0; }
    .cs-badge { padding: .2rem .65rem; border-radius: 999px; font-size: .8rem; font-weight: 700; background: #2e7d32; color: #fff; }
    .cs-badge-offline { background: #c62828; }
    .cs-signals { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: .75rem; }
    .cs-signal { display: grid; grid-template-columns: auto 1fr auto; grid-template-rows: auto auto; column-gap: .6rem; row-gap: .15rem;
      align-items: center; padding: .75rem .9rem; border-radius: 8px; background: var(--theme-color-surface-bright); color: var(--theme-color-text);
      border: 1px solid transparent; }
    .cs-dot { grid-row: span 2; width: .85rem; height: .85rem; border-radius: 50%; background: rgba(255,255,255,.25); }
    .cs-label { font-weight: 600; color: var(--theme-color-text); }
    .cs-value { font-weight: 700; color: var(--theme-color-on-surface-variant); }
    .cs-device { grid-column: 2 / span 2; font-size: .75rem; color: var(--theme-color-on-surface-variant); }
    .cs-on { border-color: #43a047; }
    .cs-on .cs-dot { background: #43a047; box-shadow: 0 0 6px #43a047; }
    .cs-on .cs-value { color: #66bb6a; }
    .cs-dim { opacity: .45; }
    .cs-meta { margin: .75rem 0 0; font-size: .85rem; color: var(--theme-color-on-surface-variant); }
    .cs-table { width: 100%; border-collapse: collapse; font-size: .9rem; color: var(--theme-color-text); }
    .cs-table th { text-align: left; font-weight: 600; color: var(--theme-color-on-surface-variant); }
    .cs-table th, .cs-table td { padding: .4rem .5rem; border-bottom: 1px solid rgba(255,255,255,.1); }
    .cs-cell-on { color: #66bb6a; }
    .cs-changed { font-weight: 700; text-decoration: underline; }
  `]
})
export class CascadeStatusComponent {
  private cascade = inject(CascadeService);
  readonly signalDefs = SIGNALS;
  readonly status = signal<CascadeStatusResponse | null>(null);
  readonly events = signal<CascadeEvent[]>([]);
  readonly error = signal<string | null>(null);

  constructor() {
    timer(0, 5000).pipe(
      switchMap(() => forkJoin({ status: this.cascade.getStatus(), events: this.cascade.getEvents(20) })),
      takeUntilDestroyed(inject(DestroyRef))
    ).subscribe({
      next: ({ status, events }) => {
        this.status.set(status);
        this.events.set(events.events);
        this.error.set(null);
      },
      error: () => this.error.set('Could not load Cascade status from the server.')
    });
  }
}
