import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Chart, Sparkline, chartNumber, chartTicks } from './Chart';

const months = ['Jun', 'Jul', 'Aug'];

describe('chart', () => {
  it('picks clean ticks from zero', () => {
    expect(chartTicks(0, 7400)).toEqual([0, 2000, 4000, 6000, 8000]);
    expect(chartTicks(3, 41)).toEqual([0, 20, 40, 60]);
    expect(chartTicks(-12, 30)[0]).toBeLessThan(0);
    expect(chartTicks(0, 0)).toEqual([0, 1]);
  });

  it('writes axis figures in full under 10,000 and short above', () => {
    expect(chartNumber(8000)).toBe('8,000');
    expect(chartNumber(12000)).toBe('12K');
    expect(chartNumber(4200000)).toBe('4.2M');
    expect(chartNumber(-500)).toBe('−500');
  });

  it('shows a legend only for two or more series, and colours follow the series, not its place', () => {
    const one = renderToStaticMarkup(<Chart label="Spend" categories={months} series={[{ name: 'Parts', values: [1, 2, 3] }]} />);
    expect(one).not.toContain('ui-chart-legend');
    const two = renderToStaticMarkup(<Chart label="Spend" categories={months} series={[{ name: 'Parts', values: [1, 2, 3] }, { name: 'Labour', color: 'teal', values: [3, 2, 1] }]} />);
    expect(two).toContain('ui-chart-legend');
    expect(two).toContain('data-color="blue"');
    expect(two).toContain('data-color="teal"');
  });

  it('gives screen readers the numbers as a table, and takes one tab stop', () => {
    const html = renderToStaticMarkup(<Chart label="Spend by month" categories={months} format={(v) => `$${v}`} series={[{ name: 'Parts', values: [4200, null, 4800] }]} />);
    expect(html).toContain('<caption>Spend by month</caption>');
    expect(html).toContain('<td>$4200</td>');
    expect(html).toContain('<td></td>');
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/class="ui-chart-bar"/g)).toHaveLength(2);
  });

  it('breaks a line at a missing value and marks Mobius-made charts', () => {
    const html = renderToStaticMarkup(<Chart label="Tests" kind="line" proposed categories={['a', 'b', 'c', 'd']} series={[{ name: 'Veltro', values: [1, 2, null, 4] }]} />);
    expect(html).toContain('data-proposed="true"');
    expect((html.match(/class="ui-chart-line" d="([^"]*)"/)?.[1] ?? '').match(/M /g)).toHaveLength(2);
  });

  it('draws a sparkline with its name for screen readers', () => {
    const html = renderToStaticMarkup(<Sparkline label="Unread, 14 days" values={[3, 2, 4]} color="green" />);
    expect(html).toContain('aria-label="Unread, 14 days"');
    expect(html).toContain('ui-spark-end');
  });
});
