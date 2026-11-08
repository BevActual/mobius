/**
 * Commands the menus send to a part of the app that keeps its own state (the notebook naming field, a note's changes
 * view). The part listens while it is on screen; nothing happens when it is not.
 */
export type AppCommand = 'new-notebook' | 'new-folder' | 'new-list' | 'show-changes' | 'new-calendar' | 'new-project' | 'new-file';
const EVENT = 'mobius:command';

export const sendCommand = (command: AppCommand): void => { window.dispatchEvent(new CustomEvent<AppCommand>(EVENT, { detail: command })); };

/** Calls `handler` for `command` while subscribed; returns the unsubscribe. */
export function onCommand(command: AppCommand, handler: () => void): () => void {
  const listener = (event: Event) => { if ((event as CustomEvent<AppCommand>).detail === command) handler(); };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
