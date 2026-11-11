import { settleGone, settleIn, settleKept } from './settle';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { Extension, generateHTML } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { changeGroups, diffCounts, diffLines, undoGroup, type DiffLine } from './line-diff';
import { liveTitle } from './notes-state';
import { NotesSidebar, newItemIn, type SidebarWords } from './NotesSidebar';
import { untitledHeading } from './NoteEditor';
import { EmptyState } from './EmptyState';
import type { NotesState } from './useNotes';
import type { ReactNode } from 'react';
import type { NoteComment } from '@mobius/shared';
import { ReviewActions, WhyThis } from './ReviewBar';
import type { Start } from './SideNew';
import { tidyMarkdown } from './note-insert';
import { fileMarkdown, noteImage, readFile } from './note-files';
import { CommentComposer, CommentList, commentLine, useNoteComments } from './NoteComments';
import { NoteHistory, dayOf } from './NoteHistory';
import { copyFormatted, copyText, pageAsHtml } from './note-share';
import { linkTo, pageOfLink, pagesMatching } from './note-links';
import { docStats, activeHeading } from './docs-view';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import './docs.css';

export const DOCS_WORDS: SidebarWords = { app: 'Docs', group: 'folder', groups: 'Folders', item: 'document', items: 'documents', about: 'Documents are kept as Markdown files in your workspace, so other apps and the agent can open them too.', defaultGroup: 'Documents' };
export const DEFAULT_FOLDER = 'Documents';

export function DocsSidebar(props: { docs: NotesState; pin: ReactNode; changed?: ReadonlySet<string>; pinned?: ReadonlySet<string>; onPin?: (path: string, title: string) => void; starts?: readonly Start[]; onStart?: (prompt: string) => void }) {
  const { docs, ...rest } = props;
  return <NotesSidebar notes={docs} words={DOCS_WORDS} {...rest} />;
}

/** What Mobius's writing tools do: each is a request to the agent, about the selection or the whole document. */
/** `comment` asks Mobius to answer a comment: its selection is the comment thread, as commentLine writes it. */
export type WritingTool = 'proofread' | 'friendlier' | 'shorter' | 'summarise' | 'comment';
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
  { id: 'code', label: 'Code' },
] as const;

/** Whether the outline shows beside the page. Per device; shown unless hidden. */
const OUTLINE_KEY = 'mobius.docs.outline';
const readOutline = () => { try { return window.localStorage.getItem(OUTLINE_KEY) !== '0'; } catch { return true; } };

/** The words open comments are about, marked in the page. `quotes` is read when the plugin is told to look again. */
const commentKey = new PluginKey<DecorationSet>('doc-comments');
function commentDecorations(doc: PmNode, quotes: readonly string[]): DecorationSet {
  const marks: Decoration[] = [];
  const left = new Set(quotes.filter((q) => q.trim()));
  doc.descendants((node, pos) => {
    if (!left.size) return false;
    if (!node.isTextblock) return true;
    const text = node.textContent;
    for (const q of [...left]) {
      const at = text.indexOf(q);
      if (at < 0) continue;
      marks.push(Decoration.inline(pos + 1 + at, pos + 1 + at + q.length, { class: 'note-commented' }));
      left.delete(q);
    }
    return false;
  });
  return DecorationSet.create(doc, marks);
}
const docComments = (quotes: () => readonly string[]) => Extension.create({
  name: 'docComments',
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: commentKey,
      state: {
        init: (_, state) => commentDecorations(state.doc, quotes()),
        apply: (tr, old) => (tr.docChanged || tr.getMeta(commentKey) ? commentDecorations(tr.doc, quotes()) : old),
      },
      props: { decorations: (state) => commentKey.getState(state) },
    })];
  },
});

const keep = (e: { preventDefault: () => void }) => e.preventDefault();
const Icon = ({ d, children }: { d?: string; children?: ReactNode }) => <svg viewBox="0 0 20 20" aria-hidden="true">{d ? <path d={d} /> : children}</svg>;

