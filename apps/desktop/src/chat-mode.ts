import { useSyncExternalStore } from 'react';
import type { ApprovalModeChoice } from '@mobius/shared';

/**
 * The composer's two controls (Instrument, "Modes, permissions, model and tools"): Mode is the kind of help, Permission
 * is how much runs without asking. Mode is kept on this computer; Permission is the approval mode in the preferences,
 * with Apply changes as Review changes whose turns are kept at once.
 */
export type SharedMode = 'agent' | 'ask' | 'plan';
/** An app's own mode: a preset whose instructions the host holds (crates/mobius-host/src/agent.rs, APP_MODES). */
export type AppModeId = 'triage' | 'review' | 'analyse' | 'debug';
export type ChatMode = SharedMode | AppModeId;

export interface ChatModeInfo { id: ChatMode; name: string; hint: string; keys: string }

export const CHAT_MODES: readonly ChatModeInfo[] = [
  { id: 'agent', name: 'Agent', hint: 'Does the work, across apps if needed', keys: '1' },
  { id: 'ask', name: 'Ask', hint: 'Answers and explains, changes nothing', keys: '2' },
  { id: 'plan', name: 'Plan', hint: 'Writes a plan and waits for you', keys: '3' },
];

/** Each app's own modes, shown after the shared three and only while you are in that app. */
export const APP_MODES: readonly (ChatModeInfo & { id: AppModeId; apps: readonly string[] })[] = [
  { id: 'triage', name: 'Triage', hint: 'Sorts the inbox and drafts the replies', keys: '4', apps: ['mail'] },
  { id: 'review', name: 'Review', hint: 'Comments and suggests, never edits the text', keys: '4', apps: ['docs', 'notes'] },
  { id: 'analyse', name: 'Analyse', hint: 'Answers with charts and tables, never changes a cell', keys: '4', apps: ['sheets', 'database'] },
  { id: 'debug', name: 'Debug', hint: 'Reproduces the bug, then proposes the fix', keys: '4', apps: ['code'] },
];

const IDS: readonly string[] = [...CHAT_MODES, ...APP_MODES].map((m) => m.id);

/** The modes on offer in an app: the shared three, then its own. */
export const modesFor = (app?: string): readonly ChatModeInfo[] => [...CHAT_MODES, ...APP_MODES.filter((m) => app !== undefined && m.apps.includes(app))];

/** The mode in force in an app: a mode of another app counts as Agent here (and comes back on returning there). */
export const modeIn = (mode: ChatMode, app?: string): ChatMode => (modesFor(app).some((m) => m.id === mode) ? mode : 'agent');

const MODE_KEY = 'mobius.chatMode';
/** Before Mode, "Plan first" was a switch of its own. */
const PLAN_FIRST_KEY = 'mobius.planFirst';

export function loadChatMode(): ChatMode {
  try {
    const saved = window.localStorage.getItem(MODE_KEY);
    if (saved !== null && IDS.includes(saved)) return saved as ChatMode;
    return window.localStorage.getItem(PLAN_FIRST_KEY) === '1' ? 'plan' : 'agent';
  } catch { return 'agent'; }
}

export function saveChatMode(mode: ChatMode): void {
  try { window.localStorage.setItem(MODE_KEY, mode); window.localStorage.removeItem(PLAN_FIRST_KEY); } catch { /* Not kept. */ }
}

/**
 * The composer's mode, shared: the composer and the open app read and set the same one, so an app's action can switch
 * the composer (Mail's Triage button turns on Triage) and an app's slots can follow the mode (Instrument slot rule 5).
 */
let current: ChatMode | null = null;
const listeners = new Set<() => void>();
const currentMode = (): ChatMode => (current ??= loadChatMode());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Sets the composer's mode everywhere it is shown, and keeps it. */
export function setChatMode(mode: ChatMode): void {
  if (!IDS.includes(mode)) return;
  saveChatMode(mode);
  if (current === mode) return;
  current = mode;
  listeners.forEach((l) => l());
}

/**
 * The composer's mode and a way to set it. With an app, the mode in force there: another app's own mode reads as
 * Agent (see `modeIn`), so Mail sees 'triage' only while Triage is on.
 */
