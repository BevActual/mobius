/**
 * Pieces (docs/design/pieces.md): a small, live view of one thing from an app (a task list, a day, a mail thread) that
 * sits beside whatever app is open. A piece is a panel the shell owns: it is in every app's right dock until it is put
 * away, listed in the Panels menu, and moved, floated and resized like any panel.
 *
 * This file keeps which pieces are open, on this device. What each piece draws is the shell's (App.tsx), from the apps'
 * own components.
 */
import { useSyncExternalStore } from 'react';

export type PieceKind = 'tasks.list';

/** The apps the pieces come from, for "Open in …". */
export const PIECE_APP: Record<PieceKind, { app: 'tasks'; name: string }> = {
  'tasks.list': { app: 'tasks', name: 'Tasks' },
};

export interface OpenPiece {
  kind: PieceKind;
  /** The thing it shows: a list's name. */
  item: string;
  /** Mobius's until the person uses it; Mobius's carry the dashed edge and go when its work is kept or discarded. */
  by: 'mobius' | 'you';
}

export const pieceKey = (p: { kind: PieceKind; item: string }): string => `${p.kind}:${p.item}`;
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
      const { kind, item, by } = p as Record<string, unknown>;
      if (typeof kind !== 'string' || !KINDS.has(kind) || typeof item !== 'string' || !item || item.length > 500) continue;
      const piece: OpenPiece = { kind: kind as PieceKind, item, by: by === 'mobius' ? 'mobius' : 'you' };
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
  if (at >= 0) return piece.by === 'you' && open[at]!.by === 'mobius' ? open.map((o, i) => (i === at ? { ...o, by: 'you' } : o)) : [...open];
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

export function showPiece(kind: PieceKind, item: string, by: OpenPiece['by'] = 'you'): void {
  set(withPiece(pieces, { kind, item, by }));
}
export function putAway(kind: PieceKind, item: string): void {
  set(pieces.filter((o) => pieceKey(o) !== pieceKey({ kind, item })));
}
/** The thing it shows was renamed (a list): the piece follows it. */
export function renamePieceItem(kind: PieceKind, from: string, to: string): void {
  if (!pieces.some((o) => o.kind === kind && o.item === from)) return;
  set(pieces.map((o) => (o.kind === kind && o.item === from ? { ...o, item: to } : o)));
}
