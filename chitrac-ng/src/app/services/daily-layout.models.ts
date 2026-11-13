import type { UserPreferences } from './settings.service';

export type DailyLayoutScope = 'user' | 'system';
export interface DailyLayoutReference { scope: DailyLayoutScope; id: string; }
export interface DailyDashboardLayout {
  gridLayout: '3x2' | '2x2';
  chartOrder: string[];
  chartVisibility: Record<string, boolean>;
}
export interface NamedDailyLayout extends DailyLayoutReference {
  name: string;
  layout: DailyDashboardLayout;
  createdAt: string;
}
export interface DailyLayoutLibrary {
  layouts: NamedDailyLayout[];
  defaultLayout: DailyLayoutReference | null;
}
export interface DailyLayoutActivation {
  layout: NamedDailyLayout;
  preferences: UserPreferences;
}
