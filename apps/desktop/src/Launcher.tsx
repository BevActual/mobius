import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Reorder } from 'motion/react';
import type { BrowserTabState } from '@mobius/shared';
import { APPS, DEFAULT_APPS, appName, isAvailable, isInstalled, recentApps, recentItems, type AppId, type RecentItem } from './apps';
import { APP_ICONS, OWN_ICONS } from './Rail';
import { relativeTime } from './relative-time';
import { quickAnswer } from './quick-answers';
import { afterPaint } from './ui/frame';
import './launcher.css';

/**
 * The launcher (Ctrl+K, and the Go button in the top bar): everything the app rail did, and the way to find anything
 * (docs/design/panel-layouts.md, "The Go button and Ctrl+K").
 *
 * - Nothing typed: Ask Mobius; the pinned apps in one row, each with a dot while something waits there (drag to
 *   reorder, Alt+Left and Alt+Right too; right-click to unpin); Recent, the things last open in any app; and Home,
 *   Activity, Abilities and Settings at the foot.
 * - Typing: one search over apps, items in every app, open pages and commands, with Ask Mobius always first, so a
 *   search that finds nothing becomes a question. Right-click an app to pin it.
 *
 * A modal dialog, so focus is trapped and Escape closes it.
 */

export interface LauncherItem {
  id: string;
  kind: 'ask' | 'answer' | 'pinned' | 'recent' | 'place' | 'app' | 'item' | 'tab' | 'command' | 'grid';
  label: string;
  detail?: string;
  disabled?: boolean;
  /** The app whose icon the row shows. */
  app?: AppId;
  /** Things waiting in this app (a pinned app's dot). */
  waiting?: number;
  /** A place at the foot: its mark. */
  place?: Place;
  run: () => void;
}

/** Something found in an app as the person types: a note, a thread, an event, a file. */
export interface FoundItem { id: string; app: AppId; label: string; detail?: string; run: () => void }

export type Place = 'home' | 'activity' | 'abilities' | 'settings';
const PLACE_NAMES: Record<Place, string> = { home: 'Home', activity: 'Activity', abilities: 'Abilities', settings: 'Settings' };
const HOME_ICON = <><path d="M3.5 9 10 3.5 16.5 9" /><path d="M5 7.8V16h10V7.8" /></>;
const PLACE_ICONS: Record<Place, ReactNode> = { home: HOME_ICON, activity: OWN_ICONS.activity, abilities: OWN_ICONS.extensions, settings: OWN_ICONS.settings };

interface Props {
  open: boolean;
  onClose: () => void;
  tabs: BrowserTabState[];
  onNewTab: () => void;
  onActivateTab: (id: string) => void;
  onOpenApp: (id: AppId) => void;
  /** Hand what was typed to Mobius as a question. */
  onAsk?: (text: string) => void;
  /** Ask Mobius with nothing typed: open the Mobius panel. */
  onOpenMobius?: () => void;
  /** Everything the menus can do now, to find by name. */
  commands?: readonly { id: string; label: string; detail?: string; run: () => void }[];
  /** The pinned apps, in order (the person's choice). Ctrl+1 to Ctrl+9 open the first nine. */
  pinned?: readonly AppId[];
  /** Reorder, pin or unpin. Without it the row can't be changed here. */
  onPinned?: (apps: AppId[]) => void;
  /** How many things wait in each app, for the dots. */
  waiting?: Partial<Record<AppId, number>>;
  /** The things last open in any app, newest first (by default, what `noteRecentItem` kept). */
  recent?: readonly RecentItem[];
  onOpenRecent?: (item: RecentItem) => void;
  /** Items in every app that match what was typed (notes, threads, events, files), best first. A promise when some
   *  sources answer later: what was found before stays until it comes, with a thin line under the field meanwhile. */
  find?: (query: string) => readonly FoundItem[] | Promise<readonly FoundItem[]>;
  /** Home, Activity, Abilities and Settings at the foot: each one shown when given. */
  places?: Partial<Record<Place, () => void>>;
  /** For the reference sheet: drawn in place, open, instead of as a modal dialog. */
  inline?: boolean;
  /** For the reference sheet: the time Recent counts from. */
  now?: number;
  /** Ask Mobius about a row (Alt+Enter, or Ask Mobius about this in its actions): Mobius opens with it attached. */
  onAskAbout?: (item: { app?: AppId; label: string; detail?: string }) => void;
  /** Changes when the launcher's key is pressed again while it is open: it switches to All apps and back. */
  again?: number;
  /** For the reference sheet: start in All apps. */
  startIn?: LauncherView;
}

/** The start (Ask, Pinned, Recent, places), or every app as a grid. */
export type LauncherView = 'start' | 'apps';
/** All apps is a grid this many tiles across. */
export const GRID_COLS = 7;

const SECTION: Record<LauncherItem['kind'], string> = {
  ask: 'Ask Mobius', answer: 'Answer', pinned: 'Pinned', recent: 'Recent', place: 'Places', app: 'Apps', item: 'In your apps', tab: 'Open pages', command: 'Commands', grid: 'All apps',
};
/** The kinds laid out in a row (left and right move along them). */
const ACROSS = new Set<LauncherItem['kind']>(['pinned', 'place', 'grid']);

