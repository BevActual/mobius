import type { ConversationInfo } from '@mobius/shared';
import type { Activity } from './activity';
import { appName, type AppId } from './apps';
import { APP_ICONS } from './Rail';

export interface DeskRow {
  app: AppId;
  /** What is there, in a few words ("3 due today"). */
  text: string;
}

interface Props {
  /** What is open or due in each app right now. Apps with nothing to say are left out. */
  rows: readonly DeskRow[];
  /** Apps Mobius changed while you were somewhere else. */
  changed: ReadonlySet<AppId>;
  activity: Activity | null;
  conversations: readonly ConversationInfo[];
  onOpenApp: (app: AppId) => void;
  onOpenConversation: (id: string) => void;
  now?: Date;
}

const partOfDay = (hour: number): string => (hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening');

/**
 * The desk: what is in flight, on one page, where an empty conversation used to show nothing. What waits for you comes
 * first, then what is open in your apps; an app Mobius changed carries its dashed edge until you look.
 */
export function Desk({ rows, changed, activity, conversations, onOpenApp, onOpenConversation, now = new Date() }: Props) {
  const waiting = conversations.filter((c) => c.waiting > 0);
  const apps = [...rows];
  for (const app of changed) if (!apps.some((row) => row.app === app)) apps.push({ app, text: 'Changed by Mobius' });
  const day = now.toLocaleDateString(undefined, { weekday: 'long' });
  const facts = [
    waiting.length > 0 ? `${waiting.length} waiting for you` : '',
    changed.size > 0 ? `${changed.size} ${changed.size === 1 ? 'app' : 'apps'} changed` : '',
  ].filter(Boolean);
  const quiet = waiting.length === 0 && !activity && apps.length === 0;
  return (
    <section className="desk" aria-label="Desk">
      <p className="desk-title">{day} {partOfDay(now.getHours())}{facts.map((fact) => <span key={fact}> · {fact}</span>)}</p>
      {quiet && <p className="desk-quiet">All quiet. Nothing is waiting for you.</p>}
      {(waiting.length > 0 || activity) && (
        <div className="desk-group" role="group" aria-label="Now">
          <h3 className="desk-head">Now</h3>
          <ul className="desk-rows">
            {waiting.map((c) => (
              <li key={c.id}>
                <button type="button" className="desk-row" data-needs onClick={() => onOpenConversation(c.id)}>
                  <svg viewBox="0 0 20 20" aria-hidden="true" style={{ background: 'var(--app-agent)' }}>{APP_ICONS.agent}</svg>
                  <span className="desk-name">{c.title || 'Conversation'}</span>
                  <span className="desk-text">Needs you</span>
                </button>
              </li>
            ))}
            {activity && !activity.needsYou && (
              <li>
                <div className="desk-row" data-working role="status">
                  <svg viewBox="0 0 20 20" aria-hidden="true" style={{ background: 'var(--app-agent)' }}>{APP_ICONS.agent}</svg>
                  <span className="desk-name">Mobius is working</span>
                  <span className="desk-text">{activity.label}{activity.step ? ` · step ${activity.step.done + 1} of ${activity.step.total}` : ''}</span>
                </div>
              </li>
            )}
          </ul>
        </div>
      )}
      {apps.length > 0 && (
        <div className="desk-group" role="group" aria-label="In your apps">
          <h3 className="desk-head">In your apps</h3>
          <ul className="desk-rows" data-columns>
            {apps.map(({ app, text }) => (
              <li key={app}>
                <button type="button" className="desk-row" data-changed={changed.has(app) || undefined} onClick={() => onOpenApp(app)}>
                  <svg viewBox="0 0 20 20" aria-hidden="true" style={{ background: `var(--app-${app})` }}>{APP_ICONS[app]}</svg>
                  <span className="desk-name">{appName(app)}</span>
                  <span className="desk-text">{changed.has(app) && text !== 'Changed by Mobius' ? `${text} · changed by Mobius` : text}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
