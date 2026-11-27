/**
 * Pieces (docs/design/pieces.md): a small, live view of one thing from an app (a task list, a day, a mail thread) that
 * sits beside whatever app is open. A piece is a panel the shell owns: it is in every app's right dock until it is put
 * away, listed in the Panels menu, and moved, floated and resized like any panel.
 *
 * This file keeps which pieces are open, on this device. What each piece draws is the shell's (App.tsx), from the apps'
 * own components.
 */
import { useSyncExternalStore } from 'react';

export type PieceKind = 'tasks.list' | 'calendar.day' | 'mail.thread';

/** The apps the pieces come from, for "Open in …". */
export const PIECE_APP: Record<PieceKind, { app: 'tasks' | 'calendar' | 'mail'; name: string }> = {
  'tasks.list': { app: 'tasks', name: 'Tasks' },
  'calendar.day': { app: 'calendar', name: 'Calendar' },
  'mail.thread': { app: 'mail', name: 'Mail' },
};

/** The piece's name in its header: the list's name; "Today", or the day. */
export function pieceName(p: { kind: PieceKind; item: string; title?: string | undefined }): string {
  if (p.title) return p.title;
  if (p.kind !== 'calendar.day') return p.item;
  if (p.item === 'today') return 'Today';
  const d = new Date(`${p.item}T12:00:00`);
  return Number.isNaN(d.getTime()) ? p.item : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export interface OpenPiece {
  kind: PieceKind;
  /** The thing it shows: a list's name; "today" or a day as YYYY-MM-DD. */
  item: string;
  /** Mobius's until the person uses it; Mobius's carry the dashed edge and go when its work is kept or discarded. */
  by: 'mobius' | 'you';
  /** Its name, when the item is an id (a message's subject). */
  title?: string;
}

/** One Calendar day at a time: stepping to another day keeps the same piece (and where it was moved to). */
export const pieceKey = (p: { kind: PieceKind; item: string }): string => (p.kind === 'calendar.day' ? p.kind : `${p.kind}:${p.item}`);
/** Its panel's id in the layouts. */
export const piecePanelId = (p: { kind: PieceKind; item: string }): string => `piece:${pieceKey(p)}`;

const KEY = 'mobius.pieces';
/** At most this many at once: more would leave the page no room. The oldest goes first. */
export const MAX_PIECES = 3;
const KINDS = new Set<string>(Object.keys(PIECE_APP));

export function parsePieces(raw: string | null): OpenPiece[] {
  try {
    const v: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(v)) return [];
    const out: OpenPiece[] = [];
    for (const p of v) {
      if (!p || typeof p !== 'object') continue;
      const { kind, item, by, title } = p as Record<string, unknown>;
      if (typeof kind !== 'string' || !KINDS.has(kind) || typeof item !== 'string' || !item || item.length > 500) continue;
      const piece: OpenPiece = { kind: kind as PieceKind, item, by: by === 'mobius' ? 'mobius' : 'you', ...(typeof title === 'string' && title ? { title: title.slice(0, 200) } : {}) };
      if (!out.some((o) => pieceKey(o) === pieceKey(piece))) out.push(piece);
    }
    return out.slice(-MAX_PIECES);
  } catch {
    return [];
  }
}

/** Opens a piece (or keeps the one open, made the person's when they asked for it); the oldest goes past the limit. */
export function withPiece(open: readonly OpenPiece[], piece: OpenPiece): OpenPiece[] {
  const at = open.findIndex((o) => pieceKey(o) === pieceKey(piece));
  if (at >= 0) {
    const was = open[at]!;
    const title = piece.title ?? (piece.item === was.item ? was.title : undefined);
    // Mobius bringing it again does not take it back from the person.
    const now: OpenPiece = { kind: was.kind, item: piece.item, by: piece.by === 'you' || was.by === 'you' ? 'you' : 'mobius', ...(title ? { title } : {}) };
    return open.map((o, i) => (i === at ? now : o));
  }
  return [...open, piece].slice(-MAX_PIECES);
}

