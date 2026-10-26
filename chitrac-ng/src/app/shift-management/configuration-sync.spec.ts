import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject } from 'rxjs';
import { ShiftSettingsComponent } from './shift-settings.component';
import { MaintenanceShiftSettingsComponent } from './maintenance-shift-settings.component';
import { ShiftService } from '../services/shift.service';
import { SettingsService } from '../services/settings.service';

for (const [component, method] of [[ShiftSettingsComponent, 'watchAllShifts'],
  [MaintenanceShiftSettingsComponent, 'watchAllMaintenanceShifts']] as const) {
  describe(`${component.name} configuration sync`, () => {
    it('updates the list live without overwriting an open draft and unsubscribes when leaving', () => {
      const initial = { _id: 's1', name: 'Original', active: true, startTime: { hour: 6, minute: 0 }, endTime: { hour: 14, minute: 0 }, activeDays: [1] };
      const rows = new BehaviorSubject({ shifts: [initial] });
      TestBed.configureTestingModule({ imports: [component], providers: [provideNoopAnimations(),
        { provide: ShiftService, useValue: { [method]: () => rows } },
        { provide: SettingsService, useValue: { getTimeFormat: () => '24h' } },
        { provide: MatSnackBar, useValue: { open() {} } }
      ] });
      const fixture = TestBed.createComponent(component as any);
      fixture.detectChanges();
      const page: any = fixture.componentInstance;
      page.selectRow(page.dataSource.data[0]); page.openEdit();
      const draft = page.editorShift;
      rows.next({ shifts: [{ ...initial, name: 'Changed elsewhere' }] });
      expect(page.dataSource.data[0].name).toBe('Changed elsewhere');
      expect(page.editorShift).toBe(draft);
      expect(page.editorShift.name).toBe('Original');
      fixture.destroy();
      expect(rows.observed).toBeFalse();
    });
  });
}
