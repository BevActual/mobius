import type { Editor } from '@tiptap/react';
import { EditorState } from '@tiptap/pm/state';

/**
 * Puts a page's text from the store into the editor, outside the undo history, so Ctrl+Z never takes the page back
 * to what was there before it loaded (an empty page, or the page open before) and then saves that over the file.
 * A page just opened (`fresh`) also starts its history anew; a page changed from outside keeps the edits made here.
 */
export function loadIntoEditor(editor: Editor, text: string, fresh: boolean): void {
  editor.chain().setMeta('mobius-load', true).setMeta('addToHistory', false).setContent(text, { contentType: 'markdown', emitUpdate: false }).run();
  if (!fresh) return;
  const { doc, selection, plugins } = editor.state;
  editor.view.updateState(EditorState.create({ doc, selection, plugins }));
}
