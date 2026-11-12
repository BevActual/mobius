import type { UsageRow } from '@mobius/shared';

/** Which days the Usage page shows. */
export type UsageRange = '7d' | '30d' | 'month' | '90d';
/** What the breakdown is grouped by. */
export type UsageGroup = 'model' | 'gateway' | 'app';

export const RANGE_OPTIONS: ReadonlyArray<{ id: UsageRange; label: string }> = [
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'month', label: 'This month' },
  { id: '90d', label: 'Last 90 days' },
];
export const GROUP_OPTIONS: ReadonlyArray<{ id: UsageGroup; label: string }> = [
  { id: 'model', label: 'Model' },
  { id: 'gateway', label: 'Service' },
  { id: 'app', label: 'App' },
];

/** Gateways paid by a plan: their calls have no price of their own. */
const PLANS = new Set(['claude-code', 'chatgpt', 'copilot']);

/** A local day as `YYYY-MM-DD`. */
export function dayOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The first and last day of a range, ending today. */
export function rangeDays(range: UsageRange, today: Date): { from: string; to: string } {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (range === 'month') start.setDate(1);
  else start.setDate(start.getDate() - ({ '7d': 6, '30d': 29, '90d': 89 } as const)[range]);
  return { from: dayOf(start), to: dayOf(today) };
}

/** Every day from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const [y, m, d] = from.split('-').map(Number) as [number, number, number];
  const at = new Date(y, m - 1, d);
  for (let guard = 0; guard < 400; guard += 1) {
    const day = dayOf(at);
    if (day > to) break;
    out.push(day);
    at.setDate(at.getDate() + 1);
  }
  return out;
}

export interface Tally { requests: number; inputTokens: number; outputTokens: number; cachedTokens: number; /** Known cost only. */ costUsd: number; /** Some calls had no price: on a plan, or unknown. */ unpriced: boolean; /** All of those were on a plan. */ planOnly: boolean }

const empty = (): Tally => ({ requests: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, unpriced: false, planOnly: true });

function add(t: Tally, r: UsageRow): void {
  t.requests += r.requests;
  t.inputTokens += r.inputTokens;
  t.outputTokens += r.outputTokens;
  t.cachedTokens += r.cachedTokens ?? 0;
  if (r.costUsd === null) {
    t.unpriced = true;
    if (!PLANS.has(r.gateway)) t.planOnly = false;
  } else t.costUsd += r.costUsd;
}

export function total(rows: readonly UsageRow[]): Tally {
  const t = empty();
  for (const r of rows) add(t, r);
  return t;
}

/** Tokens in and out, and the cost, for each day of the range, including days with nothing. */
export function byDay(rows: readonly UsageRow[], from: string, to: string): Array<{ day: string } & Tally> {
  const map = new Map(daysBetween(from, to).map((day) => [day, empty()]));
  for (const r of rows) { const t = map.get(r.day); if (t) add(t, r); }
  return [...map].map(([day, t]) => ({ day, ...t }));
}

/** The rows summed by model, service or app, most tokens first. */
export function groupBy(rows: readonly UsageRow[], by: UsageGroup): Array<{ key: string } & Tally> {
  const map = new Map<string, Tally>();
  for (const r of rows) {
    const key = r[by];
    const t = map.get(key) ?? empty();
    add(t, r);
    map.set(key, t);
  }
  return [...map].map(([key, t]) => ({ key, ...t })).sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens) || a.key.localeCompare(b.key));
}

/** A gateway's name as people know it. */
export function gatewayName(id: string): string {
  const names: Record<string, string> = {
    openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini', openrouter: 'OpenRouter', deepseek: 'DeepSeek', groq: 'Groq',
    together: 'Together AI', mistral: 'Mistral', xai: 'xAI', fireworks: 'Fireworks', huggingface: 'Hugging Face',
    ollama: 'Ollama', lmstudio: 'LM Studio', llamacpp: 'llama.cpp', local: 'This computer', elevenlabs: 'ElevenLabs',
    'claude-code': 'Claude plan', chatgpt: 'ChatGPT plan', copilot: 'Copilot plan', cerebras: 'Cerebras', perplexity: 'Perplexity',
    cohere: 'Cohere', moonshot: 'Moonshot', qwen: 'Qwen', zai: 'Z.ai', nvidia: 'NVIDIA', azure: 'Azure OpenAI', bedrock: 'Amazon Bedrock',
  };
  return names[id] ?? id;
}

/** "1.2M", "84K", "950": short token counts for tiles and tables. */
export function shortCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(n);
}

/** The cost as people read it: "$1.24", "<$0.01", "Free", "Plan", or "—" when unknown. */
export function costText(t: Pick<Tally, 'costUsd' | 'unpriced' | 'planOnly' | 'requests'>): string {
  if (t.requests === 0) return '$0.00';
  if (t.costUsd === 0 && t.unpriced) return t.planOnly ? 'Plan' : '—';
  const money = t.costUsd === 0 ? 'Free' : t.costUsd < 0.01 ? '<$0.01' : `$${t.costUsd.toFixed(2)}`;
  return t.unpriced ? `${money} + ${t.planOnly ? 'plan' : 'unknown'}` : money;
}

/** Every row as CSV, one line per day, service, model, app and kind, ready for a spreadsheet. */
export function toCsv(rows: readonly UsageRow[]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
  };
  const head = ['day', 'service', 'model', 'app', 'kind', 'requests', 'input_tokens', 'output_tokens', 'cached_tokens', 'cost_usd'];
  const lines = [...rows].sort((a, b) => a.day.localeCompare(b.day) || a.gateway.localeCompare(b.gateway) || a.model.localeCompare(b.model))
    .map((r) => [r.day, r.gateway, r.model, r.app, r.kind, r.requests, r.inputTokens, r.outputTokens, r.cachedTokens ?? '', r.costUsd === null ? '' : r.costUsd.toFixed(6)].map(cell).join(','));
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}
