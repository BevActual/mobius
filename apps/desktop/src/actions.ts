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
    const kinds: [string, string, RegExp][] = [['designs/', 'the design', /\.json$/i], ['boards/', 'the board', /\.json$/i], ['research/', 'the report', /\.md$/i], ['reading/', 'the article', /\.md$/i], ['studio/', 'the song', /\.json$/i], ['skills/', 'the skill', /\/SKILL\.md$/i]];
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
    const shown = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return time ? `${shown} at ${time}` : shown;
  };
  switch (name) {
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
    case 'mail.draft': return s('to') ? `draft an email to ${s('to')}` : 'draft a reply for you to send';
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
