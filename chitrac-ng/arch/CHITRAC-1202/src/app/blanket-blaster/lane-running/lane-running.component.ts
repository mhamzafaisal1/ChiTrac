import { Component, OnInit, Input } from '@angular/core';

@Component({
    selector: 'ct-lane-running',
    templateUrl: './lane-running.component.html',
    styleUrls: ['./lane-running.component.scss'],
    standalone: false
})
export class LaneRunningComponent implements OnInit {

  @Input()
  lane: any;

  constructor() { }

  ngOnInit() {
  }

}
