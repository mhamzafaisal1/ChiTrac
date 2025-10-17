import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { LayoutGridThreeByThreeComponent } from "../../../src/app/layouts/grid/layout-grid-threebythree/layout-grid-threebythree.component";
import { DailyMachineStackedBarChartComponent } from "../../../src/app/charts/daily-machine-stacked-bar-chart/daily-machine-stacked-bar-chart.component";
import { DailyMachineOeeBarChartComponent } from "../../../src/app/charts/daily-machine-oee-bar-chart/daily-machine-oee-bar-chart.component";
import { RankedOperatorBarChartComponent } from "../../../src/app/charts/ranked-operator-bar-chart/ranked-operator-bar-chart.component";
import { DailyCountBarChartComponent } from "../../../src/app/charts/daily-count-bar-chart/daily-count-bar-chart.component";

@Component({
    selector: "app-threebythree-dashboard",
    standalone: true,
    imports: [
        CommonModule,
        LayoutGridThreeByThreeComponent
    ],
    templateUrl: "./threebythree-dashboard.component.html",
    styleUrls: ["./threebythree-dashboard.component.scss"]
})
export class ThreebythreeDashboardComponent implements OnInit {
  // Component references for the 3x3 grid (all nine components from test.component.ts)
  threeByThreeComponents = [
    DailyMachineStackedBarChartComponent,
    DailyMachineOeeBarChartComponent,
    RankedOperatorBarChartComponent,
    DailyCountBarChartComponent,
    DailyMachineStackedBarChartComponent, // Reuse
    DailyMachineOeeBarChartComponent,     // Reuse
    RankedOperatorBarChartComponent,      // Reuse
    DailyCountBarChartComponent,          // Reuse
    DailyMachineStackedBarChartComponent  // Reuse
  ];

  ngOnInit(): void {
    console.log('ThreebythreeDashboardComponent: Initialized');
    console.log('ThreebythreeDashboardComponent: 3x3 Components count:', this.threeByThreeComponents.length);
  }
}
