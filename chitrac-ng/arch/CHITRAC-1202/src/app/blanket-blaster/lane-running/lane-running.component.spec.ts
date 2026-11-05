import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { LaneRunningComponent } from './lane-running.component';

describe('LaneRunningComponent', () => {
  let component: LaneRunningComponent;
  let fixture: ComponentFixture<LaneRunningComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ LaneRunningComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(LaneRunningComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
