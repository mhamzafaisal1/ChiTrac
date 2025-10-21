import { Component, OnInit, Renderer2 } from '@angular/core';
import { NavMainMenuComponent } from './nav-main-menu/nav-main-menu.component';
import { RouterOutlet } from '@angular/router';
import { SettingsService } from './services/settings.service';
import { ErrorQueueService } from './services/error-queue.service';
import { UserService } from './user.service';

@Component({
    selector: 'ct-root',
    imports: [NavMainMenuComponent, RouterOutlet],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  title = 'chitrac-ng';

  /*@HostBinding('class')*/
  currentTheme: 'light-theme' | 'dark-theme' = 'light-theme';
  isDarkMode: boolean = false;

  constructor(
    private renderer: Renderer2,
    private settingsService: SettingsService,
    private errorQueueService: ErrorQueueService,
    private userService: UserService
  ) {
    // Initial theme application (will be updated by loadTheme)
    this.renderer.addClass(document.body, this.currentTheme);
  }

  ngOnInit() {
    // Load app settings on startup
    this.loadSettings();
    
    // Watch for user login/logout and load theme accordingly
    this.userService.user.subscribe(user => {
      if (user && user.username) {
        // User is logged in, load their theme preference
        this.loadTheme();
      } else {
        // User is not logged in, use default theme from settings
        this.loadDefaultTheme();
      }
    });
  }

  /**
   * Load application settings from server
   */
  private loadSettings(): void {
    this.settingsService.loadSettings().subscribe({
      next: (settings) => {
        console.log('[AppComponent] Settings loaded:', settings);
        
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
      console.log('[AppComponent] Using default theme:', settings.defaultTheme);
      this.applyTheme(settings.defaultTheme);
    } else {
      // If settings haven't loaded yet, wait for them
      this.settingsService.settings$.subscribe(s => {
        if (s && s.defaultTheme) {
          console.log('[AppComponent] Using default theme:', s.defaultTheme);
          this.applyTheme(s.defaultTheme);
        }
      });
    }
  }

  /**
   * Load user's theme preference from server (for authenticated users)
   */
  private loadTheme(): void {
    this.settingsService.getUserTheme().subscribe({
      next: (response) => {
        console.log('[AppComponent] User theme loaded:', response);
        this.applyTheme(response.theme);
      },
      error: (err) => {
        console.error('[AppComponent] Failed to load user theme, using default', err);
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
        next: () => console.log('[AppComponent] Theme preference saved'),
        error: (err) => console.error('[AppComponent] Failed to save theme preference', err)
      });
    } else {
      console.log('[AppComponent] Theme changed locally (not saved - user not logged in)');
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
