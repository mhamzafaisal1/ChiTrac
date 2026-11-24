import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, of } from 'rxjs';
import { ConfigurationService } from './configuration.service';
import { MachineGridComponent } from './machine-grid/machine-grid.component';
import { ItemGridComponent } from './item-grid/item-grid.component';
import { OperatorGridComponent } from './operator-grid/operator-grid.component';
import { PercentBreakpointService } from './services/percent-breakpoint.service';

for (const [component, watch, remove, collection] of [
  [MachineGridComponent, 'watchMachineConfigs', 'deleteMachine', 'machines'],
  [ItemGridComponent, 'watchItemConfigs', 'deleteItem', 'items'],
  [OperatorGridComponent, 'watchOperatorConfigs', 'deleteOperator', 'operators'],
] as const) {
  describe(`${component.name} live configuration`, () => {
    let rows: BehaviorSubject<any[]>;
    let watchRows: jasmine.Spy;
    let page: any;
    let fixture: any;
    let dialog: jasmine.SpyObj<MatDialog>;

    beforeEach(() => {
      rows = new BehaviorSubject<any[]>([{ _id: 'one', id: 1, name: 'Original', stations: [1] }]);
      watchRows = jasmine.createSpy(watch).and.returnValue(rows);
      dialog = jasmine.createSpyObj('MatDialog', ['open']);
      dialog.open.and.returnValue({ afterClosed: () => of(null) } as any);
      TestBed.configureTestingModule({ imports: [component], providers: [provideNoopAnimations(),
        { provide: PercentBreakpointService, useValue: { getColorClass: () => '' } },
        { provide: ConfigurationService, useValue: {
          [watch]: watchRows,
          deleteMachineConfig: () => of({}), deleteItemConfig: () => of({}), deleteOperatorConfig: () => of({}),
        } },
        { provide: MatDialog, useValue: dialog },
      ] });
      fixture = TestBed.createComponent(component as any);
      fixture.detectChanges();
      page = fixture.componentInstance;
    });
    afterEach(() => fixture.destroy());

    it('replaces the selected row with its latest value and clears selection after remote deletion', () => {
      page.selectedRow = page[collection][0];
      rows.next([{ _id: 'one', id: 1, name: 'Changed elsewhere', stations: [2] }]);
      expect(page.selectedRow).toBe(page[collection][0]);
      expect(page.selectedRow.name).toBe('Changed elsewhere');
      rows.next([]);
      expect(page.selectedRow).toBeNull();
      expect(watchRows).toHaveBeenCalledTimes(1);
    });

    it('keeps the live subscription after a REST deletion and releases it on navigation', () => {
      page[remove](page[collection][0]);
      expect(watchRows).toHaveBeenCalledTimes(1);
      rows.next([]);
      expect(page[collection]).toEqual([]);
      fixture.destroy();
      expect(rows.observed).toBeFalse();
    });

    if (component !== OperatorGridComponent) {
      it('isolates nested editor changes from the displayed configuration', () => {
        page.openDialog(page[collection][0]);
        const draft = dialog.open.calls.mostRecent().args[1]!.data as { stations: number[] };
        draft.stations.push(8);
        expect(page[collection][0].stations).toEqual([1]);
      });
    }
  });
}