/** A small menu under its button, closed by a click away or Escape. */
function Menu({ label, button, title, children, wide }: { label: string; button: ReactNode; title: string; children: (close: () => void) => ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const at = useRef<HTMLButtonElement>(null);
  const place = () => {
    const r = at.current?.getBoundingClientRect();
    const width = wide ? 240 : 210;
    if (!r) return { top: 0, left: 0 };
    return { top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), minWidth: width };
  };
  return (
    <>
      <button ref={at} type="button" className="doc-tool" aria-label={label} title={title} aria-haspopup="menu" aria-expanded={open} onPointerDown={keep} onClick={() => setOpen((o) => !o)}>{button}</button>
      {open && createPortal(
        <>
          <div className="doc-writing-scrim" onMouseDown={() => setOpen(false)} />
          <div className="doc-writing-menu doc-menu" role="menu" aria-label={label} style={place()} onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); at.current?.focus(); } }}>
            {children(() => setOpen(false))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

function Toolbar({ editor, onTool, busy, extras }: {
  editor: Editor;
  onTool?: (tool: WritingTool, selection: string | null) => void;
  busy: boolean;
  /** What the document can do beyond writing; absent where the folder does not keep these (the wiki). */
  extras: { onLink: () => void; onFile?: () => void; onHistory?: () => void; onShare?: (how: ShareHow) => void; outline: boolean; onOutline: () => void; comments: number; commentsOpen: boolean; onComments?: () => void };
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: e.isActive('heading', { level: 1 }) ? 'h1' : e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : e.isActive('codeBlock') ? 'code' : 'p',
      bold: e.isActive('bold'), italic: e.isActive('italic'), strike: e.isActive('strike'), code: e.isActive('code'), link: e.isActive('link'),
      bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), task: e.isActive('taskList'), quote: e.isActive('blockquote'), table: e.isActive('table'),
      empty: e.state.selection.empty, undo: e.can().undo(), redo: e.can().redo(),
    }),
  });
  const run = (f: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => () => { f(editor.chain().focus()).run(); };
  const setStyle = (id: string) => {
    const chain = editor.chain().focus();
    if (id === 'p') chain.setParagraph().run();
    else if (id === 'code') chain.toggleCodeBlock().run();
    else chain.setHeading({ level: Number(id.slice(1)) as 1 | 2 | 3 }).run();
  };
  const selectedText = () => {
    const { from, to, empty } = editor.state.selection;
    return empty ? null : editor.state.doc.textBetween(from, to, '\n');
  };
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  return (
    <div className="doc-toolbar" role="toolbar" aria-label="Format">
      <button type="button" className="doc-tool" aria-label="Undo" title={`Undo (${mod}Z)`} disabled={!state.undo} onPointerDown={keep} onClick={run((c) => c.undo())}><Icon d="M7.5 6 4 9.5 7.5 13M4.5 9.5H12a4 4 0 0 1 0 8h-1.5" /></button>
      <button type="button" className="doc-tool" aria-label="Redo" title={`Redo (${mod}Shift+Z)`} disabled={!state.redo} onPointerDown={keep} onClick={run((c) => c.redo())}><Icon d="M12.5 6 16 9.5 12.5 13M15.5 9.5H8a4 4 0 0 0 0 8h1.5" /></button>
      <span className="doc-tool-sep" />
      <select aria-label="Paragraph style" value={state.style} onChange={(e) => setStyle(e.target.value)}>
        {STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <span className="doc-tool-sep" />
      <button type="button" className="doc-tool" aria-label="Bold" aria-pressed={state.bold} title={`Bold (${mod}B)`} onPointerDown={keep} onClick={run((c) => c.toggleBold())}><b>B</b></button>
      <button type="button" className="doc-tool" aria-label="Italic" aria-pressed={state.italic} title={`Italic (${mod}I)`} onPointerDown={keep} onClick={run((c) => c.toggleItalic())}><i>I</i></button>
      <button type="button" className="doc-tool" aria-label="Strikethrough" aria-pressed={state.strike} title={`Strikethrough (${mod}Shift+S)`} onPointerDown={keep} onClick={run((c) => c.toggleStrike())}><s>S</s></button>
      <button type="button" className="doc-tool" aria-label="Code" aria-pressed={state.code} title={`Code (${mod}E)`} onPointerDown={keep} onClick={run((c) => c.toggleCode())}><Icon d="M7.5 6 3.5 10l4 4M12.5 6l4 4-4 4" /></button>
      <button type="button" className="doc-tool" aria-label="Link" aria-pressed={state.link} title={state.link ? 'Remove the link' : 'Link to a web page or another document'} onPointerDown={keep} onClick={() => (state.link ? editor.chain().focus().extendMarkRange('link').unsetLink().run() : extras.onLink())}>
        <Icon d="M8.5 11.5a3 3 0 0 0 4.2 0l2.5-2.5a3 3 0 0 0-4.2-4.2l-.8.8M11.5 8.5a3 3 0 0 0-4.2 0L4.8 11a3 3 0 0 0 4.2 4.2l.8-.8" />
      </button>
      <span className="doc-tool-sep" />
      <button type="button" className="doc-tool" aria-label="Bulleted list" aria-pressed={state.bullet} title={`Bulleted list (${mod}Shift+8)`} onPointerDown={keep} onClick={run((c) => c.toggleBulletList())}>
        <Icon><circle cx="5" cy="6" r="1" /><circle cx="5" cy="10" r="1" /><circle cx="5" cy="14" r="1" /><path d="M8.5 6h7M8.5 10h7M8.5 14h7" /></Icon>
      </button>
      <button type="button" className="doc-tool" aria-label="Numbered list" aria-pressed={state.ordered} title={`Numbered list (${mod}Shift+7)`} onPointerDown={keep} onClick={run((c) => c.toggleOrderedList())}>
        <Icon d="M4 5h1.5v3M4 8h3M4 12.5c.5-.8 2.5-.8 2.5.3 0 .8-2.5 1.5-2.5 2.2h2.6M9.5 6h6M9.5 10h6M9.5 14h6" />
      </button>
      <button type="button" className="doc-tool" aria-label="Checklist" aria-pressed={state.task} title={`Checklist (${mod}Shift+9)`} onPointerDown={keep} onClick={run((c) => c.toggleTaskList())}>
        <Icon><rect x="3.5" y="4" width="4" height="4" rx="1" /><path d="m4.3 13.2 1 1 1.9-2.2M10 6h6.5M10 13h6.5" /></Icon>
      </button>
      <button type="button" className="doc-tool" aria-label="Quote" aria-pressed={state.quote} title={`Quote (${mod}Shift+B)`} onPointerDown={keep} onClick={run((c) => c.toggleBlockquote())}><Icon d="M5 6v8M9 7h7M9 10h7M9 13h5" /></button>
      <Menu label="Insert" title="Insert a table, a picture or a divider" button={<Icon d="M10 4v12M4 10h12" />}>
        {(close) => (
          <>
            <button type="button" role="menuitem" onClick={() => { close(); editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); }}>Table</button>
            {extras.onFile && <button type="button" role="menuitem" onClick={() => { close(); extras.onFile!(); }}>Picture or file…</button>}
            <button type="button" role="menuitem" onClick={() => { close(); editor.chain().focus().setHorizontalRule().run(); }}>Divider</button>
            <button type="button" role="menuitem" onClick={() => { close(); editor.chain().focus().toggleCodeBlock().run(); }}>Code block</button>
          </>
        )}
      </Menu>
      {state.table && (
        <Menu label="Table" title="Rows and columns" button={<Icon><rect x="3.5" y="4.5" width="13" height="11" rx="1.5" /><path d="M3.5 8.5h13M3.5 12h13M8 4.5v11M12 4.5v11" /></Icon>}>
          {(close) => (
            <>
              <button type="button" role="menuitem" onClick={() => { close(); editor.chain().focus().addRowBefore().run(); }}>Add a row above</button>
              <button type="button" role="menuitem" onClick={() => { close(); editor.chain().focus().addRowAfter().run(); }}>Add a row below</button>
              <button type="button" role="menuitem" onClick={() => { close(); editor.chain().focus().addColumnBefore().run(); }}>Add a column before</button>
              <button type="button" role="menuitem" onClick={() => { close(); editor.chain().focus().addColumnAfter().run(); }}>Add a column after</button>
              <hr />
              <button type="button" role="menuitem" onClick={() => { close(); editor.chain().focus().deleteRow().run(); }}>Delete the row</button>
              <button type="button" role="menuitem" onClick={() => { close(); editor.chain().focus().deleteColumn().run(); }}>Delete the column</button>
              <button type="button" role="menuitem" className="danger" onClick={() => { close(); editor.chain().focus().deleteTable().run(); }}>Delete the table</button>
            </>
          )}
        </Menu>
      )}
      <span className="spacer" />
      <button type="button" className="doc-tool" aria-label="Outline" aria-pressed={extras.outline} title={extras.outline ? 'Hide the outline' : 'Show the outline'} onClick={extras.onOutline}>
        <Icon d="M4 5.5h12M6.5 10H16M9 14.5h7" />
      </button>
      {extras.onComments && (
        <button type="button" className="doc-tool doc-tool-count" aria-label={extras.comments ? `Comments, ${extras.comments} open` : 'Comments'} aria-pressed={extras.commentsOpen} title={extras.commentsOpen ? 'Hide comments' : 'Show comments'} onClick={extras.onComments}>
          <Icon d="M4.5 5.5h11a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H9l-3.5 2.5V14h-1a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" />
          {extras.comments > 0 && <span className="doc-count">{extras.comments}</span>}
        </button>
      )}
      {extras.onHistory && <button type="button" className="doc-tool" aria-label="History" title="Earlier versions of this document" onClick={extras.onHistory}><Icon d="M4 10a6 6 0 1 0 1.8-4.3M4 4v3.5h3.5M10 6.5V10l2.5 1.5" /></button>}
      {extras.onShare && (
        <Menu label="Share" title="Copy, export or print this document" wide button={<Icon d="M10 3.5v9M6.5 7 10 3.5 13.5 7M5.5 10.5v5h9v-5" />}>
          {(close) => (
            <>
              <button type="button" role="menuitem" onClick={() => { close(); extras.onShare!('formatted'); }}>Copy</button>
              <button type="button" role="menuitem" onClick={() => { close(); extras.onShare!('markdown'); }}>Copy as Markdown</button>
              <hr />
              <button type="button" role="menuitem" onClick={() => { close(); extras.onShare!('html'); }}>Export as web page</button>
              <button type="button" role="menuitem" onClick={() => { close(); extras.onShare!('md'); }}>Export as Markdown</button>
              <hr />
              <button type="button" role="menuitem" onClick={() => { close(); extras.onShare!('print'); }}>Print or save as PDF…</button>
            </>
          )}
        </Menu>
      )}
      {onTool && (
        <Menu label="Writing tools" title="Ask Mobius to proofread, rewrite or summarise" wide button={<span className="doc-tool-mobius">Writing tools</span>}>
          {(close) => (
            <>
              <p className="doc-writing-sees">Sees: {state.empty ? 'the whole document' : 'the selected text'}</p>
              {WRITING_TOOLS.map((t) => (
                <button key={t.id} type="button" role="menuitem" disabled={busy} onClick={() => { close(); onTool(t.id, t.id === 'summarise' ? null : selectedText()); }}>{t.label}</button>
              ))}
            </>
          )}
        </Menu>
      )}
    </div>
  );
}

