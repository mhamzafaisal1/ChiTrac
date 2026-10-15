import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { SettingsService } from '../services/settings.service';
import { ApiControllerOption, PermanentToken } from '../services/token-management.service';
import { TokenManagementComponent } from './token-management.component';

describe('API token controller editor', () => {
  const controllers: ApiControllerOption[] = [
    { id: 'general', label: 'General' }, { id: 'settings', label: 'Settings' },
    { id: 'spindle', label: 'Spindle' }, { id: 'milnor', label: 'Milnor' },
    { id: 'softrol', label: 'Softrol' }
  ];
  let component: TokenManagementComponent;
  let dialog: jasmine.SpyObj<MatDialog>;
  let service: any;
  let closeResult: any;

  beforeEach(() => {
    closeResult = undefined;
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    dialog.open.and.callFake(() => ({ afterClosed: () => of(closeResult) }) as any);
    service = jasmine.createSpyObj('TokenManagementService', ['updateControllerAccess', 'getTokens']);
    service.updateControllerAccess.and.returnValue(of({ success: true, allowedControllers: [] }));
    service.getTokens.and.returnValue(of({ controllers, tokens: [], deactivatedTokens: [] }));
    TestBed.configureTestingModule({ providers: [
      { provide: SettingsService, useValue: {} }, { provide: MatDialog, useValue: dialog }
    ] });
    component = TestBed.runInInjectionContext(() => new TokenManagementComponent(
      service, jasmine.createSpyObj('MatSnackBar', ['open']), jasmine.createSpyObj('Clipboard', ['copy'])
    ));
    component.controllers = controllers;
  });

  function token(allowedControllers: PermanentToken['allowedControllers'] = []): PermanentToken {
    return { id: 'token-id', name: 'Integration', isActive: true, allowedControllers } as PermanentToken;
  }

  it('uses the existing modal with explicit fail-closed selection and the server catalogue', () => {
    const record = token(['milnor']);
    component.editControllerAccess(record);
    const options: any = dialog.open.calls.mostRecent().args[1];
    expect(options.data.cards.map((card: ApiControllerOption) => card.label)).toEqual(controllers.map(c => c.label));
    expect(options.data.visibility).toEqual({ general: false, settings: false, spindle: false, milnor: true, softrol: false });
    expect(options.data.showLabel).toBe('Allowed');
    expect(options.data.hideLabel).toBe('Not Allowed');
    expect(options.data.compactCards).toBeTrue();
    expect(options.data.dragDropEnabled).toBeUndefined();
    expect(service.updateControllerAccess).not.toHaveBeenCalled();
    expect(record.allowedControllers).toEqual(['milnor']);
  });

  it('only sends controller IDs explicitly selected and allows revoking all grants', () => {
    component.editControllerAccess(token(['general']));
    const data: any = dialog.open.calls.mostRecent().args[1]!.data;
    data.save({ visibility: { milnor: true, softrol: false, unknown: true }, order: [] }).subscribe();
    expect(service.updateControllerAccess).toHaveBeenCalledWith('token-id', ['milnor']);
    data.save({ visibility: {}, order: [] }).subscribe();
    expect(service.updateControllerAccess).toHaveBeenCalledWith('token-id', []);
  });

  it('does not save on cancel and refreshes the server catalogue after a successful save', () => {
    component.editControllerAccess(token());
    expect(service.getTokens).not.toHaveBeenCalled();
    closeResult = { visibility: {}, order: [] };
    component.editControllerAccess(token());
    expect(service.getTokens).toHaveBeenCalledTimes(1);
  });

  it('does not allow editing inactive tokens or open an empty catalogue', () => {
    component.editControllerAccess({ ...token(), isActive: false });
    component.controllers = [];
    component.editControllerAccess(token());
    expect(dialog.open).not.toHaveBeenCalled();
  });
});
