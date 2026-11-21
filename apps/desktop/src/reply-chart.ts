import type { ChartSeries } from './ui/Chart';

/**
 * A chart in a reply: Analyse mode (Sheets and Database) answers with a fenced `chart` block holding JSON, and the
 * reply draws it with the shared Chart. Anything that does not read as a chart stays a code block, so a reply is
 * never lost to a bad spec.
 *
 * ```chart
 * {"title": "Parts by supplier", "kind": "column", "categories": ["Veltro", "Harlow Steel"], "series": [{"name": "Parts", "values": [31, 28]}]}
 * ```
 */
export interface ReplyChart {
  title: string;
  kind: 'column' | 'line' | 'area';
  categories: string[];
  series: ChartSeries[];
}

/** At most this many bars or points, and series, so a reply's chart stays readable in the panel. */
const MAX_CATEGORIES = 40;
const MAX_SERIES = 6;

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseReplyChart(text: string): ReplyChart | null {
  let spec: unknown;
  try { spec = JSON.parse(text); } catch { return null; }
  if (!spec || typeof spec !== 'object') return null;
  const s = spec as Record<string, unknown>;
  const categories = Array.isArray(s.categories) ? s.categories.map((c) => (typeof c === 'string' || isNumber(c) ? String(c) : null)) : null;
  if (!categories || categories.length === 0 || categories.length > MAX_CATEGORIES || categories.some((c) => c === null)) return null;
  if (!Array.isArray(s.series) || s.series.length === 0 || s.series.length > MAX_SERIES) return null;
  const series: ChartSeries[] = [];
  for (const [i, one] of s.series.entries()) {
    if (!one || typeof one !== 'object') return null;
    const o = one as Record<string, unknown>;
    if (!Array.isArray(o.values) || o.values.length !== categories.length) return null;
    const values = o.values.map((v) => (isNumber(v) ? v : v === null ? null : NaN));
    if (values.some((v) => Number.isNaN(v))) return null;
    series.push({ name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : `Series ${i + 1}`, values });
  }
  const kind = s.kind === 'line' || s.kind === 'area' ? s.kind : 'column';
  const title = typeof s.title === 'string' && s.title.trim() ? s.title.trim() : series.map((x) => x.name).join(' and ');
  return { title, kind, categories: categories as string[], series };
}
