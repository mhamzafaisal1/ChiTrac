import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UseModalComponent } from './use-modal.component';

describe('UseModalComponent', () => {
  let component: UseModalComponent;
  let fixture: ComponentFixture<UseModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UseModalComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UseModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
