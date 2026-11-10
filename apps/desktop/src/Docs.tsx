import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { changeGroups, diffCounts, diffLines, undoGroup, type DiffLine } from './line-diff';
import { liveTitle } from './notes-state';
import { NotesSidebar, type SidebarWords } from './NotesSidebar';
import type { NotesState } from './useNotes';
import type { ReactNode } from 'react';
import { ReviewActions, WhyThis } from './ReviewBar';
import type { Start } from './SideNew';

export const DOCS_WORDS: SidebarWords = { app: 'Docs', group: 'folder', groups: 'Folders', item: 'document', items: 'documents', about: 'Documents are kept as Markdown files in your workspace, so other apps and the agent can open them too.', defaultGroup: 'Documents' };
export const DEFAULT_FOLDER = 'Documents';

export function DocsSidebar(props: { docs: NotesState; pin: ReactNode; changed?: ReadonlySet<string>; pinned?: ReadonlySet<string>; onPin?: (path: string, title: string) => void; starts?: readonly Start[]; onStart?: (prompt: string) => void }) {
  const { docs, ...rest } = props;
  return <NotesSidebar notes={docs} words={DOCS_WORDS} {...rest} />;
}

/** What Mobius's writing tools do: each is a request to the agent, about the selection or the whole document. */
export type WritingTool = 'proofread' | 'friendlier' | 'shorter' | 'summarise';
export const WRITING_TOOLS: { id: WritingTool; label: string }[] = [
  { id: 'proofread', label: 'Proofread' },
  { id: 'friendlier', label: 'Rewrite · friendlier' },
  { id: 'shorter', label: 'Make it shorter' },
  { id: 'summarise', label: 'Summarise the doc' },
];

export const countWords = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

/** The headings of the document, for the outline. */
function headingsOf(editor: Editor | null): { level: number; text: string; pos: number }[] {
  if (!editor) return [];
  const out: { level: number; text: string; pos: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') out.push({ level: Number(node.attrs.level) || 1, text: node.textContent, pos });
    return node.type.name !== 'heading';
  });
  return out;
}

const STYLES = [
  { id: 'p', label: 'Body' },
  { id: 'h1', label: 'Title' },
  { id: 'h2', label: 'Heading' },
  { id: 'h3', label: 'Subheading' },
] as const;

