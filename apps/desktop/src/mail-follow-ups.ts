import { useCallback, useEffect, useState } from 'react';
import { isNotesFailure, type MailFollowUp } from '@mobius/shared';

const DAY = 86_400_000;

/** Remind if no reply: when, as the person picks it. Each is 9:00 on that day, so a reminder lands at the start of one. */
export const REMIND_AFTER: readonly { label: string; days: number }[] = [
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'In a week', days: 7 },
];

/** 9:00 on the day `days` from now. */
export function remindAt(days: number, now = new Date()): number {
  const at = new Date(now.getTime() + days * DAY);
  at.setHours(9, 0, 0, 0);
  return at.getTime();
}

/** Which of REMIND_AFTER a reminder time is, counted from `from` (when it was set or sent); null when none is. */
export function remindChoice(atMs: number | null | undefined, from = new Date()): number | null {
  if (!atMs) return null;
  return REMIND_AFTER.find((r) => remindAt(r.days, from) === atMs)?.days ?? null;
}

/** "Tomorrow", "Mon", "24 Nov": the day a reminder comes, for the button that set it. */
export function remindDay(atMs: number, now = new Date()): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(new Date(atMs)) - day(now)) / DAY);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return new Date(atMs).toLocaleDateString(undefined, { weekday: 'short' });
  return new Date(atMs).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Who a sent message waits on, by first name, for "No reply from Priya": the first person, and "and 2 others". */
export function waitingOn(to: readonly string[]): string {
  const name = (a: string) => {
    const m = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(a);
    const n = m ? m[1]!.trim() : a.trim().replace(/@.*$/, '');
    return n.split(/\s+/)[0] ?? n;
  };
  if (to.length === 0) return 'anyone';
  return to.length === 1 ? name(to[0]!) : `${name(to[0]!)} and ${to.length - 1} other${to.length === 2 ? '' : 's'}`;
}

/** Sent messages waiting on an answer, read again when mail changes or a reminder comes due. */
export function useFollowUps(active = true) {
  const api = window.mobius.mail;
  const [list, setList] = useState<MailFollowUp[]>([]);
  const load = useCallback(async () => {
    const got = await api?.followUps?.().catch(() => []);
    setList(!got || isNotesFailure(got) ? [] : got);
  }, [api]);
  useEffect(() => { if (active) void load(); }, [active, load]);
  useEffect(() => {
    if (!active || !api) return undefined;
    const offChanged = api.onChanged(() => void load());
    const offDue = api.onNoReply?.(() => void load());
    return () => { offChanged(); offDue?.(); };
  }, [active, api, load]);
  /** Starts (a time) or stops (null) waiting on a sent message. */
  const set = useCallback(async (id: string, remindMs: number | null) => {
    const got = await api?.followUp?.(id, remindMs).catch(() => null);
    await load();
    return Boolean(got && !isNotesFailure(got));
  }, [api, load]);
  const of = (id: string) => list.find((f) => (f.sentId === id || f.messageId === id) && f.status !== 'replied') ?? null;
  return { available: Boolean(api?.followUps), list, due: list.filter((f) => f.status === 'due'), of, set, load };
}
