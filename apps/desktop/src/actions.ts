import type { HubTarget } from './search-hub';
import { dayLabel } from './dates';
/**
 * What an action the agent asks to take means, in plain words, for the approval card: "add “Water the plants” to
 * Inbox in Tasks", not `tasks.add {…}`. The tool's name and arguments are still shown below it for anyone who wants
 * them. Null when Mobius has no words for that tool (an MCP server's, say).
 */
/**
 * What a tool would use, shown readably on its approval card: the text it would write, the statement it would run,
 * the command, the query. Null when the arguments say it better as they are.
 */
export function previewArguments(name: string, args: unknown): { label: string; text: string; mono: boolean } | null {
  const a = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>;
  const s = (key: string): string => (typeof a[key] === 'string' ? (a[key] as string) : '');
  const cut = (text: string, lines = 14) => { const all = text.replace(/\s+$/, '').split('\n'); return all.length > lines ? `${all.slice(0, lines).join('\n')}\n… ${all.length - lines} more lines` : all.join('\n'); };
  switch (name) {
    case 'files.write': return s('content') ? { label: 'What it will write', text: cut(s('content')), mono: /\.(json|csv|ics|ts|js|rs|py)$/i.test(s('path')) } : null;
    case 'files.edit': {
      if (!s('old') && !s('new')) return null;
      const lines = [...cut(s('old'), 6).split('\n').map((l) => `− ${l}`), ...cut(s('new'), 8).split('\n').map((l) => `+ ${l}`)];
      return { label: 'The change', text: lines.join('\n'), mono: true };
    }
    case 'db.query': case 'db.execute': return s('sql') ? { label: 'The statement', text: s('sql'), mono: true } : null;
    case 'code.run': case 'code.start': return s('command') ? { label: 'The command', text: s('command'), mono: true } : null;
    case 'web.search': return s('query') ? { label: 'Searching for', text: s('query'), mono: false } : null;
    case 'web.read': case 'browser.open': return s('url') ? { label: 'The address', text: s('url'), mono: true } : null;
    case 'mail.draft': return s('body') ? { label: 'The draft', text: cut(s('body')), mono: false } : null;
    case 'memory.remember': return null;
    default: return null;
  }
}