/** Apps in the order to offer them: recent first when nothing is typed, else names starting with the words first. */
export function rankApps<T extends { id: AppId; name: string }>(apps: readonly T[], q: string, recent: readonly AppId[] = recentApps(6)): T[] {
  const score = (a: T) => (q ? (a.name.toLowerCase().startsWith(q) ? 0 : 1) : (recent.includes(a.id) ? recent.indexOf(a.id) - 100 : 0));
  return apps.map((a, i) => ({ a, i, s: score(a) })).sort((x, y) => x.s - y.s || x.i - y.i).map((x) => x.a);
}

/** The pinned apps that can be opened, in order; by default the everyday apps. Home is a place, not a pin. */
export const pinnedApps = (pinned?: readonly AppId[]): AppId[] => [...new Set(pinned ?? DEFAULT_APPS)].filter((id) => id !== 'agent' && isAvailable(id));

/**
 * Where the arrows go. Items are drawn in rows: the pinned apps share a row across, and so do the places; All apps
 * is a grid `GRID_COLS` across; every other item is a row of its own. Up and Down go to the row above or below (into a row across, to the same place in it, or
 * its end), wrapping round; Left and Right move along a row across.
 */
export function stepFrom(kinds: readonly LauncherItem['kind'][], at: number, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): number {
  if (!kinds.length) return 0;
  const rows: number[][] = [];
  kinds.forEach((kind, i) => {
    const last = rows[rows.length - 1];
    if (last && ACROSS.has(kind) && kinds[last[0]!] === kind && !(kind === 'grid' && last.length >= GRID_COLS)) last.push(i);
    else rows.push([i]);
  });
  const r = rows.findIndex((row) => row.includes(at));
  if (r < 0) return 0;
  const row = rows[r]!;
  const c = row.indexOf(at);
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    if (row.length < 2) return at;
    return row[Math.min(row.length - 1, Math.max(0, c + (key === 'ArrowRight' ? 1 : -1)))]!;
  }
  const next = rows[(r + (key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]!;
  return next[Math.min(c, next.length - 1)]!;
}

/** Every app that can be opened now, A to Z: what All apps shows. */
export const everyApp = (): AppId[] => APPS.filter((a) => a.available && isInstalled(a.id) && a.id !== 'agent').sort((x, y) => x.name.localeCompare(y.name)).map((a) => a.id);

/** A name with the typed words drawn in ink: the first place they appear, or nothing marked. */
export function marked(label: string, query: string): ReactNode {
  const q = query.trim();
  const at = q ? label.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return label;
  return <>{label.slice(0, at)}<mark className="launcher-match">{label.slice(at, at + q.length)}</mark>{label.slice(at + q.length)}</>;
}

/** With ">" first, only commands: those matching the words after it. Null when the text doesn't start with ">". */
export function commandsOnly<T extends { label: string; detail?: string }>(commands: readonly T[], text: string, limit = 30): T[] | null {
  const typed = text.trim();
  if (!typed.startsWith('>')) return null;
  const words = typed.slice(1).trim().toLowerCase();
  return commands.filter((c) => `${c.label} ${c.detail ?? ''}`.toLowerCase().includes(words)).slice(0, limit);
}

/**
 * What was picked for what was typed, so it rises next time (Raycast's and Spotlight's way). Keyed by the first three
 * letters typed, so "no", "not" and "note" share what they learned. Kept on this device only, never sent anywhere.
 */
export type Choices = Record<string, Record<string, number>>;
const CHOICES_KEY = 'mobius.launcher.choices';
const choiceKey = (query: string) => query.trim().toLowerCase().slice(0, 3);

/** Count one pick of `id` for `query`. Each prefix keeps its 20 most picked. */
export function noteChoice(choices: Choices, query: string, id: string): Choices {
  const key = choiceKey(query);
  if (!key) return choices;
  const counts = { ...choices[key], [id]: (choices[key]?.[id] ?? 0) + 1 };
  const kept = Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20));
  return { ...choices, [key]: kept };
}

/** Within each kind, the ones picked most for this query first; the rest keep their order. Ask stays first. */
export function rankByChoice<T extends { id: string; kind: string }>(items: readonly T[], choices: Choices, query: string): T[] {
  const counts = choices[choiceKey(query)];
  if (!counts) return [...items];
  const kindOrder = [...new Set(items.map((i) => i.kind))];
  return kindOrder.flatMap((kind) => items.map((item, i) => ({ item, i })).filter(({ item }) => item.kind === kind)
    .sort((a, b) => (counts[b.item.id] ?? 0) - (counts[a.item.id] ?? 0) || a.i - b.i).map(({ item }) => item));
}

function readChoices(): Choices {
  try { const v = JSON.parse(window.localStorage.getItem(CHOICES_KEY) ?? '{}') as unknown; return v && typeof v === 'object' ? v as Choices : {}; } catch { return {}; }
}
function writeChoices(choices: Choices) {
  try { window.localStorage.setItem(CHOICES_KEY, JSON.stringify(choices)); } catch { /* Not kept. */ }
}

