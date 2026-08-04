import { Component, inject, Output, Input, EventEmitter, ViewChild, HostListener, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { RouterOutlet, RouterModule } from '@angular/router';

import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';

import { trigger, style, animate, transition, query, group } from '@angular/animations';

import { Observable, Subscription } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';

import { PermissionLevels, UserService } from '../user.service';
import { SettingsService } from '../services/settings.service';
import { WebsocketConnectionStatus, WebsocketService } from '../services/websocket.service';
import { DateTimeModalComponent } from '../components/date-time-modal/date-time-modal.component';
import { UserLoginComponent } from '../user-login/user-login.component';

const left = [
  query(':enter, :leave', style({ position: 'absolute', width: '15em' })),
  group([
    query(':enter', [style({ transform: 'translateX(-15em)' }), animate('.3s ease-out', style({ transform: 'translateX(0%)' }))]),
    query(':leave', [style({ transform: 'translateX(0%)' }), animate('.3s ease-out', style({ transform: 'translateX(15em)' }))]),
  ]),
];

const right = [
  query(':enter, :leave', style({ position: 'absolute' })),
  group([
    query(':enter', [style({ transform: 'translateX(15em)' }), animate('.3s ease-out', style({ transform: 'translateX(0%)' }))]),
    query(':leave', [style({ transform: 'translateX(0%)' }), animate('.3s ease-out', style({ transform: 'translateX(-15em)' }))]),
  ]),
];

@Component({
    selector: 'nav-main-menu',
    templateUrl: './nav-main-menu.component.html',
    styleUrl: './nav-main-menu.component.scss',
    imports: [
        CommonModule,
        RouterOutlet,
        RouterModule,
        MatToolbarModule,
        MatButtonModule,
        MatSidenavModule,
        MatListModule,
        MatIconModule,
        MatSlideToggleModule,
        MatMenuModule,
        MatTooltipModule,
        DateTimeModalComponent,
        UserLoginComponent
    ],
    animations: [
        trigger('menuSlider', [
            transition(':increment', right),
            transition(':decrement', left),
        ]),
        trigger('menuSwap', [
            transition(':enter', [style({ transform: 'translateX(-15em)', position: 'absolute' }), animate('.3s ease-out', style({ transform: 'translateX(0%)', position: 'absolute' }))]),
            transition(':leave', [style({ transform: 'translateX(0%)', position: 'absolute' }), animate('.3s ease-out', style({ transform: 'translateX(-15em)', position: 'absolute' }))])
        ])
    ]
})
export class NavMainMenuComponent implements OnInit, OnDestroy {
  @Output() darkModeToggleEvent = new EventEmitter();
  @Input() isDarkMode: boolean;
  @ViewChild('dateMenuTrigger') dateMenu: MatMenuTrigger;
  @ViewChild('loginMenuTrigger') loginMenu: MatMenuTrigger;


  private breakpointObserver = inject(BreakpointObserver);

  menuIndex: number = 0;

  showMenu: boolean = false;
  shownMenu: string = '';

  menuHistory: string[] = new Array();

  /** Prevents the opening click from immediately closing the menu via document:click. */
  private ignoreDocumentClick = false;

  private readonly routeMenuMap = [
    {
      menu: 'dashboards',
      routes: [
        '/ng/machineAnalytics',
        '/ng/operatorAnalytics',
        '/ng/itemAnalytics',
        '/ng/daily-summary',
        '/ng/daily-analytics-split',
        '/ng/comparison-dashboard',
        '/ng/action-center',
        '/ng/downtime-pareto',
        '/ng/shift-handoff',
        '/ng/visual-ops',
        '/ng/analytics/machine-dashboard'
      ]
    },
    {
      menu: 'productionScreens',
      routes: [
        '/ng/blanket-blaster-one',
        '/ng/blanket-blaster-two',
        '/ng/spl-efficiency-screen',
        '/ng/lpl-efficiency-screen',
        '/ng/machine-efficiency-lane',
        '/ng/spl-col-efficiency-screen',
        '/ng/spf-col-efficiency-screen',
        '/ng/lpls-efficiency-screen',
        '/ng/spfs-efficiency-screen',
        '/ng/blanket-blasters-efficiency-screen'
      ]
    },
    {
      menu: 'reports',
      routes: [
        '/ng/reports/machine-report',
        '/ng/reports/shift-machine-report',
        '/ng/reports/shift-comparison-report',
        '/ng/reports/operator-report',
        '/ng/reports/item-report',
        '/ng/reports/fault-report',
        '/ng/reports/report-subscriptions'
      ]
    },
    {
      menu: 'settings',
      routes: [
        '/ng/settings'
      ]
    }
  ];

  isHandset$: Observable<boolean> = this.breakpointObserver.observe(Breakpoints.Handset)
    .pipe(
      map(result => result.matches),
      shareReplay()
    );

  private userSub?: Subscription;
  private settingsSub?: Subscription;
  private dialogCloseSub?: Subscription;
  private websocketStatusSub?: Subscription;
  private dashboardCacheSub?: Subscription;

  user: any;
  
  systemName: string = 'ChiTrac';
  websocketStatus: WebsocketConnectionStatus = 'disconnected';
  dashboardUpdatedAt: Date | null = null;

  subscribeToUser(): void {
    this.userSub = this.userService.user.subscribe(x => {
      if (x.username) {
        this.user = x;
      } else {
        this.user = {
          username: null
        }
      }
    });
  }

  canAccess(requiredLevel: number): boolean {
    return this.userService.hasPermissionLevel(requiredLevel, this.user);
  }

  readonly permissionLevels = PermissionLevels;

  constructor(
    private userService: UserService,
    private router: Router,
    private settingsService: SettingsService,
    private dialog: MatDialog,
    private websocketService: WebsocketService
  ) {}

  ngOnInit() {
    this.userService.getCurrentUser().subscribe(x => x);
    this.subscribeToUser();
    
    // Load system name from settings
    this.settingsSub = this.settingsService.settings$.subscribe(settings => {
      if (settings && settings.systemName) {
        this.systemName = settings.systemName;
      }
    });

    this.dialogCloseSub = this.dialog.afterOpened.subscribe(() => this.closeMenu());
    this.websocketService.ensureConnected();
    this.websocketStatusSub = this.websocketService.status$.subscribe((status) => {
      this.websocketStatus = status;
    });
    this.dashboardCacheSub = this.websocketService.dashboardCache$.subscribe((cache) => {
      const updatedAt =
        cache.dashboard?.machines?.today?.updatedAt ||
        cache.dashboard?.operators?.today?.updatedAt ||
        cache.today?.updatedAt ||
        cache.currentShift?.updatedAt ||
        cache.dashboard?.dailyAnalytics?.today?.updatedAt;

      this.dashboardUpdatedAt = updatedAt ? new Date(updatedAt) : null;
    });
  }

  ngOnDestroy() {
    this.userSub?.unsubscribe();
    this.settingsSub?.unsubscribe();
    this.dialogCloseSub?.unsubscribe();
    this.websocketStatusSub?.unsubscribe();
    this.dashboardCacheSub?.unsubscribe();
  }

  logout() {
    this.userService.logout().subscribe(x => x);
    this.router.navigate(['/']);
  }

  darkModeToggle() {
    this.darkModeToggleEvent.emit(true);
  }

  toggleMenu() {
    this.ignoreDocumentClick = true;

    if (this.shownMenu === '') {
      this.openMenuForCurrentRoute();
    } else {
      this.closeMenu();
    }

    // Allow the current click to finish bubbling before outside-click handling resumes.
    setTimeout(() => {
      this.ignoreDocumentClick = false;
    });
  }

  closeMenu() {
    this.shownMenu = '';
    this.menuIndex = 0;
    this.menuHistory = new Array();
  }

  openMenu(menu: string) {
    this.menuHistory.push(this.shownMenu);
    this.shownMenu = menu;
    this.menuIndex++;
  }

  prevMenu() {
    this.shownMenu = this.menuHistory.pop() || '';
    this.menuIndex--;
  }

  private openMenuForCurrentRoute(): void {
    const currentMenu = this.getCurrentRouteMenu();

    if (currentMenu && currentMenu !== 'main') {
      this.shownMenu = currentMenu;
      this.menuIndex = 1;
      this.menuHistory = ['main'];
      return;
    }

    this.shownMenu = 'main';
    this.menuIndex = 0;
    this.menuHistory = new Array();
  }

  private getCurrentRouteMenu(): string {
    const currentPath = this.router.url.split('?')[0].split('#')[0];
    const routeMatch = this.routeMenuMap.find(group =>
      group.routes.some(route => currentPath === route || currentPath.startsWith(`${route}/`))
    );

    return routeMatch?.menu || 'main';
  }

  onDateTimeModalClose(): void {
    setTimeout(() => {
      if (this.dateMenu) {
        this.dateMenu.closeMenu();
      }
    });
  }

  getLiveChipClass(): string {
    return `live-chip ${this.websocketStatus}`;
  }

  getLiveChipIcon(): string {
    if (this.websocketStatus === 'connected') return 'bolt';
    if (this.websocketStatus === 'connecting') return 'sync';
    if (this.websocketStatus === 'error') return 'error';
    return 'cloud_off';
  }

  getLiveChipLabel(): string {
    if (this.websocketStatus === 'connected') return 'Live';
    if (this.websocketStatus === 'connecting') return 'Connecting';
    if (this.websocketStatus === 'error') return 'Fallback';
    return 'Offline';
  }

  getLiveChipTooltip(): string {
    const updated = this.dashboardUpdatedAt
      ? `Last dashboard cache update: ${this.dashboardUpdatedAt.toLocaleString()}`
      : 'No dashboard cache update received yet';
    return `${this.getLiveChipLabel()} feed. ${updated}.`;
  }

  onLoginModalClose(): void {
    setTimeout(() => {
      if (this.loginMenu) {
        this.loginMenu.closeMenu();
      }
    });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.ignoreDocumentClick || this.shownMenu === '') {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    // Keep the menu open when interacting with the drawer or the apps toggle.
    if (
      target.closest('mat-sidenav') ||
      target.closest('.mat-drawer') ||
      target.closest('.menu-button')
    ) {
      return;
    }

    this.closeMenu();
  }

  @HostListener('keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // Prevent menu from closing when Tab key is pressed in login popup
    if (event.key === 'Tab' && this.loginMenu && this.loginMenu.menuOpen) {
      event.stopPropagation();
      // Let the default Tab behavior continue for focus management
    }
  }
}
