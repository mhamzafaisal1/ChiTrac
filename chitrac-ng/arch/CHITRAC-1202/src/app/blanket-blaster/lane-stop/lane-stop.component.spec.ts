import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { LaneStopComponent } from './lane-stop.component';

describe('LaneStopComponent', () => {
  let component: LaneStopComponent;
  let fixture: ComponentFixture<LaneStopComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ LaneStopComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(LaneStopComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
