import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { MobiusBridge } from '@mobius/shared';
import { installTauriBridge } from './bridge/tauri';
import { App } from './App';
import { MotionRoot } from './motion';
import './styles.css';

declare global {
  interface Window {
    mobius: MobiusBridge;
  }
}

installTauriBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionRoot>
      <App />
    </MotionRoot>
  </StrictMode>,
);
