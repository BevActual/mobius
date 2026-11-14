import type { MouseEvent, ReactNode } from 'react';
import { Avatar, Dot, type ContentColor } from './Bits';
import { ListRow } from './ListRow';

/**
 * Shared objects (Instrument, "One app, not twenty", round 9): a task, an event, an email, a file and a person look the
 * same in every app. Each has four forms: `ObjectRow` with one line (full-width lists) or two (a list beside a reading
 * pane), `ObjectCard` (Mobius panel results and Sources, Views, a peek on Space), and `ObjectChip` (inside text).
 * Apps pass the data; no app draws its own.
 *
 * Every row has one order: a leading mark that says the kind (a check, a colour bar, an unread dot, a kind icon,
 * initials), the title in ink, one grey detail, then the date or count at the trailing edge in tabular figures.
 * Dates and times come in already formatted, from dates.ts, so they follow the person's clock setting.
 * Anything Mobius proposed or changed (`byMobius`) has the dashed indigo edge in every form.
 */

interface Common {
  /** Mobius proposed or changed it and the person has not kept it yet. */
  byMobius?: boolean;
}
export interface TaskThing extends Common {
  kind: 'task';
  title: string;
  done?: boolean;
  /** Its note, the one-line row's detail when there is one. */
  note?: string;
  list?: { name: string; color?: ContentColor };
  steps?: { done: number; total: number };
  flagged?: boolean;
  /** Its due date, formatted ("Sun", "Yesterday"). */
  due?: string;
  overdue?: boolean;
  /** Where it came from ("Mail · Veltro Cells"), on the card. */
  from?: string;
}
export interface EventThing extends Common {
  kind: 'event';
  title: string;
  color?: ContentColor;
  place?: string;
  /** People, already put in words ("5 people", "Priya, Sam and 3 more"). */
  people?: string;
  /** Its day ("Thu"). */
  day?: string;
  /** Its start time ("1:00 PM"). */
  time?: string;
  /** Its time range ("1:00 to 2:30 PM"), the two-line row's second line and the card's When. */
  range?: string;
}
export interface MailThing extends Common {
  kind: 'mail';
  from: string;
  subject: string;
  /** The first words. */
  preview?: string;
  unread?: boolean;
  /** Time today, else the day ("9:32 PM", "Thu"). */
  when?: string;
  /** On the card: "today 9:32 PM". */
  whenLong?: string;
}
export type FileType = 'doc' | 'sheet' | 'slides' | 'image' | 'note' | 'other';
export interface FileThing extends Common {
  kind: 'file';
  name: string;
  type: FileType;
  /** The app it opens in ("Sheets"). */
  app?: string;
  folder?: string;
  /** Last changed ("1 hr ago"). */
  changed?: string;
  /** A fact for the two-line row and the card ("179 words", "2 sheets"). */
  extra?: string;
  /** What Mobius changed, on the card ("2 cells in Sheet 1"). */
  change?: string;
}
export interface PersonThing extends Common {
  kind: 'person';
  name: string;
  role?: string;
  address?: string;
  /** A count or label at the row's end ("3 emails", "Supplier"). */
  count?: string;
  /** What Mobius knows about them, on the card. */
  knows?: string;
  photo?: string;
}
export type Thing = TaskThing | EventThing | MailThing | FileThing | PersonThing;

const KIND_NAMES: Record<Thing['kind'], string> = { task: 'Task', event: 'Event', mail: 'Email', file: 'File', person: 'Person' };
const FILE_NAMES: Record<FileType, string> = { doc: 'Doc', sheet: 'Sheet', slides: 'Slides', image: 'Image', note: 'Note', other: 'File' };

const PATHS = {
  task: 'M4 6h2M4 12h2M4 18h2M9 6h11M9 12h11M9 18h11',
  event: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  mail: 'M3.5 6.5h17v11h-17zM4 7l8 6 8-6',
  doc: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5',
  sheet: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  slides: 'M4 5h16v11H4zM12 16v4M8 20h8',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01',
  note: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h3',
  other: 'M7 3h7l4 4v14H7zM14 3v4h4',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0',
} as const;

/** The line icon for a kind or a file type, 16px in rows and chips, 14px on a card's kind line. */
export function KindIcon({ kind }: { kind: keyof typeof PATHS }) {
  return (
    <svg className="ui-kind-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[kind]} />
    </svg>
  );
}

