import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PREFERENCES, type PreferencesSettings } from '@mobius/shared';

/** The saved preferences, read before the interface is first drawn (see main.tsx), so it starts with them. */
let preloaded: PreferencesSettings | null = null;
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
    const next = await window.mobius.preferences.set(change);
    if (next) setValue(next);
  }, []);
  return { value, loaded, set };
}
