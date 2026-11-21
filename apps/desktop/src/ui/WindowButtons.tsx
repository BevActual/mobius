import { useEffect, useState } from 'react';
import type { WindowState } from '@mobius/shared';

/** The window calls the host gives where Mobius draws its own title bar (Windows and Linux); absent in a browser. */
interface WindowCalls {
  minimize?(): Promise<void>;
  toggleMaximize?(): Promise<void>;
  close?(): Promise<void>;
  getState?(): Promise<WindowState>;
  setTitle?(title: string): Promise<void>;
  onState(listener: (state: WindowState) => void): () => void;
}
const calls = (): WindowCalls | undefined => (typeof window === 'undefined' ? undefined : (window.mobius?.window as WindowCalls | undefined));

/** Whether the title row is the window's title bar: the host draws none and gives the buttons' calls (not on macOS). */
export const ownsTitleBar = (): boolean => window.mobius?.platform !== 'darwin' && typeof calls()?.minimize === 'function';

/** Tells the taskbar and Alt+Tab what is open ("Mobius" when nothing is). */
export function useWindowTitle(title: string | undefined): void {
  useEffect(() => { void calls()?.setTitle?.(title ?? '').catch(() => undefined); }, [title]);
}

/**
 * Minimise, maximise (restore when maximised) and close, at the title row's right end, as Windows draws them: 46 wide,
 * the row's full height, close turning red under the pointer. Close hides Mobius to the tray, as the system's did.
 */
export function WindowButtons() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const w = calls();
    if (!w) return undefined;
    void w.getState?.().then((s) => setMaximized(s.maximized)).catch(() => undefined);
    try { return w.onState((s) => setMaximized(s.maximized)); } catch { return undefined; }
  }, []);
  if (!ownsTitleBar()) return null;
  const w = calls()!;
  return (
    <div className="window-buttons" role="group" aria-label="Window controls">
      <button type="button" className="window-btn" aria-label="Minimise" title="Minimise" onClick={() => void w.minimize?.()}>
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" /></svg>
      </button>
      <button type="button" className="window-btn" data-window="max" aria-label={maximized ? 'Restore' : 'Maximise'} title={maximized ? 'Restore' : 'Maximise'} onClick={() => void w.toggleMaximize?.()}>
        {maximized
          ? <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" /></svg>
          : <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M.5.5h9v9h-9z" /></svg>}
      </button>
      <button type="button" className="window-btn" data-window="close" aria-label="Close" title="Close" onClick={() => void w.close?.()}>
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M.5.5l9 9M9.5.5l-9 9" /></svg>
      </button>
    </div>
  );
}
