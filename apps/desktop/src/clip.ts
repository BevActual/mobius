import { isNotesFailure, type ContextItem } from '@mobius/shared';

/** The page web clippings are kept on. */
export const CLIPPINGS = 'Clippings';

/** A selection added to the end of a page: quoted, then a link back to where it came from. */
export function withClipping(page: string, item: ContextItem, when: Date = new Date()): string {
  const quote = item.text.trim().split(/\r?\n/).map((line) => `> ${line}`.trimEnd()).join('\n');
  const title = item.title.replace(/^Selected on /, '').replace(/[[\]]/g, '');
  const day = when.toISOString().slice(0, 10);
  const source = /^https?:\/\//.test(item.source) ? `[${title}](${item.source})` : title;
  return `${page.trimEnd()}\n\n${quote}\n\n— ${source}, ${day}\n`;
}

/** Keep a selection on the Clippings page, making the page (and a notebook, if there is none) the first time. */
export async function clipToNotes(item: ContextItem): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const api = window.mobius.notes;
  if (!api) return { ok: false, error: 'Notes is not available.' };
  const listed = await api.list();
  if (isNotesFailure(listed)) return { ok: false, error: listed.message };
  const notebooks = listed;
  let path = notebooks.flatMap((nb) => nb.pages).find((page) => page.path.endsWith(`/${CLIPPINGS}.md`))?.path;
  if (!path) {
    let notebook = notebooks[0]?.name;
    if (!notebook) {
      const made = await api.createNotebook(CLIPPINGS);
      if (isNotesFailure(made)) return { ok: false, error: made.message };
      notebook = made.name;
    }
    const page = await api.createPage(notebook, CLIPPINGS);
    if (isNotesFailure(page)) return { ok: false, error: page.message };
    path = page.path;
  }
  const current = await api.read(path);
  if (isNotesFailure(current)) return { ok: false, error: current.message };
  const saved = await api.save(path, withClipping(current.content, item), current.modified);
  return isNotesFailure(saved) ? { ok: false, error: saved.message } : { ok: true, path };
}
