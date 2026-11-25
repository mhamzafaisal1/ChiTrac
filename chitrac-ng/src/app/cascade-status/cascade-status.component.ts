import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { forkJoin, switchMap, timer } from 'rxjs';
import { CascadeEvent, CascadeService, CascadeSignals, CascadeStatusResponse } from '../services/cascade.service';

const SIGNALS: { key: keyof CascadeSignals; label: string; device: string }[] = [
  { key: 'readyToStart', label: 'Ready to start', device: 'M2100' },
  { key: 'paused', label: 'Paused', device: 'M2101' },
  { key: 'running', label: 'Running', device: 'M2102' },
  { key: 'rts2', label: 'RTS 2', device: 'M2104' },
  { key: 'rts3', label: 'RTS3', device: 'M2105' },
];

// Stopping faults: on = faulted. Names match what is sent to the datafeed
// (chitrac-api/modules/cascadeEvents.js).
const FAULTS: { key: keyof CascadeSignals; label: string; device: string }[] = [
  { key: 'lowAir', label: 'Low Air Fault', device: 'M2103' },
  { key: 'M2106', label: 'Breaker Fault', device: 'M2106' },
  { key: 'M2107', label: 'Autoload Fault', device: 'M2107' },
  { key: 'M2110', label: 'LR Estop', device: 'M2110' },
  { key: 'M2111', label: 'LF Estop', device: 'M2111' },
  { key: 'M2112', label: 'RF Estop', device: 'M2112' },
  { key: 'M2113', label: 'RR Estop', device: 'M2113' },
  { key: 'M2114', label: 'Inverter Fault', device: 'M2114' },
  { key: 'M2115', label: 'Doors Open', device: 'M2115' },
  { key: 'M2204', label: 'No Material', device: 'M2204' },
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
              @if (src.status) {
                <span class="cs-status" [class]="'cs-status cs-status-' + statusClass(src.status.code)">{{ src.status.name }} ({{ src.status.code }})</span>
              }
              <span class="cs-badge" [class.cs-badge-offline]="src.stale">{{ src.stale ? 'No data' : 'Live' }}</span>
            </div>
            <div class="cs-signals">
              @for (sig of signalDefs; track sig.key) {
                <div class="cs-signal" [class.cs-on]="src.signals[sig.key]" [class.cs-dim]="src.stale">
                  <span class="cs-dot"></span>
                  <span class="cs-label">{{ sig.label }}</span>
                  <span class="cs-value">{{ onOff(src.signals[sig.key]) }}</span>
                  <span class="cs-device">{{ sig.device }}</span>
                </div>
              }
            </div>
            <h3 class="cs-section-title">Faults</h3>
            <div class="cs-signals">
              @for (f of faultDefs; track f.key) {
                <div class="cs-signal cs-fault" [class.cs-faulted]="src.signals[f.key]" [class.cs-dim]="src.stale">
                  <span class="cs-dot"></span>
                  <span class="cs-label">{{ f.label }}</span>
                  <span class="cs-value">{{ faultState(src.signals[f.key]) }}</span>
                  <span class="cs-device">{{ f.device }}</span>
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
              <thead><tr><th>Time</th><th>Events</th><th>Status</th>@for (sig of signalDefs; track sig.key) {<th>{{ sig.label }}</th>}<th>Active faults</th></tr></thead>
              <tbody>
                @for (e of events(); track $index) {
                  <tr>
                    <td>{{ e.timestamp | date: 'medium' }}</td>
                    <td>{{ eventLabels(e.events) }}</td>
                    <td [class.cs-status-sent]="e.statusChanged">{{ e.status ? e.status.name + ' (' + e.status.code + ')' : '—' }}</td>
                    @for (sig of signalDefs; track sig.key) {
                      <td [class.cs-changed]="e.previous && e.previous[sig.key] !== e.signals[sig.key]"
                          [class.cs-cell-on]="e.signals[sig.key]">{{ onOff(e.signals[sig.key]) }}</td>
                    }
                    <td [class.cs-changed]="faultsChanged(e)" [class.cs-cell-fault]="activeFaults(e.signals).length">
                      {{ activeFaults(e.signals).join(', ') || '—' }}
                    </td>
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
    .cs-card-header { gap: .75rem; }
    .cs-card-header .cs-card-title { flex: 1; }
    .cs-status { padding: .2rem .65rem; border-radius: 999px; font-size: .8rem; font-weight: 700; background: rgba(255,255,255,.12); color: var(--theme-color-text); }
    .cs-status-run { background: #2e7d32; color: #fff; }
    .cs-status-fault { background: #c62828; color: #fff; }
    .cs-status-idle { background: #f9a825; color: #000; }
    .cs-status-sent { font-weight: 700; }
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
    .cs-section-title { margin: 1rem 0 .5rem; font-size: .95rem; font-weight: 600; color: var(--theme-color-on-surface-variant); }
    .cs-fault.cs-faulted { border-color: #e53935; }
    .cs-fault.cs-faulted .cs-dot { background: #e53935; box-shadow: 0 0 6px #e53935; }
    .cs-fault.cs-faulted .cs-value { color: #ef5350; }
    .cs-cell-fault { color: #ef5350; }
  `]
})
export class CascadeStatusComponent {
  private cascade = inject(CascadeService);
  readonly signalDefs = SIGNALS;
  readonly faultDefs = FAULTS;
  readonly status = signal<CascadeStatusResponse | null>(null);
  readonly events = signal<CascadeEvent[]>([]);
  readonly error = signal<string | null>(null);

  private static readonly EVENT_LABELS: Record<string, string> = {
    start: 'Start', stop: 'Stop', pause: 'Pause', resume: 'Resume',
    fault: 'Fault', faultCleared: 'Fault cleared', ready: 'Ready', notReady: 'Not ready',
    rts2On: 'RTS 2 on', rts2Off: 'RTS 2 off', rts3On: 'RTS3 on', rts3Off: 'RTS3 off'
  };

  /** Optional bits (RTS 2 / RTS3) show N/A until the PLC payload includes them. */
  onOff(value: boolean | undefined): string {
    return value === undefined ? 'N/A' : value ? 'ON' : 'OFF';
  }

  /** Fault bits: true = faulted. Missing bits (older payloads) show N/A. */
  faultState(value: boolean | undefined): string {
    return value === undefined ? 'N/A' : value ? 'FAULT' : 'OK';
  }

  activeFaults(signals: CascadeSignals | null | undefined): string[] {
    return signals ? FAULTS.filter(f => signals[f.key] === true).map(f => f.label) : [];
  }

  faultsChanged(e: CascadeEvent): boolean {
    return !!e.previous && FAULTS.some(f => e.previous![f.key] !== e.signals[f.key]);
  }

  eventLabels(events?: string[]): string {
    if (!events) return '—';
    return events.length ? events.map(e => CascadeStatusComponent.EVENT_LABELS[e] || e).join(', ') : 'Signal change';
  }

  statusClass(code: number): string {
    return code === 1 ? 'run' : code > 1 ? 'fault' : 'idle';
  }

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
