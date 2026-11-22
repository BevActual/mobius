import { useEffect, useRef, type MutableRefObject } from 'react';
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import { changeGroups, type DiffLine } from './line-diff';
import { placeChanges } from './docs-view';
import './change-blocks.css';
import { afterPaint } from './ui/frame';
import { MARK_PATHS } from './MobiusMark';

/*
 * Mobius's change block, shared by every page that is written in the editor (Docs, Notes): each change of the agent's
 * last turn drawn where it is, as one dashed indigo block, with Discard, Try another and Keep for that change alone.
 */

/** What Mobius's last turn changed, as the page shows it: each change one dashed block where it is (the blocks it
 *  added, with the words it took out struck through at the top), and floating under it Discard, Try another and Keep for that
 *  change alone. Read from `look` when told to look again. */
export interface ChangeView { diff: DiffLine[]; render: (markdown: string) => string | null; keep: (group: number) => void; discard: (group: number) => void; again?: (group: number) => void; /** Keeps every change at once: offered in each bar when there are several. */ keepAll?: () => void; /** Mobius is still at work: its changes show, and their answers wait for the turn's end. */ waiting?: boolean; /** Changes taller than the page's view: their answers show at the top too. */ tall?: ReadonlySet<number> }
export const changeKey = new PluginKey<DecorationSet>('doc-changes');
/** The words a change took out, struck through: the top of its dashed block, or all of it when nothing was added. */
function changeWas(group: number, removed: string[], view: ChangeView, whole: boolean): HTMLElement {
  const old = document.createElement('div');
  old.className = 'doc-change-old';
  old.contentEditable = 'false';
  old.dataset.group = String(group);
  if (whole) old.dataset.whole = '';
  // Drawn as the page draws it (headings, lists, bold), through the editor's own schema; as lines when it will not read.
  const html = view.render(removed.join('\n'));
  if (html !== null) old.innerHTML = html;
  else for (const line of removed) { const p = document.createElement('p'); p.textContent = line || ' '; old.append(p); }
  return old;
}
/** The Mobius mark, drawn without React for the bar's who. */
function mark(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'mobius-mark');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'width:14px;height:14px;fill:currentColor;stroke:none';
  for (const d of MARK_PATHS) { const path = document.createElementNS(ns, 'path'); path.setAttribute('d', d); svg.append(path); }
  return svg;
}
/** The floating bar under a change's block (the panel look, as ReviewBar's floating ChangeBar draws it): the Mobius
 *  mark and who did it, then Discard, Try another and Keep (and Keep all when there are several). */
