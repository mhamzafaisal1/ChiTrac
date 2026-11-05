import { Component, OnInit, Input } from '@angular/core';

@Component({
    selector: 'ct-lane-running-greyed',
    templateUrl: './lane-running-greyed.component.html',
    styleUrls: ['./lane-running-greyed.component.scss'],
    standalone: false
})
export class LaneRunningGreyedComponent implements OnInit {

  @Input()
  lane: any;

  constructor() { }

  ngOnInit() {
  }

}
