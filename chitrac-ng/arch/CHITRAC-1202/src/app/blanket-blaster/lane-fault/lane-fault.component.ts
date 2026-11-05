import { Component, OnInit, Input } from '@angular/core';

@Component({
    selector: 'ct-lane-fault',
    templateUrl: './lane-fault.component.html',
    styleUrls: ['./lane-fault.component.scss'],
    standalone: false
})
export class LaneFaultComponent implements OnInit {

  @Input()
  lane: any;

  constructor() { }

  ngOnInit() {
  }

}
