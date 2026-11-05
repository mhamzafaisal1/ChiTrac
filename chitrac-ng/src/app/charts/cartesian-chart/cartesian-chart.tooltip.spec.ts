import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { CartesianChartComponent, CartesianChartConfig } from './cartesian-chart.component';

describe('Cartesian chart hover across live refreshes', () => {
  let fixture: ComponentFixture<CartesianChartComponent>;
  const config = (value = 60, orientation: 'horizontal' | 'vertical' = 'horizontal', stacked = false): CartesianChartConfig => ({
    width: 640, height: 400, orientation, yMin: 0,
    legend: { show: false, position: 'top' },
    tooltip: { show: true, delayMs: 750, formatter: ctx => `${ctx.series.title}/${ctx.xLabel}: ${ctx.value}` },
    series: [{ id: 'counts', title: 'Counts', type: 'bar', stack: stacked ? 'time' : null,
      data: [{ x: 'First', y: value }, { x: 'Second', y: 50 }] },
      ...(stacked ? [{ id: 'paused', title: 'Paused', type: 'bar' as const, stack: 'time',
        data: [{ x: 'First', y: 10 }, { x: 'Second', y: 10 }] }] : [])],
  } as CartesianChartConfig);
  const tooltip = () => fixture.nativeElement.querySelector('.cc-tooltip') as HTMLElement;
  function render(cfg: CartesianChartConfig) {
    fixture.componentRef.setInput('config', cfg);
    fixture.detectChanges();
  }
  function hover() {
    const bar = fixture.nativeElement.querySelector('.cc-bar-tooltip-target') as SVGRectElement;
    const rect = bar.getBoundingClientRect();
    const host = fixture.nativeElement.querySelector('.cc-host');
    host.dispatchEvent(new PointerEvent('pointermove', {
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true,
    }));
  }
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CartesianChartComponent] });
    fixture = TestBed.createComponent(CartesianChartComponent);
    fixture.nativeElement.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:400px;z-index:1000';
  });
  afterEach(() => fixture.destroy());

  for (const orientation of ['horizontal', 'vertical'] as const) {
    for (const stacked of [false, true]) {
      it(`keeps a visible ${orientation} ${stacked ? 'stacked' : 'single'} tooltip and updates its values without pointer movement`, fakeAsync(() => {
        render(config(60, orientation, stacked)); hover(); tick(750);
        expect(tooltip().classList.contains('is-visible')).toBeTrue();
        expect(tooltip().textContent).toContain('60');
        for (const value of [65, 70, 75]) {
          render(config(value, orientation, stacked));
          expect(tooltip().classList.contains('is-visible')).toBeTrue();
          expect(tooltip().textContent).toContain(String(value));
        }
      }));
    }
  }

  it('does not restart the initial hover delay during repeated refreshes', fakeAsync(() => {
    render(config()); hover(); tick(300); render(config(65));
    tick(300); render(config(70)); tick(149);
    expect(tooltip().classList.contains('is-visible')).toBeFalse();
    tick(1);
    expect(tooltip().classList.contains('is-visible')).toBeTrue();
    expect(tooltip().textContent).toContain('70');
  }));

  it('re-evaluates the bar underneath a stationary pointer after ranked rows reorder', fakeAsync(() => {
    render(config()); hover(); tick(750);
    const next = config(65);
    next.series[0].data = [{ x: 'Second', y: 65 }, { x: 'First', y: 50 }];
    render(next);
    expect(tooltip().classList.contains('is-visible')).toBeTrue();
    expect(tooltip().textContent).toContain('Second: 65');
  }));

  it('hides and cancels delayed tooltips on pointer leave, empty data, disabled tooltips, or a bar moving away', fakeAsync(() => {
    for (const action of ['leave', 'empty', 'disabled', 'moved']) {
      render(config()); hover(); tick(750);
      expect(tooltip().classList.contains('is-visible')).toBeTrue();
      const next = config();
      if (action === 'leave') fixture.nativeElement.querySelector('.cc-host').dispatchEvent(new PointerEvent('pointerleave'));
      else if (action === 'empty') { next.series = []; render(next); }
      else if (action === 'disabled') { next.tooltip!.show = false; render(next); }
      else { next.series[0].data[0].y = 1; render(next); }
      tick(1000);
      expect(tooltip().classList.contains('is-visible')).toBeFalse();
    }
  }));

  it('cancels a pending tooltip when the chart is destroyed', fakeAsync(() => {
    render(config()); hover();
    const oldTooltip = tooltip();
    fixture.destroy(); tick(1000);
    expect(oldTooltip.classList.contains('is-visible')).toBeFalse();
  }));
});
