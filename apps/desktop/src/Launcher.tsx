import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Reorder } from 'motion/react';
import type { BrowserTabState } from '@mobius/shared';
import { APPS, DEFAULT_APPS, appName, isAvailable, isInstalled, isListed, recentApps, recentItems, type AppId, type RecentItem } from './apps';
import { APP_ICONS, OWN_ICONS } from './Rail';
import { relativeTime } from './relative-time';
import { quickAnswer } from './quick-answers';
import { afterPaint } from './ui/frame';
import { AI_COMMANDS, aboutPrompt, isQuestion, translateCommand, type AiCommand, type InlineAnswer, type LauncherAbout } from './launcher-ask';
import { RichText } from './RichText';
import { clipboardQuery, findCopied, type LauncherClipboard } from './launcher-clipboard';
import { findSystemApps, findSystemCommands, folderOf, type LauncherSystem } from './launcher-system';
import type { SystemFile } from '@mobius/shared';
import { aliasHit, cleanAlias, comboOf, keyHit, readShortcuts, shortcutFor, targetOf, withAlias, withKey, writeShortcuts, type Shortcut, type ShortcutTarget } from './launcher-shortcuts';
import { callQuicklink, keepNamed, parseCreate, readQuicklinks, readSaved, readSnippets, withSaved, withoutSaved, writeQuicklinks, writeSaved, writeSnippets, type Quicklink, type SavedCommand, type Snippet } from './launcher-commands';
import { DotCharacter, type CharacterState } from './ui';
import { withoutMarks, withoutToolTags } from './markdown';
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
 * A dialog that acts modal (focus kept inside, Escape and a click outside close it, aria-modal), but is opened with
 * show(), not showModal(): a modal dialog makes the whole page inert, and undoing that restyled every element on each
 * close, which slowed every app switch made from here.
 */

export interface LauncherItem {
  id: string;
  kind: 'ask' | 'alias' | 'about' | 'clip' | 'waiting' | 'agent' | 'answer' | 'pinned' | 'recent' | 'place' | 'app' | 'item' | 'system' | 'disk' | 'tab' | 'command' | 'grid';
  label: string;
  detail?: string;
  disabled?: boolean;
  /** The app whose icon the row shows. */
  app?: AppId;
  /** Things waiting in this app (a pinned app's dot). */
  waiting?: number;
  /** A place at the foot: its mark. */
  place?: Place;
  fields?: readonly LauncherField[];
  preview?: LauncherPreview;
  /** An agent's row: drawn as its dot character, in the state it is in. */
  character?: { name: string; state: CharacterState };
  run: () => void;
}

/** Something found in an app as the person types: a note, a thread, an event, a file. */
export interface FoundItem { id: string; app: AppId; label: string; detail?: string; run: () => void; fields?: readonly LauncherField[]; preview?: LauncherPreview }

/** What a command read from the rest of the line ("lunch with Sam fri 1pm"): each part, named, shown under the field. */
export interface LauncherField { label: string; value: string }

/** What the chosen row is, shown beside the list before it is opened: a mail's first lines, an event's time. */
export interface LauncherPreview { title: string; meta?: string; body?: string; rows?: readonly (readonly [string, string])[] }

export type Place = 'home' | 'activity' | 'abilities' | 'settings';

/** Something waiting for you, at the top of an empty launcher: "Plan the P2 build week, needs your answer". */
export interface LauncherHomeRow { id: string; label: string; detail?: string; app?: AppId; run: () => void }
/** An agent at work, drawn as its dot character. */
export interface LauncherAgentRow { id: string; name: string; state: CharacterState; detail?: string; run: () => void }
const PLACE_NAMES: Record<Place, string> = { home: 'Home', activity: 'Activity', abilities: 'Store', settings: 'Settings' };
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
  /** Ask a question here and show the answer as it comes (launcher-ask.ts). Returns a function that stops listening. */
  askInline?: (question: string, update: (answer: InlineAnswer) => void) => () => void;
  /** Continue in Mobius: open the conversation the inline answer was asked in. */
  onContinue?: (conversation: string) => void;
  /** With nothing typed: what waits for you (answers Mobius needs, changes not kept) and agents at work, at the top. */
  home?: { waiting: readonly LauncherHomeRow[]; agents: readonly LauncherAgentRow[] };
  /** What was selected in the open app as the launcher opened: the AI commands work on it, and what is typed is asked about it. */
  about?: LauncherAbout;
  /** The computer's own apps and commands (Start menu apps, Lock, Sleep, Empty the Recycle Bin), from the desktop app. */
  system?: LauncherSystem;
  /** Clipboard history: what was copied lately, shown for "clipboard" (or "clip", "cb"). */
  clipboard?: LauncherClipboard;
  /** Open a web address (a quicklink) in the Browser. */
  onOpenUrl?: (url: string) => void;
  /** For the reference sheet: an answer already given to what is typed. */
  answered?: { question: string; answer: InlineAnswer };
}

/** The start (Ask, Pinned, Recent, places), or every app as a grid. */
export type LauncherView = 'start' | 'apps';
/** All apps is a grid this many tiles across. */
export const GRID_COLS = 7;

