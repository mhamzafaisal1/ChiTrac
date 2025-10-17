import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CtMainMenuComponent } from './ct-main-menu.component';

describe('CtMainMenuComponent', () => {
  let component: CtMainMenuComponent;
  let fixture: ComponentFixture<CtMainMenuComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CtMainMenuComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(CtMainMenuComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
