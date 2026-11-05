import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataBarComponent } from '../lane-components/data-bar/data-bar.component';

@Component({
    selector: 'ct-lane-oee',
    templateUrl: './lane-oee.component.html',
    styleUrls: ['./lane-oee.component.scss'],
    standalone: true,
    imports: [CommonModule, DataBarComponent]
})
export class LaneOeeComponent implements OnInit {

  @Input()
  lane: any;

  constructor() { }

  ngOnInit() {
  }

}
