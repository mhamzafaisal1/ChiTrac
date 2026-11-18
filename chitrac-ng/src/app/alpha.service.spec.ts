import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { AlphaService } from './alpha.service';

describe('AlphaService', () => {
  let service: AlphaService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    service = TestBed.inject(AlphaService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
