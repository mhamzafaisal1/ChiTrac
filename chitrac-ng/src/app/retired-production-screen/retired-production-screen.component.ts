import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-retired-production-screen',
  standalone: true,
  imports: [RouterLink, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main aria-labelledby="retired-screen-title">
      <h1 id="retired-screen-title">{{ previousScreen }} has moved</h1>
      <p>Production Screens now use saved layouts. Open Production Screens to choose
        the layout and stations for this display.</p>
      <a mat-flat-button routerLink="/ng/home" [queryParams]="{ menu: 'productionScreens' }">Choose a production layout</a>
    </main>
  `,
  styles: [`
    :host { display: block; color: var(--theme-color-text); }
    main { max-width: 42rem; margin: 0 auto; padding: 2rem 1rem; }
    h1 { font-size: 1.5rem; margin: 0 0 1rem; }
    p { line-height: 1.6; margin: 0 0 1.5rem; }
  `],
})
export class RetiredProductionScreenComponent {
  readonly previousScreen = inject(ActivatedRoute).snapshot.data['previousScreen'] as string;
}
