import { useEffect, useRef } from 'react';

/**
 * The morning brief (Andrew, 26 November 2026): once each morning Mobius looks across the apps and writes what the day
 * holds, and it lands in Home's Inbox as one row, written, with Play to hear it. It only reads: it is asked in Ask mode,
 * so it changes nothing and does nothing alone. Reading it aloud on its own waits until the person turns that on.
 *
 * Which day has had its brief is kept on this computer, so a brief is asked once a day, on the first start (or the
 * first look while Mobius is open) from 5 in the morning.
 */
export const BRIEF_TITLE = 'Morning brief';
/** From this hour, local time, the day's brief is due. */
export const BRIEF_HOUR = 5;

const KEY = 'mobius.brief';
/** Said on `window` by Settings' Write one now: today's brief is asked at once, whether or not one was. */
export const BRIEF_NOW_EVENT = 'mobius:brief-now';

/** The local day, as YYYY-MM-DD. */
export function dayOf(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function lastBriefDay(): string | null {
  try { return window.localStorage.getItem(KEY); } catch { return null; }
}
export function markBriefDay(day: string): void {
  try { window.localStorage.setItem(KEY, day); } catch { /* Not remembered: at worst a second brief. */ }
}
function clearBriefDay(): void {
  try { window.localStorage.removeItem(KEY); } catch { /* Nothing to forget. */ }
}

/** Whether today's brief is still to be asked. */
export function briefDue(now: Date, last: string | null, on: boolean): boolean {
  return on && now.getHours() >= BRIEF_HOUR && last !== dayOf(now);
}

/** What Mobius is asked, in the person's voice; the first line names its chat. */
export function briefAsk(now: Date): string {
  const day = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  return `${BRIEF_TITLE}\n\nGive me my morning brief for ${day}. Look at what is due today or overdue in Tasks, today's events in Calendar and mail that is waiting for me. Write it as a few short lines, the most important first, grouped by app, and leave out any app with nothing for today. Only read: do not change anything.`;
}

/** The apps whose tools the brief may read. */
export const BRIEF_TOOLS = ['tasks', 'calendar', 'mail'] as const;

/** The brief as plain lines for its Inbox row, without Markdown marks: headings and items alike, at most `max`. */
export function briefLines(markdown: string, max = 8): string[] {
  return markdown.split('\n').map((l) => l.replace(/^\s*(#+|[-*+]|\d+[.)])\s*/, '').replace(/[*_`]/g, '').trim()).filter(Boolean).slice(0, max);
}

/** The brief's words for its Inbox row: its first line of text, without Markdown marks. */
export function briefLine(markdown: string, n = 140): string {
  const line = markdown.split('\n').map((l) => l.replace(/^\s*(#+|[-*+]|\d+[.)])\s*/, '').replace(/[*_`]/g, '').trim()).find(Boolean) ?? '';
  return line.length > n ? `${line.slice(0, n - 1)}…` : line;
}

/**
 * Asks for today's brief when it is due: at start, once the settings are read (so a brief turned off is never asked),
 * and every ten minutes while Mobius stays open; and at once when Write one now is pressed, on or off. `ask` sends it
 * and says whether it went; one that did not go (no model yet, say) is asked again at the next look.
 */
export function useMorningBrief(on: boolean, loaded: boolean, ask: (text: string) => Promise<boolean>): void {
  const send = useRef(ask);
  send.current = ask;
  useEffect(() => {
    const now = () => { const at = new Date(); markBriefDay(dayOf(at)); void send.current(briefAsk(at)); };
    window.addEventListener(BRIEF_NOW_EVENT, now);
    return () => window.removeEventListener(BRIEF_NOW_EVENT, now);
  }, []);
  useEffect(() => {
    if (!on || !loaded) return;
    let asking = false;
    const look = () => {
      const now = new Date();
      const last = lastBriefDay();
      if (asking || !briefDue(now, last, true)) return;
      asking = true;
      markBriefDay(dayOf(now));
      void send.current(briefAsk(now)).then((went) => {
        asking = false;
        if (!went) { if (last) markBriefDay(last); else clearBriefDay(); }
      });
    };
    look();
    const timer = window.setInterval(look, 10 * 60_000);
    return () => window.clearInterval(timer);
  }, [on, loaded]);
}
