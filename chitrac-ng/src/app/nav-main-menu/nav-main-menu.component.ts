import { Component, inject, Output, Input, EventEmitter, ViewChild, HostListener } from '@angular/core';
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

import { trigger, state, style, animate, transition, query, group } from '@angular/animations';

import { Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';

import { UserService } from '../user.service';
import { SettingsService } from '../services/settings.service';
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
export class NavMainMenuComponent {
  @Output() darkModeToggleEvent = new EventEmitter();
  @Input() isDarkMode: boolean;
  @ViewChild('dateMenuTrigger') dateMenu: MatMenuTrigger;
  @ViewChild('loginMenuTrigger') loginMenu: MatMenuTrigger;


  private breakpointObserver = inject(BreakpointObserver);

  menuIndex: number = 0;

  showMenu: boolean = false;
  shownMenu: string = '';

  menuHistory: string[] = new Array();

  isHandset$: Observable<boolean> = this.breakpointObserver.observe(Breakpoints.Handset)
    .pipe(
      map(result => result.matches),
      shareReplay()
    );

  sub: any;

  user: any;
  
  systemName: string = 'ChiTrac';

  subscribeToUser(): void {
    this.sub = this.userService.user.subscribe(x => {
      if (x.username) {
        this.user = x;
      } else {
        this.user = {
          username: null
        }
      }
    });
  }

  constructor(private userService: UserService, private router: Router, private settingsService: SettingsService) {}

  ngOnInit() {
    this.userService.getCurrentUser().subscribe(x => x);
    this.subscribeToUser();
    
    // Load system name from settings
    this.settingsService.settings$.subscribe(settings => {
      if (settings && settings.systemName) {
        this.systemName = settings.systemName;
      }
    });
  }

  logout() {
    this.userService.logout().subscribe(x => x);
    this.router.navigate(['/']);
  }

  darkModeToggle() {
    this.darkModeToggleEvent.emit(true);
  }

  toggleMenu() {
    this.shownMenu = this.shownMenu === '' ? 'main' : '';
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

  onDateTimeModalClose(): void {
    setTimeout(() => {
      if (this.dateMenu) {
        this.dateMenu.closeMenu();
        console.log('confirm button clicked');
      }
    });
  }

  onLoginModalClose(): void {
    setTimeout(() => {
      if (this.loginMenu) {
        this.loginMenu.closeMenu();
        console.log('login modal closed');
      }
    });
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