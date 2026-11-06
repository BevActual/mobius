import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PREFERENCES, type PreferencesSettings } from '@mobius/shared';

export function usePreferences(): { value: PreferencesSettings; set(change: Partial<PreferencesSettings>): Promise<void> } {
  const [value, setValue] = useState<PreferencesSettings>(DEFAULT_PREFERENCES);
  useEffect(() => {
    let live = true;
    void window.mobius.preferences.get().then((initial) => live && initial && setValue(initial));
    const off = window.mobius.preferences.onChange((next) => live && setValue(next));
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
  return { value, set };
}
