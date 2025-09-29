import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { LayoutGridTwoByThreeComponent } from "../../layouts/grid/layout-grid-twobythree/layout-grid-twobythree.component";
import { DailyMachineStackedBarChartComponent } from "../../charts/daily-machine-stacked-bar-chart/daily-machine-stacked-bar-chart.component";
import { DailyMachineOeeBarChartComponent } from "../../charts/daily-machine-oee-bar-chart/daily-machine-oee-bar-chart.component";
import { RankedOperatorBarChartComponent } from "../../charts/ranked-operator-bar-chart/ranked-operator-bar-chart.component";
import { DailyCountBarChartComponent } from "../../charts/daily-count-bar-chart/daily-count-bar-chart.component";
import { PlantwideMetricsChartComponent } from "../../charts/plantwide-metrics-chart/plantwide-metrics-chart.component";

@Component({
    selector: "app-twobythree-dashboard",
    standalone: true,
    imports: [
        CommonModule,
        LayoutGridTwoByThreeComponent,
    ],
    templateUrl: "./twobythree-dashboard.component.html",
    styleUrls: ["./twobythree-dashboard.component.scss"]
})
export class TwobythreeDashboardComponent implements OnInit {
  // Component references for the 2x3 grid (six components total)
  twoByThreeComponents = [
    DailyMachineStackedBarChartComponent,
    DailyMachineOeeBarChartComponent,
    RankedOperatorBarChartComponent,
    DailyCountBarChartComponent,
    PlantwideMetricsChartComponent,
    DailyCountBarChartComponent  // Reuse DailyCountBarChartComponent
  ];

  ngOnInit(): void {
    console.log('TwobythreeDashboardComponent: Initialized');
    console.log('TwobythreeDashboardComponent: 2x3 Components count:', this.twoByThreeComponents.length);
  }
}
