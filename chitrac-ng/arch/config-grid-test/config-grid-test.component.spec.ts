import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ConfigGridTestComponent } from './config-grid-test.component';

describe('ConfigGridTestComponent', () => {
  let component: ConfigGridTestComponent;
  let fixture: ComponentFixture<ConfigGridTestComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConfigGridTestComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(ConfigGridTestComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
