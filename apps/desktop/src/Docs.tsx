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
import { newItemIn } from './NotesSidebar';
import { untitledHeading } from './NoteEditor';
import { EmptyState } from './EmptyState';
import type { NotesState } from './useNotes';
import type { ReactNode } from 'react';
import type { NoteComment } from '@mobius/shared';
import { ReviewActions, WhyThis } from './ReviewBar';
import { tidyMarkdown } from './note-insert';
import { fileMarkdown, noteImage, readFile } from './note-files';
import { CommentComposer, CommentList, commentLine, useNoteComments } from './NoteComments';
import { NoteHistory, dayOf } from './NoteHistory';
import { copyFormatted, copyText, pageAsHtml } from './note-share';
import { linkTo, pageOfLink, pagesMatching } from './note-links';
import { acceptGroup, placeChanges, COUNT_ORDER, countLabel, docStats, headingInView, type CountShown } from './docs-view';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { Menu, ToolbarControls, UndoToast } from './ui';
import { timeLabel } from './dates';
import './docs.css';

export const DEFAULT_FOLDER = 'Documents';

/** Docs' sidebar is in its own file, on the shared frame. */
export { DocsSidebar } from './DocsSidebar';

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

/** The document's typeface: the app's sans-serif, as in Notes, or a serif for those who write long pieces in one. Per device. */
type DocFont = 'sans' | 'serif';
const FONT_KEY = 'mobius.docs.font';
const readFont = (): DocFont => { try { return window.localStorage.getItem(FONT_KEY) === 'serif' ? 'serif' : 'sans'; } catch { return 'sans'; } };

/** Whether the outline shows beside the page. Per device; shown unless hidden. */
const OUTLINE_KEY = 'mobius.docs.outline';
const readOutline = () => { try { return window.localStorage.getItem(OUTLINE_KEY) !== '0'; } catch { return true; } };

/** What the foot counts, one at a time as in Pages: a click shows the next. Per device. */
const COUNT_NEXT: Record<CountShown, string> = { words: 'characters', characters: 'reading time', minutes: 'words' };
const COUNT_KEY = 'mobius.docs.count';
const readCount = (): CountShown => { try { const v = window.localStorage.getItem(COUNT_KEY); return COUNT_ORDER.includes(v as CountShown) ? v as CountShown : 'words'; } catch { return 'words'; } };

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

/** Aa's panel: the styles and marks, under its button, closed by a click away or Escape. Stays open while formatting. */
function Panel({ label, buttonLabel, title, button, marked, children }: { label: string; buttonLabel: string; title: string; button: ReactNode; marked: boolean; children: () => ReactNode }) {
  const [open, setOpen] = useState(false);
  const at = useRef<HTMLButtonElement>(null);
  const r = open ? at.current?.getBoundingClientRect() : undefined;
  return (
    <>
      <button ref={at} type="button" className="doc-tool doc-aa-btn" aria-label={buttonLabel} title={title} aria-haspopup="dialog" aria-expanded={open} data-marked={marked || undefined} onPointerDown={keep} onClick={() => setOpen((o) => !o)}>{button}</button>
      {open && createPortal(
        <>
          <div className="doc-writing-scrim" onMouseDown={() => setOpen(false)} />
          <div className="doc-aa-panel glass" role="dialog" aria-label={label} style={{ top: (r?.bottom ?? 0) + 8, left: Math.max(8, Math.min(r?.left ?? 0, window.innerWidth - 280)) }}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); at.current?.focus(); } }}>
            {children()}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

/** The styles in the Aa panel, biggest first, as Apple Notes and Pages list them. */
const STYLES_SHOWN = [STYLES[1], STYLES[2], STYLES[3], STYLES[0], STYLES[4]];

/**
 * The format bar in one row, as Notes has it: Aa opens a panel with the styles, marks and lists; the bar keeps what is
 * reached for while writing (checklist, link, insert, and the table's rows and columns while in one), then the
 * document's own things on the right. In Docs it is the window's toolbar (`inFrame`); the wiki keeps it on the page.
 * On the frame, Outline and History are in Document options (they become panels), and when the toolbar is short Checklist gives way
 * (it is in Aa's lists too) and Writing tools shows only its pen.
 */
