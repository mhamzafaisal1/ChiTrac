import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { PageEvent, MatPaginator } from '@angular/material/paginator';
import { MatCardModule } from '@angular/material/card';

import { Subscription, timer } from 'rxjs';
import { startWith, switchMap, share, retry } from 'rxjs/operators';

import { StatusConfig } from '../shared/models/status.model';


import { ConfigurationService } from '../configuration.service';

@Component({
    selector: 'app-config-grid-test',
    imports: [CommonModule, MatTableModule, MatPaginator, MatCardModule],
    templateUrl: './config-grid-test.component.html',
    styleUrl: './config-grid-test.component.scss'
})
export class ConfigGridTestComponent implements OnInit, OnDestroy {
  public statuses: StatusConfig[];
  public dataSource: MatTableDataSource<StatusConfig>;
  sub: Subscription;
  page: number = 1;
  paginationSize: number = 10;

  displayedColumns: string[] = ['code', 'name', 'jam'];

  @ViewChild(MatPaginator) paginator!: MatPaginator;

  constructor(private configurationService: ConfigurationService) { }

  ngOnInit() {
    this.sub = timer(1, (60*5*1000))
      .pipe(
        switchMap(() => this.configurationService.getStatusConfigs()),
        retry(),
        share()
    ).subscribe(res => {
      this.dataSource = new MatTableDataSource(res);
      this.dataSource.paginator = this.paginator;
    });
  }

  handlePageEvent(e: PageEvent) {
    this.page = e.pageIndex;
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
  }

}
