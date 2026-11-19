import type { ConversationState, Item } from './conversation';
import { appName } from './apps';
import { appOfTool, toolLabel } from './activity';
import { DotMatrix, modeOfTool, type MatrixMode } from './ui';

/**
 * The working indicator (Instrument, "The Mobius panel, improved"): while Mobius works, the panel shows a dot-matrix
 * pattern that moves with the kind of work (ui/DotMatrix: reading scans, writing fills, searching pings), "Working"
 * with a step count such as 02/04, the numbered steps of this turn, each naming the app it touches,
 * and Stop. The pattern is the only motion, and it holds still when the system asks for reduced motion.
 */

export interface WorkingStep { n: number; label: string; done: boolean }
export interface Working { steps: WorkingStep[]; /** The step it is on, from 1. */ at: number; /** Known only when Mobius made a plan. */ of?: number }

type Tool = Extract<Item, { kind: 'tool' }>;
const pad = (n: number) => String(n).padStart(2, '0');

/** This turn's steps: the plan's, when Mobius made one, otherwise each tool it has run since the last message. */
export function workingOf(state: ConversationState): Working {
  const from = state.items.findLastIndex((i) => i.kind === 'user') + 1;
  const turn = state.items.slice(from);
  const plan = turn.findLast((i): i is Extract<Item, { kind: 'plan' }> => i.kind === 'plan');
  if (plan && plan.items.length > 0) {
    const steps = plan.items.map((t, k) => ({ n: k + 1, label: t.text, done: t.status === 'done' }));
    const on = plan.items.findIndex((t) => t.status !== 'done');
    return { steps, at: on === -1 ? steps.length : on + 1, of: steps.length };
  }
  const tools = turn.filter((i): i is Tool => i.kind === 'tool' && i.name !== 'todo.write');
  const steps = tools.map((t, k) => {
    const app = appOfTool(t.name, t.args);
    const label = toolLabel(t.name, t.args);
    // The app is named when the words don't already say it ("Reading a sheet" → "Reading a sheet in Sheets").
    const named = app && !label.toLowerCase().includes(appName(app).toLowerCase()) ? `${label} in ${appName(app)}` : label;
    return { n: k + 1, label: named, done: t.status !== 'running' && t.status !== 'waiting' };
  });
  return { steps, at: Math.max(1, steps.length) };
}

/** "02/04" with a plan, "03" without one. */
export function stepCount(w: Working): string {
  return w.of ? `${pad(w.at)}/${pad(w.of)}` : pad(w.at);
}

/** What the matrix shows: the running tool's kind of work, writing while a reply streams, thinking before any tool. */
export function matrixModeOf(state: ConversationState): MatrixMode {
  const from = state.items.findLastIndex((i) => i.kind === 'user') + 1;
  const last = state.items.slice(from).findLast((i) => (i.kind === 'tool' && i.name !== 'todo.write') || i.kind === 'assistant');
  if (!last) return 'thinking';
  if (last.kind === 'assistant') return last.streaming ? 'writing' : 'thinking';
  if (last.kind === 'tool' && (last.status === 'running' || last.status === 'waiting')) return modeOfTool(last.name, last.status);
  return 'thinking';
}

/** Up to this many steps show; earlier ones fold into "and N before". */
const SHOWN = 4;

export function WorkingIndicator({ state, onStop }: { state: ConversationState; onStop: () => void }) {
  const w = workingOf(state);
  const hidden = Math.max(0, w.steps.length - SHOWN);
  return (
    <div className="work-now" role="status" aria-label="Mobius is working">
      <div className="work-now-head">
        <DotMatrix mode={matrixModeOf(state)} {...(w.of ? { progress: w.steps.filter((x) => x.done).length / w.of } : {})} />
        <span className="work-now-word">Working</span>
        <span className="work-now-count" aria-label={w.of ? `Step ${w.at} of ${w.of}` : `Step ${w.at}`}>{stepCount(w)}</span>
        {/* The same Stop as the composer's, for the pointer: hidden from the keyboard and screen readers, which have that one. */}
        <button type="button" className="btn work-now-stop" aria-hidden="true" tabIndex={-1} onClick={onStop}>Stop</button>
      </div>
      {w.steps.length > 0 && (
        <ol className="work-now-steps">
          {hidden > 0 && <li className="work-now-more">{hidden === 1 ? '1 step before' : `${hidden} steps before`}</li>}
          {w.steps.slice(hidden).map((s) => (
            <li key={s.n} data-done={s.done || undefined} data-now={s.n === w.at || undefined}>
              <span className="work-now-n">{pad(s.n)}</span><span className="work-now-label">{s.label}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
