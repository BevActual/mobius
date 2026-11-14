import type { MenuEntry } from './Menu';

/**
 * Fitting an app's controls into the toolbar (Instrument: one ⋯ per toolbar). When the title has given way and the
 * controls still don't fit, controls drop out whole, lowest priority first and the last first within a priority, and
 * each one dropped shows as a row in the ⋯ menu, first, above the app's own commands. A control marked "keep" (the
 * view switch) never drops.
 */
export type ToolbarPriority = 'low' | 'normal' | 'keep';

const RANK: Record<ToolbarPriority, number> = { low: 0, normal: 1, keep: 2 };

/** The order controls drop in: indexes of the given priorities, low before normal, the last first; never "keep". */
export function dropOrder(priorities: readonly ToolbarPriority[]): number[] {
  return priorities
    .map((p, i) => ({ p, i }))
    .filter((c) => c.p !== 'keep')
    .sort((a, b) => RANK[a.p] - RANK[b.p] || b.i - a.i)
    .map((c) => c.i);
}

/** A divider (an empty aria-hidden span between controls) goes when nothing after it in its group is still shown. */
const isDivider = (el: Element) => el.getAttribute('aria-hidden') === 'true' && !el.querySelector('button, input, select, [role]');

const priorityOf = (el: Element): ToolbarPriority => {
  const p = el.getAttribute('data-priority') ?? el.querySelector(':scope > [data-priority]')?.getAttribute('data-priority');
  return p === 'low' || p === 'keep' ? p : 'normal';
};

/** The controls of the slot that can drop: the children of each group, dividers aside. */
function controlsOf(slot: HTMLElement): HTMLElement[] {
  return [...slot.querySelectorAll<HTMLElement>(':scope > .ui-toolbar-group > *')].filter((el) => !isDivider(el));
}

const nameOf = (el: Element): string =>
  (el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.textContent ?? '').trim();

/**
 * A dropped control as menu rows: what it says it is (`data-menu`, set by ToolbarItem), else a button as one row that
 * presses it, or a radio group (the view switch) as one ticked row per choice. Anything else has no row.
 */
export function menuRowsOf(el: HTMLElement, given?: MenuEntry[]): MenuEntry[] {
  if (given) return given;
  const radios = el.matches('[role="radiogroup"]') ? [el] : [...el.querySelectorAll<HTMLElement>(':scope > [role="radiogroup"]')];
  if (radios.length > 0) {
    return radios.flatMap((group) => [...group.querySelectorAll<HTMLElement>('[role="radio"]')].map((r) => ({
      label: nameOf(r), checked: r.getAttribute('aria-checked') === 'true', run: () => r.click(),
    })));
  }
  const button = el.matches('button') ? el : el.querySelectorAll('button').length === 1 ? el.querySelector<HTMLElement>('button') : null;
  if (!button) return [];
  const name = nameOf(button);
  if (!name) return [];
  const pressed = button.getAttribute('aria-pressed');
  const keys = button.getAttribute('data-keys');
  return [{
    label: name, run: () => button.click(),
    ...(keys ? { keys } : {}),
    ...(pressed !== null ? { checked: pressed === 'true' } : {}),
    ...((button as HTMLButtonElement).disabled ? { disabled: true } : {}),
  }];
}

/**
 * Shows every control, then drops them in `dropOrder` until the slot's contents fit its width. Returns the dropped
 * controls, in the order they sit in the toolbar.
 */
export function fitToolbar(slot: HTMLElement, strip: HTMLElement | null = slot.parentElement): HTMLElement[] {
  // The shell's own low-priority buttons at the toolbar's end (Comments) drop before any of the app's.
  const trail = strip ? [...strip.querySelectorAll<HTMLElement>(':scope > .strip-right > [data-priority="low"]')] : [];
  [...trail, ...slot.querySelectorAll<HTMLElement>(':scope > .ui-toolbar-group > *')].forEach((el) => el.removeAttribute('data-dropped'));
  const controls = controlsOf(slot);
  const fits = () => slot.scrollWidth <= slot.clientWidth + 1 && (!strip || strip.scrollWidth <= strip.clientWidth + 1);
  const dropped = new Set<HTMLElement>();
  const order = [...trail, ...dropOrder(controls.map(priorityOf)).map((i) => controls[i]!)];
  for (const el of order) {
    if (fits()) break;
    el.setAttribute('data-dropped', '');
    dropped.add(el);
    // A divider with nothing shown after it in its group goes too.
    for (const group of slot.querySelectorAll<HTMLElement>(':scope > .ui-toolbar-group')) {
      const kids = [...group.children] as HTMLElement[];
      kids.forEach((k, at) => {
        if (isDivider(k) && kids.slice(at + 1).every((after) => isDivider(after) || after.hasAttribute('data-dropped'))) k.setAttribute('data-dropped', '');
      });
    }
  }
  return [...trail, ...controls].filter((el) => dropped.has(el));
}
