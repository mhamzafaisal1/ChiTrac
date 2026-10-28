import { AsyncPipe, NgFor } from '@angular/common';
import { Component, Injector, OnDestroy, OnInit, inject } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, take, takeUntil } from 'rxjs';
import { NavigationActionsService } from '../services/navigation-actions.service';
import { ProductionScreenLayoutsService } from '../services/production-screen-layouts.service';
import { isNavigationMenu, menuParents, menuTitles, navigationEntries, NavigationMenu } from '../services/navigation-menu';
import { PermissionLevels, UserService } from '../user.service';
import { UserLoginComponent } from '../user-login/user-login.component';
import { PasswordResetComponent } from '../password-reset/password-reset.component';

@Component({
  selector: 'app-home', standalone: true,
  imports: [AsyncPipe, NgFor, MatIconModule, RouterLink],
  templateUrl: './home.component.html', styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit, OnDestroy {
  readonly navigation = inject(NavigationActionsService);
  readonly userService = inject(UserService);
  readonly productionLayouts = inject(ProductionScreenLayoutsService);
  readonly permissionLevels = PermissionLevels;
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(MatDialog);
  private readonly injector = inject(Injector);
  private readonly destroyed = new Subject<void>();
  private loginDialog?: MatDialogRef<UserLoginComponent>;
  private resetDialog?: MatDialogRef<PasswordResetComponent>;
  private signedIn = false;
  section: NavigationMenu | 'home' = 'home';
  readonly menuTitles = menuTitles;
  readonly destinations = [
    { label: 'Daily Dashboard', icon: 'slow_motion_video', path: '/ng/experimental/daily-dashboard' },
    { label: 'Machine Dashboard', icon: 'local_laundry_service', path: '/ng/analytics/machine-dashboard' },
    { label: 'Operator Dashboard', icon: 'person', path: '/ng/operatorAnalytics' },
    { label: 'Comparison Dashboard', icon: 'compare', path: '/ng/comparison-dashboard' },
    { label: 'Machine Report', icon: 'local_laundry_service', path: '/ng/reports/machine-report' },
    { label: 'Operator Report', icon: 'person', path: '/ng/reports/operator-report' }
  ];

  ngOnInit(): void {
    this.userService.user.pipe(takeUntil(this.destroyed)).subscribe(user => this.signedIn = !!user?.username);
    this.route.queryParamMap.pipe(takeUntil(this.destroyed)).subscribe(params => {
      const section = params.get('menu');
      this.section = isNavigationMenu(section) ? section : 'home';
      if (this.section === 'productionScreens') this.productionLayouts.refresh();
      if (params.get('resetPassword') === '1') this.openPasswordReset();
      else this.resetDialog?.close();
      if (params.get('login') === '1') this.openLogin();
    });
  }

  entries(user: any) {
    return this.section === 'home' ? [] : navigationEntries(this.section, level => this.userService.hasPermissionLevel(level, user));
  }

  parentMenu(): NavigationMenu {
    return this.section === 'home' ? 'main' : menuParents[this.section] || 'main';
  }

  openLogin(): void {
    if (this.signedIn) {
      return;
    }
    if (this.loginDialog) return;
    const ref = this.dialog.open(UserLoginComponent, { width: '440px', maxWidth: '94vw', injector: this.injector, ariaLabel: 'Login' });
    this.loginDialog = ref;
    ref.componentInstance.closeModal.pipe(take(1), takeUntil(this.destroyed)).subscribe(() => {
      const target = this.route.snapshot.queryParamMap.get('returnUrl');
      ref.close();
      const targetPath = target?.split(/[;?#]/, 1)[0].toLowerCase();
      if (target?.startsWith('/ng/') && !['/ng/login', '/ng/reset-password', '/ng/home'].includes(targetPath!)) this.router.navigateByUrl(target);
      else this.router.navigate(['/ng/home'], { replaceUrl: true });
    });
    ref.afterClosed().pipe(take(1), takeUntil(this.destroyed)).subscribe(() => {
      this.loginDialog = undefined;
      if (this.route.snapshot.queryParamMap.has('login')) this.router.navigate([], {
        relativeTo: this.route, queryParams: { login: null }, queryParamsHandling: 'merge', replaceUrl: true,
      });
    });
  }

  private openPasswordReset(): void {
    if (this.resetDialog) return;
    const ref = this.dialog.open(PasswordResetComponent, { width: '520px', maxWidth: '94vw', injector: this.injector, ariaLabel: 'Reset password' });
    this.resetDialog = ref;
    ref.afterClosed().pipe(take(1), takeUntil(this.destroyed)).subscribe(() => {
      this.resetDialog = undefined;
      if (this.route.snapshot.queryParamMap.has('resetPassword')) this.router.navigate(['/ng/home'], { replaceUrl: true });
    });
  }

  ngOnDestroy(): void {
    this.destroyed.next(); this.destroyed.complete();
    this.loginDialog?.close(); this.resetDialog?.close();
  }
}
