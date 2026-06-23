import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { ErrorInfo } from '../../services/error-queue.service';
import { Clipboard } from '@angular/cdk/clipboard';
import { JiraService } from '../../services/jira.service';
import { finalize } from 'rxjs/operators';

@Component({
  selector: 'app-error-modal',
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './error-modal.component.html',
  styleUrls: ['./error-modal.component.scss']
})
export class ErrorModalComponent {
  dialogRef = inject(MatDialogRef<ErrorModalComponent>);
  errorData: ErrorInfo = inject(MAT_DIALOG_DATA);
  private clipboard = inject(Clipboard);
  private jiraService = inject(JiraService);

  copySuccess = false;
  isReportingBug = false;
  reportErrorMessage = '';
  createdIssue: { key: string; url: string; action?: 'created' | 'commented' } | null = null;

  /**
   * Format the error data for clipboard
   */
  getFormattedErrorText(): string {
    const lines: string[] = [];
    
    lines.push('=== ERROR REPORT ===');
    lines.push('');
    lines.push(`Timestamp: ${this.errorData.timestamp.toLocaleString()}`);
    
    if (this.errorData.statusCode) {
      lines.push(`Status Code: ${this.errorData.statusCode}`);
    }
    
    if (this.errorData.endpoint) {
      lines.push(`Endpoint: ${this.errorData.endpoint}`);
    }
    
    lines.push('');
    lines.push('Message:');
    lines.push(this.errorData.message);
    
    if (this.errorData.fullError) {
      lines.push('');
      lines.push('Full Error Details:');
      lines.push(JSON.stringify(this.errorData.fullError, null, 2));
    }
    
    lines.push('');
    lines.push('=== END ERROR REPORT ===');
    
    return lines.join('\n');
  }

  /**
   * Copy error details to clipboard
   */
  copyToClipboard(): void {
    const errorText = this.getFormattedErrorText();
    const success = this.clipboard.copy(errorText);
    
    if (success) {
      this.copySuccess = true;
      
      // Reset the success indicator after 2 seconds
      setTimeout(() => {
        this.copySuccess = false;
      }, 2000);
    }
  }

  /**
   * Create a Jira bug from the current error details
   */
  reportToJira(): void {
    if (this.isReportingBug || this.createdIssue) {
      return;
    }

    this.reportErrorMessage = '';
    this.isReportingBug = true;

    this.jiraService.reportBug(this.errorData).pipe(
      finalize(() => {
        this.isReportingBug = false;
      })
    ).subscribe({
      next: (response) => {
        this.createdIssue = {
          key: response.key,
          url: response.url,
          action: response.action
        };
      },
      error: (error) => {
        this.reportErrorMessage = error?.error?.error || error?.message || 'Failed to create Jira bug report.';
      }
    });
  }

  /**
   * Close the modal
   */
  close(): void {
    this.dialogRef.close();
  }

  /**
   * Format timestamp for display
   */
  getFormattedTime(): string {
    return this.errorData.timestamp.toLocaleTimeString();
  }

  /**
   * Get error severity class based on status code
   */
  getSeverityClass(): string {
    if (!this.errorData.statusCode) {
      return 'error-unknown';
    }
    
    if (this.errorData.statusCode >= 500) {
      return 'error-server';
    } else if (this.errorData.statusCode >= 400) {
      return 'error-client';
    } else {
      return 'error-unknown';
    }
  }

  getJiraReportStatusText(): string {
    return this.createdIssue?.action === 'commented'
      ? 'Added report to existing Jira bug'
      : 'Created Jira bug';
  }
}

