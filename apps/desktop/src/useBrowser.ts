import { useEffect, useState } from 'react';
import type { BrowserState } from '@mobius/shared';

const empty: BrowserState = { tabs: [], activeId: null };

export function useBrowser(): BrowserState {
  const [state, setState] = useState<BrowserState>(empty);
  useEffect(() => {
    let live = true;
    const off = window.mobius.browser.onState((next) => live && setState(next));
    void window.mobius.browser.getState().then((initial) => live && initial && setState(initial));
    return () => {
      live = false;
      off();
    };
  }, []);
  return state;
}
