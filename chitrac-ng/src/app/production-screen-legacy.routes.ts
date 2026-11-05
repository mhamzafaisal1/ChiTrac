import { Routes } from '@angular/router';

// Keep bookmarked/display URLs reachable without retaining the retired pages.
// No saved system-layout IDs are assumed: the user must choose the right layout.
export const legacyProductionRoutes: Routes = [
  { path: 'ng/blanket-blaster-one', data: { previousScreen: 'Blanket Blaster 1' } },
  { path: 'ng/blanket-blaster-two', data: { previousScreen: 'Blanket Blaster 2' } },
  { path: 'ng/spl-efficiency-screen', data: { previousScreen: 'SPL' } },
  { path: 'ng/lpl-efficiency-screen', data: { previousScreen: 'LPL' } },
  { path: 'ng/lpl-efficiency-screen/:line', data: { previousScreen: 'LPL' } },
  { path: 'ng/machine-efficiency-lane', data: { previousScreen: 'Machine Efficiency' } },
  { path: 'ng/spl-col-efficiency-screen', data: { previousScreen: 'SPL Columns' } },
  { path: 'ng/spf-col-efficiency-screen', data: { previousScreen: 'SPF Columns' } },
  { path: 'ng/lpls-efficiency-screen', data: { previousScreen: 'LPLs' } },
  { path: 'ng/spfs-efficiency-screen', data: { previousScreen: 'SPFs' } },
  { path: 'ng/blanket-blasters-efficiency-screen', data: { previousScreen: 'Blanket Blasters' } },
  { path: 'ng/eight-station-demo', data: { previousScreen: 'Eight Station Demo' } },
].map(route => ({
  ...route,
  loadComponent: () => import('./retired-production-screen/retired-production-screen.component')
    .then(module => module.RetiredProductionScreenComponent),
}));
