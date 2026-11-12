import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { RichText } from './RichText';
import { appName, isAvailable, type AppId } from './apps';
import { TOPICS, editUrl, searchLessons, type LearnTopic, type Lesson } from './learn';
import './learn.css';

const Chevron = ({ back = false }: { back?: boolean }) => (
  <svg viewBox="0 0 20 20" aria-hidden="true"><path d={back ? 'M12 4l-6 6 6 6' : 'M8 4l6 6-6 6'} /></svg>
);

/**
 * Learn, beside the page: what Mobius is, then lessons by topic, each read in place while the app stays usable. The
 * lessons are the docs pages (see learn.ts). In an app, that app's lesson comes first.
 */
export function LearnPanel({ lessons, app, onClose, onOpenApp }: { lessons: readonly Lesson[]; app: AppId; onClose: () => void; onOpenApp: (id: AppId) => void }) {
  const [topic, setTopic] = useState<LearnTopic | 'all'>('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const reading = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => searchLessons(lessons, topic, query), [lessons, topic, query]);
  const here = lessons.find((l) => l.app === app);
  const lesson = lessons.find((l) => l.id === openId) ?? null;
  // Back and Next stay within the topic the lesson belongs to.
  const siblings = lesson ? lessons.filter((l) => l.topic === lesson.topic) : [];
  const at = lesson ? siblings.indexOf(lesson) : -1;

  useEffect(() => { root.current?.querySelector<HTMLElement>(lesson ? '.learn-lesson h2' : 'input[type="search"]')?.focus(); }, [lesson]);
  useEffect(() => { reading.current?.scrollTo?.({ top: 0 }); }, [openId]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    // Escape steps back: out of a search, out of a lesson, then closes.
    if (lesson) setOpenId(null);
    else if (query) setQuery('');
    else onClose();
  };

  const card = (l: Lesson, lead?: string) => (
    <li key={`${lead ?? ''}${l.id}`}>
      <button type="button" className="learn-card" onClick={() => setOpenId(l.id)}>
        <span className="learn-card-text">
          {lead && <span className="learn-card-lead">{lead}</span>}
          <span className="learn-card-title">{l.title}</span>
          <span className="learn-card-summary">{l.summary}</span>
        </span>
        <Chevron />
      </button>
    </li>
  );

  return (
    <aside ref={root} className="learn side" aria-label="Learn" onKeyDown={onKeyDown}>
      <div className="chat-head learn-head">
        {lesson ? (
          <button type="button" className="learn-back" onClick={() => setOpenId(null)}><Chevron back />Lessons</button>
        ) : <h2 className="learn-heading">Learn</h2>}
        <div className="chat-head-actions">
          <button type="button" className="head-icon" aria-label="Close Learn" title="Close (Esc)" onClick={onClose}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg>
          </button>
        </div>
      </div>
      {lesson ? (
        <div ref={reading} className="learn-scroll">
          <article className="learn-lesson">
            <p className="learn-kicker">{TOPICS.find((t) => t.id === lesson.topic)?.label}</p>
            <h2 tabIndex={-1}>{lesson.title}</h2>
            {lesson.can.length > 0 && (
              <section className="learn-can" aria-label="What you can do">
                <h3>What you can do</h3>
                <ul>{lesson.can.map((c) => <li key={c}>{c}</li>)}</ul>
              </section>
            )}
            <div className="learn-body"><RichText text={lesson.body} /></div>
            {lesson.app && lesson.app !== app && isAvailable(lesson.app) && (
              <button type="button" className="learn-open" onClick={() => onOpenApp(lesson.app!)}>Open {appName(lesson.app)}</button>
            )}
          </article>
          <nav className="learn-steps" aria-label="More lessons">
            {at > 0 ? <button type="button" onClick={() => setOpenId(siblings[at - 1]!.id)}><Chevron back /><span><small>Previous</small>{siblings[at - 1]!.title}</span></button> : <span />}
            {at < siblings.length - 1 ? <button type="button" data-next onClick={() => setOpenId(siblings[at + 1]!.id)}><span><small>Next</small>{siblings[at + 1]!.title}</span><Chevron /></button> : <span />}
          </nav>
          <p className="learn-source">
            Written in <code>{lesson.source.replace(/#.*$/, '')}</code>.{' '}
            <a href={editUrl(lesson)} onClick={(e) => { e.preventDefault(); void window.mobius.browser.open(editUrl(lesson)); }}>Suggest a change</a>
          </p>
        </div>
      ) : (
        <div className="learn-scroll">
          <p className="learn-intro">Mobius is one workspace for your everyday apps, with an agent that works across all of them. Start here, or pick an app to see what it can do.</p>
          <input type="search" className="side-search learn-search" aria-label="Search lessons" placeholder="Search lessons" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="learn-topics" role="radiogroup" aria-label="Topics">
            {TOPICS.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={topic === t.id} className="learn-topic" onClick={() => setTopic(t.id)}>{t.label}</button>
            ))}
          </div>
          <ul className="learn-cards" aria-label="Lessons">
            {here && !query && topic === 'all' && card(here, 'This app')}
            {shown.filter((l) => !(here && !query && topic === 'all' && l.id === here.id)).map((l) => card(l))}
          </ul>
          {shown.length === 0 && <p className="learn-none">No lessons match “{query}”.</p>}
        </div>
      )}
    </aside>
  );
}
