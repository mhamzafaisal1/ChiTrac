import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SettingsOperatorsComponent } from './settings-operators.component';

describe('SettingsOperatorsComponent', () => {
  let component: SettingsOperatorsComponent;
  let fixture: ComponentFixture<SettingsOperatorsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsOperatorsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SettingsOperatorsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
