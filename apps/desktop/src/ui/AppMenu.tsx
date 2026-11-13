import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MenuEntry } from './Menu';

/**
 * The open app's own commands, in the one ⋯ menu at the toolbar's end (the shell's menus, as its first menu), so a
 * toolbar never has a second ⋯ of the app's own. Written in the app's file, the way ToolbarControls fills the
 * toolbar: `<AppMenu label="Message" entries={[…]} />`. The entries are read when chosen, so they may change freely.
 */
export interface AppMenuState { label: string; entries: MenuEntry[] }

const AppMenuContext = createContext<((menu: AppMenuState | null) => void) | null>(null);

/** Held by the frame: the open app's menu, handed to the toolbar's end. */
export function useAppMenuHost(): [AppMenuState | null, (menu: AppMenuState | null) => void] {
  return useState<AppMenuState | null>(null);
}
export const AppMenuProvider = AppMenuContext.Provider;

/** What the menu shows, as text: it is told again only when this changes, not on every render of the app. */
const shape = (label: string, entries: MenuEntry[]) => JSON.stringify([label, entries.map((e) => [e.label, e.keys, e.disabled, e.checked, e.danger, e.separated])]);

export function AppMenu({ label, entries }: { label: string; entries: MenuEntry[] }): ReactNode {
  const set = useContext(AppMenuContext);
  const latest = useRef(entries);
  latest.current = entries;
  const now = shape(label, entries);
  useEffect(() => {
    if (!set) return undefined;
    // Each row runs what the app gives now, so a row never runs a stale closure.
    set({ label, entries: latest.current.map((e, i) => ({ ...e, run: () => latest.current[i]?.run() })) });
    return undefined;
  }, [set, now]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => set?.(null), [set]);
  return null;
}