const SECTION: Record<LauncherItem['kind'], string> = {
  ask: 'Ask Mobius', alias: 'Your alias', about: 'About the selection', clip: 'Clipboard history', waiting: 'Waiting for you', agent: 'Agents at work', answer: 'Answer', pinned: 'Pinned', recent: 'Recent', place: 'Places', app: 'Apps', item: 'In your apps', system: 'On this computer', disk: 'Files', tab: 'Open pages', command: 'Commands', grid: 'All apps',
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
export const everyApp = (): AppId[] => APPS.filter((a) => a.available && isListed(a) && isInstalled(a.id) && a.id !== 'agent').sort((x, y) => x.name.localeCompare(y.name)).map((a) => a.id);

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
const NOTHING: LauncherItem[] = [];

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
        : kind === 'ask' || kind === 'about' ? <svg viewBox="0 0 20 20" data-app="agent">{APP_ICONS.agent}</svg>
          : kind === 'tab' ? <svg viewBox="0 0 20 20" data-app="browser">{APP_ICONS.browser}</svg>
          : kind === 'disk' ? <svg viewBox="0 0 20 20" data-disk=""><path d="M6 3.5h5.5L15 7v9.5H6z M11.5 3.5V7H15" /></svg>
          : kind === 'system' ? <svg viewBox="0 0 20 20" data-system=""><rect x="3.5" y="4.5" width="13" height="9" rx="1.5" /><path d="M7.5 16.5h5M10 13.5v3" /></svg>
          : kind === 'clip' ? <svg viewBox="0 0 20 20" data-clip=""><path d="M7 4H6a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 6 17h8a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 14 4h-1M8 3h4v2.5H8z" /></svg>
          : kind === 'answer' ? <svg viewBox="0 0 20 20" data-answer=""><path d="M5 8h10M5 12h10" /></svg>
            : <svg viewBox="0 0 20 20"><path d="M6 7l-3 3 3 3M9 14h8" /></svg>}
  </span>
);

