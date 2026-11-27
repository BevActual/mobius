import { useEffect, useRef } from 'react';
import { dayOf } from './brief';

/**
 * Check-ins (Andrew, 26 November 2026): besides the morning brief, Mobius looks in when the person opens an app, once a
 * day for each, and leaves a few suggestions for it in Home's Inbox. It only reads and suggests (Ask mode, that app's
 * tools); it never acts on them alone. Settings › Schedules › Check-ins turns them off.
 *
 * Which app was looked in on which day is kept on this computer.
 */
export const CHECK_IN_APPS = { mail: 'Mail', tasks: 'Tasks', calendar: 'Calendar', notes: 'Notes' } as const;
export type CheckInApp = keyof typeof CHECK_IN_APPS;
/** How long the person stays in the app before Mobius looks: passing through on the way elsewhere asks nothing. */
export const CHECK_IN_AFTER_MS = 4000;

const KEY = 'mobius.check-ins';

export function isCheckInApp(app: string): app is CheckInApp {
  return Object.hasOwn(CHECK_IN_APPS, app);
}

export function readCheckIns(): Partial<Record<CheckInApp, string>> {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '{}');
    if (!v || typeof v !== 'object') return {};
    return Object.fromEntries(Object.entries(v).filter(([k, d]) => isCheckInApp(k) && typeof d === 'string')) as Partial<Record<CheckInApp, string>>;
  } catch { return {}; }
}
function writeCheckIns(days: Partial<Record<CheckInApp, string>>): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(days)); } catch { /* Not remembered: at worst a second look. */ }
}

/**
 * Whether to look in on `app` now: once a day. The very first time an app is opened Mobius has only just been set up
 * there, so that day is only noted; the first look is the next day's.
 */
export function checkInDue(app: CheckInApp, now: Date, days: Partial<Record<CheckInApp, string>>): 'ask' | 'note' | 'no' {
  const last = days[app];
  if (last === dayOf(now)) return 'no';
  if (last === undefined) return 'note';
  return 'ask';
}

/** The Inbox row's and its chat's name. */
export const checkInTitle = (app: CheckInApp) => `Suggestions for ${CHECK_IN_APPS[app]}`;

/** At most this many suggestions show in the Inbox row; the rest are in its chat. */
export const CHECK_IN_LINES = 3;

/**
 * The suggestions for the Inbox row, whatever shape the answer took: headings (`## Inbox`, a line that is all bold, or
 * one ending in a colon) are left out, Markdown marks taken off, and no more than three lines kept.
 */
export function checkInLines(markdown: string, max = CHECK_IN_LINES): string[] {
  return markdown.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^#+\s/.test(l) && !/^(\*\*|__)[^*_]+(\*\*|__):?$/.test(l) && !/:$/.test(l))
    .map((l) => l.replace(/^([-*+]|\d+[.)])\s*/, '').replace(/[*_`]/g, '').trim())
    .filter(Boolean)
    .slice(0, max);
}

/** What Mobius is asked, in the person's voice; the first line names its chat. */
export function checkInAsk(app: CheckInApp): string {
  const name = CHECK_IN_APPS[app];
  return `${checkInTitle(app)}\n\nLook at my ${name} and suggest up to three things I could do next there, each in one short line, the most useful first. Say what each is about by name. If nothing needs me, say so in one line. Only read and suggest: do not change anything.`;
}

/**
 * Looks in on the app the person is in, once they have stayed there a moment, when it is due. `ask` sends it and says
 * whether it went; one that did not go is asked again the next time the app is opened.
 */
export function useCheckIns(app: string, on: boolean, loaded: boolean, ask: (app: CheckInApp, text: string) => Promise<boolean>): void {
  const send = useRef(ask);
  send.current = ask;
  useEffect(() => {
    if (!on || !loaded || !isCheckInApp(app)) return;
    const timer = window.setTimeout(() => {
      const now = new Date();
      const days = readCheckIns();
      const due = checkInDue(app, now, days);
      if (due === 'no') return;
      writeCheckIns({ ...days, [app]: dayOf(now) });
      if (due === 'note') return;
      void send.current(app, checkInAsk(app)).then((went) => {
        if (!went) writeCheckIns({ ...readCheckIns(), [app]: days[app]! });
      });
    }, CHECK_IN_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [app, on, loaded]);
}
