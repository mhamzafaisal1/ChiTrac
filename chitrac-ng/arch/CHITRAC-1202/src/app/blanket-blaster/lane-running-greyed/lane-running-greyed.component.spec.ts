import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { LaneRunningGreyedComponent } from './lane-running-greyed.component';

describe('LaneRunningGreyedComponent', () => {
  let component: LaneRunningGreyedComponent;
  let fixture: ComponentFixture<LaneRunningGreyedComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ LaneRunningGreyedComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(LaneRunningGreyedComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
