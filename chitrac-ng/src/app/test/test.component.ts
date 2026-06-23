import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { ErrorQueueService } from "../services/error-queue.service";

@Component({
    selector: "app-test",
    standalone: true,
    imports: [
      CommonModule,
      MatButtonModule,
      MatIconModule,
    ],
    templateUrl: "./test.component.html",
    styleUrls: ["./test.component.scss"]
})
export class TestComponent implements OnInit {
  ngOnInit(): void {
    console.log('TestComponent: Initialized');
  }

  constructor(private errorQueueService: ErrorQueueService) {}

  openJiraReportTestError(): void {
    this.errorQueueService.addError({
      message: "TEST - Jira bug report flow from ChiTrac test page",
      statusCode: 500,
      endpoint: "/ng/test",
      fullError: {
        type: "ManualTestError",
        source: "TestComponent.openJiraReportTestError",
        note: "This is a generated test error for validating the error modal Report Bug button.",
        timestamp: new Date().toISOString()
      }
    });
  }
}
