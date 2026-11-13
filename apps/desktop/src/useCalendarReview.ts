import { useCallback, useEffect, useState } from 'react';
import type { CalendarEvent } from '@mobius/shared';
import { isNotesFailure } from '@mobius/shared';
import { addDays, changedSince, isoDay } from './calendar-view';
import { KEPT_EVENT, fileKept, keepTurn, turnId } from './ReviewStrip';

/** Mobius's last turn changed these calendars, and the change waits to be kept. */
export type CalendarReview = { conversation: string; calendars: readonly string[] };

const fileOf = (calendar: string) => `calendar/${calendar}.ics`;
/** How far back and ahead of today a changed event is looked for. Mobius plans weeks ahead, rarely years, and the core
 * answers at most 400 days at once (MAX_RANGE_DAYS in calendar.rs). */
const BACK_DAYS = 30;
const AHEAD_DAYS = 365;

/**
 * What Mobius's last turn added or changed in the calendars, as Tasks shows for a list: the events (soonest first), and
 * Keep and Discard for Calendar's part of the turn. `version` changes whenever the events on screen do.
 */
export function useCalendarReview(review: CalendarReview | null, version: unknown) {
  const [changed, setChanged] = useState<CalendarEvent[]>([]);
  const [problem, setProblem] = useState('');
  const key = review ? `${review.conversation}|${review.calendars.join('|')}` : '';
  const look = useCallback(async () => {
    const api = window.mobius.calendar;
    if (!review || !api) return [];
    const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
    const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
    const waiting = review.calendars.filter((c) => !(id && fileKept(id, fileOf(c))));
    if (waiting.length === 0) return [];
    const today = new Date();
    const now = await api.events(isoDay(addDays(today, -BACK_DAYS)), isoDay(addDays(today, AHEAD_DAYS)));
    if (isNotesFailure(now)) return [];
    const found = await Promise.all(waiting.map(async (c) => {
      const was = await window.mobius.changes.before(review.conversation, fileOf(c)).catch(() => null);
      if (!was || !was.ok) return [];
      // No earlier copy means the turn made the file, so everything in it is new.
      return changedSince(was.text, now.filter((e) => e.calendar === c));
    }));
    return found.flat().sort((a, b) => a.start.localeCompare(b.start));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    const check = () => { void look().then((got) => { if (live) setChanged(got); }); };
    check();
    window.addEventListener(KEPT_EVENT, check);
    return () => { live = false; window.removeEventListener(KEPT_EVENT, check); };
  }, [look, version]);

  const keep = async () => {
    if (!review) return;
    const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
    const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
    // Only Calendar's part: what the turn changed in other apps still waits there.
    if (id) keepTurn(id, 'calendar');
    setChanged([]);
  };
  const discard = async () => {
    if (!review) return;
    setProblem('');
    for (const c of review.calendars) {
      const result = await window.mobius.changes.undoFile(review.conversation, fileOf(c)).catch(() => null);
      if (!result || !result.ok) { setProblem(`Couldn't put ${c} back.`); return; }
    }
    setChanged([]);
  };
  return { changed: review ? changed : [], keep, discard, problem };
}
