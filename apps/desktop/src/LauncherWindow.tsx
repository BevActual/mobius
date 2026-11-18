import { useEffect, useRef, useState } from 'react';
import type { BrowserTabState, LaunchChoice } from '@mobius/shared';
import { Launcher } from './Launcher';
import { useAppearance } from './useAppearance';
import type { AppId } from './apps';

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
  const run = (chosen: LaunchChoice) => { setShown(false); void api?.run(chosen); };

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
      />
    </div>
  );
}
