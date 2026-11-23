import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { OperatorDialogCuComponent } from './operator-dialog-cu.component';

describe('OperatorDialogCuComponent', () => {
  let component: OperatorDialogCuComponent;
  let fixture: ComponentFixture<OperatorDialogCuComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OperatorDialogCuComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MatDialogRef, useValue: { close: jasmine.createSpy('close') } },
        { provide: MAT_DIALOG_DATA, useValue: { id: 100000, name: 'Test Operator', active: true } },
      ],
    })
    .compileComponents();

    fixture = TestBed.createComponent(OperatorDialogCuComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('switches name modes once per click without registering the toggle in the reactive form', fakeAsync(() => {
    const toggle = fixture.nativeElement.querySelector('mat-slide-toggle button') as HTMLButtonElement;
    expect(component.useComplexName).toBeFalse();

    toggle.click();
    fixture.detectChanges();
    tick(100);
    expect(component.useComplexName).toBeTrue();
    expect(component.complexNameFormGroup.getRawValue()).toEqual(jasmine.objectContaining({
      first: 'Test', surname: 'Operator',
    }));
    expect(fixture.nativeElement.textContent).toContain('Name Details');

    toggle.click();
    fixture.detectChanges();
    tick(100);
    expect(component.useComplexName).toBeFalse();
    expect(fixture.nativeElement.textContent).not.toContain('Name Details');
    expect(component.operatorFormGroup.valid).toBeTrue();
  }));
});
