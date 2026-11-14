import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { ContentColor } from './Bits';

/**
 * Chart: a column, line or area chart for Sheets, Views tiles and any app that shows numbers over a few categories.
 * One y axis from zero, recessive hairline grid, thin marks (columns at most --chart-bar-max wide with a rounded top
 * and a square base, 2-wide lines), a legend for two or more series, and a value tooltip on hover or with the arrow
 * keys. Text is always ink, muted or faint; only the marks carry colour. A screen reader gets the numbers as a table.
 *
 * Series take the person's content colour (`color`), drawn at its chart step (`--chart-*`), or else the next one in
 * the checked order. Colour follows the series, never its place, so filtering one out does not repaint the rest.
 * `proposed` gives the dashed indigo edge of something Mobius made that waits for Keep.
 */

export interface ChartSeries {
  name: string;
  /** One value per category; null leaves a gap. */
  values: readonly (number | null)[];
  color?: ContentColor;
}

/** The order unnamed series take, checked for colour-blind separation in light and dark. */
export const CHART_ORDER: readonly ContentColor[] = ['blue', 'coral', 'teal', 'amber', 'pink', 'green', 'violet', 'yellow'];

/** Clean ticks from zero (or the lowest negative) to just past the highest value: 1, 2, 2.5 or 5 times a power of ten. */
export function chartTicks(min: number, max: number, count = 4): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (hi === lo) return [0, 1];
  const raw = (hi - lo) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw - 1e-12)!;
  const start = Math.floor(lo / step + 1e-9) * step;
  const ticks: number[] = [];
  for (let v = start; v < hi + step - 1e-9; v += step) ticks.push(Math.round(v / step) * step);
  if (ticks[ticks.length - 1]! < hi - 1e-9) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

