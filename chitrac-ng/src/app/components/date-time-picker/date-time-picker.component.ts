import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ElementRef, Renderer2 } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-date-time-picker',
    imports: [CommonModule, FormsModule],
    templateUrl: './date-time-picker.component.html',
    styleUrls: ['./date-time-picker.component.scss']
})
export class DateTimePickerComponent implements OnInit, OnDestroy {
  @Input() label: string = '';
  @Input() value: string = '';
  @Input() disabled: boolean = false;
  @Input() showTimeframes: boolean = false;
  @Output() valueChange = new EventEmitter<string>();
  @Output() timeframeChange = new EventEmitter<{start: string, end: string}>();

  isDarkTheme = false;
  selectedTimeframe: string = '';
  private observer!: MutationObserver;

  get inputId(): string {
    return this.label.toLowerCase().replace(/\s+/g, '-') + '-input';
  }

  constructor(private renderer: Renderer2, private elRef: ElementRef) {}

  ngOnInit() {
    this.detectTheme();
    this.observer = new MutationObserver(() => this.detectTheme());
    this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }

  onTimeframeSelect(timeframe: string): void {
    this.selectedTimeframe = timeframe;
    const now = new Date();
    let start: Date;
    let end: Date;

    if (timeframe === 'thisWeek') {
      // Calculate start of current week (Sunday)
      start = new Date(now);
      const day = start.getDay();
      start.setDate(start.getDate() - day);
      start.setHours(0, 0, 0, 0);
      
      // Calculate end of current week (Saturday)
      end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
    } else if (timeframe === 'thisMonth') {
      // Calculate start of current month
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      start.setHours(0, 0, 0, 0);
      
      // Calculate end of current month
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
    } else {
      return; // Invalid timeframe
    }

    // Set the value to the start date for the input
    this.value = start.toISOString().slice(0, 16); // Format for datetime-local input
    this.valueChange.emit(this.value);
    
    // Emit the full range for parent components that need it
    this.timeframeChange.emit({
      start: start.toISOString(),
      end: end.toISOString()
    });
  }

  private detectTheme() {
    const dark = document.body.classList.contains('dark-theme');
    this.isDarkTheme = dark;
    const el = this.elRef.nativeElement;
  }
}
