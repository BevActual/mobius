import { useEffect, useRef } from 'react';
import { appName, type AppId } from './apps';
import type { FoundItem } from './Launcher';

/**
 * What each app lets the launcher find and do (docs/design/launcher.md, "How apps take part"). An app registers its
 * source the way it declares its panels, and the launcher asks every source as the person types, in Ctrl+K and in the
 * launcher's own window over other apps alike.
 */

/** Something an app can do from anywhere: "New event", "Compose", "Start timer". */
export interface LauncherCommand { id: string; label: string; detail?: string; app?: AppId; run: () => void }

export interface LauncherSource {
  app: AppId;
  /** Items matching the words, best first. Synchronous over what is already loaded; async allowed. */
  find?: (query: string, signal: AbortSignal) => readonly FoundItem[] | Promise<readonly FoundItem[]>;
  /** Commands that work from anywhere. */
  commands?: () => readonly LauncherCommand[];
}

const sources = new Set<LauncherSource>();

/** Add a source; the function returned takes it away again. */
export function registerLauncherSource(source: LauncherSource): () => void {
  sources.add(source);
  return () => { sources.delete(source); };
}

/** Register a source while a component is mounted. It always uses the latest `find` and `commands` given. */
export function useLauncherSource(source: LauncherSource): void {
  const latest = useRef(source);
  latest.current = source;
  const app = source.app;
  useEffect(() => registerLauncherSource({
    app,
    find: (query, signal) => latest.current.find?.(query, signal) ?? [],
    commands: () => latest.current.commands?.() ?? [],
  }), [app]);
}

/** Each source's items at most. */
const PER_SOURCE = 8;
/** A source that throws, or answers with something else, adds nothing. */
const listOf = (value: unknown): readonly FoundItem[] => (Array.isArray(value) ? (value as FoundItem[]).slice(0, PER_SOURCE) : []);
let asking: AbortController | null = null;

/**
 * Every source's items for the words, after the items given first. Synchronous when every source answers at once,
 * else a promise of them all (a slow or failing source never holds the others back for long, nor breaks them). A new
 * question cancels the one before it.
 */
export function findInSources(query: string, first: readonly FoundItem[] = []): readonly FoundItem[] | Promise<readonly FoundItem[]> {
  asking?.abort();
  const controller = new AbortController();
  asking = controller;
  const answers = [...sources].filter((s) => s.find).map((s) => {
    try { return s.find!(query, controller.signal); } catch { return []; }
  });
  const tagged = (lists: readonly (readonly FoundItem[])[]) => [...first, ...lists.flatMap((list) => list)];
  if (answers.every((a) => !(a instanceof Promise))) return tagged(answers.map(listOf));
  return Promise.all(answers.map((a) => Promise.resolve(a).then(listOf, () => []))).then(tagged);
}

/** Every source's commands, after the ones given first; a label already there is not offered twice. */
export function sourceCommands<T extends { label: string }>(first: readonly T[]): (T | LauncherCommand)[] {
  const all: (T | LauncherCommand)[] = [...first];
  for (const source of sources) {
    let list: readonly LauncherCommand[] = [];
    try { list = source.commands?.() ?? []; } catch { list = []; }
    for (const command of list) if (!all.some((c) => c.label === command.label)) all.push({ ...command, id: `${source.app}-${command.id}`, detail: command.detail ?? appName(source.app) });
  }
  return all;
}