function Toolbar({ editor, onTool, busy, extras, trailing, inFrame }: {
  editor: Editor;
  onTool?: (tool: WritingTool, selection: string | null) => void;
  busy: boolean;
  /** What the document can do beyond writing; absent where the folder does not keep these (the wiki). */
  extras: { onLink: () => void; onFile?: () => void; onHistory?: () => void; onShare?: (how: ShareHow) => void; outline: boolean; onOutline: () => void; comments: number; commentsOpen: boolean; onComments?: () => void; font: DocFont; onFont: (font: DocFont) => void };
  /** The folder's own controls at the end of the row (Knowledge's versions). */
  trailing?: ReactNode;
  /** Drawn in the window's toolbar (zone 3 of the frame) rather than above the page. */
  inFrame: boolean;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: e.isActive('heading', { level: 1 }) ? 'h1' : e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : e.isActive('codeBlock') ? 'code' : 'p',
      bold: e.isActive('bold'), italic: e.isActive('italic'), strike: e.isActive('strike'), code: e.isActive('code'), link: e.isActive('link'),
      bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), task: e.isActive('taskList'), quote: e.isActive('blockquote'), table: e.isActive('table'),
      empty: e.state.selection.empty,
    }),
  });
  const run = (f: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => () => { f(editor.chain().focus()).run(); };
  const setStyle = (id: string) => {
    const c = editor.chain().focus();
    if (id === 'p') c.setParagraph().run();
    else if (id === 'code') c.toggleCodeBlock().run();
    else c.setHeading({ level: Number(id.slice(1)) as 1 | 2 | 3 }).run();
  };
  const selectedText = () => {
    const { from, to, empty } = editor.state.selection;
    return empty ? null : editor.state.doc.textBetween(from, to, '\n');
  };
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  const marked = state.bold || state.italic || state.strike || state.code || state.style !== 'p' || state.bullet || state.ordered || state.quote || state.task;
  const tableIcon = <Icon><rect x="3.5" y="4.5" width="13" height="11" rx="1.5" /><path d="M3.5 8.5h13M3.5 12h13M8 4.5v11M12 4.5v11" /></Icon>;
  const bar = (
    <div className="doc-toolbar" data-frame={inFrame || undefined} role="toolbar" aria-label="Format">
      <Panel label="Text format" title="Styles, bold, italic and lists" marked={marked} button={<span className="doc-aa" aria-hidden="true">Aa</span>} buttonLabel="Format text">
        {() => (
          <>
            <div className="doc-aa-styles" role="group" aria-label="Paragraph style">
              {STYLES_SHOWN.map((s) => (
                <button key={s.id} type="button" className="doc-aa-style" data-style={s.id} aria-pressed={state.style === s.id} onPointerDown={keep} onClick={() => setStyle(s.id)}>{s.label}</button>
              ))}
            </div>
            <div className="doc-aa-row">
              <div className="doc-aa-group" role="group" aria-label="Marks">
                <button type="button" className="doc-tool" aria-label="Bold" aria-pressed={state.bold} title={`Bold (${mod}B)`} onPointerDown={keep} onClick={run((c) => c.toggleBold())}><b>B</b></button>
                <button type="button" className="doc-tool" aria-label="Italic" aria-pressed={state.italic} title={`Italic (${mod}I)`} onPointerDown={keep} onClick={run((c) => c.toggleItalic())}><i>I</i></button>
                <button type="button" className="doc-tool" aria-label="Strikethrough" aria-pressed={state.strike} title={`Strikethrough (${mod}Shift+S)`} onPointerDown={keep} onClick={run((c) => c.toggleStrike())}><s>S</s></button>
                <button type="button" className="doc-tool" aria-label="Code" aria-pressed={state.code} title={`Code (${mod}E)`} onPointerDown={keep} onClick={run((c) => c.toggleCode())}><Icon d="M7.5 6 3.5 10l4 4M12.5 6l4 4-4 4" /></button>
              </div>
              <div className="doc-aa-group" role="group" aria-label="Lists">
                <button type="button" className="doc-tool" aria-label="Bulleted list" aria-pressed={state.bullet} title={`Bulleted list (${mod}Shift+8)`} onPointerDown={keep} onClick={run((c) => c.toggleBulletList())}>
                  <Icon><circle cx="5" cy="6" r="1" /><circle cx="5" cy="10" r="1" /><circle cx="5" cy="14" r="1" /><path d="M8.5 6h7M8.5 10h7M8.5 14h7" /></Icon>
                </button>
                <button type="button" className="doc-tool" aria-label="Numbered list" aria-pressed={state.ordered} title={`Numbered list (${mod}Shift+7)`} onPointerDown={keep} onClick={run((c) => c.toggleOrderedList())}>
                  <Icon d="M4 5h1.5v3M4 8h3M4 12.5c.5-.8 2.5-.8 2.5.3 0 .8-2.5 1.5-2.5 2.2h2.6M9.5 6h6M9.5 10h6M9.5 14h6" />
                </button>
                <button type="button" className="doc-tool" aria-label="Checklist" aria-pressed={state.task} title={`Checklist (${mod}Shift+9)`} onPointerDown={keep} onClick={run((c) => c.toggleTaskList())}>
                  <Icon><circle cx="5.5" cy="6" r="2.2" /><path d="m4.4 6 .8.8 1.4-1.6" /><circle cx="5.5" cy="13.5" r="2.2" /><path d="M10 6h6.5M10 13.5h6.5" /></Icon>
                </button>
                <button type="button" className="doc-tool" aria-label="Quote" aria-pressed={state.quote} title={`Quote (${mod}Shift+B)`} onPointerDown={keep} onClick={run((c) => c.toggleBlockquote())}><Icon d="M5 6v8M9 7h7M9 10h7M9 13h5" /></button>
              </div>
            </div>
          </>
        )}
      </Panel>
      <button type="button" className="doc-tool" data-gives-way aria-label="Checklist" aria-pressed={state.task} title={`Checklist (${mod}Shift+9)`} onPointerDown={keep} onClick={run((c) => c.toggleTaskList())}>
        <Icon><circle cx="5.5" cy="6" r="2.2" /><path d="m4.4 6 .8.8 1.4-1.6" /><circle cx="5.5" cy="13.5" r="2.2" /><path d="M10 6h6.5M10 13.5h6.5" /></Icon>
      </button>
      <button type="button" className="doc-tool" aria-label="Link" aria-pressed={state.link} title={state.link ? 'Remove the link' : 'Link to a web page or another document'} onPointerDown={keep} onClick={() => (state.link ? editor.chain().focus().extendMarkRange('link').unsetLink().run() : extras.onLink())}>
        <Icon d="M8.5 11.5a3 3 0 0 0 4.2 0l2.5-2.5a3 3 0 0 0-4.2-4.2l-.8.8M11.5 8.5a3 3 0 0 0-4.2 0L4.8 11a3 3 0 0 0 4.2 4.2l.8-.8" />
      </button>
      <Menu label="Insert" entries={[
        { label: 'Table', icon: tableIcon, run: run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true })) },
        ...(extras.onFile ? [{ label: 'Picture or file…', run: extras.onFile }] : []),
        { label: 'Divider', run: run((c) => c.setHorizontalRule()) },
        { label: 'Code block', run: run((c) => c.toggleCodeBlock()) },
      ]} trigger={<button type="button" className="doc-tool" aria-label="Insert" title="Insert a table, a picture, a divider or code"><Icon d="M10 4v12M4 10h12" /></button>} />
      {/* While the caret is in a table, its rows and columns are one button away. */}
      {state.table && (
        <Menu label="Table" entries={[
          { label: 'Add a row above', run: run((c) => c.addRowBefore()) },
          { label: 'Add a row below', run: run((c) => c.addRowAfter()) },
          { label: 'Add a column before', run: run((c) => c.addColumnBefore()) },
          { label: 'Add a column after', run: run((c) => c.addColumnAfter()) },
          { label: 'Delete the row', run: run((c) => c.deleteRow()), separated: true },
          { label: 'Delete the column', run: run((c) => c.deleteColumn()) },
          { label: 'Delete the table', run: run((c) => c.deleteTable()), danger: true },
        ]} trigger={<button type="button" className="doc-tool" aria-label="Table" aria-pressed title="Rows and columns">{tableIcon}</button>} />
      )}
      <span className="spacer" />
      {!inFrame && <button type="button" className="doc-tool" aria-label="Outline" aria-pressed={extras.outline} title={extras.outline ? 'Hide the outline' : 'Show the outline'} onClick={extras.onOutline}>
        <Icon d="M4 5.5h12M6.5 10H16M9 14.5h7" />
      </button>}
      {extras.onComments && (
        <button type="button" className="doc-tool doc-tool-count" aria-label={extras.comments ? `Comments, ${extras.comments} open` : 'Comments'} aria-pressed={extras.commentsOpen} title={extras.commentsOpen ? 'Hide comments' : 'Show comments'} onClick={extras.onComments}>
          <Icon d="M4.5 5.5h11a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H9l-3.5 2.5V14h-1a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" />
          {extras.comments > 0 && <span className="doc-count">{extras.comments}</span>}
        </button>
      )}
      {extras.onHistory && !inFrame && <button type="button" className="doc-tool" aria-label="History" title="Earlier versions of this document" onClick={extras.onHistory}><Icon d="M4 10a6 6 0 1 0 1.8-4.3M4 4v3.5h3.5M10 6.5V10l2.5 1.5" /></button>}
      {trailing}
      {extras.onShare && (() => {
        const share = extras.onShare;
        return (
          <Menu label="Share" align="end" entries={[
            { label: 'Copy', run: () => share('formatted') },
            { label: 'Copy as Markdown', run: () => share('markdown') },
            { label: 'Export as web page', run: () => share('html'), separated: true },
            { label: 'Export as Markdown', run: () => share('md') },
            { label: 'Print or save as PDF…', run: () => share('print'), separated: true },
          ]} trigger={<button type="button" className="doc-tool" aria-label="Share" title="Copy, export or print this document"><Icon d="M10 3.5v9M6.5 7 10 3.5 13.5 7M5.5 10.5v5h9v-5" /></button>} />
        );
      })()}
      {/* The document's view options. Not a second ⋯: the window's ⋯ beside it holds the app's menus. */}
      <Menu label="Document options" align="end" entries={[
        { label: extras.outline ? 'Hide the outline' : 'Show the outline', run: extras.onOutline },
        ...(extras.onHistory ? [{ label: 'Earlier versions…', run: extras.onHistory }] : []),
        extras.font === 'serif'
          ? { label: 'Use the sans-serif font', run: () => extras.onFont('sans'), separated: true }
          : { label: 'Use a serif font', run: () => extras.onFont('serif'), separated: true },
      ]} trigger={
        <button type="button" className="doc-tool" aria-label="Document options" title="Outline, earlier versions and the typeface">
          <Icon><path d="M4 6.5h6M14 6.5h2M4 13.5h2M10 13.5h6" /><circle cx="12" cy="6.5" r="1.8" /><circle cx="8" cy="13.5" r="1.8" /></Icon>
        </button>
      } />
      {onTool && (
        <Menu label="Writing tools" align="end" entries={WRITING_TOOLS.map((t) => ({ label: t.label, disabled: busy, run: () => onTool(t.id, t.id === 'summarise' ? null : selectedText()) }))}
          trigger={<button type="button" className="doc-tool doc-tool-writing" aria-label="Writing tools" title={`Ask Mobius to proofread, rewrite or summarise. It sees ${state.empty ? 'the whole document' : 'the selected text'}.`}><Icon d="m4.5 15.5 1-3.5 7.8-7.8a1.6 1.6 0 0 1 2.3 2.3l-7.8 7.8zM12 5.5 14.5 8" /><span className="doc-tool-mobius">Writing tools</span></button>} />
      )}
    </div>
  );
  return inFrame ? <ToolbarControls label="Docs">{bar}</ToolbarControls> : bar;
}

