import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PREFERENCES, type PreferencesSettings } from '@mobius/shared';

/** The saved preferences, read before the interface is first drawn (see main.tsx), so it starts with them. */
let preloaded: PreferencesSettings | null = null;

// Changes on their way to the host. A message waits for them (see preferencesSettled), so a choice made just before
// sending, such as the effort, is the one the message is sent with.
const pending = new Set<Promise<unknown>>();
export async function preferencesSettled(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}
export async function preloadPreferences(): Promise<void> {
  preloaded = (await window.mobius.preferences.get().catch(() => null)) ?? null;
}

/**
 * The person's preferences. Until the saved ones arrive, `value` holds the defaults and `loaded` is false: anything that would
 * act on a choice the person may have changed (their keyboard shortcuts, say) waits for `loaded`.
 */
export function usePreferences(): { value: PreferencesSettings; loaded: boolean; set(change: Partial<PreferencesSettings>): Promise<void> } {
  const [value, setValue] = useState<PreferencesSettings>(() => preloaded ?? DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(() => preloaded !== null);
  useEffect(() => {
    let live = true;
    void window.mobius.preferences.get().then((initial) => {
      if (!live) return;
      if (initial) setValue(initial);
      setLoaded(true);
    });
    const off = window.mobius.preferences.onChange((next) => {
      if (!live) return;
      setValue(next);
      setLoaded(true);
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  const set = useCallback(async (change: Partial<PreferencesSettings>) => {
    setValue((current) => ({ ...current, ...change }));
    const writing = window.mobius.preferences.set(change);
    pending.add(writing);
    const next = await writing.finally(() => pending.delete(writing));
    if (next) setValue(next);
  }, []);
  return { value, loaded, set };
}