let pieces: OpenPiece[] = parsePieces((() => { try { return localStorage.getItem(KEY); } catch { return null; } })());
const listeners = new Set<() => void>();
function set(next: OpenPiece[]): void {
  pieces = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Not kept. */ }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export const usePieces = (): readonly OpenPiece[] => useSyncExternalStore(subscribe, () => pieces, () => pieces);

export function showPiece(kind: PieceKind, item: string, by: OpenPiece['by'] = 'you', title?: string): void {
  set(withPiece(pieces, { kind, item, by, ...(title ? { title } : {}) }));
}
export function putAway(kind: PieceKind, item: string): void {
  set(pieces.filter((o) => pieceKey(o) !== pieceKey({ kind, item })));
}
/** The thing it shows was renamed (a list): the piece follows it. */
export function renamePieceItem(kind: PieceKind, from: string, to: string): void {
  if (!pieces.some((o) => o.kind === kind && o.item === from)) return;
  set(pieces.map((o) => (o.kind === kind && o.item === from ? { ...o, item: to } : o)));
}

/**
 * What Mobius is working on that has a piece: the lists it changed, the days it suggested events on, the conversations
 * it drafted replies in. Each is keyed by the thing that marks it (a list's name, a suggestion's or draft's id).
 */
export interface MobiusWork {
  lists: ReadonlySet<string>;
  /** Suggestion id to its day (YYYY-MM-DD). */
  days: ReadonlyMap<string, string>;
  /** Mobius's draft id to the message it answers, with that message's subject. */
  drafts: ReadonlyMap<string, { replyTo: string; title: string }>;
}
export const NO_WORK: MobiusWork = { lists: new Set(), days: new Map(), drafts: new Map() };

/** What a turn's work brings up: the first thing in it that was not there when the turn started. */
export function workToShow(before: MobiusWork, now: MobiusWork): { kind: PieceKind; item: string; title?: string } | null {
  for (const list of now.lists) if (!before.lists.has(list)) return { kind: 'tasks.list', item: list };
  for (const [id, day] of now.days) if (!before.days.has(id)) return { kind: 'calendar.day', item: day };
  for (const [id, d] of now.drafts) if (!before.drafts.has(id)) return { kind: 'mail.thread', item: d.replyTo, ...(d.title ? { title: d.title } : {}) };
  return null;
}

/** Whether a piece still shows work of Mobius's waiting for Keep or Discard (an added suggestion or a sent draft is done). */
export function workOpenIn(p: { kind: PieceKind; item: string }, now: MobiusWork): boolean {
  if (p.kind === 'tasks.list') return now.lists.has(p.item);
  if (p.kind === 'calendar.day') return [...now.days.values()].includes(p.item);
  return [...now.drafts.values()].some((d) => d.replyTo === p.item);
}

/** The Mobius pieces (not yet the person's) go: Esc, or its work is done. */
export function putAwayMobius(only?: (p: OpenPiece) => boolean): void {
  const next = pieces.filter((o) => o.by !== 'mobius' || (only !== undefined && !only(o)));
  if (next.length !== pieces.length) set(next);
}

/** The piece a found thing shows as (Ctrl+K's Show here): a task list, a day, a mail conversation; none for the rest. */
export function pieceOfTarget(target: { app: string; list?: string; id?: string; date?: string }, title?: string): { kind: PieceKind; item: string; title?: string } | null {
  if (target.app === 'tasks' && target.list) return { kind: 'tasks.list', item: target.list };
  if (target.app === 'mail' && target.id) return { kind: 'mail.thread', item: target.id, ...(title ? { title } : {}) };
  if (target.app === 'calendar') return { kind: 'calendar.day', item: target.date && /^\d{4}-\d{2}-\d{2}$/.test(target.date) ? target.date : 'today' };
  return null;
}
/** Show here, for a found thing that has a piece. */
export function showTarget(target: { app: string; list?: string; id?: string; date?: string }, title?: string): (() => void) | undefined {
  const p = pieceOfTarget(target, title);
  return p ? () => showPiece(p.kind, p.item, 'you', p.title) : undefined;
}
