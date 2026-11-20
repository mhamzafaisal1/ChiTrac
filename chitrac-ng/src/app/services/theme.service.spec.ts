import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  afterEach(() => document.body.classList.remove('dark-theme'));

  it('reports the body theme and emits only when it changes', async () => {
    document.body.classList.remove('dark-theme');
    const theme = TestBed.inject(ThemeService);
    const seen: boolean[] = [];
    const sub = theme.isDark$.subscribe(value => seen.push(value));

    document.body.classList.add('dark-theme');
    await new Promise(resolve => setTimeout(resolve));
    document.body.classList.add('unrelated-class');
    await new Promise(resolve => setTimeout(resolve));
    document.body.classList.remove('dark-theme', 'unrelated-class');
    await new Promise(resolve => setTimeout(resolve));

    expect(seen).toEqual([false, true, false]);
    expect(theme.isDark).toBeFalse();
    sub.unsubscribe();
  });
});
