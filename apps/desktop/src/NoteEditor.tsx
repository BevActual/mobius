import { EmptyState } from './EmptyState';
import { openWebLink } from './web-link';
import { newItemIn } from './NotesSidebar';
import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { readBefore } from './readBefore';
import { useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Menu, PanelTab, ToolbarControls, UndoToast, useInspector } from './ui';
import { publishOutline, toHeading } from './docs-outline';
import { DocOutlinePanel } from './DocOutlinePanel';
import { settleGone, settleIn, settleKept } from './settle';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { FindMarks } from './doc-find';
import { DocFind, findKeyOf } from './DocFind';
import { Extension, generateHTML } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { BulletToTask } from './task-shortcut';
import { CheckedLast } from './checked-last';
import { Placeholder } from '@tiptap/extensions';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { loadIntoEditor } from './editor-load';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import { onCommand } from './commands';
import { liveTitle } from './notes-state';
import { changeGroups, diffCounts, diffLines, undoGroup, type DiffLine } from './line-diff';
import type { NotesState } from './useNotes';
import { CHECKLIST, TABLE, clipBlock, insertBlock, meetingAsk, meetingBlock, recordingBlock, tidyMarkdown } from './note-insert';
import { useMeeting } from './useMeeting';
import { useDictation } from './composer/useDictation';
import { ReviewActions, TryAnotherContext, WhyThis, useTurnAsk, whyLine } from './ReviewBar';
import { changeBlocks, useTallChanges, type ChangeView } from './change-blocks';
import { usePublishSuggestions } from './Comments';
import { acceptGroup } from './docs-view';
import { showTag, tagRanges, tagsIn } from './note-tags';
import { citedLines, takeCite } from './note-sources';
import { countWords } from './Docs';
import { relativeTime } from './relative-time';
import { timeLabel } from './dates';
import { NoteHistory, dayOf } from './NoteHistory';
import './notes.css';
import { CommentComposer, CommentList, useNoteComments } from './NoteComments';
import { copyFormatted, copyText, pageAsHtml } from './note-share';
import { fileMarkdown, noteImage, ownMarked, readFile } from './note-files';
import { KeptLink, keptMarkdown } from './note-kept';
import { linkTo, linkedFrom, pageOfLink, pagesMatching } from './note-links';
import { afterPaint } from './ui/frame';

/** How long a recording in a note may run: ten minutes. */
const NOTE_RECORDING_SECONDS = 600;

/** What you can do with text selected in a note, right where it is. */
export type SelectionAction = 'ask' | 'rewrite' | 'summarise' | 'task';
const ACTIONS: { id: SelectionAction; label: string; title: string }[] = [
  { id: 'ask', label: 'Ask', title: 'Ask Mobius about this' },
  { id: 'rewrite', label: 'Rewrite', title: 'Have Mobius rewrite this in the note' },
  { id: 'summarise', label: 'Summarise', title: 'Have Mobius summarise this' },
  { id: 'task', label: 'Make a task', title: 'Add this as a task' },
];

/** Whether notes open as their Markdown rather than as formatted text. Per device; formatted unless chosen. */
const SOURCE_KEY = 'mobius.notes.markdown';
const readSource = () => { try { return window.localStorage.getItem(SOURCE_KEY) === '1'; } catch { return false; } };
const keepSource = (on: boolean) => { try { window.localStorage.setItem(SOURCE_KEY, on ? '1' : '0'); } catch { /* Not kept. */ } };

/** The `#tags` in the note's text, marked so they read as tags; code is left alone. */
const tagKey = new PluginKey<DecorationSet>('note-tags');
function tagDecorations(doc: PmNode): DecorationSet {
  const marks: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (node.type.name === 'codeBlock') return false;
    if (!node.isText || !node.text || node.marks.some((m) => m.type.name === 'code' || m.type.name === 'link')) return true;
    if (parent?.type.name === 'heading' && parent.attrs.level === 1 && node.text.startsWith('#')) return true;
    for (const [from, to] of tagRanges(node.text)) marks.push(Decoration.inline(pos + from, pos + to, { class: 'note-tag', 'data-tag': node.text.slice(from + 1, to) }));
    return true;
  });
  return DecorationSet.create(doc, marks);
}
const NoteTags = Extension.create({
  name: 'noteTags',
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: tagKey,
      state: { init: (_, state) => tagDecorations(state.doc), apply: (tr, old) => (tr.docChanged ? tagDecorations(tr.doc) : old) },
      props: {
        decorations: (state) => tagKey.getState(state),
        // A tag clicked with Ctrl (or Cmd) shows every note with it; a plain click only puts the cursor there.
        handleClick: (_view, _pos, event) => {
          const el = (event.target as HTMLElement | null)?.closest<HTMLElement>('.note-tag');
          if (!el || !(event.ctrlKey || event.metaKey)) return false;
          showTag(el.dataset.tag ?? '');
          return true;
        },
      },
    })];
  },
});

/** The words that open comments are about, marked in the page. `quotes` is read when the plugin is told to look again. */
const commentKey = new PluginKey<DecorationSet>('note-comments');
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
const noteComments = (quotes: () => readonly string[]) => Extension.create({
  name: 'noteComments',
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

/** The lines a fact Mobius cited was taken from, tinted for a moment when the note is opened from its card. */
const citeKey = new PluginKey<DecorationSet>('note-cited');
const NoteCited = Extension.create({
  name: 'noteCited',
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: citeKey,
      state: {
        init: () => DecorationSet.empty,
        apply: (tr, old) => {
          const set = tr.getMeta(citeKey) as number[] | null | undefined;
          if (set === null) return DecorationSet.empty;
          if (set) return DecorationSet.create(tr.doc, set.map((pos) => Decoration.node(pos, pos + (tr.doc.nodeAt(pos)?.nodeSize ?? 0), { class: 'note-cited' })));
          return tr.docChanged ? DecorationSet.empty : old;
        },
      },
      props: { decorations: (state) => citeKey.getState(state) },
    })];
  },
});

/** The quiet line under the title, as in Docs ("Edited just now · 22 words · 1 comment · #tag"), drawn in the page
 *  after the first heading. Its tags are grey words that list the notes with that tag. Read from `look` when told. */
interface NoteMetaLine { parts: string[]; tags: string[]; onTag: (tag: string) => void }
const metaKey = new PluginKey<DecorationSet>('note-meta');
function noteMetaDecorations(doc: PmNode, look: () => NoteMetaLine | null): DecorationSet {
  const line = look();
  if (!line) return DecorationSet.empty;
  const first = doc.firstChild;
  const at = first && first.type.name === 'heading' && Number(first.attrs.level) === 1 ? first.nodeSize : 0;
  const draw = () => {
    const p = document.createElement('p');
    p.className = 'note-meta';
    p.contentEditable = 'false';
    for (const part of line.parts) { const span = document.createElement('span'); span.textContent = part; p.append(span); }
    if (line.tags.length) {
      const tags = document.createElement('span');
      tags.className = 'note-meta-tags';
      for (const tag of line.tags) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'note-meta-tag';
        b.title = `Show every note tagged #${tag}`;
        b.textContent = `#${tag}`;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => look()?.onTag(tag));
        tags.append(b);
      }
      p.append(tags);
    }
    return p;
  };
  return DecorationSet.create(doc, [Decoration.widget(at, draw, { side: -10, key: `note-meta:${line.parts.join('|')}:${line.tags.join(' ')}`, ignoreSelection: true, stopEvent: () => true })]);
}
const noteMeta = (look: () => NoteMetaLine | null) => Extension.create({
  name: 'noteMeta',
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: metaKey,
      state: {
        init: (_, state) => noteMetaDecorations(state.doc, look),
        apply: (tr, old) => (tr.docChanged || tr.getMeta(metaKey) ? noteMetaDecorations(tr.doc, look) : old),
      },
      props: { decorations: (state) => metaKey.getState(state) },
    })];
  },
});

