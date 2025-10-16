import { Injectable } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject, Observable } from 'rxjs';

export interface ErrorInfo {
  id: string;
  message: string;
  statusCode?: number;
  endpoint?: string;
  timestamp: Date;
  fullError?: any;
}

@Injectable({
  providedIn: 'root'
})
export class ErrorQueueService {
  private errorQueue: ErrorInfo[] = [];
  private currentDialogRef: MatDialogRef<any> | null = null;
  private isDisplaying = false;
  private errorQueueSubject = new BehaviorSubject<ErrorInfo[]>([]);

  constructor(private dialog: MatDialog) {}

  /**
   * Add an error to the queue
   */
  addError(error: Partial<ErrorInfo>): void {
    const errorInfo: ErrorInfo = {
      id: this.generateErrorId(),
      message: error.message || 'An unknown error occurred',
      statusCode: error.statusCode,
      endpoint: error.endpoint,
      timestamp: new Date(),
      fullError: error.fullError
    };

    this.errorQueue.push(errorInfo);
    this.errorQueueSubject.next([...this.errorQueue]);

    // If not currently displaying an error, show this one
    if (!this.isDisplaying) {
      this.displayNextError();
    }
  }

  /**
   * Display the next error in the queue
   */
  private async displayNextError(): Promise<void> {
    if (this.errorQueue.length === 0 || this.isDisplaying) {
      return;
    }

    this.isDisplaying = true;
    const currentError = this.errorQueue[0];

    try {
      // Dynamically import the error modal component to avoid circular dependencies
      const { ErrorModalComponent } = await import('../components/error-modal/error-modal.component');

      this.currentDialogRef = this.dialog.open(ErrorModalComponent, {
        data: currentError,
        width: '600px',
        maxWidth: '90vw',
        disableClose: false,
        panelClass: 'error-modal-panel'
      });

      this.currentDialogRef.afterClosed().subscribe(() => {
        this.removeCurrentError();
        this.isDisplaying = false;
        this.currentDialogRef = null;

        // Display next error if available
        if (this.errorQueue.length > 0) {
          // Small delay to prevent jarring transitions
          setTimeout(() => this.displayNextError(), 200);
        }
      });
    } catch (error) {
      console.error('[ErrorQueueService] Error opening modal:', error);
      this.isDisplaying = false;
    }
  }

  /**
   * Remove the current (first) error from the queue
   */
  private removeCurrentError(): void {
    if (this.errorQueue.length > 0) {
      this.errorQueue.shift();
      this.errorQueueSubject.next([...this.errorQueue]);
    }
  }

  /**
   * Get the current error queue as an observable
   */
  getErrorQueue(): Observable<ErrorInfo[]> {
    return this.errorQueueSubject.asObservable();
  }

  /**
   * Get the current error queue count
   */
  getQueueCount(): number {
    return this.errorQueue.length;
  }

  /**
   * Clear all errors from the queue
   */
  clearQueue(): void {
    this.errorQueue = [];
    this.errorQueueSubject.next([]);
    if (this.currentDialogRef) {
      this.currentDialogRef.close();
      this.currentDialogRef = null;
    }
    this.isDisplaying = false;
  }

  /**
   * Generate a unique error ID
   */
  private generateErrorId(): string {
    return `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

