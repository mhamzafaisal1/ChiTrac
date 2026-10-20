import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { PermissionLevels, User, UserService } from '../user.service';

@Component({
  selector: 'app-settings-menu',
  standalone: true,
  imports: [AsyncPipe, MatIconModule, RouterLink],
  templateUrl: './settings-menu.component.html',
  styleUrl: './settings-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsMenuComponent {
  readonly userService = inject(UserService);
  readonly destinations = [
    { label: 'Machines', icon: 'local_laundry_service', path: '/ng/settings/machines', permission: PermissionLevels.settings },
    { label: 'Profile', icon: 'account_circle', path: '/ng/settings/profile', permission: PermissionLevels.profile },
    { label: 'Operators', icon: 'person', path: '/ng/settings/operators', permission: PermissionLevels.operators },
    { label: 'Items', icon: 'dry_cleaning', path: '/ng/settings/items', permission: PermissionLevels.settings },
    { label: 'System Settings', icon: 'tune', path: '/ng/settings/system', permission: PermissionLevels.settings },
    { label: 'API Tokens', icon: 'vpn_key', path: '/ng/settings/tokens', permission: PermissionLevels.apiTokens },
    { label: 'Users', icon: 'manage_accounts', path: '/ng/settings/root/users', permission: PermissionLevels.users },
    { label: 'Server Logs', icon: 'description', path: '/ng/settings/server-logs', permission: PermissionLevels.serverLogs },
    { label: 'Utilities', icon: 'build_circle', path: '/ng/settings/root/utilities', permission: PermissionLevels.utilities },
    { label: 'Shifts', icon: 'punch_clock', path: '/ng/settings/shifts', permission: PermissionLevels.shifts },
    { label: 'Maintenance Shifts', icon: 'engineering', path: '/ng/settings/maintenance-shifts', permission: PermissionLevels.shifts },
  ];

  visibleDestinations(user: User | null) {
    return user?.username
      ? this.destinations.filter(destination => this.userService.hasPermissionLevel(destination.permission, user))
      : [];
  }
}
