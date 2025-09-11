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

  // Interface for components that can receive data
  export interface DataAwareComponent {
    setData?: (data: any) => void;
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
  
  // Optional data array to pass to components (must match component order)
  @Input() chartData: any[] = [];
  
  // Optional height input - defaults to 93% if not provided
  @Input() height: string = '93%';

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
  
      ngAfterViewInit(): void {
    if (this.components.length === 0) {
      console.warn('LayoutGridTwoByTwoComponent: No components provided');
      return;
    }
    
    // Validate component count
    if (this.components.length > 4) {
      console.warn('LayoutGridTwoByTwoComponent: More than 4 components provided, using first 4');
    }
    
    // Set the height CSS variable
    this.hostEl.nativeElement.style.setProperty('--grid-height', this.height);
    
    console.log('LayoutGridTwoByTwoComponent: Components received:', this.components.length);
    
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
              // Debounce resize events to avoid excessive updates
              clearTimeout(this.resizeTimeout);
              this.resizeTimeout = setTimeout(() => {
                this.measure();
                this.updateChildSizes();
              }, 100);
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
    console.log('LayoutGridTwoByTwoComponent: Container size:', this.containerWidth, 'x', this.containerHeight);
    
    // If we still don't have valid dimensions, try to get them from the parent
    if (this.containerWidth === 0 || this.containerHeight === 0) {
      const parent = this.hostEl.nativeElement.parentElement;
      if (parent) {
        const parentRect = parent.getBoundingClientRect();
        this.containerWidth = Math.max(this.containerWidth, Math.floor(parentRect.width));
        this.containerHeight = Math.max(this.containerHeight, Math.floor(parentRect.height));
        console.log('LayoutGridTwoByTwoComponent: Using parent size:', this.containerWidth, 'x', this.containerHeight);
      }
    }
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
              
              // Pass data to component if available and component supports it
              if (this.chartData && this.chartData[i]) {
                const cfg = { ...this.chartData[i], width, height }; // force sync sizes
                // Try to set chartConfig input first (for CartesianChartComponent)
                ref.setInput('chartConfig', cfg);
                
                // Try externalChartConfig input for fault chart component
                ref.setInput('externalChartConfig', cfg);
                
                // Also try setData method for DataAwareComponent interface
                (ref.instance as any)?.setData?.(cfg);
              }
              
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
      
      // Trigger change detection once after all components are mounted
      this.cdr.detectChanges();
    }
  
  private updateChildSizes(): void {
    const width = this.cellWidth();
    const height = this.cellHeight();
    
    for (let i = 0; i < this.refs.length; i++) {
      const ref = this.refs[i];
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
      
      // Update data if available
      if (this.chartData && this.chartData[i]) {
        const cfg = { ...this.chartData[i], width, height }; // force sync sizes
        ref.setInput('chartConfig', cfg);
        ref.setInput('externalChartConfig', cfg);
        (ref.instance as any)?.setData?.(cfg);
      }
      
      (ref.instance as any)?.setAvailableSize?.(width, height);
      ref.changeDetectorRef.markForCheck();
    }
    this.cdr.markForCheck();
  }
  
      private cellWidth(): number {
    const cols = this.getColumnCount();
    const gridGap = 8;          // matches .grid gap
    const gridPad = 8 * 2;      // .grid padding left+right
    const totalGaps = gridGap * (cols - 1);
    // exact available width per cell
    return Math.max(1, Math.floor((this.containerWidth - gridPad - totalGaps) / cols));
  }
  
  private cellHeight(): number {
    const rows = this.getRowCount();
    const gridGap = 8;
    const gridPad = 8 * 2;
    const totalGaps = gridGap * (rows - 1);
    if (window.innerWidth <= 768) {
      return Math.max(240, Math.floor(this.containerHeight / Math.max(1, this.components.length)));
    }
    return Math.max(240, Math.floor((this.containerHeight - gridPad - totalGaps) / rows));
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
  