const STYLES = [
  { id: 'p', label: 'Body' },
  { id: 'h1', label: 'Title' },
  { id: 'h2', label: 'Heading' },
  { id: 'h3', label: 'Subheading' },
] as const;

/** The styles in the Aa panel, in the order Apple Notes lists them: biggest first. */
const STYLES_SHOWN = [STYLES[1], STYLES[2], STYLES[3], STYLES[0]];

/** The Markdown the editor holds, written as people write it: one blank line between blocks, a newline at the end. */
const markdownOf = (e: Editor) => tidyMarkdown(e.getMarkdown());

/**
 * The tool row (the panel look, docs/design/reviews/panel-look/notes.md A1): centred in the window's toolbar, the
 * familiar writing tools as icons with their names and keys in the tooltip. Undo and redo, the text style (Title,
 * Heading, Subheading, Body, Mono, with the rarer marks and lists under it), bold, italic, checklist, list, link,
 * table, attach. The buttons show as pressed what the cursor is in. Off in Markdown, where the marks are typed.
 */
const TABLE_ICON = <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.5" y="4.5" width="13" height="11" rx="1.5" /><path d="M3.5 8.5h13M3.5 12h13M8 4.5v11M12 4.5v11" /></svg>;
const ATTACH_ICON = <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m15.5 9.5-5.6 5.6a3.5 3.5 0 0 1-5-5l6-6a2.3 2.3 0 0 1 3.3 3.3l-6 6a1.2 1.2 0 0 1-1.7-1.7l5.4-5.4" /></svg>;
const MOD = () => (window.mobius.platform === 'darwin' ? 'Cmd' : 'Ctrl');
/** What the style menu's button says: the style the cursor is in. */
const STYLE_NAMES: Record<string, string> = { h1: 'Title', h2: 'Heading', h3: 'Subheading', p: 'Body', mono: 'Mono' };

function FormatButtons({ editor, onLink, onAttach, table }: { editor: Editor; onLink: () => void; onAttach: (() => void) | null; table: () => void }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: e.isActive('heading', { level: 1 }) ? 'h1' : e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : e.isActive('codeBlock') ? 'mono' : 'p',
      bold: e.isActive('bold'), italic: e.isActive('italic'), strike: e.isActive('strike'), code: e.isActive('code'), link: e.isActive('link'),
      bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), task: e.isActive('taskList'), quote: e.isActive('blockquote'), table: e.isActive('table'),
      undo: e.can().undo(), redo: e.can().redo(),
    }),
  });
  const run = (f: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => () => { f(editor.chain().focus()).run(); };
  const setStyle = (id: string) => () => {
    const chain = editor.chain().focus();
    if (id === 'p') chain.setParagraph().run();
    else if (id === 'mono') chain.setCodeBlock().run();
    else chain.setHeading({ level: Number(id.slice(1)) as 1 | 2 | 3 }).run();
  };
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  const mod = MOD();
  return (
    <>
      <span className="note-tool-group" role="group" aria-label="History">
        <button type="button" className="doc-tool" aria-label="Undo" title={`Undo (${mod}+Z)`} disabled={!state.undo} onPointerDown={keep} onClick={run((c) => c.undo())}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 6 4 9.5 7.5 13M4.5 9.5H12a4 4 0 0 1 0 8h-2" /></svg>
        </button>
        <button type="button" className="doc-tool" aria-label="Redo" title={`Redo (${mod}+Shift+Z)`} disabled={!state.redo} onPointerDown={keep} onClick={run((c) => c.redo())}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 6 16 9.5 12.5 13M15.5 9.5H8a4 4 0 0 0 0 8h2" /></svg>
        </button>
      </span>
      <Menu label="Text style" entries={[
        ...STYLES_SHOWN.map((st) => ({ label: STYLE_NAMES[st.id]!, checked: state.style === st.id, run: setStyle(st.id) })),
        { label: 'Mono', checked: state.style === 'mono', run: setStyle('mono') },
        { label: 'Strikethrough', checked: state.strike, run: run((c) => c.toggleStrike()), separated: true },
        { label: 'Code', checked: state.code, run: run((c) => c.toggleCode()) },
        { label: 'Numbered list', checked: state.ordered, run: run((c) => c.toggleOrderedList()) },
        { label: 'Quote', checked: state.quote, run: run((c) => c.toggleBlockquote()) },
      ]} trigger={
        <button type="button" className="doc-tool text note-style-btn" aria-label={`Text style: ${STYLE_NAMES[state.style]}`} title="Text style">
          <span>{STYLE_NAMES[state.style]}</span>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6.5 8.5 3.5 3.5 3.5-3.5" /></svg>
        </button>
      } />
      <span className="note-tool-group" role="group" aria-label="Marks">
        <button type="button" className="doc-tool" aria-label="Bold" aria-pressed={state.bold} title={`Bold (${mod}+B)`} onPointerDown={keep} onClick={run((c) => c.toggleBold())}><b>B</b></button>
        <button type="button" className="doc-tool" aria-label="Italic" aria-pressed={state.italic} title={`Italic (${mod}+I)`} onPointerDown={keep} onClick={run((c) => c.toggleItalic())}><i>I</i></button>
      </span>
      <span className="note-tool-group" role="group" aria-label="Blocks">
        <button type="button" className="doc-tool" aria-label="Checklist" aria-pressed={state.task} title={`Checklist (${mod}+Shift+9)`} onPointerDown={keep} onClick={run((c) => c.toggleTaskList())}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5.5" cy="6" r="2.2" /><path d="m4.4 6 .8.8 1.4-1.6" /><circle cx="5.5" cy="13.5" r="2.2" /><path d="M10 6h6.5M10 13.5h6.5" /></svg>
        </button>
        <button type="button" className="doc-tool" aria-label="Bulleted list" aria-pressed={state.bullet} title={`Bulleted list (${mod}+Shift+8)`} onPointerDown={keep} onClick={run((c) => c.toggleBulletList())}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="6" r="1" /><circle cx="5" cy="10" r="1" /><circle cx="5" cy="14" r="1" /><path d="M8.5 6h7M8.5 10h7M8.5 14h7" /></svg>
        </button>
        <button type="button" className="doc-tool" aria-label="Link" aria-pressed={state.link} title={state.link ? 'Remove link' : `Link (${mod}+K)`} onPointerDown={keep} onClick={() => (state.link ? editor.chain().focus().unsetLink().run() : onLink())}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.5-2.5a3 3 0 0 0-4.2-4.2l-.8.8M11.5 8.5a3 3 0 0 0-4.2 0L4.8 11a3 3 0 0 0 4.2 4.2l.8-.8" /></svg>
        </button>
        {/* While the caret is in a table, its rows and columns are under the same button (as in Docs). */}
        {state.table ? (
          <Menu label="Table" entries={[
            { label: 'Add a row above', run: run((c) => c.addRowBefore()) },
            { label: 'Add a row below', run: run((c) => c.addRowAfter()) },
            { label: 'Add a column before', run: run((c) => c.addColumnBefore()) },
            { label: 'Add a column after', run: run((c) => c.addColumnAfter()) },
            { label: 'Delete the row', run: run((c) => c.deleteRow()), separated: true },
            { label: 'Delete the column', run: run((c) => c.deleteColumn()) },
            { label: 'Delete the table', run: run((c) => c.deleteTable()), danger: true },
          ]} trigger={<button type="button" className="doc-tool" aria-label="Table" aria-pressed title="Table">{TABLE_ICON}</button>} />
        ) : (
          <button type="button" className="doc-tool" aria-label="Table" title="Table" onPointerDown={keep} onClick={table}>{TABLE_ICON}</button>
        )}
        {onAttach && <button type="button" className="doc-tool" aria-label="Attach" title="Attach a picture or file" onPointerDown={keep} onClick={onAttach}>{ATTACH_ICON}</button>}
      </span>
    </>
  );
}