function changeNote(group: number, removed: boolean, added: boolean, view: ChangeView, look: () => ChangeView | null, several = false): HTMLElement {
  const note = document.createElement('div');
  note.className = 'doc-change change-float';
  if (added && view.tall?.has(group)) note.dataset.tall = '';
  note.contentEditable = 'false';
  note.dataset.group = String(group);
  const bar = document.createElement('div');
  bar.className = 'change-float-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', !added ? 'Words Mobius took out' : removed ? 'A change Mobius made' : 'Words Mobius added');
  const who = document.createElement('span');
  who.className = 'change-float-who';
  who.append(mark(), !added ? 'Mobius took this out' : removed ? 'Mobius changed this' : 'Mobius added this');
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
  if (view.waiting) { note.append(bar); return note; }
  bar.append(button('Discard', 'Discard this change', 'discard', () => look()?.discard(group)));
  if (view.again) bar.append(button('Try another', 'Try another way for this change', 'again', () => look()?.again?.(group)));
  bar.append(button('Keep', 'Keep this change', 'keep', () => look()?.keep(group)));
  if (several && view.keepAll) bar.append(button('Keep all', 'Keep every change Mobius made here', 'keep', () => look()?.keepAll?.()));
  note.append(bar);
  return note;
}
function changeDecorations(doc: PmNode, look: () => ChangeView | null): DecorationSet {
  const view = look();
  if (!view) return DecorationSet.empty;
  // Each text block, and the top-level block it sits in: a change is boxed at the top level, so a list or a quote
  // draws as one block rather than an outline round each item.
  const tops: { from: number; to: number }[] = [];
  doc.forEach((node, offset) => { tops.push({ from: offset, to: offset + node.nodeSize }); });
  const blocks: { top: number; text: string }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const $pos = doc.resolve(pos);
    const from = $pos.depth === 0 ? pos : $pos.before(1);
    blocks.push({ top: tops.findIndex((t) => t.from === from), text: node.textContent.replace(/\s+/g, ' ').trim() });
    return false;
  });
  const groups = changeGroups(view.diff);
  const { added, notes } = placeChanges(view.diff, groups, blocks.map((b) => b.text));
  const marks: Decoration[] = [];
  const removedOf = (g: number) => {
    const removed = view.diff.filter((l, i) => groups[i] === g && l.kind === 'removed').map((l) => l.text);
    while (removed.length && !removed[removed.length - 1]!.trim()) removed.pop();
    while (removed.length && !removed[0]!.trim()) removed.shift();
    return removed;
  };
  const topGroup = new Map<number, number>();
  for (const [b, g] of added) if (blocks[b]!.top >= 0) topGroup.set(blocks[b]!.top, g);
  // The added blocks of one change draw as one dashed block: its top on the first (unless struck words sit above),
  // its bottom on the last.
  const firstOf = new Map<number, number>();
  for (const [t, g] of topGroup) if (!firstOf.has(g) || t < firstOf.get(g)!) firstOf.set(g, t);
  for (const [t, g] of topGroup) {
    const top = topGroup.get(t - 1) !== g && (t !== firstOf.get(g) || removedOf(g).length === 0);
    const bottom = topGroup.get(t + 1) !== g;
    marks.push(Decoration.node(tops[t]!.from, tops[t]!.to, { class: 'doc-change-new', 'data-group': String(g), ...(top ? { 'data-top': '' } : {}), ...(bottom ? { 'data-bottom': '' } : {}) }));
  }
  for (const [g, at] of notes) {
    const removed = removedOf(g);
    const own = [...topGroup].filter(([, og]) => og === g).map(([t]) => t);
    // The same change drawn while Mobius is at work has no answers: a new key, so they come when it is done.
    const key = `${g}-${removed.join('\u0000').length}${view.waiting ? '-w' : ''}`;
    const opts = (side: number, k: string) => ({ side, key: `change-${k}-${key}`, stopEvent: () => true, ignoreSelection: true });
    if (own.length) {
      // The answers float under the change, once it has been read, in Notes and Docs alike.
      const tall = view.tall?.has(g) ? '-tall' : '';
      if (removed.length) marks.push(Decoration.widget(tops[Math.min(...own)]!.from, () => changeWas(g, removed, view, false), opts(-1, 'was')));
      marks.push(Decoration.widget(tops[Math.max(...own)]!.to, () => changeNote(g, removed.length > 0, true, view, look, notes.size > 1), opts(1, `note${tall}${notes.size > 1 ? '-n' : ''}`)));
      continue;
    }
    const near = at.block < 0 ? undefined : tops[blocks[at.block]!.top];
    const pos = !near ? 0 : at.before ? near.from : near.to;
    const side = at.before ? -2 : 1;
    if (removed.length) marks.push(Decoration.widget(pos, () => changeWas(g, removed, view, true), opts(side, `was-${pos}`)));
    marks.push(Decoration.widget(pos, () => changeNote(g, removed.length > 0, false, view, look, notes.size > 1), opts(side + 1, `note-${pos}${notes.size > 1 ? '-n' : ''}`)));
  }
  return DecorationSet.create(doc, marks);
}
export const changeBlocks = (look: () => ChangeView | null) => Extension.create({
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

/**
 * Draws the changes again whenever `key` (what should show) changes, and measures which are taller than the scroller,
 * so their answers stay pinned at the bottom of the view while they scroll by. Returns those changes, for the page's ChangeView.
 */
export function useTallChanges(editor: Editor | null, scroller: HTMLElement | null, key: string, changesNow: MutableRefObject<ChangeView | null>): MutableRefObject<ReadonlySet<number>> {
  const tallGroups = useRef<ReadonlySet<number>>(new Set());
  useEffect(() => { if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(changeKey, true)); }, [editor, key]);
  useEffect(() => {
    if (!key || !editor || !scroller) { tallGroups.current = new Set(); return undefined; }
    const measure = () => {
      if (editor.isDestroyed) return;
      const span = new Map<number, { top: number; bottom: number }>();
      for (const el of editor.view.dom.querySelectorAll<HTMLElement>('.doc-change-new[data-group], .doc-change-old[data-group], .doc-change[data-group]')) {
        const g = Number(el.dataset.group);
        const r = el.getBoundingClientRect();
        const was = span.get(g);
        span.set(g, { top: Math.min(was?.top ?? r.top, r.top), bottom: Math.max(was?.bottom ?? r.bottom, r.bottom) });
      }
      const room = scroller.clientHeight - 48;
      const tall = new Set([...span].filter(([, s]) => s.bottom - s.top > room).map(([g]) => g));
      const was = tallGroups.current;
      if (tall.size === was.size && [...tall].every((g) => was.has(g))) return;
      tallGroups.current = tall;
      if (changesNow.current) changesNow.current = { ...changesNow.current, tall };
      editor.view.dispatch(editor.state.tr.setMeta(changeKey, true));
    };
    // A pinned bar waits at its change's end until the top of the change has come up into the view.
    const unpin = () => {
      if (editor.isDestroyed) return;
      const bottom = scroller.getBoundingClientRect().bottom;
      for (const note of editor.view.dom.querySelectorAll<HTMLElement>('.doc-change[data-tall]')) {
        const start = editor.view.dom.querySelector<HTMLElement>(`:is(.doc-change-new, .doc-change-old)[data-group="${note.dataset.group}"]`);
        const past = !!start && start.getBoundingClientRect().top > bottom - note.offsetHeight;
        if (past !== note.hasAttribute('data-past')) note.toggleAttribute('data-past', past);
      }
    };
    const cancel = afterPaint(() => { measure(); unpin(); });
    const resized = new ResizeObserver(() => measure());
    resized.observe(scroller);
    scroller.addEventListener('scroll', unpin, { passive: true });
    return () => { cancel(); resized.disconnect(); scroller.removeEventListener('scroll', unpin); };
  }, [editor, scroller, key]);

  return tallGroups;
}
