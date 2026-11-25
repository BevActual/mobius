import Image from '@tiptap/extension-image';
import { Marked, marked } from 'marked';
import { linkTarget } from './note-kept';

/** A link in a page that points beside it (`Battery%20files/cell.png`), not to the web or another place. */
export const isPageFile = (src: string) => !!src && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('/') && !src.startsWith('#');

/** Files read for the page once, by page and link, so typing does not read them again. */
const shown = new Map<string, Promise<string | null>>();
export function fileAddress(page: string, src: string, kind: 'notes' | 'docs' = 'notes'): Promise<string | null> {
  if (!isPageFile(src)) return Promise.resolve(/^https:\/\//i.test(src) || src.startsWith('data:image/') ? src : null);
  const key = `${kind}\n${page}\n${src}`;
  let got = shown.get(key);
  if (!got) {
    const read = window.mobius[kind]?.asset;
    got = read ? read(page, src).then((r) => ('dataUrl' in r ? r.dataUrl : null)).catch(() => null) : Promise.resolve(null);
    shown.set(key, got);
    void got.then((v) => { if (v === null) shown.delete(key); });
  }
  return got;
}

/** The Markdown for a file added to a page: a picture shows in it, anything else is a link to the file. */
export function fileMarkdown(ref: string, name: string, image: boolean): string {
  const label = name.replace(/[[\]]/g, '');
  return image ? `![${label}](${ref})` : `[${label}](${ref})`;
}

/** A file as base64 (a `data:` address), for the bridge. */
export function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('unreadable'));
    reader.readAsDataURL(file);
  });
}

/**
 * A Markdown reader for one editor. The shared `marked` keeps every tokenizer an editor registers, and through them
 * every editor that was ever open; this one goes with its editor. `getDefaults` is the shared one's (the type asks for
 * the module's function, whose other parts the editor doesn't use).
 */
export function ownMarked(): typeof marked {
  return Object.assign(new Marked(), { getDefaults: marked.getDefaults }) as unknown as typeof marked;
}

/** Pictures in a page: kept in Markdown with the link as written (beside the page), shown from the page's files. */
export function noteImage(page: () => string | undefined, kind: 'notes' | 'docs' = 'notes') {
  return Image.extend({
    // A picture beside the page whose name has a space is written in angle brackets, as other Markdown readers need.
    renderMarkdown: (node) => {
      const src = linkTarget(String(node.attrs?.src ?? ''));
      const alt = String(node.attrs?.alt ?? '');
      const title = String(node.attrs?.title ?? '');
      return title ? `![${alt}](${src} "${title.replace(/"/g, '\\"')}")` : `![${alt}](${src})`;
    },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement('figure');
        dom.className = 'note-figure';
        const img = document.createElement('img');
        img.draggable = false;
        dom.append(img);
        const show = (src: string, alt: string) => {
          img.alt = alt;
          img.dataset.src = src;
          dom.dataset.missing = '';
          const at = page();
          if (!at) return;
          void fileAddress(at, src, kind).then((url) => {
            if (img.dataset.src !== src) return;
            if (url) { img.src = url; delete dom.dataset.missing; }
            else { img.removeAttribute('src'); dom.dataset.missing = 'true'; dom.title = `${src.replace(/%20/g, ' ')} is not there`; }
          });
        };
        show(String(node.attrs.src ?? ''), String(node.attrs.alt ?? ''));
        return {
          dom,
          update: (next) => {
            if (next.type !== node.type) return false;
            if (next.attrs.src !== img.dataset.src || next.attrs.alt !== img.alt) show(String(next.attrs.src ?? ''), String(next.attrs.alt ?? ''));
            return true;
          },
        };
      };
    },
  }).configure({ inline: false, allowBase64: false });
}
