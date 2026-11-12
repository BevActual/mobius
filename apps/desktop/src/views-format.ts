import type { AppId } from './apps';

/**
 * A view in the Views app: a dashboard of live tiles, each showing something from another app. Kept as JSON in
 * `views/<folder>/<view>.json`, one tile per line, so Mobius can make and change views too:
 * {"version":1,"tiles":[{"id":"t1","kind":"tasks","show":"today","size":"wide"}]}
 * A tile holds only what to show, never the things themselves: those stay in their own apps.
 */
export type TileKind = 'mobius' | 'tasks' | 'calendar' | 'mail' | 'notes' | 'next';
export type TileSize = 'small' | 'wide';
export type TasksShow = 'today' | 'scheduled' | 'flagged' | 'all';
export type CalendarShow = 'today' | 'week';

export interface Tile {
  id: string;
  kind: TileKind;
  size: TileSize;
  /** A name of its own, in place of the kind's. */
  title?: string;
  /** Tasks: which tasks. Calendar: today or the next seven days. */
  show?: TasksShow | CalendarShow;
  /** Notes: only this notebook. */
  notebook?: string;
}

export interface View { version: 1; tiles: Tile[] }

/** Each kind of tile: its name, the app it shows (its icon and colour) and what a new one shows. */
export const TILE_KINDS: readonly { kind: TileKind; name: string; app: AppId; about: string; defaults: Partial<Tile> }[] = [
  { kind: 'mobius', name: 'Mobius', app: 'agent', about: 'What waits for you and what Mobius is doing', defaults: { size: 'wide' } },
  { kind: 'tasks', name: 'Tasks', app: 'tasks', about: 'Tasks due today, scheduled or flagged', defaults: { show: 'today' } },
  { kind: 'calendar', name: 'Calendar', app: 'calendar', about: 'Today’s events, or the week ahead', defaults: { show: 'today' } },
  { kind: 'mail', name: 'Mail', app: 'mail', about: 'Unread mail in your inbox', defaults: {} },
  { kind: 'notes', name: 'Notes', app: 'notes', about: 'The notes changed most recently', defaults: {} },
  { kind: 'next', name: 'Next', app: 'agent', about: 'What Mobius runs next on a schedule', defaults: {} },
];
export const tileKind = (kind: TileKind) => TILE_KINDS.find((k) => k.kind === kind)!;

export const TASKS_SHOW: readonly { id: TasksShow; name: string }[] = [
  { id: 'today', name: 'Today' }, { id: 'scheduled', name: 'Scheduled' }, { id: 'flagged', name: 'Flagged' }, { id: 'all', name: 'All' },
];
export const CALENDAR_SHOW: readonly { id: CalendarShow; name: string }[] = [{ id: 'today', name: 'Today' }, { id: 'week', name: 'Next 7 days' }];

/** The name a tile shows: its own, or its kind's with what it shows ("Tasks · Flagged"). */
export function tileTitle(tile: Tile): string {
  if (tile.title?.trim()) return tile.title.trim();
  const base = tileKind(tile.kind).name;
  if (tile.kind === 'tasks' && tile.show && tile.show !== 'today') return `${base} · ${TASKS_SHOW.find((s) => s.id === tile.show)?.name ?? ''}`;
  if (tile.kind === 'calendar' && tile.show === 'week') return `${base} · Next 7 days`;
  if (tile.kind === 'notes' && tile.notebook) return `${base} · ${tile.notebook}`;
  return base;
}

/** What a new view holds: what most people want to see first. */
export const STARTER_TILES: readonly Omit<Tile, 'id'>[] = [
  { kind: 'mobius', size: 'wide' },
  { kind: 'tasks', size: 'small', show: 'today' },
  { kind: 'calendar', size: 'small', show: 'today' },
  { kind: 'mail', size: 'small' },
  { kind: 'notes', size: 'small' },
];

const KINDS = new Set<string>(TILE_KINDS.map((k) => k.kind));
const SHOWS = new Set<string>([...TASKS_SHOW.map((s) => s.id), ...CALENDAR_SHOW.map((s) => s.id)]);

