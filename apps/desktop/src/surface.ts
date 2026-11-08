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
  attach?: 'page' | 'note' | 'tasks' | 'sheet' | 'mail' | 'code' | 'photo';
}

export interface SurfaceState {
  app: AppId;
  /** A web page is showing in the browser. */
  hasPage: boolean;
  /** The note open in Notes (or the document open in Docs, with `folder` 'docs'), if any. */
  note: { path: string; title: string; text: string; folder?: 'notes' | 'docs' | 'slides' | 'designs' } | null;
  /** The view open in Tasks, written out as a checklist, if Tasks is open. */
  tasks?: { title: string; text: string } | null;
  /** The sheet open in Sheets, as values with their formulas, if Sheets is open. */
  sheet?: { title: string; source: string; text: string } | null;
  /** The photo open in Photo: described in words, with its edits file. */
  photo?: { title: string; source: string; text: string } | null;
  /** The file open in Code, with the last test output if it failed. */
  code?: { title: string; source: string; text: string; failing: boolean } | null;
  /** The email open in Mail, if any. */
  mail?: { id: string; title: string; text: string } | null;
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
    case 'docs':
      return state.note
        ? [
            { label: 'Proofread', prompt: 'Proofread this document: fix spelling, grammar and punctuation only, in the document itself, and tell me what you changed.', attach: 'note' },
            { label: 'Tighten it', prompt: 'Make this document shorter and clearer, keeping its meaning and my voice. Make the changes in the document itself.', attach: 'note' },
            { label: 'What is missing?', prompt: 'Read this document and tell me what a reader would still want to know.', attach: 'note' },
          ]
        : [{ label: 'Draft a document', prompt: 'Draft a document in my Docs about ' }];
    case 'sheets':
      return state.sheet
        ? [
            { label: 'Explain these numbers', prompt: 'Explain what this sheet works out, in plain words, and point at the cells each part comes from.', attach: 'sheet' },
            { label: 'Check the formulas', prompt: 'Check the formulas in this sheet for mistakes, such as a range that misses a row or a total that counts something twice. Say which cells, and ask before changing anything.', attach: 'sheet' },
            { label: 'Add a column…', prompt: 'Add a column to this sheet that works out ', attach: 'sheet' },
          ]
        : [{ label: 'Make a budget', prompt: 'Make a budget workbook in my Sheets for ' }];
    case 'mail':
      if (state.mail) {
        return [
          { label: 'Draft a reply', prompt: `Suggest a short reply to the attached email with mail.draft (replyTo: ${state.mail.id}), in my voice, answering what it asks. Check my calendar first if it is about a time.`, attach: 'mail' },
          { label: 'Add a reminder', prompt: 'If the attached email asks me to do something by a time, suggest a calendar event for it with calendar.suggest, a little before it is due. Say what you suggested.', attach: 'mail' },
          { label: 'Save to Notes', prompt: 'Write the parts of the attached email worth keeping as a short note in my Notes, with who sent it and when.', attach: 'mail' },
        ];
      }
      return [
        { label: 'What needs me?', prompt: 'Look through my mail from the last few days and tell me what needs a reply or an action from me, newest first. Say which message each comes from.' },
        { label: 'Summarise my inbox', prompt: 'Summarise my inbox from today in a few short points.' },
        { label: 'Find…', prompt: 'Find the email about ' },
      ];
    case 'slides':
      return state.note
        ? [
            { label: 'Write presenter notes', prompt: 'Write short presenter notes for each slide of this deck that has none, in my voice. Change only the notes, in the deck itself.', attach: 'note' },
            { label: 'Tighten the wording', prompt: 'Make the titles and bullets of this deck shorter and clearer, keeping what they say. Make the changes in the deck itself.', attach: 'note' },
            { label: 'What is missing?', prompt: 'Read this deck and tell me what an audience would still want to see.', attach: 'note' },
          ]
        : [{ label: 'Make a deck', prompt: 'Make a deck in my Slides about ' }];
    case 'photo':
      return state.photo
        ? [
            { label: 'Warm it up', prompt: 'Warm up this photo a little with one new adjustment in its edits file, keeping the other adjustments as they are. Say what you changed.', attach: 'photo' },
            { label: 'Brighten the shadows', prompt: 'The bottom of this photo looks darker than the top. Add one adjustment to its edits file that brightens only the lower part, softly, and leaves the sky alone. Say what you changed.', attach: 'photo' },
            { label: 'Adjust…', prompt: 'In this photo, ', attach: 'photo' },
          ]
        : [];
    case 'design':
      return state.note
        ? [
            { label: 'Make a dark version', prompt: 'Add a new frame to this design, to the right of the others, that is a dark mode version of the first frame. Use the colour styles already in the design where they fit, add any new colours as styles, and check that text contrast passes AA. Keep the ids of what you leave alone; give new layers new ids.', attach: 'note' },
            { label: 'Check contrast', prompt: 'Check the contrast of every text layer in this design against what is behind it, and list any below AA (4.5:1) with a colour that would pass. Change nothing yet.', attach: 'note' },
            { label: 'Tidy the spacing', prompt: 'Line up the layers in this design on an 8-point grid with even spacing, changing only x, y, w and h. Keep every id.', attach: 'note' },
          ]
        : [{ label: 'Sketch a screen', prompt: 'Make a design in my Design app, a phone-sized frame, for ' }];
    case 'code':
      return state.code
        ? [
            ...(state.code.failing ? [{ label: 'Why is a test failing?', prompt: 'A test in this project fails; the attached file ends with the output. Find the cause, fix it with files.edit, run code.test to check, and tell me in a sentence or two what was wrong. I keep or discard the change.', attach: 'code' as const }] : []),
            { label: 'Explain this file', prompt: 'Explain what the attached file does, in plain words: its parts and how they fit together.', attach: 'code' },
            { label: 'Write tests for this', prompt: 'Write tests for the attached file, in the style the project already uses, run code.test, and tell me what they cover.', attach: 'code' },
            { label: 'Change…', prompt: 'In the attached file, ', attach: 'code' },
          ]
        : [{ label: 'Start a project', prompt: 'Make a small project in my Code, in a new folder code/<name>/, that ' }];
    case 'calendar':
      return [
        { label: 'What is coming up?', prompt: 'Look at my calendar for the next seven days and tell me what to prepare for. Where it would help, suggest time to prepare.' },
        { label: 'Find time for…', prompt: 'Find a free hour in my calendar this week for ' },
        { label: 'Plan my week', prompt: 'Look at my calendar and my tasks and suggest when to do the most important tasks this week.' },
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
export function noteContext(note: { path: string; title: string; text: string; folder?: 'notes' | 'docs' | 'slides' | 'designs' }): ContextItem {
  return { kind: 'file', title: note.title || note.path, source: `${note.folder ?? 'notes'}/${note.path}`, text: note.text.slice(0, MAX_CONTEXT_ITEM_CHARS) };
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

/** The open email as an attachment: its text is someone else's words, which the agent treats as data. */
export function mailItem(mail: { id: string; title: string; text: string }): ContextItem {
  return { kind: 'file', title: mail.title, source: `mail:${mail.id}`, text: mail.text.slice(0, MAX_CONTEXT_ITEM_CHARS) };
}

/** The open sheet as an attachment. */
export function sheetItem(sheet: { title: string; source: string; text: string }): ContextItem {
  return { kind: 'file', title: sheet.title, source: sheet.source, text: sheet.text.slice(0, MAX_CONTEXT_ITEM_CHARS) };
}

/** The open Tasks view as an attachment. */
export function tasksItem(tasks: { title: string; text: string }): ContextItem {
  return { kind: 'file', title: `Tasks: ${tasks.title}`, source: 'tasks', text: tasks.text.slice(0, MAX_CONTEXT_ITEM_CHARS) };
}
