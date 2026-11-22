import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpaceStatus } from '@mobius/shared';

/**
 * The local Mobius space's server, for Messages' rail: nothing happens until `open` is called (the first time, that
 * downloads it), then its status follows the shell's. `open` again after a failure retries.
 */
export function useSpace(): { available: boolean; status: SpaceStatus; open: () => void } {
  const api = window.mobius.space;
  const [status, setStatus] = useState<SpaceStatus>({ state: 'idle' });
  const asked = useRef(false);
  useEffect(() => {
    if (!api) return;
    void api.status().then(setStatus).catch(() => {});
    return api.onStatus(setStatus);
  }, [api]);
  const open = useCallback(() => {
    if (!api) return;
    // Once a session is enough while it runs or is on its way; after a failure, each press tries again.
    if (asked.current && status.state !== 'failed') return;
    asked.current = true;
    void api.open().then(setStatus).catch((e: unknown) => setStatus({ state: 'failed', message: e instanceof Error ? e.message : String(e), offline: false }));
  }, [api, status.state]);
  return { available: !!api, status, open };
}
