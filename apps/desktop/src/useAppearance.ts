import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_APPEARANCE, type AppearanceSettings } from '@mobius/shared';

export function useAppearance(): { value: AppearanceSettings; loaded: boolean; set(change: Partial<AppearanceSettings>): Promise<void> } {
  const [value, setValue] = useState<AppearanceSettings>(DEFAULT_APPEARANCE);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    void window.mobius.appearance.get().then((initial) => {
      if (!live) return;
      if (initial) setValue(initial);
      setLoaded(true);
    });
    const off = window.mobius.appearance.onChange((next) => live && setValue(next));
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
    root.chatFont = value.chatFont;
    root.textDir = value.textDirection;
    root.density = value.density;
    root.toolSteps = value.toolSteps;
  }, [value.chatFont, value.textDirection, value.density, value.toolSteps]);
  const set = useCallback(async (change: Partial<AppearanceSettings>) => {
    setValue((current) => ({ ...current, ...change }));
    const next = await window.mobius.appearance.set(change);
    if (next) setValue(next);
  }, []);
  return { value, loaded, set };
}
