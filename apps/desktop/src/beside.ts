/**
 * Open beside (docs/design/pieces.md): an app asks the shell to show another app in the other pane of split view, at
 * something in it, while the asking app keeps the keyboard. The first use is Code's preview: the project's page in the
 * Browser beside the editor. The shell does the rest; the asking app only sends this event.
 */
export const BESIDE_EVENT = 'mobius:open-beside';

export type Beside = { app: 'browser'; url: string };

export function openBeside(what: Beside): void {
  window.dispatchEvent(new CustomEvent<Beside>(BESIDE_EVENT, { detail: what }));
}

/** Only pages on this computer or on the web: nothing that could run as a file or script. */
export function besideUrlOk(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
