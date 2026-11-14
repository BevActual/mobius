import type { ApprovalModeChoice } from '@mobius/shared';

/**
 * The composer's two controls (Instrument, "Modes, permissions, model and tools"): Mode is the kind of help, Permission
 * is how much runs without asking. Mode is kept on this computer; Permission is the approval mode in the preferences,
 * with Apply changes as Review changes whose turns are kept at once.
 */
export type ChatMode = 'agent' | 'ask' | 'plan';

export interface ChatModeInfo { id: ChatMode; name: string; hint: string; keys: string }

export const CHAT_MODES: readonly ChatModeInfo[] = [
  { id: 'agent', name: 'Agent', hint: 'Does the work, across apps if needed', keys: '1' },
  { id: 'ask', name: 'Ask', hint: 'Answers and explains. Changes nothing.', keys: '2' },
  { id: 'plan', name: 'Plan', hint: 'Writes a short plan and waits for you to start it', keys: '3' },
];

const MODE_KEY = 'mobius.chatMode';
/** Before Mode, "Plan first" was a switch of its own. */
const PLAN_FIRST_KEY = 'mobius.planFirst';

export function loadChatMode(): ChatMode {
  try {
    const saved = window.localStorage.getItem(MODE_KEY);
    if (saved === 'agent' || saved === 'ask' || saved === 'plan') return saved;
    return window.localStorage.getItem(PLAN_FIRST_KEY) === '1' ? 'plan' : 'agent';
  } catch { return 'agent'; }
}

export function saveChatMode(mode: ChatMode): void {
  try { window.localStorage.setItem(MODE_KEY, mode); window.localStorage.removeItem(PLAN_FIRST_KEY); } catch { /* Not kept. */ }
}

/** Shift+Tab goes through Agent, Ask and Plan. */
export const nextChatMode = (mode: ChatMode): ChatMode => CHAT_MODES[(CHAT_MODES.findIndex((m) => m.id === mode) + 1) % CHAT_MODES.length]!.id;
export const chatModeOf = (mode: ChatMode): ChatModeInfo => CHAT_MODES.find((m) => m.id === mode) ?? CHAT_MODES[0]!;

/** What a message is sent with in each mode. */
export const sendOptionsOf = (mode: ChatMode): { plan?: boolean; ask?: boolean } => (mode === 'plan' ? { plan: true } : mode === 'ask' ? { ask: true } : {});

export type Permission = 'each' | 'review' | 'apply' | 'auto';

export interface PermissionInfo { id: Permission; name: string; short: string; hint: string; approval: Exclude<ApprovalModeChoice, 'off'> }

export const PERMISSIONS: readonly PermissionInfo[] = [
  { id: 'each', name: 'Ask each time', short: 'Each time', hint: 'Reads without asking; asks before every change', approval: 'manual' },
  { id: 'review', name: 'Review changes', short: 'Review', hint: 'Changes here land dashed and wait for Keep or Discard', approval: 'propose' },
  { id: 'apply', name: 'Apply changes', short: 'Apply', hint: 'Changes here are kept at once, with Undo and Rewind', approval: 'propose' },
  { id: 'auto', name: 'Auto', short: 'Auto', hint: 'Does the work and checks each step; the risky ones still ask', approval: 'smart' },
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