/** "Mail" or "Mail, 3 waiting". */
const withWaiting = (name: string, waiting = 0) => (waiting > 0 ? `${name}, ${waiting} waiting` : name);

const AppMark = ({ app, place, kind }: { app?: AppId; place?: Place; kind: LauncherItem['kind'] }) => (
  <span className="launcher-icon" data-kind={kind} aria-hidden="true">
    {place ? <svg viewBox="0 0 20 20" data-place={place}>{PLACE_ICONS[place]}</svg>
      : app ? <svg viewBox="0 0 20 20" data-app={app}>{APP_ICONS[app]}</svg>
        : kind === 'ask' ? <svg viewBox="0 0 20 20" data-app="agent">{APP_ICONS.agent}</svg>
          : kind === 'tab' ? <svg viewBox="0 0 20 20" data-app="browser">{APP_ICONS.browser}</svg>
          : kind === 'answer' ? <svg viewBox="0 0 20 20" data-answer=""><path d="M5 8h10M5 12h10" /></svg>
            : <svg viewBox="0 0 20 20"><path d="M6 7l-3 3 3 3M9 14h8" /></svg>}
  </span>
);

export function Launcher({
  open, onClose, tabs, onNewTab, onActivateTab, onOpenApp, onAsk, onOpenMobius, commands = [], pinned, onPinned, waiting = {}, recent, onOpenRecent, find,
  places = {}, inline = false, now, again, startIn = 'start', onAskAbout,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  // null: the default row (what was found, or Ask when nothing was). An item's id once the arrows or pointer chose,
  // so results that arrive later never move what is chosen.
  const [chosenId, setChosenId] = useState<string | null>(null);
  // Kept while Mobius runs: it opens again in the view it was left in.
  const [view, setView] = useState<LauncherView>(startIn);
  // Narrowed to one app (Tab on an app), or showing one row's actions (Shift+Enter).
  const [scope, setScope] = useState<AppId | null>(null);
  const [actionsFor, setActionsFor] = useState<LauncherItem | null>(null);
  const switchView = useCallback((to: LauncherView) => { setView(to); setQuery(''); setChosenId(null); setScope(null); setActionsFor(null); }, []);
  const againWas = useRef(again);
  useEffect(() => {
    if (againWas.current === again) return;
    againWas.current = again;
    if (open) switchView(view === 'apps' ? 'start' : 'apps');
  }, [again, open, view, switchView]);
  const [status, setStatus] = useState('');
  // While a pinned app is dragged the order lives here; it is saved once, when it is let go.
  const [dragOrder, setDragOrder] = useState<AppId[] | null>(null);
  const dragOrderRef = useRef(dragOrder);
  dragOrderRef.current = dragOrder;
  const dragged = useRef(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element || inline) return;
    if (open && !element.open) {
      // The field is already empty: it was emptied as the launcher closed. Emptying it only now, after it shows, could
      // land after the first letters typed into it, and the same words typed again went unseen (the field already held
      // them), so Enter opened whatever was first for an empty field.
      // It opens from the Go button, just under it, when that is on screen; otherwise across the middle.
      const go = document.querySelector('.go-button')?.getBoundingClientRect();
      if (go && go.width > 0) {
        element.style.setProperty('--launcher-left', `${Math.round(go.left)}px`);
        element.style.setProperty('--launcher-top', `${Math.round(go.bottom + 4)}px`);
        element.dataset.anchored = 'go';
      } else delete element.dataset.anchored;
      element.showModal();
      input.current?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open, inline]);
  // However it closed (a choice, Escape, a click outside), it is empty and unchosen for next time.
  useEffect(() => {
    if (open) return;
    setQuery('');
    setChosenId(null);
    setScope(null);
    setActionsFor(null);
    setStatus('');
    setDragOrder(null);
  }, [open]);

  // While it is open the keys are its own: something behind it that takes the focus as it loads (an editor opening a
  // page) hands it back, so Enter opens what was found instead of going into that page.
  useEffect(() => {
    if (!open || inline) return undefined;
    const keep = (event: FocusEvent) => {
      const element = dialog.current;
      if (element?.open && event.target instanceof Node && !element.contains(event.target)) input.current?.focus();
    };
    document.addEventListener('focusin', keep, true);
    return () => document.removeEventListener('focusin', keep, true);
  }, [open, inline]);

  const pins = useMemo(() => dragOrder ?? pinnedApps(pinned), [dragOrder, pinned]);
  // Read as it opens, so what was opened since shows.
  const lastOpen = useMemo(() => recent ?? (open ? recentItems(6) : []), [recent, open]);

  const pin = useCallback((id: AppId, on: boolean) => {
    if (!onPinned) return;
    const was = pinnedApps(pinned);
    if (on === was.includes(id)) return;
    onPinned(on ? [...was, id] : was.filter((a) => a !== id));
    setStatus(on ? `${appName(id)} pinned` : `${appName(id)} unpinned`);
  }, [onPinned, pinned]);

  /** What a query finds, in the order shown. */
  const pinRef = useRef(pin);
  pinRef.current = pin;
  const narrow = useCallback((app: AppId) => { setScope(app); setActionsFor(null); setQuery(''); setChosenId(null); input.current?.focus(); }, []);
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;

  /** What can be done with a row: shown by Shift+Enter. */
  const actionsOf = useCallback((item: LauncherItem): LauncherItem[] => {
    const act = (id: string, label: string, run: () => void, detail?: string): LauncherItem => ({ id: `act-${id}`, kind: 'command', label, detail, run });
    const pinned = item.app ? pins.includes(item.app) : false;
    return [
      act('open', item.kind === 'command' ? 'Run' : 'Open', item.run, '↵'),
      ...(onAskAbout ? [act('ask', 'Ask Mobius about this', () => onAskAbout({ app: item.app, label: item.label, detail: item.detail }), 'Alt+↵')] : []),
      ...(item.app && onPinned && (item.kind === 'pinned' || item.kind === 'app' || item.kind === 'grid')
        ? [act('pin', pinned ? 'Unpin' : 'Pin', () => pinRef.current(item.app!, !pinned))] : []),
      ...(item.app && !scope ? [act('scope', `Search in ${appName(item.app)}`, () => narrowRef.current(item.app!), 'Tab')] : []),
      act('copy', 'Copy name', () => { void navigator.clipboard?.writeText(item.label).catch(() => undefined); }),
    ];
  }, [pins, onAskAbout, onPinned, scope]);

  // Sources that answer later: the words asked, and their items once they came. Until then the items found before
  // stay, so nothing jumps when they arrive.
  const pending = useRef<{ text: string; answer: Promise<readonly FoundItem[]> } | null>(null);
  const [later, setLater] = useState<{ text: string; items: readonly FoundItem[] } | null>(null);
  useEffect(() => { if (!open) { pending.current = null; setLater(null); } }, [open]);
  const findNow = useCallback((text: string): readonly FoundItem[] => {
    if (!find || !text) return [];
    if (later?.text === text) return later.items;
    if (pending.current?.text !== text) {
      const answer = find(text);
      if (!(answer instanceof Promise)) return answer;
      pending.current = { text, answer };
      const keep = (items: readonly FoundItem[]) => { if (pending.current?.answer === answer) setLater({ text, items }); };
      answer.then(keep, () => keep([]));
    }
    return later?.items ?? [];
  }, [find, later]);

  const listFor = useCallback((text: string): LauncherItem[] => {
    const q = text.trim().toLowerCase();
    const typed = text.trim();
    const has = (words: string) => words.toLowerCase().includes(q);
    if (actionsFor) return actionsOf(actionsFor).filter((a) => has(a.label));
    // ">" first: commands only.
    const only = view === 'start' && !scope ? commandsOnly(commands, typed) : null;
    if (only) {
      return only
        .map<LauncherItem>((c) => ({ id: `cmd-${c.id}`, kind: 'command', label: c.label, detail: c.detail, run: c.run }));
    }
    // Narrowed to one app: its items, then its commands; with nothing typed, the app itself first.
    if (scope) {
      const name = appName(scope);
      return [
        ...(!q ? [{ id: `app-${scope}`, kind: 'app' as const, app: scope, label: `Open ${name}`, run: () => onOpenApp(scope) }] : []),
        ...(q ? findNow(typed).filter((item) => item.app === scope).slice(0, 20).map<LauncherItem>((item) => ({ id: `item-${item.app}-${item.id}`, kind: 'item', app: item.app, label: item.label, detail: item.detail, run: item.run })) : []),
        ...commands.filter((c) => (c.detail ?? '').includes(name) && has(c.label)).slice(0, 12)
          .map<LauncherItem>((c) => ({ id: `cmd-${c.id}`, kind: 'command', label: c.label, detail: c.detail, run: c.run })),
      ];
    }
    if (view === 'apps') {
      return [
        ...everyApp().filter((id) => has(`${appName(id)} ${APPS.find((a) => a.id === id)?.also ?? ''}`)).map<LauncherItem>((id) => {
          const at = pins.indexOf(id);
          return { id: `grid-${id}`, kind: 'grid', app: id, label: appName(id), waiting: waiting[id] ?? 0, detail: at >= 0 && at < 9 ? `Ctrl+${at + 1}` : undefined, run: () => onOpenApp(id) };
        }),
        ...(places.abilities && has('Add apps abilities') ? [{ id: 'grid-more', kind: 'grid' as const, place: 'abilities' as const, label: 'Add apps', run: () => places.abilities!() }] : []),
      ];
    }
    if (!q) {
      const ask: LauncherItem[] = onOpenMobius || onAsk
        ? [{ id: 'ask', kind: 'ask', label: 'Ask Mobius', detail: 'Type a question', run: () => (onOpenMobius ? onOpenMobius() : onAsk?.('')) }]
        : [];
      return [
        ...ask,
        ...pins.map<LauncherItem>((id, i) => ({
          id: `pin-${id}`, kind: 'pinned', app: id, label: appName(id), waiting: waiting[id] ?? 0, detail: i < 9 ? `Ctrl+${i + 1}` : undefined, run: () => onOpenApp(id),
        })),
        { id: 'all-apps', kind: 'pinned', label: 'All apps', run: () => switchView('apps') },
        ...lastOpen.map<LauncherItem>((r) => ({
          id: `recent-${r.app}-${r.ref}`, kind: 'recent', app: r.app, label: r.label, detail: `${appName(r.app)} · ${relativeTime(r.at, now ?? Date.now())}`,
          disabled: !onOpenRecent, run: () => onOpenRecent?.(r),
        })),
        ...(Object.keys(PLACE_NAMES) as Place[]).filter((p) => places[p]).map<LauncherItem>((p) => ({
          id: `place-${p}`, kind: 'place', place: p, label: PLACE_NAMES[p], run: () => places[p]!(),
        })),
      ];
    }
    return [
      ...(onAsk ? [{ id: 'ask', kind: 'ask' as const, label: `Ask Mobius: “${typed.length > 60 ? `${typed.slice(0, 59)}…` : typed}”`, run: () => onAsk(typed) }] : []),
      // A sum, a unit or a time somewhere else: answered here, and Enter copies it.
      ...((answer) => (answer ? [{ id: 'answer', kind: 'answer' as const, label: answer.value, detail: answer.question, run: () => { void navigator.clipboard?.writeText(answer.copy).catch(() => undefined); } }] : []))(quickAnswer(typed)),
      // As in Spotlight and Raycast: names that start with what was typed come before names that only contain it.
      ...rankApps(APPS.filter((app) => has(`${app.name} ${app.also ?? ''}`)), q).map<LauncherItem>((app) => ({
        id: `app-${app.id}`,
        kind: 'app',
        app: app.id,
        label: app.name,
        waiting: waiting[app.id] ?? 0,
        // An app not added yet is found too: choosing it opens Abilities to add it.
        detail: !app.available ? 'Not built yet' : !isInstalled(app.id) ? 'Add from Abilities' : pins.indexOf(app.id) >= 0 && pins.indexOf(app.id) < 9 ? `Ctrl+${pins.indexOf(app.id) + 1}` : undefined,
        disabled: !app.available,
        run: () => onOpenApp(app.id),
      })),
      ...(Object.keys(PLACE_NAMES) as Place[]).filter((p) => places[p] && has(PLACE_NAMES[p]) && !APPS.some((a) => a.name === PLACE_NAMES[p])).map<LauncherItem>((p) => ({
        id: `place-${p}`, kind: 'app', place: p, label: PLACE_NAMES[p], run: () => places[p]!(),
      })),
      ...findNow(typed).slice(0, 8).map<LauncherItem>((item) => ({ id: `item-${item.app}-${item.id}`, kind: 'item', app: item.app, label: item.label, detail: item.detail ?? appName(item.app), run: item.run })),
      ...tabs.filter((tab) => has(`${tab.title} ${tab.url}`)).map<LauncherItem>((tab) => ({
        id: `tab-${tab.id}`,
        kind: 'tab',
        label: tab.title,
        detail: tab.url,
        run: () => onActivateTab(tab.id),
      })),
      ...(commands.length > 0
        ? commands.filter((command) => has(`${command.label} ${command.detail ?? ''}`)).slice(0, 12).map<LauncherItem>((command) => ({ id: `cmd-${command.id}`, kind: 'command', label: command.label, detail: command.detail, run: command.run }))
        : [{ id: 'new-tab', label: 'New tab', detail: 'Ctrl+T' }]
          .filter((command) => has(command.label))
          .map<LauncherItem>((command) => ({ id: command.id, kind: 'command', label: command.label, detail: command.detail, run: onNewTab }))),
    ];
  }, [actionsFor, actionsOf, scope, view, switchView, tabs, onNewTab, onActivateTab, onOpenApp, onAsk, onOpenMobius, commands, pins, waiting, lastOpen, onOpenRecent, findNow, places, now]);
  const [choices, setChoices] = useState<Choices>(() => (typeof window === 'undefined' ? {} : readChoices()));
  const listRanked = useCallback((text: string) => (text.trim() && !actionsFor ? rankByChoice(listFor(text), choices, text) : listFor(text)), [listFor, choices, actionsFor]);
  const items = useMemo(() => listRanked(query), [listRanked, query]);
  // Read after the list is made, which is when a source that answers later is asked.
  const finding = !!find && !!query.trim() && pending.current?.text === query.trim() && later?.text !== query.trim();

  // Ask Mobius is always the first row, but Enter opens what was found when something was: typing "notes" and
  // pressing Enter opens Notes, and with nothing typed Enter opens the first pinned app. With nothing found, Enter
  // asks. Worked out as the list is drawn, so a quick Enter right after typing gets the same row.
  const found = items.findIndex((item) => item.kind !== 'ask' && !item.disabled);
  const picked = chosenId === null ? -1 : items.findIndex((item) => item.id === chosenId);
  const selected = picked >= 0 ? picked : Math.max(0, found > 0 ? found : 0);
  const current = items[selected];
  const setSelected = (index: number) => setChosenId(items[index]?.id ?? null);

  const activate = (item: LauncherItem | undefined) => {
    if (!item || item.disabled || dragged.current) return;
    // All apps is a view of the launcher, not somewhere to go: it stays open.
    if (item.id === 'all-apps' || item.id === 'act-scope') { item.run(); return; }
    const typed = input.current?.value ?? query;
    if (typed.trim() && item.kind !== 'ask' && !actionsFor) {
      const next = noteChoice(choices, typed, item.id);
      setChoices(next);
      writeChoices(next);
    }
    onClose();
    item.run();
    // Opening an app hands it the keyboard. The closing dialog gives focus back to where it was (often Message Mobius),
    // which is right for a command but left an app's list keys typing into the composer.
    if (item.app && (item.kind === 'app' || item.kind === 'grid' || item.kind === 'pinned') && !inline) {
      afterPaint(() => landInStage(document.querySelector<HTMLElement>('main.stage'), document.activeElement));
    }
  };

  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    const empty = event.currentTarget.value === '';
    const k = event.key;
    // The launcher's key again, or Backspace or Escape with nothing typed in All apps: between the two views.
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && k.toLowerCase() === 'k') {
      event.preventDefault();
      event.stopPropagation();
      switchView(view === 'apps' ? 'start' : 'apps');
      return;
    }
    // Back out of the actions, then out of an app, then out of All apps.
    if (actionsFor && (k === 'Escape' || (empty && (k === 'Backspace' || k === 'ArrowLeft')))) { event.preventDefault(); setActionsFor(null); setQuery(''); setChosenId(actionsFor.id); return; }
    if (scope && empty && (k === 'Backspace' || k === 'Escape')) { event.preventDefault(); setScope(null); setChosenId(null); return; }
    if (view === 'apps' && empty && (k === 'Backspace' || k === 'Escape')) { event.preventDefault(); switchView('start'); return; }
    // Tab on an app (or something in one) narrows the launcher to that app.
    if (k === 'Tab' && !event.shiftKey && !actionsFor && !scope && current?.app && current.kind !== 'grid') { event.preventDefault(); narrow(current.app); return; }
    // Shift+Enter, or Right at the end of the words, shows the chosen row's actions.
    const atEnd = event.currentTarget.selectionStart === event.currentTarget.value.length;
    if (!actionsFor && current && current.kind !== 'ask' && current.kind !== 'answer' && !current.disabled && current.id !== 'all-apps'
      && ((k === 'Enter' && event.shiftKey) || (k === 'ArrowRight' && !empty && atEnd && !ACROSS.has(current.kind)))) {
      event.preventDefault();
      setActionsFor(current); setQuery(''); setChosenId(null);
      return;
    }
    // Alt+Enter asks Mobius about the chosen row.
    if (k === 'Enter' && event.altKey && onAskAbout && current && current.kind !== 'ask' && !actionsFor) {
      event.preventDefault();
      onClose();
      onAskAbout({ app: current.app, label: current.label, detail: current.detail });
      return;
    }
    // Alt+Left and Alt+Right move the chosen pinned app along the row.
    if (empty && event.altKey && (k === 'ArrowLeft' || k === 'ArrowRight') && current?.kind === 'pinned' && current.app && onPinned) {
      event.preventDefault();
      const order = [...pins];
      const at = order.indexOf(current.app);
      const to = at + (k === 'ArrowRight' ? 1 : -1);
      if (to < 0 || to >= order.length) return;
      [order[at], order[to]] = [order[to]!, order[at]!];
      onPinned(order);
      // The same app stays chosen as it moves.
      setStatus(`${appName(current.app)} moved to ${to + 1} of ${order.length}`);
      return;
    }
    // Shift+F10 or the menu key does what a right-click does: pin or unpin the chosen app.
    if ((k === 'ContextMenu' || (k === 'F10' && event.shiftKey)) && current?.app && onPinned && (current.kind === 'pinned' || current.kind === 'app')) {
      event.preventDefault();
      pin(current.app, current.kind !== 'pinned' && !pins.includes(current.app));
      return;
    }
    if (k === 'ArrowDown' || k === 'ArrowUp' || (empty && (k === 'ArrowLeft' || k === 'ArrowRight'))) {
      event.preventDefault();
      setSelected(stepFrom(items.map((i) => i.kind), selected, k));
    } else if (k === 'Enter') {
      event.preventDefault();
      // What is in the field now, even if the list has not been drawn for it yet: a quick Enter right after
      // typing opens what was typed, never what was first in the list before.
      const typed = event.currentTarget.value;
      if (typed === query) activate(items[selected]);
      else { const list = listRanked(typed); const first = list.findIndex((item) => item.kind !== 'ask' && !item.disabled); activate(list[first > 0 ? first : 0]); }
      return;
    } else if (k === 'Escape') { event.preventDefault(); onClose(); }
  };

  const activeId = current ? `launcher-option-${current.id}` : undefined;
  const sections = (Object.keys(SECTION) as Array<LauncherItem['kind']>).filter((kind) => items.some((item) => item.kind === kind));

  const option = (item: LauncherItem, index: number) => {
    const across = ACROSS.has(item.kind);
    const name = item.kind === 'pinned' || item.kind === 'app' || item.kind === 'grid' ? withWaiting(item.label, item.waiting) : item.label;
    const canPin = !!item.app && !!onPinned && (item.kind === 'pinned' || item.kind === 'app' || item.kind === 'grid');
    return {
      id: `launcher-option-${item.id}`,
      role: 'option' as const,
      'aria-selected': index === selected,
      'aria-disabled': item.disabled || undefined,
      'aria-label': item.detail && !across ? `${name}, ${item.detail}` : name,
      className: across ? 'launcher-tile' : 'launcher-option',
      'data-kind': item.kind,
      title: item.id === 'all-apps' ? 'Every app (Ctrl+K again)'
        : item.kind === 'pinned' ? `${item.label}${item.detail ? ` (${item.detail})` : ''}${onPinned ? '. Drag to reorder, right-click to unpin' : ''}`
          : item.kind === 'grid' && item.app ? `${item.label}${item.detail ? ` (${item.detail})` : ''}${onPinned ? (pins.includes(item.app) ? '. Right-click to unpin' : '. Right-click to pin') : ''}` : undefined,
      onPointerMove: () => setChosenId(item.id),
      onClick: () => activate(item),
      onContextMenu: canPin ? (event: MouseEvent) => { event.preventDefault(); pin(item.app!, item.kind !== 'pinned' && !pins.includes(item.app!)); } : undefined,
    };
  };

  const dot = (item: LauncherItem) => (item.waiting ?? 0) > 0 && <span className="launcher-dot" aria-hidden="true" />;

  const body = (
    <>
      <div className="launcher-search">
        {(scope || actionsFor) && (
          <span className="launcher-scope" aria-hidden="true">
            {scope && !actionsFor && <AppMark app={scope} kind="app" />}
            {actionsFor ? actionsFor.label : appName(scope!)}
            <svg viewBox="0 0 20 20"><path d="M8 5.5 12.5 10 8 14.5" /></svg>
          </span>
        )}
        <input
          ref={input}
          id="launcher-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="launcher-list"
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label={actionsFor ? `Actions for ${actionsFor.label}` : scope ? `Search in ${appName(scope)}` : view === 'apps' ? 'Find an app' : 'Find apps, pages and commands'}
          placeholder={actionsFor ? 'Choose an action' : scope ? `Search in ${appName(scope)}` : view === 'apps' ? 'Find an app' : 'Find, open or ask anything'}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setChosenId(null); }}
          onKeyDown={keys}
        />
        {finding && <span className="launcher-finding" aria-hidden="true" />}
        {view === 'apps' ? <button type="button" className="launcher-back" onClick={() => { switchView('start'); input.current?.focus(); }}>Back</button> : <kbd>Esc</kbd>}
      </div>
      <div id="launcher-list" role="listbox" aria-label="Results" className="launcher-list">
        {sections.map((kind) => {
          const members = items.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === kind);
          if (kind === 'pinned') {
            return (
              <div key={kind} role="group" aria-label={SECTION[kind]} className="launcher-section" data-kind={kind}>
                <div className="launcher-heading" aria-hidden="true">{SECTION[kind]}</div>
                <Reorder.Group
                  as="div" axis="x" className="launcher-row" values={members.flatMap(({ item }) => (item.app ? [item.app] : []))}
                  onReorder={(next: AppId[]) => { if (onPinned) setDragOrder(next); }}
                >
                  {members.filter(({ item }) => item.app).map(({ item, index }) => (
                    <Reorder.Item
                      key={item.id} as="div" value={item.app!} drag={onPinned ? 'x' : false} dragListener={Boolean(onPinned)}
                      onDragStart={() => { dragged.current = true; }}
                      onDragEnd={() => {
                        const next = dragOrderRef.current;
                        if (next && onPinned) { onPinned(next); setStatus(`${appName(item.app!)} moved to ${next.indexOf(item.app!) + 1} of ${next.length}`); }
                        setDragOrder(null);
                        window.setTimeout(() => { dragged.current = false; }, 0);
                      }}
                      {...option(item, index)}
                    >
                      <span className="launcher-mark">
                        <AppMark app={item.app} kind={item.kind} />
                        {dot(item)}
                      </span>
                      <span className="launcher-tile-name">{item.label}</span>
                    </Reorder.Item>
                  ))}
                  {members.filter(({ item }) => !item.app).map(({ item, index }) => (
                    <div key={item.id} {...option(item, index)}>
                      <span className="launcher-mark launcher-icon" aria-hidden="true">
                        <svg viewBox="0 0 20 20" data-all-apps=""><rect x="4" y="4" width="4.5" height="4.5" rx="1" /><rect x="11.5" y="4" width="4.5" height="4.5" rx="1" /><rect x="4" y="11.5" width="4.5" height="4.5" rx="1" /><rect x="11.5" y="11.5" width="4.5" height="4.5" rx="1" /></svg>
                      </span>
                      <span className="launcher-tile-name">{item.label}</span>
                    </div>
                  ))}
                </Reorder.Group>
              </div>
            );
          }
          if (kind === 'grid') {
            return (
              <div key={kind} role="group" aria-label={SECTION[kind]} className="launcher-section" data-kind={kind}>
                <div className="launcher-heading" aria-hidden="true">{SECTION[kind]}</div>
                <div className="launcher-grid" style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))` }}>
                  {members.map(({ item, index }) => (
                    <div key={item.id} {...option(item, index)}>
                      <span className="launcher-mark">
                        <AppMark app={item.app} place={item.place} kind={item.kind} />
                        {dot(item)}
                      </span>
                      <span className="launcher-tile-name">{marked(item.label, query.trim().replace(/^>\s*/, ''))}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          }
          if (kind === 'place') {
            return (
              <div key={kind} role="group" aria-label={SECTION[kind]} className="launcher-section launcher-places" data-kind={kind}>
                {members.map(({ item, index }) => (
                  <div key={item.id} {...option(item, index)}>
                    <span className="launcher-mark"><AppMark place={item.place} kind={item.kind} /></span>
                    <span className="launcher-tile-name">{item.label}</span>
                  </div>
                ))}
              </div>
            );
          }
          return (
            <div key={kind} role="group" aria-label={SECTION[kind]} className="launcher-section" data-kind={kind}>
              {kind !== 'ask' && <div className="launcher-heading" aria-hidden="true">{actionsFor ? 'Actions' : scope && kind === 'item' ? `In ${appName(scope)}` : SECTION[kind]}</div>}
              {members.map(({ item, index }) => (
                <div key={item.id} {...option(item, index)}>
                  <span className="launcher-mark">
                    <AppMark app={item.app} place={item.place} kind={item.kind} />
                    {dot(item)}
                  </span>
                  <span className="launcher-label">{marked(item.label, query.trim().replace(/^>\s*/, ''))}</span>
                  {item.detail && <span className="launcher-detail" aria-hidden="true">{item.detail}</span>}
                </div>
              ))}
            </div>
          );
        })}
        {query.trim() !== '' && items.every((item) => item.kind === 'ask') && (
          <div className="launcher-empty" role="status">
            {view === 'apps' ? `No app is called “${query.trim()}”.` : items.length > 0 ? 'Nothing in your apps matches. Press Enter to ask Mobius.' : `No results for “${query.trim()}”.`}
          </div>
        )}
      </div>
      {/* One footer: the places when nothing is typed, else one hint for the chosen row. */}
      {(query.trim() !== '' || view === 'apps' || scope || actionsFor) && current && (
        <div className="launcher-foot" aria-hidden="true">
          <span><kbd>↵</kbd> {current.kind === 'ask' ? 'Ask' : current.kind === 'answer' ? 'Copy' : current.kind === 'command' ? 'Run' : 'Open'}</span>
          {!actionsFor && current.kind !== 'ask' && current.kind !== 'answer' && current.id !== 'all-apps' && <span><kbd>⇧</kbd><kbd>↵</kbd> Actions</span>}
          {!actionsFor && !scope && current.app && current.kind !== 'grid' && <span><kbd>Tab</kbd> Search in {appName(current.app)}</span>}
        </div>
      )}
      <span className="launcher-status" role="status">{status}</span>
    </>
  );

  if (inline) return <div className="launcher" data-inline="true" role="dialog" aria-label="Launcher">{body}</div>;
  return (
    <dialog ref={dialog} className="launcher" aria-label="Launcher" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === dialog.current) onClose(); }}>
      {body}
    </dialog>
  );
}

/**
 * The Go button, leading the top bar: the open app's icon and name. It opens the launcher, and carries one dot while
 * anything waits in any app (the launcher shows which). It replaces the app rail.
 */
export function GoButton({ app, name, waiting = 0, keys, onOpen, open }: {
  app: AppId | Place;
  /** The name shown; by default the app's. */
  name?: string;
  /** How many things wait across every app. */
  waiting?: number;
  /** The launcher's keys, as this computer writes them, for the tooltip. */
  keys?: string;
  onOpen: () => void;
  /** The launcher is open. */
  open?: boolean;
}) {
  const place = (Object.keys(PLACE_NAMES) as string[]).includes(app) ? (app as Place) : undefined;
  const label = name ?? (place ? PLACE_NAMES[place] : appName(app));
  return (
    <button
      type="button"
      className="go-button"
      aria-haspopup="dialog"
      aria-expanded={open ?? undefined}
      aria-label={`${label}. Go to another app${waiting > 0 ? `. ${waiting} waiting` : ''}`}
      title={keys ? `Go to… (${keys})` : 'Go to…'}
      onClick={onOpen}
    >
      <span className="launcher-icon" data-kind={place ? 'place' : 'app'} aria-hidden="true">
        {place ? <svg viewBox="0 0 20 20" data-place={place}>{PLACE_ICONS[place]}</svg> : <svg viewBox="0 0 20 20" data-app={app}>{APP_ICONS[app]}</svg>}
      </span>
      <span className="go-button-name">{label}</span>
      {waiting > 0 && <span className="launcher-dot" aria-hidden="true" />}
      <svg className="go-button-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 8.5 10 12l3.5-3.5" /></svg>
    </button>
  );
}

/** After an app opens: unless the app already took the keyboard itself, the work area takes it. True when it moved. */
export function landInStage(stage: Pick<HTMLElement, 'contains' | 'focus'> | null, active: Element | null): boolean {
  if (!stage || (active && stage.contains(active))) return false;
  stage.focus({ preventScroll: true });
  return true;
}
