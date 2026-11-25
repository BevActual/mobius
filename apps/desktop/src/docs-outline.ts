import { useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';

/**
 * The open document's outline, shared from the page (DocEditor) to Docs' sidebar, which lists it under the document as
 * the timeless mock has it. The page publishes; the sidebar reads. Nothing is kept.
 */
export interface DocOutline {
  /** The document it belongs to. */
  path: string;
  /** Its headings below the title, in order. */
  items: readonly { level: number; text: string }[];
  /** The one whose part of the document is in view, or -1. */
  current: number;
  /** Moves the page to a heading. */
  go: (index: number) => void;
}

let shown: DocOutline | null = null;
const listeners = new Set<() => void>();

export function publishOutline(next: DocOutline | null): void {
  shown = next;
  for (const listen of listeners) listen();
}

export function useDocOutline(): DocOutline | null {
  return useSyncExternalStore(
    (listen) => { listeners.add(listen); return () => { listeners.delete(listen); }; },
    () => shown,
  );
}

/** Goes to a heading from the outline: the caret into it, and the heading at the top of the page, as Google Docs does
 *  (scrolled only as far as needed, one further down would sit at the bottom edge). */
export function toHeading(editor: Editor, pos: number): void {
  editor.chain().focus(undefined, { scrollIntoView: false }).setTextSelection(pos + 1).run();
  (editor.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView?.({ block: 'start' });
}
