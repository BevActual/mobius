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
import './tokens.css';
import './styles.css';

declare global {
  interface Window {
    mobius: MobiusBridge;
  }
}

// In the dev server with no shell around it, a stand-in bridge lets the interface be looked at alone.
if (!installTauriBridge() && import.meta.env.DEV) installPreviewBridge();

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