/** An axis figure: in full under 10,000, then 12K, 4.2M. */
export function chartNumber(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));
  if (a >= 1e9) return `${sign}${trim(a / 1e9)}B`;
  if (a >= 1e6) return `${sign}${trim(a / 1e6)}M`;
  if (a >= 1e4) return `${sign}${trim(a / 1e3)}K`;
  return `${sign}${a.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

const seriesColor = (s: ChartSeries, i: number): ContentColor => s.color ?? CHART_ORDER[i % CHART_ORDER.length]!;

// Geometry, in the SVG's own units (it is drawn at its measured size, so one unit is one CSS pixel).
const AXIS_W = 44;
const PLOT_TOP = 8;
const LABEL_H = 22;
const BAR_MAX = 24;
const BAR_GAP = 2;
const BAR_ROUND = 4;

/** A column from the baseline: rounded at the data end, square at the base. */
function columnPath(x: number, w: number, base: number, top: number): string {
  const up = top <= base;
  const h = Math.abs(base - top);
  const r = Math.min(BAR_ROUND, w / 2, h);
  if (up) return `M ${x} ${base} V ${top + r} Q ${x} ${top} ${x + r} ${top} H ${x + w - r} Q ${x + w} ${top} ${x + w} ${top + r} V ${base} Z`;
  return `M ${x} ${base} V ${top - r} Q ${x} ${top} ${x + r} ${top} H ${x + w - r} Q ${x + w} ${top} ${x + w} ${top - r} V ${base} Z`;
}

export function Chart({ label, kind = 'column', categories, series, format = chartNumber, height = 240, proposed, className }: {
  /** What the chart shows, for screen readers and as the table's caption ("Spend by month"). */
  label: string;
  kind?: 'column' | 'line' | 'area';
  /** The x axis: one label per value. */
  categories: readonly string[];
  series: readonly ChartSeries[];
  /** Writes a value for the tooltip and the table (the axis keeps its short figures). */
  format?: (value: number) => string;
  /** The plot's height in CSS pixels, axis labels included. */
  height?: number;
  proposed?: boolean;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();

  const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect;
  useIso(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setWidth(Math.max(160, Math.round(el.getBoundingClientRect().width)));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = categories.length;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const ticks = chartTicks(all.length ? Math.min(...all) : 0, all.length ? Math.max(...all) : 1);
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const plotW = Math.max(1, width - AXIS_W);
  const plotH = Math.max(1, height - PLOT_TOP - LABEL_H);
  const band = n ? plotW / n : plotW;
  const xMid = (i: number) => AXIS_W + band * (i + 0.5);
  const y = (v: number) => PLOT_TOP + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const base = y(0);

  // Columns: grouped in each band, each at most BAR_MAX wide, 2 apart, the group centred with air either side.
  const groupMax = band * 0.72;
  const barW = series.length ? Math.max(2, Math.min(BAR_MAX, (groupMax - BAR_GAP * (series.length - 1)) / series.length)) : 0;
  const groupW = barW * series.length + BAR_GAP * Math.max(0, series.length - 1);

  // Show every x label when they fit, otherwise every second, fourth...
  const labelEvery = Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(1, (n * 48) / plotW))));

  const lineOf = (s: ChartSeries) => {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'} ${xMid(i)} ${y(v)} `;
      pen = true;
    });
    return d.trim();
  };
  const areaOf = (s: ChartSeries) => {
    const runs: string[] = [];
    let run: [number, number][] = [];
    const flush = () => {
      if (run.length) runs.push(`M ${run[0]![0]} ${base} ${run.map(([x, v]) => `L ${x} ${v}`).join(' ')} L ${run[run.length - 1]![0]} ${base} Z`);
      run = [];
    };
    s.values.forEach((v, i) => { if (v === null) flush(); else run.push([xMid(i), y(v)]); });
    flush();
    return runs.join(' ');
  };

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!n) return;
    const go = (i: number) => { e.preventDefault(); setActive(Math.max(0, Math.min(n - 1, i))); };
    if (e.key === 'ArrowRight') go((active ?? -1) + 1);
    else if (e.key === 'ArrowLeft') go((active ?? n) - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(n - 1);
    else if (e.key === 'Escape') setActive(null);
  };

  const tipLeft = active === null ? 0 : xMid(active);
  const tipSide = active !== null && tipLeft > width * 0.6 ? 'left' : 'right';

  return (
    <figure
      className={className ? `ui-chart ${className}` : 'ui-chart'}
      data-proposed={proposed || undefined}
      aria-label={label}
    >
      {series.length > 1 && (
        <ul className="ui-chart-legend" aria-hidden="true">
          {series.map((s, i) => (
            <li key={s.name}><span className="ui-chart-key" data-kind={kind} data-color={seriesColor(s, i)} />{s.name}</li>
          ))}
        </ul>
      )}
      <div
        ref={box}
        className="ui-chart-plot"
        style={{ height: `${height}px` } as CSSProperties}
        tabIndex={n ? 0 : undefined}
        role="group"
        aria-label={`${label}. Arrow keys read each ${n ? 'point' : 'value'}`}
        aria-describedby={tableId}
        onKeyDown={key}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        onPointerMove={(e) => {
          if (!n) return;
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.floor((e.clientX - r.left - AXIS_W) / band);
          setActive(i >= 0 && i < n ? i : null);
        }}
      >
        <svg width={width} height={height} aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line className="ui-chart-grid" data-zero={t === 0 || undefined} x1={AXIS_W} x2={width} y1={y(t)} y2={y(t)} />
              <text className="ui-chart-tick" x={AXIS_W - 8} y={y(t)} dy="0.32em" textAnchor="end">{chartNumber(t)}</text>
            </g>
          ))}
          {categories.map((c, i) => (i % labelEvery === 0 ? (
            <text key={i} className="ui-chart-cat" x={xMid(i)} y={height - 6} textAnchor="middle">{c}</text>
          ) : null))}
          {active !== null && <rect className="ui-chart-hover" x={AXIS_W + band * active} y={PLOT_TOP} width={band} height={plotH} />}
          {kind === 'column' && series.map((s, si) => (
            <g key={s.name} data-color={seriesColor(s, si)} className="ui-chart-series">
              {s.values.map((v, i) => (v === null ? null : (
                <path key={i} className="ui-chart-bar" data-dim={active !== null && active !== i || undefined}
                  d={columnPath(xMid(i) - groupW / 2 + si * (barW + BAR_GAP), barW, base, y(v))} />
              )))}
            </g>
          ))}
          {kind !== 'column' && series.map((s, si) => (
            <g key={s.name} data-color={seriesColor(s, si)} className="ui-chart-series">
              {kind === 'area' && <path className="ui-chart-area" d={areaOf(s)} />}
              <path className="ui-chart-line" d={lineOf(s)} />
              {active !== null && s.values[active] != null && <circle className="ui-chart-dot" cx={xMid(active)} cy={y(s.values[active]!)} r={5} />}
            </g>
          ))}
          {active !== null && kind !== 'column' && <line className="ui-chart-cross" x1={xMid(active)} x2={xMid(active)} y1={PLOT_TOP} y2={PLOT_TOP + plotH} />}
        </svg>
        {active !== null && (
          <div className="ui-chart-tip" data-side={tipSide} style={{ left: `${tipLeft}px`, top: `${PLOT_TOP}px` } as CSSProperties} aria-live="polite">
            <div className="ui-chart-tip-head">{categories[active]}</div>
            {series.map((s, si) => (
              <div key={s.name} className="ui-chart-tip-row">
                <span className="ui-chart-key" data-kind={kind} data-color={seriesColor(s, si)} aria-hidden="true" />
                <span className="ui-chart-tip-name">{s.name}</span>
                <span className="ui-chart-tip-value">{s.values[active] == null ? '–' : format(s.values[active]!)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <table id={tableId} className="sr-only">
        <caption>{label}</caption>
        <thead><tr><th scope="col">{''}</th>{series.map((s) => <th key={s.name} scope="col">{s.name}</th>)}</tr></thead>
        <tbody>
          {categories.map((c, i) => (
            <tr key={i}><th scope="row">{c}</th>{series.map((s) => <td key={s.name}>{s.values[i] == null ? '' : format(s.values[i]!)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** A small line for a tile or a row: no axes, the last value marked. For a trend beside a number, not for reading values. */
export function Sparkline({ label, values, color = 'blue', area }: { label: string; values: readonly number[]; color?: ContentColor; area?: boolean }) {
  const W = 100, H = 32, pad = 3;
  const lo = Math.min(...values), hi = Math.max(...values);
  const x = (i: number) => (values.length > 1 ? (i / (values.length - 1)) * W : W / 2);
  const y = (v: number) => pad + (H - pad * 2) * (1 - (hi === lo ? 0.5 : (v - lo) / (hi - lo)));
  const d = values.map((v, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(v)}`).join(' ');
  const last = values[values.length - 1];
  return (
    <span className="ui-spark" data-color={color} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {area && values.length > 1 && <path className="ui-chart-area" d={`${d} L ${W} ${H} L 0 ${H} Z`} />}
        {values.length > 0 && <path className="ui-chart-line" d={d} />}
      </svg>
      {last !== undefined && <span className="ui-spark-end" style={{ top: `${(y(last) / H) * 100}%` } as CSSProperties} />}
    </span>
  );
}
