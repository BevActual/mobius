import { useCallback, useEffect, useState } from 'react';
import type { AgentConfigureRequest, AgentResult, AgentSettings } from '@mobius/shared';

export function useAgentSettings(): { settings: AgentSettings | null; save(request: AgentConfigureRequest): Promise<AgentResult>; reload(): Promise<void> } {
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  useEffect(() => {
    let live = true;
    void window.mobius.agent.getSettings().then((value) => live && value && setSettings(value));
    const off = window.mobius.agent.onSettings((value) => live && setSettings(value));
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