/** What the agent's last turn changed in this document, as proposals: old text struck, new text marked, each with Discard. */
function Proposals({ diff, onDiscard, render }: { diff: DiffLine[]; onDiscard: (group: number) => void; render: (markdown: string) => string | null }) {
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
        <div key={g.id} className="doc-proposal" data-group={g.id}>
          {(['removed', 'added'] as const).map((kind) => {
            const lines = g.lines.filter((l) => l.kind === kind).map((l) => l.text);
            if (lines.length === 0) return null;
            // Shown as the document shows it, headings, lists and bold included; as lines when it will not read as Markdown.
            const html = render(lines.join('\n'));
            const cls = `${kind === 'removed' ? 'doc-proposal-old' : 'doc-proposal-new'}`;
            return html !== null
              ? <div key={kind} className={cls} dangerouslySetInnerHTML={{ __html: html }} />
              : <div key={kind} className={cls}>{lines.map((t, i) => <p key={i}>{t || ' '}</p>)}</div>;
          })}
          <div className="doc-proposal-actions">
            <span>Mobius</span>
            <button type="button" className="btn" onClick={(e) => { void settleGone(e.currentTarget.closest('.doc-proposal')).then(() => onDiscard(g.id)); }}>Discard</button>
          </div>
        </div>
      ))}
    </div>
  );
}

