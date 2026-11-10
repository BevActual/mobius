import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import { onCommand } from './commands';
import { liveTitle } from './notes-state';
import { changeGroups, diffCounts, diffLines, undoGroup, type DiffLine } from './line-diff';
import type { NotesState } from './useNotes';
import { CHECKLIST, TABLE, clipBlock, insertBlock, recordingBlock } from './note-insert';
import { useDictation } from './composer/useDictation';
import { ReviewActions, WhyThis } from './ReviewBar';
import { showTag, tagRanges, tagsIn } from './note-tags';
import { countWords } from './Docs';
import { relativeTime } from './relative-time';
import { NoteHistory, dayOf } from './NoteHistory';
import { fileMarkdown, noteImage, readFile } from './note-files';

/** How long a recording in a note may run: ten minutes. */
const NOTE_RECORDING_SECONDS = 600;

/** What you can do with text selected in a note, right where it is. */
export type SelectionAction = 'ask' | 'rewrite' | 'summarise' | 'task';
const ACTIONS: { id: SelectionAction; label: string; title: string }[] = [
  { id: 'ask', label: 'Ask', title: 'Ask the agent about this' },
  { id: 'rewrite', label: 'Rewrite', title: 'Have the agent rewrite this in the note' },
  { id: 'summarise', label: 'Summarise', title: 'Have the agent summarise this' },
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

const STYLES = [
  { id: 'p', label: 'Body' },
  { id: 'h1', label: 'Title' },
  { id: 'h2', label: 'Heading' },
  { id: 'h3', label: 'Subheading' },
] as const;

/** The Markdown the editor holds, written as people write it: one blank line between blocks, a newline at the end. */
const markdownOf = (e: Editor) => `${e.getMarkdown().replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;

/** The format bar's buttons, with what they show as pressed. Off in Markdown, where the marks are typed. */
function FormatButtons({ editor, onLink }: { editor: Editor; onLink: () => void }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: e.isActive('heading', { level: 1 }) ? 'h1' : e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : 'p',
      bold: e.isActive('bold'), italic: e.isActive('italic'), strike: e.isActive('strike'), code: e.isActive('code'), link: e.isActive('link'),
      bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), task: e.isActive('taskList'), quote: e.isActive('blockquote'), table: e.isActive('table'),
    }),
  });
  const run = (f: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => () => { f(editor.chain().focus()).run(); };
  const setStyle = (id: string) => {
    const chain = editor.chain().focus();
    if (id === 'p') chain.setParagraph().run();
    else chain.setHeading({ level: Number(id.slice(1)) as 1 | 2 | 3 }).run();
  };
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  return (
    <>
      <select aria-label="Paragraph style" value={state.style} onChange={(e) => setStyle(e.target.value)}>
        {STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <span className="doc-tool-sep" />
      <button type="button" className="doc-tool" aria-label="Bold" aria-pressed={state.bold} title="Bold (Ctrl+B)" onPointerDown={keep} onClick={run((c) => c.toggleBold())}><b>B</b></button>
      <button type="button" className="doc-tool" aria-label="Italic" aria-pressed={state.italic} title="Italic (Ctrl+I)" onPointerDown={keep} onClick={run((c) => c.toggleItalic())}><i>I</i></button>
      <button type="button" className="doc-tool" aria-label="Strikethrough" aria-pressed={state.strike} title="Strikethrough (Ctrl+Shift+S)" onPointerDown={keep} onClick={run((c) => c.toggleStrike())}><s>S</s></button>
      <button type="button" className="doc-tool" aria-label="Code" aria-pressed={state.code} title="Code (Ctrl+E)" onPointerDown={keep} onClick={run((c) => c.toggleCode())}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 6 3.5 10l4 4M12.5 6l4 4-4 4" /></svg>
      </button>
      <button type="button" className="doc-tool" aria-label="Link" aria-pressed={state.link} title={state.link ? 'Remove the link' : 'Link'} onPointerDown={keep} onClick={() => (state.link ? editor.chain().focus().unsetLink().run() : onLink())}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.5-2.5a3 3 0 0 0-4.2-4.2l-.8.8M11.5 8.5a3 3 0 0 0-4.2 0L4.8 11a3 3 0 0 0 4.2 4.2l.8-.8" /></svg>
      </button>
      <span className="doc-tool-sep" />
      <button type="button" className="doc-tool" aria-label="Bulleted list" aria-pressed={state.bullet} title="Bulleted list (Ctrl+Shift+8)" onPointerDown={keep} onClick={run((c) => c.toggleBulletList())}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="6" r="1" /><circle cx="5" cy="10" r="1" /><circle cx="5" cy="14" r="1" /><path d="M8.5 6h7M8.5 10h7M8.5 14h7" /></svg>
      </button>
      <button type="button" className="doc-tool" aria-label="Numbered list" aria-pressed={state.ordered} title="Numbered list (Ctrl+Shift+7)" onPointerDown={keep} onClick={run((c) => c.toggleOrderedList())}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h1.5v3M4 8h3M4 12.5c.5-.8 2.5-.8 2.5.3 0 .8-2.5 1.5-2.5 2.2h2.6M9.5 6h6M9.5 10h6M9.5 14h6" /></svg>
      </button>
      <button type="button" className="doc-tool" aria-label="Checklist" aria-pressed={state.task} title="Checklist (Ctrl+Shift+9)" onPointerDown={keep} onClick={run((c) => c.toggleTaskList())}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.5" y="4" width="4" height="4" rx="1" /><path d="m4.3 13.2 1 1 1.9-2.2M10 6h6.5M10 13h6.5" /></svg>
      </button>
      <button type="button" className="doc-tool" aria-label="Quote" aria-pressed={state.quote} title="Quote (Ctrl+Shift+B)" onPointerDown={keep} onClick={run((c) => c.toggleBlockquote())}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6v8M9 7h7M9 10h7M9 13h5" /></svg>
      </button>
      <button type="button" className="doc-tool" aria-label="Table" aria-pressed={state.table} title={state.table ? 'Delete table' : 'Insert table'} onPointerDown={keep} onClick={run((c) => (state.table ? c.deleteTable() : c.insertTable({ rows: 3, cols: 2, withHeaderRow: true })))}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.5" y="4.5" width="13" height="11" rx="1.5" /><path d="M3.5 8.5h13M3.5 12h13M8 4.5v11M12 4.5v11" /></svg>
      </button>
      {state.table && (
        <>
          <button type="button" className="doc-tool text" onPointerDown={keep} onClick={run((c) => c.addRowAfter())}>+ Row</button>
          <button type="button" className="doc-tool text" onPointerDown={keep} onClick={run((c) => c.addColumnAfter())}>+ Column</button>
        </>
      )}
    </>
  );
}

/**
 * The open page, saved as you type. It shows as formatted text (headings, lists, checklists you tick, tables, #tags)
 * and is kept as plain Markdown, so the file opens anywhere and the agent's file tools read it as it is. The
 * Markdown button shows the file itself to type in. A page the assistant changed meanwhile is never overwritten.
 * `autoFocus` is off when the page opens in the pane beside the one you are working in, so typing stays where it was.
 * `review`: the agent's last turn changed this page; the editor offers to show what changed and to put it back.
 */
export function NoteEditor({ notes, autoFocus = true, onSelection, review }: { notes: NotesState; autoFocus?: boolean; onSelection?: (action: SelectionAction, text: string) => void; review?: { conversation: string } | null }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const section = useRef<HTMLElement>(null);
  const path = notes.page?.path;
  const focusOnOpen = useRef(autoFocus);
  focusOnOpen.current = autoFocus;
  const [source, setSource] = useState(readSource);
  const sourceNow = useRef(source);
  sourceNow.current = source;
  // The selection bar sits just above the selection.
  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null);
  const selectionFor = useRef(onSelection);
  selectionFor.current = onSelection;

  // The Markdown the editor last gave or was given, so a change from elsewhere is told from the person's typing.
  const known = useRef<string | null>(null);
  // The open page, for pictures to be read from its files folder; and files pasted or dropped on it.
  const pathNow = useRef(path);
  pathNow.current = path;
  const filesIn = useRef<(files: File[]) => void>(() => undefined);
  const image = useMemo(() => noteImage(() => pathNow.current), []);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TableKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown,
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' ? 'Title' : 'Start writing, or type # for a tag') }),
      NoteTags,
      image,
    ],
    content: '',
    editorProps: {
      attributes: { class: 'note-page', 'aria-label': 'Note text', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true' },
      // Files pasted or dropped on the page are added to it: pictures show, anything else is a link.
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
    },
    onUpdate: ({ editor: e, transaction }) => {
      if (transaction.getMeta('mobius-load')) return;
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
  });
  // The page's text, from the store: put into the editor when it did not come from the editor itself.
  useEffect(() => {
    if (!editor || editor.isDestroyed || source || notes.text === known.current) return;
    known.current = notes.text;
    editor.chain().setMeta('mobius-load', true).setContent(notes.text, { contentType: 'markdown', emitUpdate: false }).run();
  }, [editor, notes.text, path, source]);
  // A page opened from the list takes the cursor, at its end (a new page: under its title).
  useEffect(() => {
    if (!path || !focusOnOpen.current) return;
    if (sourceNow.current) area.current?.focus();
    else window.requestAnimationFrame(() => { if (editor && !editor.isDestroyed) editor.commands.focus('end'); });
  }, [path, editor]);
  useEffect(() => setSelection(null), [path, source]);
  const toggleSource = () => {
    const next = !source;
    setSource(next);
    keepSource(next);
    if (!next) known.current = null; // the editor reads the Markdown again, with what was typed in it
    window.requestAnimationFrame(() => { if (next) area.current?.focus(); else editor?.commands.focus(); });
  };

  // Where the cursor was last in the Markdown, so Insert puts things there even after its button took the focus.
  const caret = useRef<number | null>(null);
  useEffect(() => { caret.current = null; }, [path]);
  const [clipping, setClipping] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [insertProblem, setInsertProblem] = useState<string | null>(null);
  const recordedFor = useRef(0);
  /** A block of Markdown put in where the cursor is. */
  const put = (text: string) => {
    if (!sourceNow.current && editor && !editor.isDestroyed) {
      editor.chain().focus().insertContent(text, { contentType: 'markdown' }).run();
      return;
    }
    const field = area.current;
    const at = field && document.activeElement === field ? field.selectionStart : caret.current ?? notes.text.length;
    const done = insertBlock(notes.text, at, text);
    notes.edit(done.page);
    caret.current = done.cursor;
    window.requestAnimationFrame(() => { const f = area.current; if (f) { f.focus(); f.setSelectionRange(done.cursor, done.cursor); } });
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
  const recording = useDictation((words) => put(recordingBlock(words, recordedFor.current)), NOTE_RECORDING_SECONDS);
  recordedFor.current = recording.seconds;
  const clip = async (url: string) => {
    const address = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    const got = await window.mobius.reading?.fetch(address);
    if (!got) { setInsertProblem('Clipping is not available here.'); return; }
    if (!got.ok) { setInsertProblem(`That page could not be clipped: ${got.message}.`); return; }
    setClipping(null);
    setInsertProblem(null);
    put(clipBlock(got));
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
    const at = new Date(whenMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    setRestored({ was: notes.text, label: `${dayOf(whenMs, Date.now())}, ${at}` });
    notes.edit(content);
    setHistory(false);
  };
  // What the last turn changed on this page, line by line, read only while it is shown.
  const [diff, setDiff] = useState<DiffLine[] | null>(null);
  // The page as it was before the turn; null when the turn made the page.
  const [before, setBefore] = useState<string | null>(null);
  const [reviewProblem, setReviewProblem] = useState<string | null>(null);
  // Keep is for the whole turn, as in the strip under the conversation; a page of a kept turn shows no bar.
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
  }, [review?.conversation, path, notes.page?.base]); // eslint-disable-line react-hooks/exhaustive-deps
  const keepChanges = async () => {
    if (!review) return;
    const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
    const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
    if (id) keepTurn(id);
    setDiff(null);
    setKept(true);
  };
  useEffect(() => { setDiff(null); setBefore(null); setReviewProblem(null); }, [path, review?.conversation]);
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
  // The Notes menu's "Show what the agent changed".
  const showLatest = useRef(showChanges);
  showLatest.current = showChanges;
  useEffect(() => onCommand('show-changes', () => void showLatest.current()), []);
  const undoChanges = async () => {
    if (!review || !path) return;
    const result = await window.mobius.changes.undoFile(review.conversation, `notes/${path}`).catch(() => ({ ok: false as const, error: 'That could not be undone.' }));
    if (!result.ok) setReviewProblem(result.error);
    setDiff(null);
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
  const words = useMemo(() => countWords(notes.text.replace(/^# .*$/m, '').replace(/[#>*_`|[\]()-]/g, ' ')), [notes.text]);
  // "Edited" counts on from when the page was last saved, so it is read again every half minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);

  if (!notes.page) {
    // The editor stays mounted (hidden), so it is ready the moment a page opens.
    return (
      <section className="note-editor empty" aria-label="Note">
        <p className="note-empty">{notes.notebooks.length ? 'Choose a page, or make a new one.' : 'Make a notebook to start.'}</p>
        <EditorContent editor={editor} hidden />
      </section>
    );
  }
  const title = liveTitle(notes.text, notes.page.title || path?.split('/')[1]?.replace(/\.md$/, '') || '');
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  const edited = notes.page.base ? relativeTime(notes.page.base, Math.max(now, notes.page.base)) : '';
  return (
    <section ref={section} className="note-editor" aria-label={`Note: ${title}`} data-source={source || undefined}>
      {notes.status === 'conflict' && (
        <div className="note-conflict" role="alert">
          <span>The assistant changed this page while you were editing it.</span>
          <button type="button" className="btn" onClick={() => void notes.resolve(false)}>Use their version</button>
          <button type="button" className="btn primary" onClick={() => void notes.resolve(true)}>Keep mine</button>
        </div>
      )}
      {history && path && <NoteHistory path={path} text={notes.text} onRestore={restore} onClose={() => setHistory(false)} />}
      {diff === null && !history && (
        <div className="doc-toolbar note-format" role="toolbar" aria-label="Format">
          {editor && !source && <FormatButtons editor={editor} onLink={() => setLinking('')} />}
          {source && (
            <>
              <button type="button" className="doc-tool text" onPointerDown={keep} onClick={() => put(CHECKLIST)}>Checklist</button>
              <button type="button" className="doc-tool text" onPointerDown={keep} onClick={() => put(TABLE)}>Table</button>
            </>
          )}
          <span className="doc-tool-sep" />
          <div className="note-insert" role="group" aria-label="Insert">
            {recording.state === 'idle' ? (
              <button type="button" className="doc-tool" aria-label="Record" title="Record what is said and keep the words in this page" onPointerDown={keep} onClick={recording.toggle}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7.5" y="3" width="5" height="9" rx="2.5" /><path d="M5 9.5a5 5 0 0 0 10 0M10 14.5V17" /></svg>
              </button>
            ) : (
              <button type="button" className="note-insert-btn" data-recording={recording.state === 'recording' || undefined} disabled={recording.state === 'transcribing'} title="Stop and keep the words in this page" onPointerDown={keep} onClick={recording.toggle}>
                {recording.state === 'recording' ? `Stop · ${Math.floor(recording.seconds / 60)}:${String(recording.seconds % 60).padStart(2, '0')}` : 'Writing it down…'}
              </button>
            )}
            {window.mobius.notes?.attach && (
              <>
                <button type="button" className="doc-tool" aria-label="Picture or file" title={adding > 0 ? 'Adding…' : 'Add a picture or a file to this page (or paste or drop one)'} aria-busy={adding > 0 || undefined} disabled={adding > 0} onPointerDown={keep} onClick={() => picker.current?.click()}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4.5" width="14" height="11" rx="2" /><circle cx="7.5" cy="8.5" r="1.3" /><path d="m3.5 14 4-3.5 3 2.5 2.5-2 3.5 3" /></svg>
                </button>
                <input ref={picker} type="file" multiple hidden aria-label="Choose files to add" onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; void addFiles(files); }} />
              </>
            )}
            <button type="button" className="doc-tool" aria-label="Clip from web" title="Clip a web page into this page" aria-expanded={clipping !== null} onPointerDown={keep} onClick={() => setClipping((c) => (c === null ? '' : null))}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5" /><path d="M3.5 10h13M10 3.5c-2 2-2.8 4.2-2.8 6.5s.8 4.5 2.8 6.5M10 3.5c2 2 2.8 4.2 2.8 6.5s-.8 4.5-2.8 6.5" /></svg>
            </button>
          </div>
          <span className="spacer" />
          {window.mobius.notes?.versions && (
            <button type="button" className="doc-tool" aria-label="History" title="Earlier versions of this page" onClick={() => setHistory(true)}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.8 10a6.2 6.2 0 1 0 1.9-4.5M3.5 3.5v3h3M10 6.5V10l2.5 1.6" /></svg>
            </button>
          )}
          <button type="button" className="doc-tool text note-source" aria-pressed={source} title={source ? 'Show the page formatted' : 'Show and type the Markdown the page is kept as'} onClick={toggleSource}>Markdown</button>
          {clipping !== null && (
            <form className="note-clip" onSubmit={(e) => { e.preventDefault(); if (clipping.trim()) void clip(clipping); }}>
              <input autoFocus aria-label="Address to clip" placeholder="Paste a link" value={clipping} onChange={(e) => setClipping(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setClipping(null); }} />
              <button type="submit" className="btn" disabled={!clipping.trim()}>Clip</button>
            </form>
          )}
          {linking !== null && (
            <form className="note-clip" onSubmit={addLink}>
              <input autoFocus aria-label="Link to" placeholder="Paste a link" value={linking} onChange={(e) => setLinking(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setLinking(null); editor?.commands.focus(); } }} />
              <button type="submit" className="btn" disabled={!linking.trim()}>Link</button>
            </form>
          )}
          {(insertProblem ?? recording.problem) && <span className="review-problem" role="alert">{insertProblem ?? recording.problem}</span>}
        </div>
      )}
      {restored && !history && (
        <div className="note-restored" role="status">
          <span>Restored the version from {restored.label}.</span>
          <button type="button" className="review-btn" onClick={() => { notes.edit(restored.was); setRestored(null); }}>Undo</button>
          <button type="button" className="review-btn" aria-label="Dismiss" onClick={() => setRestored(null)}>OK</button>
        </div>
      )}
      {review && !kept && !history && (
        <div className="note-review" role="status">
          <span className="review-dot" aria-hidden="true" />
          <span className="note-review-text">{diff ? (() => { const c = diffCounts(diff); return `${c.added} ${c.added === 1 ? 'line' : 'lines'} added, ${c.removed} removed in Mobius's last turn`; })() : "Mobius changed this page in its last turn."}<WhyThis conversation={review.conversation} /></span>
          <button type="button" className="review-btn" aria-pressed={diff !== null} onClick={() => (diff ? setDiff(null) : void showChanges())}>{diff ? 'Back to editing' : 'Show changes'}</button>
          <ReviewActions onKeep={keepChanges} onDiscard={undoChanges} discardTitle="Put this page back as it was before that turn" keepTitle="Keep what the agent changed in that turn" />
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
      <div className="note-scroll" hidden={diff !== null || history}>
        <p className="note-meta">
          {edited && <span>Edited {edited.toLowerCase() === 'just now' ? 'just now' : edited}</span>}
          <span>{words === 1 ? '1 word' : `${words} words`}</span>
          {tags.map((tag) => (
            <button key={tag} type="button" className="note-meta-tag" title={`Show every note tagged #${tag}`} onClick={() => showTag(tag)}>#{tag}</button>
          ))}
        </p>
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
      </div>
      {selection && onSelection && (
        <div className="selection-bar" role="toolbar" aria-label="Selected text" style={{ top: selection.top, left: selection.left }}>
          {ACTIONS.map((action) => (
            <button key={action.id} type="button" className="selection-btn" data-action={action.id} title={action.title}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => { onSelection(action.id, selection.text); setSelection(null); }}>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
