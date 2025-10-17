import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { LayoutGridTwoByTwoComponent } from "../../../src/app/layouts/grid/layout-grid-twobytwo/layout-grid-twobytwo.component";
import { DailyMachineStackedBarChartComponent } from "../../../src/app/charts/daily-machine-stacked-bar-chart/daily-machine-stacked-bar-chart.component";
import { DailyMachineOeeBarChartComponent } from "../../../src/app/charts/daily-machine-oee-bar-chart/daily-machine-oee-bar-chart.component";
import { RankedOperatorBarChartComponent } from "../../../src/app/charts/ranked-operator-bar-chart/ranked-operator-bar-chart.component";
import { DailyCountBarChartComponent } from "../../../src/app/charts/daily-count-bar-chart/daily-count-bar-chart.component";

@Component({
    selector: "app-twobytwo-dashboard",
    standalone: true,
    imports: [
        CommonModule,
        LayoutGridTwoByTwoComponent
    ],
    templateUrl: "./twobytwo-dashboard.component.html",
    styleUrls: ["./twobytwo-dashboard.component.scss"]
})
export class TwobytwoDashboardComponent implements OnInit {
  // Component references for the 2x2 grid (first four components from test.component.ts)
  twoByTwoComponents = [
    DailyMachineStackedBarChartComponent,
    DailyMachineOeeBarChartComponent,
    RankedOperatorBarChartComponent,
    DailyCountBarChartComponent
  ];

  ngOnInit(): void {
    console.log('TwobytwoDashboardComponent: Initialized');
    console.log('TwobytwoDashboardComponent: 2x2 Components count:', this.twoByTwoComponents.length);
  }
}
