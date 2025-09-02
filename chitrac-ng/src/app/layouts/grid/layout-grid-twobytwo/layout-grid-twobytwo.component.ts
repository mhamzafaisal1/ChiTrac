import {
    Component,
    Input,
    AfterViewInit,
    OnDestroy,
    ViewChildren,
    QueryList,
    ViewContainerRef,
    ElementRef,
    ChangeDetectionStrategy,
    Type,
    ComponentRef,
    HostListener,
    inject,
    EnvironmentInjector,
    ChangeDetectorRef
  } from '@angular/core';
  import { CommonModule } from '@angular/common';
  
  // Optional interface your pollable charts can implement.
  export interface PollableComponent {
    startPolling?: () => void;
    stopPolling?: () => void;
    setAvailableSize?: (w: number, h: number) => void;
  }
  
  @Component({
    selector: 'layout-grid-twobytwo',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './layout-grid-twobytwo.component.html',
    styleUrls: ['./layout-grid-twobytwo.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
  })
  export class LayoutGridTwoByTwoComponent implements AfterViewInit, OnDestroy {
    // Provide 1–4 component types. Required input.
    @Input() components: Type<unknown>[] = [];

    @ViewChildren('slot', { read: ViewContainerRef })
    private slots!: QueryList<ViewContainerRef>;

    private hostEl = inject(ElementRef<HTMLElement>);
    private env = inject(EnvironmentInjector);
    private cdr = inject(ChangeDetectorRef);
    private refs: ComponentRef<any>[] = [];

    // Stored for future scaling logic.
    private containerWidth = 0;
    private containerHeight = 0;
  
    ngAfterViewInit(): void {
      if (this.components.length === 0) {
        console.warn('LayoutGridTwoByTwoComponent: No components provided');
        return;
      }
      
      // Validate component count
      if (this.components.length > 4) {
        console.warn('LayoutGridTwoByTwoComponent: More than 4 components provided, using first 4');
      }
      
      console.log('LayoutGridTwoByTwoComponent: Components received:', this.components.length);
      this.measure();
      this.mountAll();
    }
  
    ngOnDestroy(): void {
      // Clear resize timeout
      if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
      }
      
      // Clean up component references
      for (const ref of this.refs) {
        (ref.instance as any)?.stopPolling?.();
        ref.destroy();
      }
      this.refs = [];
    }
  
    @HostListener('window:resize')
    onResize(): void {
      // Debounce resize events to avoid excessive updates
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = setTimeout(() => {
        this.measure();
        this.updateChildSizes();
      }, 100);
    }
    
    private resizeTimeout: any;
  
    // Measure container size and store privately.
    private measure(): void {
      const rect = this.hostEl.nativeElement.getBoundingClientRect();
      this.containerWidth = Math.max(0, Math.floor(rect.width));
      this.containerHeight = Math.max(0, Math.floor(rect.height));
      console.log('LayoutGridTwoByTwoComponent: Container size:', this.containerWidth, 'x', this.containerHeight);
    }
  
    private mountAll(): void {
      const slotsArr = this.slots.toArray();
      const count = Math.min(this.components.length, 4);

      // Clear all existing components first
      this.refs.forEach(ref => {
        (ref.instance as any)?.stopPolling?.();
        ref.destroy();
      });
      this.refs = [];

      for (let i = 0; i < 4; i++) {
        const slot = slotsArr[i];
        if (slot) {
          slot.clear();

          if (i < count) {
            try {
              const ref = slot.createComponent(this.components[i], { environmentInjector: this.env });
              this.refs.push(ref);

              const width = this.cellWidth();
              const height = this.cellHeight();
              console.log(`LayoutGridTwoByTwoComponent: Mounting component ${i}, size: ${width}x${height}`);

              // Set chart dimensions using setInput for proper change detection
              ref.setInput('chartWidth', width);
              ref.setInput('chartHeight', height);
              
              // Call optional methods if they exist
              (ref.instance as any)?.setAvailableSize?.(width, height);
              (ref.instance as any)?.startPolling?.();

              ref.changeDetectorRef.detectChanges();
            } catch (error) {
              console.error(`LayoutGridTwoByTwoComponent: Error mounting component ${i}:`, error);
            }
          }
        }
      }
      this.cdr.markForCheck();
    }
  
    private updateChildSizes(): void {
      const width = this.cellWidth();
      const height = this.cellHeight();
      
      for (const ref of this.refs) {
        ref.setInput('chartWidth', width);
        ref.setInput('chartHeight', height);
        (ref.instance as any)?.setAvailableSize?.(width, height);
        ref.changeDetectorRef.markForCheck();
      }
      this.cdr.markForCheck();
    }
  
    private cellWidth(): number {
      const cols = this.getColumnCount();
      const padding = 16; // Account for grid gap and padding
      return Math.max(200, Math.floor((this.containerWidth - padding) / cols));
    }
    
    private cellHeight(): number {
      const rows = this.getRowCount();
      const padding = 16; // Account for grid gap and padding
      return Math.max(200, Math.floor((this.containerHeight - padding) / rows));
    }
    
    private getColumnCount(): number {
      return window.innerWidth <= 768 ? 1 : 2;
    }
    
    private getRowCount(): number {
      if (window.innerWidth <= 768) {
        // Single column layout - each component gets its own row
        return Math.max(1, this.components.length);
      } else {
        // 2x2 grid layout
        return 2;
      }
    }


    
    // Public method for debugging - get current grid configuration
    getGridInfo(): { columns: number; rows: number; cellWidth: number; cellHeight: number; componentCount: number } {
      return {
        columns: this.getColumnCount(),
        rows: this.getRowCount(),
        cellWidth: this.cellWidth(),
        cellHeight: this.cellHeight(),
        componentCount: this.components.length
      };
    }
  }
  