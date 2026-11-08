import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { onCommand } from './commands';
import { NotesSidebar, type SidebarWords } from './NotesSidebar';
import { RichText } from './RichText';
import { useFileReview } from './useFileReview';
import { ARCHIVE, READING_LIST, articleFile, articleTitle, keepLook, parseArticle, readLook, type ReadingLook } from './reader-format';
import type { NotesState } from './useNotes';

export const READER_WORDS: SidebarWords = { app: 'Reader', group: 'list', groups: 'Lists', item: 'article', items: 'articles', about: 'Articles are kept as Markdown files in your workspace, so the agent can read them with you.', defaultGroup: READING_LIST };

export function ReaderSidebar(props: { reading: NotesState; pin: ReactNode; changed?: ReadonlySet<string> }) {
  const { reading, ...rest } = props;
  return <NotesSidebar notes={reading} words={READER_WORDS} {...rest} />;
}

/** Fetches a page and keeps it as an article in the reading list. Gives the article's path, or why it could not. */
export async function saveToReader(reading: NotesState, url: string, list = READING_LIST): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const api = window.mobius.reading;
  if (!api) return { ok: false, message: 'Reader is not available.' };
  const got = await api.fetch(url.trim());
  if (!got.ok) return { ok: false, message: `That page could not be saved: ${got.message}.` };
  const folder = reading.notebooks.find((nb) => nb.name === list)?.name ?? (await reading.createNotebook(list));
  if (!folder) return { ok: false, message: 'The reading list could not be made.' };
  const path = await reading.createPage(folder, articleTitle(got.title, got.url), articleFile(got));
  return path ? { ok: true, path } : { ok: false, message: 'The article could not be kept.' };
}

const SIZES: { id: ReadingLook['size']; label: string }[] = [{ id: 's', label: 'Smaller' }, { id: 'm', label: 'Medium' }, { id: 'l', label: 'Larger' }];

/** Reader: pages kept to read later, shown as plain readable text, with where each came from. */
export function ReaderPage({ reading, review, tab }: { reading: NotesState; review?: { conversation: string } | null; tab: { url: string; title: string } | null }) {
  const [link, setLink] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [look, setLook] = useState<ReadingLook>(readLook);
  const field = useRef<HTMLInputElement>(null);
  // The New button's Save a link puts the cursor in the link field.
  useEffect(() => onCommand('save-link', () => field.current?.focus()), []);
  useEffect(() => keepLook(look), [look]);
  const page = reading.page;
  const article = useMemo(() => parseArticle(reading.text), [reading.text]);
  const file = page ? `reading/${page.path}` : null;
  const { before, keep, discard } = useFileReview(review, file, page?.base);
  const inArchive = page?.path.split('/')[0] === ARCHIVE;

  const save = async (url: string) => {
    setSaving(true);
    setMessage('');
    const done = await saveToReader(reading, url);
    setSaving(false);
    if (!done.ok) { setMessage(done.message); return; }
    setLink('');
  };
  const submit = (e: FormEvent) => { e.preventDefault(); if (link.trim()) void save(/^https?:\/\//i.test(link.trim()) ? link.trim() : `https://${link.trim()}`); };
  /** Read: moved to the Archive list, out of the way but still searchable. */
  const archive = async () => {
    const api = window.mobius.reading;
    if (!api || !page) return;
    const folder = reading.notebooks.find((nb) => nb.name === ARCHIVE)?.name ?? (await reading.createNotebook(ARCHIVE));
    if (!folder) return;
    const text = reading.text;
    const old = page.path;
    const made = await reading.createPage(folder, page.title || article.title || 'Article', text);
    if (made) await reading.remove(old);
    else setMessage('It could not be moved to the archive.');
  };

  const saveBar = (
    <form className="reader-save" onSubmit={submit} aria-label="Save to read later">
      <input ref={field} aria-label="Link to save" placeholder="Paste a link to read later" value={link} maxLength={2000} onChange={(e) => setLink(e.target.value)} disabled={saving} />
      <button type="submit" className="btn primary" disabled={!link.trim() || saving}>{saving ? 'Saving…' : 'Save'}</button>
      {tab && /^https?:/i.test(tab.url) && <button type="button" className="btn" disabled={saving} title={tab.url} onClick={() => void save(tab.url)}>Save this tab</button>}
    </form>
  );

  if (!page) {
    return (
      <section className="reader-page" aria-label="Reader">
        {saveBar}
        {message && <p className="reader-message" role="alert">{message}</p>}
        <div className="reader-empty">
          <h1>Read it later, here.</h1>
          <p>Save a page and Reader keeps just its words: no menus, no adverts, nothing that loads from the web while you read. Mobius can read along, to summarise it or answer questions.</p>
        </div>
      </section>
    );
  }
  const changed = review && before !== undefined && before !== reading.text;
  return (
    <section className="reader-page" aria-label="Reader">
      {saveBar}
      {message && <p className="reader-message" role="alert">{message}</p>}
      <div className="reader-scroll">
        <article className="reader-article" aria-label="Article" data-size={look.size} data-face={look.face}>
          {changed && (
            <div className="note-review" role="status">
              <span className="review-dot" aria-hidden="true" />
              <span className="note-review-text">Mobius changed this article in its last turn.</span>
              <button type="button" className="review-btn" onClick={() => void discard()}>Discard</button>
              <button type="button" className="review-btn" data-kind="keep" onClick={() => void keep()}>Keep</button>
            </div>
          )}
          <div className="reader-meta">
            {article.url && <a href={article.url} title={article.url} onClick={(e) => { e.preventDefault(); void window.mobius.browser.open(article.url!); }}>{article.site}</a>}
            {article.saved && <span>Saved {article.saved}</span>}
            <span>{article.minutes} min read</span>
            <span className="reader-gap" />
            <span className="reader-look" role="group" aria-label="Text">
              <button type="button" className="strip-btn" aria-pressed={look.face === 'serif'} title="Serif" onClick={() => setLook((l) => ({ ...l, face: l.face === 'serif' ? 'sans' : 'serif' }))}>Aa</button>
              {SIZES.map((s) => <button key={s.id} type="button" className="strip-btn" data-size={s.id} aria-pressed={look.size === s.id} aria-label={s.label} onClick={() => setLook((l) => ({ ...l, size: s.id }))}>A</button>)}
            </span>
            {!inArchive && <button type="button" className="btn" onClick={() => void archive()}>Done reading</button>}
          </div>
          <h1 className="reader-title">{article.title || page.title}</h1>
          <div className="reader-body"><RichText text={article.body} /></div>
        </article>
      </div>
    </section>
  );
}
