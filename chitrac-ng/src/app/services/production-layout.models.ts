import type { ProductionStation } from '../efficiency-screens/experimental-spf/spf-stations';
import type { UserPreferences } from './settings.service';
export type ProductionLayoutScope = 'user' | 'system';
export interface ProductionLayoutReference { scope: ProductionLayoutScope; id: string; }
export interface NamedProductionLayout extends ProductionLayoutReference { name: string; stationIds: string[]; createdAt: string; }
export interface ProductionLayoutLibrary { layouts: NamedProductionLayout[]; defaultLayout: ProductionLayoutReference | null; }
export interface ProductionLayoutActivation { stations: ProductionStation[]; layout: NamedProductionLayout; preferences: UserPreferences; }
