import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { User, UserService } from '../user.service';
import { navigationEntries } from '../services/navigation-menu';

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
  readonly destinations = navigationEntries('settings', () => true);

  visibleDestinations(user: User | null) {
    return user?.username
      ? navigationEntries('settings', level => this.userService.hasPermissionLevel(level, user))
      : [];
  }
}
