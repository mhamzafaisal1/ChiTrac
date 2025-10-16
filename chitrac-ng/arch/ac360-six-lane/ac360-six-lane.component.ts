import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SixLaneFlipperComponent } from '../blanket-blaster/six-lane-flipper/six-lane-flipper.component';

@Component({
    selector: 'app-ac360-six-lane',
    imports: [
        CommonModule,
        SixLaneFlipperComponent
    ],
    templateUrl: './ac360-six-lane.component.html',
    styleUrl: './ac360-six-lane.component.scss'
})
export class AC360SixLaneComponent {
  // Component is now empty as it just serves as a container for the six-lane-flipper
}
