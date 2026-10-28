import { Component, OnDestroy, OnInit, Renderer2 } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { NavMainMenuComponent } from './nav-main-menu/nav-main-menu.component';
import { Router, RouterOutlet } from '@angular/router';
import { SettingsService } from './services/settings.service';
import { ErrorQueueService } from './services/error-queue.service';
import { UserService } from './user.service';
import { WebsocketService } from './services/websocket.service';
import { Subject, of, catchError, distinctUntilChanged, filter, take, takeUntil, switchMap } from 'rxjs';
import { NavigationFeedbackComponent } from './components/navigation-feedback/navigation-feedback.component';

@Component({
    selector: 'ct-root',
    imports: [AsyncPipe, NavMainMenuComponent, RouterOutlet, NavigationFeedbackComponent],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'chitrac-ng';

  /*@HostBinding('class')*/
  currentTheme: 'light-theme' | 'dark-theme' = document.documentElement.dataset['theme'] === 'light' ? 'light-theme' : 'dark-theme';
  isDarkMode: boolean = this.currentTheme === 'dark-theme';
  private readonly destroy$ = new Subject<void>();
  private hadSignedInUser = false;

  constructor(
    private renderer: Renderer2,
    private settingsService: SettingsService,
    private errorQueueService: ErrorQueueService,
    readonly userService: UserService,
    private websocketService: WebsocketService,
    private router: Router
  ) {
    // Initial theme application (will be updated by loadTheme)
    this.renderer.addClass(document.body, this.currentTheme);
  }

  ngOnInit() {
    // Load app settings on startup
    this.loadSettings();
    
    // Watch for user login/logout and load theme accordingly
    this.userService.getCurrentUser().pipe(
      catchError(() => of(null)),
      switchMap(() => this.userService.user),
      distinctUntilChanged((previous, next) => previous?.username === next?.username),
      takeUntil(this.destroy$)
    ).subscribe(user => {
      if (user && user.username) {
        this.hadSignedInUser = true;
        // User is logged in, load their theme preference
        this.loadUserPreferences();
        this.websocketService.ensureConnected();
      } else {
        this.websocketService.resetSession();
        // User is not logged in, use default theme from settings
        this.settingsService.clearUserPreferences();
        this.loadDefaultTheme();
        if (this.hadSignedInUser) {
          this.hadSignedInUser = false;
          this.router.navigate(['/ng/home'], { replaceUrl: true });
        }
      }
    });


  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Load application settings from server
   */
  private loadSettings(): void {
    this.settingsService.loadSettings().subscribe({
      next: (settings) => {
        // Configure error modal behavior
        this.errorQueueService.setShowErrorModals(settings.showErrorModals);
      },
      error: (err) => {
        console.error('[AppComponent] Failed to load settings, using defaults', err);
        // Default to showing error modals on failure
        this.errorQueueService.setShowErrorModals(true);
      }
    });
  }

  /**
   * Load default theme from server settings (for unauthenticated users)
   */
  private loadDefaultTheme(): void {
    const settings = this.settingsService.getSettings();
    if (settings && settings.defaultTheme) {
      this.applyTheme(settings.defaultTheme);
    } else {
      // If settings haven't loaded yet, wait for them
      this.settingsService.settings$
        .pipe(
          filter((s): s is NonNullable<typeof s> => !!s && !!s.defaultTheme),
          take(1),
          takeUntil(this.destroy$)
        )
        .subscribe(s => this.applyTheme(s.defaultTheme));
    }
  }

  private loadUserPreferences(): void {
    this.settingsService.loadUserPreferences().subscribe({
      next: (preferences) => this.applyTheme(preferences.theme || preferences.defaultTheme || this.settingsService.getSettings()?.defaultTheme || 'dark'),
      error: (err) => {
        console.error('[AppComponent] Failed to load user preferences', err);
        if (err?.status === 401) {
          this.userService.clearStoredSession();
        }
      }
    });
  }

  /**
   * Handle theme change from nav menu
   */
  onThemeChanged() {
    this.isDarkMode = !this.isDarkMode;
    const newTheme = this.isDarkMode ? 'dark' : 'light';
    
    // Apply theme immediately for instant feedback
    this.applyTheme(newTheme);
    
    // Only save to server if user is logged in
    const user = this.userService.getToken();
    if (user) {
      this.settingsService.saveUserTheme(newTheme).subscribe({
        next: () => {},
        error: (err) => {
          console.error('[AppComponent] Failed to save theme preference', err);
          if (err?.status === 401) {
            this.userService.clearStoredSession();
          }
        }
      });
    }
  }

  /**
   * Apply a theme to the document body
   */
  private applyTheme(theme: 'light' | 'dark'): void {
    document.documentElement.dataset['theme'] = theme;
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem('chitrac-theme', theme); } catch {}
    this.isDarkMode = theme === 'dark';
    this.renderer.removeClass(document.body, this.currentTheme);
    this.currentTheme = theme === 'dark' ? 'dark-theme' : 'light-theme';
    this.renderer.addClass(document.body, this.currentTheme);
  }
}
