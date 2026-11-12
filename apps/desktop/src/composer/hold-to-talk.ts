import { actionForPress, type KeyBindings, type KeyPress } from '@mobius/shared';

/** This press is the hold-to-talk shortcut (Ctrl+Space unless changed in Settings, Keyboard), and it is set. */
export function isHoldToTalk(bindings: KeyBindings, press: KeyPress): boolean {
  return Boolean(bindings.holdToTalk) && actionForPress(bindings, press) === 'holdToTalk';
}

/** The keyboard is in the Mobius panel this composer belongs to (or in the composer itself), so holding listens here. */
export function holdsHere(focused: Element | null, composer: Element | null): boolean {
  if (!focused || !composer) return false;
  if (composer.contains(focused)) return true;
  const panel = composer.closest('.chat');
  return panel !== null && panel.contains(focused);
}
