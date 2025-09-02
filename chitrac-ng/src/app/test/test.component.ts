import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { BlanketBlasterModule } from "../blanket-blaster/blanket-blaster.module";
import { DailyMachineItemStackedBarChartComponent } from "../charts/daily-machine-item-stacked-bar-chart/daily-machine-item-stacked-bar-chart.component";
import { LayoutGridTwoByTwoComponent } from "../layouts/grid/layout-grid-twobytwo/layout-grid-twobytwo.component";
import { DailyMachineStackedBarChartComponent } from "../charts/daily-machine-stacked-bar-chart/daily-machine-stacked-bar-chart.component";
import { DailyMachineOeeBarChartComponent } from "../charts/daily-machine-oee-bar-chart/daily-machine-oee-bar-chart.component";
import { RankedOperatorBarChartComponent } from "../charts/ranked-operator-bar-chart/ranked-operator-bar-chart.component";
import { DailyCountBarChartComponent } from "../charts/daily-count-bar-chart/daily-count-bar-chart.component";

@Component({
    selector: "app-test",
    standalone: true,
    imports: [
        CommonModule,
        BlanketBlasterModule,
        DailyMachineItemStackedBarChartComponent,
        LayoutGridTwoByTwoComponent,
        DailyMachineStackedBarChartComponent,
        DailyMachineOeeBarChartComponent,
        RankedOperatorBarChartComponent,
        DailyCountBarChartComponent
    ],
    templateUrl: "./test.component.html",
    styleUrls: ["./test.component.scss"]
})
export class TestComponent implements OnInit {
  // Component references for the grid
  DailyMachineStackedBarChartComponent = DailyMachineStackedBarChartComponent;
  DailyMachineOeeBarChartComponent = DailyMachineOeeBarChartComponent;
  RankedOperatorBarChartComponent = RankedOperatorBarChartComponent;
  DailyCountBarChartComponent = DailyCountBarChartComponent;

  ngOnInit(): void {
    console.log('TestComponent: Initialized');
    console.log('TestComponent: Components available:', {
      DailyMachineStackedBarChartComponent: !!this.DailyMachineStackedBarChartComponent,
      DailyMachineOeeBarChartComponent: !!this.DailyMachineOeeBarChartComponent,
      RankedOperatorBarChartComponent: !!this.RankedOperatorBarChartComponent,
      DailyCountBarChartComponent: !!this.DailyCountBarChartComponent
    });
  }
}
