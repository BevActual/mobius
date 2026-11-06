/**
 * Keyboard shortcuts: what can be bound, how a key press is written down, and what is allowed.
 *
 * A combination is written like `mod+shift+k`: `mod` is Control (or Command on a Mac), then `alt`, then `shift`, then the
 * key, always in that order so the same press always gives the same text. The key is taken from the physical key, not
 * from the character it types, so Alt on a Mac or a different keyboard layout does not change it.
 */

export const SHORTCUT_ACTIONS = ['launcher', 'address', 'newTab', 'closeTab', 'settings', 'find', 'quickEntry'] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];
/** An action's binding: a combination, or '' for none. */
export type KeyBindings = Record<ShortcutAction, string>;

/** What each action is called, and whether it works from anywhere on the computer. */
export const SHORTCUT_INFO: Record<ShortcutAction, { label: string; global: boolean }> = {
  launcher: { label: 'Find apps, pages and commands', global: false },
  address: { label: 'Go to the address bar', global: false },
  newTab: { label: 'Open a new tab', global: false },
  closeTab: { label: 'Close the current tab', global: false },
  settings: { label: 'Open settings', global: false },
  find: { label: 'Find on the page', global: false },
  quickEntry: { label: 'Bring Mobius up and start a message, from anywhere', global: true },
};

export const DEFAULT_KEYBINDINGS: KeyBindings = {
  launcher: 'mod+k',
  address: 'mod+l',
  newTab: 'mod+t',
  closeTab: 'mod+w',
  settings: 'mod+,',
  find: 'mod+f',
  quickEntry: '',
};

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const DIGITS = '0123456789'.split('');
const PUNCTUATION = [',', '.', '/', ';', "'", '[', ']', '-', '=', '\\', '`'];
const FUNCTION_KEYS = Array.from({ length: 12 }, (_, i) => `f${i + 1}`);
const NAMED = ['space', 'up', 'down', 'left', 'right'];
const KEYS: ReadonlySet<string> = new Set([...LETTERS, ...DIGITS, ...PUNCTUATION, ...FUNCTION_KEYS, ...NAMED]);
/** Pressed with only Control and Shift, these belong to editing and are never taken. */
const EDITING_KEYS: ReadonlySet<string> = new Set(['c', 'v', 'x', 'a', 'z', 'y']);

export interface Combo { mod: boolean; alt: boolean; shift: boolean; key: string }

export function parseCombo(text: unknown): Combo | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > 40) return null;
  const parts = text.split('+');
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  if (key === undefined || !KEYS.has(key)) return null;
  const combo: Combo = { mod: false, alt: false, shift: false, key };
  const order = ['mod', 'alt', 'shift'];
  let last = -1;
  for (const modifier of modifiers) {
    const at = order.indexOf(modifier);
    if (at <= last) return null; // unknown, repeated, or out of order
    last = at;
    combo[modifier as 'mod' | 'alt' | 'shift'] = true;
  }
  return combo;
}

export function formatCombo(combo: Combo): string {
  return [combo.mod ? 'mod' : '', combo.alt ? 'alt' : '', combo.shift ? 'shift' : '', combo.key].filter(Boolean).join('+');
}

/** Why a combination cannot be used, or null when it can. */
export function comboProblem(combo: Combo): string | null {
  const isFunctionKey = FUNCTION_KEYS.includes(combo.key);
  if (!combo.mod && !combo.alt && !isFunctionKey) return 'Use Ctrl (or Command) or Alt with the key, so it cannot get in the way of typing.';
  if (EDITING_KEYS.has(combo.key) && combo.mod && !combo.alt) return 'That one is used for copy, paste and undo.';
  return null;
}

/** A key press as the keyboard reports it: `code` is the physical key, such as `KeyK`, `Digit1`, `Comma` or `Space`. */
export interface KeyPress { code: string; ctrl: boolean; meta: boolean; alt: boolean; shift: boolean }

const CODE_PUNCTUATION: Record<string, string> = {
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backslash: '\\', Backquote: '`',
  Space: 'space', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
};

/** The combination a key press makes, or null when it is only a modifier or a key that cannot be bound. */
export function comboOfPress(press: KeyPress): Combo | null {
  let key: string | undefined;
  if (/^Key[A-Z]$/.test(press.code)) key = press.code.slice(3).toLowerCase();
  else if (/^Digit[0-9]$/.test(press.code)) key = press.code.slice(5);
  else if (/^F([1-9]|1[0-2])$/.test(press.code)) key = press.code.toLowerCase();
  else key = CODE_PUNCTUATION[press.code];
  if (!key || !KEYS.has(key)) return null;
  return { mod: press.ctrl || press.meta, alt: press.alt, shift: press.shift, key };
}

/** The action whose binding this press matches, if any. Modifiers must match exactly. */
export function actionForPress(bindings: KeyBindings, press: KeyPress): ShortcutAction | null {
  const pressed = comboOfPress(press);
  if (!pressed) return null;
  const text = formatCombo(pressed);
  return SHORTCUT_ACTIONS.find((action) => bindings[action] === text) ?? null;
}

/** A binding is acceptable: nothing, or a combination that parses and is allowed. Parsing only accepts the standard spelling. */
export function isBinding(value: unknown): value is string {
  if (value === '') return true;
  const combo = parseCombo(value);
  return combo !== null && comboProblem(combo) === null;
}

/** Every action is present and well formed, and no two actions share a combination. */
export function isKeyBindings(value: unknown): value is KeyBindings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== SHORTCUT_ACTIONS.length || !SHORTCUT_ACTIONS.every((action) => keys.includes(action))) return false;
  const used = new Set<string>();
  for (const action of SHORTCUT_ACTIONS) {
    const binding = record[action];
    if (!isBinding(binding)) return false;
    if (binding !== '') {
      if (used.has(binding)) return false;
      used.add(binding);
    }
  }
  return true;
}

/** Another action that already uses this combination. */
export function conflictFor(bindings: KeyBindings, action: ShortcutAction, binding: string): ShortcutAction | null {
  if (binding === '') return null;
  return SHORTCUT_ACTIONS.find((other) => other !== action && bindings[other] === binding) ?? null;
}

/** How a combination reads on screen. */
export function describeCombo(binding: string, platform: string): string {
  const combo = parseCombo(binding);
  if (!combo) return '';
  const mac = platform === 'darwin';
  const names: Record<string, string> = { space: 'Space', up: 'Up', down: 'Down', left: 'Left', right: 'Right' };
  const key = names[combo.key] ?? (combo.key.length === 1 ? combo.key.toUpperCase() : combo.key.toUpperCase());
  return [combo.mod ? (mac ? 'Cmd' : 'Ctrl') : '', combo.alt ? (mac ? 'Option' : 'Alt') : '', combo.shift ? 'Shift' : '', key].filter(Boolean).join('+');
}

/** The same combination as Electron writes it for a global shortcut. */
export function toAccelerator(binding: string): string | null {
  const combo = parseCombo(binding);
  // A bare letter as a global shortcut would take that key from every program.
  if (!combo || !isBinding(binding)) return null;
  const names: Record<string, string> = { space: 'Space', up: 'Up', down: 'Down', left: 'Left', right: 'Right' };
  const key = names[combo.key] ?? combo.key.toUpperCase();
  return [combo.mod ? 'CommandOrControl' : '', combo.alt ? 'Alt' : '', combo.shift ? 'Shift' : '', key].filter(Boolean).join('+');
}