type ShareHow = 'markdown' | 'formatted' | 'html' | 'md' | 'print';

/**
 * The open document: a page you write on (headings, lists, checklists, tables, pictures, links to other documents),
 * kept as Markdown and saved as you type, with its outline beside it and its comments in the margin. History puts an
 * earlier version back; Share copies, exports or prints it. A document the agent changed shows those changes as
 * proposals to keep or discard.
 */
export function DocEditor({ docs, autoFocus = true, review, onTool, onComments, busy = false }: {
  docs: NotesState;
  autoFocus?: boolean;
  review?: { conversation: string } | null;
  onTool?: (tool: WritingTool, selection: string | null) => void;
  /** The open document's comments, as they change, so Mobius knows they are there. */
  onComments?: (comments: NoteComment[]) => void;
  busy?: boolean;
}) {
  const path = docs.page?.path ?? null;
  // History, comments, files and export are kept for Docs' own documents; the wiki keeps its own history.
  const own = docs.kind === 'docs' ? window.mobius.docs : undefined;
  const section = useRef<HTMLElement>(null);
  const pathNow = useRef(path);
  pathNow.current = path;
  // The Markdown the editor last gave or was given, so a change from elsewhere is told from the person's typing.
  const known = useRef<string | null>(null);
  const filesIn = useRef<(files: File[]) => void>(() => undefined);
  const openPage = useRef<(page: string) => void>(() => undefined);
  const image = useMemo(() => noteImage(() => pathNow.current ?? undefined, 'docs'), []);
  const commentState = useNoteComments(own ? path ?? undefined : undefined, 'docs');
  const quotesNow = useRef<string[]>([]);
  quotesNow.current = commentState.comments.filter((c) => !c.resolved).map((c) => c.quote);
  const commentMarks = useMemo(() => docComments(() => quotesNow.current), []);
  useEffect(() => { onComments?.(commentState.comments); }, [commentState.comments, onComments]);
  const askAbout = onTool ? (c: NoteComment) => onTool('comment', commentLine(c, commentState.comments)) : undefined;
  // The selection bar sits just above the chosen words.
  const [selection, setSelection] = useState<{ text: string; top: number; left: number; below: number } | null>(null);
  // The bar for selected words sits just above them; a comment on them opens just below them, so neither hides them.
  // Placed again when the mouse comes up, as a triple-click can settle its selection only then.
  const placeSelection = (e: Editor) => {
    const { from, to, empty } = e.state.selection;
    const box = section.current?.getBoundingClientRect();
    const text = empty ? '' : e.state.doc.textBetween(from, to, '\n');
    if (!box || text.trim().length < 2 || !e.view.hasFocus()) { setSelection(null); return; }
    const at = e.view.coordsAtPos(from);
    const end = e.view.coordsAtPos(to);
    setSelection({ text, top: Math.max(8, at.top - box.top - 44), left: Math.min(Math.max(8, at.left - box.left - 40), Math.max(8, box.width - 380)), below: end.bottom - box.top + 10 });
  };
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TableKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown,
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' ? 'Title' : 'Write here…') }),
      image,
      commentMarks,
    ],
    content: '',
    editorProps: {
      attributes: { class: 'doc-page', 'aria-label': 'Document text', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true' },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (!files.length) return false;
        filesIn.current(files);
        return true;
      },
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!files.length) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (at) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))));
        filesIn.current(files);
        return true;
      },
      // A link to another document opens it.
      handleClick: (_view, _pos, event) => {
        const a = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]');
        const page = a && pathNow.current ? pageOfLink(a.getAttribute('href') ?? '', pathNow.current) : null;
        if (!page) return false;
        event.preventDefault();
        openPage.current(page);
        return true;
      },
    },
    onUpdate: ({ editor: e, transaction }) => {
      if (transaction.getMeta('mobius-load')) return;
      const md = tidyMarkdown(e.getMarkdown());
      known.current = md;
      docs.edit(md);
    },
    onSelectionUpdate: ({ editor: e }) => placeSelection(e),
    onBlur: () => setSelection(null),
  });
  // The document's text, from the store: put into the editor when it did not come from the editor itself.
  useEffect(() => {
    if (!editor || editor.isDestroyed || docs.text === known.current) return;
    known.current = docs.text;
    editor.chain().setMeta('mobius-load', true).setContent(docs.text, { contentType: 'markdown', emitUpdate: false }).run();
    // Not while a dialog is open (the launcher): a page that loads late must not take the keys from it.
    if (autoFocus && !document.querySelector('dialog[open]')) {
      // A new document: its title is chosen, so what is typed first names it.
      const at = untitledHeading(editor);
      if (at) editor.chain().focus().setTextSelection(at).run(); else editor.commands.focus('end');
    }
  }, [editor, docs.text, path]); // eslint-disable-line react-hooks/exhaustive-deps
  const quoteKey = quotesNow.current.join('\u0000');
  useEffect(() => { if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(commentKey, true)); }, [editor, quoteKey]);
  const view = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return { outline: [] as ReturnType<typeof headingsOf>, at: 0, chosen: '' };
      const { from, to, empty } = e.state.selection;
      return { outline: headingsOf(e), at: from, chosen: empty ? '' : e.state.doc.textBetween(from, to, ' ') };
    },
  }) ?? { outline: [], at: 0, chosen: '' };
  const outline = view.outline;
  const current = activeHeading(outline, view.at);
  const stats = useMemo(() => docStats(docs.text), [docs.text]);
  const chosenWords = view.chosen ? countWords(view.chosen) : 0;

  const [outlineOpen, setOutlineOpen] = useState(readOutline);
  const toggleOutline = () => setOutlineOpen((o) => { try { window.localStorage.setItem(OUTLINE_KEY, o ? '0' : '1'); } catch { /* Not kept. */ } return !o; });
  const openComments = commentState.comments.filter((c) => !c.resolved).length;
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [composing, setComposing] = useState<{ quote: string; top: number; left: number } | null>(null);
  // The page's own right-click menu, in place of the web view's (which offers Inspect Element and the like).
  const [editMenu, setEditMenu] = useState<{ x: number; y: number } | null>(null);
  const editItems = (): ContextMenuItem[] => {
    if (!editor) return [];
    const { from, to, empty } = editor.state.selection;
    const words = empty ? '' : editor.state.doc.textBetween(from, to, '\n');
    const box = section.current?.getBoundingClientRect();
    const items: ContextMenuItem[] = [
      { action: 'cut', disabled: !words, run: () => { void navigator.clipboard?.writeText(words).then(() => editor.chain().focus().deleteSelection().run()).catch(() => {}); } },
      { action: 'copy', disabled: !words, run: () => { void navigator.clipboard?.writeText(words).catch(() => {}); editor.commands.focus(); } },
      { action: 'paste', run: () => { void navigator.clipboard?.readText().then((t) => { if (t) editor.chain().focus().insertContent(t, { contentType: 'markdown' }).run(); }).catch(() => editor.commands.focus()); } },
    ];
    if (words.trim().length >= 2 && own && commentState.available && box) {
      const end = editor.view.coordsAtPos(to);
      const at = editor.view.coordsAtPos(from);
      items.push({ label: 'Comment', separated: true, run: () => { setComposing({ quote: words.trim(), top: end.bottom - box.top + 10, left: Math.min(Math.max(8, at.left - box.left - 40), Math.max(8, box.width - 380)) }); setCommentsOpen(true); } });
    }
    if (words.trim()) items.push({ label: 'Link…', separated: items.length === 3, run: () => setLinking('') });
    return items;
  };
  useEffect(() => { setComposing(null); setSelection(null); }, [path]);
  const showQuote = (quote: string) => {
    if (!editor || editor.isDestroyed) return;
    let found: { from: number; to: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found) return false;
      if (!node.isTextblock) return true;
      const at = node.textContent.indexOf(quote);
      if (at >= 0) found = { from: pos + 1 + at, to: pos + 1 + at + quote.length };
      return false;
    });
    if (found) editor.chain().focus().setTextSelection(found).scrollIntoView().run();
  };

  // Linking: a web address, or another document by its name.
  const [linking, setLinking] = useState<string | null>(null);
  const [linkChoice, setLinkChoice] = useState(0);
  useEffect(() => setLinking(null), [path]);
  const looksLikeAddress = (t: string) => /^(https?:|mailto:|www\.)|\.[a-z]{2,}(\/|$)/i.test(t.trim());
  const linkPages = useMemo(() => (linking === null || !own || looksLikeAddress(linking) ? [] : pagesMatching(docs.notebooks, linking, path ?? undefined, 6)), [linking, docs.notebooks, path, own]);
  useEffect(() => setLinkChoice(0), [linking]);
  const linkPage = (pg: { path: string; title: string }) => {
    setLinking(null);
    if (!editor || !path) return;
    const href = linkTo(path, pg.path);
    const chain = editor.chain().focus();
    if (editor.state.selection.empty) chain.insertContent({ type: 'text', text: pg.title, marks: [{ type: 'link', attrs: { href } }] }).run();
    else chain.extendMarkRange('link').setLink({ href }).run();
  };
  const addLink = (event: FormEvent) => {
    event.preventDefault();
    const pick = linkPages[linkChoice];
    if (pick) { linkPage(pick); return; }
    const href = (linking ?? '').trim();
    setLinking(null);
    if (!href || !editor) return;
    const full = /^(https?:|mailto:)/i.test(href) ? href : `https://${href}`;
    const chain = editor.chain().focus();
    if (editor.state.selection.empty) chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href: full } }] }).run();
    else chain.extendMarkRange('link').setLink({ href: full }).run();
  };
  openPage.current = (pg) => { const found = docs.notebooks.flatMap((nb) => nb.pages).find((p) => p.path === pg); void docs.open(pg, found?.title ?? ''); };

  // Pictures and files, kept beside the document and put in where the cursor is.
  const picker = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { if (!note) return undefined; const t = window.setTimeout(() => setNote(null), 6000); return () => window.clearTimeout(t); }, [note]);
  const addFiles = async (files: File[]) => {
    const page = pathNow.current;
    const attach = own?.attach;
    if (!page || !attach || !files.length) return;
    setAdding((n) => n + files.length);
    const added: string[] = [];
    for (const file of files) {
      try {
        if (file.size > 20 * 1024 * 1024) { setNote(`${file.name} is too big to add (20 MB at most).`); continue; }
        const got = await attach(page, file.name || 'Pasted', await readFile(file));
        if ('ref' in got) added.push(fileMarkdown(got.ref, got.name, got.image));
        else setNote(`${file.name} could not be added: ${got.message}.`);
      } catch {
        setNote(`${file.name} could not be read.`);
      } finally {
        setAdding((n) => n - 1);
      }
    }
    if (added.length && pathNow.current === page && editor && !editor.isDestroyed) editor.chain().focus().insertContent(added.join('\n\n'), { contentType: 'markdown' }).run();
  };
  filesIn.current = (files) => void addFiles(files);

  // History, shown in place of the page; and the last restore, which can be undone.
  const [history, setHistory] = useState(false);
  const [restored, setRestored] = useState<{ was: string; label: string } | null>(null);
  useEffect(() => { setHistory(false); setRestored(null); }, [path]);
  const restore = (content: string, whenMs: number) => {
    const at = new Date(whenMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    setRestored({ was: docs.text, label: `${dayOf(whenMs, Date.now())}, ${at}` });
    docs.edit(content);
    setHistory(false);
  };

  const docTitle = () => liveTitle(docs.text, docs.page?.title || 'Document');
  const share = async (how: ShareHow) => {
    const page = pathNow.current;
    if (!page) return;
    if (how === 'markdown') { setNote((await copyText(docs.text)) ? 'Copied as Markdown.' : 'The document could not be copied.'); return; }
    if (how === 'formatted') { setNote((await copyFormatted(editor?.getHTML() ?? docs.text, docs.text)) ? 'Copied. It pastes with its formatting.' : 'The document could not be copied.'); return; }
    if (how === 'print') { window.requestAnimationFrame(() => window.print()); return; }
    const exportIt = own?.export;
    if (!exportIt) return;
    if (docs.status !== 'saved') await new Promise((r) => window.setTimeout(r, 900));
    const html = how === 'html' ? await pageAsHtml(docTitle(), editor?.getHTML() ?? '', page, 'docs') : undefined;
    const done = await exportIt(page, how, html).catch(() => ({ ok: false as const, message: 'it could not be saved' }));
    setNote('saved' in done ? `Saved to ${done.saved}.` : `The copy could not be saved: ${done.message}.`);
  };

  // Review of the agent's last turn, shown as proposals in the page.
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
      if (live) setKept(id !== null && keptTurns('docs').includes(id));
    };
    void check();
    window.addEventListener(KEPT_EVENT, check);
    return () => { live = false; window.removeEventListener(KEPT_EVENT, check); };
    // Checked again when the page changes: a new turn's change is not kept yet.
  }, [review?.conversation, path, docs.page?.base]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDiff(null); setBefore(null); setProblem(null); }, [path, review?.conversation]);
  const compare = (was: string | null, now: string): DiffLine[] => (was === null ? now.split('\n').map((text) => ({ kind: 'added' as const, text })) : diffLines(was, now));
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
  const reviewBar = useRef<HTMLDivElement>(null);
  const keepAll = async () => {
    if (!review) return;
    const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
    const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
    if (id) keepTurn(id, 'docs');
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
        <EmptyState app="docs" label="No document open" title={docs.notebooks.some((n) => n.pages.length) ? 'No document open' : 'No documents yet'} line="Choose one on the left, or start a new one." action={{ label: 'New document', run: () => newItemIn(docs, null, DOCS_WORDS.defaultGroup) }} />
        <EditorContent editor={editor} hidden />
      </section>
    );
  }
  const title = liveTitle(docs.text, docs.page.title || path?.split('/')[1]?.replace(/\.md$/, '') || '');
  // A document Mobius wrote from nothing is shown as the page itself, outlined, not as a list of added lines.
  const wholeNew = Boolean(review && !kept && diff && before === null);
  const showing = review && !kept && diff && !wholeNew;
  // Markdown as this editor would draw it, through its own schema, so nothing outside a document's own kinds of node shows.
  const renderMarkdown = (markdown: string): string | null => {
    if (!editor || editor.isDestroyed || !editor.markdown || !markdown.trim()) return null;
    try { return generateHTML(editor.markdown.parse(markdown), editor.extensionManager.extensions); } catch { return null; }
  };
  const saving = docs.status === 'saving' || docs.status === 'unsaved' ? 'Saving…' : docs.status === 'error' ? 'Not saved' : 'Saved';
  const margin = own && commentState.available && commentsOpen && commentState.comments.length > 0;
  return (
    <section ref={section} className="doc-editor" aria-label={`Document: ${title}`} data-margin={margin || undefined}>
      {docs.status === 'conflict' && (
        <div className="note-conflict" role="alert">
          <span>This document was changed somewhere else while you were editing it.</span>
          <button type="button" className="btn" onClick={() => void docs.resolve(false)}>Use that version</button>
          <button type="button" className="btn primary" onClick={() => void docs.resolve(true)}>Keep mine</button>
        </div>
      )}
      {editor && (
        <Toolbar editor={editor} busy={busy} {...(onTool ? { onTool } : {})} extras={{
          onLink: () => setLinking(''),
          ...(own?.attach ? { onFile: () => picker.current?.click() } : {}),
          ...(own?.versions ? { onHistory: () => setHistory(true) } : {}),
          ...(own ? { onShare: (how: ShareHow) => void share(how) } : {}),
          outline: outlineOpen, onOutline: toggleOutline,
          comments: openComments, commentsOpen: commentsOpen && commentState.comments.length > 0,
          ...(own && commentState.available ? { onComments: () => setCommentsOpen((o) => !o) } : {}),
        }} />
      )}
      <input ref={picker} type="file" multiple hidden onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; void addFiles(files); }} />
      {linking !== null && (
        <form className="doc-linkbar" onSubmit={addLink}>
          <input autoFocus aria-label="Link to" placeholder={own ? 'Paste a link, or type a document’s name' : 'Paste a link'} value={linking} role="combobox" aria-expanded={linkPages.length > 0} aria-controls="doc-link-pages" aria-activedescendant={linkPages[linkChoice] ? `doc-link-${linkChoice}` : undefined}
            onChange={(e) => setLinking(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); setLinking(null); editor?.commands.focus(); }
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setLinkChoice((c) => (linkPages.length ? (c + (e.key === 'ArrowDown' ? 1 : linkPages.length - 1)) % linkPages.length : 0)); }
            }} />
          <button type="button" className="btn" onClick={() => { setLinking(null); editor?.commands.focus(); }}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!linking.trim() && !linkPages.length}>Link</button>
          {linkPages.length > 0 && (
            <ul id="doc-link-pages" className="doc-link-pages" role="listbox" aria-label="Documents to link">
              {linkPages.map((pg, i) => (
                <li key={pg.path} id={`doc-link-${i}`} role="option" aria-selected={i === linkChoice} onPointerDown={(e) => e.preventDefault()} onClick={() => linkPage(pg)}>
                  <span>{pg.title}</span><span className="doc-link-folder">{pg.notebook}</span>
                </li>
              ))}
            </ul>
          )}
        </form>
      )}
      {history && path ? <NoteHistory path={path} text={docs.text} kind="docs" onRestore={restore} onClose={() => setHistory(false)} /> : (
        <div className="doc-body">
          {outlineOpen && (
            <nav className="doc-outline" aria-label="Outline">
              <span className="doc-outline-title">Outline</span>
              {outline.length === 0 && <span className="doc-outline-empty">Headings show here as you add them.</span>}
              {outline.map((h, i) => (
                <button key={`${h.pos}:${i}`} type="button" className="doc-outline-item" style={{ paddingLeft: 8 + (h.level - 1) * 12 }} data-level={h.level} aria-current={i === current || undefined}
                  onClick={() => { editor?.chain().focus().setTextSelection(h.pos + 1).scrollIntoView().run(); }}>{h.text || 'Untitled'}</button>
              ))}
            </nav>
          )}
          <div className="doc-scroll">
            {restored && (
              <div className="note-restored doc-banner" role="status">
                <span>Restored the version from {restored.label}.</span>
                <button type="button" className="review-btn" onClick={() => { docs.edit(restored.was); setRestored(null); }}>Undo</button>
                <button type="button" className="review-btn" aria-label="Dismiss" onClick={() => setRestored(null)}>OK</button>
              </div>
            )}
            {review && !kept && (
              <div ref={reviewBar} className="note-review doc-review" role="status">
                <span className="review-dot" aria-hidden="true" />
                <span className="note-review-text">{diff ? (() => { const c = diffCounts(diff); return wholeNew ? 'Mobius wrote this document in its last turn.' : `Mobius changed ${c.added + c.removed === 1 ? 'one line' : `${c.added + c.removed} lines`} here in its last turn.`; })() : 'Mobius changed this document in its last turn.'}<WhyThis conversation={review.conversation} /></span>
                <ReviewActions
                  onKeep={async () => { const page = reviewBar.current?.parentElement; await Promise.all([settleKept(reviewBar.current), settleKept(page?.querySelector('.doc-proposals'))]); await keepAll(); }}
                  onDiscard={async () => { const paper = reviewBar.current?.parentElement?.querySelector('.doc-sheet'); await Promise.all([settleGone(paper), settleGone(reviewBar.current?.parentElement?.querySelector('.doc-proposals'))]); await discardAll(); settleIn(paper); }} />
              </div>
            )}
            {problem && <p className="tasks-message" role="alert">{problem}</p>}
            {showing && <Proposals diff={diff} onDiscard={discardOne} render={renderMarkdown} />}
            <div className="doc-sheet" data-new={wholeNew || undefined}>
              <EditorContent editor={editor} className="doc-paper" onMouseUp={() => { if (editor) window.setTimeout(() => placeSelection(editor), 0); }}
                onContextMenu={(e) => { if (!editor) return; e.preventDefault(); setEditMenu({ x: e.clientX, y: e.clientY }); }} />
              {margin && (
                <aside className="doc-margin" aria-label="Comments on this document">
                  <CommentList state={commentState} text={editor?.state.doc.textContent ?? ''} onShow={showQuote} {...(askAbout ? { onAsk: askAbout } : {})} />
                </aside>
              )}
            </div>
          </div>
        </div>
      )}
      {selection && !history && (
        <div className="selection-bar doc-selection" role="toolbar" aria-label="Selected text" style={{ top: selection.top, left: selection.left }}>
          {own && commentState.available && (
            <button type="button" className="selection-btn" data-action="comment" title="Comment on these words" onPointerDown={keep}
              onClick={() => { setComposing({ quote: selection.text.trim(), top: selection.below, left: selection.left }); setCommentsOpen(true); setSelection(null); }}>Comment</button>
          )}
          <button type="button" className="selection-btn" title="Link these words to a web page or another document" onPointerDown={keep} onClick={() => { setLinking(''); setSelection(null); }}>Link</button>
          {onTool && (
            <>
              <span className="selection-sep" aria-hidden="true" />
              <button type="button" className="selection-btn" data-action="proofread" title="Have Mobius proofread these words" disabled={busy} onPointerDown={keep} onClick={() => { onTool('proofread', selection.text); setSelection(null); }}>Proofread</button>
              <button type="button" className="selection-btn" data-action="shorter" title="Have Mobius make these words shorter" disabled={busy} onPointerDown={keep} onClick={() => { onTool('shorter', selection.text); setSelection(null); }}>Shorter</button>
              <button type="button" className="selection-btn" data-action="friendlier" title="Have Mobius rewrite these words to sound friendlier" disabled={busy} onPointerDown={keep} onClick={() => { onTool('friendlier', selection.text); setSelection(null); }}>Friendlier</button>
            </>
          )}
        </div>
      )}
      {editMenu && createPortal(<ContextMenu x={editMenu.x} y={editMenu.y} label="Edit" items={editItems()} onClose={() => setEditMenu(null)} />, document.body)}
      {composing && <CommentComposer quote={composing.quote} top={composing.top} left={composing.left} add={commentState.add} onDone={() => setComposing(null)}
        {...(onTool ? { onAsk: (quote: string, text: string) => onTool('comment', commentLine({ id: '', quote, text, by: 'you', whenMs: 0, resolved: false }, [])) } : {})} />}
      {note && <div className="doc-toast" role="status"><span>{note}</span><button type="button" className="review-btn" onClick={() => setNote(null)}>OK</button></div>}
      <footer className="doc-status">
        <span>{chosenWords ? `${chosenWords} of ${stats.words} words` : stats.words === 1 ? '1 word' : `${stats.words} words`}</span>
        <span>{stats.characters === 1 ? '1 character' : `${stats.characters} characters`}</span>
        <span>{stats.minutes} min read</span>
        {adding > 0 && <span>Adding {adding === 1 ? 'a file' : `${adding} files`}…</span>}
        <span className="spacer" />
        <span className="doc-saved" data-state={docs.status}>{saving}</span>
      </footer>
    </section>
  );
}
