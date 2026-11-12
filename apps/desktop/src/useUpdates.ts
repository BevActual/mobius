import { useCallback, useEffect, useState } from 'react';
import type { UpdateInfo } from '@mobius/shared';

/** What Software Update says when the app has no updater (the preview, or an older shell). */
export const UPDATES_OFF: UpdateInfo = { state: 'off', status: 'Updates are not available here.', current: '' };

/** The reply is Software Update's state, or nothing: never a failure taken for a state. */
export function asUpdateInfo(value: unknown): UpdateInfo | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const states = ['off', 'idle', 'checking', 'upToDate', 'downloading', 'ready', 'failed'];
  if (typeof v.state !== 'string' || !states.includes(v.state) || typeof v.status !== 'string') return null;
  return {
    state: v.state as UpdateInfo['state'],
    status: v.status,
    current: typeof v.current === 'string' ? v.current : '',
    ...(typeof v.version === 'string' ? { version: v.version } : {}),
    ...(typeof v.percent === 'number' ? { percent: v.percent } : {}),
    ...(typeof v.checkedMs === 'number' ? { checkedMs: v.checkedMs } : {}),
  };
}

/** Software Update as it is now, kept as it changes. */
export function useUpdates() {
  const api = window.mobius.updates;
  const [info, setInfo] = useState<UpdateInfo>(UPDATES_OFF);
  useEffect(() => {
    if (!api) return undefined;
    let live = true;
    void api.get().then((got) => { const i = asUpdateInfo(got); if (live && i) setInfo(i); }).catch(() => undefined);
    const off = api.onChange((next) => { const i = asUpdateInfo(next); if (live && i) setInfo(i); });
    return () => { live = false; off(); };
  }, [api]);
  const check = useCallback(async () => {
    const got = asUpdateInfo(await api?.check().catch(() => null));
    if (got) setInfo(got);
  }, [api]);
  const restart = useCallback(async () => (api ? api.restart() : { ok: false as const, error: 'Updates are not available here.' }), [api]);
  return { info, check, restart };
}
