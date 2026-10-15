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
});
