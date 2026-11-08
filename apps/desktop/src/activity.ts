import type { AppId } from './apps';
import type { ConversationState, Item } from './conversation';

/** What the agent is doing right now, in a few words, for the composer while it works and for the app rail. */
export interface Activity {
  label: string;
  /** The app the work is happening in, so its rail button can show it. */
  app: AppId | null;
  /** Plan progress, when the agent made a plan. */
  step?: { done: number; total: number };
  /** The person has to do something (allow a tool or answer a question). */
  needsYou: boolean;
}

const pathOf = (args: unknown): string => {
  const p = typeof args === 'object' && args !== null ? (args as { path?: unknown }).path : undefined;
  return typeof p === 'string' ? p.replace(/\\/g, '/') : '';
};

/** The app a tool works in. Files under `notes/` and `tasks/` belong to those apps. */
export function appOfTool(name: string, args?: unknown): AppId | null {
  if (name.startsWith('browser.')) return 'browser';
  if (name.startsWith('tasks.')) return 'tasks';
  if (name.startsWith('calendar.')) return 'calendar';
  if (name.startsWith('files.')) {
    const path = pathOf(args);
    if (path.startsWith('notes/')) return 'notes';
    if (path.startsWith('tasks/')) return 'tasks';
    if (path.startsWith('calendar/')) return 'calendar';
  }
  return null;
}

const LABELS: Record<string, string> = {
  'browser.tabs': 'Looking at your tabs',
  'browser.open': 'Opening a page',
  'browser.read': 'Reading the page',
  'browser.click': 'Clicking on the page',
  'browser.type': 'Typing on the page',
  'files.list': 'Looking through files',
  'files.read': 'Reading a file',
  'files.search': 'Searching files',
  'files.write': 'Writing a file',
  'files.edit': 'Changing a file',
  'tasks.list': 'Reading your tasks',
  'tasks.add': 'Adding a task',
  'tasks.update': 'Updating a task',
  'calendar.list': 'Reading your calendar',
  'calendar.add': 'Adding an event',
  'calendar.update': 'Changing an event',
  'calendar.suggest': 'Suggesting an event',
  'todo.write': 'Making a plan',
};

export function toolLabel(name: string, args?: unknown): string {
  const app = appOfTool(name, args);
  if (app === 'notes') return name === 'files.read' ? 'Reading a note' : name === 'files.list' || name === 'files.search' ? 'Looking through notes' : 'Writing in Notes';
  if (LABELS[name]) return LABELS[name]!;
  const server = /^mcp[._]+([^._]+)/.exec(name)?.[1];
  return server ? `Using ${server}` : 'Working';
}

type Tool = Extract<Item, { kind: 'tool' }>;

/** Null when the agent is idle. Otherwise the newest thing it is doing, and the plan's progress. */
export function activityOf(state: ConversationState): Activity | null {
  if (!state.busy) return null;
  const plan = [...state.items].reverse().find((i): i is Extract<Item, { kind: 'plan' }> => i.kind === 'plan');
  const step = plan && plan.items.length > 0 ? { done: plan.items.filter((t) => t.status === 'done').length, total: plan.items.length } : undefined;
  const withStep = (a: Omit<Activity, 'step'>): Activity => (step ? { ...a, step } : a);
  const waiting = state.items.find((i): i is Tool => i.kind === 'tool' && i.status === 'waiting');
  if (waiting) return withStep({ label: 'Waiting for you to allow it', app: appOfTool(waiting.name, waiting.args), needsYou: true });
  if (state.items.some((i) => i.kind === 'question' && i.status === 'open')) return withStep({ label: 'Waiting for your answer', app: null, needsYou: true });
  const last = state.items.at(-1);
  if (last?.kind === 'assistant' && last.streaming) return withStep({ label: 'Writing', app: null, needsYou: false });
  const running = [...state.items].reverse().find((i): i is Tool => i.kind === 'tool' && i.status === 'running');
  if (running) return withStep({ label: toolLabel(running.name, running.args), app: appOfTool(running.name, running.args), needsYou: false });
  return withStep({ label: 'Thinking', app: null, needsYou: false });
}
