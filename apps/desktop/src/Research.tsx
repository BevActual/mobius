import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { NotesSidebar, type SidebarWords } from './NotesSidebar';
import { RichText } from './RichText';
import { useFileReview } from './useFileReview';
import { DEPTHS, claimCounts, followUpPrompt, isWaiting, researchPrompt, sourcesOf, startingPage, titleFor, type Depth } from './research-format';
import type { NotesState } from './useNotes';

export const RESEARCH_WORDS: SidebarWords = { app: 'Research', group: 'folder', groups: 'Folders', item: 'report', items: 'reports', about: 'Reports are kept as Markdown files in your workspace, with their sources, so Docs and the agent can open them too.', defaultGroup: 'Research' };
export const RESEARCH_FOLDER = 'Research';

export function ResearchSidebar(props: { research: NotesState; pin: ReactNode; changed?: ReadonlySet<string> }) {
  const { research, ...rest } = props;
  return <NotesSidebar notes={research} words={RESEARCH_WORDS} {...rest} />;
}

/** A page that holds nothing but its title, as a new report from the sidebar does: it shows the question form. */
const isBlank = (text: string) => text.split('\n').filter((l) => l.trim() && !/^#\s/.test(l.trim())).length === 0;

const EXAMPLES = [
  'Which neighbourhoods in Lisbon are walkable to LX Factory, and what do hotels there cost in March?',
  'What changed in the EU AI Act this year for small companies?',
  'Compare the three most popular home espresso machines under $700.',
];

/**
 * Research: ask a question, and Mobius searches the web from several angles, reads the best pages and writes a report
 * with its sources. The report is a page like any other; follow-ups add to it.
 */
export function ResearchPage({ research, review, busy, asking, onAsk, onAskDone }: {
  research: NotesState;
  review?: { conversation: string } | null;
  /** The agent is working on something now. */
  busy: boolean;
  /** "New research" was chosen: show the question form even with a report open. */
  asking: boolean;
  /** Sends a request to the agent, with the open report attached when `attach` is set. */
  onAsk: (prompt: string, attach: boolean) => void;
  onAskDone: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [depth, setDepth] = useState<Depth>('quick');
  const [followUp, setFollowUp] = useState('');
  const [editing, setEditing] = useState(false);
  const page = research.page;
  const file = page ? `research/${page.path}` : null;
  const { before, keep, discard } = useFileReview(review, file, page?.base);
  const sources = useMemo(() => sourcesOf(research.text), [research.text]);
  const claims = useMemo(() => claimCounts(research.text), [research.text]);
  useEffect(() => setEditing(false), [page?.path]);

  const showForm = asking || !page || isBlank(research.text);
  const start = async (event: FormEvent) => {
    event.preventDefault();
    const q = question.trim();
    if (!q) return;
    let folder = page?.path.split('/')[0] ?? research.notebooks[0]?.name ?? null;
    folder ??= await research.createNotebook(RESEARCH_FOLDER);
    if (!folder) return;
    // A blank report from the sidebar is used up by the question rather than left behind empty.
    if (page && isBlank(research.text)) await research.remove(page.path);
    const path = await research.createPage(folder, titleFor(q), startingPage(q));
    if (!path) return;
    setQuestion('');
    onAskDone();
    onAsk(researchPrompt(q, depth, `research/${path}`), false);
  };

  if (showForm) {
    return (
      <section className="research-page research-ask" aria-label="Research">
        <form className="research-form" onSubmit={(e) => void start(e)}>
          <h1>What should Mobius find out?</h1>
          <p className="research-lede">Mobius searches the web from a few angles, reads the best pages, and writes you a report with every source, here in Research.</p>
          <textarea
            aria-label="Research question"
            placeholder="Ask a question, as you would a person who will go and look it up"
            rows={3}
            maxLength={1000}
            value={question}
            autoFocus
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
          />
          <div className="research-depth" role="radiogroup" aria-label="How deep">
            {DEPTHS.map((d) => (
              <label key={d.id} className="research-depth-option" data-on={depth === d.id || undefined}>
                <input type="radio" name="research-depth" value={d.id} checked={depth === d.id} onChange={() => setDepth(d.id)} />
                <span className="research-depth-label">{d.label}</span>
                <span className="research-depth-detail">{d.detail}</span>
              </label>
            ))}
          </div>
          <div className="research-actions">
            {asking && page && <button type="button" className="btn" onClick={onAskDone}>Cancel</button>}
            <button type="submit" className="btn primary" disabled={!question.trim()}>Start research</button>
          </div>
          {!question && (
            <ul className="research-examples" aria-label="Examples">
              {EXAMPLES.map((x) => <li key={x}><button type="button" className="research-example" onClick={() => setQuestion(x)}>{x}</button></li>)}
            </ul>
          )}
        </form>
      </section>
    );
  }

  const waiting = isWaiting(research.text);
  const changed = review && before !== undefined && before !== research.text;
  return (
    <section className="research-page" aria-label="Research">
      <div className="research-body">
        <article className="research-report" aria-label="Report">
          {changed && (
            <div className="note-review" role="status">
              <span className="review-dot" aria-hidden="true" />
              <span className="note-review-text">{before === null || isWaiting(before) ? 'Mobius wrote this report in its last turn.' : 'Mobius changed this report in its last turn.'}</span>
              <button type="button" className="review-btn" onClick={() => void discard()}>Discard</button>
              <button type="button" className="review-btn" data-kind="keep" onClick={() => void keep()}>Keep</button>
            </div>
          )}
          <div className="research-tools" role="toolbar" aria-label="Report">
            {waiting && <span className="research-working" role="status">{busy ? 'Mobius is researching. The report appears here when it is written.' : 'Waiting for Mobius. If it stopped, ask again.'}</span>}
            {!waiting && <span className="research-meta">{sources.length === 1 ? '1 source' : `${sources.length} sources`}{claims.web ? ` · ${claims.web} ${claims.web === 1 ? 'fact' : 'facts'} marked from the web` : ''}</span>}
            <span className="research-gap" />
            <button type="button" className="btn" aria-pressed={editing} onClick={() => setEditing((e) => !e)}>{editing ? 'Done' : 'Edit'}</button>
          </div>
          {editing ? (
            <textarea className="research-edit" aria-label="Report text" spellCheck value={research.text} onChange={(e) => research.edit(e.target.value)} />
          ) : (
            <div className="research-text"><RichText text={research.text} /></div>
          )}
          {!waiting && (
            <form className="research-follow" onSubmit={(e) => { e.preventDefault(); if (!followUp.trim() || !file) return; onAsk(followUpPrompt(followUp, file), true); setFollowUp(''); }}>
              <input aria-label="Ask a follow-up" placeholder="Ask a follow-up, or ask Mobius to dig into one part" value={followUp} maxLength={1000} onChange={(e) => setFollowUp(e.target.value)} />
              <button type="submit" className="btn" disabled={!followUp.trim() || busy}>Ask</button>
            </form>
          )}
        </article>
        <aside className="research-sources" aria-label="Sources">
          <div className="design-panel-title">Sources</div>
          {sources.length === 0 && <p className="design-hint">{waiting ? 'The pages Mobius reads are listed here.' : 'This report lists no sources.'}</p>}
          <ol>
            {sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} title={s.url} onClick={(e) => { e.preventDefault(); void window.mobius.browser.open(s.url); }}>
                  <span className="research-source-site">{s.site}</span>
                  <span className="research-source-title">{s.title}</span>
                  {s.note && <span className="research-source-note">{s.note}</span>}
                </a>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </section>
  );
}
