import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-not-found', standalone: true, imports: [RouterLink, MatButtonModule],
  template: `<main><h1>Page not found</h1><p>The address may be incorrect or the page may have moved.</p><a mat-flat-button routerLink="/ng/home">Go to Home</a></main>`,
  styles: [`main { max-width: 40rem; margin: 4rem auto; padding: 1.5rem; color: var(--theme-color-text); }`]
})
export class NotFoundComponent {}
