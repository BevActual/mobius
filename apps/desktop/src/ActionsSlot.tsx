import { createContext, useContext, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/**
 * The Actions slot (Instrument, "The Mobius panel": what it can do here). The resting panel has one list of actions
 * for what is open: an app's own actions first (Mail's Get to zero), then Mobius's ideas, at most four, each with its
 * number key. An app puts a row there with <AppAction>; where there is no list (a chat under way) it says so, and the
 * app shows its own button instead.
 */
export const ActionsSlotContext = createContext<HTMLElement | null>(null);

/** Where an app's actions go now, or null when the panel shows no list. */
export const useActionsSlot = (): HTMLElement | null => useContext(ActionsSlotContext);

/** One row of the list: a 16px line icon, the words, and its number key (drawn by the list). */
export function ActionRow({ icon, label, title, onRun }: { icon?: ReactNode; label: string; title?: string | undefined; onRun: () => void }) {
  return (
    <button type="button" className="action-row" title={title} onClick={onRun}>
      <svg className="action-icon" viewBox="0 0 20 20" aria-hidden="true">{icon ?? IDEA_ICON}</svg>
      <span className="action-label">{label}</span>
      <kbd className="ui-keycap action-key" aria-hidden="true" />
    </button>
  );
}

/** An app's action, placed in the panel's list. */
export function AppAction({ slot, ...row }: { slot: HTMLElement; icon?: ReactNode; label: string; title?: string; onRun: () => void }) {
  return createPortal(<ActionRow {...row} />, slot);
}

/** Mobius's ideas: a speech line. */
export const IDEA_ICON = <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3h0A1.5 1.5 0 0 1 4 11.5z" />;

/** The number key for an action (1 to 4), when no text is being typed: the row it picks, or null. */
export function actionKey(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }, typing: boolean): number | null {
  if (typing || event.ctrlKey || event.metaKey || event.altKey) return null;
  return /^[1-4]$/.test(event.key) ? Number(event.key) : null;
}

/** The most rows the list shows: one per number key. */
export const ACTION_LIMIT = 4;

/** How many of each kind the list shows: the app's own first, then ideas fill what is left, four in all. */
export function actionsShown(app: number, ideas: number): { app: number; ideas: number } {
  const own = Math.min(app, ACTION_LIMIT);
  return { app: own, ideas: Math.min(ideas, ACTION_LIMIT - own) };
}

/** Hide the rows past four, whenever the app or the ideas change what is in the list. */
function useActionLimit(list: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const element = list.current;
    if (!element) return undefined;
    const apply = () => {
      const app = [...element.querySelectorAll<HTMLElement>(':scope > .actions-app > .action-row')];
      const ideas = [...element.querySelectorAll<HTMLElement>(':scope > .actions-ideas > .action-row')];
      const shown = actionsShown(app.length, ideas.length);
      app.forEach((row, i) => { row.hidden = i >= shown.app; });
      ideas.forEach((row, i) => { row.hidden = i >= shown.ideas; });
    };
    apply();
    const watch = new MutationObserver(apply);
    watch.observe(element, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [list]);
}

/** The list itself: a heading, then the app's rows and the ideas, numbered in order, four at most. */
export function ActionsList({ title, appSlot, ideaSlot }: { title: string; appSlot: (el: HTMLDivElement | null) => void; ideaSlot: (el: HTMLDivElement | null) => void }) {
  const list = useRef<HTMLDivElement | null>(null);
  useActionLimit(list);
  return (
    <div className="actions" role="group" aria-label="Suggestions">
      <h3 className="resting-title">{title}</h3>
      <div ref={list} className="actions-list">
        <div ref={appSlot} className="actions-app" />
        <div ref={ideaSlot} className="actions-ideas" />
      </div>
    </div>
  );
}
