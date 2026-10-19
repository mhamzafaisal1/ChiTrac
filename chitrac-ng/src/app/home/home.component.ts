import { AsyncPipe, NgFor } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { NavigationActionsService } from '../services/navigation-actions.service';
import { PermissionLevels, UserService } from '../user.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [AsyncPipe, NgFor, MatIconModule, RouterLink],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent {
  readonly navigation = inject(NavigationActionsService);
  readonly userService = inject(UserService);
  readonly permissionLevels = PermissionLevels;
  readonly destinations = [
    { label: 'Daily Dashboard', icon: 'slow_motion_video', path: '/ng/experimental/daily-dashboard' },
    { label: 'Machine Dashboard', icon: 'local_laundry_service', path: '/ng/analytics/machine-dashboard' },
    { label: 'Operator Dashboard', icon: 'person', path: '/ng/operatorAnalytics' },
    { label: 'Comparison Dashboard', icon: 'compare', path: '/ng/comparison-dashboard' },
    { label: 'Machine Report', icon: 'local_laundry_service', path: '/ng/reports/machine-report' },
    { label: 'Operator Report', icon: 'person', path: '/ng/reports/operator-report' }
  ];
}