/** What Mobius's last turn changed, as the page shows it: the blocks it added marked, and a note at each change with
 *  the words it took out and Keep and Discard for that change alone. Read from `look` when told to look again. */
interface ChangeView { diff: DiffLine[]; render: (markdown: string) => string | null; keep: (group: number) => void; discard: (group: number) => void }
const changeKey = new PluginKey<DecorationSet>('doc-changes');
function changeNote(group: number, removed: string[], view: ChangeView, look: () => ChangeView | null): HTMLElement {
  const note = document.createElement('div');
  note.className = 'doc-change';
  note.contentEditable = 'false';
  note.dataset.group = String(group);
  note.setAttribute('role', 'group');
  note.setAttribute('aria-label', removed.length ? 'A change Mobius made' : 'Words Mobius added');
  if (removed.length) {
    const old = document.createElement('div');
    old.className = 'doc-change-old';
    // Drawn as the page draws it (headings, lists, bold), through the editor's own schema; as lines when it will not read.
    const html = view.render(removed.join('\n'));
    if (html !== null) old.innerHTML = html;
    else for (const line of removed) { const p = document.createElement('p'); p.textContent = line || ' '; old.append(p); }
    note.append(old);
  }
  const bar = document.createElement('div');
  bar.className = 'doc-change-bar';
  const who = document.createElement('span');
  who.textContent = removed.length ? 'Mobius changed this' : 'Mobius added this';
  bar.append(who);
  const button = (label: string, name: string, kind: string, run: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'review-btn';
    b.dataset.kind = kind;
    b.textContent = label;
    b.setAttribute('aria-label', name);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', run);
    return b;
  };
  // Asked through `look` when pressed: the note can outlive the render it was drawn in, and its change's number holds.
  bar.append(button('Discard', 'Discard this change', 'discard', () => look()?.discard(group)), button('Keep', 'Keep this change', 'keep', () => look()?.keep(group)));
  note.append(bar);
  return note;
}
function changeDecorations(doc: PmNode, look: () => ChangeView | null): DecorationSet {
  const view = look();
  if (!view) return DecorationSet.empty;
  const blocks: { from: number; to: number; text: string }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    blocks.push({ from: pos, to: pos + node.nodeSize, text: node.textContent.replace(/\s+/g, ' ').trim() });
    return false;
  });
  const groups = changeGroups(view.diff);
  const { added, notes } = placeChanges(view.diff, groups, blocks.map((b) => b.text));
  const marks: Decoration[] = [];
  for (const [b, g] of added) marks.push(Decoration.node(blocks[b]!.from, blocks[b]!.to, { class: 'doc-change-new', 'data-group': String(g) }));
  for (const [g, at] of notes) {
    const removed = view.diff.filter((l, i) => groups[i] === g && l.kind === 'removed').map((l) => l.text);
    while (removed.length && !removed[removed.length - 1]!.trim()) removed.pop();
    while (removed.length && !removed[0]!.trim()) removed.shift();
    const pos = at.block < 0 ? 0 : at.before ? blocks[at.block]!.from : blocks[at.block]!.to;
    marks.push(Decoration.widget(pos, () => changeNote(g, removed, view, look), { side: at.before ? -1 : 1, key: `change-${g}-${pos}-${removed.join('\u0000').length}`, stopEvent: () => true, ignoreSelection: true }));
  }
  return DecorationSet.create(doc, marks);
}
const docChanges = (look: () => ChangeView | null) => Extension.create({
  name: 'docChanges',
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: changeKey,
      state: {
        init: (_, state) => changeDecorations(state.doc, look),
        apply: (tr, old) => (tr.docChanged || tr.getMeta(changeKey) ? changeDecorations(tr.doc, look) : old),
      },
      props: { decorations: (state) => changeKey.getState(state) },
    })];
  },
});

