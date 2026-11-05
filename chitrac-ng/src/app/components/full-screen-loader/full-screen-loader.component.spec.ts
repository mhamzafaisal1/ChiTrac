import { TestBed } from '@angular/core/testing';
import { FullScreenLoaderComponent } from './full-screen-loader.component';

describe('Shared full-screen blur loader', () => {
  let originalBodyClass: string;
  beforeEach(() => {
    originalBodyClass = document.body.className;
    document.body.classList.remove('dark-theme');
    TestBed.configureTestingModule({ imports: [FullScreenLoaderComponent] });
  });
  afterEach(() => document.body.className = originalBodyClass);

  for (const dark of [false, true]) {
    it(`covers the whole viewport and centers the existing ${dark ? 'dark' : 'light'} loader`, () => {
      const fixture = TestBed.createComponent(FullScreenLoaderComponent);
      if (dark) document.body.classList.add('dark-theme');
      fixture.detectChanges();
      const overlay: HTMLElement = fixture.nativeElement.querySelector('.modal-loading-overlay');
      const rect = overlay.getBoundingClientRect();
      expect(rect.top).toBe(0); expect(rect.left).toBe(0);
      expect(rect.width).toBe(window.innerWidth); expect(rect.height).toBe(window.innerHeight);
      expect(getComputedStyle(overlay).backdropFilter).toContain(`blur(${dark ? 20 : 16}px)`);
      expect(getComputedStyle(overlay).pointerEvents).toBe('auto');
      const panel = fixture.nativeElement.querySelector('.loading-content-modal').getBoundingClientRect();
      expect(panel.left + panel.width / 2).toBeCloseTo(window.innerWidth / 2, 0);
      expect(panel.top + panel.height / 2).toBeCloseTo(window.innerHeight / 2, 0);
      const spinner = fixture.nativeElement.querySelector('.loading-spinner').getBoundingClientRect();
      expect(spinner.width).toBe(40); expect(spinner.height).toBe(40);
      expect(overlay.getAttribute('role')).toBe('status');
      expect(overlay.textContent).toContain('Fetching data...');
      fixture.destroy();
    });
  }

  it('updates the announced label for navigation without adding another loader implementation', () => {
    const fixture = TestBed.createComponent(FullScreenLoaderComponent);
    fixture.componentRef.setInput('label', 'Loading settings…'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-live="polite"]').textContent).toContain('Loading settings');
    fixture.componentRef.setInput('label', 'Loading page…'); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Loading page');
    fixture.destroy();
  });
});
