import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { DailyDashboardService } from '../../services/daily-dashboard.service';
import { PercentBreakpointService } from '../../services/percent-breakpoint.service';
import { ShiftService } from '../../services/shift.service';
import { ShiftMachineReportComponent } from './shift-machine-report.component';

describe('Shift machine report expansion', () => {
  beforeEach(() => TestBed.configureTestingModule({
    imports: [ShiftMachineReportComponent],
    providers: [provideNoopAnimations(),
      { provide: DailyDashboardService, useValue: {} },
      { provide: PercentBreakpointService, useValue: { getColorClass: () => '' } },
      { provide: ShiftService, useValue: { getActiveShifts: () => of({ shifts: [] }) } }]
  }));

  it('keeps expansion unhighlighted and duplicate headings visually hidden but accessible', async () => {
    const fixture = TestBed.createComponent(ShiftMachineReportComponent);
    fixture.componentInstance.reportGroups = [{ key: 'machine', summary: { Machine: 'SPF1' }, details: [{ Item: 'Sheets' }] }];
    fixture.componentInstance.rows = fixture.componentInstance.reportGroups.map(group => group.summary);
    fixture.detectChanges();
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const summary = root.querySelector<HTMLButtonElement>('.summary-row')!;
    const background = getComputedStyle(summary).backgroundColor;
    for (let repeat = 0; repeat < 3; repeat++) {
      summary.click(); fixture.detectChanges();
      expect(summary.getAttribute('aria-expanded')).toBe('true');
      expect(summary.classList.contains('expanded')).toBeFalse();
      expect(getComputedStyle(summary).backgroundColor).toBe(background);
      const heading = root.querySelector<HTMLElement>('.detail-table thead')!;
      expect(heading.textContent).toContain('Item');
      expect(heading.getBoundingClientRect().height).toBeLessThanOrEqual(1);
      expect(root.querySelector('.detail-table tbody')!.textContent).toContain('Sheets');
      summary.click(); fixture.detectChanges();
      expect(summary.getAttribute('aria-expanded')).toBe('false');
      expect(getComputedStyle(summary).backgroundColor).toBe(background);
      expect(root.querySelector('.detail-table')).toBeNull();
    }
    fixture.destroy();
  });

  it('shows single item names, plural counts, and no badge for empty groups', async () => {
    const fixture = TestBed.createComponent(ShiftMachineReportComponent);
    const longName = 'Extra Long Sheets and Pillowcase Item Name';
    fixture.componentInstance.reportGroups = [
      { key: 'single', summary: { Machine: 'Blanket1' }, details: [{ Item: 'Sheets' }] },
      { key: 'multiple', summary: { Machine: 'SPF1' }, details: [{ Item: 'Sheets' }, { Item: 'Towels' }] },
      { key: 'empty', summary: { Machine: 'Empty' }, details: [] },
      { key: 'unknown', summary: { Machine: 'Unnamed' }, details: [{ Item: '' }] },
      { key: 'long', summary: { Machine: 'Long' }, details: [{ Item: longName }] }
    ];
    fixture.componentInstance.rows = fixture.componentInstance.reportGroups.map(group => group.summary);
    fixture.detectChanges();
    await fixture.whenStable();
    const rows = fixture.nativeElement.querySelectorAll('.summary-row') as NodeListOf<HTMLElement>;
    expect(rows[0].querySelector('.detail-count')!.textContent!.trim()).toBe('Sheets');
    expect(rows[0].querySelector('.detail-count')!.getAttribute('title')).toBe('Sheets');
    expect(rows[1].querySelector('.detail-count')!.textContent!.trim()).toBe('2 items');
    expect(rows[1].querySelector('.detail-count')!.getAttribute('title')).toBeNull();
    expect(rows[2].querySelector('.detail-count')).toBeNull();
    expect(rows[3].querySelector('.detail-count')!.textContent!.trim()).toBe('Unknown Item');
    const longBadge = rows[4].querySelector<HTMLElement>('.detail-count')!;
    expect(longBadge.getAttribute('title')).toBe(longName);
    expect(getComputedStyle(longBadge).textOverflow).toBe('ellipsis');
    fixture.destroy();
  });
});
