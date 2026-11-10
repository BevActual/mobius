import { useEffect, useState } from 'react';
import type { CoreStatus } from '@mobius/shared';

export function useCoreStatus(): CoreStatus {
  const [status, setStatus] = useState<CoreStatus>('starting');
  useEffect(() => {
    let live = true;
    // The answer to "how is it now" can arrive after a change was announced: it never undoes one heard since.
    let heard = false;
    const off = window.mobius.core.onStatus((next) => { if (!live) return; heard = true; console.info(`[mobius] core ${next}`); setStatus(next); });
    void window.mobius.core.getStatus().then((initial) => { if (!live || !initial || heard) return; console.info(`[mobius] core ${initial} (at start)`); setStatus(initial); });
    return () => {
      live = false;
      off();
    };
  }, []);
  return status;
}
