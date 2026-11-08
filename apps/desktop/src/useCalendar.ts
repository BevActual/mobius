import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotesFailure, type CalendarAccount, type CalendarDraft, type CalendarEvent, type CalendarSource, type CalendarSuggestion, type NotesFailure } from '@mobius/shared';
import { daysFor, hiddenCalendars, isoDay, keepHidden, type CalendarMode } from './calendar-view';

const MODE_KEY = 'mobius.calendar.mode';
const FRESH_MS = 4000;
function rememberedMode(): CalendarMode {
  try {
    const v = window.localStorage.getItem(MODE_KEY);
    if (v === 'day' || v === 'week' || v === 'month') return v;
  } catch { /* Nothing kept. */ }
  return 'week';
}

/** The Calendar app's state: the calendars, the days on screen and their events, and changes that show at once. */
export function useCalendar() {
  const api = window.mobius.calendar;
  const [calendars, setCalendars] = useState<string[]>([]);
  const [sources, setSources] = useState<CalendarSource[]>([]);
  const [accounts, setAccounts] = useState<CalendarAccount[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [suggestions, setSuggestions] = useState<CalendarSuggestion[]>([]);
  const [mode, setModeState] = useState<CalendarMode>(rememberedMode);
  const setMode = useCallback((m: CalendarMode) => { setModeState(m); try { window.localStorage.setItem(MODE_KEY, m); } catch { /* Not kept. */ } }, []);
  const [anchor, setAnchor] = useState(() => new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(hiddenCalendars);
  const [message, setMessage] = useState('');
  // Events the agent just added or changed, marked for a moment so its work is visible without moving focus.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const live = useRef({ mode, anchor, events });
  live.current = { mode, anchor, events };

  const refresh = useCallback(async () => {
    if (!api) return [];
    const days = daysFor(live.current.mode, live.current.anchor);
    const [names, got, where, kept, waiting] = await Promise.all([api.calendars(), api.events(isoDay(days[0]!), isoDay(days[days.length - 1]!)), api.sources(), api.accounts(), api.suggestions()]);
    if (!isNotesFailure(waiting)) setSuggestions(waiting);
    if (!isNotesFailure(names)) setCalendars(names);
    if (!isNotesFailure(where)) setSources(where);
    if (!isNotesFailure(kept)) setAccounts(kept);
    if (isNotesFailure(got)) { setMessage(got.message); return live.current.events; }
    setEvents(got);
    return got;
  }, [api]);

  useEffect(() => { void refresh(); }, [mode, anchor, refresh]);
  useEffect(() => api?.onChanged((change) => {
    const before = new Set(live.current.events.map((e) => `${e.id}|${e.start}|${e.end}|${e.title}`));
    void refresh().then((after) => {
      if (change.by === 'person' || change.by === 'undo') return;
      const marked = after.filter((e) => !before.has(`${e.id}|${e.start}|${e.end}|${e.title}`)).map((e) => e.id);
      if (marked.length === 0) return;
      setFresh(new Set(marked));
      window.setTimeout(() => setFresh(new Set()), FRESH_MS);
    });
  }), [api, refresh]);
  // The calendars are ordinary files another app may change: read them again when the window comes back.
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => { window.removeEventListener('focus', again); document.removeEventListener('visibilitychange', again); };
  }, [refresh]);

  const settle = useCallback(async <T extends object>(result: T | NotesFailure | undefined): Promise<T | null> => {
    if (result === undefined) return null;
    if (isNotesFailure(result)) { setMessage(result.message); await refresh(); return null; }
    setMessage('');
    await refresh();
    return result as T;
  }, [refresh]);

  const add = useCallback(async (calendar: string, draft: CalendarDraft) => settle(await api?.add(calendar, draft)), [api, settle]);
  const update = useCallback(async (event: CalendarEvent, draft: CalendarDraft) => settle(await api?.update(event.calendar, event.id, draft)), [api, settle]);
  const remove = useCallback(async (event: CalendarEvent) => {
    setEvents((cur) => cur.filter((e) => e.id !== event.id));
    return settle(await api?.remove(event.calendar, event.id));
  }, [api, settle]);
  const createCalendar = useCallback(async (name: string) => {
    const made = await settle(await api?.create(name));
    return made?.name ?? null;
  }, [api, settle]);
  const toggle = useCallback((name: string) => setHidden((cur) => {
    const next = new Set(cur);
    if (next.has(name)) next.delete(name); else next.add(name);
    keepHidden(next);
    return next;
  }), []);

  /** Adds a subscription or a CalDAV account; null when it worked, otherwise what went wrong. */
  const addAccount = useCallback(async (account: { kind: 'subscription'; name: string; link: string } | { kind: 'caldav'; name: string; server: string; username: string; password: string }): Promise<string | null> => {
    if (!api) return 'Calendar is not available.';
    const result = account.kind === 'subscription' ? await api.subscribe(account.name, account.link) : await api.connect(account);
    if (isNotesFailure(result)) return result.message;
    await refresh();
    return null;
  }, [api, refresh]);
  const removeAccount = useCallback(async (id: string) => { if (api) { await api.removeAccount(id); await refresh(); } }, [api, refresh]);
  const sync = useCallback(async (id: string | null) => {
    if (!api) return;
    setSyncing(true);
    try { await api.sync(id); await refresh(); } finally { setSyncing(false); }
  }, [api, refresh]);
  const accept = useCallback(async (id: string) => settle(await api?.accept(id)), [api, settle]);
  const decline = useCallback(async (id: string) => {
    setSuggestions((cur) => cur.filter((s) => s.id !== id));
    return settle(await api?.decline(id));
  }, [api, settle]);
  const readOnly = useCallback((name: string) => sources.some((s) => s.name === name && s.readOnly), [sources]);

  const shown = events.filter((e) => !hidden.has(e.calendar));
  return { available: api !== undefined, calendars, sources, accounts, suggestions, accept, decline, addAccount, removeAccount, sync, syncing, readOnly, mode, setMode, anchor, setAnchor, events: shown, hidden, toggle, message, add, update, remove, createCalendar, fresh, refresh };
}

export type CalendarState = ReturnType<typeof useCalendar>;
