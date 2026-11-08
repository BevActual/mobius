/**
 * What an action the agent asks to take means, in plain words, for the approval card: "add “Water the plants” to
 * Inbox in Tasks", not `tasks.add {…}`. The tool's name and arguments are still shown below it for anyone who wants
 * them. Null when Mobius has no words for that tool (an MCP server's, say).
 */
export function describeAction(name: string, args: unknown): string | null {
  const a = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>;
  const s = (key: string): string => (typeof a[key] === 'string' ? (a[key] as string).trim() : '');
  const quote = (text: string, max = 80) => `“${text.length > max ? `${text.slice(0, max - 1)}…` : text}”`;
  const host = (url: string) => { try { return new URL(url).host || url; } catch { return url; } };
  const place = (path: string) => {
    const clean = path.replace(/\\/g, '/');
    if (clean.startsWith('notes/')) return `the note ${quote(clean.slice('notes/'.length).replace(/\.md$/i, '').replace('/', ' › '))}`;
    if (clean.startsWith('calendar/')) return `the calendar ${quote(clean.slice('calendar/'.length).replace(/\.ics$/i, ''))}`;
    if (clean.startsWith('tasks/')) return `the task list ${quote(clean.slice('tasks/'.length).replace(/\.md$/i, ''))}`;
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
    case 'calendar.list': return 'read your calendar';
    case 'calendar.add': return `add ${s('title') ? quote(s('title')) : 'an event'} to ${which()}${s('start') ? ` on ${when(s('start'))}` : ''}`;
    case 'calendar.update': return s('title') ? `change the event ${quote(s('title'))} in ${which()}` : `change an event in ${which()}`;
    case 'memory.remember': return s('text') ? `remember that ${quote(s('text'))}` : 'remember something about you';
    case 'memory.forget': return s('text') ? `forget ${quote(s('text'))}` : 'forget something it remembered';
    case 'schedules.add': return s('title') ? `schedule ${quote(s('title'))} at ${s('time') || 'a time'}` : 'schedule a request';
    case 'schedules.list': return 'see what is scheduled';
    case 'sessions.search': return s('query') ? `search your past conversations for ${quote(s('query'), 40)}` : 'search your past conversations';
    default: return null;
  }
}
