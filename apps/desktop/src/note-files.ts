import Image from '@tiptap/extension-image';

/** A link in a page that points beside it (`Battery%20files/cell.png`), not to the web or another place. */
export const isPageFile = (src: string) => !!src && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('/') && !src.startsWith('#');

/** Files read for the page once, by page and link, so typing does not read them again. */
const shown = new Map<string, Promise<string | null>>();
export function fileAddress(page: string, src: string): Promise<string | null> {
  if (!isPageFile(src)) return Promise.resolve(/^https:\/\//i.test(src) || src.startsWith('data:image/') ? src : null);
  const key = `${page}\n${src}`;
  let got = shown.get(key);
  if (!got) {
    const read = window.mobius.notes?.asset;
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

/** Pictures in a page: kept in Markdown with the link as written (beside the page), shown from the page's files. */
export function noteImage(page: () => string | undefined) {
  return Image.extend({
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
          void fileAddress(at, src).then((url) => {
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
