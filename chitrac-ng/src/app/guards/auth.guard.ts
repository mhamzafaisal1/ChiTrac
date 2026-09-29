import { Injectable } from '@angular/core';
import { Router, CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Observable, map } from 'rxjs';

/*** Service Imports */
import { UserService } from '../user.service';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(
    private router: Router,
    private userService: UserService,
  ) {}

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean | UrlTree> {
    return this.userService.getCurrentUser().pipe(
      map(user => {
        if (!user?.username) {
          return this.router.createUrlTree(['/ng/login'], {
            queryParams: { returnUrl: state.url }
          });
        }

        const requiredLevel = route.data?.['requiredPermissionLevel'];
        if (typeof requiredLevel === 'number' && !this.userService.hasPermissionLevel(requiredLevel, user)) {
          return this.router.createUrlTree(['/ng/settings/profile']);
        }

        return true;
      })
    );
  }

}
