import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { OperatorGridComponent } from './operator-grid.component';
import { ConfigurationService } from '../configuration.service';

describe('OperatorGridComponent', () => {
  let component: OperatorGridComponent;
  let fixture: ComponentFixture<OperatorGridComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OperatorGridComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ConfigurationService, useValue: { watchOperatorConfigs: () => of([]) } },
      ],
    })
    .compileComponents();

    fixture = TestBed.createComponent(OperatorGridComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