export function useChatMode(app?: string): [ChatMode, (mode: ChatMode) => void] {
  const mode = useSyncExternalStore(subscribe, currentMode, currentMode);
  return [app === undefined ? mode : modeIn(mode, app), setChatMode];
}

/** For tests: forget the mode held in memory, so the next read comes from what is kept. */
export const resetChatModeForTests = (): void => { current = null; };

/** Shift+Tab goes through the modes on offer: Agent, Ask, Plan and the app's own. */
export const nextChatMode = (mode: ChatMode, app?: string): ChatMode => {
  const modes = modesFor(app);
  return modes[(modes.findIndex((m) => m.id === modeIn(mode, app)) + 1) % modes.length]!.id;
};
export const chatModeOf = (mode: ChatMode, app?: string): ChatModeInfo => modesFor(app).find((m) => m.id === modeIn(mode, app)) ?? CHAT_MODES[0]!;

/** What a message is sent with in each mode. */
export const sendOptionsOf = (mode: ChatMode, app?: string): { plan?: boolean; ask?: boolean; mode?: AppModeId } => {
  const now = modeIn(mode, app);
  return now === 'plan' ? { plan: true } : now === 'ask' ? { ask: true } : now === 'agent' ? {} : { mode: now };
};

export type Permission = 'each' | 'review' | 'apply' | 'auto';

export interface PermissionInfo { id: Permission; name: string; short: string; hint: string; approval: Exclude<ApprovalModeChoice, 'off'> }

export const PERMISSIONS: readonly PermissionInfo[] = [
  { id: 'each', name: 'Ask each time', short: 'Each time', hint: 'Mobius asks before every step', approval: 'manual' },
  { id: 'review', name: 'Review changes', short: 'Review', hint: 'Changes show dashed until you keep them', approval: 'propose' },
  { id: 'apply', name: 'Apply changes', short: 'Apply', hint: 'Changes go in; Undo takes them back', approval: 'propose' },
  { id: 'auto', name: 'Auto', short: 'Auto', hint: 'Runs on its own in apps you switched on', approval: 'smart' },
];

const APPLY_KEY = 'mobius.applyChanges';
export function loadApply(): boolean { try { return window.localStorage.getItem(APPLY_KEY) === '1'; } catch { return false; } }
export function saveApply(on: boolean): void {
  try { window.localStorage.setItem(APPLY_KEY, on ? '1' : '0'); } catch { /* Not kept. */ }
  window.dispatchEvent(new Event(APPLY_EVENT));
}
/** Sent when Apply changes is turned on or off, so a waiting change block can keep itself. */
export const APPLY_EVENT = 'mobius:apply-changes';

/** The permission a saved approval mode stands for. */
export function permissionOf(approval: ApprovalModeChoice, apply: boolean): PermissionInfo {
  if (approval === 'manual') return PERMISSIONS[0]!;
  if (approval === 'smart' || approval === 'off') return PERMISSIONS[3]!;
  return apply ? PERMISSIONS[2]! : PERMISSIONS[1]!;
}

/** Best fit (Instrument, Control 3): the model picker's default, which sends a short question to the quick model chosen
 * in Settings and everything else to the chat model. Kept on this computer. */
const BEST_FIT_KEY = 'mobius.bestFit';
export function loadBestFit(): boolean {
  try { return window.localStorage.getItem(BEST_FIT_KEY) !== '0'; } catch { return true; }
}
export function saveBestFit(on: boolean): void {
  try { window.localStorage.setItem(BEST_FIT_KEY, on ? '1' : '0'); } catch { /* Not kept. */ }
}

/** The longest message Best fit still counts as a short question. */
export const BEST_FIT_SHORT = 160;

/** Whether Best fit sends this message to the quick model: a short question of one line, with nothing attached, that
 * is not a plan. Anything bigger goes to the chat model. */
export function bestFitQuick(text: string, attached: number, mode: ChatMode): boolean {
  const t = text.trim();
  return (mode === 'agent' || mode === 'ask') && attached === 0 && t.length > 0 && t.length <= BEST_FIT_SHORT && !t.includes('\n');
}
