import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserTabState, LaunchChoice, LauncherAnswer } from '@mobius/shared';
import { Launcher, type FoundItem } from './Launcher';
import { useAppearance } from './useAppearance';
import { findApp, type AppId } from './apps';

/** True in the launcher's own window. The shell gives it the label `launcher`; `?view=launcher` shows it in a plain browser. */
export function isLauncherWindow(): boolean {
  const meta = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__?.metadata;
  if (meta?.currentWindow?.label === 'launcher') return true;
  try { return new URLSearchParams(window.location.search).get('view') === 'launcher'; } catch { return false; }
}

/**
 * The launcher from anywhere: the same launcher as Ctrl+K, alone in a small window over whatever app is in front.
 * Choosing something hands it to the main window, which comes forward and opens it. Escape, or clicking elsewhere,
 * puts it away and the app you were in has the keyboard again.
 *
 * What it finds in your apps, and the commands, come from the main window, which holds them: it asks as you type, and
 * what is chosen goes back by id.
 */
export function LauncherWindow() {
  const appearance = useAppearance();
  const [shown, setShown] = useState(true);
  const [tabs, setTabs] = useState<BrowserTabState[]>([]);
  const api = window.mobius.launcherWindow;
  const root = useRef<HTMLDivElement>(null);

  // Each time it is shown it starts empty, with the keyboard in the field, and the open pages as they are now.
  useEffect(() => {
    const ready = () => {
      setShown(true);
      void window.mobius.browser.getState().then((state) => setTabs(state.tabs)).catch(() => undefined);
      window.requestAnimationFrame(() => root.current?.querySelector('input')?.focus());
    };
    ready();
    return api?.onShown(() => { setShown(false); window.setTimeout(ready, 0); });
  }, [api]);

  const hide = () => { setShown(false); void api?.hide(); };
  const run = useCallback((chosen: LaunchChoice) => { setShown(false); void api?.run(chosen); }, [api]);

  // The main window's answers, by the words asked; the commands come with each answer.
  const [commands, setCommands] = useState<LauncherAnswer['commands']>([]);
  const answers = useRef(new Map<string, readonly FoundItem[]>());
  const toFound = useCallback((answer: LauncherAnswer): FoundItem[] => answer.items.flatMap((item) => (findApp(item.app)
    ? [{ id: item.id, app: item.app as AppId, label: item.label, ...(item.detail ? { detail: item.detail } : {}), run: () => run({ kind: 'found', id: item.id }) }]
    : [])), [run]);
  const find = useCallback((query: string): readonly FoundItem[] | Promise<readonly FoundItem[]> => {
    const known = answers.current.get(query);
    if (known || !api?.find) return known ?? [];
    return api.find(query).then((answer) => {
      setCommands(answer.commands);
      const items = toFound(answer);
      answers.current.set(query, items);
      return items;
    });
  }, [api, toFound]);
  // Each time it is shown, what the main window holds now: earlier answers are forgotten, and the commands come fresh.
  useEffect(() => {
    if (!shown) return;
    answers.current.clear();
    void api?.find?.('').then((answer) => setCommands(answer.commands)).catch(() => undefined);
  }, [shown, api]);

  return (
    <div className="launcher-window" ref={root}>
      <Launcher
        inline
        open={shown}
        onClose={hide}
        tabs={tabs}
        onNewTab={() => run({ kind: 'new-tab' })}
        onActivateTab={(id) => run({ kind: 'tab', id })}
        onOpenApp={(app: AppId) => run({ kind: 'app', app })}
        pinned={appearance.value.sidebarApps}
        onPinned={(sidebarApps) => void appearance.set({ sidebarApps: sidebarApps as typeof appearance.value.sidebarApps })}
        onOpenRecent={(item) => run({ kind: 'recent', app: item.app, ref: item.ref, label: item.label })}
        places={{ home: () => run({ kind: 'place', place: 'home' }), activity: () => run({ kind: 'place', place: 'activity' }), abilities: () => run({ kind: 'place', place: 'abilities' }), settings: () => run({ kind: 'place', place: 'settings' }) }}
        onOpenMobius={() => run({ kind: 'mobius' })}
        onAsk={(text) => run({ kind: 'ask', text })}
        find={find}
        commands={commands.map((c) => ({ ...c, run: () => run({ kind: 'command', id: c.id }) }))}
        onAskAbout={(item) => run({ kind: 'ask-about', app: item.app ?? '', label: item.label, ...(item.detail ? { detail: item.detail } : {}) })}
      />
    </div>
  );
}
