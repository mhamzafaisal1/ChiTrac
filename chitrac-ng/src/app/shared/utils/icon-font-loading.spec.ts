import { initializeIconFonts } from './icon-font-loading';

describe('Icon font loading', () => {
  let root: HTMLElement;
  let load: jasmine.Spy;
  let doc: Document;
  const loaded = [{ status: 'loaded' }];

  beforeEach(() => {
    root = document.createElement('html');
    root.classList.add('icon-font-loading', 'symbol-font-loading');
    load = jasmine.createSpy('load');
    doc = { documentElement: root, fonts: { load } } as unknown as Document;
    spyOn(console, 'warn');
  });

  it('reveals each icon family only after its font has loaded', async () => {
    let finishIcons!: (faces: any[]) => void;
    let finishSymbols!: (faces: any[]) => void;
    load.and.callFake((font: string) => new Promise(resolve => {
      if (font.includes('Material Icons')) finishIcons = resolve;
      else finishSymbols = resolve;
    }));
    initializeIconFonts(doc);
    expect(root.classList.contains('icon-font-loading')).toBeTrue();
    finishIcons(loaded);
    await Promise.resolve();
    expect(root.classList.contains('icon-font-loading')).toBeFalse();
    expect(root.classList.contains('symbol-font-loading')).toBeTrue();
    finishSymbols(loaded);
    await Promise.resolve();
    expect(root.classList.contains('symbol-font-loading')).toBeFalse();
  });

  it('keeps ligature text hidden when no matching face exists', async () => {
    load.and.returnValue(Promise.resolve([]));
    initializeIconFonts(doc);
    await Promise.resolve();
    expect(root.classList.contains('icon-font-loading')).toBeTrue();
    expect(root.classList.contains('symbol-font-loading')).toBeTrue();
  });

  it('keeps failed fonts hidden and reports the request failure', async () => {
    load.and.returnValue(Promise.reject(new Error('Network unavailable')));
    initializeIconFonts(doc);
    await Promise.resolve();
    await Promise.resolve();
    expect(root.classList.contains('icon-font-loading')).toBeTrue();
    expect(root.classList.contains('symbol-font-loading')).toBeTrue();
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});
