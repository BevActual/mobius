import { fileAddress, isPageFile } from './note-files';

const escapeHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The look an exported page takes: plain, readable, light and dark. */
const EXPORT_CSS = `body{margin:0;background:#fff;color:#1d1d1f;font:16px/1.6 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI Variable","Segoe UI",system-ui,sans-serif}
main{max-width:720px;margin:48px auto;padding:0 24px}h1{font-size:30px;line-height:1.15;letter-spacing:-.02em}h2{font-size:21px}h3{font-size:17px}
img{max-width:100%;border-radius:10px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d2d2d7;padding:6px 8px;text-align:left}
blockquote{margin:0;padding-left:14px;border-left:3px solid #c7c7cc;color:#6e6e73}code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em}
ul[data-type=taskList]{list-style:none;padding-left:2px}ul[data-type=taskList] li{display:flex;gap:8px}ul[data-type=taskList] li p{margin:0}
@media (prefers-color-scheme:dark){body{background:#1c1c1e;color:#f5f5f7}th,td{border-color:#3a3a3c}}`;

/**
 * The page as one web page to send or keep: its formatted text, with its pictures inside it (so nothing is left
 * behind) and links to other notes kept as their words.
 */
export async function pageAsHtml(title: string, bodyHtml: string, page: string): Promise<string> {
  const doc = new DOMParser().parseFromString(`<main>${bodyHtml}</main>`, 'text/html');
  for (const img of [...doc.querySelectorAll('img')]) {
    const src = img.getAttribute('src') ?? '';
    const url = await fileAddress(page, src);
    if (url) img.setAttribute('src', url);
    else img.remove();
  }
  for (const a of [...doc.querySelectorAll('a[href]')]) {
    const href = a.getAttribute('href') ?? '';
    if (isPageFile(href)) a.replaceWith(...a.childNodes);
  }
  for (const input of [...doc.querySelectorAll('input')]) input.setAttribute('disabled', '');
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${EXPORT_CSS}</style></head><body>${doc.body.innerHTML}</body></html>\n`;
}

/** Copy the page as formatted text, with its Markdown as the plain text beside it. */
export async function copyFormatted(html: string, markdown: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([markdown], { type: 'text/plain' }) })]);
      return true;
    }
    await navigator.clipboard.writeText(markdown);
    return true;
  } catch {
    return false;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