const join = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' · ');
const iconOf = (thing: Thing): keyof typeof PATHS => (thing.kind === 'file' ? thing.type : thing.kind);
const titleOf = (thing: Thing) => (thing.kind === 'mail' ? thing.subject : thing.kind === 'file' ? thing.name : thing.kind === 'person' ? thing.name : thing.title);

/** A task's round check: ink when done. A button when it can be ticked from here, a mark when it can't. */
function TaskCheck({ task, onToggle, small }: { task: TaskThing; onToggle?: () => void; small?: boolean }) {
  if (!onToggle) return <span className="ui-task-check" data-done={task.done || undefined} data-small={small || undefined} aria-hidden="true" />;
  return (
    <button
      type="button"
      className="ui-task-check"
      role="checkbox"
      aria-checked={!!task.done}
      aria-label={task.done ? `Mark “${task.title}” not done` : `Complete “${task.title}”`}
      data-done={task.done || undefined}
      onClick={onToggle}
    />
  );
}

/** What leads a row: the mark that says the kind. */
function lead(thing: Thing, two: boolean, onToggle?: () => void): ReactNode {
  switch (thing.kind) {
    case 'task': return <TaskCheck task={thing} onToggle={onToggle} />;
    case 'event': return <span className="ui-event-bar" data-tone={thing.color} aria-hidden="true" />;
    case 'mail': return <span className="ui-unread-dot" data-on={thing.unread || undefined} aria-label={thing.unread ? 'Unread' : undefined} role={thing.unread ? 'img' : undefined} />;
    case 'file': return <span className="ui-row-icon"><KindIcon kind={thing.type} /></span>;
    case 'person': return <Avatar name={thing.name} src={thing.photo} size={two ? 'two' : 'row'} />;
  }
}

function listLine(task: TaskThing): ReactNode {
  const after = join(task.steps && `${task.steps.done} of ${task.steps.total} steps`, task.flagged && 'flagged');
  if (!task.list) return after || undefined;
  return <>{task.list.color && <Dot color={task.list.color} />}{join(task.list.name, after)}</>;
}

/**
 * A shared object as a list row: one line (`lines={1}`, the default) or two (`lines={2}`, beside a reading pane). Put
 * rows in a `<ul role="list" className="ui-list">`. A task's check ticks it from here when `onToggle` is given.
 */
export function ObjectRow({ thing, lines = 1, current, onOpen, onToggle, onContextMenu, trail }: {
  thing: Thing;
  lines?: 1 | 2;
  current?: boolean;
  /** Enter or a click: open it in its own app. */
  onOpen: () => void;
  /** Tick a task. */
  onToggle?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
  trail?: ReactNode;
}) {
  const two = lines === 2;
  const base = { lines, current, proposed: thing.byMobius, onSelect: onOpen, onContextMenu, trail, lead: lead(thing, two, onToggle) } as const;
  switch (thing.kind) {
    case 'task':
      return <ListRow {...base} className="ui-thing" title={thing.title} done={thing.done}
        detail={two ? listLine(thing) : thing.note ?? (thing.list?.name)}
        meta={thing.done && !two ? 'Done' : thing.due} metaTone={thing.overdue && !thing.done ? 'red' : undefined} />;
    case 'event':
      return <ListRow {...base} className="ui-thing" title={thing.title}
        detail={two ? join(thing.range, thing.place) : thing.byMobius ? 'Proposed' : join(thing.place, thing.people)}
        meta={two ? thing.day : join(thing.day && thing.time ? `${thing.day} ${thing.time}` : thing.day ?? thing.time)} />;
    case 'mail':
      return <ListRow {...base} className="ui-thing ui-thing-mail" unread={thing.unread}
        title={two ? thing.from : <><span className="ui-mail-from">{thing.from}</span><span className="ui-mail-subject">{thing.subject}</span></>}
        detail={two ? <><span className="ui-mail-subject" data-unread={thing.unread || undefined}>{thing.subject}</span>{thing.preview && ` · ${thing.preview}`}</> : thing.preview}
        meta={thing.when} />;
    case 'file':
      return <ListRow {...base} className="ui-thing" title={thing.name}
        detail={two ? join(thing.app, thing.folder, thing.extra) : join(thing.app, thing.folder)} meta={thing.changed} />;
    case 'person':
      return <ListRow {...base} className="ui-thing" title={thing.name}
        detail={two ? join(thing.role, thing.address) : thing.role ?? thing.address} meta={thing.count} />;
  }
}