type ShareHow = 'markdown' | 'formatted' | 'html' | 'md' | 'print';

/**
 * The open document: a page you write on (headings, lists, checklists, tables, pictures, links to other documents),
 * kept as Markdown and saved as you type, with its outline beside it and its comments in the margin. History puts an
 * earlier version back; Share copies, exports or prints it. A document the agent changed shows those changes as
 * proposals to keep or discard.
 */
export function DocEditor({ docs, autoFocus = true, review, onTool, onComments, busy = false, toolbarEnd, inFrame = false }: {
  docs: NotesState;
  /** The format bar goes in the window's toolbar (Docs, on the frame); without it, it stays above the page (the wiki). */
  inFrame?: boolean;
  /** The folder's own controls, at the end of the format bar (Knowledge's versions), so the page keeps one bar. */
  toolbarEnd?: ReactNode;
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
  const changesNow = useRef<ChangeView | null>(null);
  const changeMarks = useMemo(() => docChanges(() => changesNow.current), []);
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
      changeMarks,
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
  // The document the cursor was last placed in: a document just opened starts at its top, as Pages opens one; the same
  // document changed from elsewhere (by Mobius) keeps the cursor about where it was, so the page does not jump.
  const placed = useRef<string | null>(null);
  useEffect(() => {
    if (!editor || editor.isDestroyed || docs.text === known.current) return;
    known.current = docs.text;
    const opened = placed.current !== path;
    const was = editor.state.selection.from;
    const hadFocus = editor.view.hasFocus();
    editor.chain().setMeta('mobius-load', true).setContent(docs.text, { contentType: 'markdown', emitUpdate: false }).run();
    placed.current = path;
    if (opened) {
      // At the top, focused or not, so the outline and the toolbar speak of the start of the document.
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atStart(editor.state.doc)).setMeta('mobius-load', true).setMeta('addToHistory', false));
      section.current?.querySelector('.doc-scroll')?.scrollTo({ top: 0 });
    }
    // Not while a dialog is open (the launcher): a page that loads late must not take the keys from it.
    if (!autoFocus || document.querySelector('dialog[open]')) return;
    // A new document: its title is chosen, so what is typed first names it.
    const at = untitledHeading(editor);
    if (at) editor.chain().focus().setTextSelection(at).run();
    else if (opened) editor.chain().focus('start', { scrollIntoView: false }).run();
    else if (hadFocus) editor.chain().focus(undefined, { scrollIntoView: false }).setTextSelection(Math.max(1, Math.min(was, editor.state.doc.content.size - 1))).run();
  }, [editor, docs.text, path]); // eslint-disable-line react-hooks/exhaustive-deps
  const quoteKey = quotesNow.current.join('\u0000');
  useEffect(() => { if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(commentKey, true)); }, [editor, quoteKey]);
  const view = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return { outline: [] as ReturnType<typeof headingsOf>, chosen: '' };
      const { from, to, empty } = e.state.selection;
      return { outline: headingsOf(e), chosen: empty ? '' : e.state.doc.textBetween(from, to, ' ') };
    },
  }) ?? { outline: [], chosen: '' };
  const outline = view.outline;
  // The heading the outline marks: the one whose part of the document is in view, followed as the page scrolls.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [current, setCurrent] = useState(-1);
  useEffect(() => {
    if (!scroller || !editor) return undefined;
    const look = () => {
      if (editor.isDestroyed) return;
      const box = scroller.getBoundingClientRect();
      const tops = outline.map((h) => {
        const el = editor.view.nodeDOM(h.pos);
        return el instanceof HTMLElement ? el.getBoundingClientRect().top - box.top : Number.POSITIVE_INFINITY;
      });
      const atEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 2 && scroller.scrollTop > 0;
      setCurrent(headingInView(tops, scroller.clientHeight, atEnd));
    };
    look();
    scroller.addEventListener('scroll', look, { passive: true });
    return () => scroller.removeEventListener('scroll', look);
  }, [scroller, editor, outline]);
  const stats = useMemo(() => docStats(docs.text), [docs.text]);
  const chosenWords = view.chosen ? countWords(view.chosen) : 0;

  const [count, setCount] = useState<CountShown>(readCount);
  const nextCount = () => setCount((c) => { const next = COUNT_ORDER[(COUNT_ORDER.indexOf(c) + 1) % COUNT_ORDER.length]!; try { window.localStorage.setItem(COUNT_KEY, next); } catch { /* Not kept. */ } return next; });
  const [font, setFontState] = useState<DocFont>(readFont);
  const setFont = (f: DocFont) => { setFontState(f); try { window.localStorage.setItem(FONT_KEY, f); } catch { /* Not kept. */ } };
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
    const at = timeLabel(whenMs);
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
    // Every change put back: nothing is left to decide, so the turn is settled and its bar goes. Counted from the
    // changes shown, not from comparing texts again, which a save's small tidying could make differ.
    if (lastChange(diff) || !rest.some((line) => line.kind !== 'same')) void keepAll(); else setDiff(rest);
  };
  const lastChange = (lines: DiffLine[]) => new Set(changeGroups(lines).filter((g) => g !== null)).size <= 1;
  // Keeping one change takes it into "before", so it stops showing; the last one kept keeps the whole turn.
  const keepOne = (group: number) => {
    if (!diff) return;
    const was = acceptGroup(diff, changeGroups(diff), group);
    setBefore(was);
    const rest = compare(was, docs.text);
    if (lastChange(diff) || !rest.some((line) => line.kind !== 'same')) void keepAll(); else setDiff(rest);
  };
  // The page is told to mark the changes again whenever what it should show changes.
  changesNow.current = null;
  const changesKey = review && !kept && diff && before !== null ? `${path}:${before.length}:${diff.length}:${diff.map((l) => l.kind[0]).join('')}` : '';
  useEffect(() => { if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(changeKey, true)); }, [editor, changesKey]);

  if (!docs.page) {
    // The editor stays mounted (hidden), so it is ready the moment a document opens.
    return (
      <section className="doc-editor empty" aria-label="Document">
        <EmptyState app="docs" label="No document open" title={docs.notebooks.some((n) => n.pages.length) ? 'No document open' : 'No documents yet'} line="Choose one on the left, or start a new one." action={{ label: 'New document', run: () => newItemIn(docs, null, DEFAULT_FOLDER) }} />
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
  if (showing) changesNow.current = { diff, render: renderMarkdown, keep: keepOne, discard: discardOne };
  const saving = docs.status === 'saving' || docs.status === 'unsaved' ? 'Saving…' : docs.status === 'error' ? 'Not saved' : 'Saved';
  const margin = own && commentState.available && commentsOpen && commentState.comments.length > 0;
  return (
    <section ref={section} className="doc-editor" aria-label={`Document: ${title}`} data-margin={margin || undefined} data-font={font}>
      {docs.status === 'conflict' && (
        <div className="note-conflict" role="alert">
          <span>This document was changed somewhere else while you were editing it.</span>
          <button type="button" className="btn" onClick={() => void docs.resolve(false)}>Use that version</button>
          <button type="button" className="btn primary" onClick={() => void docs.resolve(true)}>Keep mine</button>
        </div>
      )}
      {editor && (
        <Toolbar editor={editor} busy={busy} inFrame={inFrame} {...(onTool ? { onTool } : {})} trailing={toolbarEnd} extras={{
          font, onFont: setFont,
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
          <div className="doc-scroll" ref={setScroller}>
            {review && !kept && (
              <div ref={reviewBar} className="note-review doc-review" role="status">
                <span className="review-dot" aria-hidden="true" />
                <span className="note-review-text">{diff ? (() => { const c = diffCounts(diff); return wholeNew ? 'Mobius wrote this document in its last turn.' : `Mobius changed ${c.added + c.removed === 1 ? 'one line' : `${c.added + c.removed} lines`} here in its last turn.`; })() : 'Mobius changed this document in its last turn.'}<WhyThis conversation={review.conversation} /></span>
                <ReviewActions
                  onKeep={async () => { const page = reviewBar.current?.parentElement; await Promise.all([settleKept(reviewBar.current), ...[...(page?.querySelectorAll('.doc-change') ?? [])].map((n) => settleKept(n))]); await keepAll(); }}
                  onDiscard={async () => { const paper = reviewBar.current?.parentElement?.querySelector('.doc-sheet'); await settleGone(paper); await discardAll(); settleIn(paper); }} />
              </div>
            )}
            {problem && <p className="tasks-message" role="alert">{problem}</p>}
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
      {restored && <UndoToast text={`Restored the version from ${restored.label}`} onUndo={() => { docs.edit(restored.was); setRestored(null); }} onDismiss={() => setRestored(null)} />}
      {note && <div className="doc-toast" role="status"><span>{note}</span><button type="button" className="review-btn" onClick={() => setNote(null)}>OK</button></div>}
      <footer className="doc-status">
        <button type="button" className="doc-count-btn" title={`Show ${COUNT_NEXT[count]} instead`} onClick={nextCount}>{countLabel(count, stats, chosenWords)}</button>
        {adding > 0 && <span>Adding {adding === 1 ? 'a file' : `${adding} files`}…</span>}
        {/* On the frame, whether it is saved shows in the window's toolbar, under the document's name. */}
        {!inFrame && <><span className="spacer" /><span className="doc-saved" data-state={docs.status}>{saving}</span></>}
      </footer>
    </section>
  );
}
