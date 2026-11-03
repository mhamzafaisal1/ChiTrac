import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { LaneFaultComponent } from './lane-fault.component';

describe('LaneFaultComponent', () => {
  let component: LaneFaultComponent;
  let fixture: ComponentFixture<LaneFaultComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ LaneFaultComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(LaneFaultComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
