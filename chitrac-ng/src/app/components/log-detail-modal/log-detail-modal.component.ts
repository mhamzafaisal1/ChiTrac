import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { Clipboard } from '@angular/cdk/clipboard';
import { ServerLog } from '../../services/server-logs.service';

@Component({
  selector: 'app-log-detail-modal',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './log-detail-modal.component.html',
  styleUrls: ['./log-detail-modal.component.scss']
})
export class LogDetailModalComponent {
  dialogRef = inject(MatDialogRef<LogDetailModalComponent>);
  logData: ServerLog = inject(MAT_DIALOG_DATA);
  private clipboard = inject(Clipboard);

  copySuccess = false;

  /**
   * Format the log data for clipboard
   */
  getFormattedLogText(): string {
    const lines: string[] = [];
    
    lines.push('=== SERVER LOG ENTRY ===');
    lines.push('');
    lines.push(`Timestamp: ${new Date(this.logData.timestamp).toLocaleString()}`);
    lines.push(`Level: ${this.logData.level}`);
    lines.push(`Hostname: ${this.logData.hostname || 'N/A'}`);
    lines.push('');
    lines.push('Message:');
    lines.push(this.logData.message || 'N/A');
    
    if (this.logData.meta) {
      lines.push('');
      lines.push('Metadata:');
      lines.push(JSON.stringify(this.logData.meta, null, 2));
    }
    
    lines.push('');
    lines.push('Full Log Data:');
    lines.push(JSON.stringify(this.logData, null, 2));
    lines.push('');
    lines.push('=== END LOG ENTRY ===');
    
    return lines.join('\n');
  }

  /**
   * Copy log details to clipboard
   */
  copyToClipboard(): void {
    const logText = this.getFormattedLogText();
    const success = this.clipboard.copy(logText);
    
    if (success) {
      this.copySuccess = true;
      
      // Reset the success indicator after 2 seconds
      setTimeout(() => {
        this.copySuccess = false;
      }, 2000);
    }
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
    return new Date(this.logData.timestamp).toLocaleString();
  }

  /**
   * Get log level class based on level
   */
  getLevelClass(): string {
    const level = (this.logData.level || '').toLowerCase();
    if (level === 'error') return 'log-error';
    if (level === 'warn') return 'log-warn';
    if (level === 'info') return 'log-info';
    if (level === 'http') return 'log-http';
    return 'log-unknown';
  }
}

