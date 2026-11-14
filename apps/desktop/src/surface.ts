import { MAX_CONTEXT_ITEM_CHARS, type ContextItem } from '@mobius/shared';
import type { AppId } from './apps';
import type { TasksState } from './useTasks';
import { smartName, smartView } from './tasks-view';

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
  attach?: 'page' | 'note' | 'tasks' | 'sheet' | 'mail' | 'code' | 'photo' | 'cut';
}

export interface SurfaceState {
  app: AppId;
  /** A web page is showing in the browser. */
  hasPage: boolean;
  /** How many tabs show a web page: two or more can be compared. */
  pages?: number;
  /** The note open in Notes (or the document open in Docs, with `folder` 'docs'), if any. */
  /** `extra` is what is said about it, such as its open comments, sent after its text. */
  note: { path: string; title: string; text: string; extra?: string; folder?: 'notes' | 'docs' | 'slides' | 'designs' | 'studio' | 'boards' | 'views' | 'research' | 'reading' | 'databases' | 'terminal' } | null;
  /** The view open in Tasks, written out as a checklist, if Tasks is open. */
  tasks?: { title: string; text: string } | null;
  /** The sheet open in Sheets, as values with their formulas, if Sheets is open. */
  sheet?: { title: string; source: string; text: string } | null;
  /** The Video project open: its clips with their lengths, and its cut. */
  cut?: { title: string; source: string; text: string } | null;
  /** The photo open in Photo: described in words, with its edits file. */
  photo?: { title: string; source: string; text: string; /** The picture as shown, to send to models that read pictures. */ picture?: string } | null;
  /** The file open in Code, with the last test output if it failed. */
  code?: { title: string; source: string; text: string; failing: boolean } | null;
  /** The email open in Mail, if any. */
  mail?: { id: string; title: string; text: string } | null;
  /** Settings is open over the app: nothing the app offers applies, so nothing is suggested. */
  settings?: boolean;
}

/**
 * The demo's Browser moment: with a few product pages open, one ask compares them in a table in Notes, each cell
 * linked to the words on the page it came from.
 */
export const COMPARE_TABS = 'Compare the web pages open in my browser tabs. List them with browser.tabs. Read a tab that has a file (one of my own pages) with files.read on that file, and any other with browser.read (its tabId). Write the comparison as a new note in my Notes called "<what they are> compared" (no colon or slash in the name): one table with a column for each page, headed by its title linked to its address, and a row for each thing the pages give that is worth comparing, taken from what they say (a row no page answers is left out). Link each cell to where it came from on its page, with a #:~:text= link to those words. Where only some pages say, write "not stated" for the others. Under the table, say in three short lines which suits whom. Keep the pages\' facts exactly. Change nothing else.';

/**
 * The demo's Home and Tasks moment: one ask, and the day is planned. Tasks get times, each shows as a dashed block in
 * Calendar, mail that needs an answer today gets a draft, and a free hour is held. Nothing is sent and no event moves.
 */
export const PLAN_MY_DAY = 'Plan my day. Read my open tasks with tasks.list and keep the ones due today or overdue, and any flagged. Read today\'s events with calendar.list (from and to today) and unread mail from the last two days with mail.search. Then, between now and 6 pm and around my events: give each task worth doing today a time with tasks.update (due today, the time as HH:MM) and suggest a block for it with calendar.suggest, with the task as the title and why in a few words; most important first, and leave room between. If the day has room, hold one free hour for focused work with calendar.suggest. For unread mail that needs an answer from me today, suggest a short reply in my voice with mail.draft. Do not send anything and do not move my events. End with the day as a short list in time order, then one line on what can wait.';

/** Code's moment: the failing test's cause found and fixed, checked by running the tests again, kept or discarded. */
export const DEBUG_TEST = 'A test in this project fails; the attached file ends with the output. Find the cause, fix it with files.edit, run code.test to check, and tell me in a sentence or two what was wrong. I keep or discard the change.';

