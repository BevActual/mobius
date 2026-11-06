import { useCallback, useEffect, useState } from 'react';
import { MAIN_BOT_ID, MAIN_BOT_NAME, type Bot, type BotDraft, type BotResult } from '@mobius/shared';

const MAIN: Bot = { id: MAIN_BOT_ID, name: MAIN_BOT_NAME, instructions: '', model: '', createdMs: 0 };

export interface Bots {
  bots: Bot[];
  loaded: boolean;
  create(draft: BotDraft): Promise<BotResult<{ bot: Bot }>>;
  update(id: string, draft: BotDraft): Promise<BotResult<{ bot: Bot }>>;
  move(id: string, direction: 'up' | 'down'): Promise<BotResult>;
  remove(id: string): Promise<BotResult<{ removedSessions: number }>>;
}

export function useBots(): Bots {
  const [bots, setBots] = useState<Bot[]>([MAIN]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    void window.mobius.bots.get().then((state) => {
      if (!live || !state) return;
      setBots(state.bots);
      setLoaded(true);
    });
    const off = window.mobius.bots.onChange((state) => live && setBots(state.bots));
    return () => {
      live = false;
      off();
    };
  }, []);
  const create = useCallback((draft: BotDraft) => window.mobius.bots.create(draft), []);
  const update = useCallback((id: string, draft: BotDraft) => window.mobius.bots.update(id, draft), []);
  const remove = useCallback((id: string) => window.mobius.bots.remove(id), []);
  const move = useCallback((id: string, direction: 'up' | 'down') => window.mobius.bots.move(id, direction), []);
  return { bots, loaded, create, update, move, remove };
}
