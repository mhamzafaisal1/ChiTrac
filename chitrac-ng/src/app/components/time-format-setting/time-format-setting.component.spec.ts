import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TimeFormatSettingComponent } from './time-format-setting.component';
import { SettingsService } from '../../services/settings.service';

describe('TimeFormatSettingComponent', () => {
  it('disables saving and restores the saved selection on failure', () => {
    TestBed.configureTestingModule({
      imports: [TimeFormatSettingComponent],
      providers: [provideNoopAnimations(), provideHttpClient(), provideHttpClientTesting()]
    });
    const fixture = TestBed.createComponent(TimeFormatSettingComponent);
    const component = fixture.componentInstance;
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    component.control.setValue('24h');
    component.save('24h');
    expect(component.control.disabled).toBeTrue();
    http.expectOne('/api/preferences/user').flush({}, { status: 500, statusText: 'Error' });
    expect(component.control.value).toBe('12h');
    expect(component.control.enabled).toBeTrue();
    expect(TestBed.inject(SettingsService).getTimeFormat()).toBe('12h');
    http.verify();
  });
});
