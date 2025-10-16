/**
 * ERROR MODAL DEMO COMPONENT
 * 
 * This is a demo/example component showing how to use the ErrorQueueService
 * 
 * To use this demo:
 * 1. Add to app.routes.ts: { path: 'ng/error-modal-demo', component: ErrorModalDemoComponent }
 * 2. Navigate to /ng/error-modal-demo
 * 3. Click the buttons to test different error scenarios
 */

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { ErrorQueueService } from '../../services/error-queue.service';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-error-modal-demo',
  imports: [CommonModule, MatButtonModule, MatIconModule, MatCardModule],
  template: `
    <div class="demo-container">
      <mat-card>
        <mat-card-header>
          <mat-card-title>
            <mat-icon>bug_report</mat-icon>
            Error Modal System Demo
          </mat-card-title>
        </mat-card-header>
        
        <mat-card-content>
          <p>This demo shows how the error modal system works. Click the buttons below to trigger different types of errors:</p>
          
          <div class="button-group">
            <h3>Automatic API Error Handling</h3>
            <p>These trigger real API errors that are automatically caught by the ErrorInterceptor:</p>
            
            <button mat-raised-button color="warn" (click)="trigger404Error()">
              <mat-icon>cloud_off</mat-icon>
              Trigger 404 Error
            </button>
            
            <button mat-raised-button color="warn" (click)="trigger500Error()">
              <mat-icon>error</mat-icon>
              Trigger 500 Error
            </button>
            
            <button mat-raised-button color="warn" (click)="triggerNetworkError()">
              <mat-icon>wifi_off</mat-icon>
              Trigger Network Error
            </button>
          </div>

          <div class="button-group">
            <h3>Manual Error Triggering</h3>
            <p>These manually add errors to the queue using ErrorQueueService:</p>
            
            <button mat-raised-button color="primary" (click)="triggerValidationError()">
              <mat-icon>warning</mat-icon>
              Validation Error
            </button>
            
            <button mat-raised-button color="primary" (click)="triggerBusinessLogicError()">
              <mat-icon>business</mat-icon>
              Business Logic Error
            </button>
            
            <button mat-raised-button color="primary" (click)="triggerCustomError()">
              <mat-icon>bug_report</mat-icon>
              Custom Error with Details
            </button>
          </div>

          <div class="button-group">
            <h3>Queue Management</h3>
            <p>Test the error queue functionality:</p>
            
            <button mat-raised-button (click)="triggerMultipleErrors()">
              <mat-icon>queue</mat-icon>
              Add 3 Errors to Queue
            </button>
            
            <button mat-raised-button (click)="clearErrorQueue()">
              <mat-icon>clear_all</mat-icon>
              Clear Error Queue
            </button>
            
            <p class="queue-info">
              <mat-icon>info</mat-icon>
              Current queue size: {{ errorQueueService.getQueueCount() }}
            </p>
          </div>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .demo-container {
      padding: 20px;
      max-width: 800px;
      margin: 0 auto;
    }

    mat-card {
      margin-bottom: 20px;
    }

    mat-card-header {
      margin-bottom: 20px;
    }

    mat-card-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 24px;
    }

    .button-group {
      margin: 30px 0;
      padding: 20px;
      background-color: #f5f5f5;
      border-radius: 8px;
      border-left: 4px solid #3f51b5;
    }

    .button-group h3 {
      margin-top: 0;
      color: #3f51b5;
    }

    .button-group p {
      color: #666;
      margin-bottom: 15px;
    }

    .button-group button {
      margin: 8px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .queue-info {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 15px;
      padding: 10px;
      background-color: #e3f2fd;
      border-radius: 4px;
      font-weight: 600;
    }

    :host-context(.dark-theme) .button-group {
      background-color: #2d2d2d;
    }

    :host-context(.dark-theme) .queue-info {
      background-color: #1e3a5f;
      color: #fff;
    }
  `]
})
export class ErrorModalDemoComponent {
  constructor(
    public errorQueueService: ErrorQueueService,
    private http: HttpClient
  ) {}

  // Automatic API Error Handling Examples
  
  trigger404Error() {
    // This will trigger a 404 error that's automatically caught
    this.http.get('/api/nonexistent-endpoint').subscribe({
      next: () => {},
      error: () => {} // Error is handled by interceptor
    });
  }

  trigger500Error() {
    // Simulate a server error (you'd need an endpoint that returns 500)
    this.http.get('/api/error/500').subscribe({
      next: () => {},
      error: () => {} // Error is handled by interceptor
    });
  }

  triggerNetworkError() {
    // Try to connect to an invalid domain
    this.http.get('https://invalid-domain-that-does-not-exist-12345.com/api').subscribe({
      next: () => {},
      error: () => {} // Error is handled by interceptor
    });
  }

  // Manual Error Triggering Examples

  triggerValidationError() {
    this.errorQueueService.addError({
      message: 'Validation failed: Please fill in all required fields before submitting.',
      statusCode: 400,
      endpoint: 'Client-Side Validation',
      fullError: {
        type: 'ValidationError',
        fields: ['email', 'password'],
        timestamp: new Date()
      }
    });
  }

  triggerBusinessLogicError() {
    this.errorQueueService.addError({
      message: 'Cannot process order: Account balance is insufficient.',
      statusCode: 422,
      endpoint: 'Order Processing',
      fullError: {
        type: 'BusinessLogicError',
        accountBalance: 50.00,
        orderTotal: 125.99,
        shortfall: 75.99,
        currency: 'USD'
      }
    });
  }

  triggerCustomError() {
    this.errorQueueService.addError({
      message: 'An unexpected error occurred while processing your request. Our team has been notified.',
      statusCode: 500,
      endpoint: 'Custom Operation',
      fullError: {
        type: 'CustomError',
        operation: 'complexDataProcessing',
        stackTrace: 'Error: Something went wrong\n  at processData (file.ts:123)\n  at main (app.ts:456)',
        userAgent: navigator.userAgent,
        timestamp: new Date(),
        sessionId: 'session-' + Math.random().toString(36).substr(2, 9)
      }
    });
  }

  // Queue Management Examples

  triggerMultipleErrors() {
    // Add multiple errors to test the queue
    this.errorQueueService.addError({
      message: 'First error in the queue',
      statusCode: 400
    });

    setTimeout(() => {
      this.errorQueueService.addError({
        message: 'Second error in the queue',
        statusCode: 401
      });
    }, 100);

    setTimeout(() => {
      this.errorQueueService.addError({
        message: 'Third error in the queue',
        statusCode: 500
      });
    }, 200);
  }

  clearErrorQueue() {
    this.errorQueueService.clearQueue();
  }
}

