import { Pipe, PipeTransform, inject } from '@angular/core';
import { SettingsService } from '../services/settings.service';

@Pipe({ name: 'displayTime', standalone: true, pure: false })
export class DisplayTimePipe implements PipeTransform {
  private readonly settings = inject(SettingsService);

  transform(value: string | Date | number | null | undefined, mode: 'time' | 'dateTime' = 'time'): string {
    return this.settings.formatTime(value, mode === 'dateTime'
      ? { year: 'numeric', month: 'short', day: 'numeric', second: '2-digit' }
      : {});
  }
}
