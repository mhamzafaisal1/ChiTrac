import { Component, OnInit, Input, OnChanges, SimpleChanges } from '@angular/core';

@Component({
    selector: 'ct-data-bar',
    templateUrl: './data-bar.component.html',
    styleUrls: ['./data-bar.component.scss'],
    standalone: false
})
export class DataBarComponent implements OnInit, OnChanges {

  @Input()
  efficiency: any;

  @Input()
  margin: any;

  constructor() { }

  ngOnInit() {
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['efficiency'] && this.efficiency) {
      console.log('DataBar received efficiency:', this.efficiency);
    }
  }

}