export function describeAction(name: string, args: unknown): string | null {
  const a = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>;
  const s = (key: string): string => (typeof a[key] === 'string' ? (a[key] as string).trim() : '');
  const quote = (text: string, max = 80) => `“${text.length > max ? `${text.slice(0, max - 1)}…` : text}”`;
  const host = (url: string) => { try { return new URL(url).host || url; } catch { return url; } };
  const place = (path: string) => {
    const clean = path.replace(/\\/g, '/');
    if (clean.startsWith('notes/')) return `the note ${quote(clean.slice('notes/'.length).replace(/\.md$/i, '').replace('/', ' › '))}`;
    if (clean.startsWith('docs/')) return `the document ${quote(clean.slice('docs/'.length).replace(/\.md$/i, '').replace('/', ' › '))}`;
    if (clean.startsWith('slides/')) return `the deck ${quote(clean.slice('slides/'.length).replace(/\.md$/i, '').replace('/', ' › '))}`;
    if (clean.startsWith('calendar/')) return `the calendar ${quote(clean.slice('calendar/'.length).replace(/\.ics$/i, ''))}`;
    if (clean.startsWith('tasks/')) return `the task list ${quote(clean.slice('tasks/'.length).replace(/\.md$/i, ''))}`;
    const kinds: [string, string, RegExp][] = [['designs/', 'the design', /\.json$/i], ['boards/', 'the board', /\.json$/i], ['views/', 'the view', /\.json$/i], ['research/', 'the report', /\.md$/i], ['reading/', 'the article', /\.md$/i], ['studio/', 'the song', /\.json$/i], ['skills/', 'the skill', /\/SKILL\.md$/i]];
    for (const [prefix, what, ext] of kinds) if (clean.startsWith(prefix)) return `${what} ${quote(clean.slice(prefix.length).replace(ext, '').replace('/', ' › '))}`;
    if (clean.startsWith('photos/') && /\.edits\.json$/i.test(clean)) return `the edits of the photo ${quote(clean.slice('photos/'.length).replace(/\.edits\.json$/i, '').replace('/', ' › '))}`;
    if (clean.startsWith('video/') && clean.endsWith('/cut.json')) return `the cut of the video ${quote(clean.slice('video/'.length, -'/cut.json'.length))}`;
    if (clean.startsWith('code/')) { const [project, ...rest] = clean.slice('code/'.length).split('/'); return rest.length ? `${quote(rest.join('/'))} in the project ${quote(project ?? '')}` : `the project ${quote(project ?? '')}`; }
    return clean ? `the file ${quote(clean)}` : 'a file';
  };
  const which = () => (s('calendar') && s('calendar') !== 'Calendar' ? `the calendar ${quote(s('calendar'))}` : 'your calendar');
  const when = (text: string) => {
    const [day, time] = text.split('T');
    const date = new Date(`${day}T00:00`);
    if (Number.isNaN(date.getTime())) return text;
    const shown = dayLabel(date, { weekday: 'short' });
    return time ? `${shown} at ${time}` : shown;
  };
  switch (name) {
    case 'clock.now': return 'check the time';
    case 'browser.open': return s('url') ? `open ${host(s('url'))} in the browser` : 'open a page in the browser';
    case 'browser.read': return 'read the page open in the browser';
    case 'browser.tabs': return 'see which tabs are open';
    case 'browser.click': return 'click on the page open in the browser';
    case 'browser.type': return s('text') ? `type ${quote(s('text'), 40)} on the page open in the browser` : 'type on the page open in the browser';
    case 'files.read': return `read ${place(s('path'))}`;
    case 'files.list': return 'see which notes and files there are';
    case 'files.search': return s('query') ? `search your notes and files for ${quote(s('query'), 40)}` : 'search your notes and files';
    case 'files.write': return `write ${place(s('path'))}`;
    case 'files.edit': return `change ${place(s('path'))}`;
    case 'tasks.list': return s('list') ? `read your ${quote(s('list'))} tasks` : 'read your task lists';
    case 'tasks.add': return s('text') ? `add ${quote(s('text'))} to ${s('list') || 'Inbox'} in Tasks` : 'add a task';
    case 'tasks.update': return s('task') || s('text') ? `change the task ${quote(s('task') || s('text'))}` : 'change a task';
    case 'mail.search': return s('query') ? `search your mail for ${quote(s('query'), 40)}` : 'look through your mail';
    case 'mail.read': return 'read an email';
    // A reply says so; a new email says who it is to ("draft an email to Priya"), or that it is new.
    case 'mail.draft': return s('replyTo') || s('reply_to') || s('in_reply_to') ? 'draft a reply for you to send' : s('to') ? `draft an email to ${s('to')}` : 'draft a new email';
    case 'sheets.list': return 'see which workbooks there are';
    case 'sheets.read': return s('workbook') ? `read the workbook ${quote(s('workbook'))}` : 'read a workbook';
    case 'sheets.write': {
      const cells = typeof a.cells === 'object' && a.cells !== null ? Object.keys(a.cells as object) : [];
      const where = cells.length === 1 ? `cell ${cells[0]}` : cells.length > 1 ? `${cells.length} cells` : 'cells';
      return `change ${where} in ${s('workbook') ? quote(s('workbook')) : 'a workbook'}${s('sheet') ? ` › ${s('sheet')}` : ''}`;
    }
    case 'calendar.list': return 'read your calendar';
    case 'calendar.add': return `add ${s('title') ? quote(s('title')) : 'an event'} to ${which()}${s('start') ? ` on ${when(s('start'))}` : ''}`;
    case 'calendar.suggest': return `suggest ${s('title') ? quote(s('title')) : 'an event'} for ${which()}`;
    case 'calendar.update': return s('title') ? `change the event ${quote(s('title'))} in ${which()}` : `change an event in ${which()}`;
    case 'memory.remember': return s('text') ? `remember that ${quote(s('text'))}` : 'remember something about you';
    case 'memory.forget': return s('text') ? `forget ${quote(s('text'))}` : 'forget something it remembered';
    case 'schedules.add': return s('title') ? `schedule ${quote(s('title'))} at ${s('time') || 'a time'}` : 'schedule a request';
    case 'schedules.list': return 'see what is scheduled';
    case 'sessions.search': return s('query') ? `search your past conversations for ${quote(s('query'), 40)}` : 'search your past conversations';
    case 'web.search': return s('query') ? `search the web for ${quote(s('query'), 60)}` : 'search the web';
    case 'web.read': return s('url') ? `read the page ${host(s('url'))}` : 'read a web page';
    case 'db.list': return 'see your databases and their tables';
    case 'db.query': return `read from the database ${quote(s('database') || 'one of yours')}`;
    case 'db.execute': return `change the database ${quote(s('database') || 'one of yours')}`;
    case 'code.test': return `run the tests of ${quote(s('project') || 'a project')}`;
    case 'code.run': return s('command') ? `run ${quote(s('command'), 60)} in ${quote(s('project') || 'a project')}` : 'run a command';
    case 'code.start': return s('command') ? `start ${quote(s('command'), 60)} in ${quote(s('project') || 'a project')} and keep it running` : 'start a command that keeps running';
    case 'code.output': return 'read what a running command printed';
    case 'code.stop': return 'stop a running command';
    case 'code.commit': return s('message') ? `commit in ${quote(s('project') || 'a project')}: ${quote(s('message'), 60)}` : 'commit the changes';
    case 'code.push': return `push ${quote(s('project') || 'a project')} to its remote`;
    case 'skills.list': return 'see your skills';
    case 'skills.read': return s('name') ? `read the skill ${quote(s('name'))}` : 'read a skill';
    default: return null;
  }
}

