import { Component, OnDestroy, OnInit, Renderer2 } from '@angular/core';
import { NavMainMenuComponent } from './nav-main-menu/nav-main-menu.component';
import { RouterOutlet } from '@angular/router';
import { SettingsService } from './services/settings.service';
import { ErrorQueueService } from './services/error-queue.service';
import { UserService } from './user.service';
import { WebsocketService } from './services/websocket.service';
import { Subject, filter, take, takeUntil } from 'rxjs';

@Component({
    selector: 'ct-root',
    imports: [NavMainMenuComponent, RouterOutlet],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'chitrac-ng';

  /*@HostBinding('class')*/
  currentTheme: 'light-theme' | 'dark-theme' = 'light-theme';
  isDarkMode: boolean = false;
  private readonly destroy$ = new Subject<void>();

  constructor(
    private renderer: Renderer2,
    private settingsService: SettingsService,
    private errorQueueService: ErrorQueueService,
    private userService: UserService,
    private websocketService: WebsocketService
  ) {
    // Initial theme application (will be updated by loadTheme)
    this.renderer.addClass(document.body, this.currentTheme);
  }

  ngOnInit() {
    // Load app settings on startup
    this.loadSettings();
    
    // Watch for user login/logout and load theme accordingly
    this.userService.user.pipe(takeUntil(this.destroy$)).subscribe(user => {
      if (user && user.username) {
        // User is logged in, load their theme preference
        this.loadTheme();
        this.websocketService.ensureConnected();
      } else {
        // User is not logged in, use default theme from settings
        this.loadDefaultTheme();
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

  /**
   * Load user's theme preference from server (for authenticated users)
   */
  private loadTheme(): void {
    this.settingsService.getUserTheme().subscribe({
      next: (response) => {
        this.applyTheme(response.theme);
      },
      error: (err) => {
        console.error('[AppComponent] Failed to load user theme, using default', err);
        if (err?.status === 401) {
          this.userService.clearStoredSession();
        }
        // Fall back to default theme on error
        this.loadDefaultTheme();
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
    this.isDarkMode = theme === 'dark';
    this.renderer.removeClass(document.body, this.currentTheme);
    this.currentTheme = theme === 'dark' ? 'dark-theme' : 'light-theme';
    this.renderer.addClass(document.body, this.currentTheme);
  }
}
