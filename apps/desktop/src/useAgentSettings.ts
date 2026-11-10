import { useCallback, useEffect, useState } from 'react';
import type { AgentConfigureRequest, AgentResult, AgentSettings } from '@mobius/shared';

export function useAgentSettings(): { settings: AgentSettings | null; save(request: AgentConfigureRequest): Promise<AgentResult>; reload(): Promise<void> } {
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  useEffect(() => {
    let live = true;
    // As for the core's status: settings asked for at start never undo newer ones announced meanwhile.
    let heard = false;
    const off = window.mobius.agent.onSettings((value) => { if (!live) return; heard = true; console.info(`[mobius] model ${value.configured ? 'set up' : 'not set up'}`); setSettings(value); });
    void window.mobius.agent.getSettings().then((value) => { if (!live || !value || heard) return; console.info(`[mobius] model ${value.configured ? 'set up' : 'not set up'} (at start)`); setSettings(value); });
    return () => {
      live = false;
      off();
    };
  }, []);
  const save = useCallback(async (request: AgentConfigureRequest) => {
    const result = await window.mobius.agent.configure(request);
    const fresh = await window.mobius.agent.getSettings();
    if (fresh) setSettings(fresh);
    return result;
  }, []);
  const reload = useCallback(async () => {
    const fresh = await window.mobius.agent.getSettings();
    if (fresh) setSettings(fresh);
  }, []);
  return { settings, save, reload };
}