/**
 * What a tool would do, always in words, for an approval card: the plain sentence when there is one, otherwise the
 * tool named without its code name ("use “echo” from the fake server"). The code name stays in a tooltip.
 */
export function plainUse(name: string, args: unknown): string {
  const said = describeAction(name, args);
  if (said) return said;
  const parts = name.split('.');
  if (parts[0] === 'mcp' && parts.length >= 3) return `use “${parts.slice(2).join(' ')}” from the ${parts[1]} server`;
  return parts.length > 1 ? `use the ${parts[0]} tool “${parts.slice(1).join(' ').replace(/_/g, ' ')}”` : `use “${name.replace(/_/g, ' ')}”`;
}

/** What a finished tool did, in the past tense: "Added “Order brake kit” to P2 build in Tasks". */
const PAST: Record<string, string> = { add: 'Added', read: 'Read', write: 'Wrote', change: 'Changed', open: 'Opened', search: 'Searched', draft: 'Drafted', check: 'Checked', see: 'Looked at', suggest: 'Suggested', remember: 'Remembered', forget: 'Forgot', schedule: 'Scheduled', run: 'Ran', start: 'Started', stop: 'Stopped', commit: 'Committed', push: 'Pushed', type: 'Typed', click: 'Clicked', look: 'Looked', use: 'Used' };
export function pastAction(name: string, args: unknown): string | null {
  const words = describeAction(name, args);
  if (!words) return null;
  const [first, ...rest] = words.split(' ');
  const past = PAST[first ?? ''];
  if (!past) return words.charAt(0).toUpperCase() + words.slice(1);
  // "see which tabs are open" reads as "Looked at which tabs are open".
  return [past, ...rest].join(' ');
}

/** Where a tool's result can be opened, when it made or changed one thing a person can look at. */
export function toolTarget(name: string, args: unknown): HubTarget | null {
  const a = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>;
  const s = (key: string): string => (typeof a[key] === 'string' ? (a[key] as string).trim() : '');
  if (name === 'tasks.add' || name === 'tasks.update' || name === 'tasks.list') return s('list') || name === 'tasks.add' ? { app: 'tasks', list: s('list') || 'Inbox' } : null;
  if (name === 'sheets.write' || name === 'sheets.read') return s('workbook') ? { app: 'sheets', workbook: s('workbook'), sheet: s('sheet') || 'Sheet 1' } : null;
  // An event Mobius added or moved opens the calendar at its day.
  if (name === 'calendar.add' || name === 'calendar.update' || name === 'calendar.suggest') { const day = /^\d{4}-\d{2}-\d{2}/.exec(s('start'))?.[0]; return day ? { app: 'calendar', date: day } : { app: 'calendar' }; }
  if (name === 'files.write' || name === 'files.edit' || name === 'files.read') {
    const path = s('path').replace(/\\/g, '/');
    const title = (path.split('/').pop() ?? path).replace(/\.md$/i, '');
    for (const app of ['notes', 'docs', 'slides'] as const) if (path.startsWith(`${app}/`) && path.endsWith('.md')) return { app, path: path.slice(app.length + 1), title };
  }
  return null;
}