/** One tile as read from the file, or null when it is not one Views can show (left out, never an error). */
function readTile(raw: unknown, index: number): Tile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.kind !== 'string' || !KINDS.has(o.kind)) return null;
  const tile: Tile = { id: typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : `t${index + 1}`, kind: o.kind as TileKind, size: o.size === 'wide' ? 'wide' : 'small' };
  if (typeof o.title === 'string' && o.title.trim()) tile.title = o.title.slice(0, 80);
  if (typeof o.show === 'string' && SHOWS.has(o.show)) {
    const fits = tile.kind === 'tasks' ? TASKS_SHOW.some((s) => s.id === o.show) : tile.kind === 'calendar' ? CALENDAR_SHOW.some((s) => s.id === o.show) : false;
    if (fits) tile.show = o.show as TasksShow | CalendarShow;
  }
  if (tile.kind === 'notes' && typeof o.notebook === 'string' && o.notebook.trim()) tile.notebook = o.notebook.slice(0, 120);
  return tile;
}

/** A view's file read: empty text is a new, empty view; anything that is not a view says why. */
export function parseView(text: string): { view: View } | { error: string } {
  if (!text.trim()) return { view: { version: 1, tiles: [] } };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { error: 'This view’s file is not valid JSON.' }; }
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { tiles?: unknown }).tiles)) return { error: 'This file has no tiles list.' };
  const seen = new Set<string>();
  const tiles: Tile[] = [];
  (raw as { tiles: unknown[] }).tiles.forEach((t, i) => {
    const tile = readTile(t, i);
    if (!tile) return;
    while (seen.has(tile.id)) tile.id = `${tile.id}-${i}`;
    seen.add(tile.id);
    tiles.push(tile);
  });
  return { view: { version: 1, tiles } };
}

/** The file for a view: one tile per line, so a change shows as the lines it touched. */
export function writeView(view: View): string {
  if (view.tiles.length === 0) return '{\n  "version": 1,\n  "tiles": []\n}\n';
  return `{\n  "version": 1,\n  "tiles": [\n${view.tiles.map((t) => `    ${JSON.stringify(t)}`).join(',\n')}\n  ]\n}\n`;
}

export function freshTileId(view: View): string {
  let n = view.tiles.length + 1;
  while (view.tiles.some((t) => t.id === `t${n}`)) n++;
  return `t${n}`;
}

export function addTile(view: View, kind: TileKind): View {
  const tile: Tile = { id: freshTileId(view), kind, size: 'small', ...tileKind(kind).defaults };
  return { ...view, tiles: [...view.tiles, tile] };
}

export function starterView(): View {
  const view: View = { version: 1, tiles: [] };
  for (const t of STARTER_TILES) view.tiles.push({ id: freshTileId(view), ...t });
  return view;
}

export const removeTile = (view: View, id: string): View => ({ ...view, tiles: view.tiles.filter((t) => t.id !== id) });

/** A tile moved to `to` (its new index), the others keeping their order. */
export function moveTile(view: View, id: string, to: number): View {
  const from = view.tiles.findIndex((t) => t.id === id);
  if (from < 0) return view;
  const tiles = [...view.tiles];
  const [tile] = tiles.splice(from, 1);
  tiles.splice(Math.max(0, Math.min(to, tiles.length)), 0, tile!);
  return { ...view, tiles };
}

export function changeTile(view: View, id: string, patch: Partial<Omit<Tile, 'id' | 'kind'>>): View {
  return {
    ...view,
    tiles: view.tiles.map((t) => {
      if (t.id !== id) return t;
      const next: Tile = { ...t, ...patch };
      for (const key of ['title', 'show', 'notebook'] as const) if (next[key] === undefined || next[key] === '') delete next[key];
      return next;
    }),
  };
}

/** Tiles Mobius added or changed since `before` (null: it made the whole view). */
export function changedTiles(before: View | null, after: View): Set<string> {
  if (!before) return new Set(after.tiles.map((t) => t.id));
  const was = new Map(before.tiles.map((t) => [t.id, JSON.stringify(t)]));
  return new Set(after.tiles.filter((t) => was.get(t.id) !== JSON.stringify(t)).map((t) => t.id));
}

/** Tiles there before that are gone now. */
export function removedTiles(before: View | null, after: View): Tile[] {
  if (!before) return [];
  const now = new Set(after.tiles.map((t) => t.id));
  return before.tiles.filter((t) => !now.has(t.id));
}
