import type { ApprovalModeChoice } from '@mobius/shared';

export interface ModeInfo {
  id: Exclude<ApprovalModeChoice, 'off'>;
  name: string;
  /** One line, for the message box's menu and Welcome. */
  hint: string;
  /** The longer account, for Settings › Safety. */
  help: string;
  /** One sentence for an empty conversation, saying what Mobius will do in this mode. */
  greeting: string;
}

/**
 * The three stored approval modes, named as the composer's Permission names them (Apply changes is Review changes kept
 * at once, chat-mode.ts), in the order Shift+Tab goes through them. In every one, paying, sending, deleting and
 * running commands are asked about each time, and what you blocked stays blocked.
 */
export const MODES: readonly ModeInfo[] = [
  {
    id: 'manual', name: 'Ask each time', hint: 'Mobius asks before every step',
    greeting: 'Mobius asks before it uses a tool.',
    help: 'Mobius asks before it uses each tool, and you can choose to always allow one. Running commands, deleting files, reading secrets and clicking or typing on a web page are asked about every time.',
  },
  {
    id: 'propose', name: 'Review changes', hint: 'Changes show dashed until you keep them',
    greeting: 'Mobius reads and changes your workspace without asking, and what it changes waits for you to keep. Browsing, mail and commands still ask.',
    help: 'Mobius reads and changes your notes, documents, tasks, sheets and other workspace files without asking. What a turn changed shows dashed until you Keep it, Discard it or ask it to Try another way. Browsing, mail, running commands and deleting files still ask.',
  },
  {
    id: 'smart', name: 'Auto', hint: 'Runs on its own, checking each step',
    greeting: 'Mobius does the work and checks each step; anything risky waits for you.',
    help: 'Mobius does the work and checks each step first: your model approves what is clearly safe, for that one time. A risky or unclear step stops as Needs you. What the reviewer sees is the tool and its arguments.',
  },
];

/** The mode a saved choice stands for. Off, from before the three modes, is Auto. */
export const modeOf = (choice: ApprovalModeChoice): ModeInfo => MODES.find((m) => m.id === (choice === 'off' ? 'smart' : choice)) ?? MODES[1]!;

/** The mode after this one, for Shift+Tab in the message box. */
export const nextMode = (choice: ApprovalModeChoice): ModeInfo['id'] => MODES[(MODES.indexOf(modeOf(choice)) + 1) % MODES.length]!.id;