function fields(thing: Thing): [string, ReactNode][] {
  const rows: [string, ReactNode | undefined][] = (() => {
    switch (thing.kind) {
      case 'task': return [['Due', thing.due && <span data-tone={thing.overdue && !thing.done ? 'red' : undefined}>{thing.due}</span>], ['List', thing.list?.name], ['Steps', thing.steps && `${thing.steps.done} of ${thing.steps.total}`], ['From', thing.from]];
      case 'event': return [['When', join(thing.day, thing.range ?? thing.time)], ['Where', thing.place], ['Who', thing.people]];
      case 'file': return [['Where', join(thing.app, thing.folder)], [thing.change ? 'Changed' : 'Last changed', thing.change ?? thing.changed]];
      case 'person': return [['Email', thing.address], ['Knows', thing.knows]];
      case 'mail': return [];
    }
  })();
  return rows.filter((r): r is [string, ReactNode] => r[1] !== undefined && r[1] !== '' && r[1] !== false);
}

/**
 * A shared object as a card: a kind line (the kind's icon and name in small caps, "changed by Mobius" in indigo when it
 * is, and Open), the title, then two or three label and value lines. An email shows its sender and first words; a
 * person leads with their initials and name. 280px wide unless the panel is narrower.
 */
export function ObjectCard({ thing, onOpen, className }: { thing: Thing; onOpen?: () => void; className?: string }) {
  const kindName = thing.kind === 'file' ? FILE_NAMES[thing.type] : KIND_NAMES[thing.kind];
  const open = onOpen && <button type="button" className="ui-card-open" onClick={onOpen} aria-label={`Open ${titleOf(thing)}`}>Open</button>;
  const facts = fields(thing);
  return (
    <article className={className ? `ui-card ${className}` : 'ui-card'} data-by-mobius={thing.byMobius || undefined} aria-label={`${kindName}: ${titleOf(thing)}`}>
      {thing.kind === 'person' ? (
        <div className="ui-card-person">
          <Avatar name={thing.name} src={thing.photo} size="large" />
          <div className="ui-card-who"><h3 className="ui-card-title">{thing.name}</h3>{(thing.role) && <p className="ui-card-sub">{thing.role}</p>}</div>
          {open}
        </div>
      ) : (
        <>
          <div className="ui-card-kind">
            <KindIcon kind={iconOf(thing)} />
            <span>{kindName}{thing.byMobius && <span className="ui-card-by"> · changed by Mobius</span>}</span>
            {open}
          </div>
          <h3 className="ui-card-title">{titleOf(thing)}</h3>
        </>
      )}
      {thing.kind === 'mail' && (
        <>
          <p className="ui-card-sub">{join(thing.from, thing.whenLong ?? thing.when)}</p>
          {thing.preview && <p className="ui-card-text">{thing.preview}</p>}
        </>
      )}
      {facts.length > 0 && (
        <dl className="ui-card-facts">
          {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
    </article>
  );
}

/**
 * A shared object inside text (the composer, an answer, a note): 22px, a hairline, its mark and its name. Chips have no
 * selected look. With `onOpen` it is a button that opens the object.
 */
export function ObjectChip({ thing, onOpen }: { thing: Thing; onOpen?: () => void }) {
  const mark = (() => {
    switch (thing.kind) {
      case 'task': return <TaskCheck task={thing} small />;
      case 'event': return <Dot color={thing.color ?? 'stone'} />;
      case 'mail': return <KindIcon kind="mail" />;
      case 'file': return <KindIcon kind={thing.type} />;
      case 'person': return <Avatar name={thing.name} src={thing.photo} size="chip" />;
    }
  })();
  const text = thing.kind === 'event' ? join(thing.title, thing.day && thing.time ? `${thing.day} ${thing.time}` : thing.time)
    : thing.kind === 'mail' ? join(thing.subject, thing.from) : titleOf(thing);
  const body = <>{mark}<span className="ui-object-chip-text">{text}</span></>;
  return onOpen
    ? <button type="button" className="ui-object-chip" data-by-mobius={thing.byMobius || undefined} onClick={onOpen}>{body}</button>
    : <span className="ui-object-chip" data-by-mobius={thing.byMobius || undefined}>{body}</span>;
}
