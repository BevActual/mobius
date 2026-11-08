import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ConversationInfo } from '@mobius/shared';
import { appName, type AppId } from './apps';
import { APP_ICONS } from './Rail';
import { appOf, countByApp, dayOf, describeChange, filterTurns, gatherTurns, type ReviewTurn } from './review-view';

/** How many conversations, newest first, the Review app looks through. */
const CONVERSATIONS = 40;

/** Everything Mobius changed, from every conversation: what it is, where it is, and putting it back. */
export function useReview(conversations: readonly ConversationInfo[], busy: boolean) {
  const [turns, setTurns] = useState<ReviewTurn[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<AppId | 'all' | 'waiting'>('all');
  const recent = useMemo(() => [...conversations].sort((a, b) => b.updated_ms - a.updated_ms).slice(0, CONVERSATIONS), [conversations]);
  const key = recent.map((c) => `${c.id}:${c.updated_ms}`).join(',');
  const load = useCallback(async () => {
    const api = window.mobius.changes;
    if (!api?.turns) { setLoading(false); return; }
    const results = await Promise.all(recent.map(async (c) => [c.id, await api.turns(c.id).catch(() => null)] as const));
    const map = new Map(results.map(([id, r]) => [id, r && r.ok ? r.turns : []]));
    setTurns(gatherTurns(recent, map));
    setLoading(false);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!busy) void load(); }, [busy, load]);
  const waiting = conversations.filter((c) => c.waiting > 0);
  return { turns, loading, filter, setFilter, waiting, reload: load };
}
export type ReviewState = ReturnType<typeof useReview>;

const Icon = ({ app }: { app: AppId }) => <svg viewBox="0 0 20 20" aria-hidden="true" data-app={app}>{APP_ICONS[app]}</svg>;

/** What to look at: everything, what waits for you, or one app's changes. */
export function ReviewSidebar({ review, pin }: { review: ReviewState; pin: ReactNode }) {
  const counts = countByApp(review.turns);
  const total = review.turns.reduce((n, t) => n + t.files.length, 0);
  const row = (id: AppId | 'all' | 'waiting', label: string, count: number, icon?: ReactNode) => (
    <li key={id}>
      <button type="button" className="note-row review-filter" aria-current={review.filter === id ? 'page' : undefined} onClick={() => review.setFilter(id)}>
        {icon}<span>{label}</span><span className="review-count">{count}</span>
      </button>
    </li>
  );
  return (
    <aside className="side review-side" aria-label="Review sidebar">
      <div className="side-head"><span className="side-title">Review</span><span className="side-actions">{pin}</span></div>
      <ul className="review-filters" aria-label="Show">
        {row('all', 'Everything Mobius changed', total)}
        {row('waiting', 'Waiting for you', review.waiting.reduce((n, c) => n + c.waiting, 0))}
      </ul>
      {counts.size > 0 && (
        <>
          <div className="side-head"><span className="side-title">By app</span></div>
          <ul className="review-filters" aria-label="By app">
            {[...counts].sort((a, b) => appName(a[0]).localeCompare(appName(b[0]))).map(([app, n]) => row(app, appName(app), n, <Icon app={app} />))}
          </ul>
        </>
      )}
    </aside>
  );
}

/** The changes, by day, each turn with what was asked; each file opens in its app or is put back. */
export function ReviewPage({ review, onOpenFile, onOpenConversation }: { review: ReviewState; onOpenFile: (path: string) => void; onOpenConversation: (id: string) => void }) {
  const [asking, setAsking] = useState<{ turn: ReviewTurn; path: string; why: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  if (review.filter === 'waiting') {
    return (
      <section className="review-page" aria-label="Review">
        <h1 className="review-title">Waiting for you</h1>
        {review.waiting.length === 0 && <p className="review-empty">Nothing is waiting for you. When Mobius needs you to allow something or answer a question, it is listed here.</p>}
        <ul className="review-waiting">
          {review.waiting.map((c) => (
            <li key={c.id}>
              <button type="button" className="review-waiting-row" onClick={() => onOpenConversation(c.id)}>
                <span className="review-dot" aria-hidden="true" />
                <span className="review-waiting-title">{c.title || 'Conversation'}</span>
                <span className="review-count">{c.waiting === 1 ? '1 question' : `${c.waiting} questions`}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  const shown = filterTurns(review.turns, review.filter);
  const putBack = async (turn: ReviewTurn, path: string, force = false) => {
    setProblem(null);
    const result = await window.mobius.changes.undoTurnFile(turn.conversation, turn.start, path, force).catch(() => ({ ok: false as const, error: 'That could not be put back.' }));
    if (!result.ok) {
      if ('later' in result && result.later) setAsking({ turn, path, why: result.error });
      else setProblem(result.error);
      return;
    }
    setAsking(null);
    setDone((was) => new Set([...was, `${turn.start}|${path}`]));
  };
  let lastDay = '';
  return (
    <section className="review-page" aria-label="Review">
      <h1 className="review-title">{review.filter === 'all' ? 'Everything Mobius changed' : `What Mobius changed in ${appName(review.filter)}`}</h1>
      <p className="review-lede">Each change is listed with what was asked. Open it to look, or put it back as it was before that turn.</p>
      {problem && <p className="review-problem" role="alert">{problem}</p>}
      {!review.loading && shown.length === 0 && <p className="review-empty">Nothing yet. When Mobius changes a note, a board, a database or anything else, it is listed here.</p>}
      {shown.map((t) => {
        const day = dayOf(t.when);
        const heading = day !== lastDay ? day : null;
        lastDay = day;
        return (
          <div key={`${t.conversation}-${t.start}-${t.when}`}>
            {heading && <h2 className="review-day">{heading}</h2>}
            <article className="review-turn" aria-label={`Turn: ${t.ask || 'a turn'}`}>
              <div className="review-turn-head">
                <span className="review-ask">{t.ask ? `“${t.ask}”` : 'A turn'}</span>
                <button type="button" className="review-conv" onClick={() => onOpenConversation(t.conversation)}>{t.title}</button>
                <span className="review-when">{new Date(t.when).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <ul className="review-files">
                {t.files.map((path) => {
                  const { kind, name } = describeChange(path);
                  const app = appOf(path);
                  const here = asking?.turn === t && asking.path === path;
                  const back = done.has(`${t.start}|${path}`);
                  return (
                    <li key={path} className="review-file">
                      {app ? <Icon app={app} /> : <span className="review-kind">{kind}</span>}
                      <span className="review-file-name" title={path}><span className="review-kind">{kind}</span> {name}</span>
                      {app && <button type="button" className="review-btn" aria-label={`Open ${name}`} onClick={() => onOpenFile(path)}>Open</button>}
                      {back ? <span className="review-back" role="status">Put back</span> : here ? (
                        <>
                          <span className="turn-history-warn" role="alert">{asking.why}</span>
                          <button type="button" className="review-btn" onClick={() => setAsking(null)}>Leave it</button>
                          <button type="button" className="review-btn" data-kind="keep" onClick={() => void putBack(t, path, true)}>Put back anyway</button>
                        </>
                      ) : (
                        <button type="button" className="review-btn" aria-label={`Put back ${name}`} onClick={() => void putBack(t, path)}>Put back</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </article>
          </div>
        );
      })}
    </section>
  );
}
