import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_APPEARANCE, parseAppearance, type AppearanceSettings } from '@mobius/shared';

export function useAppearance(): { value: AppearanceSettings; loaded: boolean; set(change: Partial<AppearanceSettings>): Promise<void> } {
  const [value, setValue] = useState<AppearanceSettings>(DEFAULT_APPEARANCE);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    void window.mobius.appearance.get().then((initial) => {
      if (!live) return;
      const got = parseAppearance(initial);
      if (got) setValue(got);
      setLoaded(true);
    });
    const off = window.mobius.appearance.onChange((next) => { const got = parseAppearance(next); if (live && got) setValue(got); });
    return () => {
      live = false;
      off();
    };
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty('--chat-scale', String(value.chatTextScale));
  }, [value.chatTextScale]);
  // The choices that are only about how things look are applied as attributes the stylesheet reads.
  useEffect(() => {
    const root = document.documentElement.dataset;
    root.theme = value.theme;
    root.chatFont = value.chatFont;
    root.textDir = value.textDirection;
    root.density = value.density;
    root.toolSteps = value.toolSteps;
    root.keyHints = value.keyHints ? 'on' : 'off';
  }, [value.theme, value.chatFont, value.textDirection, value.density, value.toolSteps, value.keyHints]);
  const set = useCallback(async (change: Partial<AppearanceSettings>) => {
    setValue((current) => ({ ...current, ...change }));
    // Only a reply that is the look replaces it: a failed save keeps what is shown.
    const next = parseAppearance(await window.mobius.appearance.set(change).catch(() => null));
    if (next) setValue(next);
  }, []);
  return { value, loaded, set };
}
