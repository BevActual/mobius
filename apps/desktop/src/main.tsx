import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { MobiusBridge } from '@mobius/shared';
import { installTauriBridge } from './bridge/tauri';
import { installPreviewBridge } from './bridge/preview';
import { App } from './App';
import { MiniApp, isMiniWindow } from './MiniApp';
import { MotionRoot } from './motion';
import './tokens.css';
import './styles.css';

declare global {
  interface Window {
    mobius: MobiusBridge;
  }
}

// In the dev server with no shell around it, a stand-in bridge lets the interface be looked at alone.
if (!installTauriBridge() && import.meta.env.DEV) installPreviewBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionRoot>
      {isMiniWindow() ? <MiniApp /> : <App />}
    </MotionRoot>
  </StrictMode>,
);
