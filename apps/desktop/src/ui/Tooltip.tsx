import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The shared tooltip (Instrument: "a small ink label with the control's name, then its key"). Mounted once by the
 * shell, it takes over every `title` in the app: hovering a control for a moment shows its name, and when the title
 * ends in a shortcut in brackets ("Undo (Ctrl+Z)") the shortcut is drawn as key caps after the name. While the tooltip
 * shows, the element's own `title` is set aside so the system's tooltip does not show as well; it is put back as soon
 * as the pointer leaves.
 */

const WORDS = new Set(['ctrl', 'alt', 'shift', 'cmd', 'option', 'esc', 'enter', 'return', 'tab', 'space', 'delete', 'backspace', 'home', 'end', 'pageup', 'pagedown', 'left', 'right', 'up', 'down', 'and', 'or']);

/** Splits "Undo (Ctrl+Z)" into the name and its keys; a bracket that is not a shortcut ("(you can undo it)") stays part of the name. */
export function splitTitle(title: string): { name: string; keys: string[][] } {
  const match = /^(.*\S)\s+\(([^()]+)\)$/.exec(title.trim());
  if (!match) return { name: title.trim(), keys: [] };
  const part = match[2]!.trim();
  // "− and +", "E or Enter": several shortcuts for one action. ("Ctrl+," is one shortcut: the comma is a key.)
  const combos = part.split(/\s+(?:and|or)\s+/);
  const keys: string[][] = [];
  for (const combo of combos) {
    const caps = combo.split('+').map((k) => k.trim());
    // A lone "+" (zoom in) splits into two empty parts.
    const cleaned = combo.trim() === '+' ? ['+'] : caps.filter((k, i) => k !== '' || (i > 0 && caps[i - 1] === ''));
    if (cleaned.length === 0 || cleaned.length > 4) return { name: title.trim(), keys: [] };
    for (const cap of cleaned) {
      const ok = cap.length <= 2 || /^F\d{1,2}$/.test(cap) || WORDS.has(cap.toLowerCase());
      if (!ok) return { name: title.trim(), keys: [] };
    }
    keys.push(cleaned.map((k) => (k === '' ? '+' : k)));
  }
  return { name: match[1]!, keys };
}

/** A shortcut as key caps ("Ctrl+Shift+N" as three caps), for menus, tooltips, the New button and the key-hint bar. */
export function KeyCaps({ keys, className }: { keys: string; className?: string }) {
  const parsed = splitTitle(`x (${keys})`).keys;
  const combos = parsed.length > 0 ? parsed : [[keys]];
  return (
    <span className={className ? `ui-keycaps ${className}` : 'ui-keycaps'} aria-label={keys}>
      {combos.map((combo, i) => (
        <span key={i} className="ui-tooltip-combo" aria-hidden="true">{combo.map((cap, j) => <kbd key={j} className="ui-keycap">{cap}</kbd>)}</span>
      ))}
    </span>
  );
}

const DELAY_MS = 450;
/** Once one tooltip has shown, the next one shows at once while the pointer moves along a toolbar. */
const WARM_MS = 600;

interface Shown { name: string; keys: string[][]; x: number; y: number; below: boolean }

export function TooltipLayer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const target = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const warmUntil = useRef(0);

  useEffect(() => {
    const restore = () => {
      const el = target.current;
      if (el && el.dataset.tip !== undefined) {
        if (!el.hasAttribute('title')) el.setAttribute('title', el.dataset.tip);
        delete el.dataset.tip;
      }
    };
    const hide = () => {
      window.clearTimeout(timer.current);
      if (target.current && shownRef.current) warmUntil.current = Date.now() + WARM_MS;
      restore();
      target.current = null;
      shownRef.current = false;
      setShown(null);
    };
    const shownRef = { current: false };
    const show = (el: HTMLElement) => {
      const title = el.dataset.tip ?? el.getAttribute('title') ?? '';
      if (!title.trim() || !el.isConnected) return;
      const box = el.getBoundingClientRect();
      const below = box.bottom + 40 < window.innerHeight;
      shownRef.current = true;
      setShown({ ...splitTitle(title), x: box.left + box.width / 2, y: below ? box.bottom + 6 : box.top - 6, below });
    };
    const over = (event: Event) => {
      const el = (event.target as Element | null)?.closest?.('[title], [data-tip]') as HTMLElement | null;
      if (el === target.current) return;
      hide();
      if (!el || el.closest('[data-no-tip]')) return;
      // A text field's title is a hint for the whole field, and the system's own is fine there.
      if (el.matches('input, textarea, select, [contenteditable="true"], iframe')) return;
      const title = el.getAttribute('title');
      if (!title) return;
      target.current = el;
      el.dataset.tip = title;
      el.removeAttribute('title');
      const wait = Date.now() < warmUntil.current ? 0 : DELAY_MS;
      timer.current = window.setTimeout(() => { if (target.current === el) show(el); }, wait);
    };
    const out = (event: PointerEvent) => {
      if (!target.current) return;
      const to = event.relatedTarget as Node | null;
      if (to && target.current.contains(to)) return;
      hide();
    };
    const away = () => hide();
    document.addEventListener('pointerover', over, true);
    document.addEventListener('pointerout', out, true);
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', away, true);
    document.addEventListener('wheel', away, { capture: true, passive: true });
    window.addEventListener('blur', away);
    return () => {
      hide();
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('pointerout', out, true);
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', away, true);
      document.removeEventListener('wheel', away, true);
      window.removeEventListener('blur', away);
    };
  }, []);

  // Keep the label inside the window: measured after it is drawn.
  const label = useRef<HTMLDivElement | null>(null);
  const [shift, setShift] = useState(0);
  useEffect(() => {
    const el = label.current;
    if (!el || !shown) { setShift(0); return; }
    const box = el.getBoundingClientRect();
    const margin = 6;
    if (box.left < margin) setShift(margin - box.left);
    else if (box.right > window.innerWidth - margin) setShift(window.innerWidth - margin - box.right);
    else setShift(0);
  }, [shown]);

  if (!shown) return null;
  return createPortal(
    <div ref={label} className="ui-tooltip" role="presentation" data-below={shown.below || undefined}
      style={{ left: shown.x + shift, top: shown.y }}>
      <span className="ui-tooltip-name">{shown.name}</span>
      {shown.keys.length > 0 && (
        <span className="ui-tooltip-keys">
          {shown.keys.map((combo, i) => (
            <span key={i} className="ui-tooltip-combo">{combo.map((cap, j) => <kbd key={j} className="ui-keycap">{cap}</kbd>)}</span>
          ))}
        </span>
      )}
    </div>,
    document.body,
  );
}
