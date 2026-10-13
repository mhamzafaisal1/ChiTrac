export function initializeIconFonts(doc: Document): void {
  const load = (family: string, loadingClass: string): void => {
    doc.fonts.load(`24px "${family}"`).then(faces => {
      if (faces.length && faces.every(face => face.status === 'loaded')) {
        doc.documentElement.classList.remove(loadingClass);
      }
    }).catch(error => {
      // Keep ligature text hidden if a font request fails.
      console.warn(`Could not load ${family} font`, error);
    });
  };

  load('Material Icons', 'icon-font-loading');
  load('Material Symbols Outlined', 'symbol-font-loading');
}