function Toolbar({ editor, onTool, busy }: { editor: Editor; onTool?: (tool: WritingTool, selection: string | null) => void; busy: boolean }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: e.isActive('heading', { level: 1 }) ? 'h1' : e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : 'p',
      bold: e.isActive('bold'), italic: e.isActive('italic'), bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), quote: e.isActive('blockquote'), link: e.isActive('link'), table: e.isActive('table'),
      empty: e.state.selection.empty,
    }),
  });
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsButton = useRef<HTMLButtonElement>(null);
  // The menu floats above everything, placed under its button and kept inside the window.
  const menuAt = () => {
    const r = toolsButton.current?.getBoundingClientRect();
    if (!r) return { top: 0, left: 0 };
    return { top: r.bottom + 6, left: Math.max(8, Math.min(r.right - 230, window.innerWidth - 238)) };
  };
  const setStyle = (id: string) => {
    const chain = editor.chain().focus();
    if (id === 'p') chain.setParagraph().run();
    else chain.setHeading({ level: Number(id.slice(1)) as 1 | 2 | 3 }).run();
  };
  const link = () => {
    if (state.link) { editor.chain().focus().unsetLink().run(); return; }
    const href = window.prompt('Link to', 'https://');
    if (href && /^(https?:|mailto:)/i.test(href.trim())) editor.chain().focus().setLink({ href: href.trim() }).run();
  };
  const selectedText = () => {
    const { from, to, empty } = editor.state.selection;
    return empty ? null : editor.state.doc.textBetween(from, to, '\n');
  };
  return (
    <div className="doc-toolbar" role="toolbar" aria-label="Format">
      <select aria-label="Paragraph style" value={state.style} onChange={(e) => setStyle(e.target.value)}>
        {STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <span className="doc-tool-sep" />
      <button type="button" className="doc-tool" aria-label="Bold" aria-pressed={state.bold} title="Bold (Ctrl+B)" onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
      <button type="button" className="doc-tool" aria-label="Italic" aria-pressed={state.italic} title="Italic (Ctrl+I)" onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
      <button type="button" className="doc-tool" aria-label="Link" aria-pressed={state.link} title="Link" onClick={link}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.5-2.5a3 3 0 0 0-4.2-4.2l-.8.8M11.5 8.5a3 3 0 0 0-4.2 0L4.8 11a3 3 0 0 0 4.2 4.2l.8-.8" /></svg>
      </button>
      <span className="doc-tool-sep" />
      <button type="button" className="doc-tool" aria-label="Bulleted list" aria-pressed={state.bullet} title="Bulleted list" onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="6" r="1" /><circle cx="5" cy="10" r="1" /><circle cx="5" cy="14" r="1" /><path d="M8.5 6h7M8.5 10h7M8.5 14h7" /></svg>
      </button>
      <button type="button" className="doc-tool" aria-label="Numbered list" aria-pressed={state.ordered} title="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h1.5v3M4 8h3M4 12.5c.5-.8 2.5-.8 2.5.3 0 .8-2.5 1.5-2.5 2.2h2.6M9.5 6h6M9.5 10h6M9.5 14h6" /></svg>
      </button>
      <button type="button" className="doc-tool" aria-label="Quote" aria-pressed={state.quote} title="Quote" onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6v8M9 7h7M9 10h7M9 13h5" /></svg>
      </button>
      <button type="button" className="doc-tool" aria-label="Table" aria-pressed={state.table} title={state.table ? 'Delete table' : 'Insert table'} onClick={() => (state.table ? editor.chain().focus().deleteTable().run() : editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.5" y="4.5" width="13" height="11" rx="1.5" /><path d="M3.5 8.5h13M3.5 12h13M8 4.5v11M12 4.5v11" /></svg>
      </button>
      {state.table && (
        <>
          <button type="button" className="doc-tool text" onClick={() => editor.chain().focus().addRowAfter().run()}>+ Row</button>
          <button type="button" className="doc-tool text" onClick={() => editor.chain().focus().addColumnAfter().run()}>+ Column</button>
        </>
      )}
      <span className="spacer" />
      {onTool && (
        <div className="doc-writing">
          <button ref={toolsButton} type="button" className="doc-tool text mobius" aria-haspopup="menu" aria-expanded={toolsOpen} disabled={busy} onClick={() => setToolsOpen((o) => !o)}>Writing tools</button>
          {toolsOpen && createPortal(
            <>
            <div className="doc-writing-scrim" onMouseDown={() => setToolsOpen(false)} />
            <div className="doc-writing-menu" role="menu" aria-label="Writing tools" style={menuAt()} onKeyDown={(e) => { if (e.key === 'Escape') setToolsOpen(false); }}>
              <p className="doc-writing-sees">Sees: {state.empty ? 'the whole document' : 'the selected text'}</p>
              {WRITING_TOOLS.map((t) => (
                <button key={t.id} type="button" role="menuitem" onClick={() => { setToolsOpen(false); onTool(t.id, t.id === 'summarise' ? null : selectedText()); }}>{t.label}</button>
              ))}
            </div>
            </>,
            document.body,
          )}
        </div>
      )}
    </div>
  );
}

/** What the agent's last turn changed in this document, as proposals: old text struck, new text marked, each with Discard. */
function Proposals({ diff, onDiscard }: { diff: DiffLine[]; onDiscard: (group: number) => void }) {
  const ids = changeGroups(diff);
  const groups: { id: number; lines: DiffLine[] }[] = [];
  diff.forEach((line, i) => {
    const id = ids[i];
    if (id === null || id === undefined) return;
    const last = groups[groups.length - 1];
    if (last && last.id === id) last.lines.push(line); else groups.push({ id, lines: [line] });
  });
  return (
    <div className="doc-proposals" aria-label="Changes Mobius made">
      {groups.map((g) => (
        <div key={g.id} className="doc-proposal">
          {g.lines.filter((l) => l.kind === 'removed').length > 0 && <div className="doc-proposal-old">{g.lines.filter((l) => l.kind === 'removed').map((l, i) => <p key={i}>{l.text || ' '}</p>)}</div>}
          {g.lines.filter((l) => l.kind === 'added').length > 0 && <div className="doc-proposal-new">{g.lines.filter((l) => l.kind === 'added').map((l, i) => <p key={i}>{l.text || ' '}</p>)}</div>}
          <div className="doc-proposal-actions">
            <span>Mobius</span>
            <button type="button" className="btn" onClick={() => onDiscard(g.id)}>Discard</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The open document: a page you write on (bold, lists, headings, tables), kept as Markdown and saved as you type, with
 * its outline beside it. A document the agent changed shows those changes as proposals to keep or discard.
 */
export function DocEditor({ docs, autoFocus = true, review, onTool, busy = false }: {
  docs: NotesState;
  autoFocus?: boolean;
  review?: { conversation: string } | null;
  onTool?: (tool: WritingTool, selection: string | null) => void;
  busy?: boolean;
}) {
  const path = docs.page?.path ?? null;
  // The Markdown the editor last gave or was given, so a change from elsewhere is told from the person's typing.
  const known = useRef<string | null>(null);
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: true } }), TableKit, Markdown, Placeholder.configure({ placeholder: 'Write here…' })],
    content: '',
    editorProps: { attributes: { class: 'doc-page', 'aria-label': 'Document text', role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor: e, transaction }) => {
      if (transaction.getMeta('mobius-load')) return;
      // One blank line between blocks, as people write Markdown, and a newline at the end.
      const md = `${e.getMarkdown().replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
      known.current = md;
      docs.edit(md);
    },
  });
  // The document's text, from the store: put into the editor when it did not come from the editor itself.
  useEffect(() => {
    if (!editor || editor.isDestroyed || docs.text === known.current) return;
    known.current = docs.text;
    editor.chain().setMeta('mobius-load', true).setContent(docs.text, { contentType: 'markdown', emitUpdate: false }).run();
    if (autoFocus) editor.commands.focus('end');
    // A new document opens at its end; one changed elsewhere keeps the place as far as it can.
  }, [editor, docs.text, path]); // eslint-disable-line react-hooks/exhaustive-deps
  const outline = useEditorState({ editor, selector: ({ editor: e }) => headingsOf(e) }) ?? [];
  const words = useMemo(() => countWords(docs.text.replace(/[#>*_`|[\]()-]/g, ' ')), [docs.text]);

  // Review of the agent's last turn, as in Notes, but shown as proposals in the page.
  const [diff, setDiff] = useState<DiffLine[] | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  useEffect(() => {
    let live = true;
    const check = async () => {
      if (!review) { setKept(false); return; }
      const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
      const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
      if (live) setKept(id !== null && keptTurns().includes(id));
    };
    void check();
    window.addEventListener(KEPT_EVENT, check);
    return () => { live = false; window.removeEventListener(KEPT_EVENT, check); };
    // Checked again when the page changes: a new turn's change is not kept yet.
  }, [review?.conversation, path, docs.page?.base]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDiff(null); setBefore(null); setProblem(null); }, [path, review?.conversation]);
  const compare = (was: string | null, now: string): DiffLine[] => (was === null ? now.split('\n').map((text) => ({ kind: 'added' as const, text })) : diffLines(was, now));
  // Proposals show on their own once the agent has changed the open document.
  useEffect(() => {
    if (!review || kept || !path || diff) return;
    let live = true;
    void window.mobius.changes.before(review.conversation, `docs/${path}`).then((was) => {
      if (!live || !was || !was.ok) return;
      setBefore(was.text);
      const d = compare(was.text, docs.text);
      if (d.some((l) => l.kind !== 'same')) setDiff(d);
    }).catch(() => {});
    return () => { live = false; };
  }, [review?.conversation, kept, path]); // eslint-disable-line react-hooks/exhaustive-deps
  const keepAll = async () => {
    if (!review) return;
    const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
    const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
    if (id) keepTurn(id);
    setDiff(null);
    setKept(true);
  };
  const discardAll = async () => {
    if (!review || !path) return;
    const result = await window.mobius.changes.undoFile(review.conversation, `docs/${path}`).catch(() => ({ ok: false as const, error: 'That could not be undone.' }));
    if (!result.ok) setProblem(result.error);
    setDiff(null);
  };
  const discardOne = (group: number) => {
    if (!diff) return;
    const next = undoGroup(diff, group);
    docs.edit(next);
    const rest = compare(before, next);
    setDiff(rest.some((line) => line.kind !== 'same') ? rest : null);
  };

  if (!docs.page) {
    // The editor stays mounted (hidden), so it is ready the moment a document opens.
    return (
      <section className="doc-editor empty" aria-label="Document">
        <p className="note-empty">{docs.notebooks.length ? 'Choose a document, or make a new one.' : 'Make a folder to start, or use New document.'}</p>
        <EditorContent editor={editor} hidden />
      </section>
    );
  }
  const title = liveTitle(docs.text, docs.page.title || path?.split('/')[1]?.replace(/\.md$/, '') || '');
  const showing = review && !kept && diff;
  return (
    <section className="doc-editor" aria-label={`Document: ${title}`}>
      {docs.status === 'conflict' && (
        <div className="note-conflict" role="alert">
          <span>This document was changed somewhere else while you were editing it.</span>
          <button type="button" className="btn" onClick={() => void docs.resolve(false)}>Use that version</button>
          <button type="button" className="btn primary" onClick={() => void docs.resolve(true)}>Keep mine</button>
        </div>
      )}
      {editor && <Toolbar editor={editor} busy={busy} {...(onTool ? { onTool } : {})} />}
      <div className="doc-body">
        <nav className="doc-outline" aria-label="Outline">
          <span className="doc-outline-title">Outline</span>
          {outline.length === 0 && <span className="doc-outline-empty">Headings show here.</span>}
          {outline.map((h, i) => (
            <button key={`${h.pos}:${i}`} type="button" className="doc-outline-item" style={{ paddingLeft: 8 + (h.level - 1) * 12 }} data-level={h.level}
              onClick={() => { editor?.chain().focus().setTextSelection(h.pos + 1).scrollIntoView().run(); }}>{h.text || 'Untitled'}</button>
          ))}
        </nav>
        <div className="doc-scroll">
          {review && !kept && (
            <div className="note-review doc-review" role="status">
              <span className="review-dot" aria-hidden="true" />
              <span className="note-review-text">{diff ? (() => { const c = diffCounts(diff); return `Mobius changed ${c.added + c.removed === 1 ? 'one line' : `${c.added + c.removed} lines`} here in its last turn.`; })() : 'Mobius changed this document in its last turn.'}<WhyThis conversation={review.conversation} /></span>
              <ReviewActions onKeep={keepAll} onDiscard={discardAll} />
            </div>
          )}
          {problem && <p className="tasks-message" role="alert">{problem}</p>}
          {showing && <Proposals diff={diff} onDiscard={discardOne} />}
          <EditorContent editor={editor} className="doc-paper" />
        </div>
      </div>
      <footer className="doc-status"><span>{words === 1 ? '1 word' : `${words} words`}</span></footer>
    </section>
  );
}
