import { useEffect, useState } from 'react';
import type { CoreStatus } from '@mobius/shared';

export function useCoreStatus(): CoreStatus {
  const [status, setStatus] = useState<CoreStatus>('starting');
  useEffect(() => {
    let live = true;
    const off = window.mobius.core.onStatus((next) => live && setStatus(next));
    void window.mobius.core.getStatus().then((initial) => live && initial && setStatus(initial));
    return () => {
      live = false;
      off();
    };
  }, []);
  return status;
}
