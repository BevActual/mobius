import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { NotesSidebar, type SidebarWords } from './NotesSidebar';
import { Citations, RichText } from './RichText';
import { useFileReview } from './useFileReview';
import { DEPTHS, citeOf, claimCounts, followUpPrompt, isWaiting, nextQuestions, researchPrompt, sourcesOf, startingPage, titleFor, type Depth, type ResearchStep } from './research-format';
import type { NotesState } from './useNotes';
import { ReviewActions, WhyThis } from './ReviewBar';
import { DotMatrix, PanelLayout, ToolbarControls, type PanelSpec } from './ui';

export const RESEARCH_WORDS: SidebarWords = { app: 'Research', group: 'folder', groups: 'Folders', item: 'report', items: 'reports', about: 'Reports are kept as Markdown files in your workspace, with their sources, so Docs and the agent can open them too.', defaultGroup: 'Research' };
export const RESEARCH_FOLDER = 'Research';

export function ResearchSidebar(props: { research: NotesState; pin: ReactNode; changed?: ReadonlySet<string>; starts?: readonly import('./SideNew').Start[]; onStart?: (prompt: string) => void }) {
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

const ARROW = <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10M11 6l4 4-4 4" /></svg>;

/** One step of the research: muted, with Mobius's matrix on the one under way. */
function StepRow({ step, current }: { step: ResearchStep; current: boolean }) {
  const words = step.kind === 'search'
    ? `${step.status === 'running' ? 'Searching for' : 'Searched for'} “${step.text}”`
    : `${step.status === 'running' ? 'Reading' : step.status === 'failed' ? 'Could not read' : 'Read'} ${step.text}`;
  return (
    <li className="research-step" data-current={current || undefined} data-failed={step.status === 'failed' || undefined}>
      {current ? <DotMatrix mode={step.kind === 'search' ? 'searching' : 'reading'} cols={6} rows={3} className="research-step-matrix" /> : <span className="research-step-mark" aria-hidden="true" />}
      {step.url ? <a href={step.url} title={step.url} onClick={(e) => { e.preventDefault(); void window.mobius.browser.open(step.url!); }}>{words}</a> : <span>{words}</span>}
    </li>
  );
}

/**
 * Research: ask a question, and Mobius searches the web from several angles, reads the best pages and writes a report
 * with its sources. The report is a page like any other; follow-ups add to it.
 */
export function ResearchPage({ research, review, busy, asking, onAsk, onAskDone, steps = [], listPanels = [] }: {
  research: NotesState;
  /** The searches and reads of the turn that wrote (or is writing) the open report. */
  steps?: readonly ResearchStep[];
  review?: { conversation: string } | null;
  /** The agent is working on something now. */
  busy: boolean;
  /** "New research" was chosen: show the question form even with a report open. */
  asking: boolean;
  /** Sends a request to the agent, with the open report attached when `attach` is set. */
  onAsk: (prompt: string, attach: boolean) => void;
  onAskDone: () => void;
  /** The app's list, from the frame: its left panel. */
  listPanels?: readonly PanelSpec[];
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
  const { body, questions } = useMemo(() => nextQuestions(research.text), [research.text]);
  const cite = useMemo(() => (source: string) => { const c = citeOf(source, sources); return c ? { n: c.n, title: c.source.title, site: c.source.site, url: c.source.url } : null; }, [sources]);
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
        <PanelLayout app="research" panels={listPanels}>
        <form className="research-form" onSubmit={(e) => void start(e)}>
          <h1>What should Mobius find out?</h1>
          <p className="research-lede">Mobius searches the web from a few angles, reads the best pages, and writes you a report with every source, here in Research.</p>
          <textarea
            aria-label="Research question"
            placeholder="Ask a question, as you would a person who will go and look it up"
            rows={2}
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
            <section className="research-try" aria-label="Examples">
              <h2 className="research-try-title">Try</h2>
              <ul className="research-examples">
                {EXAMPLES.map((x) => <li key={x}><button type="button" className="research-example" onClick={() => setQuestion(x)}><span>{x}</span>{ARROW}</button></li>)}
              </ul>
            </section>
          )}
        </form>
        </PanelLayout>
      </section>
    );
  }

  const waiting = isWaiting(research.text);
  const changed = review && before !== undefined && before !== research.text;
  const siteCount = new Set(sources.map((s) => s.site)).size;
  // Sources (right dock, as Perplexity keeps them beside the answer): a panel of Research's own.
  const sourcesPanel: PanelSpec = { id: 'sources', name: 'Sources', dock: 'right', shown: true, render: () => (
    <aside className="research-sources" aria-label="Sources">
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
  ) };
  return (
    <section className="research-page" aria-label="Research">
      {/* The report's controls sit in the window's toolbar, as Notes' and Docs' do. */}
      <ToolbarControls label="Report">
        {!waiting && <span className="research-meta">{sources.length === 1 ? '1 source' : `${sources.length} sources`}{claims.web ? ` · ${claims.web} ${claims.web === 1 ? 'fact' : 'facts'} marked from the web` : ''}</span>}
        <span className="spacer" />
        <button type="button" className="btn" aria-pressed={editing} onClick={() => setEditing((e) => !e)}>{editing ? 'Done' : 'Edit'}</button>
      </ToolbarControls>
      <PanelLayout app="research" panels={[...listPanels, sourcesPanel]}>
        <article className="research-report" aria-label="Report">
          {changed && (
            <div className="note-review" role="status">
              <span className="review-dot" aria-hidden="true" />
              <span className="note-review-text">{before === null || isWaiting(before) ? 'Mobius wrote this report in its last turn.' : 'Mobius changed this report in its last turn.'}{review && <WhyThis conversation={review.conversation} />}</span>
              <ReviewActions onKeep={keep} onDiscard={discard} />
            </div>
          )}
          {waiting && <p className="research-working" role="status">{busy ? 'Mobius is researching. The report appears here when it is written.' : 'Waiting for Mobius. If it stopped, ask again.'}</p>}
          {waiting && steps.length > 0 && (
            // As it goes: each search and page, quiet, with the matrix on the one under way.
            <ol className="research-steps" aria-label="What Mobius has done">
              {steps.map((st, i) => <StepRow key={i} step={st} current={busy && st.status === 'running' && i === steps.length - 1} />)}
            </ol>
          )}
          {!waiting && steps.length > 0 && (() => {
            const read = steps.filter((st) => st.kind === 'read' && st.status === 'done').length;
            const searched = steps.filter((st) => st.kind === 'search').length;
            return (
              <details className="research-steps-done">
                <summary>{read > 0 ? `Read ${read} ${read === 1 ? 'source' : 'sources'}` : `Searched ${searched} ${searched === 1 ? 'time' : 'times'}`}{read > 0 && searched > 0 ? ` · ${searched} ${searched === 1 ? 'search' : 'searches'}` : ''}</summary>
                <ol className="research-steps">{steps.map((st, i) => <StepRow key={i} step={st} current={false} />)}</ol>
              </details>
            );
          })()}
          {!waiting && sources.length > 0 && (
            // As in Perplexity: where the answer comes from, at a glance, before reading it.
            <div className="research-chips" aria-label="Sources at a glance">
              {[...new Set(sources.map((s) => s.site))].slice(0, 4).map((site) => {
                const first = sources.find((s) => s.site === site)!;
                return <a key={site} className="research-chip" href={first.url} title={first.title} onClick={(e) => { e.preventDefault(); void window.mobius.browser.open(first.url); }}><span className="research-chip-dot" aria-hidden="true">{site.charAt(0).toUpperCase()}</span>{site}</a>;
              })}
              {siteCount > 4 && <span className="research-chip research-more">+{siteCount - 4}</span>}
            </div>
          )}
          {editing ? (
            <textarea className="research-edit" aria-label="Report text" spellCheck value={research.text} onChange={(e) => research.edit(e.target.value)} />
          ) : (
            <div className="research-text"><Citations.Provider value={cite}><RichText text={body} /></Citations.Provider></div>
          )}
          {!waiting && !editing && questions.length > 0 && file && (
            <section className="research-try research-next" aria-label="Ask next">
              <h2 className="research-try-title">Ask next</h2>
              <ul className="research-examples">
                {questions.map((q) => <li key={q}><button type="button" className="research-example" disabled={busy} onClick={() => onAsk(followUpPrompt(q, file), true)}><span>{q}</span>{ARROW}</button></li>)}
              </ul>
            </section>
          )}
          {!waiting && (
            <form className="research-follow" onSubmit={(e) => { e.preventDefault(); if (!followUp.trim() || !file) return; onAsk(followUpPrompt(followUp, file), true); setFollowUp(''); }}>
              <input aria-label="Ask a follow-up" placeholder="Ask a follow-up, or ask Mobius to dig into one part" value={followUp} maxLength={1000} onChange={(e) => setFollowUp(e.target.value)} />
              <button type="submit" className="btn" disabled={!followUp.trim() || busy}>Ask</button>
            </form>
          )}
        </article>
      </PanelLayout>
    </section>
  );
}
