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
  @Input()
  get value(): string {
    return this._value;
  }
  set value(value: string) {
    this._value = value || '';
    this.syncPickerValues(this._value);
  }
  @Input() disabled: boolean = false;
  @Input() showTimeframes: boolean = false;
  @Output() valueChange = new EventEmitter<string>();
  @Output() timeframeChange = new EventEmitter<{start: string, end: string}>();

  isDarkTheme = false;
  selectedTimeframe: string = '';
  readonly hours = ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
  readonly minutes = Array.from({ length: 60 }, (_, index) => index.toString().padStart(2, '0'));
  dateValue: string = '';
  hourValue: string = '12';
  minuteValue: string = '00';
  meridiemValue: 'AM' | 'PM' = 'AM';
  private _value: string = '';
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

  onPickerChange(): void {
    this._value = this.dateValue ? `${this.dateValue}T${this.getTwentyFourHourValue()}:${this.minuteValue}` : '';
    this.valueChange.emit(this._value);
  }

  private detectTheme() {
    const dark = document.body.classList.contains('dark-theme');
    this.isDarkTheme = dark;
    const el = this.elRef.nativeElement;
  }

  private syncPickerValues(value: string): void {
    if (!value) {
      this.dateValue = '';
      this.hourValue = '12';
      this.minuteValue = '00';
      this.meridiemValue = 'AM';
      return;
    }

    const localDateTime = this.parseDateTime(value);
    if (!localDateTime) return;

    const { date, hour, minute } = localDateTime;
    const hour12 = hour % 12 || 12;
    this.dateValue = date;
    this.hourValue = hour12.toString();
    this.minuteValue = minute.toString().padStart(2, '0');
    this.meridiemValue = hour >= 12 ? 'PM' : 'AM';
  }

  private parseDateTime(value: string): { date: string; hour: number; minute: number } | null {
    const dateOnlyMatch = value.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (dateOnlyMatch) {
      return {
        date: dateOnlyMatch[1],
        hour: 0,
        minute: 0
      };
    }

    const localDateTimeMatch = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
    if (localDateTimeMatch && !/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) {
      return {
        date: localDateTimeMatch[1],
        hour: Number(localDateTimeMatch[2]),
        minute: Number(localDateTimeMatch[3])
      };
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    return {
      date: `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`,
      hour: date.getHours(),
      minute: date.getMinutes()
    };
  }

  private getTwentyFourHourValue(): string {
    const hour = Number(this.hourValue);
    const hour24 = this.meridiemValue === 'PM' ? (hour % 12) + 12 : hour % 12;
    return hour24.toString().padStart(2, '0');
  }
}
