import type { AppId } from './apps';
import { changeTarget } from './actions';
import { scopeOf } from './ReviewStrip';
import type { HubTarget } from './search-hub';

/**
 * Where an app opens when the last turn changed something in it that is still waiting for Keep: on that change, not
 * on whatever was open before. Once per app for each set of changes, so moving away and back is left alone; and not
 * when the app already shows one of them.
 */
export function openOnChanges(app: AppId, pending: readonly string[], showingChange: boolean, seen: Set<string>): HubTarget | null {
  const mine = pending.filter((f) => scopeOf(f) === app);
  if (mine.length === 0) return null;
  const key = `${app}|${mine.join('|')}`;
  if (seen.has(key)) return null;
  seen.add(key);
  if (showingChange) return null;
  for (const file of mine) { const target = changeTarget(file); if (target) return target; }
  return null;
}
