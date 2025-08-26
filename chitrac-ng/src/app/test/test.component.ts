import { Component } from "@angular/core";
import { CommonModule } from "@angular/common";
import { BlanketBlasterModule } from "../blanket-blaster/blanket-blaster.module";
import { DailyMachineItemStackedBarChartComponent } from "../charts/daily-machine-item-stacked-bar-chart/daily-machine-item-stacked-bar-chart.component";

@Component({
    selector: "app-test",
    standalone: true,
    imports: [
        CommonModule,
        BlanketBlasterModule,
        DailyMachineItemStackedBarChartComponent
    ],
    templateUrl: "./test.component.html",
    styleUrls: ["./test.component.scss"]
})
export class TestComponent {
  // Component is now empty as it just serves as a container for the demo-flipper
}
