import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { MobiusBridge } from '@mobius/shared';
import { installTauriBridge } from './bridge/tauri';
import { installPreviewBridge } from './bridge/preview';
import { App } from './App';
import { MiniApp, isMiniWindow } from './MiniApp';
import { MotionRoot } from './motion';
import { startKeepingEarlyKeys } from './early-keys';
import { preloadPreferences } from './usePreferences';
// Inter, bundled so every platform draws the same letters; its optical sizes give the display cut at large sizes.
import '@fontsource-variable/inter/opsz.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './tokens.css';
import './styles.css';

declare global {
  interface Window {
    mobius: MobiusBridge;
  }
}

// In the dev server with no shell around it, a stand-in bridge lets the interface be looked at alone.
if (!installTauriBridge() && import.meta.env.DEV) installPreviewBridge();

// No web page's right-click menu (Back, Reload, Inspect) anywhere in the app: a desktop app's own menus are the only ones.
// Text keeps it, for Cut, Copy and Paste: a field, editable text, or words the person has selected.
document.addEventListener('contextmenu', (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
  if (window.getSelection()?.isCollapsed === false) return;
  event.preventDefault();
});

// A page that stops answering for half a second or more says so on the console (the e2e logs print it), so a change
// that showed late can be told from a slow read on the host.
try {
  new PerformanceObserver((list) => {
    for (const task of list.getEntries()) if (task.duration >= 500) console.log(`[mobius] page busy ${Math.round(task.duration)} ms`);
  }).observe({ type: 'longtask', buffered: false });
} catch { /* Not every web view reports long tasks. */ }

// Shortcuts pressed before the saved ones are read are kept, and answered once they are (see App).
startKeepingEarlyKeys();

// No see-through glass when the system asks for none: the shell reads Windows' Transparency effects setting, which
// prefers-reduced-transparency may not follow.
if ((window as unknown as { __MOBIUS_SYSTEM__?: { reducedTransparency?: boolean } }).__MOBIUS_SYSTEM__?.reducedTransparency) document.documentElement.dataset.transparency = 'reduced';

// The saved preferences first (a moment, from this computer), so the window opens with the person's shortcuts working.
await Promise.race([preloadPreferences(), new Promise((resolve) => setTimeout(resolve, 1500))]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionRoot>
      {isMiniWindow() ? <MiniApp /> : <App />}
    </MotionRoot>
  </StrictMode>,
);
