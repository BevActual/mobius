import type { ApprovalModeChoice } from '@mobius/shared';

export interface ModeInfo {
  id: Exclude<ApprovalModeChoice, 'off'>;
  name: string;
  /** One line, for the message box's menu and Welcome. */
  hint: string;
  /** The longer account, for Settings › Safety. */
  help: string;
}

/**
 * The three ways Mobius works, in the order Shift+Tab goes through them. In every one, paying, sending, deleting and
 * running commands are asked about each time, and what you blocked stays blocked.
 */
export const MODES: readonly ModeInfo[] = [
  {
    id: 'manual', name: 'Ask first', hint: 'Asks before each tool',
    help: 'Mobius asks before it uses each tool, and you can choose to always allow one. Running commands, deleting files, reading secrets and clicking or typing on a web page are asked about every time.',
  },
  {
    id: 'propose', name: 'Propose', hint: 'Changes wait for Keep, Discard or Try another',
    help: 'Mobius reads and changes your notes, documents, tasks, sheets and other workspace files without asking. What a turn changed shows dashed until you Keep it, Discard it or ask it to Try another way. Browsing, mail, running commands and deleting files still ask.',
  },
  {
    id: 'smart', name: 'Act', hint: 'Does the work, checking each step',
    help: 'Mobius does the work and checks each step first: your model approves what is clearly safe, for that one time. A risky or unclear step stops as Needs you. What the reviewer sees is the tool and its arguments.',
  },
];

/** The mode a saved choice stands for. Off, from before the three modes, is Act. */
export const modeOf = (choice: ApprovalModeChoice): ModeInfo => MODES.find((m) => m.id === (choice === 'off' ? 'smart' : choice)) ?? MODES[1]!;

/** The mode after this one, for Shift+Tab in the message box. */
export const nextMode = (choice: ApprovalModeChoice): ModeInfo['id'] => MODES[(MODES.indexOf(modeOf(choice)) + 1) % MODES.length]!.id;
