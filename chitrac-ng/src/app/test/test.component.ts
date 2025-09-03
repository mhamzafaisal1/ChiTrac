import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { BlanketBlasterModule } from "../blanket-blaster/blanket-blaster.module";
import { DailyMachineItemStackedBarChartComponent } from "../charts/daily-machine-item-stacked-bar-chart/daily-machine-item-stacked-bar-chart.component";
import { LayoutGridThreeByThreeComponent } from "../layouts/grid/layout-grid-threebythree/layout-grid-threebythree.component";
import { DailyMachineStackedBarChartComponent } from "../charts/daily-machine-stacked-bar-chart/daily-machine-stacked-bar-chart.component";
import { DailyMachineOeeBarChartComponent } from "../charts/daily-machine-oee-bar-chart/daily-machine-oee-bar-chart.component";
import { RankedOperatorBarChartComponent } from "../charts/ranked-operator-bar-chart/ranked-operator-bar-chart.component";
import { DailyCountBarChartComponent } from "../charts/daily-count-bar-chart/daily-count-bar-chart.component";

@Component({
    selector: "app-test",
    standalone: true,
    imports: [
      LayoutGridThreeByThreeComponent
    ],
    templateUrl: "./test.component.html",
    styleUrls: ["./test.component.scss"]
})
export class TestComponent implements OnInit {
  // Component references for the 3x3 grid (reusing the same components)
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
    console.log('TestComponent: Initialized');
    console.log('TestComponent: 3x3 Components count:', this.threeByThreeComponents.length);
  }
}