/** The demo's Slides moment: a document becomes a deck in Slides, with the layouts and notes chosen, ready to Play. */
export const MAKE_A_DECK = 'Make this document a deck in my Slides, as slides/Presentations/<its title>.md, about eight slides, in the deck format: slides split by a line ---; in each, an optional style comment (<!-- style: accent --> for the opening title, <!-- style: dark --> for a section, <!-- style: warm --> for one big statement), a ### kicker, a ## title, - bullets (three or four, a few words each), and after Notes: what to say, in my voice. Open with a title slide that has a kicker and a title and no bullets. Give each main part of the document a section slide or a bullets slide, put its one key point and its biggest number each on a statement slide, and end on what happens next; at most half the slides have bullets. Use only what this document says: read no other file, and keep its facts and numbers exactly. Leave this document as it is. End with one short line naming the deck and its slide count.';

export function suggestionsFor(state: SurfaceState): Suggestion[] {
  if (state.settings) return [];
  switch (state.app) {
    case 'browser':
      return state.hasPage
        ? [
            ...((state.pages ?? 0) >= 2 ? [{ label: 'Compare these', prompt: COMPARE_TABS }] : []),
            { label: 'Summarise this page', prompt: 'Summarise this page in a few short points.', attach: 'page' as const },
            { label: 'What matters here?', prompt: 'What on this page matters most, and is anything on it questionable?', attach: 'page' as const },
            { label: 'Keep as a note', prompt: 'Write the useful parts of this page as a note in my Notes, with a link back to it.', attach: 'page' as const },
          ]
        : [];
    case 'notes':
      return state.note
        ? [
            // The demo's Notes moment: record a meeting into the note, then one press writes it up, and one more sends who does what to Tasks.
            { label: 'Meeting notes', prompt: 'This note holds a meeting as it was said. Write it up at the top of the note, above what is there: a short summary, the decisions, and a checklist of who does what, by when, with - [ ] items. Keep the words below exactly as they are. Show me the change before saving.', attach: 'note' },
            { label: 'Make a to-do list', prompt: 'Turn the actions in this note into tasks in my Tasks Inbox with tasks.add, with any dates the note gives, and list them back as a short to-do list. Change nothing in the note.', attach: 'note' },
            { label: 'Tidy this note', prompt: 'Tidy this note: fix spelling and grammar and make the structure clearer. Keep my meaning and my voice. Show me the changes before saving.', attach: 'note' },
          ]
        : [{ label: 'Find in my notes', prompt: 'Search my notes and tell me what I have written about ' }];
    case 'tasks':
      return [
        { label: 'Plan my day', prompt: PLAN_MY_DAY, attach: 'tasks' },
        { label: 'Break down a task', prompt: 'Take the biggest task here and break it into a few small steps. Add the steps as tasks in the same list and tell me what you added.', attach: 'tasks' },
        { label: 'Find tasks in my notes', prompt: 'Read my notes and add the actions you find as tasks in my Inbox. Tell me what you added.' },
      ];
    case 'docs':
      return state.note
        ? [
            // The demo's second Docs beat: a long draft becomes a one-page brief, a new document beside it.
            { label: 'One-page brief', prompt: 'Make a one-page brief from this document, as a new document beside it in my Docs, named after it with brief at the end: a title, two or three sentences on what it is and why it matters, then its main points as short sections that follow its outline, each a few lines, and what is decided and what is next. At most 450 words, and do not state its length. Keep its facts and numbers exactly; add nothing it does not say. Leave this document as it is.', attach: 'note' },
            // The demo's Slides moment, from Docs: a brief becomes a deck ready to play.
            { label: 'Make this a deck', prompt: MAKE_A_DECK, attach: 'note' },
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
          // The whole job in one ask: to-dos, a meeting, and a reply, each waiting for the person (the launch demo).
          { label: 'Take care of this', prompt: `Take care of the attached email. Add any to-dos it asks of me to my Tasks with tasks.add, with their due dates. If it asks for a meeting, read my calendar with calendar.list. When the email names a time and it clashes with nothing, add that meeting with calendar.add; otherwise pick a time that clashes with nothing and suggest it with calendar.suggest. Then suggest a short reply in my voice with mail.draft (replyTo: ${state.mail.id}) that says what I will do and when. Do not send anything. End with one line for each thing you did.`, attach: 'mail' },
          { label: 'Draft a reply', prompt: `Suggest a short reply to the attached email with mail.draft (replyTo: ${state.mail.id}), in my voice, answering what it asks. Check my calendar first if it is about a time.`, attach: 'mail' },
          { label: 'Add a reminder', prompt: 'If the attached email asks me to do something by a time, suggest a calendar event for it with calendar.suggest, a little before it is due. Say what you suggested.', attach: 'mail' },
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
    case 'video':
      return state.cut
        ? [
            { label: 'Make a rough cut', prompt: 'Make a rough cut of about 45 seconds from these clips in cut.json: upbeat, varied shots of 3 to 6 seconds, ending on the last clip. Use only the clips listed, within their lengths. Say which shots you used.', attach: 'cut' },
            { label: 'Tighten it', prompt: 'Make this cut shorter by trimming the slow starts and ends of shots, keeping their order. Change only in and out times in cut.json.', attach: 'cut' },
            { label: 'Add titles', prompt: 'Add a short title to the first and last shots of this cut in cut.json, from the project name.', attach: 'cut' },
          ]
        : [];
    case 'studio':
      return state.note
        ? [
            { label: 'Add a bass line', prompt: 'Add a bass track to this song that follows its chords and key: root notes on beat 1 and the "and" of 3, varied a little every fourth bar. Leave the other tracks as they are; give the new track a new id.', attach: 'note' },
            { label: 'Add drums', prompt: 'Add a drums track to this song that fits its tempo: kick, snare on 2 and 4, closed hats in eighths, a small fill in the last bar. Leave the other tracks as they are.', attach: 'note' },
            { label: 'Describe a part…', prompt: 'In this song, ', attach: 'note' },
          ]
        : [{ label: 'Start a song', prompt: 'Make a song in Music, 8 bars, with chords and a melody, that feels ' }];
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
    case 'terminal':
      return state.note
        ? [
            { label: 'Explain this', prompt: 'Explain what the attached terminal output says, in plain words. If it is an error, say what most likely caused it and what to try, as commands I can type.', attach: 'note' },
            { label: 'What next?', prompt: 'Looking at the attached terminal output, what should I run next to get where I seem to be going? Give the commands and say what each does.', attach: 'note' },
          ]
        : [{ label: 'How do I…', prompt: 'Give me the terminal commands to ' }];
    case 'database':
      return state.note
        ? [
            { label: 'Describe the data', prompt: 'Look at the attached database with db.query (a few rows of each table, counts, ranges) and describe what it holds in a short paragraph per table. Change nothing.', attach: 'note' },
            { label: 'Find problems', prompt: 'Check the attached database for problems with db.query: empty values, duplicates, values that look wrong or out of range. List what you find with the query that shows it. Change nothing.', attach: 'note' },
            { label: 'Ask about it…', prompt: 'Using db.query on the attached database, ', attach: 'note' },
          ]
        : [{ label: 'Make a database', prompt: 'Make a small SQLite database in my Database app (db.execute: CREATE TABLE and INSERT) for ' }];
    case 'reader':
      return state.note
        ? [
            { label: 'Summarise this', prompt: 'Summarise the attached article in five short bullet points, then say in one line who would find it worth reading in full.', attach: 'note' },
            { label: 'Key claims', prompt: 'List the main claims the attached article makes, and for each, what evidence it gives. Say which ones it does not back up.', attach: 'note' },
            { label: 'Questions about it', prompt: 'Give me five good questions to think about after reading the attached article.', attach: 'note' },
          ]
        : [
            { label: 'What should I read?', prompt: 'Look through my reading list in Reader (reading/) and tell me which saved article to read first, and why, in a few lines.' },
            { label: 'Catch me up', prompt: 'Summarise the articles in my Reader reading list (reading/) in one line each.' },
          ];
    case 'files':
      return [
        { label: 'What changed lately?', prompt: 'Look through my workspace with files.list and tell me which files changed most recently, and where they are. Change nothing.' },
        { label: 'Find a file…', prompt: 'Find the file in my workspace that ' },
        { label: 'Tidy a folder…', prompt: 'Suggest a tidier layout for this folder in my workspace, as a short list of moves, and change nothing until I agree: ' },
      ];
    case 'wiki':
      return [
        { label: 'What do you know about me?', prompt: 'From my Knowledge and what you remember, tell me in a few short points what you know about me and how I like to work.' },
        { label: 'Remember…', prompt: 'Remember this about me: ' },
        { label: 'Anything out of date?', prompt: 'Read my Knowledge pages and tell me what looks out of date or contradicts itself. Change nothing.' },
      ];
    case 'projects':
      return [
        { label: 'Where do things stand?', prompt: 'Look at my projects and their threads, and tell me in a line each where each one stands and what is waiting on me.' },
        { label: 'Start a project for…', prompt: 'Help me set up a project in Mobius for ' },
      ];
    case 'research':
      return state.note
        ? [
            { label: 'Check the claims', prompt: 'Check the facts marked from the web in this report against their sources (web.read each source again). Mark any that do not hold up as unsure, with what the source actually says, in the report itself. Tell me what you changed.', attach: 'note' },
            { label: 'Go deeper', prompt: 'Find three or four more sources for this report, from angles it does not cover yet, and add what they say to the report and its sources. Keep what is already there.', attach: 'note' },
            { label: 'Turn into a doc', prompt: 'Write this report up as a short document for other people in my Docs (docs/Documents/<a short title>.md): the answer, the reasons, and the sources as links. Leave the report as it is.', attach: 'note' },
          ]
        : [{ label: 'Research…', prompt: 'Research on the web, and write a report with sources in my Research app: ' }];
    case 'canvas':
      return state.note
        ? [
            { label: 'Sort into themes', prompt: 'Group the stickies on this board into a few themes: move each sticky under a text heading for its theme, laid out in columns, and colour each theme its own colour. Keep every id and every sticky\'s text; add headings as new text items.', attach: 'note' },
            { label: 'Turn into a flowchart', prompt: 'Turn what is on this board into a flowchart: shapes for the steps (diamonds for decisions), joined by arrows in order, laid out top to bottom. Keep the ids of what you reuse; give new items new ids.', attach: 'note' },
            { label: 'Summarise the board', prompt: 'Summarise this board in a few short paragraphs: the main themes, what was decided and what is still open. Change nothing on the board.', attach: 'note' },
            { label: 'Add ideas', prompt: 'Add six more stickies with new ideas to this board, near the others and in the same style. Keep everything already there as it is.', attach: 'note' },
          ]
        : [{ label: 'Start a board', prompt: 'Make a board in my Canvas, with stickies laid out in columns, for ' }];
    case 'views':
      return state.note
        ? [
            { label: 'Add tiles for…', prompt: 'Add tiles to this view (keep the ids of the tiles already there) for ', attach: 'note' },
            { label: 'What stands out?', prompt: 'Look at what this view shows (its tiles read my apps) and tell me in a few lines what needs me first today. Change nothing.', attach: 'note' },
          ]
        : [
            { label: 'Make a view for…', prompt: 'Make a view in my Views app (views/Views/<a short name>.json) with the tiles that fit, for ' },
            { label: 'A morning view', prompt: 'Make a view in my Views app called Morning (views/Views/Morning.json): what Mobius needs from me, tasks due today, today\'s events, unread mail and what runs next.' },
          ];
    case 'code':
      return state.code
        ? [
            ...(state.code.failing ? [{ label: 'Why is a test failing?', prompt: DEBUG_TEST, attach: 'code' as const }] : []),
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
        { label: 'Plan my day', prompt: PLAN_MY_DAY },
        { label: 'What is in my notes?', prompt: 'Look through my notes and give me a short overview of what is there.' },
        { label: 'Draft something', prompt: 'Help me draft ' },
      ];
    default:
      return [];
  }
}

/** A database as the agent sees it attached: where it is and its tables with their columns. */
export function databaseOutline(name: string, tables: { name: string; rows: number; columns: { name: string; type: string }[] }[]): string {
  const lines = tables.map((t) => `- ${t.name} (${t.rows} rows): ${t.columns.map((c) => `${c.name}${c.type ? ` ${c.type}` : ''}`).join(', ')}`);
  return `The SQLite database "${name}" (databases/${name}.sqlite), read with db.query and changed with db.execute.\nTables:\n${lines.join('\n') || '(none yet)'}`;
}

/** The open note as an attachment, cut to what one attachment may carry. */
export function noteContext(note: { path: string; title: string; text: string; extra?: string; folder?: 'notes' | 'docs' | 'slides' | 'designs' | 'studio' | 'boards' | 'views' | 'research' | 'reading' | 'databases' | 'terminal' }): ContextItem {
  // What is said about the page (its open comments) goes after it, and is never cut off by a long page.
  const extra = note.extra ? `\n\n---\n${note.extra.slice(0, MAX_CONTEXT_ITEM_CHARS / 4)}` : '';
  return { kind: 'file', title: note.title || note.path, source: `${note.folder ?? 'notes'}/${note.path}`, text: note.text.slice(0, MAX_CONTEXT_ITEM_CHARS - extra.length) + extra };
}

/** A prompt that ends with a space is a start for you to finish, not something to send at once. */
export const isStarter = (s: Suggestion) => s.prompt.endsWith(' ');

/** The open Tasks view as a checklist the agent can read, for a suggestion that attaches it. */
export function tasksContext(tasks: Pick<TasksState, 'view' | 'all'>): { title: string; text: string } {
  const { view, all } = tasks;
  if (view.kind === 'list') {
    const lines = (all[view.name] ?? []).map((t) => `- [${t.done ? 'x' : ' '}] ${t.text}${t.due ? ` (due ${t.due}${t.time ? ` ${t.time}` : ''})` : ''}${t.repeat ? ` (every ${t.repeat})` : ''}`);
    return { title: view.name, text: `# ${view.name}\n${lines.join('\n')}` };
  }
  const title = smartName(view.id);
  const lines = smartView(view.id, all, new Date()).map(({ list, task }) => `- [${task.done ? 'x' : ' '}] ${task.text} (${[task.due ? `due ${task.due}${task.time ? ` ${task.time}` : ''}` : '', task.repeat ? `every ${task.repeat}` : '', task.flagged ? 'flagged' : '', `in ${list}`].filter(Boolean).join(', ')})`);
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

/**
 * What is open where you are, which goes with every message as a chip you can remove: the note, list, sheet, email,
 * file, photo or cut (not a web page). Without it the agent only knew which app you were in by guessing.
 */
export interface Here {
  /** Changes when another item is opened, so a chip removed for one item comes back for the next. */
  key: string;
  /** The chip's words. */
  label: string;
  /** How the panel says it: "this sheet". */
  what: string;
  /** The item itself: what goes with the message. */
  item: ContextItem;
}

const NOTE_WORDS: Record<string, string> = { docs: 'document', slides: 'deck', designs: 'design', studio: 'song', boards: 'board', views: 'view', research: 'report', reading: 'article', databases: 'database', terminal: 'terminal' };

/** A chip already says what kind of thing it is (Email, Photo, Cut), so its name drops that word. */
const bare = (title: string) => title.replace(/^(Email|Photo|Video): /, '');

export function hereOf(s: SurfaceState | undefined): Here | null {
  if (!s) return null;
  if (s.note) return { key: `note:${s.note.folder ?? 'notes'}/${s.note.path}`, label: s.note.title || s.note.path, what: `this ${NOTE_WORDS[s.note.folder ?? ''] ?? 'note'}`, item: noteContext(s.note) };
  if (s.tasks) return { key: `tasks:${s.tasks.title}`, label: s.tasks.title, what: 'this list', item: tasksItem(s.tasks) };
  if (s.sheet) return { key: `sheet:${s.sheet.source}`, label: s.sheet.title, what: 'this sheet', item: sheetItem(s.sheet) };
  if (s.mail) return { key: `mail:${s.mail.id}`, label: bare(s.mail.title), what: 'this email', item: mailItem(s.mail) };
  if (s.photo) return { key: `photo:${s.photo.source}`, label: bare(s.photo.title), what: 'this photo', item: sheetItem(s.photo) };
  if (s.cut) return { key: `cut:${s.cut.source}`, label: bare(s.cut.title), what: 'this cut', item: sheetItem(s.cut) };
  if (s.code) return { key: `code:${s.code.source}`, label: s.code.title, what: 'this file', item: sheetItem(s.code) };
  // Not the browser's page: a page can be long and is not yours, so it goes only when asked for (Add context › This page).
  return null;
}

/** The item with what is chosen in it, so "this" in the message means the chosen cells or words. */
export function withSelection(item: ContextItem, selection: string | null): ContextItem {
  if (!selection) return item;
  const said = selection.length > 2000 ? `${selection.slice(0, 2000)}…` : selection;
  const line = /^[A-Z]{1,3}\d+(:[A-Z]{1,3}\d+)?$/.test(said) ? `Selected: ${said}` : `Selected text: "${said}"`;
  return { ...item, text: `${line}\n\n${item.text}`.slice(0, MAX_CONTEXT_ITEM_CHARS) };
}

const WORD_APP: Record<string, string> = { notes: 'Notes', docs: 'Docs', slides: 'Slides', designs: 'Design', studio: 'Music', boards: 'Canvas', views: 'Views', research: 'Research', reading: 'Reader', databases: 'Database', terminal: 'Terminal', sheets: 'Sheets', photos: 'Photo', video: 'Video', code: 'Code' };
const WORD_KIND: Record<string, string> = { notes: 'Note', docs: 'Doc', slides: 'Deck', designs: 'Design', studio: 'Song', boards: 'Board', views: 'View', research: 'Report', reading: 'Article', databases: 'Database', terminal: 'Terminal', sheets: 'Sheet', photos: 'Photo', video: 'Cut', code: 'File' };

/**
 * What an attached item is, in the words its chip uses everywhere (the message box and the sent message say the
 * same): Email for a message from Mail, Note for a note, Page for a web page. Its name drops that word.
 */
export function attachmentLabel(item: Pick<ContextItem, 'kind' | 'source' | 'title'>): { kind: string; title: string } {
  if (item.kind === 'page') return { kind: 'Page', title: item.title };
  if (item.kind === 'note') return { kind: 'Note', title: item.title };
  if (item.source.startsWith('mail:')) return { kind: 'Email', title: bare(item.title) };
  if (item.source === 'tasks') return { kind: 'List', title: item.title.replace(/^Tasks: /, '') };
  const kind = WORD_KIND[item.source.split('/')[0] ?? ''];
  return { kind: kind ?? 'File', title: bare(item.title) };
}

/** The app an attached item comes from, for "Based on Mail · Calendar". */
export function attachmentApp(item: Pick<ContextItem, 'kind' | 'source'>): string {
  if (item.kind === 'page') return 'Browser';
  if (item.kind === 'note') return 'Notes';
  if (item.source.startsWith('mail:')) return 'Mail';
  if (item.source === 'tasks') return 'Tasks';
  return WORD_APP[item.source.split('/')[0] ?? ''] ?? 'Files';
}
