import {
    Component,
    Input,
    AfterViewInit,
    OnDestroy,
    OnChanges,
    SimpleChanges,
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
    selector: 'layout-grid-twobythree',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './layout-grid-twobythree.component.html',
    styleUrls: ['./layout-grid-twobythree.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
  })
  export class LayoutGridTwoByThreeComponent implements AfterViewInit, OnDestroy, OnChanges {
    // Provide 1–6 component types. Required input.
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
  private resizeObserver?: ResizeObserver;

  ngOnChanges(_changes: SimpleChanges): void {
    if (this.slots) { this.measure(); this.mountAll(); }
  }
  
      ngAfterViewInit(): void {
    if (this.components.length === 0) {
      console.warn('LayoutGridTwoByThreeComponent: No components provided');
      return;
    }
    
    // Validate component count
    if (this.components.length > 6) {
      console.warn('LayoutGridTwoByThreeComponent: More than 6 components provided, using first 6');
    }
    
    console.log('LayoutGridTwoByThreeComponent: Components received:', this.components.length);
    
    // Use requestAnimationFrame to ensure DOM is fully rendered
    requestAnimationFrame(() => {
      this.measure();
      // If dimensions are still 0, wait a bit more and try again
      if (this.containerWidth === 0 || this.containerHeight === 0) {
        setTimeout(() => {
          this.measure();
          // If still no dimensions, try one more time with a longer delay
          if (this.containerWidth === 0 || this.containerHeight === 0) {
            setTimeout(() => {
              this.measure();
              this.mountAll();
            }, 200);
          } else {
            this.mountAll();
          }
        }, 100);
      } else {
        this.mountAll();
      }
    });
    
    // Set up ResizeObserver for better container size tracking
    this.setupResizeObserver();
  }
  
      ngOnDestroy(): void {
    // Clear resize timeout
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }
    
    // Clean up ResizeObserver
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined;
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
    
    private setupResizeObserver(): void {
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            if (entry.target === this.hostEl.nativeElement) {
              // Reuse the same debounce logic as window:resize
              this.onResize();
            }
          }
        });
        
        this.resizeObserver.observe(this.hostEl.nativeElement);
      }
    }
  
      // Measure container size and store privately.
  private measure(): void {
    const rect = this.hostEl.nativeElement.getBoundingClientRect();
    this.containerWidth = Math.max(0, Math.floor(rect.width));
    this.containerHeight = Math.max(0, Math.floor(rect.height));
    console.log('LayoutGridTwoByThreeComponent: Container size:', this.containerWidth, 'x', this.containerHeight);
    
    // If we still don't have valid dimensions, try to get them from the parent
    if (this.containerWidth === 0 || this.containerHeight === 0) {
      const parent = this.hostEl.nativeElement.parentElement;
      if (parent) {
        const parentRect = parent.getBoundingClientRect();
        this.containerWidth = Math.max(this.containerWidth, Math.floor(parentRect.width));
        this.containerHeight = Math.max(this.containerHeight, Math.floor(parentRect.height));
        console.log('LayoutGridTwoByThreeComponent: Using parent size:', this.containerWidth, 'x', this.containerHeight);
      }
    }
  }
  
    private mountAll(): void {
      const slotsArr = this.slots.toArray();
      const count = Math.min(this.components.length, 6);

      // Clear all existing components first
      this.refs.forEach(ref => {
        (ref.instance as any)?.stopPolling?.();
        ref.destroy();
      });
      this.refs = [];

      for (let i = 0; i < 6; i++) {
        const slot = slotsArr[i];
        if (slot) {
          slot.clear();

          if (i < count) {
            try {
              const ref = slot.createComponent(this.components[i], { environmentInjector: this.env });
              this.refs.push(ref);

              const width = this.cellWidth();
              const height = this.cellHeight();
              console.log(`LayoutGridTwoByThreeComponent: Mounting component ${i}, size: ${width}x${height}`);

              // Set chart dimensions and all required inputs using setInput for proper change detection
              ref.setInput('chartWidth', width);
              ref.setInput('chartHeight', height);
              
              // Set default values for all required chart inputs
              ref.setInput('marginTop', 30);
              ref.setInput('marginRight', 15);
              ref.setInput('marginBottom', 60);
              ref.setInput('marginLeft', 25);
              ref.setInput('showLegend', true);
              ref.setInput('legendPosition', 'right');
              ref.setInput('legendWidthPx', 120);
              
              // Call optional methods if they exist
              (ref.instance as any)?.startPolling?.();

              ref.changeDetectorRef.detectChanges();
            } catch (error) {
              console.error(`LayoutGridTwoByThreeComponent: Error mounting component ${i}:`, error);
            }
          }
        }
      }
      this.cdr.markForCheck();
      
      // Trigger change detection once after all components are mounted
      this.cdr.detectChanges();
    }
  
    private updateChildSizes(): void {
      const width = this.cellWidth();
      const height = this.cellHeight();
      
      for (const ref of this.refs) {
        ref.setInput('chartWidth', width);
        ref.setInput('chartHeight', height);
        // Update all required chart inputs on resize
        ref.setInput('marginTop', 30);
        ref.setInput('marginRight', 15);
        ref.setInput('marginBottom', 60);
        ref.setInput('marginLeft', 25);
        ref.setInput('showLegend', true);
        ref.setInput('legendPosition', 'right');
        ref.setInput('legendWidthPx', 120);
        ref.changeDetectorRef.markForCheck();
      }
      this.cdr.markForCheck();
    }
  
      private cellWidth(): number {
    const cols = this.getColumnCount();
    const padding = 8; // tighter grid
    const w = Math.floor((this.containerWidth - padding) / cols);
    // clamp to requested max 620, keep a sane min for labels
    return Math.max(320, Math.min(620, w));
  }
  
  private cellHeight(): number {
    const rows = this.getRowCount();
    const padding = 8; // tighter grid
    if (window.innerWidth <= 768) {
      // stacked modes: keep a bit taller to avoid crowding
      const h = this.containerHeight / Math.max(1, this.components.length);
      return Math.max(240, Math.min(320, Math.floor(h)));
    }
    const h = Math.floor((this.containerHeight - padding) / rows);
    // clamp to the requested max 280
    return Math.max(220, Math.min(280, h));
  }
    
    private getColumnCount(): number {
      if (window.innerWidth <= 480) {
        return 1; // Single column on very small screens
      } else if (window.innerWidth <= 768) {
        return 2; // Two columns on tablets
      } else {
        return 2; // Two columns on desktop (2x3 grid)
      }
    }
    
    private getRowCount(): number {
      if (window.innerWidth <= 480) {
        // Single column layout - each component gets its own row
        return Math.max(1, this.components.length);
      } else if (window.innerWidth <= 768) {
        // Two column layout
        return Math.ceil(this.components.length / 2);
      } else {
        // 2x3 grid layout
        return 3;
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
