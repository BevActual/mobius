import { MAX_CONTEXT_ITEM_CHARS, type ContextItem } from '@mobius/shared';
import type { AppId } from './apps';
import type { TasksState } from './useTasks';
import { smartView } from './tasks-view';

/**
 * What an application offers the agent where you are: a few things worth asking, each with the context it needs.
 * Every app answers in the same shape, so the composer shows the same kind of controls in every app and only what
 * they say changes. Context is always explicit: a suggestion attaches what it uses, as a chip you can see.
 */
export interface Suggestion {
  /** The words on the chip. */
  label: string;
  /** What is sent. */
  prompt: string;
  /** What it needs attached first. */
  attach?: 'page' | 'note' | 'tasks';
}

export interface SurfaceState {
  app: AppId;
  /** A web page is showing in the browser. */
  hasPage: boolean;
  /** The note open in Notes, if any. */
  note: { path: string; title: string; text: string } | null;
  /** The view open in Tasks, written out as a checklist, if Tasks is open. */
  tasks?: { title: string; text: string } | null;
}

export function suggestionsFor(state: SurfaceState): Suggestion[] {
  switch (state.app) {
    case 'browser':
      return state.hasPage
        ? [
            { label: 'Summarise this page', prompt: 'Summarise this page in a few short points.', attach: 'page' },
            { label: 'What matters here?', prompt: 'What on this page matters most, and is anything on it questionable?', attach: 'page' },
            { label: 'Keep as a note', prompt: 'Write the useful parts of this page as a note in my Notes, with a link back to it.', attach: 'page' },
          ]
        : [];
    case 'notes':
      return state.note
        ? [
            { label: 'Tidy this note', prompt: 'Tidy this note: fix spelling and grammar and make the structure clearer. Keep my meaning and my voice. Show me the changes before saving.', attach: 'note' },
            { label: 'Continue writing', prompt: 'Continue this note where it ends, in the same style. Show me what you would add before saving.', attach: 'note' },
            { label: 'Make a to-do list', prompt: 'Turn the actions in this note into a short to-do list.', attach: 'note' },
          ]
        : [{ label: 'Find in my notes', prompt: 'Search my notes and tell me what I have written about ' }];
    case 'tasks':
      return [
        { label: 'Plan my day', prompt: 'Look at my tasks and help me plan today: what to do first, and what can wait. Keep it short.', attach: 'tasks' },
        { label: 'Break down a task', prompt: 'Take the biggest task here and break it into a few small steps. Add the steps as tasks in the same list and tell me what you added.', attach: 'tasks' },
        { label: 'Find tasks in my notes', prompt: 'Read my notes and add the actions you find as tasks in my Inbox. Tell me what you added.' },
      ];
    case 'agent':
      return [
        { label: 'Plan my week', prompt: 'Help me plan my week. Ask me what matters most first.' },
        { label: 'What is in my notes?', prompt: 'Look through my notes and give me a short overview of what is there.' },
        { label: 'Draft something', prompt: 'Help me draft ' },
      ];
    default:
      return [];
  }
}

/** The open note as an attachment, cut to what one attachment may carry. */
export function noteContext(note: { path: string; title: string; text: string }): ContextItem {
  return { kind: 'file', title: note.title || note.path, source: `notes/${note.path}`, text: note.text.slice(0, MAX_CONTEXT_ITEM_CHARS) };
}

/** A prompt that ends with a space is a start for you to finish, not something to send at once. */
export const isStarter = (s: Suggestion) => s.prompt.endsWith(' ');

/** The open Tasks view as a checklist the agent can read, for a suggestion that attaches it. */
export function tasksContext(tasks: Pick<TasksState, 'view' | 'all'>): { title: string; text: string } {
  const { view, all } = tasks;
  if (view.kind === 'list') {
    const lines = (all[view.name] ?? []).map((t) => `- [${t.done ? 'x' : ' '}] ${t.text}${t.due ? ` (due ${t.due})` : ''}`);
    return { title: view.name, text: `# ${view.name}\n${lines.join('\n')}` };
  }
  const title = view.id === 'today' ? 'Today' : 'Scheduled';
  const lines = smartView(view.id, all, new Date()).map(({ list, task }) => `- [ ] ${task.text} (due ${task.due}, in ${list})`);
  return { title, text: `# ${title}\n${lines.join('\n')}` };
}

/** The open Tasks view as an attachment. */
export function tasksItem(tasks: { title: string; text: string }): ContextItem {
  return { kind: 'file', title: `Tasks: ${tasks.title}`, source: 'tasks', text: tasks.text.slice(0, MAX_CONTEXT_ITEM_CHARS) };
}
