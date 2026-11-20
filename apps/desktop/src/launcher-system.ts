import { useEffect, useState } from 'react';
import type { SystemApp, SystemCommand } from '@mobius/shared';

/**
 * The computer's own apps and commands in the launcher (docs/design/launcher.md): Start menu apps, and Lock, Sleep and
 * Empty the Recycle Bin. From the desktop app only; read once each time the launcher opens.
 */
export interface LauncherSystem {
  apps: readonly SystemApp[];
  commands: readonly SystemCommand[];
  open: (id: string) => void;
  run: (id: string) => void;
}

/** The apps whose names hold what was typed, those starting with it first, then A to Z. */
export function findSystemApps(apps: readonly SystemApp[], q: string, max = 6): SystemApp[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  const words = (name: string) => name.toLowerCase().split(/[\s\-_.]+/);
  const rank = (a: SystemApp) => (a.name.toLowerCase().startsWith(t) ? 0 : words(a.name).some((w) => w.startsWith(t)) ? 1 : 2);
  return apps.filter((a) => a.name.toLowerCase().includes(t)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, max);
}

/** Commands found by their name or a short word for them: "lock", "sleep", "bin", "trash", "recycle". */
const ALSO: Record<string, string> = { lock: 'lock screen', sleep: 'suspend standby', 'empty-bin': 'trash recycle bin empty' };
export function findSystemCommands(commands: readonly SystemCommand[], q: string): SystemCommand[] {
  const t = q.trim().toLowerCase();
  if (t.length < 2) return [];
  return commands.filter((c) => `${c.name} ${ALSO[c.id] ?? ''}`.toLowerCase().includes(t));
}

export function useSystemSearch(open: boolean): LauncherSystem | undefined {
  const api = typeof window === 'undefined' ? undefined : window.mobius?.system;
  const [apps, setApps] = useState<SystemApp[]>([]);
  const [commands, setCommands] = useState<SystemCommand[]>([]);
  useEffect(() => {
    if (!api || !open) return;
    let live = true;
    void api.apps().then((list) => { if (live) setApps(list); }, () => undefined);
    void api.commands().then((list) => { if (live) setCommands(list); }, () => undefined);
    return () => { live = false; };
  }, [api, open]);
  return api ? { apps, commands, open: (id) => { void api.open(id); }, run: (id) => { void api.run(id); } } : undefined;
}
