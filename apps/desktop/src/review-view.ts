import type { ConversationInfo, TurnRecord } from '@mobius/shared';
import { describeChange } from './ReviewStrip';
import type { AppId } from './apps';

/** One turn of Mobius's that changed something, with the conversation it was in. */
export interface ReviewTurn { conversation: string; title: string; start: string; when: number; ask: string; files: string[] }

/** Every turn that changed something, newest first, across the conversations given. */
export function gatherTurns(conversations: readonly Pick<ConversationInfo, 'id' | 'title'>[], turns: ReadonlyMap<string, readonly TurnRecord[]>): ReviewTurn[] {
  const out: ReviewTurn[] = [];
  for (const c of conversations) {
    for (const t of turns.get(c.id) ?? []) {
      if (t.files.length === 0) continue;
      out.push({ conversation: c.id, title: c.title || 'Conversation', start: t.start, when: t.when, ask: t.ask, files: t.files });
    }
  }
  return out.sort((a, b) => b.when - a.when);
}

/** The app a changed file belongs to, to filter by and to open it in. */
export function appOf(path: string): AppId | null {
  const top = path.split('/')[0];
  const map: Record<string, AppId> = { notes: 'notes', docs: 'docs', slides: 'slides', sheets: 'sheets', tasks: 'tasks', calendar: 'calendar', code: 'code', designs: 'design', boards: 'canvas', research: 'research', reading: 'reader', databases: 'database', photos: 'photo', studio: 'studio', video: 'video', skills: 'skills' };
  return top ? (map[top] ?? null) : null;
}

/** Turns with only the files of one app (or all), leaving out turns left with none. */
export function filterTurns(turns: readonly ReviewTurn[], app: AppId | 'all'): ReviewTurn[] {
  if (app === 'all') return [...turns];
  return turns.map((t) => ({ ...t, files: t.files.filter((f) => appOf(f) === app) })).filter((t) => t.files.length > 0);
}

/** How many changed files each app has, for the filters. */
export function countByApp(turns: readonly ReviewTurn[]): Map<AppId, number> {
  const out = new Map<AppId, number>();
  for (const t of turns) for (const f of t.files) { const a = appOf(f); if (a) out.set(a, (out.get(a) ?? 0) + 1); }
  return out;
}

/** The day a turn falls on, for headings: Today, Yesterday, or the date. */
export function dayOf(when: number, now: Date = new Date()): string {
  const d = new Date(when);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

export { describeChange };
