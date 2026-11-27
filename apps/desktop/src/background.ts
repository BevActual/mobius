import { ABILITY_ITEM, jobSteps, savedJobs } from './ability-offer';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationInfo } from '@mobius/shared';
import { KEPT_EVENT, fileKept, keepTurn, keptTurns, reviewable, turnId } from './ReviewStrip';

/**
 * Work handed to Mobius "in the background" (docs/design/mobius-agent.md): the panel steps aside while it runs, and
 * what it did lands as one row in Home's Inbox, with Keep all and Open, rather than the person watching it work.
 */
export interface BackgroundRun { conversation: string; ask: string; at: number; /** Stopped before it finished. */ stopped?: boolean; /** The morning brief (brief.ts) or an app's check-in (checkins.ts): its row shows what it wrote. */ kind?: 'brief' | 'check-in'; /** A check-in's app. */ app?: string; /** What was handed off (assign.ts `item`), so the same item is not started twice while two items that share a name are not confused. */ item?: string }
/** A run that has finished: what it changed and still waits for Keep (none for an answer that changed nothing). */
export interface BackgroundDone extends BackgroundRun { files: string[]; turn: string | null; /** Its last turn failed. */ failed?: boolean; /** A brief's answer, as written. */ text?: string; /** How many tool steps its job took (ability-offer.ts): several, and its row offers to save it as an Ability. */ steps?: number }

const KEY = 'mobius.background';
const MAX = 20;

export function readRuns(): BackgroundRun[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((r): r is BackgroundRun => typeof r === 'object' && r !== null && typeof r.conversation === 'string' && typeof r.ask === 'string' && typeof r.at === 'number').map((r) => ({ conversation: r.conversation, ask: r.ask, at: r.at, ...(r.stopped === true ? { stopped: true } : {}), ...(r.kind === 'brief' || r.kind === 'check-in' ? { kind: r.kind } : {}), ...(typeof r.app === 'string' ? { app: r.app } : {}), ...(typeof r.item === 'string' ? { item: r.item } : {}) })) : [];
  } catch { return []; }
}
function writeRuns(runs: readonly BackgroundRun[]): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(runs.slice(-MAX))); } catch { /* Not remembered. */ }
}
/** One run per conversation: a second background ask in the same chat replaces the first. A new morning brief
 * replaces the one before it, so the Inbox holds one, and so does an app's new check-in. */
export function addRun(runs: readonly BackgroundRun[], run: BackgroundRun): BackgroundRun[] {
  return [...runs.filter((r) => r.conversation !== run.conversation && !(run.kind !== undefined && r.kind === run.kind && r.app === run.app)), run].slice(-MAX);
}
/** Stop pressed (anywhere: its row, the pill, the panel): the run is marked, so the Inbox does not say it finished. */
export const stopRun = (runs: readonly BackgroundRun[], conversation: string): BackgroundRun[] => runs.map((r) => (r.conversation === conversation ? { ...r, stopped: true } : r));
export const dropRun = (runs: readonly BackgroundRun[], conversation: string): BackgroundRun[] => runs.filter((r) => r.conversation !== conversation);

/** "Changed 2 files" for the Inbox row, or what an answer without changes says; a stopped or failed run says so. */
export function doneText(files: readonly string[], end: { stopped?: boolean; failed?: boolean } = {}, by?: string): string {
  const n = files.filter(reviewable).length;
  // One of the person's own agents did it: the row says which ("Handy finished in the background").
  const said = end.stopped ? 'Stopped before it finished' : end.failed ? 'Did not finish: something went wrong' : 'Finished in the background';
  const how = by ? `${by} ${said.charAt(0).toLowerCase()}${said.slice(1)}` : said;
  return n === 0 ? how : `${how} · ${n === 1 ? '1 change' : `${n} changes`} to keep`;
}

/** A chat's last answer, as written. */
async function answerOf(conversation: string): Promise<string | undefined> {
  const history = await window.mobius.agent.history(conversation).catch(() => []);
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.role === 'assistant' && m.text.trim()) return m.text.trim();
  }
  return undefined;
}

/** The runs handed off, and those finished with what each changed. */
export function useBackgroundRuns(conversations: readonly ConversationInfo[]) {
  const [runs, setRuns] = useState<BackgroundRun[]>(readRuns);
  const [done, setDone] = useState<BackgroundDone[]>([]);
  const put = useCallback((next: BackgroundRun[]) => { writeRuns(next); setRuns(next); }, []);
  const start = useCallback((conversation: string, ask: string, kind?: 'brief' | 'check-in', app?: string, item?: string) => put(addRun(readRuns(), { conversation, ask, at: Date.now(), ...(kind ? { kind } : {}), ...(app ? { app } : {}), ...(item ? { item } : {}) })), [put]);
  const drop = useCallback((conversation: string) => put(dropRun(readRuns(), conversation)), [put]);
  // A run stopped before it finished, from wherever Stop was pressed.
  useEffect(() => window.mobius.agent.onNotification((n) => {
    if (n.method !== 'agent.event' || n.params.event.kind !== 'cancelled') return;
    const { conversation } = n.params;
    const all = readRuns();
    if (all.some((r) => r.conversation === conversation && !r.stopped)) put(stopRun(all, conversation));
  }), [put]);
  // A run is finished once its chat is no longer working; until then it is in Working on, as any chat is.
  const finished = runs.filter((r) => {
    const c = conversations.find((x) => x.id === r.conversation);
    return c ? c.activity !== 'working' && c.waiting === 0 : false;
  });
  const key = finished.map((r) => `${r.conversation}:${r.at}:${r.stopped ? 's' : ''}:${conversations.find((x) => x.id === r.conversation)?.activity ?? ''}`).join(',') + `|${runs.filter((r) => r.item?.startsWith(ABILITY_ITEM)).length}|${savedJobs().length}`;
  const reads = useRef(0);
  const load = useCallback(async () => {
    const n = ++reads.current;
    const out = await Promise.all(finished.map(async (r): Promise<BackgroundDone> => {
      const result = await window.mobius.changes?.lastTurn(r.conversation).catch(() => null);
      const changes = result && 'files' in result ? result : null;
      const turn = turnId(r.conversation, changes?.checkpoint ?? null);
      const files = changes && !(turn && keptTurns().includes(turn)) ? changes.files.filter((f) => reviewable(f) && !(turn && fileKept(turn, f))) : [];
      const failed = conversations.find((x) => x.id === r.conversation)?.activity === 'failed';
      const text = r.kind ? await answerOf(r.conversation) : undefined;
      // Not one that writes an Ability, nor one already being saved as one.
      const saving = r.item?.startsWith(ABILITY_ITEM) || savedJobs().includes(r.conversation);
      const steps = r.kind || failed || r.stopped || saving ? 0 : jobSteps(await window.mobius.agent.history(r.conversation).catch(() => [])).steps.length;
      return { ...r, files, turn, ...(failed ? { failed } : {}), ...(text ? { text } : {}), ...(steps ? { steps } : {}) };
    }));
    if (n === reads.current) setDone(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` names the finished runs.
  }, [key]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const again = () => void load();
    window.addEventListener(KEPT_EVENT, again);
    return () => window.removeEventListener(KEPT_EVENT, again);
  }, [load]);
  /** Keep all: the run's changes become the person's, and its row goes. */
  const keep = useCallback((run: BackgroundDone) => {
    if (run.turn) keepTurn(run.turn);
    drop(run.conversation);
  }, [drop]);
  return { runs, done, start, drop, keep };
}