export function Launcher({
  open, onClose, tabs, onNewTab, onActivateTab, onOpenApp, onAsk, onOpenMobius, commands = [], pinned, onPinned, waiting = {}, recent, onOpenRecent, find,
  places = {}, inline = false, now, again, startIn = 'start', onAskAbout, askInline, onContinue, answered, home, about, onOpenUrl, clipboard, system,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Where the focus was before it opened, to give it back on close (showModal() did this by itself).
  const returnTo = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(answered?.question ?? '');
  // The answer to a question asked here, while the words asked are still what is typed.
  const [inlineAnswer, setInlineAnswer] = useState<{ question: string; answer: InlineAnswer } | null>(answered ?? null);
  const stopListening = useRef<(() => void) | null>(null);
  useEffect(() => () => stopListening.current?.(), []);
  // About this: the selection, until it is left out (its x, or Backspace with nothing typed). Each opening brings it back.
  const [aboutLeftOut, setAboutLeftOut] = useState(false);
  useEffect(() => { if (open) setAboutLeftOut(false); }, [open, about]);
  const aboutNow = aboutLeftOut || !askInline ? undefined : about;
  // Commands you saved: a question asked about a selection, kept under a name.
  const [saved, setSaved] = useState<SavedCommand[]>(() => (typeof window === 'undefined' ? [] : readSaved()));
  const keepSaved = useCallback((next: SavedCommand[]) => { setSaved(next); writeSaved(next); }, []);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  // Quicklinks and snippets, kept on this computer.
  const [links, setLinks] = useState<Quicklink[]>(() => (typeof window === 'undefined' ? [] : readQuicklinks()));
  const [snippets, setSnippets] = useState<Snippet[]>(() => (typeof window === 'undefined' ? [] : readSnippets()));
  const keepLinks = useCallback((next: Quicklink[]) => { setLinks(next); writeQuicklinks(next); }, []);
  const keepSnippets = useCallback((next: Snippet[]) => { setSnippets(next); writeSnippets(next); }, []);
  // Files on disk: asked a moment after typing stops, and kept only for the words they were found for.
  const [disk, setDisk] = useState<{ text: string; files: readonly SystemFile[] } | null>(null);
  useEffect(() => {
    const text = query.trim();
    if (!system?.files || text.length < 2 || !open) return;
    let live = true;
    const timer = setTimeout(() => { void system.files!(text).then((files) => { if (live) setDisk({ text, files: Array.isArray(files) ? files : [] }); }, () => undefined); }, 150);
    return () => { live = false; clearTimeout(timer); };
  }, [query, system, open]);
  const keptRef = useRef({ links, snippets });
  keptRef.current = { links, snippets };
  // Aliases and keys of your own (launcher-shortcuts.ts), and the row one is being given to.
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(() => (typeof window === 'undefined' ? [] : readShortcuts()));
  const keepShortcuts = useCallback((next: Shortcut[]) => { setShortcuts(next); writeShortcuts(next); }, []);
  const [naming, setNaming] = useState<{ target: ShortcutTarget; label: string; what: 'alias' | 'key'; back: LauncherItem } | null>(null);
  // A command or question about the selection, answered here; what is typed becomes its name, so the answer stays with it.
  const askAboutSelection = useCallback((name: string, instruction: string) => {
    if (!askInline || !aboutNow) return;
    stopListening.current?.();
    setQuery(name);
    stopListening.current = askInline(aboutPrompt(name, instruction, aboutNow), (answer) => setInlineAnswer({ question: name, answer }));
    setChosenId('ask-continue');
  }, [askInline, aboutNow]);
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
      returnTo.current = document.activeElement instanceof HTMLElement && !element.contains(document.activeElement) ? document.activeElement : null;
      element.show();
      input.current?.focus();
    } else if (!open && element.open) {
      const focusWasInside = element.contains(document.activeElement);
      element.close();
      const back = returnTo.current;
      returnTo.current = null;
      if (focusWasInside && back?.isConnected) back.focus({ preventScroll: true });
    }
  }, [open, inline]);
  // However it closed (a choice, Escape, a click outside), it is empty and unchosen for next time.
  useEffect(() => {
    if (open) return;
    setQuery('');
    setChosenId(null);
    setScope(null);
    setActionsFor(null);
    setNaming(null);
    setInlineAnswer(null);
    stopListening.current?.();
    stopListening.current = null;
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
    // Not a modal dialog (see the top of this file), so Tab is kept inside here, and Escape closes it wherever the focus is.
    const trap = (event: globalThis.KeyboardEvent) => {
      const element = dialog.current;
      if (!element?.open || event.defaultPrevented) return;
      if (event.key === 'Escape' && !element.contains(event.target as Node)) { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab') return;
      const stops = [...element.querySelectorAll<HTMLElement>('input, select, textarea, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
      if (stops.length === 0) return;
      const first = stops[0]!, last = stops[stops.length - 1]!;
      const at = document.activeElement;
      if (!element.contains(at) || (event.shiftKey && at === first) || (!event.shiftKey && at === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('focusin', keep, true);
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('focusin', keep, true); document.removeEventListener('keydown', trap); };
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

  /** Give a row an alias or a key of its own, or take one away. Shown in its actions; the launcher stays open. */
  const shortcutActs = useCallback((item: LauncherItem): LauncherItem[] => {
    const target = targetOf(item.id);
    if (!target) return [];
    const label = item.kind === 'command' || item.kind === 'place' || item.kind === 'alias' ? item.label : item.label.replace(/^Open /, '');
    const had = shortcutFor(shortcuts, target);
    const act = (id: string, text: string, run: () => void, detail?: string): LauncherItem => ({ id: `act-${id}`, kind: 'command', label: text, detail, run });
    const name = (what: 'alias' | 'key') => () => { setNaming({ target, label, what, back: item }); setActionsFor(null); setQuery(''); setChosenId(null); input.current?.focus(); };
    return [
      act('alias', had?.alias ? 'Change alias' : 'Add an alias', name('alias'), had?.alias),
      ...(had?.alias ? [act('unalias', 'Remove the alias', () => { keepShortcuts(withAlias(shortcuts, target, label, null)); setStatus(`Alias ${had.alias} removed`); setActionsFor(null); setQuery(''); })] : []),
      act('key', had?.key ? 'Change key' : 'Set a key', name('key'), had?.key),
      ...(had?.key ? [act('unkey', 'Remove the key', () => { keepShortcuts(withKey(shortcuts, target, label, null)); setStatus(`${had.key} removed`); setActionsFor(null); setQuery(''); })] : []),
    ];
  }, [shortcuts, keepShortcuts]);

  /** What can be done with a row: shown by Shift+Enter. */
  const actionsOf = useCallback((item: LauncherItem): LauncherItem[] => {
    const act = (id: string, label: string, run: () => void, detail?: string): LauncherItem => ({ id: `act-${id}`, kind: 'command', label, detail, run });
    const pinned = item.app ? pins.includes(item.app) : false;
    const mine = item.id.startsWith('about-mine-') ? item.id.slice('about-mine-'.length) : null;
    if (item.id.startsWith('disk-') && system?.reveal) {
      const path = item.id.slice(5);
      return [act('open', 'Open', item.run, '↵'), act('reveal', 'Show in folder', () => system.reveal!(path)), act('copy', 'Copy path', () => { void navigator.clipboard?.writeText(path).catch(() => undefined); })];
    }
    if (item.id.startsWith('ql-') || item.id.startsWith('snip-')) {
      const link = item.id.startsWith('ql-'), id = item.id.slice(link ? 3 : 5);
      const forget = () => {
        if (link) keepLinks(keptRef.current.links.filter((c) => c.id !== id)); else keepSnippets(keptRef.current.snippets.filter((c) => c.id !== id));
        setActionsFor(null); setQuery(''); setStatus(`${item.label} removed`);
      };
      return [act('open', link ? 'Open' : 'Copy', item.run, '↵'), ...shortcutActs(item), act('forget', link ? 'Remove this quicklink' : 'Remove this snippet', forget)];
    }
    if (mine) return [act('open', 'Run', () => { setActionsFor(null); item.run(); }, '↵'), act('forget', 'Remove this command', () => { keepSaved(withoutSaved(savedRef.current, mine)); setActionsFor(null); setStatus(`${item.label} removed`); })];
    return [
      act('open', item.kind === 'command' ? 'Run' : 'Open', item.run, '↵'),
      ...(onAskAbout ? [act('ask', 'Ask Mobius about this', () => onAskAbout({ app: item.app, label: item.label, detail: item.detail }), 'Alt+↵')] : []),
      ...(item.app && onPinned && (item.kind === 'pinned' || item.kind === 'app' || item.kind === 'grid')
        ? [act('pin', pinned ? 'Unpin' : 'Pin', () => pinRef.current(item.app!, !pinned))] : []),
      ...(item.app && !scope ? [act('scope', `Search in ${appName(item.app)}`, () => narrowRef.current(item.app!), 'Tab')] : []),
      ...shortcutActs(item),
      act('copy', 'Copy name', () => { void navigator.clipboard?.writeText(item.label).catch(() => undefined); }),
    ];
  }, [pins, onAskAbout, onPinned, scope, keepSaved, keepLinks, keepSnippets, system, shortcutActs]);

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

  /** A row for an alias or key of your own, opening what it stands for; null when that is gone. */
  const resolveShortcut = useCallback((s: Shortcut): LauncherItem | null => {
    const t = s.target;
    const base = { id: `alias-${t.type}-${t.ref}`, kind: 'alias' as const, label: s.label, detail: [s.alias, s.key].filter(Boolean).join(' · ') || undefined };
    if (t.type === 'app') { const app = t.ref as AppId; return isAvailable(app) ? { ...base, app, label: appName(app), run: () => onOpenApp(app) } : null; }
    if (t.type === 'place') { const place = t.ref as Place; const go = places[place]; return go ? { ...base, place, label: PLACE_NAMES[place] ?? s.label, run: go } : null; }
    if (t.type === 'command') { const c = commands.find((c) => c.id === t.ref); return c ? { ...base, label: c.label, run: c.run } : null; }
    if (t.type === 'quicklink') { const l = links.find((l) => l.id === t.ref); return l && onOpenUrl ? { ...base, label: l.name, run: () => onOpenUrl(l.url.split('{query}').join('')) } : null; }
    const n = snippets.find((n) => n.id === t.ref);
    return n ? { ...base, label: n.name, run: () => { void navigator.clipboard?.writeText(n.text).catch(() => undefined); } } : null;
  }, [onOpenApp, places, commands, links, snippets, onOpenUrl]);

  const listFor = useCallback((text: string): LauncherItem[] => {
    const q = text.trim().toLowerCase();
    const typed = text.trim();
    const has = (words: string) => words.toLowerCase().includes(q);
    if (actionsFor) return actionsOf(actionsFor).filter((a) => has(a.label));
    // Giving a row an alias (typed, then Enter) or a key (pressed: see `keys`).
    if (naming) {
      const fields = [{ label: 'For', value: naming.label }];
      if (naming.what === 'key') return [{ id: 'key-wait', kind: 'command', label: 'Press the keys', detail: 'Ctrl or Alt, one more of Ctrl, Alt or Shift, and a letter, number or F-key', fields, disabled: true, run: () => {} }];
      const alias = cleanAlias(typed);
      return [{
        id: 'save-alias', kind: 'command', label: alias ? `Save alias “${alias}”` : typed ? 'One short word, at most 12 letters' : 'Type the alias', fields, disabled: !alias,
        run: () => { if (alias) keepShortcuts(withAlias(shortcuts, naming.target, naming.label, alias)); },
      }];
    }
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
        ...(q ? findNow(typed).filter((item) => item.app === scope).slice(0, 20).map<LauncherItem>((item) => ({ id: `item-${item.app}-${item.id}`, kind: 'item', app: item.app, label: item.label, detail: item.detail, fields: item.fields, preview: item.preview, run: item.run })) : []),
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
      const aboutRows: LauncherItem[] = aboutNow
        ? [
          ...AI_COMMANDS.map<LauncherItem>((c) => ({ id: `about-${c.id}`, kind: 'about', label: c.label, detail: c.detail, run: () => askAboutSelection(c.label, c.instruction) })),
          ...saved.map<LauncherItem>((c) => ({ id: `about-mine-${c.id}`, kind: 'about', label: c.label, detail: 'Yours', run: () => askAboutSelection(c.label, c.instruction) })),
          { id: 'about-translate', kind: 'about', label: 'Translate to…', detail: 'Type the language', run: () => { setQuery('Translate to '); setChosenId(null); input.current?.focus(); } },
        ]
        : [];
      return [
        ...ask,
        ...aboutRows,
        ...(home?.waiting ?? []).slice(0, 3).map<LauncherItem>((w) => ({ id: `waiting-${w.id}`, kind: 'waiting', app: w.app, label: w.label, detail: w.detail, run: w.run })),
        ...(home?.agents ?? []).slice(0, 3).map<LauncherItem>((a) => ({ id: `agent-${a.id}`, kind: 'agent', label: a.name, detail: a.detail, character: { name: a.name, state: a.state }, run: a.run })),
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
      ...(inlineAnswer && inlineAnswer.question === typed
        ? [
          { id: 'ask-continue', kind: 'ask' as const, label: 'Continue in Mobius', detail: inlineAnswer.answer.state === 'asking' ? 'Answering…' : undefined, run: () => onContinue?.(inlineAnswer.answer.conversation) },
          ...(inlineAnswer.answer.state === 'done' && inlineAnswer.answer.text ? [{ id: 'ask-copy', kind: 'answer' as const, label: 'Copy the answer', run: () => { void navigator.clipboard?.writeText(withoutMarks(inlineAnswer.answer.text)).catch(() => undefined); } }] : []),
          // A question asked about the selection can be kept, to run on the next one.
          ...(aboutNow && inlineAnswer.answer.state === 'done' && !AI_COMMANDS.some((c) => c.label === typed) && !translateCommand(typed) && !saved.some((c) => c.instruction === typed.trim())
            ? [{ id: 'about-save', kind: 'answer' as const, label: 'Save as a command', detail: 'For the next selection', run: () => keepSaved(withSaved(saved, typed)) }] : []),
        ]
        : [
          // What matches among the AI commands, and "translate to French" read as one.
          ...(aboutNow ? [...(translateCommand(typed) ? [translateCommand(typed)!] : []), ...AI_COMMANDS.filter((c) => has(c.label))].map<LauncherItem>((c: AiCommand) => ({ id: `about-${c.id}`, kind: 'about', label: c.label, detail: c.detail, run: () => askAboutSelection(c.label, c.instruction) })) : []),
          ...(aboutNow ? saved.filter((c) => has(c.label)).map<LauncherItem>((c) => ({ id: `about-mine-${c.id}`, kind: 'about', label: c.label, detail: 'Yours', run: () => askAboutSelection(c.label, c.instruction) })) : []),
          ...(aboutNow
            ? [{ id: 'ask', kind: 'ask' as const, label: `Ask about the selection: “${typed.length > 50 ? `${typed.slice(0, 49)}…` : typed}”`, detail: 'Answer here', run: () => askAboutSelection(typed, typed) }]
            : onAsk ? [{ id: 'ask', kind: 'ask' as const, label: `Ask Mobius: “${typed.length > 60 ? `${typed.slice(0, 59)}…` : typed}”`, detail: askInline && isQuestion(typed) ? 'Answer here' : undefined, run: () => onAsk(typed) }] : []),
        ]),
      // A sum, a unit or a time somewhere else: answered here, and Enter copies it.
      ...((answer) => (answer ? [{ id: 'answer', kind: 'answer' as const, label: answer.value, detail: answer.question, run: () => { void navigator.clipboard?.writeText(answer.copy).catch(() => undefined); } }] : []))(quickAnswer(typed)),
      // Clipboard history: "clipboard", "clip" or "cb", then words to look for in what was copied.
      ...((asked) => {
        if (!asked || !clipboard) return [];
        if (!clipboard.on) return [{ id: 'clip-on', kind: 'clip' as const, label: 'Turn on clipboard history', detail: 'The last 50 copies, kept in memory on this computer', run: () => clipboard.setOn(true) }];
        const found = findCopied(clipboard.entries, asked.words).slice(0, 20);
        const when = now ?? Date.now();
        return [
          ...found.map<LauncherItem>((e, i) => {
            const line = e.text.replace(/\s+/g, ' ').trim();
            return { id: `clip-${i}-${e.at}`, kind: 'clip', label: line.length > 80 ? `${line.slice(0, 79)}…` : line, detail: relativeTime(e.at, when), preview: { title: 'Copied', meta: relativeTime(e.at, when), body: e.text.length > 2000 ? `${e.text.slice(0, 1999)}…` : e.text }, run: () => clipboard.copy(e.text) };
          }),
          ...(clipboard.entries.length === 0 ? [{ id: 'clip-none', kind: 'clip' as const, label: 'Nothing copied yet', detail: 'Copy some text anywhere, and it shows here', disabled: true, run: () => {} }] : []),
          ...(clipboard.entries.length ? [{ id: 'clip-clear', kind: 'command' as const, label: 'Clear clipboard history', run: () => clipboard.clear() }] : []),
          { id: 'clip-off', kind: 'command' as const, label: 'Turn off clipboard history', detail: 'Forgets what was kept', run: () => clipboard.setOn(false) },
        ];
      })(clipboardQuery(typed)),
      // Quicklinks and snippets: making one ("quicklink maps https://…?q={query}", "snippet sig: Best, Andrew"), calling one.
      ...((made) => (made ? [{
        id: 'make-kept', kind: 'command' as const, label: made.kind === 'quicklink' ? 'Create quicklink' : 'Create snippet',
        fields: made.kind === 'quicklink' ? [{ label: 'Name', value: made.name }, { label: 'Address', value: made.url }] : [{ label: 'Name', value: made.name }, { label: 'Text', value: made.text.length > 40 ? `${made.text.slice(0, 39)}…` : made.text }],
        run: () => (made.kind === 'quicklink' ? keepLinks(keepNamed(links, { name: made.name, url: made.url })) : keepSnippets(keepNamed(snippets, { name: made.name, text: made.text }))),
      }] : []))(parseCreate(typed)),
      ...((call) => (call && onOpenUrl ? [{ id: `ql-${call.link.id}`, kind: 'command' as const, label: call.rest ? `${call.link.name}: ${call.rest}` : call.link.name, detail: call.url, run: () => onOpenUrl(call.url) }] : []))(callQuicklink(links, typed)),
      ...(onOpenUrl ? links.filter((l) => has(l.name) && !callQuicklink([l], typed)).slice(0, 4).map<LauncherItem>((l) => ({ id: `ql-${l.id}`, kind: 'command', label: l.name, detail: l.url.includes('{query}') ? `${l.url.replace('{query}', '…')}  ·  type after the name` : l.url, run: () => onOpenUrl(l.url.split('{query}').join('')) })) : []),
      ...snippets.filter((c) => has(c.name)).slice(0, 4).map<LauncherItem>((c) => ({ id: `snip-${c.id}`, kind: 'command', label: c.name, detail: c.text.replace(/\s+/g, ' ').slice(0, 60), run: () => { void navigator.clipboard?.writeText(c.text).catch(() => undefined); } })),
      ...(['quicklink', 'snippet'] as const).filter((k) => !parseCreate(typed) && (has(`create ${k}`) || (q.length >= 3 && k.startsWith(q)))).map<LauncherItem>((k) => ({
        id: `start-${k}`, kind: 'command', label: k === 'quicklink' ? 'Create quicklink' : 'Create snippet', detail: k === 'quicklink' ? 'quicklink name address, with {query} for what you type' : 'snippet name: the text',
        run: () => { setQuery(k === 'quicklink' ? 'quicklink ' : 'snippet '); setChosenId(null); input.current?.focus(); },
      })),
      // As in Spotlight and Raycast: names that start with what was typed come before names that only contain it.
      // Settings and Store are places, not apps: their own group, above Apps.
      ...(Object.keys(PLACE_NAMES) as Place[]).filter((p) => places[p] && has(p === 'abilities' ? `${PLACE_NAMES[p]} Abilities Extensions Skills Connectors Plugins` : PLACE_NAMES[p])).map<LauncherItem>((p) => ({
        id: `place-${p}`, kind: 'place', place: p, label: PLACE_NAMES[p], run: () => places[p]!(),
      })),
      ...rankApps(APPS.filter((app) => app.id !== 'skills' && has(`${app.name} ${app.also ?? ''}`)), q).map<LauncherItem>((app) => ({
        id: `app-${app.id}`,
        kind: 'app',
        app: app.id,
        label: app.name,
        waiting: waiting[app.id] ?? 0,
        // An app not added yet is found too: choosing it opens Abilities to add it.
        detail: !app.available ? 'Not built yet' : !isInstalled(app.id) ? 'Add from Store' : pins.indexOf(app.id) >= 0 && pins.indexOf(app.id) < 9 ? `Ctrl+${pins.indexOf(app.id) + 1}` : undefined,
        disabled: !app.available,
        run: () => onOpenApp(app.id),
      })),
      // The computer's own apps, then its commands: below Mobius's apps, so "notes" still opens Notes.
      ...(system ? [
        ...findSystemApps(system.apps, typed).filter((a) => !APPS.some((m) => m.name.toLowerCase() === a.name.toLowerCase())).map<LauncherItem>((a) => ({ id: `sys-app-${a.id}`, kind: 'system', label: a.name, detail: 'App', run: () => system.open(a.id) })),
        ...findSystemCommands(system.commands, typed).map<LauncherItem>((c) => ({ id: `sys-cmd-${c.id}`, kind: 'system', label: c.name, detail: 'Command', run: () => system.run(c.id) })),
      ] : []),
      ...(system && disk && disk.text === typed ? disk.files.slice(0, 8).map<LauncherItem>((f) => ({ id: `disk-${f.path}`, kind: 'disk', label: f.name, detail: folderOf(f.path), run: () => system.openFile?.(f.path) })) : []),
      ...findNow(typed).slice(0, 8).map<LauncherItem>((item) => ({ id: `item-${item.app}-${item.id}`, kind: 'item', app: item.app, label: item.label, detail: item.detail ?? appName(item.app), fields: item.fields, preview: item.preview, run: item.run })),
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
  }, [naming, shortcuts, keepShortcuts, actionsFor, actionsOf, scope, view, switchView, tabs, onNewTab, onActivateTab, onOpenApp, onAsk, onOpenMobius, commands, pins, waiting, lastOpen, onOpenRecent, findNow, places, now, inlineAnswer, askInline, onContinue, home, aboutNow, askAboutSelection, saved, keepSaved, links, snippets, keepLinks, keepSnippets, onOpenUrl, clipboard, system, disk]);
  const [choices, setChoices] = useState<Choices>(() => (typeof window === 'undefined' ? {} : readChoices()));
  const listRanked = useCallback((text: string) => {
    const list = text.trim() && !actionsFor && !naming ? rankByChoice(listFor(text), choices, text) : listFor(text);
    // An alias typed alone: what it stands for comes first after Ask, and Enter opens it.
    const hit = !actionsFor && !naming && !scope && view === 'start' ? aliasHit(shortcuts, text) : null;
    const row = hit ? resolveShortcut(hit) : null;
    if (!row) return list;
    const rest = list.filter((item) => { const t = targetOf(item.id); return !t || t.type !== hit!.target.type || t.ref !== hit!.target.ref; });
    const at = rest.findIndex((item) => item.kind !== 'ask');
    return at < 0 ? [...rest, row] : [...rest.slice(0, at), row, ...rest.slice(at)];
  }, [listFor, choices, actionsFor, naming, scope, view, shortcuts, resolveShortcut]);
  // Shut, it lists nothing: worked out on every draw of the window (an app switch among them), the whole search came
  // to more than the app being opened. It is worked out again as it opens.
  const items = useMemo(() => (open || inline ? listRanked(query) : NOTHING), [open, inline, listRanked, query]);
  // Keys of your own work anywhere in this window while the launcher is shut.
  useEffect(() => {
    if (open || inline || !shortcuts.some((s) => s.key)) return;
    const on = (e: globalThis.KeyboardEvent) => {
      const hit = keyHit(shortcuts, comboOf(e));
      const row = hit ? resolveShortcut(hit) : null;
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      row.run();
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [open, inline, shortcuts, resolveShortcut]);
  // Read after the list is made, which is when a source that answers later is asked.
  const finding = !!find && !!query.trim() && pending.current?.text === query.trim() && later?.text !== query.trim();

  // Ask Mobius is always the first row, but Enter opens what was found when something was: typing "notes" and
  // pressing Enter opens Notes, and with nothing typed Enter opens the first pinned app. With nothing found, Enter
  // asks. Worked out as the list is drawn, so a quick Enter right after typing gets the same row.
  // A question is asked, not looked up: Enter answers it, even when something matched its words.
  const asksHere = Boolean(askInline) && isQuestion(query) && !scope && !actionsFor && view === 'start';
  const found = asksHere ? 0 : items.findIndex((item) => item.kind !== 'ask' && item.kind !== 'waiting' && item.kind !== 'agent' && !item.disabled);
  const picked = chosenId === null ? -1 : items.findIndex((item) => item.id === chosenId);
  const selected = picked >= 0 ? picked : Math.max(0, found > 0 ? found : 0);
  const current = items[selected];
  const setSelected = (index: number) => setChosenId(items[index]?.id ?? null);

  const activate = (item: LauncherItem | undefined) => {
    if (!item || item.disabled || dragged.current) return;
    // All apps is a view of the launcher, not somewhere to go: it stays open.
    if (item.id === 'all-apps' || item.id === 'act-scope') { item.run(); return; }
    // A question is answered here: the launcher stays open while the answer comes.
    if (item.kind === 'about' || (item.id === 'ask' && aboutNow)) { item.run(); return; }
    if (item.id === 'ask' && askInline && isQuestion(query)) {
      const question = query;
      stopListening.current?.();
      stopListening.current = askInline(question, (answer) => setInlineAnswer({ question, answer }));
      setChosenId('ask-continue');
      return;
    }
    if (item.id === 'ask-copy') { item.run(); setStatus('Answer copied'); return; }
    // A saved command's actions stay in the launcher: Run asks here, and Remove leaves the list open.
    if (actionsFor?.kind === 'about') { item.run(); return; }
    if (item.id === 'clip-on' || item.id === 'clip-clear' || item.id === 'clip-off') { item.run(); setStatus(item.id === 'clip-on' ? 'Clipboard history on' : item.id === 'clip-off' ? 'Clipboard history off' : 'Clipboard history cleared'); return; }
    if (item.id.startsWith('clip-')) setStatus('Copied');
    if (item.id === 'make-kept') { item.run(); setStatus(`${item.label === 'Create quicklink' ? 'Quicklink' : 'Snippet'} saved`); setQuery(''); setChosenId(null); return; }
    if (item.id.startsWith('start-')) { item.run(); return; }
    // Aliases and keys of your own: chosen from a row's actions, the launcher stays open to take them.
    if (item.id === 'act-alias' || item.id === 'act-key' || item.id === 'act-unalias' || item.id === 'act-unkey') { item.run(); return; }
    if (item.id === 'save-alias' && naming) { item.run(); setStatus(`Alias ${cleanAlias(query)} saved for ${naming.label}`); setNaming(null); setQuery(''); setChosenId(null); return; }
    if (actionsFor && (actionsFor.id.startsWith('ql-') || actionsFor.id.startsWith('snip-')) && item.id === 'act-forget') { item.run(); return; }
    if (item.id.startsWith('snip-')) setStatus('Copied');
    if (item.id === 'about-save') { item.run(); setStatus('Saved as a command'); setChosenId('ask-continue'); return; }
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
    if (item.app && (item.kind === 'app' || item.kind === 'grid' || item.kind === 'pinned' || item.kind === 'alias') && !inline) {
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
    // Giving a row an alias or a key: Escape goes back to its actions. A key is taken as it is pressed.
    if (naming) {
      if (k === 'Escape' || (empty && k === 'Backspace')) { event.preventDefault(); setActionsFor(naming.back); setNaming(null); setQuery(''); setChosenId(null); return; }
      if (naming.what === 'key') {
        event.preventDefault();
        if (k === 'Control' || k === 'Alt' || k === 'Shift' || k === 'Meta') return;
        const combo = comboOf(event);
        if (!combo) { setStatus('Use Ctrl or Alt, one more of Ctrl, Alt or Shift, and a letter, number or F-key'); return; }
        keepShortcuts(withKey(shortcuts, naming.target, naming.label, combo));
        setStatus(`${combo} saved for ${naming.label}`); setNaming(null); setQuery(''); setChosenId(null);
        return;
      }
    }
    // A key of your own works here too.
    const own = !naming && !actionsFor ? keyHit(shortcuts, comboOf(event)) : null;
    const ownRow = own ? resolveShortcut(own) : null;
    if (ownRow) { event.preventDefault(); onClose(); ownRow.run(); return; }
    // Back out of the actions, then out of an app, then out of All apps.
    if (actionsFor && (k === 'Escape' || (empty && (k === 'Backspace' || k === 'ArrowLeft')))) { event.preventDefault(); setActionsFor(null); setQuery(''); setChosenId(actionsFor.id); return; }
    if (aboutNow && empty && k === 'Backspace' && !scope && !actionsFor && view === 'start') { event.preventDefault(); setAboutLeftOut(true); setChosenId(null); return; }
    if (scope && empty && (k === 'Backspace' || k === 'Escape')) { event.preventDefault(); setScope(null); setChosenId(null); return; }
    if (view === 'apps' && empty && (k === 'Backspace' || k === 'Escape')) { event.preventDefault(); switchView('start'); return; }
    // Tab on an app (or something in one) narrows the launcher to that app.
    if (k === 'Tab' && !event.shiftKey && !actionsFor && !scope && current?.app && current.kind !== 'grid') { event.preventDefault(); narrow(current.app); return; }
    // Shift+Enter, or Right at the end of the words, shows the chosen row's actions.
    const atEnd = event.currentTarget.selectionStart === event.currentTarget.value.length;
    if (!actionsFor && current && current.kind !== 'ask' && (current.kind !== 'about' || current.id.startsWith('about-mine-')) && current.kind !== 'answer' && !current.disabled && current.id !== 'all-apps'
      && ((k === 'Enter' && event.shiftKey) || (k === 'ArrowRight' && !empty && atEnd && !ACROSS.has(current.kind)))) {
      event.preventDefault();
      setActionsFor(current); setQuery(''); setChosenId(null);
      return;
    }
    // Alt+Enter asks Mobius about the chosen row.
    if (k === 'Enter' && event.altKey && onAskAbout && current && current.kind !== 'ask' && current.kind !== 'about' && !actionsFor) {
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
      // Typed, places are rows like the rest (only the empty start lays them across).
      setSelected(stepFrom(items.map((i) => (i.kind === 'place' && query.trim() ? 'app' : i.kind)), selected, k));
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
    const across = ACROSS.has(item.kind) && !(item.kind === 'place' && query.trim());
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
          placeholder={naming ? (naming.what === 'alias' ? `Alias for ${naming.label}` : `Press the keys for ${naming.label}`) : actionsFor ? 'Choose an action' : scope ? `Search in ${appName(scope)}` : view === 'apps' ? 'Find an app' : 'Find, open or ask anything'}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setChosenId(null); }}
          onKeyDown={keys}
        />
        {finding && <span className="launcher-finding" aria-hidden="true" />}
        {view === 'apps' ? <button type="button" className="launcher-back" onClick={() => { switchView('start'); input.current?.focus(); }}>Back</button> : <kbd>Esc</kbd>}
      </div>
      {aboutNow && view === 'start' && (
        <div className="launcher-about" role="group" aria-label="About the selection">
          <small>About</small>
          <span className="launcher-about-text">“{aboutNow.text.length > 90 ? `${aboutNow.text.slice(0, 89)}…` : aboutNow.text}”</span>
          <button type="button" aria-label="Leave out the selection" title="Leave out (Backspace)" onClick={() => { setAboutLeftOut(true); input.current?.focus(); }}>×</button>
        </div>
      )}
      {current?.fields && current.fields.length > 0 && (
        <div className="launcher-fields" aria-label={`${current.label}: what it read`} role="group">
          {current.fields.map((f) => (
            <span key={f.label} className="launcher-field" data-empty={f.value ? undefined : true}><small>{f.label}</small>{f.value || 'None'}</span>
          ))}
        </div>
      )}
      <div className="launcher-body">
      <div id="launcher-list" role="listbox" aria-label="Results" className="launcher-list">
        {inlineAnswer && inlineAnswer.question === query && <AnswerCard answer={inlineAnswer.answer} />}
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
          // Nothing typed: places are a row of tiles at the foot. Typed: a group of rows of its own, above Apps.
          if (kind === 'place' && !query.trim()) {
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
              {kind !== 'ask' && <div className="launcher-heading" aria-hidden="true">{naming ? (naming.what === 'alias' ? 'New alias' : 'New key') : actionsFor ? 'Actions' : scope && kind === 'item' ? `In ${appName(scope)}` : SECTION[kind]}</div>}
              {members.map(({ item, index }) => (
                <div key={item.id} {...option(item, index)}>
                  <span className="launcher-mark">
                    {item.character ? <DotCharacter name={item.character.name} state={item.character.state} size="small" /> : <AppMark app={item.app} place={item.place} kind={item.kind} />}
                    {item.kind === 'waiting' ? <span className="launcher-dot" aria-hidden="true" /> : dot(item)}
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
      {current?.preview && <Preview preview={current.preview} />}
      </div>
      {/* One footer: the places when nothing is typed, else one hint for the chosen row. */}
      {(query.trim() !== '' || view === 'apps' || scope || actionsFor) && current && (
        <div className="launcher-foot" aria-hidden="true">
          <span><kbd>↵</kbd> {current.id === 'ask-continue' ? 'Continue' : current.kind === 'ask' || current.kind === 'about' ? 'Ask' : current.id === 'about-save' || current.id === 'make-kept' ? 'Save' : current.id.startsWith('snip-') ? 'Copy' : current.id.startsWith('start-') ? 'Start' : current.kind === 'answer' ? 'Copy' : current.kind === 'command' ? 'Run' : current.fields?.length ? 'Add' : 'Open'}</span>
          {!actionsFor && current.kind !== 'ask' && (current.kind !== 'about' || current.id.startsWith('about-mine-')) && current.kind !== 'answer' && current.id !== 'all-apps' && <span><kbd>⇧</kbd><kbd>↵</kbd> Actions</span>}
          {!actionsFor && !scope && current.app && current.kind !== 'grid' && <span><kbd>Tab</kbd> Search in {appName(current.app)}</span>}
        </div>
      )}
      <span className="launcher-status" role="status">{status}</span>
    </>
  );

  if (inline) return <div className="launcher" data-inline="true" role="dialog" aria-label="Launcher">{body}</div>;
  return (
    <>
      {/* The shade behind it: a click on it closes the launcher, as a click outside a modal dialog did. */}
      {open && <div className="launcher-backdrop" aria-hidden="true" onClick={onClose} />}
      <dialog ref={dialog} className="launcher" aria-label="Launcher" aria-modal={open || undefined}
        onCancel={(event) => { event.preventDefault(); onClose(); }}
        onKeyDown={(event) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose(); } }}>
        {body}
      </dialog>
    </>
  );
}

/**
 * The Go button, leading the top bar: the open app's icon, its name in the tooltip and to assistive tech (Andrew, 21
 * November 2026: icon only, so the bar keeps its room for tools). It opens the launcher, and carries one dot while
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
      title={keys ? `${label}: go to another app (${keys})` : `${label}: go to another app`}
      onClick={onOpen}
    >
      <span className="launcher-icon" data-kind={place ? 'place' : 'app'} aria-hidden="true">
        {place ? <svg viewBox="0 0 20 20" data-place={place}>{PLACE_ICONS[place]}</svg> : <svg viewBox="0 0 20 20" data-app={app}>{APP_ICONS[app]}</svg>}
      </span>
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

/** The chosen row before it is opened, beside the list (docs/design/launcher.md, "A preview beside the list"). */
function Preview({ preview }: { preview: LauncherPreview }) {
  return (
    <aside className="launcher-preview" aria-label="Preview">
      <b className="launcher-preview-title">{preview.title}</b>
      {preview.meta && <span className="launcher-preview-meta">{preview.meta}</span>}
      {preview.body && <p className="launcher-preview-body">{preview.body}</p>}
      {preview.rows && preview.rows.length > 0 && (
        <dl className="launcher-preview-rows">{preview.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      )}
    </aside>
  );
}

/** The answer to a question asked here: Mobius's words, and the apps they came from. Mobius's, so indigo and dashed. */
function AnswerCard({ answer }: { answer: InlineAnswer }) {
  return (
    <div className="launcher-ans" data-state={answer.state} role="status" aria-live="polite">
      {answer.state === 'failed' ? <p className="launcher-ans-text">{answer.error || 'No answer came.'}</p>
        : answer.text ? <div className="launcher-ans-text"><RichText text={withoutToolTags(answer.text)} /></div>
          : <p className="launcher-ans-text launcher-ans-wait">{answer.sources.length ? `Reading ${answer.sources.join(' and ')}…` : 'Thinking…'}</p>}
      {answer.sources.length > 0 && answer.state !== 'asking' && (
        <div className="launcher-ans-src">{answer.sources.map((s) => <span key={s}>{s}</span>)}</div>
      )}
    </div>
  );
}
