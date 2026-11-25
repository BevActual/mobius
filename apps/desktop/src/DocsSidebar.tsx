import type { ReactNode } from 'react';
import type { NotesState } from './useNotes';
import type { Start } from './SideNew';
import { NotesSidebar, type SidebarWords } from './NotesSidebar';

/** What the Documents panel calls things: folders of documents, made in Documents when there is no folder yet. */
export const DOCS_WORDS: SidebarWords = { app: 'Docs', group: 'folder', groups: 'Folders', item: 'document', items: 'documents', about: 'Documents are kept as Markdown files in your workspace, so other apps and the agent can open them too.', defaultGroup: 'Documents' };

/**
 * Docs' Documents panel: the shared list every app keeping pages uses (NotesSidebar), so a document moves between
 * folders, goes to the Trash with Undo, and a folder is renamed or trashed from its ⋯, the same as a note
 * (docs/design/docs.md). Its headings are in the Outline panel, in the right dock.
 */
export function DocsSidebar({ docs, pin = null, ...rest }: {
  docs: NotesState;
  /** The button that attaches or floats the list; the shell's head has it now, so it is not drawn here. */
  pin?: ReactNode;
  /** Documents Mobius's last turn changed, marked until the turn is kept or undone. */
  changed?: ReadonlySet<string>;
  starts?: readonly Start[];
  onStart?: (prompt: string) => void;
  /** A folder synced with a drive shows the sync glyph after its name (Files pairs it). */
  synced?: (folder: string) => ReactNode;
}) {
  return <NotesSidebar notes={docs} words={DOCS_WORDS} pin={pin} {...rest} />;
}