/** Where the title of a page that is nothing but "# Untitled" is, to choose it; null for any other page. */
export function untitledHeading(editor: Editor): { from: number; to: number } | null {
  const doc = editor.state.doc;
  const first = doc.firstChild;
  if (!first || first.type.name !== 'heading' || first.textContent.trim() !== 'Untitled') return null;
  if (doc.textContent.trim() !== first.textContent.trim()) return null;
  return { from: 1, to: 1 + first.content.size };
}

/**
 * The open page, saved as you type. It shows as formatted text (headings, lists, checklists you tick, tables, #tags)
 * and is kept as plain Markdown, so the file opens anywhere and the agent's file tools read it as it is. The
 * Markdown button shows the file itself to type in. A page the assistant changed meanwhile is never overwritten.
 * `autoFocus` is off when the page opens in the pane beside the one you are working in, so typing stays where it was.
 * `review`: the agent's last turn changed this page; the editor offers to show what changed and to put it back.
 */
export function NoteEditor({ notes, autoFocus = true, onSelection, onAsk, recordToken = 0, review, working = false }: { notes: NotesState; /** Changed to start recording a meeting into the open page (Calendar's Record meeting). */ recordToken?: number; autoFocus?: boolean; onSelection?: (action: SelectionAction, text: string) => void; /** Puts a message in Mobius's box, ready to send: after a meeting, the summary and actions. */ onAsk?: (prompt: string) => void; /** Mobius's turn is still running: its changes show as they come, and their answers wait for the end. */ working?: boolean; review?: { conversation: string } | null }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const section = useRef<HTMLElement>(null);
  const path = notes.page?.path;
  const focusOnOpen = useRef(autoFocus);
  focusOnOpen.current = autoFocus;
  const [source, setSource] = useState(readSource);
  // Find (Ctrl+F) and Replace (Ctrl+H) in the page; not in the Markdown source, which is a plain text area.
  const [finding, setFinding] = useState<{ replacing: boolean; token: number } | null>(null);
  const sourceNow = useRef(source);
  sourceNow.current = source;
  // The selection bar sits just above the selection.
  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null);
  const barShown = useRef(false);
  barShown.current = selection !== null;
  const selectionFor = useRef(onSelection);
  selectionFor.current = onSelection;

  // The Markdown the editor last gave or was given, so a change from elsewhere is told from the person's typing.
  const known = useRef<string | null>(null);
  // The open page, for pictures to be read from its files folder; and files pasted or dropped on it.
  const pathNow = useRef(path);
  pathNow.current = path;
  // The open page's text now, for words that arrive later (dictation, a clip, a meeting) from an older render.
  const textNow = useRef(notes.text);
  textNow.current = notes.text;
  const filesIn = useRef<(files: File[]) => void>(() => undefined);
  // A link to another note opens it; typing [[ asks which note to link.
  const openPage = useRef<(page: string) => void>(() => undefined);
  const askForPage = useRef<() => void>(() => undefined);
  const image = useMemo(() => noteImage(() => pathNow.current), []);
  // Comments on the page, kept beside it; the words they are about are marked in the page.
  const commentState = useNoteComments(path);
  const inspector = useInspector();
  // A new comment opens the Comments panel, where it is kept.
  const addComment: typeof commentState.add = async (...args) => { const ok = await commentState.add(...args); if (ok) inspector.show('comments'); return ok; };
  const quotesNow = useRef<string[]>([]);
  quotesNow.current = commentState.comments.filter((c) => !c.resolved).map((c) => c.quote);
  const commentMarks = useMemo(() => noteComments(() => quotesNow.current), []);
  // What Mobius's last turn changed, drawn in the page as dashed blocks to keep or discard one at a time (as in Docs).
  const changesNow = useRef<ChangeView | null>(null);
  const changeMarks = useMemo(() => changeBlocks(() => changesNow.current), []);
  const metaNow = useRef<NoteMetaLine | null>(null);
  const metaMark = useMemo(() => noteMeta(() => metaNow.current), []);
  const tryAnother = useContext(TryAnotherContext);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  // The page already read when the editor is made is its first content, parsed once: made empty and then filled, the
  // editor drew the page twice and laid it out three times on every visit to Notes.
  const firstText = useRef<string | null>(null);
  if (firstText.current === null) {
    firstText.current = !source && path ? notes.text : '';
    if (firstText.current) known.current = firstText.current;
  }
  const editor = useEditor({
    extensions: [
      // StarterKit's link, written back with angle brackets round an address with a space (note-kept).
      StarterKit.configure({ link: false }),
      KeptLink.configure({ openOnClick: false, autolink: true }),
      // Front matter, footnotes, HTML and link definitions from other apps, kept as written.
      ...keptMarkdown,
      TableKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      BulletToTask,
      CheckedLast,
      // A Markdown reader of its own: the shared one keeps every editor's tokenizers, and with them every editor that
      // was ever open (about 100 DOM nodes a visit to Docs in the speed test).
      Markdown.configure({ marked: ownMarked() }),
      // The hints are for a page still to be written: an empty title, and the first line under it. A page with words
      // in it shows none, so the empty line kept at its end does not read as a prompt.
      Placeholder.configure({ placeholder: ({ editor: e, node, pos }) => (node.type.name === 'heading' ? (pos === 0 ? 'Title' : '') : e.state.doc.childCount <= 2 ? 'Start writing, or type # for a tag' : '') }),
      NoteTags,
      image,
      commentMarks,
      changeMarks,
      metaMark,
      FindMarks,
      NoteCited,
    ],
    content: firstText.current,
    contentType: 'markdown',
    editorProps: {
      attributes: { class: 'note-page', 'aria-label': 'Note text', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true' },
      // Esc puts away the bar over the chosen words, as in Docs and Google Docs; the words stay chosen. Only then is it
      // taken here: with no bar, Esc goes on as before.
      handleKeyDown: (_view, event) => {
        if (event.key !== 'Escape' || !barShown.current) return false;
        setSelection(null);
        return true;
      },
      // Files pasted or dropped on the page are added to it: pictures show, anything else is a link.
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (!files.length) return false;
        filesIn.current(files);
        return true;
      },
      handleTextInput: (view, from, to, text) => {
        if (text !== '[' || from < 1 || view.state.doc.textBetween(from - 1, from) !== '[') return false;
        view.dispatch(view.state.tr.delete(from - 1, to));
        askForPage.current();
        return true;
      },
      handleClick: (_view, _pos, event) => {
        const a = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]');
        const href = a?.getAttribute('href') ?? '';
        // A web link shows in the Browser, in its tab if it has one; with Ctrl it opens there and you stay here. (A link
        // to one of your pages from an earlier start goes where it is now.)
        if (/^https?:\/\//i.test(href)) {
          event.preventDefault();
          openWebLink(href, event.ctrlKey || event.metaKey);
          return true;
        }
        const page = a && pathNow.current ? pageOfLink(href, pathNow.current) : null;
        if (!page) return false;
        event.preventDefault();
        openPage.current(page);
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
    },
    onUpdate: ({ editor: e, transaction }) => {
      // A transaction that changed nothing itself, only what the editor added after it (its empty last line when a
      // page opens), is not an edit: saving it would write the page out again in the editor's own way.
      if (transaction.getMeta('mobius-load') || !transaction.docChanged) return;
      const md = markdownOf(e);
      known.current = md;
      notes.edit(md);
    },
    onSelectionUpdate: ({ editor: e }) => {
      const { from, to, empty } = e.state.selection;
      const box = section.current?.getBoundingClientRect();
      const text = empty ? '' : e.state.doc.textBetween(from, to, '\n');
      if (!selectionFor.current || !box || text.trim().length < 2 || !e.isFocused) { setSelection(null); return; }
      const at = e.view.coordsAtPos(from);
      // Above the start of the selection, so the bar never covers what was chosen; kept inside the page.
      setSelection({ text, top: Math.max(8, at.top - box.top - 44), left: Math.min(Math.max(8, at.left - box.left - 40), Math.max(8, box.width - 340)) });
    },
    onBlur: () => setSelection(null),
    // Clicked into from a text box (Mobius's message box, say), the page has the focus a moment before the browser's
    // caret follows it: keys typed in that moment went to where the caret still was, and were lost. The caret is put
    // in the page at once.
    onFocus: ({ editor: e }) => {
      const at = window.getSelection()?.anchorNode;
      if (!at || !e.view.dom.contains(at)) e.view.focus();
    },
  });
  // The page's text, from the store: put into the editor when it did not come from the editor itself.
  const placed = useRef<string | null>(firstText.current ? path ?? null : null);
  useEffect(() => {
    if (!editor || editor.isDestroyed || source || notes.text === known.current) return;
    known.current = notes.text;
    loadIntoEditor(editor, notes.text, placed.current !== (path ?? null));
    placed.current = path ?? null;
  }, [editor, notes.text, path, source]);
  // Opened from a fact Mobius took from this note: the lines it came from are tinted and brought into view.
  useEffect(() => {
    if (!editor || editor.isDestroyed || source || !path || placed.current !== path || !notes.text) return;
    const fact = takeCite(path);
    if (!fact) return;
    const blocks: { pos: number; text: string }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      // The title names the note, it is not where a fact comes from.
      if (!(pos === 0 && node.type.name === 'heading')) blocks.push({ pos, text: node.textContent });
      return false;
    });
    const at = citedLines(blocks.map((b) => b.text), fact).map((i) => blocks[i]!.pos);
    if (!at.length) return;
    editor.view.dispatch(editor.state.tr.setMeta(citeKey, at));
    afterPaint(() => { if (!editor.isDestroyed) (editor.view.nodeDOM(at[0]!) as HTMLElement | null)?.scrollIntoView?.({ block: 'center' }); });
    const t = window.setTimeout(() => { if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(citeKey, null)); }, 2000);
    return () => window.clearTimeout(t);
  }, [editor, notes.text, path, source]);
  // A page opened from the list takes the cursor, at its end (a new page: under its title).
  useEffect(() => {
    if (!path || !focusOnOpen.current) return;
    if (sourceNow.current) area.current?.focus();
    else afterPaint(() => {
      if (!editor || editor.isDestroyed) return;
      // A new page: its title is chosen, so what is typed first names it.
      const at = untitledHeading(editor);
      if (at) editor.chain().focus().setTextSelection(at).run();
      else editor.commands.focus('end');
    });
  }, [path, editor]);
  useEffect(() => setSelection(null), [path, source]);
  const quoteKey = quotesNow.current.join('\u0000');
  useEffect(() => { if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(commentKey, true)); }, [editor, quoteKey]);
  // Writing a comment on the chosen words, where they are.
  const [composing, setComposing] = useState<{ quote: string; top: number; left: number } | null>(null);
  useEffect(() => setComposing(null), [path]);
  const showQuote = (quote: string) => {
    if (!editor || editor.isDestroyed || sourceNow.current) return;
    let found: { from: number; to: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found) return false;
      if (!node.isTextblock) return true;
      const at = node.textContent.indexOf(quote);
      if (at >= 0) found = { from: pos + 1 + at, to: pos + 1 + at + quote.length };
      return false;
    });
    if (!found) return;
    editor.chain().focus().setTextSelection(found).scrollIntoView().run();
  };
  // Share: copy the page, save a copy in Exports, or print it (and so save it as a PDF).
  const [shared, setShared] = useState<string | null>(null);
  useEffect(() => { setShared(null); }, [path]);
  useEffect(() => { if (!shared) return; const t = window.setTimeout(() => setShared(null), 6000); return () => window.clearTimeout(t); }, [shared]);
  const pageTitle = () => liveTitle(notes.text, notes.page?.title || 'Note');
  const share = async (how: 'markdown' | 'formatted' | 'html' | 'md' | 'print') => {
    const page = pathNow.current;
    if (!page) return;
    if (how === 'markdown') { setShared((await copyText(notes.text)) ? 'Copied as Markdown.' : 'The note couldn’t be copied.'); return; }
    if (how === 'formatted') { setShared((await copyFormatted(editor?.getHTML() ?? notes.text, notes.text)) ? 'Copied as formatted text.' : 'The note couldn’t be copied.'); return; }
    if (how === 'print') { afterPaint(() => window.print()); return; }
    const exportIt = window.mobius.notes?.export;
    if (!exportIt) return;
    if (notes.status !== 'saved') await new Promise((r) => window.setTimeout(r, 900));
    const html = how === 'html' ? await pageAsHtml(pageTitle(), editor?.getHTML() ?? '', page) : undefined;
    const done = await exportIt(page, how, html).catch(() => ({ ok: false as const, message: 'it could not be saved' }));
    setShared('saved' in done ? `Saved to ${done.saved}.` : `The copy could not be saved: ${done.message}.`);
  };
  // A page that opens settles in (see notes.css; off with reduced motion).
  const [entering, setEntering] = useState(false);
  useEffect(() => { if (path) setEntering(true); }, [path]);
  const toggleSource = () => {
    const next = !source;
    setSource(next);
    keepSource(next);
    if (!next) known.current = null; // the editor reads the Markdown again, with what was typed in it
    afterPaint(() => { if (next) area.current?.focus(); else editor?.commands.focus(); });
  };

  // Where the cursor was last in the Markdown, so Insert puts things there even after its button took the focus.
  const caret = useRef<number | null>(null);
  useEffect(() => { caret.current = null; }, [path]);
  const [clipping, setClipping] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  // Where [[ was typed (in the window), for the note picker to open there rather than above the page.
  const [linkAt, setLinkAt] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => { if (linking === null) setLinkAt(null); }, [linking]);
  // A click anywhere else closes it, as it would a menu.
  useEffect(() => {
    if (!linkAt) return undefined;
    const away = (e: PointerEvent) => { if (!(e.target instanceof Element && e.target.closest('.note-link-float'))) setLinking(null); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [linkAt]);
  const [insertProblem, setInsertProblem] = useState<string | null>(null);
  const recordedFor = useRef(0);
  /** A block of Markdown put in where the cursor is. `forPage`: the page it was started on, when it arrives later
   *  (dictation, a clip); if another page is open by then, it is copied instead of going into the wrong one. */
  const put = (text: string, forPage?: string | null) => {
    if (forPage !== undefined && pathNow.current !== forPage) {
      void navigator.clipboard?.writeText(text).catch(() => undefined);
      setInsertProblem('Another note was open by the time it was ready, so it was copied instead. Paste it where it belongs.');
      return;
    }
    if (!sourceNow.current && editor && !editor.isDestroyed) {
      editor.chain().focus().insertContent(text, { contentType: 'markdown' }).run();
      return;
    }
    const field = area.current;
    const at = field && document.activeElement === field ? field.selectionStart : caret.current ?? textNow.current.length;
    const done = insertBlock(textNow.current, at, text);
    notes.edit(done.page);
    caret.current = done.cursor;
    afterPaint(() => { const f = area.current; if (f) { f.focus(); f.setSelectionRange(done.cursor, done.cursor); } });
  };
  // Files added to the page: kept beside it, then put in where the cursor is.
  const picker = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(0);
  const addFiles = async (files: File[]) => {
    const page = pathNow.current;
    const attach = window.mobius.notes?.attach;
    if (!page || !attach || !files.length) return;
    setInsertProblem(null);
    setAdding((n) => n + files.length);
    const added: string[] = [];
    for (const file of files) {
      try {
        if (file.size > 20 * 1024 * 1024) { setInsertProblem(`${file.name} is too big to add (20 MB at most).`); continue; }
        const got = await attach(page, file.name || 'Pasted', await readFile(file));
        if ('ref' in got) added.push(fileMarkdown(got.ref, got.name, got.image));
        else setInsertProblem(`${file.name} could not be added: ${got.message}.`);
      } catch {
        setInsertProblem(`${file.name} could not be read.`);
      } finally {
        setAdding((n) => n - 1);
      }
    }
    if (added.length && pathNow.current === page) put(added.join('\n\n'));
  };
  filesIn.current = (files) => void addFiles(files);
  // The page dictation started on: its words go there, or are copied if another page is open when they come back.
  const dictatingFor = useRef<string | null>(null);
  const recording = useDictation((words) => put(recordingBlock(words, recordedFor.current), dictatingFor.current), NOTE_RECORDING_SECONDS);
  recordedFor.current = recording.seconds;
  const dictate = () => { if (recording.state === 'idle') dictatingFor.current = pathNow.current ?? null; recording.toggle(); };
  // A meeting: heard in parts for as long as it runs, its words put in the page it started on, then offered to Mobius.
  const meetingPage = useRef<string | null>(null);
  const [meetingDone, setMeetingDone] = useState<{ path: string; title: string } | null>(null);
  const meeting = useMeeting((said, seconds, started) => {
    const page = meetingPage.current;
    meetingPage.current = null;
    const block = meetingBlock(said, seconds, started);
    if (!page || pathNow.current !== page) {
      void navigator.clipboard?.writeText(block).catch(() => undefined);
      setInsertProblem('Another note was open when the meeting ended, so its words were copied instead. Paste them where they belong.');
      return;
    }
    if (sourceNow.current || !editor || editor.isDestroyed) notes.edit(insertBlock(textNow.current, textNow.current.length, block).page);
    else editor.chain().focus('end').insertContent(block, { contentType: 'markdown' }).run();
    setMeetingDone({ path: page, title: liveTitle(textNow.current, page.split('/').pop()?.replace(/\.md$/, '') ?? 'Note') });
  });
  useEffect(() => { setMeetingDone((m) => (m && m.path !== path ? null : m)); }, [path]);
  const startMeeting = () => { meetingPage.current = pathNow.current ?? null; setMeetingDone(null); meeting.start(); };
  const startLatest = useRef(startMeeting);
  startLatest.current = startMeeting;
  useEffect(() => { if (recordToken && pathNow.current && meeting.state === 'idle' && recording.state === 'idle') startLatest.current(); }, [recordToken]); // eslint-disable-line react-hooks/exhaustive-deps
  const clip = async (url: string) => {
    const address = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    const page = pathNow.current ?? null;
    const got = await window.mobius.reading?.fetch(address);
    if (!got) { setInsertProblem('Clipping is not available here.'); return; }
    if (!got.ok) { setInsertProblem(`That page could not be clipped: ${got.message}.`); return; }
    setClipping(null);
    setInsertProblem(null);
    put(clipBlock(got), page);
  };
  const addLink = (event: FormEvent) => {
    event.preventDefault();
    const href = (linking ?? '').trim();
    const full = /^(https?:|mailto:)/i.test(href) ? href : `https://${href}`;
    setLinking(null);
    if (!href || !editor) return;
    const chain = editor.chain().focus();
    if (editor.state.selection.empty) chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href: full } }] }).run();
    else chain.extendMarkRange('link').setLink({ href: full }).run();
  };
  // History, shown in place of the page; and the last restore, which can be undone.
  const [history, setHistory] = useState(false);
  const [restored, setRestored] = useState<{ was: string; label: string } | null>(null);
  useEffect(() => { setHistory(false); setRestored(null); }, [path]);
  const restore = (content: string, whenMs: number) => {
    const at = timeLabel(whenMs);
    setRestored({ was: notes.text, label: `${dayOf(whenMs, Date.now())}, ${at}` });
    notes.edit(content);
    setHistory(false);
  };
  // Linking another note: the Link field lists the notes whose title has what was typed.
  const [linkChoice, setLinkChoice] = useState(0);
  const looksLikeAddress = (t: string) => /^(https?:|mailto:|www\.)|\.[a-z]{2,}(\/|$)/i.test(t.trim());
  const linkPages = useMemo(() => (linking === null || looksLikeAddress(linking) ? [] : pagesMatching(notes.notebooks, linking, path, 6)), [linking, notes.notebooks, path]);
  useEffect(() => setLinkChoice(0), [linking]);
  const linkPage = (page: { path: string; title: string }) => {
    setLinking(null);
    if (!editor || !path) return;
    const href = linkTo(path, page.path);
    const chain = editor.chain().focus();
    if (editor.state.selection.empty) chain.insertContent({ type: 'text', text: page.title, marks: [{ type: 'link', attrs: { href } }] }).run();
    else chain.extendMarkRange('link').setLink({ href }).run();
  };
  openPage.current = (page) => { const found = notes.notebooks.flatMap((nb) => nb.pages).find((pg) => pg.path === page); void notes.open(page, found?.title ?? ''); };
  askForPage.current = () => {
    const at = editor?.view.coordsAtPos(editor.state.selection.from);
    setLinkAt(at ? { left: Math.max(8, Math.min(at.left, window.innerWidth - 340)), top: at.bottom + 6 } : null);
    setLinking('');
  };
  const linkForm = linking === null ? null : (
            <form className={`note-clip note-link-form${linkAt ? ' note-link-float' : ''}`} style={linkAt ? { left: linkAt.left, top: linkAt.top } : undefined} onSubmit={(e) => { const pick = linkPages[linkChoice]; if (pick) { e.preventDefault(); linkPage(pick); } else addLink(e); }}>
              <input autoFocus aria-label="Link to" placeholder="A note's name, or paste a link" value={linking} role="combobox" aria-expanded={linkPages.length > 0} aria-controls="note-link-pages" aria-activedescendant={linkPages[linkChoice] ? `note-link-${linkChoice}` : undefined}
                onChange={(e) => setLinking(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setLinking(null); setLinkAt(null); editor?.commands.focus(); }
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setLinkChoice((c) => (linkPages.length ? (c + (e.key === 'ArrowDown' ? 1 : linkPages.length - 1)) % linkPages.length : 0)); }
                }} />
              <button type="submit" className="btn" disabled={!linking.trim() && !linkPages.length}>Link</button>
              {linkPages.length > 0 && (
                <ul id="note-link-pages" className="note-link-pages" role="listbox" aria-label="Notes to link">
                  {linkPages.map((pg, i) => (
                    <li key={pg.path} id={`note-link-${i}`} role="option" aria-selected={i === linkChoice} onPointerDown={(e) => e.preventDefault()} onClick={() => linkPage(pg)}>
                      <span className="note-link-title">{pg.title}</span>
                      <span className="note-link-book">{pg.notebook}</span>
                    </li>
                  ))}
                </ul>
              )}
            </form>
  );
  const backlinks = useMemo(() => (path ? linkedFrom(notes.notebooks, path) : []), [notes.notebooks, path]);
  const [linkedOpen, setLinkedOpen] = useState(false);
  useEffect(() => setLinkedOpen(false), [path]);
  // What the last turn changed on this page, line by line, read only while it is shown.
  const [diff, setDiff] = useState<DiffLine[] | null>(null);
  // The page as it was before the turn; null when the turn made the page.
  const [before, setBefore] = useState<string | null>(null);
  const [reviewProblem, setReviewProblem] = useState<string | null>(null);
  // Keep here keeps the turn's notes; the strip under the conversation keeps the whole turn. A kept page shows no bar.
  const [kept, setKept] = useState(false);
  useEffect(() => {
    let live = true;
    const check = async () => {
      if (!review) { setKept(false); return; }
      const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
      const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
      if (live) setKept(id !== null && keptTurns('notes').includes(id));
    };
    void check();
    window.addEventListener(KEPT_EVENT, check);
    return () => { live = false; window.removeEventListener(KEPT_EVENT, check); };
    // Checked again when the page changes: a new turn's change is not kept yet.
  }, [review?.conversation, path, notes.page?.base]); // eslint-disable-line react-hooks/exhaustive-deps
  const reviewBar = useRef<HTMLDivElement>(null);
  const keepChanges = async () => {
    if (!review) return;
    const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
    const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
    if (id) keepTurn(id, 'notes');
    setDiff(null);
    setChanges(null);
    setKept(true);
  };
  // The turn's changes as the page shows them, read when the page opens: the page before the turn, and the lines since.
  const [changes, setChanges] = useState<DiffLine[] | null>(null);
  const [was, setWas] = useState<string | null>(null);
  useEffect(() => { setDiff(null); setBefore(null); setReviewProblem(null); setChanges(null); setWas(null); }, [path, review?.conversation]);
  const compare = (was: string | null, now: string): DiffLine[] => (was === null ? now.split('\n').map((text) => ({ kind: 'added' as const, text })) : diffLines(was, now));
  const showChanges = async () => {
    if (!review || !path) return;
    const before = await window.mobius.changes.before(review.conversation, `notes/${path}`).catch(() => null);
    if (!before || !before.ok) { setReviewProblem(before && !before.ok ? before.error : 'The earlier version could not be read.'); return; }
    setBefore(before.text);
    setDiff(compare(before.text, notes.text));
  };
  // One change put back; the rest of the turn's changes stay. Saved like any edit of yours, so it can be typed over.
  const undoOne = (group: number) => {
    if (!diff) return;
    const next = undoGroup(diff, group);
    notes.edit(next);
    const rest = compare(before, next);
    setDiff(rest.some((line) => line.kind !== 'same') ? rest : null);
  };
  // While the turn runs they are worked out again each time Mobius's change reloads the page.
  useEffect(() => {
    if (!review || kept || !path || (changes && !working)) return undefined;
    return readBefore(review.conversation, `notes/${path}`, (text) => {
      // A page the turn made has nothing to compare with: it keeps the bar above it.
      if (text === null) return;
      setWas(text);
      const d = diffLines(text, notes.text);
      if (d.some((l) => l.kind !== 'same')) setChanges(d);
    });
  }, [review?.conversation, kept, path, working ? notes.page?.base : null]); // eslint-disable-line react-hooks/exhaustive-deps
  // After the turn, the page read again (a step of it put back by its Undo) is compared again with the page before it:
  // what was put back stops showing as Mobius's, and with nothing left the review goes.
  const reckoned = useRef(notes.reloads);
  useEffect(() => {
    if (reckoned.current === notes.reloads) return;
    reckoned.current = notes.reloads;
    if (working || was === null || !changes) return;
    const d = diffLines(was, notes.text);
    setChanges(d.some((l) => l.kind !== 'same') ? d : null);
  }, [notes.reloads]); // eslint-disable-line react-hooks/exhaustive-deps
  // One change kept takes it into "before", so it stops showing; one discarded is put back. The last one settles the turn.
  const lastChange = (lines: DiffLine[]) => new Set(changeGroups(lines).filter((g) => g !== null)).size <= 1;
  const keepOne = (group: number) => {
    if (!changes || was === null) return;
    const next = acceptGroup(changes, changeGroups(changes), group);
    setWas(next);
    const rest = diffLines(next, notes.text);
    if (lastChange(changes) || !rest.some((l) => l.kind !== 'same')) void keepChanges(); else setChanges(rest);
  };
  const discardOne = (group: number) => {
    if (!changes || was === null) return;
    const next = undoGroup(changes, group);
    notes.edit(next);
    const rest = diffLines(was, next);
    if (lastChange(changes) || !rest.some((l) => l.kind !== 'same')) void keepChanges(); else setChanges(rest);
  };
  const showingChanges = Boolean(review && !kept && changes && was !== null && !source && diff === null);
  // Mobius's open suggestions here count on the window's Comments badge.
  usePublishSuggestions(review ? 'notes' : null, showingChanges && changes ? new Set(changeGroups(changes).filter((g) => g !== null)).size : review && !kept && diff ? 1 : 0);
  // What was asked, for each change bar's Why.
  const ask = useTurnAsk(review && !kept ? review.conversation : null, path ? `notes/${path}` : undefined);
  const changesKey = showingChanges && changes && was !== null ? `${path}:${was.length}:${changes.length}:${changes.map((l) => l.kind[0]).join('')}:${working ? 'w' : ''}:${ask ? 'y' : ''}` : '';
  const tallGroups = useTallChanges(editor, scroller, changesKey, changesNow);
  // Markdown as this editor would draw it, for the words a change took out.
  const renderMarkdown = (markdown: string): string | null => {
    if (!editor || editor.isDestroyed || !editor.markdown || !markdown.trim()) return null;
    try { return generateHTML(editor.markdown.parse(markdown), editor.extensionManager.extensions); } catch { return null; }
  };
  changesNow.current = showingChanges && changes ? { diff: changes, render: renderMarkdown, keep: keepOne, discard: discardOne, again: tryAnother ? (g) => { discardOne(g); tryAnother(); } : undefined, keepAll: () => void keepChanges(), waiting: working, tall: tallGroups.current, why: ask ? whyLine(ask) : null } : null;
  // The Notes menu's "Show what the agent changed".
  const showLatest = useRef(showChanges);
  showLatest.current = showChanges;
  useEffect(() => onCommand('show-changes', () => void showLatest.current()), []);
  // The Notes menu (⋯ in the toolbar): Clip a web page, and Show Markdown or the formatted page.
  const toggleLatest = useRef(toggleSource);
  toggleLatest.current = toggleSource;
  useEffect(() => onCommand('clip-page', () => setClipping('')), []);
  useEffect(() => onCommand('show-history', () => { if (window.mobius.notes?.versions) setHistory(true); }), []);
  useEffect(() => onCommand('show-markdown', () => toggleLatest.current()), []);
  const undoChanges = async () => {
    if (!review || !path) return;
    const result = await window.mobius.changes.undoFile(review.conversation, `notes/${path}`).catch(() => ({ ok: false as const, error: 'That could not be undone.' }));
    if (!result.ok) setReviewProblem(result.error);
    // The turn's summary and other reviews read the turn again: this note's change is no longer waiting.
    else window.dispatchEvent(new CustomEvent(KEPT_EVENT));
    setDiff(null);
    setChanges(null);
  };

  // In Markdown, the selection bar follows the pointer, as the text box has no positions to ask for.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const pressedAt = useRef<number | null>(null);
  const readSourceSelection = () => {
    const field = area.current;
    const box = section.current?.getBoundingClientRect();
    if (!field || !box || !onSelection) return;
    const text = field.value.slice(field.selectionStart, field.selectionEnd);
    if (text.trim().length < 2) { setSelection(null); return; }
    const at = pointer.current;
    const highest = at ? Math.min(at.y, pressedAt.current ?? at.y) : null;
    const top = highest !== null ? Math.max(8, highest - box.top - 52) : 8;
    const left = at ? Math.min(Math.max(8, at.x - box.left - 150), Math.max(8, box.width - 340)) : Math.max(8, box.width - 340);
    setSelection({ text, top, left });
  };

  const tags = useMemo(() => tagsIn(notes.text), [notes.text]);
  const openComments = commentState.comments.filter((c) => !c.resolved).length;
  const words = useMemo(() => countWords(notes.text.replace(/^# .*$/m, '').replace(/[#>*_`|[\]()-]/g, ' ')), [notes.text]);
  // "Edited" counts on from when the page was last saved, so it is read again every half minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  const edited = notes.page?.base ? relativeTime(notes.page.base, Math.max(now, notes.page.base)) : '';
  // The meta line under the title: drawn in the page, so told to look again when what it says changes.
  const metaParts = [
    ...(edited ? [`Edited ${edited.toLowerCase() === 'just now' ? 'just now' : edited}`] : []),
    words === 1 ? '1 word' : `${words} words`,
    ...(openComments > 0 ? [openComments === 1 ? '1 comment' : `${openComments} comments`] : []),
  ];
  metaNow.current = notes.page && !source ? { parts: metaParts, tags, onTag: showTag } : null;
  const metaText = metaNow.current ? `${metaParts.join('|')}|${tags.join(' ')}` : '';
  useEffect(() => { if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(metaKey, true)); }, [editor, metaText]);

  // The page's headings, for the Outline panel beside it (the same panel as Docs'), read once the page is in the editor.
  useEffect(() => {
    if (!path || !editor) return undefined;
    const t = window.setTimeout(() => {
      if (editor.isDestroyed) return;
      const heads: { level: number; text: string; pos: number }[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') heads.push({ level: Number(node.attrs.level) || 1, text: node.textContent, pos });
        return node.type.name !== 'heading';
      });
      // A first heading that is the page's own title is the title, not part of the outline.
      const from = heads[0]?.level === 1 && heads[0].pos === 0 ? 1 : 0;
      publishOutline({
        path,
        items: heads.slice(from).map((h) => ({ level: h.level, text: h.text })),
        current: -1,
        go: (i) => { const h = heads[i + from]; if (h && !editor.isDestroyed) toHeading(editor, h.pos); },
      });
    }, 0);
    return () => window.clearTimeout(t);
  }, [path, editor, notes.text]);
  useEffect(() => () => publishOutline(null), []);

  if (!notes.page) {
    // The editor stays mounted (hidden), so it is ready the moment a page opens.
    return (
      <section className="note-editor empty" aria-label="Note">
        <EmptyState app="notes" label="No note open" title={notes.notebooks.some((n) => n.pages.length) ? 'No note open' : 'No notes yet'} line="Choose one on the left, or start a new one." action={{ label: 'New note', run: () => newItemIn(notes, null, 'Notes') }} />
        <EditorContent editor={editor} hidden />
        {notes.justTrashed && <UndoToast text={notes.justTrashed.text} onUndo={() => void notes.restore(notes.justTrashed!.id)} onDismiss={notes.clearJustTrashed} />}
      </section>
    );
  }
  const title = liveTitle(notes.text, notes.page.title || path?.split('/')[1]?.replace(/\.md$/, '') || '');
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  const insertTable = () => { if (source || !editor) put(TABLE); else editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run(); };
  const attach = window.mobius.notes?.attach && adding === 0 ? () => picker.current?.click() : null;
  // More (+): what else goes into the page. Words said aloud, a meeting, a clipped web page; in Markdown also a table
  // and a file, which the tool row has as buttons.
  const insertMenu = (
    <Menu label="Insert" entries={[
      ...(source ? [
        { label: 'Table', icon: TABLE_ICON, run: insertTable },
        ...(window.mobius.notes?.attach ? [{ label: adding > 0 ? 'Adding…' : 'Picture or file…', disabled: adding > 0, run: () => picker.current?.click() }] : []),
      ] : []),
      { label: 'Dictate', disabled: recording.state !== 'idle' || meeting.state !== 'idle', run: dictate },
      { label: 'Record a meeting', disabled: recording.state !== 'idle' || meeting.state !== 'idle', run: startMeeting },
      { label: 'Clip a web page…', run: () => setClipping(''), separated: true },
    ]} trigger={<button type="button" className="doc-tool" aria-label="Insert" title="Dictate, record a meeting or clip a page"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg></button>} />
  );
  // Editing the Markdown itself, the same line sits over the text.
  const metaLine = (
    <p className="note-meta">
      {metaParts.map((part) => <span key={part}>{part}</span>)}
      {tags.length > 0 && (
        <span className="note-meta-tags">
          {tags.map((tag) => <button key={tag} type="button" className="note-meta-tag" title={`Show every note tagged #${tag}`} onClick={() => showTag(tag)}>#{tag}</button>)}
        </span>
      )}
    </p>
  );
  return (
    <section ref={section} className="note-editor" aria-label={`Note: ${title}`} data-source={source || undefined}
      onKeyDown={(e) => { const k = findKeyOf(e); if (!k || !editor || source) return; e.preventDefault(); e.stopPropagation(); setFinding((f) => ({ replacing: k === 'replace' || (f?.replacing ?? false), token: (f?.token ?? 0) + 1 })); }}>
      {finding && editor && !source && <DocFind editor={editor} replacing={finding.replacing} focusToken={finding.token} onClose={() => setFinding(null)} />}
      <PanelTab id="outline" name="Outline"><DocOutlinePanel /></PanelTab>
      {/* Comments (the panel look, A5): off the page, in the inspector's Comments panel; each opens its words. */}
      {commentState.available && !source && (
        <PanelTab id="comments" name="Comments">
          <div className="note-comments-panel">
            {commentState.comments.length === 0 && !commentState.problem && <p className="doc-outline-empty">Select words and choose Comment to add one.</p>}
            <CommentList state={commentState} text={editor?.state.doc.textContent ?? ''} onShow={showQuote} />
          </div>
        </PanelTab>
      )}
      {notes.status === 'conflict' && (
        <div className="note-conflict" role="alert">
          <span>Mobius changed this note while you were editing it.</span>
          <button type="button" className="btn" onClick={() => void notes.resolve(false)}>Use their version</button>
          <button type="button" className="btn primary" onClick={() => void notes.resolve(true)}>Keep mine</button>
        </div>
      )}
      {history && path && <NoteHistory path={path} text={notes.text} onRestore={restore} onClose={() => setHistory(false)} />}
      {diff === null && !history && (
        // The page's controls sit in the window's toolbar (ui/AppFrame), not in a row of their own above the page.
        <ToolbarControls label="Notes">
        <div className="note-format" role="toolbar" aria-label="Format">
          {editor && !source && <FormatButtons editor={editor} onLink={() => setLinking('')} onAttach={attach} table={insertTable} />}
          {source && <button type="button" className="doc-tool text" onPointerDown={keep} onClick={() => put(CHECKLIST)}>Checklist</button>}
          {insertMenu}
          {/* While Mobius listens, the way to stop it stays in sight. */}
          {recording.state !== 'idle' && (
            <button type="button" className="note-insert-btn" data-recording={recording.state === 'recording' || undefined} disabled={recording.state === 'transcribing'} title="Stop and keep the words in this page" onPointerDown={keep} onClick={dictate}>
              {recording.state === 'recording' ? `Stop · ${Math.floor(recording.seconds / 60)}:${String(recording.seconds % 60).padStart(2, '0')}` : 'Writing it down…'}
            </button>
          )}
          {meeting.state !== 'idle' && (
            <button type="button" className="note-insert-btn" data-recording={meeting.state === 'recording' || undefined} disabled={meeting.state === 'finishing'} title="End the meeting and put what was said in this page" onPointerDown={keep} onClick={meeting.stop}>
              {meeting.state === 'recording' ? `End meeting · ${Math.floor(meeting.seconds / 60)}:${String(meeting.seconds % 60).padStart(2, '0')}` : 'Writing it down…'}
            </button>
          )}
          {window.mobius.notes?.attach && <input ref={picker} type="file" multiple hidden aria-label="Choose files to add" onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; void addFiles(files); }} />}
          <Menu label="Share" align="end" entries={[
            { label: 'Copy', run: () => void share('formatted') },
            { label: 'Copy as Markdown', run: () => void share('markdown') },
            ...(window.mobius.notes?.export ? [
              { label: 'Export as web page', run: () => void share('html'), separated: true },
              { label: 'Export as Markdown', run: () => void share('md') },
            ] : []),
            { label: 'Print or save as PDF…', run: () => void share('print'), separated: true },
          ]} trigger={
            <button type="button" className="doc-tool" aria-label="Share" title="Share">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 12.5V3.5M6.8 6.5 10 3.3l3.2 3.2M6.5 9H5.5A1.5 1.5 0 0 0 4 10.5v5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 14.5 9h-1" /></svg>
            </button>
          } />
          {source && <button type="button" className="doc-tool text note-source" aria-pressed title="Show formatted" onClick={toggleSource}>Markdown</button>}
        </div>
        </ToolbarControls>
      )}
      {diff === null && !history && (clipping !== null || (linking !== null && !linkAt) || meetingDone || (insertProblem ?? recording.problem ?? meeting.problem)) && (
        <div className="note-forms">
          {clipping !== null && (
            <form className="note-clip" onSubmit={(e) => { e.preventDefault(); if (clipping.trim()) void clip(clipping); }}>
              <input autoFocus aria-label="Address to clip" placeholder="Paste a link" value={clipping} onChange={(e) => setClipping(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setClipping(null); }} />
              <button type="submit" className="btn" disabled={!clipping.trim()}>Clip</button>
            </form>
          )}
          {linking !== null && !linkAt && linkForm}
          {meetingDone && (
            <div className="note-clip note-meeting" role="status">
              <span>The meeting is in this note.</span>
              {onAsk && <button type="button" className="btn primary" onClick={() => { onAsk(meetingAsk(meetingDone.title, meetingDone.path)); setMeetingDone(null); }}>Fill in my notes</button>}
              <button type="button" className="btn" onClick={() => setMeetingDone(null)}>Done</button>
            </div>
          )}
          {(insertProblem ?? recording.problem ?? meeting.problem) && <span className="review-problem" role="alert">{insertProblem ?? recording.problem ?? meeting.problem}</span>}
        </div>
      )}
      {/* Copied, Saved and their failures: the shared pill at the foot of the page, as Restored is, never a line across the top. */}
      {shared && !history && !restored && <UndoToast text={shared} onDismiss={() => setShared(null)} />}
      {notes.justTrashed && !restored && !shared && <UndoToast text={notes.justTrashed.text} onUndo={() => void notes.restore(notes.justTrashed!.id)} onDismiss={notes.clearJustTrashed} />}
      {restored && !history && <UndoToast text={`Restored the version from ${restored.label}.`} onUndo={() => { notes.edit(restored.was); setRestored(null); }} onDismiss={() => setRestored(null)} />}
      {review && !kept && !history && !showingChanges && !working && (
        <div ref={reviewBar} className="note-review" role="status">
          <span className="review-dot" aria-hidden="true" />
          <span className="note-review-text">{diff ? (() => { const c = diffCounts(diff); return `${c.added} ${c.added === 1 ? 'line' : 'lines'} added, ${c.removed} removed in Mobius's last turn`; })() : "Mobius changed this note in its last turn."}<WhyThis conversation={review.conversation} /></span>
          <button type="button" className="review-btn" aria-pressed={diff !== null} onClick={() => (diff ? setDiff(null) : void showChanges())}>{diff ? 'Back to editing' : 'Show changes'}</button>
          <ReviewActions onKeep={async () => { await settleKept(reviewBar.current); await keepChanges(); }} onDiscard={async () => { const paper = reviewBar.current?.parentElement?.querySelector('.note-paper'); await settleGone(paper); await undoChanges(); settleIn(paper); }} discardTitle="Put this note back as it was before that turn" keepTitle="Keep what Mobius changed in this note in that turn" />
          {reviewProblem && <span className="review-problem" role="alert">{reviewProblem}</span>}
        </div>
      )}
      {diff && (
        <ol className="note-diff" aria-label="Changes to this page">
          {(() => {
            const groups = changeGroups(diff);
            return diff.map((line, i) => {
              const group = groups[i];
              const first = group !== null && group !== undefined && groups[i - 1] !== group;
              return (
                <li key={i} data-kind={line.kind} data-first={first || undefined}>
                  <span className="note-diff-sign" aria-hidden="true">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}</span>
                  <span className="note-diff-text">{line.kind === 'removed' ? <del>{line.text || ' '}</del> : line.kind === 'added' ? <ins>{line.text || ' '}</ins> : (line.text || ' ')}</span>
                  {first && (
                    <button type="button" className="note-diff-undo" aria-label={`Undo change ${group + 1}`} title="Put this change back as it was" onClick={() => undoOne(group)}>Undo</button>
                  )}
                </li>
              );
            });
          })()}
        </ol>
      )}
      {linkAt && linkForm && diff === null && !history && createPortal(linkForm, document.body)}
      <div ref={setScroller} className="note-scroll" hidden={diff !== null || history} data-entering={entering || undefined}
        // Comments follow the words at the normal gap, so the room left over is below them: a click there writes on.
        onMouseDown={(e) => { if (e.target !== e.currentTarget || !editor || source) return; e.preventDefault(); editor.commands.focus('end'); }}
        onAnimationEnd={(e) => { if (e.target === e.currentTarget) setEntering(false); }}>
        {source && metaLine}
        {source ? (
          <textarea
            ref={area}
            className="note-text"
            aria-label="Page text"
            spellCheck
            value={notes.text}
            onChange={(e) => notes.edit(e.target.value)}
            onPaste={(e) => { const files = [...e.clipboardData.files]; if (files.length) { e.preventDefault(); caret.current = e.currentTarget.selectionStart; void addFiles(files); } }}
            onDrop={(e) => { const files = [...e.dataTransfer.files]; if (files.length) { e.preventDefault(); void addFiles(files); } }}
            onSelect={(e) => { caret.current = e.currentTarget.selectionStart; }}
            onPointerDown={(e) => { pointer.current = null; pressedAt.current = e.clientY; setSelection(null); }}
            onPointerUp={(e) => { pointer.current = { x: e.clientX, y: e.clientY }; readSourceSelection(); }}
            onKeyUp={(e) => { if (e.key === 'Escape') { setSelection(null); return; } pointer.current = null; pressedAt.current = null; readSourceSelection(); }}
            onBlur={(e) => { if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) setSelection(null); }}
          />
        ) : (
          <EditorContent editor={editor} className="note-paper" />
        )}
        {/* Linked from (A5): one quiet line at the end of the page, opened to list the notes that link here. */}
        {backlinks.length > 0 && (
          <section className="note-backlinks" aria-label="Linked from" data-open={linkedOpen || undefined}>
            <button type="button" className="note-backlinks-line" aria-expanded={linkedOpen} onClick={() => setLinkedOpen((o) => !o)}>
              Linked from {backlinks.length}
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 6.5 3.5 3.5-3.5 3.5" /></svg>
            </button>
            {linkedOpen && <ul>
              {backlinks.map((pg) => (
                <li key={pg.path}>
                  <button type="button" onClick={() => void notes.open(pg.path, pg.title)}>
                    <span className="note-link-title">{pg.title}</span>
                    <span className="note-link-book">{pg.notebook}{pg.preview ? ` · ${pg.preview}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>}
          </section>
        )}
      </div>
      {selection && onSelection && (
        <div className="selection-bar" role="toolbar" aria-label="Selected text" style={{ top: selection.top, left: selection.left }}>
          {commentState.available && (
            <button type="button" className="selection-btn" data-action="comment" title="Comment on these words"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => { setComposing({ quote: selection.text.trim(), top: selection.top + 76, left: selection.left }); setSelection(null); }}>
              Comment
            </button>
          )}
          {ACTIONS.map((action) => (
            <button key={action.id} type="button" className="selection-btn" data-action={action.id} title={action.title}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => { onSelection(action.id, selection.text); setSelection(null); }}>
              {action.label}
            </button>
          ))}
        </div>
      )}
      {composing && (
        <CommentComposer quote={composing.quote} top={composing.top} left={composing.left} add={addComment} onDone={() => setComposing(null)}
          onAsk={onSelection ? (quote, said) => onSelection('ask', `${quote}\n\nMy comment on it: ${said}`) : undefined} />
      )}
    </section>
  );
}