/** One line for several of the same finished call in a row: "Added 6 tasks to P2 build". */
export function groupSummary(name: string, argsList: readonly unknown[]): string {
  const n = argsList.length;
  const field = (args: unknown, key: string) => (typeof args === 'object' && args !== null && typeof (args as Record<string, unknown>)[key] === 'string' ? ((args as Record<string, unknown>)[key] as string).trim() : '');
  const same = (key: string) => { const first = field(argsList[0], key); return first && argsList.every((x) => field(x, key) === first) ? first : ''; };
  switch (name) {
    case 'tasks.add': return `Added ${n} tasks${same('list') ? ` to ${same('list')}` : ''}`;
    case 'tasks.update': return `Changed ${n} tasks${same('list') ? ` in ${same('list')}` : ''}`;
    case 'calendar.add': return `Added ${n} events to the calendar`;
    case 'files.write': return `Wrote ${n} files`;
    case 'files.edit': return `Changed ${n} files`;
    case 'files.read': return `Read ${n} files`;
    case 'sheets.write': return `Changed ${n} parts of ${same('workbook') ? `“${same('workbook')}”` : 'your sheets'}`;
    case 'mail.draft': return `Drafted ${n} emails`;
    default: { const one = pastAction(name, argsList[0]) ?? name; return `${one}, and ${n - 1} more like it`; }
  }
}

/** Where a file a turn changed opens: the note, the list, the sheet, the calendar. */
export function changeTarget(path: string): HubTarget | null {
  const raw = path.replace(/\\/g, '/');
  // A page's comments open the page they are on.
  const p = raw.replace(/^(notes|docs|slides|research|reading)\/\.comments\/(.+)\.json$/i, '$1/$2.md');
  const rest = (prefix: string) => p.slice(prefix.length);
  const titled = (prefix: string, ext: RegExp) => { const r = rest(prefix); return { path: r, title: (r.split('/').pop() ?? r).replace(ext, '') }; };
  if (p.startsWith('notes/')) return { app: 'notes', ...titled('notes/', /\.md$/i) };
  if (p.startsWith('docs/')) return { app: 'docs', ...titled('docs/', /\.md$/i) };
  if (p.startsWith('slides/')) return { app: 'slides', ...titled('slides/', /\.md$/i) };
  if (p.startsWith('tasks/')) return { app: 'tasks', list: rest('tasks/').replace(/\.md$/i, '') };
  if (p.startsWith('sheets/')) { const [workbook, sheet] = rest('sheets/').split('/'); return workbook ? { app: 'sheets', workbook, sheet: (sheet ?? 'Sheet 1').replace(/\.csv$/i, '') } : null; }
  if (p.startsWith('calendar/')) return { app: 'calendar' };
  if (p.startsWith('designs/')) return { app: 'design', ...titled('designs/', /\.json$/i) };
  if (p.startsWith('boards/')) return { app: 'canvas', ...titled('boards/', /\.json$/i) };
  if (p.startsWith('research/')) return { app: 'research', ...titled('research/', /\.md$/i) };
  if (p.startsWith('reading/')) return { app: 'reader', ...titled('reading/', /\.md$/i) };
  if (p.startsWith('studio/')) return { app: 'studio', ...titled('studio/', /\.json$/i) };
  if (p.startsWith('databases/')) return { app: 'database', name: rest('databases/').replace(/\.sqlite$/i, '') };
  if (p.startsWith('code/')) { const project = rest('code/').split('/')[0]; return project ? { app: 'code', project } : null; }
  return null;
}
