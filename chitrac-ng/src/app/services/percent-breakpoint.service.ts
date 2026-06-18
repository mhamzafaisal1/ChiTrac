import { Injectable } from '@angular/core';
import { PercentBreakpoints, SettingsService } from './settings.service';

const DEFAULT_PERCENT_BREAKPOINTS: PercentBreakpoints = {
  poor: 0,
  okay: 70,
  good: 90
};

const DEFAULT_OE_PERCENT_BREAKPOINTS: PercentBreakpoints = {
  poor: 0,
  okay: 60,
  good: 80
};

@Injectable({
  providedIn: 'root'
})
export class PercentBreakpointService {
  constructor(private settingsService: SettingsService) {}

  getBreakpoints(): PercentBreakpoints {
    const configured = this.settingsService.getSettings()?.percentBreakpoints;

    if (this.isValid(configured)) {
      return configured;
    }

    return DEFAULT_PERCENT_BREAKPOINTS;
  }

  getOeBreakpoints(): PercentBreakpoints {
    const configured = this.settingsService.getSettings()?.oePercentBreakpoints;

    if (this.isValid(configured)) {
      return configured;
    }

    return DEFAULT_OE_PERCENT_BREAKPOINTS;
  }

  getColorClass(value: unknown): string {
    return this.getColorClassForBreakpoints(value, this.getBreakpoints());
  }

  getOeColorClass(value: unknown): string {
    return this.getColorClassForBreakpoints(value, this.getOeBreakpoints());
  }

  private getColorClassForBreakpoints(value: unknown, breakpoints: PercentBreakpoints): string {
    const percentage = this.parsePercentage(value);
    if (percentage === null) return '';

    if (percentage >= breakpoints.good) return 'green';
    if (percentage >= breakpoints.okay) return 'yellow';
    if (percentage >= breakpoints.poor) return 'red';
    return '';
  }

  getDashboardColor(value: unknown): 'green' | 'orange' | 'red' {
    const colorClass = this.getColorClass(value);
    return this.dashboardColorFromClass(colorClass);
  }

  getOeDashboardColor(value: unknown): 'green' | 'orange' | 'red' {
    const colorClass = this.getOeColorClass(value);
    return this.dashboardColorFromClass(colorClass);
  }

  private dashboardColorFromClass(colorClass: string): 'green' | 'orange' | 'red' {
    if (colorClass === 'green') return 'green';
    if (colorClass === 'yellow') return 'orange';
    return 'red';
  }

  getColorHex(value: unknown): string {
    const colorClass = this.getColorClass(value);
    return this.hexFromClass(colorClass);
  }

  getOeColorHex(value: unknown): string {
    const colorClass = this.getOeColorClass(value);
    return this.hexFromClass(colorClass);
  }

  private hexFromClass(colorClass: string): string {
    if (colorClass === 'green') return '#66bb6a';
    if (colorClass === 'yellow') return '#ffca28';
    return '#ef5350';
  }

  getLegacyColorHex(value: unknown): string {
    const colorClass = this.getColorClass(value);
    return this.legacyHexFromClass(colorClass);
  }

  getOeLegacyColorHex(value: unknown): string {
    const colorClass = this.getOeColorClass(value);
    return this.legacyHexFromClass(colorClass);
  }

  private legacyHexFromClass(colorClass: string): string {
    if (colorClass === 'green') return '#008000';
    if (colorClass === 'yellow') return '#F89406';
    return '#FF0000';
  }

  private parsePercentage(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'string') {
      const parsed = parseFloat(value.replace('%', ''));
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private isValid(value: PercentBreakpoints | undefined): value is PercentBreakpoints {
    return !!value &&
      Number.isFinite(value.poor) &&
      Number.isFinite(value.okay) &&
      Number.isFinite(value.good) &&
      value.good > value.okay &&
      value.okay > value.poor;
  }
}
