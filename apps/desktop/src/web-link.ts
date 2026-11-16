/**
 * A web link clicked in an app (a note, say): the shell shows it in the Browser, in the tab it is already open in or a
 * new one, so clicking it twice never opens it twice. With Ctrl (Cmd on a Mac) it opens there without leaving the app.
 */
export const WEB_LINK_EVENT = 'mobius:web-link';

export interface WebLink {
  url: string;
  /** Open it without switching to the Browser. */
  background: boolean;
}

export function openWebLink(url: string, background = false) {
  window.dispatchEvent(new CustomEvent<WebLink>(WEB_LINK_EVENT, { detail: { url, background } }));
}

/** The same page, give or take a trailing slash or a #part: a page opens once. */
export function sameUrl(a: string, b: string): boolean {
  const plain = (u: string) => u.replace(/#.*$/, '').replace(/\/+$/, '');
  return plain(a) === plain(b);
}
